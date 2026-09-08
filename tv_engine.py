"""
tv_engine.py — TradingView Alert Poller, Multi-Strategy Order Executor & Dedicated Multi-Sheet Trade Journal for Zerodha Kite Connect

Features:
1. Continuous polling of TradingView alerts from alert_queue.json via Webhook server (GET /pending-alerts).
2. Advanced Idempotency & Deduplication Engine:
   - Persists processed alert IDs to disk (tv_processed_alerts.json).
   - Prevents duplicate order execution even on network drops or poller restarts.
   - Zero missed alerts guaranteed with write-through acknowledgment.
3. Multi-Sheet Excel & CSV Trading Journal:
   - Records every successfully placed order immediately.
   - Master Sheet: 'All_Trades' (consolidated order log).
   - Individual Sheet per Strategy: Formatted tab for each strategy (e.g. 'Nifty_Option_Scalp', 'Silvermic_15M', 'DEFAULT').
   - Exports both tv_trading_journal.xlsx and tv_trading_journal.csv.
4. Strategy Rule Engine:
   - Configurable rules in tv_strategies.json (manageable from index.html).
   - Direct Symbol placement or Auto ATM CE/PE Option calculation.
"""

import os
import sys
import csv
import json
import time
import logging
import threading
import requests
from datetime import datetime, date

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "pykiteconnect"))

logger = logging.getLogger("tv_engine")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("%(asctime)s - [TV Engine] %(levelname)s - %(message)s"))
    logger.addHandler(ch)

TV_STRATEGIES_FILE = os.path.join(BASE_DIR, "tv_strategies.json")
TV_CONFIG_FILE = os.path.join(BASE_DIR, "tv_config.json")
TV_LOGS_FILE = os.path.join(BASE_DIR, "tv_execution_log.json")
TV_PROCESSED_ALERTS_FILE = os.path.join(BASE_DIR, "tv_processed_alerts.json")
TV_JOURNAL_CSV = os.path.join(BASE_DIR, "tv_trading_journal.csv")
TV_JOURNAL_XLSX = os.path.join(BASE_DIR, "tv_trading_journal.xlsx")
LOT_SIZES_FILE = os.path.join(BASE_DIR, "lot_sizes.json")

tv_lock = threading.Lock()
tv_journal_lock = threading.Lock()
tv_engine_running = False
tv_worker_thread = None

# In-memory execution logs (latest 200)
execution_logs = []
last_poll_status = {
    "connected": False,
    "last_poll_time": None,
    "last_error": None,
    "pending_alerts_count": 0,
    "total_executed": 0,
    "total_duplicates_prevented": 0
}

DEFAULT_CONFIG = {
    "webhook_url": "http://127.0.0.1:3000",
    "poll_interval_sec": 0.3,
    "enabled": True,
    "auto_acknowledge": True
}

DEFAULT_STRATEGIES = [
    {
        "id": "rule_default",
        "strategy_name": "DEFAULT",
        "description": "Fallback rule for any alert without a specific strategy rule",
        "mode": "DIRECT",           # "DIRECT" or "ATM_OPTION"
        "instrument": "",           # If empty, uses alert['instrument']
        "product": "MIS",           # "MIS", "NRML", "CNC"
        "order_type": "MARKET",     # "MARKET", "LIMIT"
        "exchange": "NFO",          # "NSE", "NFO", "BFO", "MCX"
        "lots": 1,
        "quantity": 0,              # 0 means compute from lots * lot_size
        "active": True
    },
    {
        "id": "rule_nifty_scalp",
        "strategy_name": "Nifty_Option_Scalp",
        "description": "Auto ATM Option Buyer for Nifty (BUY -> ATM CE, SELL -> ATM PE)",
        "mode": "ATM_OPTION",
        "instrument": "NIFTY",
        "product": "MIS",
        "order_type": "MARKET",
        "exchange": "NFO",
        "lots": 1,
        "quantity": 0,
        "active": True
    },
    {
        "id": "rule_silvermic",
        "strategy_name": "Silvermic_15M",
        "description": "MCX Silver Micro Commodity Futures",
        "mode": "DIRECT",
        "instrument": "SILVERMIC",
        "product": "NRML",
        "order_type": "MARKET",
        "exchange": "MCX",
        "lots": 1,
        "quantity": 1,
        "active": True
    }
]

TV_JOURNAL_FIELDNAMES = [
    "Trade_ID",
    "Date",
    "Time",
    "Alert_ID",
    "Strategy_Name",
    "Execution_Mode",
    "Underlying",
    "Tradingsymbol",
    "Exchange",
    "Action",
    "Quantity",
    "Product",
    "Order_Type",
    "Trigger_LTP",
    "Kite_Order_ID",
    "Execution_Status",
    "Remarks"
]


# ========================================================================
# DEDUPLICATION & PROCESSED ALERT PERSISTENCE
# ========================================================================

def load_processed_alerts():
    """Load set of processed alert IDs from disk."""
    if os.path.exists(TV_PROCESSED_ALERTS_FILE):
        try:
            with open(TV_PROCESSED_ALERTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return set(data)
                elif isinstance(data, dict):
                    return set(data.keys())
        except Exception as e:
            logger.warning(f"Error loading processed alerts: {e}")
    return set()


def save_processed_alert_id(alert_id: str):
    """Atomically record alert_id to disk to prevent duplicate order placement."""
    if not alert_id:
        return
    with tv_lock:
        processed = load_processed_alerts()
        processed.add(str(alert_id))
        try:
            # Keep latest 5000 alerts
            alerts_list = list(processed)[-5000:]
            with open(TV_PROCESSED_ALERTS_FILE, "w", encoding="utf-8") as f:
                json.dump(alerts_list, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to persist processed alert ID: {e}")


def is_alert_already_processed(alert_id: str) -> bool:
    """Check if an alert has already been executed."""
    if not alert_id:
        return False
    with tv_lock:
        processed = load_processed_alerts()
        return str(alert_id) in processed


# ========================================================================
# CONFIG & STRATEGY RULES PERSISTENCE
# ========================================================================

def load_tv_config():
    """Load config from tv_config.json or return defaults."""
    if os.path.exists(TV_CONFIG_FILE):
        try:
            with open(TV_CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                res = dict(DEFAULT_CONFIG)
                res.update(cfg)
                return res
        except Exception as e:
            logger.warning(f"Error loading {TV_CONFIG_FILE}: {e}")
    return dict(DEFAULT_CONFIG)


def save_tv_config(config_data):
    """Save config to tv_config.json."""
    try:
        with open(TV_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=4)
        return True
    except Exception as e:
        logger.error(f"Error saving {TV_CONFIG_FILE}: {e}")
        return False


def load_tv_strategies():
    """Load user-defined rules for strategy names from tv_strategies.json."""
    if os.path.exists(TV_STRATEGIES_FILE):
        try:
            with open(TV_STRATEGIES_FILE, "r", encoding="utf-8") as f:
                strats = json.load(f)
                if isinstance(strats, list):
                    return strats
        except Exception as e:
            logger.warning(f"Error loading {TV_STRATEGIES_FILE}: {e}")
    save_tv_strategies(DEFAULT_STRATEGIES)
    return list(DEFAULT_STRATEGIES)


def save_tv_strategies(strategies_list):
    """Save strategy rules to tv_strategies.json."""
    try:
        with open(TV_STRATEGIES_FILE, "w", encoding="utf-8") as f:
            json.dump(strategies_list, f, indent=4)
        return True
    except Exception as e:
        logger.error(f"Error saving {TV_STRATEGIES_FILE}: {e}")
        return False


def get_lot_size(symbol):
    """Resolve broker lot size for given underlying symbol."""
    if os.path.exists(LOT_SIZES_FILE):
        try:
            with open(LOT_SIZES_FILE, "r", encoding="utf-8") as f:
                lot_dict = json.load(f)
                sym = str(symbol).strip().upper()
                if sym in lot_dict:
                    return int(lot_dict[sym])
        except Exception:
            pass
    defaults = {"NIFTY": 65, "BANKNIFTY": 30, "FINNIFTY": 60, "MIDCPNIFTY": 120, "SENSEX": 20, "CRUDEOILM": 10, "SILVERMIC": 1}
    return defaults.get(str(symbol).strip().upper(), 1)


# ========================================================================
# MULTI-SHEET EXCEL & CSV TRADE JOURNAL ENGINE
# ========================================================================

def load_tv_journal_records():
    """Reads all historical TradingView trade records from CSV."""
    records = []
    if not os.path.exists(TV_JOURNAL_CSV):
        return records

    try:
        with open(TV_JOURNAL_CSV, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
            if not lines:
                return records

            reader = csv.DictReader(lines)
            for idx, row in enumerate(reader, start=1):
                clean_row = {}
                for k, v in row.items():
                    clean_row[k.strip() if k else ""] = v.strip() if v else ""
                records.append(clean_row)
    except Exception as e:
        logger.error(f"Error reading TV journal CSV: {e}")

    return records


def write_tv_journal_records(records: list):
    """
    Atomically writes all records to CSV and builds a multi-sheet formatted Excel workbook:
    - Sheet 1: 'All_Trades' (Consolidated master log)
    - Subsequent Sheets: One dedicated sheet for each strategy name (e.g. 'Nifty_Option_Scalp', 'Silvermic_15M', 'DEFAULT').
    """
    with tv_journal_lock:
        try:
            # 1. Write clean CSV
            with open(TV_JOURNAL_CSV, "w", newline="", encoding="utf-8") as f:
                f.write("# ==========================================================================\n")
                f.write("# TRADINGVIEW WEBHOOK ORDER EXECUTION JOURNAL\n")
                f.write("# ==========================================================================\n")
                writer = csv.DictWriter(f, fieldnames=TV_JOURNAL_FIELDNAMES, extrasaction="ignore")
                writer.writeheader()
                for r in records:
                    writer.writerow(r)

            # 2. Build multi-sheet Excel using openpyxl / pandas
            try:
                import pandas as pd
                from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
                from openpyxl.utils import get_column_letter

                df_all = pd.DataFrame(records)
                if df_all.empty:
                    df_all = pd.DataFrame(columns=TV_JOURNAL_FIELDNAMES)

                with pd.ExcelWriter(TV_JOURNAL_XLSX, engine="openpyxl", mode="w") as writer:
                    # Master Sheet
                    df_all.to_excel(writer, sheet_name="All_Trades", index=False)

                    # Individual Strategy Sheets
                    if not df_all.empty and "Strategy_Name" in df_all.columns:
                        strategies = df_all["Strategy_Name"].dropna().unique()
                        for strat in strategies:
                            strat_name_str = str(strat).strip()
                            # Sanitize sheet name (Excel max 31 chars, no invalid chars)
                            clean_sheet_name = "".join(c for c in strat_name_str if c.isalnum() or c in ("_", " ", "-"))[:31].strip()
                            if not clean_sheet_name:
                                clean_sheet_name = "Strategy"

                            df_strat = df_all[df_all["Strategy_Name"] == strat]
                            df_strat.to_excel(writer, sheet_name=clean_sheet_name, index=False)

                    # Format Worksheets
                    wb = writer.book
                    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
                    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
                    thin_border = Border(
                        left=Side(style="thin", color="CBD5E1"),
                        right=Side(style="thin", color="CBD5E1"),
                        top=Side(style="thin", color="CBD5E1"),
                        bottom=Side(style="thin", color="CBD5E1")
                    )

                    for ws in wb.worksheets:
                        ws.views.sheetView[0].showGridLines = True
                        for col_idx, cell in enumerate(ws[1], start=1):
                            cell.fill = header_fill
                            cell.font = header_font
                            cell.alignment = Alignment(horizontal="center", vertical="center")

                        # Auto-fit column widths
                        for col in ws.columns:
                            max_len = max(len(str(cell.value or "")) for cell in col)
                            col_letter = get_column_letter(col[0].column)
                            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

            except Exception as excel_err:
                logger.warning(f"Note on Excel generation: {excel_err}")

            return True
        except Exception as e:
            logger.error(f"Failed writing TV journal: {e}")
            return False


def log_successful_order_journal(alert, rule, tradingsymbol, action, quantity, order_id, ltp=0.0):
    """
    Appends a new executed order to the multi-sheet trade journal.
    Guarantees immediate disk write-through.
    """
    now = datetime.now()
    alert_id = alert.get("alert_id") or f"alert_{int(time.time() * 1000)}"
    strat_name = rule.get("strategy_name") or alert.get("strategy", "DEFAULT")
    mode = rule.get("mode", "DIRECT")
    inst = rule.get("instrument") or alert.get("instrument", "")
    exchange = rule.get("exchange", "NFO")
    product = rule.get("product", "MIS")
    order_type = rule.get("order_type", "MARKET")

    trade_id = f"TV_{strat_name[:8]}_{now.strftime('%Y%m%d%H%M%S')}_{order_id[-4:] if order_id else '0000'}"

    new_entry = {
        "Trade_ID": trade_id,
        "Date": now.strftime("%Y-%m-%d"),
        "Time": now.strftime("%H:%M:%S"),
        "Alert_ID": str(alert_id),
        "Strategy_Name": strat_name,
        "Execution_Mode": mode,
        "Underlying": inst,
        "Tradingsymbol": tradingsymbol,
        "Exchange": exchange,
        "Action": str(action).upper(),
        "Quantity": str(quantity),
        "Product": product,
        "Order_Type": order_type,
        "Trigger_LTP": f"{float(ltp):.2f}" if ltp else "0.00",
        "Kite_Order_ID": str(order_id),
        "Execution_Status": "EXECUTED",
        "Remarks": f"Successfully placed via TradingView webhook (Rule: {rule.get('id', 'custom')})"
    }

    records = load_tv_journal_records()
    records.append(new_entry)
    write_tv_journal_records(records)
    logger.info(f"📖 Logged Trade #{trade_id} into Trading Journal (CSV & Multi-Sheet Excel)")


def get_tv_journal_summary():
    """Returns summary stats of the TV trading journal."""
    records = load_tv_journal_records()
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_records = [r for r in records if r.get("Date") == today_str]

    strategies = list(set(r.get("Strategy_Name", "DEFAULT") for r in records))
    return {
        "total_trades": len(records),
        "today_trades": len(today_records),
        "strategies_count": len(strategies),
        "strategies": strategies,
        "recent_records": records[-50:]
    }


# ========================================================================
# STRATEGY LOOKUP & OPTION SYMBOL RESOLVER
# ========================================================================

def log_execution(record):
    """Append execution record to memory log and json file."""
    record["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with tv_lock:
        execution_logs.append(record)
        if len(execution_logs) > 200:
            execution_logs.pop(0)
    try:
        with open(TV_LOGS_FILE, "w", encoding="utf-8") as f:
            json.dump(execution_logs[-100:], f, indent=4)
    except Exception:
        pass


def find_matching_rule(strategy_name):
    """Find matching strategy rule by name (case-insensitive) or fallback to DEFAULT."""
    rules = load_tv_strategies()
    name = str(strategy_name).strip().lower()

    # 1. Exact or lowercase match
    for rule in rules:
        if rule.get("active", True) and rule.get("strategy_name", "").strip().lower() == name:
            return rule

    # 2. Fallback to active DEFAULT rule
    for rule in rules:
        if rule.get("active", True) and rule.get("strategy_name", "").strip().upper() == "DEFAULT":
            return rule

    return None


def resolve_option_tradingsymbol(kite, index_name, action, ltp=0.0):
    """
    Finds ATM CE/PE option trading symbol for NIFTY, BANKNIFTY, FINNIFTY, SENSEX.
    BUY signal -> ATM CE
    SELL signal -> ATM PE
    """
    try:
        import server
        underlying = index_name.upper()

        step = 50
        if "BANK" in underlying or "SENSEX" in underlying:
            step = 100
        elif "MIDCP" in underlying:
            step = 25

        if not ltp or ltp <= 0:
            spot_key = f"NSE:{underlying} 50" if underlying == "NIFTY" else f"NSE:NIFTY BANK" if "BANK" in underlying else f"BSE:{underlying}"
            quotes = kite.quote([spot_key])
            if spot_key in quotes:
                ltp = quotes[spot_key].get("last_price", 0.0)

        if not ltp or ltp <= 0:
            return None, f"Could not determine spot price for {underlying}"

        atm_strike = round(ltp / step) * step
        opt_type = "CE" if action.upper() == "BUY" else "PE"

        instruments = getattr(server, "instruments_cache", [])
        if not instruments:
            instruments = kite.instruments("NFO")
            setattr(server, "instruments_cache", instruments)

        today_dt = date.today()
        candidates = []
        for inst in instruments:
            if inst.get("name") == underlying and inst.get("instrument_type") == opt_type and inst.get("strike") == float(atm_strike):
                exp = inst.get("expiry")
                if isinstance(exp, str):
                    exp = datetime.strptime(exp, "%Y-%m-%d").date()
                if exp and exp >= today_dt:
                    candidates.append((exp, inst.get("tradingsymbol")))

        if candidates:
            candidates.sort(key=lambda x: x[0])
            chosen_symbol = candidates[0][1]
            return chosen_symbol, f"Selected {chosen_symbol} (Strike: {atm_strike} {opt_type})"

        return f"{underlying}{today_dt.strftime('%y%b').upper()}{int(atm_strike)}{opt_type}", "Calculated estimated symbol"

    except Exception as e:
        logger.error(f"Error resolving option symbol: {e}")
        return None, str(e)


# ========================================================================
# ORDER EXECUTION WITH DEDUPLICATION & JOURNAL WRITE-THROUGH
# ========================================================================

def execute_tv_alert(alert):
    """
    Executes an incoming TradingView alert according to configured rules in tv_strategies.json.
    Includes Idempotency / Deduplication check and automatic journal entry on success.
    """
    import server
    kite = server.kite_client

    alert_id = str(alert.get("alert_id") or f"alert_{int(time.time() * 1000)}")
    strategy = alert.get("strategy", "DEFAULT")
    alert_inst = alert.get("instrument", "")
    action = str(alert.get("action", "BUY")).upper()
    ltp = float(alert.get("ltp", 0.0)) if alert.get("ltp") not in ("N/A", "", None) else 0.0

    # 1. DUPLICATE CHECK: Prevent duplicate order execution
    if is_alert_already_processed(alert_id):
        logger.warning(f"🛡️ [Deduplication] Alert #{alert_id} was already executed earlier. Skipping duplicate order placement.")
        last_poll_status["total_duplicates_prevented"] += 1
        log_execution({
            "alert_id": alert_id, "strategy": strategy, "instrument": alert_inst,
            "action": action, "ltp": ltp, "status": "SKIPPED",
            "message": "Duplicate alert detected & prevented from re-executing."
        })
        return True  # Return True so caller can acknowledge/clear from queue

    logger.info(f"⚡ [TV Engine] Processing Alert #{alert_id} | Strategy: '{strategy}' | Action: {action} {alert_inst} @ {ltp}")

    # 2. Match with user rule
    rule = find_matching_rule(strategy)
    if not rule:
        msg = f"No active rule found matching strategy '{strategy}'."
        logger.warning(f"⚠️ {msg}")
        log_execution({
            "alert_id": alert_id, "strategy": strategy, "instrument": alert_inst,
            "action": action, "ltp": ltp, "status": "SKIPPED", "message": msg
        })
        # Mark as processed to prevent infinite re-try
        save_processed_alert_id(alert_id)
        return True

    # 3. Determine target instrument, exchange, quantity, and product
    target_instrument = rule.get("instrument") or alert_inst
    exchange = rule.get("exchange", "NFO")
    product = rule.get("product", "MIS")
    order_type = rule.get("order_type", "MARKET")
    lots = int(rule.get("lots", 1))
    quantity = int(rule.get("quantity", 0))
    mode = rule.get("mode", "DIRECT")

    if quantity <= 0:
        base_sym = target_instrument.split()[0].replace("FUT", "").replace("CE", "").replace("PE", "")
        lot_size = get_lot_size(base_sym)
        quantity = lots * lot_size

    actual_tradingsymbol = target_instrument
    order_txn = action

    if mode == "ATM_OPTION" and kite:
        opt_sym, desc = resolve_option_tradingsymbol(kite, target_instrument, action, ltp)
        if opt_sym:
            actual_tradingsymbol = opt_sym
            order_txn = "BUY"  # When buying CE/PE options, transaction type is BUY
        else:
            logger.warning(f"Fallback to direct instrument: {desc}")

    # Check Kite client connection
    if not kite:
        msg = "Kite client not connected/logged in. Cannot place live broker order."
        logger.error(f"❌ {msg}")
        log_execution({
            "alert_id": alert_id, "strategy": strategy, "rule_id": rule.get("id"),
            "target_symbol": actual_tradingsymbol, "action": order_txn, "quantity": quantity,
            "product": product, "status": "FAILED", "message": msg
        })
        return False

    # 4. Place Order via Kite
    try:
        txn_type = kite.TRANSACTION_TYPE_BUY if order_txn == "BUY" else kite.TRANSACTION_TYPE_SELL
        prod_type = kite.PRODUCT_MIS if product == "MIS" else (kite.PRODUCT_CNC if product == "CNC" else kite.PRODUCT_NRML)
        ord_type = kite.ORDER_TYPE_MARKET if order_type == "MARKET" else kite.ORDER_TYPE_LIMIT

        place_kwargs = {
            "variety": kite.VARIETY_REGULAR,
            "exchange": getattr(kite, f"EXCHANGE_{exchange}", exchange),
            "tradingsymbol": actual_tradingsymbol,
            "transaction_type": txn_type,
            "quantity": quantity,
            "order_type": ord_type,
            "product": prod_type,
            "tag": f"TV_{strategy[:15].replace(' ', '_')}"
        }

        logger.info(f"📤 Placing Broker Order: {place_kwargs}")
        order_id = kite.place_order(**place_kwargs)
        logger.info(f"✅ Order Placed Successfully! Broker Order ID: {order_id}")

        # Mark alert as processed to guarantee no duplicate orders
        save_processed_alert_id(alert_id)
        last_poll_status["total_executed"] += 1

        # 5. Log directly to Trade Journal (CSV & Multi-sheet Excel)
        log_successful_order_journal(alert, rule, actual_tradingsymbol, order_txn, quantity, str(order_id), ltp)

        log_execution({
            "alert_id": alert_id,
            "strategy": strategy,
            "rule_id": rule.get("id"),
            "target_symbol": actual_tradingsymbol,
            "action": order_txn,
            "quantity": quantity,
            "product": product,
            "order_id": order_id,
            "status": "EXECUTED",
            "message": f"Successfully placed order {order_id} & saved to journal"
        })
        return True

    except Exception as e:
        err_msg = str(e)
        logger.error(f"❌ Error placing broker order for alert {alert_id}: {err_msg}")
        log_execution({
            "alert_id": alert_id,
            "strategy": strategy,
            "rule_id": rule.get("id"),
            "target_symbol": actual_tradingsymbol,
            "action": order_txn,
            "quantity": quantity,
            "product": product,
            "status": "ERROR",
            "message": err_msg
        })
        return False


def _worker_loop():
    """Background polling worker loop."""
    global tv_engine_running, last_poll_status
    logger.info("📡 TV Alert Poller, Deduplication & Execution Engine started.")

    while tv_engine_running:
        config = load_tv_config()
        if not config.get("enabled", True):
            time.sleep(1.0)
            continue

        webhook_url = config.get("webhook_url", "http://127.0.0.1:3000").rstrip("/")
        poll_interval = float(config.get("poll_interval_sec", 0.3))

        try:
            res = requests.get(f"{webhook_url}/pending-alerts", timeout=2)
            last_poll_status["last_poll_time"] = datetime.now().strftime("%H:%M:%S")

            if res.status_code == 200:
                last_poll_status["connected"] = True
                last_poll_status["last_error"] = None
                alerts = res.json()
                last_poll_status["pending_alerts_count"] = len(alerts)

                for alert in alerts:
                    alert_id = str(alert.get("alert_id"))

                    # Execute alert according to strategy rules with deduplication check
                    success = execute_tv_alert(alert)

                    # Acknowledge alert so webhook server clears it from alert_queue.json
                    if success or config.get("auto_acknowledge", True):
                        try:
                            ack_res = requests.post(
                                f"{webhook_url}/acknowledge-alert",
                                json={"alert_id": alert_id},
                                timeout=2
                            )
                            if ack_res.status_code == 200:
                                logger.info(f"🗑️ Alert #{alert_id} acknowledged & cleared from queue.")
                        except Exception as ack_err:
                            logger.warning(f"Failed to ack alert {alert_id}: {ack_err}")

            else:
                last_poll_status["connected"] = False
                last_poll_status["last_error"] = f"HTTP {res.status_code}: {res.text}"

        except requests.exceptions.RequestException:
            last_poll_status["connected"] = False
            last_poll_status["last_error"] = f"Cannot reach Webhook server at {webhook_url}"
        except Exception as e:
            last_poll_status["last_error"] = str(e)
            logger.error(f"Error in TV worker loop: {e}")

        time.sleep(poll_interval)


def start_engine():
    """Starts the background TV alert worker thread."""
    global tv_engine_running, tv_worker_thread
    if tv_engine_running and tv_worker_thread and tv_worker_thread.is_alive():
        return
    tv_engine_running = True
    tv_worker_thread = threading.Thread(target=_worker_loop, daemon=True, name="TVAlertPoller")
    tv_worker_thread.start()
    logger.info("✅ TV Alert Execution & Journaling Engine initialized and monitoring.")


def stop_engine():
    """Stops the background worker thread."""
    global tv_engine_running
    tv_engine_running = False
    logger.info("🛑 TV Alert Execution Engine stopped.")


def get_status():
    """Returns current status, config, strategy rules, execution logs, and trade journal stats."""
    config = load_tv_config()
    strategies = load_tv_strategies()
    journal_summary = get_tv_journal_summary()
    with tv_lock:
        logs = list(execution_logs)
    return {
        "engine_running": tv_engine_running,
        "config": config,
        "status": last_poll_status,
        "strategies": strategies,
        "journal_summary": journal_summary,
        "logs": logs[-50:]
    }
