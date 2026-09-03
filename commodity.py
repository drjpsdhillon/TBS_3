"""
commodity.py — Multi-Strategy MCX Commodity Options & Futures Engine for Zerodha Kite Connect

Features:
- Trading in MCX Options (Straddle, Strangle, Single Leg CE, Single Leg PE) and MCX Futures (BUY / SELL)
- Supported Underlyings: CRUDEOIL, NATURALGAS, GOLD, GOLDM, SILVER, SILVERM, SILVERMIC, COPPER, ZINC, LEAD, ALUMINIUM, etc.
- Time-based execution (e.g. 09:15 to 23:15/23:25) tracking orders until MCX market closes (23:30 / 23:55)
- Automated strike selection (ATM, Target Premium, Strike Offset, or Exact Strike)
- Stop-Loss & Target Profit monitoring (Points or Percentage)
- Trailing Stop Loss (TSL) with dynamic trailing
- Re-entry / Re-execute mechanisms on SL hit
- Dedicated separate trading journal in commodity_PnL.csv and commodity_PnL.xlsx
- Thread-safe background monitoring daemon running continuously through MCX market hours
"""

import os
import sys
import json
import logging
import time
import threading
import re
from datetime import datetime, date, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "pykiteconnect"))
from kiteconnect import KiteConnect
import trade_journal

logger = logging.getLogger("commodity")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("%(asctime)s - [Commodity] %(levelname)s - %(message)s"))
    logger.addHandler(ch)

COMMODITY_STRATEGIES_FILE = os.path.join(BASE_DIR, "commodity_strategies.json")
CREDENTIALS_FILE = os.path.join(BASE_DIR, "credentials.json")
CACHE_FILE = os.path.join(BASE_DIR, "session_cache.json")
COMMODITY_PNL_CSV = os.path.join(BASE_DIR, "commodity_PnL.csv")
COMMODITY_PNL_XLSX = os.path.join(BASE_DIR, "commodity_PnL.xlsx")
LOT_SIZES_FILE = os.path.join(BASE_DIR, "lot_sizes.json")
PENDING_COMMODITY_ORDERS_FILE = os.path.join(BASE_DIR, "pending_commodity_orders.json")

# Default MCX Lot Sizes
DEFAULT_COMMODITY_LOT_SIZES = {
    "CRUDEOIL": 100,
    "CRUDEOILM": 10,
    "NATURALGAS": 1250,
    "NATGASMINI": 250,
    "GOLD": 100,
    "GOLDM": 10,
    "GOLDPETAL": 1,
    "GOLDGUINEA": 8,
    "SILVER": 30,
    "SILVERM": 5,
    "SILVERMIC": 1,
    "COPPER": 2500,
    "ZINC": 5000,
    "LEAD": 5000,
    "ALUMINIUM": 5000,
    "NICKEL": 1500
}

# Global in-memory cache for MCX instruments & expiries
mcx_instruments_cache = []
mcx_instruments_by_name = {}
mcx_expiries_cache = {}
last_mcx_inst_fetch_time = 0.0

# Global lock for thread safety
commodity_lock = threading.Lock()
commodity_strategies_store = []
commodity_logs = []
MAX_COMMODITY_LOGS = 300


def log_commodity(msg):
    """Logs message to commodity log and in-memory log buffer."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{ts}] {msg}"
    logger.info(msg)
    with commodity_lock:
        commodity_logs.append(entry)
        if len(commodity_logs) > MAX_COMMODITY_LOGS:
            commodity_logs.pop(0)


def get_commodity_lot_size(commodity_name):
    """Retrieve MCX lot size from persistent broker cache file or defaults."""
    if not commodity_name:
        return 100
    name = str(commodity_name).strip().upper()
    if os.path.exists(LOT_SIZES_FILE):
        try:
            with open(LOT_SIZES_FILE, "r") as f:
                saved = json.load(f)
                if isinstance(saved, dict) and name in saved:
                    return int(saved[name])
        except Exception:
            pass
    return int(DEFAULT_COMMODITY_LOT_SIZES.get(name, 100))

_kite_instance = None

def set_kite_client(kc):
    """Sets authenticated KiteConnect instance passed from server/launcher."""
    global _kite_instance
    if kc:
        _kite_instance = kc

def get_kite_client():
    """Builds or returns authenticated KiteConnect instance."""
    global _kite_instance
    if _kite_instance:
        return _kite_instance

    if not os.path.exists(CACHE_FILE) or not os.path.exists(CREDENTIALS_FILE):
        return None
    try:
        with open(CACHE_FILE, "r") as f:
            cdata = json.load(f)
        token = cdata.get("access_token")
        cdate = cdata.get("date")
        if not token or cdate != datetime.today().strftime("%Y-%m-%d"):
            return None
        with open(CREDENTIALS_FILE, "r") as f:
            creds = json.load(f)
        api_key = creds.get("api_key")
        if not api_key:
            return None
        kc = KiteConnect(api_key=api_key)
        kc.set_access_token(token)
        _kite_instance = kc
        return kc
    except Exception as e:
        logger.error(f"Error initializing Kite client for Commodity: {e}")
        return None


def load_pending_commodity_orders():
    """Loads local persistent record of pending commodity orders."""
    if not os.path.exists(PENDING_COMMODITY_ORDERS_FILE):
        return {}
    try:
        with open(PENDING_COMMODITY_ORDERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.error(f"Error loading {PENDING_COMMODITY_ORDERS_FILE}: {e}")
        return {}


def save_pending_commodity_orders(orders):
    """Saves local persistent record of pending commodity orders atomically."""
    try:
        tmp = f"{PENDING_COMMODITY_ORDERS_FILE}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(orders, f, indent=4)
        os.replace(tmp, PENDING_COMMODITY_ORDERS_FILE)
    except Exception as e:
        logger.error(f"Error saving {PENDING_COMMODITY_ORDERS_FILE}: {e}")


def upsert_pending_commodity_order(key, order_info):
    """Upserts single pending order record."""
    with commodity_lock:
        orders = load_pending_commodity_orders()
        order_info["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        orders[key] = order_info
        save_pending_commodity_orders(orders)


def remove_pending_commodity_order(key):
    """Removes pending order record."""
    with commodity_lock:
        orders = load_pending_commodity_orders()
        if key in orders:
            del orders[key]
            save_pending_commodity_orders(orders)


def load_commodity_strategies():
    """Loads commodity strategies list from commodity_strategies.json."""
    if not os.path.exists(COMMODITY_STRATEGIES_FILE):
        default_strats = []
        save_commodity_strategies(default_strats)
        return default_strats
    try:
        with open(COMMODITY_STRATEGIES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as e:
        logger.error(f"Error loading {COMMODITY_STRATEGIES_FILE}: {e}")
        return []


def save_commodity_strategies(strats):
    """Saves commodity strategies list to commodity_strategies.json atomically."""
    try:
        tmp = f"{COMMODITY_STRATEGIES_FILE}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(strats, f, indent=4)
        os.replace(tmp, COMMODITY_STRATEGIES_FILE)
    except Exception as e:
        logger.error(f"Error saving {COMMODITY_STRATEGIES_FILE}: {e}")


# ============================================================================
# MCX INSTRUMENTS & EXPIRY RESOLUTION
# ============================================================================

def fetch_mcx_instruments(force_refresh=False):
    """Fetches and caches all MCX Futures & Options instruments from Kite Connect."""
    global mcx_instruments_cache, mcx_instruments_by_name, mcx_expiries_cache, last_mcx_inst_fetch_time
    now = time.time()
    if mcx_instruments_cache and not force_refresh and (now - last_mcx_inst_fetch_time < 3600):
        return mcx_instruments_cache

    kite = get_kite_client()
    if not kite:
        return mcx_instruments_cache

    try:
        logger.info("Fetching fresh MCX instruments dump from Kite...")
        all_mcx = kite.instruments("MCX")
        if not all_mcx:
            return mcx_instruments_cache

        mcx_instruments_cache = all_mcx
        last_mcx_inst_fetch_time = now
        logger.info(f"Loaded {len(all_mcx)} MCX instruments from Kite.")
        return mcx_instruments_cache
    except Exception as e:
        logger.error(f"Failed to fetch MCX instruments: {e}")
        return mcx_instruments_cache


def get_instruments_for_commodity(commodity_name):
    """Filters all MCX instruments matching a specific commodity name or mini/micro variant."""
    all_insts = fetch_mcx_instruments()
    name = str(commodity_name or "CRUDEOIL").strip().upper()
    if not all_insts:
        return []

    matched = []
    for inst in all_insts:
        sym = str(inst.get("tradingsymbol", "")).upper()
        iname = str(inst.get("name", "")).upper()

        if name in ("CRUDEOILM", "NATGASMINI", "GOLDM", "GOLDPETAL", "SILVERM", "SILVERMIC"):
            if iname == name or sym.startswith(name):
                matched.append(inst)
        elif name == "CRUDEOIL":
            if (iname == "CRUDEOIL" or sym.startswith("CRUDEOIL")) and not sym.startswith("CRUDEOILM"):
                matched.append(inst)
        elif name == "NATURALGAS":
            if (iname == "NATURALGAS" or sym.startswith("NATURALGAS")) and not sym.startswith("NATGASMINI"):
                matched.append(inst)
        elif name == "GOLD":
            if (iname == "GOLD" or sym.startswith("GOLD")) and not (sym.startswith("GOLDM") or sym.startswith("GOLDPETAL") or sym.startswith("GOLDGUINEA")):
                matched.append(inst)
        elif name == "SILVER":
            if (iname == "SILVER" or sym.startswith("SILVER")) and not (sym.startswith("SILVERM") or sym.startswith("SILVERMIC")):
                matched.append(inst)
        else:
            if iname == name or sym.startswith(name):
                matched.append(inst)

    return matched


def get_commodity_expiries(commodity_name):
    """Returns sorted list of available expiry dates (YYYY-MM-DD) for a commodity."""
    insts = get_instruments_for_commodity(commodity_name)
    today_date = date.today()
    exp_set = set()

    for inst in insts:
        exp = inst.get("expiry")
        if exp:
            exp_date = exp if isinstance(exp, date) else datetime.strptime(str(exp)[:10], "%Y-%m-%d").date()
            if exp_date >= today_date:
                exp_set.add(exp_date.strftime("%Y-%m-%d"))

    return sorted(list(exp_set))


def get_commodity_options_chain(commodity_name, expiry_str=None):
    """
    Returns list of strikes with their CE & PE trading symbols for options strike selection.
    """
    insts = get_instruments_for_commodity(commodity_name)
    if not insts:
        return [], None

    today_date = date.today()
    valid_opts = []
    for inst in insts:
        itype = str(inst.get("instrument_type", "")).upper()
        if itype not in ("CE", "PE"):
            continue
        exp = inst.get("expiry")
        if not exp:
            continue
        exp_date = exp if isinstance(exp, date) else datetime.strptime(str(exp)[:10], "%Y-%m-%d").date()
        if exp_date < today_date:
            continue
        valid_opts.append((exp_date, float(inst.get("strike", 0.0) or 0.0), itype, inst.get("tradingsymbol")))

    if not valid_opts:
        return [], None

    if expiry_str and str(expiry_str).strip().upper() not in ("CURRENT", "NEAREST", "--", ""):
        chosen_exp_str = str(expiry_str).strip()
    else:
        nearest_exp = min(v[0] for v in valid_opts)
        chosen_exp_str = nearest_exp.strftime("%Y-%m-%d")

    exp_opts = [v for v in valid_opts if v[0].strftime("%Y-%m-%d") == chosen_exp_str]
    strikes_map = {}
    for _, strike, itype, sym in exp_opts:
        if strike not in strikes_map:
            strikes_map[strike] = {"strike": strike, "CE": None, "PE": None}
        strikes_map[strike][itype] = sym

    chain = sorted(strikes_map.values(), key=lambda x: x["strike"])
    return chain, chosen_exp_str


def resolve_commodity_futures_symbol(commodity_name, expiry_str=None):
    """
    Finds the active MCX Futures tradingsymbol for the specified commodity & expiry.
    If expiry_str is empty or 'CURRENT'/'NEAREST', picks the nearest active expiry.
    """
    insts = get_instruments_for_commodity(commodity_name)
    fut_insts = [i for i in insts if str(i.get("instrument_type", "")).upper() in ("FUT", "FUTCOM")]
    if not fut_insts:
        return None, None

    today_date = date.today()
    valid_futs = []
    for inst in fut_insts:
        exp = inst.get("expiry")
        if exp:
            exp_date = exp if isinstance(exp, date) else datetime.strptime(str(exp)[:10], "%Y-%m-%d").date()
            if exp_date >= today_date:
                valid_futs.append((exp_date, inst))

    valid_futs.sort(key=lambda x: x[0])
    if not valid_futs:
        return None, None

    if not expiry_str or str(expiry_str).strip().upper() in ("CURRENT", "NEAREST", "NEXT", "--", ""):
        target_inst = valid_futs[0][1]
        return target_inst.get("tradingsymbol"), valid_futs[0][0].strftime("%Y-%m-%d")

    target_exp = str(expiry_str).strip()
    for exp_date, inst in valid_futs:
        if exp_date.strftime("%Y-%m-%d") == target_exp:
            return inst.get("tradingsymbol"), target_exp

    return valid_futs[0][1].get("tradingsymbol"), valid_futs[0][0].strftime("%Y-%m-%d")


def resolve_commodity_option_symbol(commodity_name, expiry_str, strike_price, option_type):
    """
    Finds the active MCX Option tradingsymbol (CE/PE) for the specified commodity, expiry, and strike.
    """
    insts = get_instruments_for_commodity(commodity_name)
    opt_type = str(option_type).upper().strip()
    strike = float(strike_price)

    today_date = date.today()
    exp_target = None
    if expiry_str and str(expiry_str).strip().upper() not in ("CURRENT", "NEAREST", "NEXT", "--", ""):
        exp_target = str(expiry_str).strip()

    valid_opts = []
    for inst in insts:
        itype = str(inst.get("instrument_type", "")).upper()
        if itype != opt_type:
            continue
        exp = inst.get("expiry")
        if not exp:
            continue
        exp_date = exp if isinstance(exp, date) else datetime.strptime(str(exp)[:10], "%Y-%m-%d").date()
        if exp_date < today_date:
            continue
        istrike = float(inst.get("strike", 0.0) or 0.0)
        valid_opts.append((exp_date, istrike, inst))

    if not valid_opts:
        return None

    if exp_target:
        matched_by_exp = [v for v in valid_opts if v[0].strftime("%Y-%m-%d") == exp_target]
    else:
        nearest_exp = min(v[0] for v in valid_opts)
        matched_by_exp = [v for v in valid_opts if v[0] == nearest_exp]

    if not matched_by_exp:
        return None

    closest = min(matched_by_exp, key=lambda x: abs(x[1] - strike))
    return closest[2].get("tradingsymbol")


# ============================================================================
# TRADE JOURNALING
# ============================================================================

def record_commodity_trade_entry(strat):
    """Logs entries for all active legs in a commodity strategy into commodity_PnL.csv."""
    orders = strat.get("orders", {})
    sname = strat.get("name", "Commodity Strategy")
    instrument = strat.get("commodity_name", "CRUDEOIL")
    lot_sz = get_commodity_lot_size(instrument)
    qty = int(strat.get("quantity") or lot_sz)

    for leg_key in ["FUT", "CE", "PE"]:
        leg_data = orders.get(leg_key)
        if leg_data and leg_data.get("symbol") and leg_data.get("status") in ("ENTERED", "ACTIVE"):
            trade_id = leg_data.get("trade_id")
            act_p = float(leg_data.get("entry_price", 0.0))
            exp_p = float(leg_data.get("first_entry_price", act_p) or act_p)
            action = leg_data.get("action") or strat.get("entry_action", "SELL")

            tid = trade_journal.log_trade_entry(
                strategy_type="COMMODITY",
                strategy_name=sname,
                instrument=instrument,
                leg=leg_key,
                symbol=leg_data.get("symbol"),
                action=action,
                lot_size=qty,
                expected_entry_price=exp_p,
                actual_entry_price=act_p,
                trade_id=trade_id
            )
            leg_data["trade_id"] = tid


def record_commodity_trade_exit(strat, leg_key, actual_exit_price, reason="EXIT"):
    """Logs exit for a specific commodity strategy leg in commodity_PnL.csv."""
    orders = strat.get("orders", {})
    leg_data = orders.get(leg_key)
    if not leg_data:
        return
    tid = leg_data.get("trade_id")
    if not tid:
        return
    exp_exit = float(leg_data.get("current_sl_trigger", actual_exit_price) or actual_exit_price)
    trade_journal.log_trade_exit(
        strategy_type="COMMODITY",
        trade_id=tid,
        expected_exit_price=exp_exit,
        actual_exit_price=float(actual_exit_price),
        exit_reason=reason
    )


# ============================================================================
# ORDER EXECUTION & SQUARING OFF
# ============================================================================

def place_commodity_order(kite, sym, action, qty, product="MIS", tag="comm"):
    """
    Places marketable limit order for MCX commodity (-1% for SELL, +1% for BUY) for immediate fills.
    """
    action_upper = str(action).upper()
    entry_txn = kite.TRANSACTION_TYPE_SELL if action_upper == "SELL" else kite.TRANSACTION_TYPE_BUY

    best_bid = 0.0
    best_ask = 0.0
    last_ltp = 0.0

    try:
        qres = kite.quote([f"MCX:{sym}"])
        inst_q = qres.get(f"MCX:{sym}", {})
        last_ltp = float(inst_q.get("last_price", 0.0) or 0.0)
        depth_bids = inst_q.get("depth", {}).get("buy", [])
        if depth_bids and depth_bids[0].get("price", 0) > 0:
            best_bid = float(depth_bids[0]["price"])
        depth_asks = inst_q.get("depth", {}).get("sell", [])
        if depth_asks and depth_asks[0].get("price", 0) > 0:
            best_ask = float(depth_asks[0]["price"])
    except Exception as e:
        logger.warning(f"Quote query for {sym} notice: {e}")
        try:
            q = kite.ltp([f"MCX:{sym}"])
            last_ltp = float(q.get(f"MCX:{sym}", {}).get("last_price", 0.0) or 0.0)
        except Exception:
            last_ltp = 100.0

    if last_ltp <= 0:
        last_ltp = 100.0

    if action_upper == "SELL":
        base_p = best_bid if best_bid > 0 else last_ltp
        order_price = round((base_p * 0.99) * 20) / 20
    else:
        base_p = best_ask if best_ask > 0 else last_ltp
        order_price = round((base_p * 1.01) * 20) / 20

    pos_tag = f"{tag}"[:20]
    place_kwargs = {
        "variety": kite.VARIETY_REGULAR,
        "exchange": "MCX",
        "tradingsymbol": sym,
        "transaction_type": entry_txn,
        "quantity": int(qty),
        "product": str(product).upper(),
        "order_type": kite.ORDER_TYPE_LIMIT,
        "price": float(order_price),
        "tag": pos_tag
    }

    oid = kite.place_order(**place_kwargs)
    return oid, last_ltp, order_price


def squareoff_commodity_strategy(strat, reason="Manual Squareoff"):
    """
    Squares off all active legs of a commodity strategy.
    """
    global commodity_strategies_store
    kite = get_kite_client()
    sname = strat.get("name", "Commodity Strategy")
    orders = strat.get("orders", {})

    if not kite:
        log_commodity(f"[{sname}] Cannot square off: Kite not logged in.")
        return False, "Not logged in"

    log_commodity(f"[{sname}] ⚡ SQUARING OFF ALL LEGS ({reason})...")
    product = strat.get("product", "MIS").upper()
    tag = strat.get("run_tag") or "comm_exit"

    for leg_key in ["FUT", "CE", "PE"]:
        leg_data = orders.get(leg_key)
        if leg_data and leg_data.get("symbol") and leg_data.get("status") in ("ENTERED", "ACTIVE"):
            sym = leg_data.get("symbol")
            qty = int(leg_data.get("quantity") or strat.get("quantity") or 100)
            entry_act = leg_data.get("action") or strat.get("entry_action", "SELL")
            exit_txn = kite.TRANSACTION_TYPE_BUY if entry_act == "SELL" else kite.TRANSACTION_TYPE_SELL
            curr_ltp = float(leg_data.get("current_ltp", 0.0))

            try:
                oid = kite.place_order(
                    variety=kite.VARIETY_REGULAR,
                    exchange="MCX",
                    tradingsymbol=sym,
                    transaction_type=exit_txn,
                    quantity=qty,
                    product=product,
                    order_type=kite.ORDER_TYPE_MARKET,
                    tag=tag[:20]
                )
                leg_data["status"] = "SQUARED_OFF"
                leg_data["exit_price"] = curr_ltp
                leg_data["exit_reason"] = reason
                record_commodity_trade_exit(strat, leg_key, curr_ltp, reason)
                log_commodity(f"[{sname}] ✅ Closed {leg_key} ({sym}) @ ~₹{curr_ltp:.2f} (Order ID: {oid})")
            except Exception as e:
                log_commodity(f"[{sname}] ❌ Failed exit order for {sym}: {e}")

    strat["status"] = f"Exited ({reason})"
    strat["active"] = False
    strat["exit_triggered"] = True
    save_commodity_strategies(commodity_strategies_store)
    return True, "Strategy squared off successfully"


# ============================================================================
# CALCULATION & EXECUTION TRIGGER
# ============================================================================

def calculate_commodity_strategy_strikes(strat):
    """Calculates ATM / target premium strikes and live LTPs for a commodity strategy without placing orders."""
    global commodity_strategies_store
    kite = get_kite_client()
    if not kite:
        return False, "Kite client not logged in"

    cname = str(strat.get("commodity_name", "CRUDEOIL")).upper()
    stype = str(strat.get("strategy_type", "STRADDLE")).upper()
    expiry = strat.get("expiry")

    # Resolve Futures symbol and LTP for underlying pricing
    fut_sym, fut_exp = resolve_commodity_futures_symbol(cname, expiry if stype == "FUTURES" else None)
    strat["future_symbol"] = fut_sym

    underlying_price = 0.0
    if fut_sym:
        try:
            q = kite.ltp([f"MCX:{fut_sym}"])
            underlying_price = float(q.get(f"MCX:{fut_sym}", {}).get("last_price", 0.0) or 0.0)
            strat["future_ltp"] = underlying_price
        except Exception as e:
            logger.warning(f"Error fetching future LTP for {fut_sym}: {e}")

    if stype == "FUTURES":
        strat["resolved_expiry"] = fut_exp
        save_commodity_strategies(commodity_strategies_store)
        return True, f"Resolved Futures: {fut_sym} (LTP: ₹{underlying_price:.2f})"

    # Options Chain resolution
    chain, chosen_exp = get_commodity_options_chain(cname, expiry)
    if not chain:
        return False, f"No options chain found for {cname}"

    strat["resolved_expiry"] = chosen_exp

    legs = ["CE", "PE"] if stype in ("STRADDLE", "STRANGLE") else (["CE"] if stype == "SINGLE_CE" else ["PE"])
    syms_to_quote = []

    for leg in legs:
        target_prem = float(strat.get(f"{leg.lower()}_premium", 0.0) or 0.0)
        if target_prem > 0:
            for c in chain:
                if c.get(leg):
                    syms_to_quote.append(f"MCX:{c[leg]}")
        else:
            if underlying_price > 0:
                closest_c = min(chain, key=lambda x: abs(float(x["strike"]) - underlying_price))
                if closest_c.get(leg):
                    syms_to_quote.append(f"MCX:{closest_c[leg]}")
            elif chain:
                mid_c = chain[len(chain)//2]
                if mid_c.get(leg):
                    syms_to_quote.append(f"MCX:{mid_c[leg]}")

    quotes = {}
    if syms_to_quote:
        try:
            quotes = kite.ltp(list(set(syms_to_quote)))
        except Exception as e:
            logger.warning(f"Error fetching options quotes: {e}")

    for leg in legs:
        target_prem = float(strat.get(f"{leg.lower()}_premium", 0.0) or 0.0)
        chosen_sym = None
        chosen_strike = None
        chosen_ltp = 0.0

        if target_prem > 0:
            best_diff = float("inf")
            for c in chain:
                sym = c.get(leg)
                if sym:
                    ltp = float(quotes.get(f"MCX:{sym}", {}).get("last_price", 0.0) or 0.0)
                    if ltp > 0 and abs(ltp - target_prem) < best_diff:
                        best_diff = abs(ltp - target_prem)
                        chosen_sym = sym
                        chosen_strike = c["strike"]
                        chosen_ltp = ltp
        else:
            if underlying_price > 0:
                closest_c = min(chain, key=lambda x: abs(float(x["strike"]) - underlying_price))
            else:
                closest_c = chain[len(chain)//2] if chain else None
            if closest_c and closest_c.get(leg):
                chosen_sym = closest_c[leg]
                chosen_strike = closest_c["strike"]
                chosen_ltp = float(quotes.get(f"MCX:{chosen_sym}", {}).get("last_price", 0.0) or 0.0)

        if chosen_sym:
            strat[f"selected_{leg.lower()}"] = chosen_sym
            strat[f"selected_{leg.lower()}_strike"] = chosen_strike
            strat[f"selected_{leg.lower()}_ltp"] = chosen_ltp

    for idx, s in enumerate(commodity_strategies_store):
        if str(s.get("id")) == str(strat.get("id")):
            commodity_strategies_store[idx].update(strat)
            break

    save_commodity_strategies(commodity_strategies_store)
    return True, f"Strikes calculated: CE={strat.get('selected_ce', '--')} (₹{strat.get('selected_ce_ltp', 0):.2f}), PE={strat.get('selected_pe', '--')} (₹{strat.get('selected_pe_ltp', 0):.2f})"


def execute_commodity_strategy_entry(strat):
    """
    Executes entry order placement for a commodity strategy (Futures or Options).
    """
    global commodity_strategies_store
    kite = get_kite_client()
    if not kite:
        return False, "Not logged in"

    sname = strat.get("name", "Commodity Strategy")
    stype = str(strat.get("strategy_type", "STRADDLE")).upper()
    cname = str(strat.get("commodity_name", "CRUDEOIL")).upper()
    product = str(strat.get("product", "MIS")).upper()
    entry_act = str(strat.get("entry_action", "SELL")).upper()
    expiry = strat.get("expiry")
    lot_sz = get_commodity_lot_size(cname)
    qty = int(strat.get("quantity") or lot_sz)
    sl_type = str(strat.get("sl_type", "POINTS")).upper()
    sl_val = float(strat.get("sl_value") or strat.get("sl_points") or 20.0)

    run_tag = f"comm_{int(time.time()) % 100000}"
    strat["run_tag"] = run_tag
    orders = strat.setdefault("orders", {})

    log_commodity(f"[{sname}] 🚀 Initiating Entry for {cname} {stype} ({entry_act}) Qty:{qty}...")

    # 1. FUTURES STRATEGY
    if stype == "FUTURES":
        fut_sym, resolved_exp = resolve_commodity_futures_symbol(cname, expiry)
        if not fut_sym:
            log_commodity(f"[{sname}] ❌ Could not resolve Futures symbol for {cname}")
            return False, "Futures symbol not found"

        strat["resolved_expiry"] = resolved_exp
        try:
            oid, ltp, ord_p = place_commodity_order(kite, fut_sym, entry_act, qty, product, run_tag)
            
            # SL trigger calculation
            if entry_act == "SELL":
                sl_trig = round(ltp * (1.0 + sl_val / 100.0), 2) if sl_type == "PERCENT" else round(ltp + sl_val, 2)
            else:
                sl_trig = round(max(0.05, ltp * (1.0 - sl_val / 100.0)), 2) if sl_type == "PERCENT" else round(max(0.05, ltp - sl_val), 2)

            orders["FUT"] = {
                "symbol": fut_sym,
                "first_entry_price": ltp,
                "entry_price": ltp,
                "current_ltp": ltp,
                "action": entry_act,
                "quantity": qty,
                "order_id": oid,
                "status": "ENTERED",
                "current_sl_trigger": sl_trig,
                "best_ltp": ltp,
                "tsl_reference_ltp": ltp,
                "reentries_done": 0
            }
            strat["status"] = "Holding (Position ON)"
            strat["orders_placed"] = True
            strat["order_triggered"] = True
            save_commodity_strategies(commodity_strategies_store)
            record_commodity_trade_entry(strat)
            log_commodity(f"[{sname}] ✅ FUTURES Order placed: {fut_sym} @ ₹{ltp:.2f} | Initial SL: ₹{sl_trig:.2f}")
            return True, "Futures order placed"
        except Exception as e:
            log_commodity(f"[{sname}] ❌ Error placing Futures order: {e}")
            return False, str(e)

    # 2. OPTIONS STRATEGY (STRADDLE, STRANGLE, SINGLE_CE, SINGLE_PE)
    else:
        chain, resolved_exp = get_commodity_options_chain(cname, expiry)
        if not chain:
            log_commodity(f"[{sname}] ❌ No options chain found for {cname}")
            return False, "Options chain not found"

        strat["resolved_expiry"] = resolved_exp
        fut_sym, _ = resolve_commodity_futures_symbol(cname, None)
        
        underlying_price = 0.0
        if fut_sym:
            try:
                q = kite.ltp([f"MCX:{fut_sym}"])
                underlying_price = float(q.get(f"MCX:{fut_sym}", {}).get("last_price", 0.0) or 0.0)
            except Exception:
                pass

        legs_to_place = []
        if stype in ("STRADDLE", "STRANGLE"):
            legs_to_place = ["CE", "PE"]
        elif stype == "SINGLE_CE":
            legs_to_place = ["CE"]
        elif stype == "SINGLE_PE":
            legs_to_place = ["PE"]

        selected_symbols = {}
        for leg in legs_to_place:
            target_strike = strat.get(f"selected_{leg.lower()}_strike")
            target_prem = float(strat.get(f"{leg.lower()}_premium", 0.0) or 0.0)

            if target_prem > 0:
                sym_list = [c[leg] for c in chain if c[leg]]
                if sym_list:
                    try:
                        quotes = kite.ltp([f"MCX:{s}" for s in sym_list])
                        best_diff = float("inf")
                        best_sym = None
                        best_strike = None
                        for c in chain:
                            s = c[leg]
                            if s:
                                pltp = float(quotes.get(f"MCX:{s}", {}).get("last_price", 0.0) or 0.0)
                                if pltp > 0 and abs(pltp - target_prem) < best_diff:
                                    best_diff = abs(pltp - target_prem)
                                    best_sym = s
                                    best_strike = c["strike"]
                        if best_sym:
                            selected_symbols[leg] = (best_sym, best_strike)
                    except Exception:
                        pass

            if leg not in selected_symbols and target_strike and target_strike != "--":
                try:
                    t_strk = float(target_strike)
                    sym = resolve_commodity_option_symbol(cname, resolved_exp, t_strk, leg)
                    if sym:
                        selected_symbols[leg] = (sym, t_strk)
                except Exception:
                    pass

            if leg not in selected_symbols:
                ref_p = underlying_price if underlying_price > 0 else (chain[len(chain)//2]["strike"] if chain else 100)
                atm_item = min(chain, key=lambda x: abs(x["strike"] - ref_p))
                selected_symbols[leg] = (atm_item[leg], atm_item["strike"])

        placed_any = False
        for leg, (sym, strike) in selected_symbols.items():
            if not sym:
                continue
            try:
                oid, ltp, ord_p = place_commodity_order(kite, sym, entry_act, qty, product, run_tag)
                
                if entry_act == "SELL":
                    sl_trig = round(ltp * (1.0 + sl_val / 100.0), 2) if sl_type == "PERCENT" else round(ltp + sl_val, 2)
                else:
                    sl_trig = round(max(0.05, ltp * (1.0 - sl_val / 100.0)), 2) if sl_type == "PERCENT" else round(max(0.05, ltp - sl_val), 2)

                orders[leg] = {
                    "symbol": sym,
                    "strike": strike,
                    "first_entry_price": ltp,
                    "entry_price": ltp,
                    "current_ltp": ltp,
                    "action": entry_act,
                    "quantity": qty,
                    "order_id": oid,
                    "status": "ENTERED",
                    "current_sl_trigger": sl_trig,
                    "best_ltp": ltp,
                    "tsl_reference_ltp": ltp,
                    "reentries_done": 0
                }
                placed_any = True
                log_commodity(f"[{sname}] ✅ Placed {leg} ({sym} - Strike {strike}) @ ₹{ltp:.2f} | SL: ₹{sl_trig:.2f}")
            except Exception as e:
                log_commodity(f"[{sname}] ❌ Error placing {leg} ({sym}): {e}")

        if placed_any:
            strat["status"] = "Holding (Position ON)"
            strat["orders_placed"] = True
            strat["order_triggered"] = True
            save_commodity_strategies(commodity_strategies_store)
            record_commodity_trade_entry(strat)
            return True, "Options orders placed"
        else:
            return False, "Failed to place options orders"


# ============================================================================
# BACKGROUND MONITORING & MCX MARKET ENGINE
# ============================================================================

def is_mcx_market_open():
    """
    MCX commodity trading hours:
    Monday - Friday: 09:00:00 to 23:30:00 (or 23:55:00)
    """
    now = datetime.now()
    if now.weekday() >= 5:
        return False
    now_time = now.time()
    return (datetime.strptime("09:00:00", "%H:%M:%S").time() <= now_time <= datetime.strptime("23:55:00", "%H:%M:%S").time())


def run_commodity_tick_cycle(kite):
    """
    Executes one monitoring cycle across all active commodity strategies.
    Checks start times, live quotes, SL triggers, TSL trailing, target profits, and exit times.
    """
    global commodity_strategies_store
    with commodity_lock:
        if not commodity_strategies_store:
            commodity_strategies_store = load_commodity_strategies()
        strategies = list(commodity_strategies_store)

    if not strategies:
        return

    now = datetime.now()
    now_time_str = now.strftime("%H:%M:%S")

    syms_to_quote = set()
    for s in strategies:
        if not s.get("active"):
            continue
        orders = s.get("orders", {})
        for leg_key in ["FUT", "CE", "PE"]:
            leg_data = orders.get(leg_key)
            if leg_data and leg_data.get("symbol"):
                syms_to_quote.add(f"MCX:{leg_data['symbol']}")

    quotes = {}
    if syms_to_quote and kite:
        try:
            quotes = kite.quote(list(syms_to_quote))
        except Exception as e:
            logger.debug(f"Commodity batch quote query error: {e}")

    updated = False
    for s in strategies:
        if not s.get("active"):
            continue

        sname = s.get("name", "Commodity Strategy")
        start_time = s.get("start_time", "09:15:00")
        end_time = s.get("end_time", "23:15:00")
        orders = s.setdefault("orders", {})
        orders_placed = s.get("orders_placed", False)
        exit_triggered = s.get("exit_triggered", False)

        # 1. TIME-BASED ENTRY TRIGGER
        if not orders_placed and not exit_triggered:
            if now_time_str >= start_time:
                log_commodity(f"[{sname}] ⏰ Start time ({start_time}) reached. Executing entry orders...")
                ok, msg = execute_commodity_strategy_entry(s)
                updated = True

        # 2. TIME-BASED EXIT TRIGGER
        if orders_placed and not exit_triggered:
            if now_time_str >= end_time:
                log_commodity(f"[{sname}] ⏰ End time ({end_time}) reached. Executing automated squareoff...")
                squareoff_commodity_strategy(s, reason="End Time Exit")
                updated = True
                continue

        # 3. LIVE MONITORING OF ACTIVE LEGS (SL & TSL)
        if orders_placed and not exit_triggered:
            enable_tsl = bool(s.get("enable_tsl", False))
            tsl_val = float(s.get("tsl_value") or s.get("tsl_points") or 10.0)
            tsl_step = float(s.get("tsl_step", 10.0))

            for leg_key in ["FUT", "CE", "PE"]:
                leg_data = orders.get(leg_key)
                if not leg_data or leg_data.get("status") not in ("ENTERED", "ACTIVE"):
                    continue

                sym = leg_data.get("symbol")
                qkey = f"MCX:{sym}"
                if qkey in quotes:
                    curr_ltp = float(quotes[qkey].get("last_price", 0.0) or 0.0)
                    if curr_ltp <= 0:
                        continue

                    leg_data["current_ltp"] = curr_ltp
                    action = leg_data.get("action") or s.get("entry_action", "SELL")
                    entry_p = float(leg_data.get("entry_price", curr_ltp))
                    qty = int(leg_data.get("quantity") or s.get("quantity") or 100)
                    sl_trig = float(leg_data.get("current_sl_trigger", 0.0))

                    # Calculate live PnL for leg
                    if action == "SELL":
                        pnl = (entry_p - curr_ltp) * qty
                    else:
                        pnl = (curr_ltp - entry_p) * qty
                    leg_data["pnl"] = round(pnl, 2)

                    # A. TRAILING STOP LOSS (TSL)
                    if enable_tsl:
                        best_ltp = float(leg_data.get("best_ltp", entry_p))
                        ref_ltp = float(leg_data.get("tsl_reference_ltp", entry_p))

                        if action == "SELL":
                            if curr_ltp < best_ltp:
                                leg_data["best_ltp"] = curr_ltp
                            if (ref_ltp - curr_ltp) >= tsl_step and tsl_step > 0:
                                steps = int((ref_ltp - curr_ltp) // tsl_step)
                                pts_to_trail = steps * tsl_val
                                new_sl = round(sl_trig - pts_to_trail, 2)
                                leg_data["current_sl_trigger"] = new_sl
                                leg_data["tsl_reference_ltp"] = round(ref_ltp - (steps * tsl_step), 2)
                                log_commodity(f"[{sname}] 🎯 TSL TRAIL on {leg_key} ({sym}): SL Trailed ➔ ₹{new_sl:.2f}")
                                updated = True
                        else:  # BUY
                            if curr_ltp > best_ltp:
                                leg_data["best_ltp"] = curr_ltp
                            if (curr_ltp - ref_ltp) >= tsl_step and tsl_step > 0:
                                steps = int((curr_ltp - ref_ltp) // tsl_step)
                                pts_to_trail = steps * tsl_val
                                new_sl = round(sl_trig + pts_to_trail, 2)
                                leg_data["current_sl_trigger"] = new_sl
                                leg_data["tsl_reference_ltp"] = round(ref_ltp + (steps * tsl_step), 2)
                                log_commodity(f"[{sname}] 🎯 TSL TRAIL on {leg_key} ({sym}): SL Trailed ➔ ₹{new_sl:.2f}")
                                updated = True

                    # B. STOP LOSS HIT CHECK
                    if sl_trig > 0:
                        sl_hit = False
                        if action == "SELL" and curr_ltp >= sl_trig:
                            sl_hit = True
                        elif action == "BUY" and curr_ltp <= sl_trig:
                            sl_hit = True

                        if sl_hit:
                            log_commodity(f"[{sname}] 💥 STOP LOSS HIT on {leg_key} ({sym})! LTP: ₹{curr_ltp:.2f}, SL Trigger: ₹{sl_trig:.2f}")
                            try:
                                exit_txn = kite.TRANSACTION_TYPE_BUY if action == "SELL" else kite.TRANSACTION_TYPE_SELL
                                product = s.get("product", "MIS").upper()
                                oid = kite.place_order(
                                    variety=kite.VARIETY_REGULAR,
                                    exchange="MCX",
                                    tradingsymbol=sym,
                                    transaction_type=exit_txn,
                                    quantity=qty,
                                    product=product,
                                    order_type=kite.ORDER_TYPE_MARKET,
                                    tag="sl_hit"
                                )
                                leg_data["status"] = "SL_HIT"
                                leg_data["exit_price"] = curr_ltp
                                record_commodity_trade_exit(s, leg_key, curr_ltp, reason=f"SL Hit @ ₹{curr_ltp:.2f}")
                                updated = True
                            except Exception as ex:
                                log_commodity(f"[{sname}] ❌ Error squaring off {leg_key} on SL: {ex}")

    if updated:
        with commodity_lock:
            save_commodity_strategies(commodity_strategies_store)


def commodity_daemon_loop():
    """Continuous background monitoring daemon thread for Commodity strategies."""
    logger.info("Starting Commodity Trading Engine background daemon...")
    while True:
        try:
            kite = get_kite_client()
            if kite:
                run_commodity_tick_cycle(kite)
        except Exception as e:
            logger.error(f"Error in commodity daemon tick: {e}")
        time.sleep(2.5)


# Start daemon thread upon import
_commodity_daemon = threading.Thread(target=commodity_daemon_loop, daemon=True, name="CommodityDaemon")
_commodity_daemon.start()


# ============================================================================
# API HELPER FUNCTIONS FOR FLASK SERVER
# ============================================================================

def get_commodity_strategies():
    """Returns copy of all commodity strategies with live MTM & PnL."""
    global commodity_strategies_store
    with commodity_lock:
        if not commodity_strategies_store:
            commodity_strategies_store = load_commodity_strategies()
        return list(commodity_strategies_store)


def get_commodity_pnl_summary():
    """Reads commodity_PnL.csv and returns comprehensive summary metrics."""
    records = trade_journal.load_journal_records(COMMODITY_PNL_CSV)
    total_trades = len(records)
    closed_trades = [r for r in records if r.get("Status") == "CLOSED"]
    winning_trades = [r for r in closed_trades if float(r.get("Day_PnL", 0.0) or 0.0) > 0]
    losing_trades = [r for r in closed_trades if float(r.get("Day_PnL", 0.0) or 0.0) < 0]

    realized_pnl = round(sum(float(r.get("Day_PnL", 0.0) or 0.0) for r in closed_trades), 2)
    total_slippage = round(sum(float(r.get("Total_Slippage_INR", 0.0) or 0.0) for r in records), 2)
    win_rate = round((len(winning_trades) / len(closed_trades) * 100.0), 1) if closed_trades else 0.0

    return {
        "total_trades": total_trades,
        "closed_trades": len(closed_trades),
        "open_trades": total_trades - len(closed_trades),
        "winning_trades": len(winning_trades),
        "losing_trades": len(losing_trades),
        "win_rate": win_rate,
        "realized_pnl": realized_pnl,
        "total_slippage_inr": total_slippage,
        "records": records[::-1]
    }
