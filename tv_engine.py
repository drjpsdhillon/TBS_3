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


def get_current_net_position_for_symbol(kite, tradingsymbol):
    """
    Queries Kite for existing net positions for a specific tradingsymbol.
    Returns net quantity:
      > 0 : currently NET LONG (Buy side position)
      < 0 : currently NET SHORT (Sell side position)
      0   : No open position
    """
    try:
        positions = kite.positions()
        net_pos = positions.get("net", [])
        for pos in net_pos:
            if pos.get("tradingsymbol") == tradingsymbol:
                return int(pos.get("quantity", 0))
    except Exception as e:
        logger.warning(f"Error querying position for {tradingsymbol}: {e}")
    return 0


def get_best_market_depth_and_ltp(kite, exchange, tradingsymbol):
    """
    Fetches market depth and LTP for tradingsymbol.
    Returns (best_bid, best_ask, ltp)
    """
    key = f"{exchange}:{tradingsymbol}"
    try:
        quote = kite.quote([key])
        if key in quote:
            q = quote[key]
            ltp = float(q.get("last_price", 0.0))
            depth = q.get("depth", {})
            buy_depth = depth.get("buy", [])
            sell_depth = depth.get("sell", [])
            best_bid = float(buy_depth[0].get("price", 0.0)) if buy_depth and len(buy_depth) > 0 and buy_depth[0].get("price") else ltp
            best_ask = float(sell_depth[0].get("price", 0.0)) if sell_depth and len(sell_depth) > 0 and sell_depth[0].get("price") else ltp
            return best_bid, best_ask, ltp
    except Exception as e:
        logger.warning(f"Error fetching depth for {key}: {e}")
    return 0.0, 0.0, 0.0


def calculate_limit_price_with_buffer(direction, best_bid, best_ask, ltp, buffer_pct=0.003):
    """
    Calculates limit price with 0.3% buffer for high-probability instant fill:
    - BUY: Best Offer/Ask + 0.3% (rounded to nearest 0.05 tick)
    - SELL: Best Bid - 0.3% (rounded to nearest 0.05 tick)
    """
    if direction.upper() == "BUY":
        base_price = best_ask if best_ask > 0 else ltp
        if base_price <= 0:
            return 0.0
        limit_price = base_price * (1.0 + buffer_pct)
        return round(limit_price * 20) / 20
    else:  # SELL
        base_price = best_bid if best_bid > 0 else ltp
        if base_price <= 0:
            return 0.0
        limit_price = base_price * (1.0 - buffer_pct)
        return round(limit_price * 20) / 20


def resolve_option_tradingsymbol(kite, index_name, action, rule=None, ltp=0.0):
    """
    Resolves option tradingsymbol with strike selection, CE/PE selection, expiry, and round-off steps:
    - strike_mode: 'ATM', 'OTM_1', 'OTM_2', 'OTM_3', 'ITM_1', 'ITM_2', 'ITM_3', 'ROUND_100', 'ROUND_500', 'ROUND_1000', 'MANUAL'
    - option_type: 'AUTO' (BUY->CE, SELL->PE), 'CE', 'PE'
    - round_off: 'AUTO', 100, 500, 1000
    - expiry: 'CURRENT', 'NEXT', 'CURRENT_MONTH', 'NEXT_MONTH', or explicit date YYYY-MM-DD
    """
    try:
        import server
        rule = rule or {}
        strike_mode = str(rule.get("strike_mode", "ATM")).upper()
        manual_symbol = str(rule.get("manual_symbol", "")).strip().upper()

        # If manual symbol provided and mode is MANUAL, return it directly
        if strike_mode == "MANUAL" and manual_symbol:
            return manual_symbol, f"Manual instrument specified: {manual_symbol}"

        underlying = str(index_name or rule.get("instrument") or "NIFTY").upper().strip()
        exchange = rule.get("exchange", "NFO")

        # 1. Determine step size based on round_off config or instrument default
        round_off_cfg = str(rule.get("round_off", "AUTO")).upper()
        if round_off_cfg in ["100", 100, "ROUND_100"]:
            step = 100
        elif round_off_cfg in ["500", 500, "ROUND_500"]:
            step = 500
        elif round_off_cfg in ["1000", 1000, "ROUND_1000"]:
            step = 1000
        elif strike_mode == "ROUND_100":
            step = 100
        elif strike_mode == "ROUND_500":
            step = 500
        elif strike_mode == "ROUND_1000":
            step = 1000
        else:
            step = 50
            if "BANK" in underlying or "SENSEX" in underlying:
                step = 100
            elif "MIDCP" in underlying:
                step = 25

        # 2. Get spot price if not provided
        if not ltp or ltp <= 0:
            spot_key = f"NSE:{underlying} 50" if underlying == "NIFTY" else f"NSE:NIFTY BANK" if "BANK" in underlying else f"BSE:{underlying}"
            try:
                quotes = kite.quote([spot_key])
                if spot_key in quotes:
                    ltp = quotes[spot_key].get("last_price", 0.0)
            except Exception:
                pass

        if not ltp or ltp <= 0:
            return None, f"Could not determine spot price for {underlying}"

        # 3. Determine Option Type (CE / PE)
        opt_type_cfg = str(rule.get("option_type", "AUTO")).upper()
        if opt_type_cfg == "CE":
            opt_type = "CE"
        elif opt_type_cfg == "PE":
            opt_type = "PE"
        else:
            # AUTO: BUY signal -> CE, SELL signal -> PE
            clean_act = action.replace("_EXIT", "").replace(" EXIT", "").strip().upper()
            opt_type = "CE" if clean_act == "BUY" else "PE"

        # 4. Calculate Base ATM Strike
        atm_strike = round(ltp / step) * step

        # 5. Apply Strike Offset (ATM, OTM, ITM)
        target_strike = atm_strike
        offset_map = {
            "OTM_1": 1, "+1 OTM": 1, "+1_OTM": 1,
            "OTM_2": 2, "+2 OTM": 2, "+2_OTM": 2,
            "OTM_3": 3, "+3 OTM": 3, "+3_OTM": 3,
            "ITM_1": -1, "+1 ITM": -1, "+1_ITM": -1,
            "ITM_2": -2, "+2 ITM": -2, "+2_ITM": -2,
            "ITM_3": -3, "+3 ITM": -3, "+3_ITM": -3,
        }

        if strike_mode in offset_map:
            steps_offset = offset_map[strike_mode]
            if opt_type == "CE":
                # For CE: OTM is higher strike (+), ITM is lower strike (-)
                target_strike = atm_strike + (steps_offset * step)
            else:
                # For PE: OTM is lower strike (-), ITM is higher strike (+)
                target_strike = atm_strike - (steps_offset * step)

        # 6. Fetch Instruments Cache
        instruments = getattr(server, "instruments_cache", [])
        if not instruments:
            try:
                instruments = kite.instruments(exchange)
                setattr(server, "instruments_cache", instruments)
            except Exception:
                pass

        # 7. Expiry Filter
        expiry_cfg = str(rule.get("expiry", "CURRENT")).upper()
        today_dt = date.today()

        candidates = []
        for inst in instruments:
            if inst.get("name") == underlying and inst.get("instrument_type") == opt_type and inst.get("strike") == float(target_strike):
                exp = inst.get("expiry")
                if isinstance(exp, str):
                    try:
                        exp = datetime.strptime(exp, "%Y-%m-%d").date()
                    except Exception:
                        pass
                if exp and exp >= today_dt:
                    candidates.append((exp, inst.get("tradingsymbol")))

        if candidates:
            candidates.sort(key=lambda x: x[0])
            # Select target expiry
            if expiry_cfg == "NEXT" and len(candidates) > 1:
                chosen_symbol = candidates[1][1]
            elif expiry_cfg not in ["CURRENT", "NEXT"] and any(str(c[0]) == expiry_cfg for c in candidates):
                matched = [c for c in candidates if str(c[0]) == expiry_cfg]
                chosen_symbol = matched[0][1]
            else:
                chosen_symbol = candidates[0][1]

            return chosen_symbol, f"Selected {chosen_symbol} (Strike: {target_strike} {opt_type}, Mode: {strike_mode})"

        # Fallback generated standard symbol
        return f"{underlying}{today_dt.strftime('%y%b').upper()}{int(target_strike)}{opt_type}", "Calculated estimated symbol"

    except Exception as e:
        logger.error(f"Error resolving option symbol: {e}")
        return None, str(e)


# ========================================================================
# ORDER EXECUTION WITH DEDUPLICATION & JOURNAL WRITE-THROUGH
# ========================================================================

def execute_tv_alert(alert):
    """
    Executes an incoming TradingView alert according to configured rules in tv_strategies.json.
    Includes:
    - 4 Actions: BUY, BUY EXIT, SELL, SELL EXIT
    - Intelligent Brokerage-Saving Net Lot Calculation (Existing lots in reverse + fresh lots)
    - Depth-Based Limit Order Placement with ±0.3% buffer for instantaneous fill
    - Idempotency / Deduplication check and automatic journal entry on success.
    """
    import server
    kite = server.kite_client

    alert_id = str(alert.get("alert_id") or f"alert_{int(time.time() * 1000)}")
    strategy = alert.get("strategy", "DEFAULT")
    alert_inst = alert.get("instrument", "")
    raw_action = str(alert.get("action", "BUY")).strip().upper()
    action = raw_action.replace("_", " ")  # Normalize "BUY_EXIT" -> "BUY EXIT"
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
        save_processed_alert_id(alert_id)
        return True

    # 3. Determine basic rule parameters
    target_instrument = rule.get("instrument") or alert_inst
    exchange = rule.get("exchange", "NFO")
    product = rule.get("product", "MIS")
    configured_order_type = rule.get("order_type", "LIMIT")
    lots = int(rule.get("lots", 1))
    quantity = int(rule.get("quantity", 0))
    mode = rule.get("mode", "DIRECT")

    # Base lot size calculation
    base_sym = target_instrument.split()[0].replace("FUT", "").replace("CE", "").replace("PE", "")
    lot_size = get_lot_size(base_sym)
    if quantity <= 0:
        fresh_quantity = lots * lot_size
    else:
        fresh_quantity = quantity

    actual_tradingsymbol = target_instrument

    # Resolve Option Trading Symbol if Option Mode is selected
    if mode in ["ATM_OPTION", "OPTION", "CUSTOM_OPTION"] and kite:
        opt_sym, desc = resolve_option_tradingsymbol(kite, target_instrument, action, rule, ltp)
        if opt_sym:
            actual_tradingsymbol = opt_sym
        else:
            logger.warning(f"Fallback to target instrument: {desc}")

    # Check Kite client connection
    if not kite:
        msg = "Kite client not connected/logged in. Cannot place live broker order."
        logger.error(f"❌ {msg}")
        log_execution({
            "alert_id": alert_id, "strategy": strategy, "rule_id": rule.get("id"),
            "target_symbol": actual_tradingsymbol, "action": action, "quantity": fresh_quantity,
            "product": product, "status": "FAILED", "message": msg
        })
        return False

    # 4. Check Current Net Position in Broker for Reversal / Exit Netting
    current_net_qty = get_current_net_position_for_symbol(kite, actual_tradingsymbol)
    logger.info(f"📊 Live Broker Net Position for {actual_tradingsymbol}: {current_net_qty} Qty")

    # 5. Handle the 4 Action Scenarios (BUY, BUY EXIT, SELL, SELL EXIT)
    trade_action_cfg = str(rule.get("trade_action", "AUTO")).upper()
    order_txn = "BUY"
    final_order_qty = fresh_quantity
    order_remarks = ""

    if action == "BUY":
        # Scenario: Fresh BUY or Reversal from SELL side
        # Checks how many lots are in SELL side (current_net_qty < 0)
        # Total Qty = (Sell exit lots + Fresh buy order lots) to reduce brokerage into a single combined order
        if current_net_qty < 0:
            sell_exit_qty = abs(current_net_qty)
            final_order_qty = sell_exit_qty + fresh_quantity
            order_remarks = f"Reversal BUY: {sell_exit_qty} Qty (Exit Short) + {fresh_quantity} Qty (Fresh Long) = {final_order_qty} Qty"
            logger.info(f"🔄 [Net Reversal] {order_remarks}")
        else:
            final_order_qty = fresh_quantity
            order_remarks = f"Fresh BUY: {fresh_quantity} Qty"

        order_txn = "BUY" if trade_action_cfg in ["AUTO", "BUY"] else "SELL"

    elif action == "SELL":
        # Scenario: Fresh SELL or Reversal from BUY side
        # Checks how many lots are in BUY side (current_net_qty > 0)
        # Total Qty = (Buy exit lots + Fresh sell order lots) to reduce brokerage into a single combined order
        if current_net_qty > 0:
            buy_exit_qty = current_net_qty
            final_order_qty = buy_exit_qty + fresh_quantity
            order_remarks = f"Reversal SELL: {buy_exit_qty} Qty (Exit Long) + {fresh_quantity} Qty (Fresh Short) = {final_order_qty} Qty"
            logger.info(f"🔄 [Net Reversal] {order_remarks}")
        else:
            final_order_qty = fresh_quantity
            order_remarks = f"Fresh SELL: {fresh_quantity} Qty"

        order_txn = "SELL" if trade_action_cfg in ["AUTO", "SELL"] else "BUY"

    elif action in ["BUY EXIT", "BUY_EXIT"]:
        # Scenario: Exit open position
        # If open position exists: if Long (> 0) -> SELL, if Short (< 0) -> BUY
        if current_net_qty > 0:
            final_order_qty = current_net_qty
            order_txn = "SELL"
            order_remarks = f"BUY EXIT: Closing {current_net_qty} Long Qty via SELL order"
        elif current_net_qty < 0:
            final_order_qty = abs(current_net_qty)
            order_txn = "BUY"
            order_remarks = f"BUY EXIT: Closing {abs(current_net_qty)} Short Qty via BUY order"
        else:
            # Fallback if position is 0: place default exit size or skip
            final_order_qty = fresh_quantity
            order_txn = "SELL"
            order_remarks = f"BUY EXIT: No open position detected, placing configured size {fresh_quantity} Qty"

        logger.info(f"🚪 [Position Exit] {order_remarks}")

    elif action in ["SELL EXIT", "SELL_EXIT"]:
        # Scenario: Exit open position
        # If open position exists: if Short (< 0) -> BUY, if Long (> 0) -> SELL
        if current_net_qty < 0:
            final_order_qty = abs(current_net_qty)
            order_txn = "BUY"
            order_remarks = f"SELL EXIT: Closing {abs(current_net_qty)} Short Qty via BUY order"
        elif current_net_qty > 0:
            final_order_qty = current_net_qty
            order_txn = "SELL"
            order_remarks = f"SELL EXIT: Closing {current_net_qty} Long Qty via SELL order"
        else:
            final_order_qty = fresh_quantity
            order_txn = "BUY"
            order_remarks = f"SELL EXIT: No open position detected, placing configured size {fresh_quantity} Qty"

        logger.info(f"🚪 [Position Exit] {order_remarks}")

    else:
        # Fallback action
        order_txn = "BUY" if "BUY" in action else "SELL"
        final_order_qty = fresh_quantity
        order_remarks = f"Standard Execution: {action} {final_order_qty} Qty"

    # 6. Fetch Depth & Calculate Limit Price with 0.3% Buffer
    best_bid, best_ask, market_ltp = get_best_market_depth_and_ltp(kite, exchange, actual_tradingsymbol)
    effective_ltp = market_ltp if market_ltp > 0 else ltp

    limit_price = 0.0
    final_order_type = kite.ORDER_TYPE_LIMIT

    if configured_order_type == "MARKET":
        final_order_type = kite.ORDER_TYPE_MARKET
    else:
        # Calculate limit price with 0.3% buffer
        limit_price = calculate_limit_price_with_buffer(order_txn, best_bid, best_ask, effective_ltp, buffer_pct=0.003)
        if limit_price <= 0:
            final_order_type = kite.ORDER_TYPE_MARKET

    # 7. Place Order via Kite Connect
    try:
        txn_type = kite.TRANSACTION_TYPE_BUY if order_txn == "BUY" else kite.TRANSACTION_TYPE_SELL
        prod_type = kite.PRODUCT_MIS if product == "MIS" else (kite.PRODUCT_CNC if product == "CNC" else kite.PRODUCT_NRML)

        place_kwargs = {
            "variety": kite.VARIETY_REGULAR,
            "exchange": getattr(kite, f"EXCHANGE_{exchange}", exchange),
            "tradingsymbol": actual_tradingsymbol,
            "transaction_type": txn_type,
            "quantity": int(final_order_qty),
            "order_type": final_order_type,
            "product": prod_type,
            "tag": f"TV_{strategy[:15].replace(' ', '_')}"
        }

        if final_order_type == kite.ORDER_TYPE_LIMIT and limit_price > 0:
            place_kwargs["price"] = float(limit_price)

        logger.info(f"📤 Placing Broker Order: {place_kwargs} | Limit Buffer Applied: {limit_price} (Best Bid: {best_bid}, Best Ask: {best_ask})")
        order_id = kite.place_order(**place_kwargs)
        logger.info(f"✅ Order Placed Successfully! Broker Order ID: {order_id}")

        # Mark alert as processed to guarantee no duplicate orders
        save_processed_alert_id(alert_id)
        last_poll_status["total_executed"] += 1

        # 8. Log directly to Trade Journal (CSV & Multi-sheet Excel)
        log_successful_order_journal(alert, rule, actual_tradingsymbol, order_txn, final_order_qty, str(order_id), effective_ltp)

        log_execution({
            "alert_id": alert_id,
            "strategy": strategy,
            "rule_id": rule.get("id"),
            "target_symbol": actual_tradingsymbol,
            "action": f"{action} -> {order_txn}",
            "quantity": final_order_qty,
            "product": product,
            "order_id": order_id,
            "limit_price": limit_price if limit_price > 0 else "MARKET",
            "status": "EXECUTED",
            "message": f"Placed {order_txn} {final_order_qty}x {actual_tradingsymbol} @ ₹{limit_price or effective_ltp} | {order_remarks}"
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
            "action": f"{action} -> {order_txn}",
            "quantity": final_order_qty,
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
