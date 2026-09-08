"""
tv_engine.py — TradingView Alert Poller & Multi-Strategy Order Executor for Zerodha Kite Connect

Connects TBS_3 to the Webhook receiver app (over localhost, SSH reverse tunnel, or Cloudflare).
Fetches pending TradingView alerts from alert_queue.json via HTTP GET /pending-alerts,
maps the strategy name against user-defined rules in tv_strategies.json, executes orders via Kite,
and sends POST /acknowledge-alert to clear processed alerts.
"""

import os
import sys
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
LOT_SIZES_FILE = os.path.join(BASE_DIR, "lot_sizes.json")

tv_lock = threading.Lock()
tv_engine_running = False
tv_worker_thread = None

# In-memory execution logs (latest 100)
execution_logs = []
last_poll_status = {
    "connected": False,
    "last_poll_time": None,
    "last_error": None,
    "pending_alerts_count": 0,
    "total_executed": 0
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


def load_tv_config():
    """Load config from tv_config.json or return defaults."""
    if os.path.exists(TV_CONFIG_FILE):
        try:
            with open(TV_CONFIG_FILE, "r") as f:
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
        with open(TV_CONFIG_FILE, "w") as f:
            json.dump(config_data, f, indent=4)
        return True
    except Exception as e:
        logger.error(f"Error saving {TV_CONFIG_FILE}: {e}")
        return False


def load_tv_strategies():
    """Load user-defined rules for strategy names from tv_strategies.json."""
    if os.path.exists(TV_STRATEGIES_FILE):
        try:
            with open(TV_STRATEGIES_FILE, "r") as f:
                strats = json.load(f)
                if isinstance(strats, list):
                    return strats
        except Exception as e:
            logger.warning(f"Error loading {TV_STRATEGIES_FILE}: {e}")
    # Write default if not found
    save_tv_strategies(DEFAULT_STRATEGIES)
    return list(DEFAULT_STRATEGIES)


def save_tv_strategies(strategies_list):
    """Save strategy rules to tv_strategies.json."""
    try:
        with open(TV_STRATEGIES_FILE, "w") as f:
            json.dump(strategies_list, f, indent=4)
        return True
    except Exception as e:
        logger.error(f"Error saving {TV_STRATEGIES_FILE}: {e}")
        return False


def get_lot_size(symbol):
    """Resolve broker lot size for given underlying symbol."""
    if os.path.exists(LOT_SIZES_FILE):
        try:
            with open(LOT_SIZES_FILE, "r") as f:
                lot_dict = json.load(f)
                sym = str(symbol).strip().upper()
                if sym in lot_dict:
                    return int(lot_dict[sym])
        except Exception:
            pass
    # Fallbacks
    defaults = {"NIFTY": 65, "BANKNIFTY": 30, "FINNIFTY": 25, "MIDCPNIFTY": 50, "SENSEX": 10, "CRUDEOILM": 10, "SILVERMIC": 1}
    return defaults.get(str(symbol).strip().upper(), 1)


def log_execution(record):
    """Append execution record to memory log and json file."""
    record["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with tv_lock:
        execution_logs.append(record)
        if len(execution_logs) > 200:
            execution_logs.pop(0)
    try:
        with open(TV_LOGS_FILE, "w") as f:
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
        
        # Strike step
        step = 50
        if "BANK" in underlying:
            step = 100
        elif "SENSEX" in underlying:
            step = 100
        elif "MIDCP" in underlying:
            step = 25
            
        # Get spot LTP if not provided
        if not ltp or ltp <= 0:
            spot_key = f"NSE:{underlying} 50" if underlying == "NIFTY" else f"NSE:NIFTY BANK" if "BANK" in underlying else f"BSE:{underlying}"
            quotes = kite.quote([spot_key])
            if spot_key in quotes:
                ltp = quotes[spot_key].get("last_price", 0.0)
                
        if not ltp or ltp <= 0:
            return None, f"Could not determine spot price for {underlying}"

        atm_strike = round(ltp / step) * step
        opt_type = "CE" if action.upper() == "BUY" else "PE"
        
        # Look up weekly expiry instruments from server cache
        instruments = getattr(server, "instruments_cache", [])
        if not instruments:
            # Fetch NFO instruments if empty
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


def execute_tv_alert(alert):
    """
    Executes an incoming TradingView alert according to configured rules in tv_strategies.json.
    """
    import server
    kite = server.kite_client
    
    alert_id = alert.get("alert_id") or f"alert_{int(time.time()*1000)}"
    strategy = alert.get("strategy", "DEFAULT")
    alert_inst = alert.get("instrument", "")
    action = str(alert.get("action", "BUY")).upper()
    ltp = float(alert.get("ltp", 0.0)) if alert.get("ltp") not in ("N/A", "", None) else 0.0
    
    logger.info(f"⚡ [TV Engine] Received Alert #{alert_id} | Strategy: '{strategy}' | Action: {action} {alert_inst} @ {ltp}")
    
    # 1. Match with user rule
    rule = find_matching_rule(strategy)
    if not rule:
        msg = f"No active rule found matching strategy '{strategy}'."
        logger.warning(f"⚠️ {msg}")
        log_execution({
            "alert_id": alert_id, "strategy": strategy, "instrument": alert_inst,
            "action": action, "ltp": ltp, "status": "SKIPPED", "message": msg
        })
        return True  # Acknowledge to avoid poison queue loop

    # 2. Determine target instrument, exchange, and quantity
    target_instrument = rule.get("instrument") or alert_inst
    exchange = rule.get("exchange", "NFO")
    product = rule.get("product", "MIS")
    order_type = rule.get("order_type", "MARKET")
    lots = int(rule.get("lots", 1))
    quantity = int(rule.get("quantity", 0))
    mode = rule.get("mode", "DIRECT")

    # If quantity is not explicitly set, compute from lots * lot_size
    if quantity <= 0:
        base_sym = target_instrument.split()[0].replace("FUT", "").replace("CE", "").replace("PE", "")
        lot_size = get_lot_size(base_sym)
        quantity = lots * lot_size

    # Handle ATM option calculation
    actual_tradingsymbol = target_instrument
    order_txn = "BUY"
    
    if mode == "ATM_OPTION" and kite:
        opt_sym, desc = resolve_option_tradingsymbol(kite, target_instrument, action, ltp)
        if opt_sym:
            actual_tradingsymbol = opt_sym
            order_txn = "BUY"  # When buying CE/PE options, transaction type is BUY
        else:
            logger.warning(f"Fallback to direct instrument: {desc}")
    else:
        order_txn = action

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

    # 3. Place Order via Kite
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
        logger.info(f"✅ Order Placed! Broker Order ID: {order_id}")

        last_poll_status["total_executed"] += 1
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
            "message": f"Successfully placed order {order_id}"
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
    logger.info("📡 TV Alert Poller & Execution Engine started.")

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
                    alert_id = alert.get("alert_id")
                    
                    # Execute alert according to strategy rules
                    success = execute_tv_alert(alert)

                    # Acknowledge alert if successful or configured to auto-ack
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

        except requests.exceptions.RequestException as req_err:
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
    logger.info("✅ TV Alert Execution Engine initialized and monitoring.")


def stop_engine():
    """Stops the background worker thread."""
    global tv_engine_running
    tv_engine_running = False
    logger.info("🛑 TV Alert Execution Engine stopped.")


def get_status():
    """Returns current status, config, strategy rules, and execution logs."""
    config = load_tv_config()
    strategies = load_tv_strategies()
    with tv_lock:
        logs = list(execution_logs)
    return {
        "engine_running": tv_engine_running,
        "config": config,
        "status": last_poll_status,
        "strategies": strategies,
        "logs": logs[-50:]
    }
