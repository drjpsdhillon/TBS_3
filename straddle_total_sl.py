"""
straddle_total_sl.py — Multi-Strategy Positional Straddle Engine with Total Premium SL & Target for Zerodha Kite Connect

Features:
- Straddle execution (Simultaneous ATM CE & PE strike selection at the same strike)
- Combined Total Premium Stop Loss (%) & Target Profit (%) Management:
    * Initial Total Premium = CE Entry Price + PE Entry Price (e.g. ₹100 + ₹100 = ₹200)
    * Stop Loss (SELL): Exit BOTH legs when Combined Premium >= Initial * (1 + SL% / 100) (e.g. 100% SL -> ₹400)
    * Target Profit (SELL): Exit BOTH legs when Combined Premium <= Initial * (1 - Target% / 100) (e.g. 50% TP -> ₹100)
- Multi-Day / Overnight holding (NRML product type)
- Multi-Strategy management (Create, Edit, Delete, Run, Stop, Calculate Strikes, Manual Square-off)
- Grouping by Underlying Instrument (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX)
- Persistent JSON configuration in straddle_total_sl.json
- Dedicated Trading Journal in straddle_total_sl_PnL.csv and straddle_total_sl_PnL.xlsx
- Local Pending Orders Book in pending_straddle_orders.json
- Shared authentication via session_cache.json / credentials.json
"""

import os
import sys
import json
import logging
import time
import threading
from datetime import datetime, date, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "pykiteconnect"))
from kiteconnect import KiteConnect

logger = logging.getLogger("straddle_total_sl")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("%(asctime)s - [StraddleTotalSL] %(levelname)s - %(message)s"))
    logger.addHandler(ch)

STRADDLE_CONFIG_FILE = os.path.join(BASE_DIR, "straddle_total_sl.json")
CREDENTIALS_FILE = os.path.join(BASE_DIR, "credentials.json")
CACHE_FILE = os.path.join(BASE_DIR, "session_cache.json")
STRADDLE_PNL_CSV = os.path.join(BASE_DIR, "straddle_total_sl_PnL.csv")
STRADDLE_PNL_XLSX = os.path.join(BASE_DIR, "straddle_total_sl_PnL.xlsx")
LOT_SIZES_FILE = os.path.join(BASE_DIR, "lot_sizes.json")
PENDING_STRADDLE_ORDERS_FILE = os.path.join(BASE_DIR, "pending_straddle_orders.json")

DEFAULT_STRADDLE_LOT_SIZES = {
    "NIFTY": 65,
    "BANKNIFTY": 30,
    "FINNIFTY": 25,
    "MIDCPNIFTY": 50,
    "SENSEX": 10,
    "BANKEX": 15
}

def get_straddle_lot_size(index_name):
    """Retrieve lot size from persistent broker cache file or defaults."""
    if not index_name:
        return 65
    name = str(index_name).strip().upper()
    if os.path.exists(LOT_SIZES_FILE):
        try:
            with open(LOT_SIZES_FILE, "r") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    if name in saved:
                        return int(saved[name])
                    if "BANK" in name and "BANKNIFTY" in saved:
                        return int(saved["BANKNIFTY"])
                    if ("MIDCP" in name or "MIDCAP" in name) and "MIDCPNIFTY" in saved:
                        return int(saved["MIDCPNIFTY"])
                    if "FIN" in name and "FINNIFTY" in saved:
                        return int(saved["FINNIFTY"])
                    if "SENSEX" in name and "SENSEX" in saved:
                        return int(saved["SENSEX"])
        except Exception:
            pass
    if "BANK" in name:
        return 30
    if "MIDCP" in name or "MIDCAP" in name:
        return 50
    if "FIN" in name:
        return 25
    if "SENSEX" in name:
        return 10
    return DEFAULT_STRADDLE_LOT_SIZES.get(name, 65)


def get_straddle_exchange(index_name):
    """Returns correct broker exchange for instrument: BFO for SENSEX/BANKEX, else NFO."""
    idx = str(index_name or "").upper()
    if "SENSEX" in idx or "BANKEX" in idx or "BSE" in idx:
        return "BFO"
    return "NFO"


def get_spot_symbol(index_name):
    """Returns Kite index ticker symbol for underlying spot price lookup."""
    idx = str(index_name or "NIFTY").upper()
    if "BANKNIFTY" in idx or "BANK" in idx:
        return "NSE:NIFTY BANK"
    if "FINNIFTY" in idx or "FIN" in idx:
        return "NSE:NIFTY FIN SERVICE"
    if "MIDCP" in idx or "MIDCAP" in idx:
        return "NSE:NIFTY MID SELECT"
    if "SENSEX" in idx:
        return "BSE:SENSEX"
    if "BANKEX" in idx:
        return "BSE:BANKEX"
    return "NSE:NIFTY 50"


# --------------------------------------------------------------------------
# Local Pending Orders Store (pending_straddle_orders.json)
# --------------------------------------------------------------------------
def load_pending_straddle_orders():
    """Loads local persistent record of pending straddle orders."""
    if not os.path.exists(PENDING_STRADDLE_ORDERS_FILE):
        return {}
    try:
        with open(PENDING_STRADDLE_ORDERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning(f"Failed loading {PENDING_STRADDLE_ORDERS_FILE}: {e}")
        return {}


def save_pending_straddle_orders(orders_dict):
    """Saves local persistent record of pending straddle orders."""
    try:
        with open(PENDING_STRADDLE_ORDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(orders_dict, f, indent=2)
    except Exception as e:
        logger.error(f"Failed saving {PENDING_STRADDLE_ORDERS_FILE}: {e}")


def upsert_pending_straddle_order(order_key, order_info):
    """Upserts a pending straddle order in local pending orders book."""
    orders = load_pending_straddle_orders()
    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    order_info["updated_at"] = now_ts
    if order_key not in orders:
        order_info["created_at"] = now_ts
    else:
        order_info["created_at"] = orders[order_key].get("created_at", now_ts)
    orders[order_key] = order_info
    save_pending_straddle_orders(orders)
    return orders


def remove_pending_straddle_order(order_key):
    """Removes or clears an order from the local pending straddle orders book."""
    orders = load_pending_straddle_orders()
    if order_key in orders:
        del orders[order_key]
        save_pending_straddle_orders(orders)


# --------------------------------------------------------------------------
# In-Memory Execution Logs
# --------------------------------------------------------------------------
straddle_logs = []
MAX_STRADDLE_LOGS = 300

def log_straddle(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{ts}] {msg}"
    straddle_logs.append(entry)
    if len(straddle_logs) > MAX_STRADDLE_LOGS:
        straddle_logs.pop(0)
    logger.info(msg)


# --------------------------------------------------------------------------
# Trading Journal Persistence (straddle_total_sl_PnL.csv & .xlsx)
# --------------------------------------------------------------------------
def load_straddle_pnl_records():
    """Loads existing trade log records from straddle_total_sl_PnL.csv."""
    records = []
    if not os.path.exists(STRADDLE_PNL_CSV):
        return records
    try:
        with open(STRADDLE_PNL_CSV, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
            if len(lines) > 1:
                for line in lines[1:]:
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 17:
                        records.append({
                            "Serial_No": int(parts[0]) if parts[0].isdigit() else len(records) + 1,
                            "Date": parts[1],
                            "Strategy_Name": parts[2],
                            "Instrument": parts[3],
                            "Strike": parts[4],
                            "Lot_Size": int(parts[5]) if parts[5].isdigit() else parts[5],
                            "CE_Symbol": parts[6],
                            "CE_Entry_Price": parts[7],
                            "CE_Exit_Price": parts[8],
                            "PE_Symbol": parts[9],
                            "PE_Entry_Price": parts[10],
                            "PE_Exit_Price": parts[11],
                            "Initial_Total_Premium": float(parts[12]) if parts[12].replace(".","").isdigit() else 0.0,
                            "Exit_Total_Premium": float(parts[13]) if parts[13].replace(".","").isdigit() else 0.0,
                            "Day_PnL": float(parts[14]) if parts[14].replace("-","").replace(".","").isdigit() else 0.0,
                            "Cumulative_PnL": float(parts[15]) if parts[15].replace("-","").replace(".","").isdigit() else 0.0,
                            "Exit_Date": parts[16] if len(parts) > 16 else "--",
                            "Status": parts[17] if len(parts) > 17 else "OPEN"
                        })
    except Exception as e:
        logger.warning(f"Failed parsing {STRADDLE_PNL_CSV}: {e}")
    return records


def rewrite_straddle_pnl_files(records):
    """Rewrites straddle_total_sl_PnL.csv and straddle_total_sl_PnL.xlsx with full history."""
    try:
        header_lines = [
            "# ==========================================================================\n",
            "# STRADDLE TOTAL SL STRATEGY P&L TRADE JOURNAL\n",
            "# ==========================================================================\n",
            "Serial_No,Date,Strategy_Name,Instrument,Strike,Lot_Size,CE_Symbol,CE_Entry_Price,CE_Exit_Price,PE_Symbol,PE_Entry_Price,PE_Exit_Price,Initial_Total_Premium,Exit_Total_Premium,Day_PnL,Cumulative_PnL,Exit_Date,Status\n"
        ]
        with open(STRADDLE_PNL_CSV, "w", encoding="utf-8") as f:
            f.writelines(header_lines)
            for r in records:
                row_str = f"{r.get('Serial_No', 1)},{r.get('Date', '')},{r.get('Strategy_Name', '')},{r.get('Instrument', '')},{r.get('Strike', '--')},{r.get('Lot_Size', 65)},{r.get('CE_Symbol', '--')},{r.get('CE_Entry_Price', '--')},{r.get('CE_Exit_Price', '--')},{r.get('PE_Symbol', '--')},{r.get('PE_Entry_Price', '--')},{r.get('PE_Exit_Price', '--')},{r.get('Initial_Total_Premium', 0.0):.2f},{r.get('Exit_Total_Premium', 0.0):.2f},{r.get('Day_PnL', 0.0):.2f},{r.get('Cumulative_PnL', 0.0):.2f},{r.get('Exit_Date', '--')},{r.get('Status', 'OPEN')}\n"
                f.write(row_str)

        try:
            import pandas as pd
            df = pd.DataFrame(records)
            with pd.ExcelWriter(STRADDLE_PNL_XLSX, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='Straddle_Total_SL_Journal', index=False)
        except Exception:
            pass
    except Exception as e:
        logger.error(f"Error rewriting straddle PnL files: {e}")


def record_straddle_trade_entry(strat):
    """Logs initial straddle position entry with combined initial total premium."""
    try:
        strat_id = strat.get("id")
        strat_name = strat.get("name", "Straddle Total SL")
        instrument = (strat.get("index_name") or "NIFTY").upper()
        lot_size = int(strat.get("quantity") or get_straddle_lot_size(instrument))
        strike = str(strat.get("selected_strike") or strat.get("strike") or "--")
        now_dt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        strat["start_date"] = now_dt

        ce_sym = strat.get("selected_ce") or strat.get("orders", {}).get("CE", {}).get("symbol") or "--"
        pe_sym = strat.get("selected_pe") or strat.get("orders", {}).get("PE", {}).get("symbol") or "--"

        ce_entry = float(strat.get("orders", {}).get("CE", {}).get("first_entry_price") or strat.get("orders", {}).get("CE", {}).get("entry_price") or strat.get("selected_ce_ltp") or 0.0)
        pe_entry = float(strat.get("orders", {}).get("PE", {}).get("first_entry_price") or strat.get("orders", {}).get("PE", {}).get("entry_price") or strat.get("selected_pe_ltp") or 0.0)
        init_prem = round(ce_entry + pe_entry, 2)
        strat["initial_total_premium"] = init_prem

        records = load_straddle_pnl_records()
        serial_no = len(records) + 1
        prev_cum_pnl = records[-1]["Cumulative_PnL"] if records else 0.0

        new_entry = {
            "Serial_No": serial_no,
            "Date": now_dt,
            "Strategy_Name": strat_name,
            "Instrument": instrument,
            "Strike": strike,
            "Lot_Size": lot_size,
            "CE_Symbol": ce_sym,
            "CE_Entry_Price": f"{ce_entry:.2f}" if ce_entry else "--",
            "CE_Exit_Price": "--",
            "PE_Symbol": pe_sym,
            "PE_Entry_Price": f"{pe_entry:.2f}" if pe_entry else "--",
            "PE_Exit_Price": "--",
            "Initial_Total_Premium": init_prem,
            "Exit_Total_Premium": 0.0,
            "Day_PnL": 0.0,
            "Cumulative_PnL": prev_cum_pnl,
            "Exit_Date": "-- (OPEN)",
            "Status": "OPEN"
        }
        records.append(new_entry)
        rewrite_straddle_pnl_files(records)
        log_straddle(f"[{strat_name}] 📝 Entry logged in {STRADDLE_PNL_CSV} (S.No #{serial_no}, ATM Strike: {strike}, Total Prem: ₹{init_prem:.2f} [CE: ₹{ce_entry:.2f} + PE: ₹{pe_entry:.2f}])")
    except Exception as e:
        logger.error(f"Error recording straddle trade entry: {e}")


def record_straddle_trade_exit(strat, final_pnl):
    """Updates exit date, CE/PE exit prices, final PnL and cumulative totals in trading journal."""
    try:
        strat_id = strat.get("id")
        strat_name = strat.get("name", "Straddle Total SL")
        records = load_straddle_pnl_records()
        if not records:
            return

        exit_dt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ce_exit = float(strat.get("orders", {}).get("CE", {}).get("exit_price") or strat.get("orders", {}).get("CE", {}).get("current_ltp") or 0.0)
        pe_exit = float(strat.get("orders", {}).get("PE", {}).get("exit_price") or strat.get("orders", {}).get("PE", {}).get("current_ltp") or 0.0)
        exit_tot_prem = round(ce_exit + pe_exit, 2)

        # Find open record for this strategy
        target_idx = None
        for i in reversed(range(len(records))):
            if records[i]["Strategy_Name"] == strat_name and records[i]["Status"] == "OPEN":
                target_idx = i
                break

        if target_idx is None and records:
            target_idx = len(records) - 1

        if target_idx is not None:
            records[target_idx]["Exit_Date"] = exit_dt
            records[target_idx]["CE_Exit_Price"] = f"{ce_exit:.2f}"
            records[target_idx]["PE_Exit_Price"] = f"{pe_exit:.2f}"
            records[target_idx]["Exit_Total_Premium"] = exit_tot_prem
            records[target_idx]["Day_PnL"] = round(final_pnl, 2)
            records[target_idx]["Status"] = "CLOSED"

            # Recalculate sequential cumulative PnL
            running_cum = 0.0
            for r in records:
                running_cum += float(r.get("Day_PnL", 0.0))
                r["Cumulative_PnL"] = round(running_cum, 2)

            rewrite_straddle_pnl_files(records)
            log_straddle(f"[{strat_name}] 🏁 Exit logged in {STRADDLE_PNL_CSV} (Exit Prem: ₹{exit_tot_prem:.2f}, PnL: ₹{final_pnl:.2f}, Cum PnL: ₹{running_cum:.2f})")
    except Exception as e:
        logger.error(f"Error recording straddle trade exit: {e}")


def record_straddle_running_pnl(strat, current_pnl):
    """Updates running PnL for active trade record."""
    try:
        strat_name = strat.get("name", "Straddle Total SL")
        records = load_straddle_pnl_records()
        if not records:
            return

        target_idx = None
        for i in reversed(range(len(records))):
            if records[i]["Strategy_Name"] == strat_name and records[i]["Status"] == "OPEN":
                target_idx = i
                break

        if target_idx is not None:
            ce_curr = float(strat.get("orders", {}).get("CE", {}).get("current_ltp") or 0.0)
            pe_curr = float(strat.get("orders", {}).get("PE", {}).get("current_ltp") or 0.0)
            records[target_idx]["Exit_Total_Premium"] = round(ce_curr + pe_curr, 2)
            records[target_idx]["Day_PnL"] = round(current_pnl, 2)

            running_cum = 0.0
            for r in records:
                running_cum += float(r.get("Day_PnL", 0.0))
                r["Cumulative_PnL"] = round(running_cum, 2)

            rewrite_straddle_pnl_files(records)
    except Exception:
        pass


# --------------------------------------------------------------------------
# Strategy Definition & Persistence (straddle_total_sl.json)
# --------------------------------------------------------------------------
DEFAULT_STRADDLE_STRATEGY = {
    "id": "straddle_nifty_default",
    "name": "Nifty Positional Straddle Total SL",
    "active": False,
    "status": "Stopped",
    "index_name": "NIFTY",
    "expiry": "CURRENT",
    "entry_action": "SELL",
    "product": "NRML",
    "strike": "ATM",
    "selected_strike": "--",
    "total_sl_percent": 100.0,
    "total_tp_percent": 50.0,
    "quantity": 65,
    "entry_time": "15:00:00",
    "exit_time": "15:15:00",
    "morning_sl_time": "09:17:00",
    "entry_date": "",
    "last_sl_date": "",
    "initial_total_premium": 0.0,
    "current_total_premium": 0.0,
    "sl_trigger_premium": 0.0,
    "tp_trigger_premium": 0.0,
    "orders": {
        "CE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"},
        "PE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"},
        "orders_placed": False
    },
    "selected_ce": None,
    "selected_ce_ltp": 0.0,
    "selected_pe": None,
    "selected_pe_ltp": 0.0,
    "run_tag": None,
    "pnl": 0.0,
    "unrealized_pnl": 0.0,
    "realized_pnl": 0.0,
    "last_checked": ""
}

straddle_strategies_store = []

def load_straddle_strategies():
    """Loads all configured Straddle Total SL strategies from JSON."""
    global straddle_strategies_store
    if not os.path.exists(STRADDLE_CONFIG_FILE):
        straddle_strategies_store = [dict(DEFAULT_STRADDLE_STRATEGY)]
        save_straddle_strategies(straddle_strategies_store)
        return straddle_strategies_store

    try:
        with open(STRADDLE_CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                straddle_strategies_store = data
            elif isinstance(data, dict):
                straddle_strategies_store = [data]
            else:
                straddle_strategies_store = [dict(DEFAULT_STRADDLE_STRATEGY)]
    except Exception as e:
        logger.error(f"Error loading {STRADDLE_CONFIG_FILE}: {e}")
        straddle_strategies_store = [dict(DEFAULT_STRADDLE_STRATEGY)]

    # Backwards compatibility key fills
    for s in straddle_strategies_store:
        s.setdefault("total_sl_percent", 100.0)
        s.setdefault("total_tp_percent", 50.0)
        s.setdefault("strike", "ATM")
        s.setdefault("selected_strike", "--")
        s.setdefault("initial_total_premium", 0.0)
        s.setdefault("current_total_premium", 0.0)
        s.setdefault("sl_trigger_premium", 0.0)
        s.setdefault("tp_trigger_premium", 0.0)
        s.setdefault("product", "NRML")
        s.setdefault("orders", {})
        s["orders"].setdefault("orders_placed", False)
        s["orders"].setdefault("CE", {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"})
        s["orders"].setdefault("PE", {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"})

    return straddle_strategies_store


def save_straddle_strategies(strategies_list):
    """Saves configured Straddle Total SL strategies to JSON."""
    try:
        with open(STRADDLE_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(strategies_list, f, indent=4)
    except Exception as e:
        logger.error(f"Error saving {STRADDLE_CONFIG_FILE}: {e}")


# --------------------------------------------------------------------------
# Kite Client & Option Instruments Caching
# --------------------------------------------------------------------------
kite_instance = None
instruments_cache = []
cache_date = ""

def get_kite_client():
    global kite_instance
    if kite_instance:
        return kite_instance
    if os.path.exists(CACHE_FILE) and os.path.exists(CREDENTIALS_FILE):
        try:
            with open(CREDENTIALS_FILE, "r") as f:
                creds = json.load(f)
            with open(CACHE_FILE, "r") as f:
                cache = json.load(f)
            if cache.get("date") == datetime.today().strftime("%Y-%m-%d") and cache.get("access_token"):
                kite = KiteConnect(api_key=creds.get("api_key"))
                kite.set_access_token(cache["access_token"])
                kite_instance = kite
                return kite_instance
        except Exception as e:
            logger.warning(f"Could not build Kite client: {e}")
    return None


def set_kite_client(client):
    global kite_instance
    kite_instance = client


def cache_instruments():
    global instruments_cache, cache_date
    kite = get_kite_client()
    if not kite:
        return []
    today_str = datetime.today().strftime("%Y-%m-%d")
    if instruments_cache and cache_date == today_str:
        return instruments_cache
    try:
        log_straddle("Downloading Option instruments for Straddle engine...")
        inst_nfo = kite.instruments("NFO")
        opt_nfo = [i for i in inst_nfo if i.get("segment") == "NFO-OPT"]
        try:
            inst_bfo = kite.instruments("BFO")
            opt_bfo = [i for i in inst_bfo if i.get("segment") == "BFO-OPT"]
        except Exception:
            opt_bfo = []
        instruments_cache = opt_nfo + opt_bfo
        cache_date = today_str
        log_straddle(f"Cached {len(instruments_cache)} Option contracts.")
        return instruments_cache
    except Exception as e:
        log_straddle(f"Error caching option instruments: {e}")
        return []


# --------------------------------------------------------------------------
# ATM Strike & Straddle Calculation
# --------------------------------------------------------------------------
def calculate_straddle_strikes_for(strat):
    """
    Identifies ATM Strike and selects BOTH CE & PE at the SAME Strike:
    1. Fetches live Spot LTP for the underlying instrument.
    2. Resolves Expiry date (Current Monthly / Weekly or Next Expiry).
    3. Finds candidate strike closest to Spot LTP (ATM).
    4. Pairs both CE and PE at that ATM Strike.
    5. Calculates Initial Combined Total Premium & SL/Target thresholds.
    """
    kite = get_kite_client()
    if not kite:
        log_straddle(f"[{strat.get('name')}] Cannot calculate ATM straddle: Not logged in.")
        return False, "Not logged in to Kite"

    inst_list = cache_instruments()
    if not inst_list:
        return False, "Instruments cache empty"

    idx_name = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_straddle_exchange(idx_name)
    expiry = str(strat.get("expiry") or "").strip()
    total_sl_pct = float(strat.get("total_sl_percent", 100.0))
    total_tp_pct = float(strat.get("total_tp_percent", 50.0))
    entry_action = strat.get("entry_action", "SELL").upper()

    # 1. Fetch Spot LTP
    spot_symbol = get_spot_symbol(idx_name)
    spot_ltp = 0.0
    try:
        q = kite.ltp([spot_symbol])
        spot_ltp = float(q.get(spot_symbol, {}).get("last_price", 0.0))
        log_straddle(f"[{strat.get('name')}] Live Spot Price for {idx_name} ({spot_symbol}): ₹{spot_ltp:.2f}")
    except Exception as e:
        logger.warning(f"Could not fetch spot LTP for {spot_symbol}: {e}")

    # 2. Resolve Expiry
    available_expiries = sorted(list({
        str(i.get("expiry")) for i in inst_list 
        if i.get("name") == idx_name and i.get("expiry") and str(i.get("expiry")) >= datetime.today().strftime("%Y-%m-%d")
    }))

    month_map = {}
    for d_str in available_expiries:
        ym = d_str[:7]
        if ym not in month_map or d_str > month_map[ym]:
            month_map[ym] = d_str
    monthly_expiries = sorted(month_map.values())

    exp_upper = expiry.upper()
    if exp_upper in ("CURRENT", "CURRENT_MONTH", "CURRENT_MONTHLY", "CURRENT_EXPIRY", "NEAREST") or not expiry:
        if monthly_expiries:
            expiry = monthly_expiries[0]
        elif available_expiries:
            expiry = available_expiries[0]
        else:
            return False, f"No active expiries for {idx_name}"
    elif exp_upper in ("NEXT", "NEXT_MONTH", "NEXT_MONTHLY", "NEXT_EXPIRY", "NEXT_NEAREST"):
        if len(monthly_expiries) > 1:
            expiry = monthly_expiries[1]
        elif len(available_expiries) > 1:
            expiry = available_expiries[1]
        else:
            expiry = available_expiries[0] if available_expiries else ""
    strat["resolved_expiry"] = expiry

    candidates = [
        i for i in inst_list
        if i.get("name") == idx_name and str(i.get("expiry")).strip() == expiry
    ]

    if not candidates:
        return False, f"No options found for {idx_name} on expiry {expiry}"

    # 3. Determine Strike based on strike_mode (ATM / ROUND_OFF to Multiple / MANUAL)
    available_strikes = sorted(list({float(i.get("strike", 0)) for i in candidates if float(i.get("strike", 0)) > 0}))
    if not available_strikes:
        return False, "No strikes found in candidate options"

    strike_mode = str(strat.get("strike_mode") or "ATM").upper()
    strike_multiple = float(strat.get("strike_multiple") or 500.0)
    manual_strike = strat.get("manual_strike")
    raw_strike = str(strat.get("strike") or "").strip().upper()

    if strike_mode == "ROUND_OFF" or raw_strike.startswith("ROUND") or raw_strike.startswith("MULT"):
        step = strike_multiple if strike_multiple > 0 else 500.0
        if spot_ltp > 0:
            target_strike = round(spot_ltp / step) * step
            atm_strike = min(available_strikes, key=lambda x: abs(x - target_strike))
            log_straddle(f"[{strat.get('name')}] 🎯 Rounding Spot ₹{spot_ltp:.2f} to nearest multiple of {int(step)} -> Target Strike: {int(target_strike)} (Selected: {atm_strike})")
        else:
            mid_val = available_strikes[len(available_strikes)//2]
            target_strike = round(mid_val / step) * step
            atm_strike = min(available_strikes, key=lambda x: abs(x - target_strike))
    elif strike_mode == "MANUAL" or (manual_strike and float(manual_strike) > 0) or (raw_strike and raw_strike != "ATM" and raw_strike.replace(".", "").isdigit() and float(raw_strike) > 500):
        target_strike = float(manual_strike) if (manual_strike and float(manual_strike) > 0) else float(raw_strike)
        atm_strike = min(available_strikes, key=lambda x: abs(x - target_strike))
        log_straddle(f"[{strat.get('name')}] 🎯 Using Manual Strike: {int(target_strike)} (Selected Option Strike: {atm_strike})")
    else:
        # Standard ATM Strike (closest to Spot LTP)
        if spot_ltp > 0:
            atm_strike = min(available_strikes, key=lambda x: abs(x - spot_ltp))
        else:
            atm_strike = available_strikes[len(available_strikes) // 2]
        log_straddle(f"[{strat.get('name')}] 🎯 Using Standard ATM Strike for Spot ₹{spot_ltp:.2f} -> Selected Strike: {atm_strike}")

    strat["selected_strike"] = int(atm_strike) if atm_strike.is_integer() else atm_strike
    strat["strike_mode"] = strike_mode
    strat["strike_multiple"] = strike_multiple
    if manual_strike:
        strat["manual_strike"] = manual_strike

    # 4. Find CE and PE at ATM Strike
    ce_cand = next((i for i in candidates if float(i.get("strike", 0)) == atm_strike and i.get("instrument_type") == "CE"), None)
    pe_cand = next((i for i in candidates if float(i.get("strike", 0)) == atm_strike and i.get("instrument_type") == "PE"), None)

    if not ce_cand or not pe_cand:
        return False, f"Could not find matching CE & PE pair at ATM Strike {atm_strike}"

    ce_sym = ce_cand["tradingsymbol"]
    pe_sym = pe_cand["tradingsymbol"]

    strat["selected_ce"] = ce_sym
    strat["selected_pe"] = pe_sym

    # 5. Fetch live LTPs
    try:
        quote_keys = [f"{exchange}:{ce_sym}", f"{exchange}:{pe_sym}"]
        q = kite.ltp(quote_keys)
        ce_ltp = float(q.get(f"{exchange}:{ce_sym}", {}).get("last_price", 0.0))
        pe_ltp = float(q.get(f"{exchange}:{pe_sym}", {}).get("last_price", 0.0))
    except Exception as e:
        logger.warning(f"Error fetching ATM straddle quotes: {e}")
        ce_ltp = 100.0
        pe_ltp = 100.0

    strat["selected_ce_ltp"] = ce_ltp
    strat["selected_pe_ltp"] = pe_ltp

    # 6. Calculate Combined Total Premium, SL & Target
    init_total_prem = round(ce_ltp + pe_ltp, 2)
    strat["initial_total_premium"] = init_total_prem
    strat["current_total_premium"] = init_total_prem

    if entry_action == "SELL":
        # Short Straddle: SL when premium increases, Target when premium decreases
        sl_trigger_prem = round(init_total_prem * (1.0 + (total_sl_pct / 100.0)), 2)
        tp_trigger_prem = round(init_total_prem * (1.0 - (total_tp_pct / 100.0)), 2)
    else:
        # Long Straddle: SL when premium decreases, Target when premium increases
        sl_trigger_prem = round(init_total_prem * (1.0 - (total_sl_pct / 100.0)), 2)
        tp_trigger_prem = round(init_total_prem * (1.0 + (total_tp_pct / 100.0)), 2)

    strat["sl_trigger_premium"] = sl_trigger_prem
    strat["tp_trigger_premium"] = tp_trigger_prem

    global straddle_strategies_store
    target_in_store = next((s for s in straddle_strategies_store if s.get("id") == strat.get("id")), None)
    if target_in_store:
        target_in_store.update({
            "resolved_expiry": expiry,
            "selected_strike": strat["selected_strike"],
            "selected_ce": ce_sym,
            "selected_ce_ltp": ce_ltp,
            "selected_pe": pe_sym,
            "selected_pe_ltp": pe_ltp,
            "initial_total_premium": init_total_prem,
            "current_total_premium": init_total_prem,
            "sl_trigger_premium": sl_trigger_prem,
            "tp_trigger_premium": tp_trigger_prem
        })

    save_straddle_strategies(straddle_strategies_store)
    log_straddle(f"[{strat.get('name')}] 🎯 Straddle ATM Strike {strat['selected_strike']} Calculated (Expiry: {expiry}) | CE: {ce_sym} (₹{ce_ltp:.2f}) + PE: {pe_sym} (₹{pe_ltp:.2f}) = Total: ₹{init_total_prem:.2f} | SL @ ₹{sl_trigger_prem:.2f} ({total_sl_pct}%), Target @ ₹{tp_trigger_prem:.2f} ({total_tp_pct}%)")
    return True, f"ATM Strike {strat['selected_strike']} paired successfully (Total Prem: ₹{init_total_prem:.2f})"


# --------------------------------------------------------------------------
# Order Placement & Execution
# --------------------------------------------------------------------------
def place_straddle_orders_for(strat):
    """Places fresh multi-day straddle entry orders for CE and PE at the ATM strike."""
    kite = get_kite_client()
    if not kite:
        log_straddle(f"[{strat.get('name')}] Order placement failed: Not logged in.")
        return False, "Not logged in to Kite"

    sname = strat.get("name", "Straddle Total SL")
    ce_sym = strat.get("selected_ce")
    pe_sym = strat.get("selected_pe")
    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_straddle_exchange(instrument)
    qty = int(strat.get("quantity") or get_straddle_lot_size(instrument))
    product = strat.get("product", "NRML").upper()
    entry_action = strat.get("entry_action", "SELL").upper()
    total_sl_pct = float(strat.get("total_sl_percent", 100.0))
    total_tp_pct = float(strat.get("total_tp_percent", 50.0))

    if not ce_sym or not pe_sym:
        ok, msg = calculate_straddle_strikes_for(strat)
        if not ok:
            log_straddle(f"[{sname}] Cannot place orders: Strike calculation failed ({msg}).")
            return False, f"Strike calculation failed: {msg}"
        ce_sym = strat.get("selected_ce")
        pe_sym = strat.get("selected_pe")

    today_str = datetime.now().strftime("%m%d_%H%M")
    strat_id_suffix = strat.get("id", "")[-4:]
    pos_tag = f"std_{today_str}_{strat_id_suffix}"[:20]
    strat["run_tag"] = pos_tag

    total_actual_entry = 0.0

    for sym, opt_type in [(ce_sym, "CE"), (pe_sym, "PE")]:
        try:
            last_ltp = float(strat.get(f"selected_{opt_type.lower()}_ltp", 100.0) or 100.0)
            if entry_action == "BUY":
                order_price = round((last_ltp * 1.02) * 20) / 20
                entry_txn = kite.TRANSACTION_TYPE_BUY
            else:
                order_price = round((last_ltp * 0.98) * 20) / 20
                entry_txn = kite.TRANSACTION_TYPE_SELL

            log_pos_msg = f"[{sname}] Placing {entry_action} {sym} Qty:{qty} ({product}) on {exchange} Limit ₹{order_price:.2f}..."
            log_straddle(log_pos_msg)

            order_id = kite.place_order(
                variety=kite.VARIETY_REGULAR,
                exchange=exchange,
                tradingsymbol=sym,
                transaction_type=entry_txn,
                quantity=qty,
                product=product,
                order_type=kite.ORDER_TYPE_LIMIT,
                price=float(order_price),
                tag=pos_tag
            )
            log_straddle(f"[{sname}] {entry_action} {sym} Order Placed. ID: {order_id}")

            strat["orders"][opt_type]["symbol"] = sym
            strat["orders"][opt_type]["first_entry_price"] = last_ltp
            strat["orders"][opt_type]["entry_price"] = last_ltp
            strat["orders"][opt_type]["current_ltp"] = last_ltp
            strat["orders"][opt_type]["order_id"] = order_id
            strat["orders"][opt_type]["status"] = "ACTIVE"
            total_actual_entry += last_ltp

            # Record in pending straddle orders
            upsert_pending_straddle_order(f"{strat.get('id')}_{opt_type}_ENTRY", {
                "strategy_id": strat.get("id"),
                "strategy_name": sname,
                "instrument": instrument,
                "leg": opt_type,
                "purpose": "ENTRY",
                "symbol": sym,
                "exchange": exchange,
                "transaction_type": entry_txn,
                "quantity": qty,
                "product": product,
                "price": float(order_price),
                "broker_order_id": order_id,
                "status": "PLACED_ON_BROKER",
                "last_error": None
            })

        except Exception as e:
            log_straddle(f"[{sname}] Failed entry order placement for {sym}: {e}")

    init_tot_prem = round(total_actual_entry, 2)
    strat["initial_total_premium"] = init_tot_prem
    strat["current_total_premium"] = init_tot_prem

    if entry_action == "SELL":
        strat["sl_trigger_premium"] = round(init_tot_prem * (1.0 + (total_sl_pct / 100.0)), 2)
        strat["tp_trigger_premium"] = round(init_tot_prem * (1.0 - (total_tp_pct / 100.0)), 2)
    else:
        strat["sl_trigger_premium"] = round(init_tot_prem * (1.0 - (total_sl_pct / 100.0)), 2)
        strat["tp_trigger_premium"] = round(init_tot_prem * (1.0 + (total_tp_pct / 100.0)), 2)

    now_date = datetime.now().strftime("%Y-%m-%d")
    strat["orders"]["orders_placed"] = True
    strat["status"] = "Holding (Straddle ON)"
    strat["entry_date"] = now_date
    strat["last_sl_date"] = now_date

    global straddle_strategies_store
    target_in_store = next((s for s in straddle_strategies_store if s.get("id") == strat.get("id")), None)
    if target_in_store:
        target_in_store["orders"]["orders_placed"] = True
        target_in_store["status"] = "Holding (Straddle ON)"
        target_in_store["entry_date"] = now_date
        target_in_store["initial_total_premium"] = init_tot_prem
        target_in_store["sl_trigger_premium"] = strat["sl_trigger_premium"]
        target_in_store["tp_trigger_premium"] = strat["tp_trigger_premium"]

    save_straddle_strategies(straddle_strategies_store)
    record_straddle_trade_entry(strat)
    log_straddle(f"[{sname}] 🎉 Straddle Entry Complete! Combined Initial Total Premium: ₹{init_tot_prem:.2f} | Total SL @ ₹{strat['sl_trigger_premium']:.2f}, Target @ ₹{strat['tp_trigger_premium']:.2f}")
    return True, "Straddle entry orders placed successfully"


def squareoff_straddle_strategy_for(strat, reason="Manual"):
    """Squares off both CE and PE legs simultaneously for the straddle strategy."""
    kite = get_kite_client()
    if not kite:
        return False, "Not logged in"

    sname = strat.get("name", "Straddle Total SL")
    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_straddle_exchange(instrument)
    qty = int(strat.get("quantity") or get_straddle_lot_size(instrument))
    product = strat.get("product", "NRML").upper()
    entry_action = strat.get("entry_action", "SELL").upper()
    exit_txn = kite.TRANSACTION_TYPE_BUY if entry_action == "SELL" else kite.TRANSACTION_TYPE_SELL
    pos_tag = strat.get("run_tag") or "std_exit"

    log_straddle(f"[{sname}] ⚡ Squaring off Straddle ({reason})...")

    for leg in ["CE", "PE"]:
        sym = strat["orders"][leg].get("symbol")
        curr_ltp = strat["orders"][leg].get("current_ltp", 0.0)
        strat["orders"][leg]["exit_price"] = curr_ltp

        if sym and strat["orders"][leg].get("status") == "ACTIVE":
            try:
                oid = kite.place_order(
                    variety=kite.VARIETY_REGULAR,
                    exchange=exchange,
                    tradingsymbol=sym,
                    transaction_type=exit_txn,
                    quantity=qty,
                    product=product,
                    order_type=kite.ORDER_TYPE_MARKET,
                    tag=pos_tag
                )
                log_straddle(f"[{sname}] Market exit order placed for {leg} ({sym}) on {exchange}. Order ID: {oid}")
                strat["orders"][leg]["status"] = "SQUARED_OFF"
                remove_pending_straddle_order(f"{strat.get('id')}_{leg}_ENTRY")
            except Exception as e:
                log_straddle(f"[{sname}] Error placing exit order for {leg} ({sym}): {e}")

    strat["active"] = False
    strat["status"] = f"Squared Off ({reason})"
    strat["orders"]["orders_placed"] = False
    final_pnl = strat.get("pnl", 0.0)

    save_straddle_strategies(straddle_strategies_store)
    record_straddle_trade_exit(strat, final_pnl)
    return True, f"Straddle squared off for '{sname}' ({reason})"


# --------------------------------------------------------------------------
# Continuous Live Monitoring Loop
# --------------------------------------------------------------------------
def monitor_straddle_strategies_cycle():
    """
    Monitors live LTPs for straddles:
    1. Timed execution: Places Straddle ATM orders when entry_time is reached.
    2. Real-time combined total premium calculation (CE_LTP + PE_LTP).
    3. Evaluates Total Premium Stop Loss (%) and Target Profit (%) thresholds.
    4. Triggers simultaneous Market exit of both legs upon breach.
    """
    global straddle_strategies_store
    kite = get_kite_client()
    if not kite:
        return

    active_strats = [s for s in straddle_strategies_store if s.get("active")]
    if not active_strats:
        return

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    now_time = now.strftime("%H:%M:%S")

    # 1. Timed Entry Check
    for s in active_strats:
        sname = s.get("name", "Straddle Total SL")
        orders_data = s.setdefault("orders", {})
        orders_placed = orders_data.get("orders_placed", False)
        entry_t = s.get("entry_time", "15:00:00")
        exit_t = s.get("exit_time", "15:15:00")

        if not orders_placed:
            if now_time >= entry_t and now_time <= exit_t:
                log_straddle(f"[{sname}] ⏰ Scheduled Entry Time ({entry_t}) reached! Executing ATM Straddle Entry...")
                if not s.get("selected_ce") or not s.get("selected_pe"):
                    ok, msg = calculate_straddle_strikes_for(s)
                    if not ok:
                        log_straddle(f"[{sname}] ⚠️ ATM Strike calculation failed: {msg}. Retrying next cycle.")
                        continue
                place_straddle_orders_for(s)
            else:
                s["status"] = f"Awaiting Entry ({entry_t})"
                continue

    # 2. Quote Collection for Active Straddles
    symbols_to_quote = set()
    for s in active_strats:
        if s.get("orders", {}).get("orders_placed"):
            exch = get_straddle_exchange(s.get("index_name"))
            for leg in ["CE", "PE"]:
                sym = s["orders"][leg].get("symbol")
                if sym:
                    symbols_to_quote.add(f"{exch}:{sym}")

    if not symbols_to_quote:
        return

    try:
        quotes = kite.ltp(list(symbols_to_quote))
        for s in active_strats:
            if not s.get("orders", {}).get("orders_placed"):
                continue

            sname = s.get("name", "Straddle Total SL")
            exch = get_straddle_exchange(s.get("index_name"))
            qty = int(s.get("quantity") or get_straddle_lot_size(s.get("index_name")))
            entry_action = s.get("entry_action", "SELL").upper()
            init_tot_prem = float(s.get("initial_total_premium", 0.0))
            sl_trigger_prem = float(s.get("sl_trigger_premium", 0.0))
            tp_trigger_prem = float(s.get("tp_trigger_premium", 0.0))

            current_total_prem = 0.0
            total_pnl = 0.0

            for leg in ["CE", "PE"]:
                sym = s["orders"][leg].get("symbol")
                q_key = f"{exch}:{sym}"
                if sym and q_key in quotes:
                    curr_ltp = float(quotes[q_key]["last_price"])
                    s["orders"][leg]["current_ltp"] = curr_ltp
                    current_total_prem += curr_ltp
                    entry_p = float(s["orders"][leg].get("first_entry_price") or s["orders"][leg].get("entry_price", curr_ltp))

                    if entry_action == "SELL":
                        leg_pnl = (entry_p - curr_ltp) * qty
                    else:
                        leg_pnl = (curr_ltp - entry_p) * qty
                    total_pnl += leg_pnl

            s["current_total_premium"] = round(current_total_prem, 2)
            s["pnl"] = round(total_pnl, 2)
            s["unrealized_pnl"] = round(total_pnl, 2)
            s["last_checked"] = datetime.now().strftime("%H:%M:%S")
            record_straddle_running_pnl(s, total_pnl)

            # Check Total Premium Stop Loss & Target Profit
            if init_tot_prem > 0 and current_total_prem > 0:
                if entry_action == "SELL":
                    # SHORT STRADDLE
                    # Stop Loss: Combined premium increased to or above sl_trigger_prem
                    if current_total_prem >= sl_trigger_prem and sl_trigger_prem > 0:
                        log_straddle(f"[{sname}] 🛑 TOTAL PREMIUM STOP LOSS TRIGGERED! Combined Premium expanded from ₹{init_tot_prem:.2f} to ₹{current_total_prem:.2f} (SL Threshold: ₹{sl_trigger_prem:.2f}). Squaring off both legs...")
                        squareoff_straddle_strategy_for(s, reason=f"Total Premium SL Hit @ ₹{current_total_prem:.2f}")

                    # Target Profit: Combined premium decayed to or below tp_trigger_prem
                    elif current_total_prem <= tp_trigger_prem and tp_trigger_prem > 0:
                        log_straddle(f"[{sname}] 🎯 TOTAL PREMIUM TARGET PROFIT HIT! Combined Premium decayed from ₹{init_tot_prem:.2f} to ₹{current_total_prem:.2f} (Target Threshold: ₹{tp_trigger_prem:.2f}). Squaring off both legs...")
                        squareoff_straddle_strategy_for(s, reason=f"Total Premium Target Hit @ ₹{current_total_prem:.2f}")
                else:
                    # LONG STRADDLE
                    # Stop Loss: Combined premium decayed to or below sl_trigger_prem
                    if current_total_prem <= sl_trigger_prem and sl_trigger_prem > 0:
                        log_straddle(f"[{sname}] 🛑 TOTAL PREMIUM STOP LOSS TRIGGERED! Combined Premium dropped from ₹{init_tot_prem:.2f} to ₹{current_total_prem:.2f} (SL Threshold: ₹{sl_trigger_prem:.2f}). Squaring off both legs...")
                        squareoff_straddle_strategy_for(s, reason=f"Total Premium SL Hit @ ₹{current_total_prem:.2f}")

                    # Target Profit: Combined premium expanded to or above tp_trigger_prem
                    elif current_total_prem >= tp_trigger_prem and tp_trigger_prem > 0:
                        log_straddle(f"[{sname}] 🎯 TOTAL PREMIUM TARGET PROFIT HIT! Combined Premium expanded from ₹{init_tot_prem:.2f} to ₹{current_total_prem:.2f} (Target Threshold: ₹{tp_trigger_prem:.2f}). Squaring off both legs...")
                        squareoff_straddle_strategy_for(s, reason=f"Total Premium Target Hit @ ₹{current_total_prem:.2f}")

        save_straddle_strategies(straddle_strategies_store)
    except Exception as e:
        logger.error(f"Error in Straddle Total SL monitoring loop: {e}")


def straddle_total_sl_background_loop():
    """Dedicated background thread loop for Positional Straddle Total SL engine."""
    log_straddle("Straddle Total SL background thread online.")
    while True:
        try:
            monitor_straddle_strategies_cycle()
        except Exception as e:
            logger.error(f"Error in Straddle Total SL thread: {e}")
        time.sleep(4)


# Auto-start daemon worker thread on module import
_worker_thread = threading.Thread(target=straddle_total_sl_background_loop, daemon=True)
_worker_thread.start()

if __name__ == "__main__":
    print("\n--- Straddle Total SL Positional Engine ---")
    straddle_strategies_store = load_straddle_strategies()
    print(f"Loaded {len(straddle_strategies_store)} Straddle Total SL Strategies:")
    for s in straddle_strategies_store:
        print(f"  - [{s.get('index_name')}] {s.get('name')} (Status: {s.get('status')})")
    print("\nMonitoring active in background thread. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nExiting straddle_total_sl.py...")
