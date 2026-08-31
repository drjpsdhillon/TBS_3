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
    "strategy_type": "STRADDLE",  # "STRADDLE" | "STRANGLE" | "INDIVIDUAL_LEG" | "MULTI_LEG"
    "group_name": "Main Group",   # Custom user group for categorization
    "leg_selection": "BOTH",      # "BOTH" | "CE_ONLY" | "PE_ONLY"
    "entry_trigger_type": "CURRENT_PRICE", # "CURRENT_PRICE" | "PREMIUM_DECAY" | "SPECIFIC_PREMIUM"
    "trigger_decay_pct": 20.0,
    "trigger_premium_val": 0.0,
    "strike_mode": "ATM",         # "ATM" | "ROUND_OFF" | "MANUAL" | "PREMIUM"
    "strike_multiple": 500.0,
    "manual_strike": None,
    "ce_strike": None,
    "pe_strike": None,
    "ce_target_premium": 80.0,
    "pe_target_premium": 80.0,
    "quantity": 65,
    "entry_time": "15:00:00",
    "exit_time": "15:15:00",
    "morning_sl_time": "09:17:00",
    "entry_date": "",
    "last_sl_date": "",
    "sl_mode": "PERCENT",         # "PERCENT" | "POINTS"
    "sl_value": 100.0,
    "tp_mode": "PERCENT",         # "PERCENT" | "POINTS"
    "tp_value": 50.0,
    "total_sl_percent": 100.0,
    "total_tp_percent": 50.0,
    "enable_tsl": False,
    "tsl_type": "POINTS",         # "POINTS" | "PERCENT"
    "tsl_value": 10.0,
    "tsl_step": 10.0,
    "tsl_reference_prem": 0.0,
    "best_total_prem": 0.0,
    "current_sl_trigger_prem": 0.0,
    "base_spot_entry": 0.0,
    "initial_total_premium": 0.0,
    "current_total_premium": 0.0,
    "sl_trigger_premium": 0.0,
    "tp_trigger_premium": 0.0,
    "custom_legs": [],            # Optional array of arbitrary legs for multi-leg strategies
    "orders": {
        "CE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"},
        "PE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"},
        "orders_placed": False
    },
    "adjustments": {
        "enabled": False,
        "mode": "AUTOMATIC",  # "AUTOMATIC" | "MANUAL" | "SPOT_DISTANCE"
        "auto_config": {
            "trigger_decay_percent": 20.0,
            "max_adjustments": 3,
            "ce_adjustments_done": 0,
            "pe_adjustments_done": 0,
            "lots": 1,
            "sl_type": "PERCENT",
            "sl_value": 30.0,
            "enable_tsl": True,
            "tsl_type": "POINTS",
            "tsl_value": 10.0,
            "tsl_step": 10.0
        },
        "spot_distance_config": {
            "move_step_pts": 500.0,
            "strike_offset_pts": 2000.0,
            "round_multiple": 500.0,
            "action": "SELL",
            "lots": 1,
            "max_adjustments": 5,
            "up_adjustments_done": 0,
            "down_adjustments_done": 0,
            "sl_type": "PERCENT",
            "sl_value": 30.0,
            "enable_tsl": True,
            "tsl_type": "POINTS",
            "tsl_value": 10.0,
            "tsl_step": 10.0
        },
        "manual_legs": [],
        "active_orders": {}
    },
    "selected_ce": None,
    "selected_ce_ltp": 0.0,
    "selected_pe": None,
    "selected_pe_ltp": 0.0,
    "underlying_type": "CASH",    # "CASH" | "CURRENT_FUT" | "NEXT_FUT" | "FAR_FUT"
    "underlying_name": "Cash Spot",
    "underlying_symbol": None,
    "underlying_ltp": 0.0,
    "underlying_future_expiry": None,
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
        s.setdefault("underlying_type", "CASH")
        s.setdefault("underlying_name", "Cash Spot")
        s.setdefault("underlying_symbol", None)
        s.setdefault("underlying_ltp", 0.0)
        s.setdefault("underlying_future_expiry", None)
        s.setdefault("orders", {})
        s["orders"].setdefault("orders_placed", False)
        s["orders"].setdefault("CE", {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"})
        s["orders"].setdefault("PE", {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "exit_price": 0.0, "order_id": None, "status": "PENDING"})
        
        # Adjustment data fills
        s.setdefault("adjustments", {
            "enabled": False,
            "mode": "AUTOMATIC",
            "auto_config": {
                "trigger_decay_percent": 20.0,
                "lots": 1,
                "sl_type": "PERCENT",
                "sl_value": 30.0,
                "enable_tsl": True,
                "tsl_type": "POINTS",
                "tsl_value": 10.0,
                "tsl_step": 10.0,
                "ce_triggered": False,
                "pe_triggered": False
            },
            "manual_legs": [],
            "active_orders": {}
        })
        adj = s["adjustments"]
        adj.setdefault("enabled", False)
        adj.setdefault("mode", "AUTOMATIC")
        adj.setdefault("auto_config", {
            "trigger_decay_percent": 20.0,
            "lots": 1,
            "sl_type": "PERCENT",
            "sl_value": 30.0,
            "enable_tsl": True,
            "tsl_type": "POINTS",
            "tsl_value": 10.0,
            "tsl_step": 10.0,
            "ce_triggered": False,
            "pe_triggered": False
        })
        adj.setdefault("manual_legs", [])
        adj.setdefault("active_orders", {})

    return straddle_strategies_store


def save_straddle_strategies(strategies_list):
    """Saves configured Straddle Total SL strategies to JSON."""
    try:
        with open(STRADDLE_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(strategies_list, f, indent=4)
    except Exception as e:
        logger.error(f"Error saving {STRADDLE_CONFIG_FILE}: {e}")


# --------------------------------------------------------------------------
# Kite Client, Option & Future Instruments Caching
# --------------------------------------------------------------------------
kite_instance = None
instruments_cache = []
futures_cache = []
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
    global instruments_cache, futures_cache, cache_date
    kite = get_kite_client()
    if not kite:
        return []
    today_str = datetime.today().strftime("%Y-%m-%d")
    if instruments_cache and cache_date == today_str:
        return instruments_cache
    try:
        log_straddle("Downloading Option and Future instruments for Straddle engine...")
        inst_nfo = kite.instruments("NFO")
        opt_nfo = [i for i in inst_nfo if i.get("segment") == "NFO-OPT"]
        fut_nfo = [i for i in inst_nfo if i.get("segment") == "NFO-FUT" or i.get("instrument_type") == "FUT"]
        try:
            inst_bfo = kite.instruments("BFO")
            opt_bfo = [i for i in inst_bfo if i.get("segment") == "BFO-OPT"]
            fut_bfo = [i for i in inst_bfo if i.get("segment") == "BFO-FUT" or i.get("instrument_type") == "FUT"]
        except Exception:
            opt_bfo = []
            fut_bfo = []
        instruments_cache = opt_nfo + opt_bfo
        futures_cache = fut_nfo + fut_bfo
        cache_date = today_str
        log_straddle(f"Cached {len(instruments_cache)} Option and {len(futures_cache)} Future contracts.")
        return instruments_cache
    except Exception as e:
        log_straddle(f"Error caching instruments: {e}")
        return []


def get_available_futures_for_index(index_name):
    """
    Returns sorted future contracts list for the given index:
    [
        {"label": "Current Month Future", "expiry": "2026-09-24", "symbol": "NIFTY26SEPFUT", "tradingsymbol": "NIFTY26SEPFUT", "exchange": "NFO"},
        ...
    ]
    """
    cache_instruments()
    global futures_cache
    idx = str(index_name or "NIFTY").strip().upper()
    today = date.today()
    
    candidates = []
    for f in futures_cache:
        name = str(f.get("name") or "").strip().upper()
        if name == idx or (idx == "BANKNIFTY" and name == "BANKNIFTY") or (idx == "FINNIFTY" and name == "FINNIFTY") or (idx == "MIDCPNIFTY" and ("MIDCP" in name or "MIDCAP" in name)) or (idx == "SENSEX" and name == "SENSEX") or (idx == "BANKEX" and name == "BANKEX"):
            exp = f.get("expiry")
            if exp:
                exp_date = exp if isinstance(exp, date) else datetime.strptime(str(exp), "%Y-%m-%d").date()
                if exp_date >= today:
                    candidates.append({
                        "expiry_date": exp_date,
                        "expiry": exp_date.strftime("%Y-%m-%d"),
                        "symbol": f.get("tradingsymbol"),
                        "exchange": f.get("segment", "NFO").split("-")[0] if "-" in f.get("segment", "") else ("BFO" if idx in ("SENSEX", "BANKEX") else "NFO")
                    })

    # Sort ascending by expiry date
    candidates.sort(key=lambda x: x["expiry_date"])
    
    # Deduplicate by expiry
    unique_futs = []
    seen_exp = set()
    for c in candidates:
        if c["expiry"] not in seen_exp:
            seen_exp.add(c["expiry"])
            unique_futs.append(c)

    # Assign friendly identifiers
    labels = ["Current Month Future", "Next Month Future", "Far Month Future"]
    for i, fut in enumerate(unique_futs):
        lbl = labels[i] if i < len(labels) else f"Future #{i+1}"
        fut["label"] = f"{lbl} ({fut['expiry']})"
        fut["key"] = f"FUT_{i+1}"

    return unique_futs


def get_underlying_price_and_expiry(index_name, underlying_type="CASH"):
    """
    Fetches the live LTP and contract details for the specified underlying:
    underlying_type: 'CASH' | 'CURRENT_FUT' | 'NEXT_FUT' | 'FAR_FUT' | or explicit future symbol
    Returns: (ltp, symbol, expiry_str, display_name)
    """
    kite = get_kite_client()
    idx_name = str(index_name or "NIFTY").upper()
    u_type = str(underlying_type or "CASH").strip().upper()

    if u_type in ("CASH", "SPOT", "INDEX"):
        spot_sym = get_spot_symbol(idx_name)
        ltp = 0.0
        if kite:
            try:
                q = kite.ltp([spot_sym])
                ltp = float(q.get(spot_sym, {}).get("last_price", 0.0))
            except Exception as e:
                logger.warning(f"Error fetching spot LTP for {spot_sym}: {e}")
        return ltp, spot_sym, None, f"Cash Spot ({spot_sym})"

    # Futures handling
    futs = get_available_futures_for_index(idx_name)
    selected_fut = None

    if u_type in ("CURRENT_FUT", "CURRENT_FUTURE", "FUT_1", "NEAR_FUT"):
        if len(futs) > 0:
            selected_fut = futs[0]
    elif u_type in ("NEXT_FUT", "NEXT_FUTURE", "FUT_2"):
        if len(futs) > 1:
            selected_fut = futs[1]
        elif len(futs) > 0:
            selected_fut = futs[0]
    elif u_type in ("FAR_FUT", "FAR_FUTURE", "NEXT_NEXT_FUT", "NEXT_NEXT_FUTURE", "FUT_3"):
        if len(futs) > 2:
            selected_fut = futs[2]
        elif len(futs) > 1:
            selected_fut = futs[1]
        elif len(futs) > 0:
            selected_fut = futs[0]
    else:
        # Check if u_type matches a specific symbol or expiry
        for f in futs:
            if f["symbol"].upper() == u_type or f["expiry"] == u_type:
                selected_fut = f
                break
        if not selected_fut and len(futs) > 0:
            selected_fut = futs[0]

    if not selected_fut:
        # Fallback to Cash Spot
        return get_underlying_price_and_expiry(idx_name, "CASH")

    exch = selected_fut["exchange"]
    sym = selected_fut["symbol"]
    exp_str = selected_fut["expiry"]
    query_key = f"{exch}:{sym}"
    ltp = 0.0

    if kite:
        try:
            q = kite.ltp([query_key])
            ltp = float(q.get(query_key, {}).get("last_price", 0.0))
        except Exception as e:
            logger.warning(f"Error fetching future LTP for {query_key}: {e}")

    display_name = f"{selected_fut.get('label', sym)} [{sym}]"
    return ltp, query_key, exp_str, display_name


def resolve_straddle_option_symbol(index_name, expiry_str, strike_price, option_type):
    """Finds exact trading symbol for a given index, expiry, strike and CE/PE."""
    inst_list = cache_instruments()
    if not inst_list:
        return None
    idx_name = str(index_name or "NIFTY").upper()
    exp_target = str(expiry_str or "").strip()
    try:
        strike_val = float(strike_price)
    except Exception:
        return None
    opt_type_upper = str(option_type or "CE").upper()

    match = next((
        i["tradingsymbol"] for i in inst_list
        if i.get("name") == idx_name
        and str(i.get("expiry")).strip() == exp_target
        and float(i.get("strike", 0)) == strike_val
        and i.get("instrument_type") == opt_type_upper
    ), None)
    return match


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

    # 1. Fetch Underlying Price (Cash Spot or Selected Futures Contract)
    u_type = strat.get("underlying_type") or "CASH"
    spot_ltp, u_symbol, u_expiry, u_display = get_underlying_price_and_expiry(idx_name, u_type)
    strat["underlying_ltp"] = spot_ltp
    strat["underlying_calc_ltp"] = spot_ltp
    strat["underlying_symbol"] = u_symbol
    strat["underlying_future_expiry"] = u_expiry
    strat["underlying_name"] = u_display
    strat["underlying_type"] = u_type
    if not strat.get("base_spot_entry") or float(strat.get("base_spot_entry") or 0.0) <= 0:
        strat["base_spot_entry"] = spot_ltp
        strat["entry_underlying_ltp"] = spot_ltp
        strat["underlying_min_ltp"] = spot_ltp
        strat["underlying_max_ltp"] = spot_ltp
    log_straddle(f"[{strat.get('name')}] Selected Underlying: {u_display} | Live LTP: ₹{spot_ltp:.2f}")

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

    # 3. Determine Strategy Type and Leg Selection
    strat_type = str(strat.get("strategy_type") or "STRADDLE").upper()
    leg_sel = str(strat.get("leg_selection") or "BOTH").upper()
    if strat_type == "INDIVIDUAL_LEG":
        if leg_sel not in ("CE_ONLY", "PE_ONLY"):
            leg_sel = "CE_ONLY"
    else:
        leg_sel = "BOTH"

    strike_mode = str(strat.get("strike_mode") or "ATM").upper()
    try:
        strike_multiple = float(strat.get("strike_multiple") or 500.0)
    except Exception:
        strike_multiple = 500.0

    manual_strike_val = None
    try:
        m_val = strat.get("manual_strike")
        if m_val is not None and str(m_val).strip() != "" and str(m_val).strip().upper() != "ATM":
            manual_strike_val = float(m_val)
    except Exception:
        manual_strike_val = None

    ce_strike_val = None
    try:
        c_val = strat.get("ce_strike")
        if c_val is not None and str(c_val).strip() != "" and str(c_val).strip().upper() != "ATM":
            ce_strike_val = float(c_val)
    except Exception:
        ce_strike_val = None

    pe_strike_val = None
    try:
        p_val = strat.get("pe_strike")
        if p_val is not None and str(p_val).strip() != "" and str(p_val).strip().upper() != "ATM":
            pe_strike_val = float(p_val)
    except Exception:
        pe_strike_val = None

    raw_strike = str(strat.get("strike") or "").strip().upper()

    ce_candidates = [i for i in candidates if i.get("instrument_type") == "CE" and float(i.get("strike", 0)) > 0]
    pe_candidates = [i for i in candidates if i.get("instrument_type") == "PE" and float(i.get("strike", 0)) > 0]
    available_ce_strikes = sorted(list({float(i.get("strike", 0)) for i in ce_candidates}))
    available_pe_strikes = sorted(list({float(i.get("strike", 0)) for i in pe_candidates}))
    all_strikes = sorted(list(set(available_ce_strikes + available_pe_strikes)))

    selected_ce_strike = None
    selected_pe_strike = None

    if strat_type == "STRANGLE":
        # Strangle: Distinct CE & PE Strikes (either manual strikes, strike multiple offsets, or premium target)
        if strike_mode == "PREMIUM":
            # Find strikes closest to target premium
            ce_target_prem = float(strat.get("ce_target_premium") or 80.0)
            pe_target_prem = float(strat.get("pe_target_premium") or 80.0)
            try:
                ce_symbols = [f"{exchange}:{i['tradingsymbol']}" for i in ce_candidates[:40]]
                pe_symbols = [f"{exchange}:{i['tradingsymbol']}" for i in pe_candidates[:40]]
                all_quotes = kite.ltp(ce_symbols + pe_symbols)
                
                best_ce = min(ce_candidates, key=lambda c: abs(float(all_quotes.get(f"{exchange}:{c['tradingsymbol']}", {}).get("last_price", 9999)) - ce_target_prem))
                best_pe = min(pe_candidates, key=lambda p: abs(float(all_quotes.get(f"{exchange}:{p['tradingsymbol']}", {}).get("last_price", 9999)) - pe_target_prem))
                selected_ce_strike = float(best_ce["strike"])
                selected_pe_strike = float(best_pe["strike"])
                log_straddle(f"[{strat.get('name')}] 🎯 Premium Target Strangle: CE Strike {selected_ce_strike} (Target: ₹{ce_target_prem}) | PE Strike {selected_pe_strike} (Target: ₹{pe_target_prem})")
            except Exception as e:
                logger.warning(f"Premium search fallback: {e}")
                selected_ce_strike = min(available_ce_strikes, key=lambda x: abs(x - (spot_ltp + 300)))
                selected_pe_strike = min(available_pe_strikes, key=lambda x: abs(x - (spot_ltp - 300)))
        elif ce_strike_val is not None and pe_strike_val is not None:
            selected_ce_strike = min(available_ce_strikes, key=lambda x: abs(x - ce_strike_val))
            selected_pe_strike = min(available_pe_strikes, key=lambda x: abs(x - pe_strike_val))
            log_straddle(f"[{strat.get('name')}] 🎯 Custom Strangle Strikes: CE {selected_ce_strike} & PE {selected_pe_strike}")
        else:
            # Default Strangle: OTM CE (+1 step) & OTM PE (-1 step)
            step = strike_multiple if strike_multiple > 0 else (100.0 if "NIFTY" in idx_name else 500.0)
            target_ce = spot_ltp + step
            target_pe = spot_ltp - step
            selected_ce_strike = min(available_ce_strikes, key=lambda x: abs(x - target_ce))
            selected_pe_strike = min(available_pe_strikes, key=lambda x: abs(x - target_pe))
            log_straddle(f"[{strat.get('name')}] 🎯 OTM Strangle: CE {selected_ce_strike} (Spot+{step}) | PE {selected_pe_strike} (Spot-{step})")

        atm_strike = f"CE:{int(selected_ce_strike)}/PE:{int(selected_pe_strike)}"

    else:
        # STRADDLE or INDIVIDUAL_LEG (Single Strike Mode)
        raw_numeric_strike = None
        try:
            if raw_strike and raw_strike != "ATM" and not raw_strike.startswith("ROUND") and not raw_strike.startswith("MULT"):
                raw_numeric_strike = float(raw_strike)
        except Exception:
            raw_numeric_strike = None

        if strike_mode == "ROUND_OFF" or raw_strike.startswith("ROUND") or raw_strike.startswith("MULT"):
            step = strike_multiple if strike_multiple > 0 else 500.0
            target_strike = round(spot_ltp / step) * step if spot_ltp > 0 else all_strikes[len(all_strikes)//2]
            atm_val = min(all_strikes, key=lambda x: abs(x - target_strike))
            log_straddle(f"[{strat.get('name')}] 🎯 Rounding Spot ₹{spot_ltp:.2f} to nearest multiple of {int(step)} -> Target Strike: {int(target_strike)} (Selected: {atm_val})")
        elif strike_mode == "MANUAL" or (manual_strike_val and manual_strike_val > 0) or (raw_numeric_strike and raw_numeric_strike > 500):
            target_strike = manual_strike_val if (manual_strike_val and manual_strike_val > 0) else raw_numeric_strike
            atm_val = min(all_strikes, key=lambda x: abs(x - target_strike))
            log_straddle(f"[{strat.get('name')}] 🎯 Using Manual Strike: {int(target_strike)} (Selected: {atm_val})")
        else:
            atm_val = min(all_strikes, key=lambda x: abs(x - spot_ltp)) if spot_ltp > 0 else all_strikes[len(all_strikes) // 2]
            log_straddle(f"[{strat.get('name')}] 🎯 Using ATM Strike for Spot ₹{spot_ltp:.2f} -> Selected Strike: {atm_val}")

        selected_ce_strike = atm_val
        selected_pe_strike = atm_val
        atm_strike = int(atm_val) if atm_val.is_integer() else atm_val

    strat["selected_strike"] = atm_strike
    strat["strategy_type"] = strat_type
    strat["leg_selection"] = leg_sel
    strat["strike_mode"] = strike_mode
    strat["strike_multiple"] = strike_multiple

    ce_sym = None
    pe_sym = None
    ce_ltp = 0.0
    pe_ltp = 0.0

    # 4. Resolve Symbols based on leg_selection
    if leg_sel in ("BOTH", "CE_ONLY"):
        ce_cand = next((i for i in candidates if float(i.get("strike", 0)) == selected_ce_strike and i.get("instrument_type") == "CE"), None)
        if not ce_cand:
            return False, f"Could not find CE at Strike {selected_ce_strike}"
        ce_sym = ce_cand["tradingsymbol"]
        strat["selected_ce"] = ce_sym
    else:
        strat["selected_ce"] = None

    if leg_sel in ("BOTH", "PE_ONLY"):
        pe_cand = next((i for i in candidates if float(i.get("strike", 0)) == selected_pe_strike and i.get("instrument_type") == "PE"), None)
        if not pe_cand:
            return False, f"Could not find PE at Strike {selected_pe_strike}"
        pe_sym = pe_cand["tradingsymbol"]
        strat["selected_pe"] = pe_sym
    else:
        strat["selected_pe"] = None

    # 5. Fetch live LTPs
    quote_keys = []
    if ce_sym: quote_keys.append(f"{exchange}:{ce_sym}")
    if pe_sym: quote_keys.append(f"{exchange}:{pe_sym}")

    try:
        if quote_keys:
            q = kite.ltp(quote_keys)
            if ce_sym: ce_ltp = float(q.get(f"{exchange}:{ce_sym}", {}).get("last_price", 0.0))
            if pe_sym: pe_ltp = float(q.get(f"{exchange}:{pe_sym}", {}).get("last_price", 0.0))
    except Exception as e:
        logger.warning(f"Error fetching quotes: {e}")
        if ce_sym: ce_ltp = 100.0
        if pe_sym: pe_ltp = 100.0

    # 6. Calculate Initial Total Premium & SL/Target thresholds
    if leg_sel == "CE_ONLY":
        init_total_prem = round(ce_ltp, 2)
    elif leg_sel == "PE_ONLY":
        init_total_prem = round(pe_ltp, 2)
    else:
        init_total_prem = round(ce_ltp + pe_ltp, 2)

    strat["initial_total_premium"] = init_total_prem
    strat["current_total_premium"] = init_total_prem

    sl_mode = str(strat.get("sl_mode") or "PERCENT").upper()
    sl_val = float(strat.get("sl_value") if strat.get("sl_value") is not None else strat.get("total_sl_percent", 100.0))
    tp_mode = str(strat.get("tp_mode") or "PERCENT").upper()
    tp_val = float(strat.get("tp_value") if strat.get("tp_value") is not None else strat.get("total_tp_percent", 50.0))

    if entry_action == "SELL":
        # Short Straddle / Short Single Leg
        if sl_mode == "POINTS":
            sl_trigger_prem = round(init_total_prem + sl_val, 2)
        else:
            sl_trigger_prem = round(init_total_prem * (1.0 + (sl_val / 100.0)), 2)

        if tp_mode == "POINTS":
            tp_trigger_prem = round(max(0.05, init_total_prem - tp_val), 2)
        else:
            tp_trigger_prem = round(max(0.05, init_total_prem * (1.0 - (tp_val / 100.0))), 2)
    else:
        # Long Straddle / Long Single Leg
        if sl_mode == "POINTS":
            sl_trigger_prem = round(max(0.05, init_total_prem - sl_val), 2)
        else:
            sl_trigger_prem = round(max(0.05, init_total_prem * (1.0 - (sl_val / 100.0))), 2)

        if tp_mode == "POINTS":
            tp_trigger_prem = round(init_total_prem + tp_val, 2)
        else:
            tp_trigger_prem = round(init_total_prem * (1.0 + (tp_val / 100.0)), 2)

    strat["sl_trigger_premium"] = sl_trigger_prem
    strat["tp_trigger_premium"] = tp_trigger_prem
    strat["current_sl_trigger_prem"] = sl_trigger_prem
    strat["tsl_reference_prem"] = init_total_prem
    strat["best_total_prem"] = init_total_prem

    global straddle_strategies_store
    target_in_store = next((s for s in straddle_strategies_store if s.get("id") == strat.get("id")), None)
    if target_in_store:
        target_in_store.update({
            "strategy_type": strat_type,
            "leg_selection": leg_sel,
            "resolved_expiry": expiry,
            "selected_strike": strat["selected_strike"],
            "selected_ce": ce_sym,
            "selected_ce_ltp": ce_ltp,
            "selected_pe": pe_sym,
            "selected_pe_ltp": pe_ltp,
            "initial_total_premium": init_total_prem,
            "current_total_premium": init_total_prem,
            "sl_trigger_premium": sl_trigger_prem,
            "tp_trigger_premium": tp_trigger_prem,
            "current_sl_trigger_prem": sl_trigger_prem,
            "tsl_reference_prem": init_total_prem,
            "best_total_prem": init_total_prem
        })

    save_straddle_strategies(straddle_strategies_store)
    log_straddle(f"[{strat.get('name')}] 🎯 {strat_type} ({leg_sel}) Strikes {strat['selected_strike']} Calculated (Expiry: {expiry}) | CE: {ce_sym or '--'} (₹{ce_ltp:.2f}) + PE: {pe_sym or '--'} (₹{pe_ltp:.2f}) = Total: ₹{init_total_prem:.2f} | SL @ ₹{sl_trigger_prem:.2f} ({sl_val} {sl_mode}), Target @ ₹{tp_trigger_prem:.2f} ({tp_val} {tp_mode})")
    return True, f"{strat_type} ({leg_sel}) Strike(s) {strat['selected_strike']} setup successfully (Total Prem: ₹{init_total_prem:.2f})"


# --------------------------------------------------------------------------
# Order Placement & Execution
# --------------------------------------------------------------------------
def place_straddle_orders_for(strat):
    """Places fresh multi-day straddle/strangle/individual leg entry orders for configured legs."""
    kite = get_kite_client()
    if not kite:
        log_straddle(f"[{strat.get('name')}] Order placement failed: Not logged in.")
        return False, "Not logged in to Kite"

    sname = strat.get("name", "Straddle Total SL")
    leg_sel = str(strat.get("leg_selection") or "BOTH").upper()
    ce_sym = strat.get("selected_ce")
    pe_sym = strat.get("selected_pe")
    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_straddle_exchange(instrument)
    qty = int(strat.get("quantity") or get_straddle_lot_size(instrument))
    product = strat.get("product", "NRML").upper()
    entry_action = strat.get("entry_action", "SELL").upper()

    if (leg_sel in ("BOTH", "CE_ONLY") and not ce_sym) or (leg_sel in ("BOTH", "PE_ONLY") and not pe_sym):
        ok, msg = calculate_straddle_strikes_for(strat)
        if not ok:
            log_straddle(f"[{sname}] Cannot place orders: Strike calculation failed ({msg}).")
            return False, f"Strike calculation failed: {msg}"
    # Record entry underlying LTP (Cash Spot or chosen Future)
    u_type = strat.get("underlying_type") or "CASH"
    entry_underlying_ltp, u_sym, u_exp, u_disp = get_underlying_price_and_expiry(instrument, u_type)
    if entry_underlying_ltp <= 0:
        # Fallback to spot
        spot_sym = get_spot_symbol(instrument)
        try:
            q_spot = kite.ltp([spot_sym])
            entry_underlying_ltp = float(q_spot.get(spot_sym, {}).get("last_price", 0.0))
        except Exception:
            pass

    strat["base_spot_entry"] = entry_underlying_ltp
    strat["entry_underlying_ltp"] = entry_underlying_ltp
    strat["underlying_min_ltp"] = entry_underlying_ltp
    strat["underlying_max_ltp"] = entry_underlying_ltp
    strat["underlying_symbol"] = u_sym
    strat["underlying_name"] = u_disp
    log_straddle(f"[{sname}] 📌 Recorded Underlying Entry Reference for {instrument} ({u_disp}): ₹{entry_underlying_ltp:.2f}")

    today_str = datetime.now().strftime("%m%d_%H%M")
    strat_id_suffix = strat.get("id", "")[-4:]
    pos_tag = f"std_{today_str}_{strat_id_suffix}"[:20]
    strat["run_tag"] = pos_tag

    total_actual_entry = 0.0

    legs_to_place = []
    if leg_sel in ("BOTH", "CE_ONLY") and ce_sym:
        legs_to_place.append((ce_sym, "CE"))
    if leg_sel in ("BOTH", "PE_ONLY") and pe_sym:
        legs_to_place.append((pe_sym, "PE"))

    for sym, opt_type in legs_to_place:
        try:
            last_ltp = float(strat.get(f"selected_{opt_type.lower()}_ltp", 100.0) or 100.0)
            best_bid_price = 0.0
            best_bid_qty = 0
            best_ask_price = 0.0
            best_ask_qty = 0

            # Query live quote / market depth for best bid and ask prices and quantities
            try:
                quote_res = kite.quote([f"{exchange}:{sym}"])
                inst_quote = quote_res.get(f"{exchange}:{sym}", {})
                if inst_quote.get("last_price"):
                    last_ltp = float(inst_quote["last_price"])
                depth_bids = inst_quote.get("depth", {}).get("buy", [])
                if depth_bids and depth_bids[0].get("price", 0) > 0:
                    best_bid_price = float(depth_bids[0]["price"])
                    best_bid_qty = int(depth_bids[0].get("quantity", 0))
                depth_asks = inst_quote.get("depth", {}).get("sell", [])
                if depth_asks and depth_asks[0].get("price", 0) > 0:
                    best_ask_price = float(depth_asks[0]["price"])
                    best_ask_qty = int(depth_asks[0].get("quantity", 0))
            except Exception as q_err:
                logger.warning(f"[{sname}] Quote query for {sym} notice: {q_err}")

            if entry_action == "SELL":
                # For SELL order: fetch best offer / ask price and send limit order with 1% less than ask price
                base_price = best_ask_price if best_ask_price > 0 else float(last_ltp)
                entry_txn = kite.TRANSACTION_TYPE_SELL
                order_price = round((base_price * 0.99) * 20) / 20

                log_pos_msg = f"[{sname}] Placing SELL Limit Order for {sym} Qty:{qty} ({product}) on {exchange} (Best Ask: ₹{best_ask_price:.2f} [Depth Qty: {best_ask_qty}], Base: ₹{base_price:.2f} -> Limit Order: ₹{order_price:.2f} [-1%])..."
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
                actual_price = base_price
            else:
                # For BUY order: fetch best offer / ask price and send with 1% higher limit price
                base_price = best_ask_price if best_ask_price > 0 else float(last_ltp)
                entry_txn = kite.TRANSACTION_TYPE_BUY
                entry_limit = round((base_price * 1.01) * 20) / 20

                log_pos_msg = f"[{sname}] Placing BUY Limit Order for {sym} Qty:{qty} ({product}) on {exchange} (Best Ask: ₹{best_ask_price:.2f} [Depth Qty: {best_ask_qty}], Base: ₹{base_price:.2f} -> Limit: ₹{entry_limit:.2f} [+1%])..."
                log_straddle(log_pos_msg)

                order_id = kite.place_order(
                    variety=kite.VARIETY_REGULAR,
                    exchange=exchange,
                    tradingsymbol=sym,
                    transaction_type=entry_txn,
                    quantity=qty,
                    product=product,
                    order_type=kite.ORDER_TYPE_LIMIT,
                    price=float(entry_limit),
                    tag=pos_tag
                )
                actual_price = base_price

            log_straddle(f"[{sname}] ✅ Placed entry order {order_id} for {sym} ({opt_type}) @ ~₹{actual_price:.2f}")

            strat["orders"][opt_type] = {
                "symbol": sym,
                "first_entry_price": actual_price,
                "entry_price": actual_price,
                "current_ltp": actual_price,
                "exit_price": 0.0,
                "order_id": order_id,
                "status": "ENTERED"
            }
            total_actual_entry += actual_price

        except Exception as e:
            logger.error(f"[{sname}] Failed placing order for {sym}: {e}")
            strat["orders"][opt_type]["status"] = f"FAILED: {str(e)[:40]}"

    strat["orders"]["orders_placed"] = True
    strat["status"] = "Holding (Position ON)"
    now_date = datetime.now().strftime("%Y-%m-%d")
    strat["entry_date"] = now_date
    strat["last_sl_date"] = now_date

    global straddle_strategies_store
    target_in_store = next((s for s in straddle_strategies_store if s.get("id") == strat.get("id")), None)
    if target_in_store:
        target_in_store.update({
            "orders": strat["orders"],
            "status": strat["status"],
            "entry_date": now_date,
            "last_sl_date": now_date,
            "base_spot_entry": strat.get("base_spot_entry", 0.0),
            "initial_total_premium": strat["initial_total_premium"],
            "current_total_premium": strat["current_total_premium"],
            "sl_trigger_premium": strat["sl_trigger_premium"],
            "tp_trigger_premium": strat["tp_trigger_premium"],
            "current_sl_trigger_prem": strat["current_sl_trigger_prem"],
            "tsl_reference_prem": strat["tsl_reference_prem"],
            "best_total_prem": strat["best_total_prem"]
        })

    save_straddle_strategies(straddle_strategies_store)
    record_straddle_trade_entry(strat)
    log_straddle(f"[{sname}] 🚀 Fresh multi-day entry placed! Initial Total Prem: ₹{strat['initial_total_premium']:.2f} | SL: ₹{strat['sl_trigger_premium']:.2f}, Target: ₹{strat['tp_trigger_premium']:.2f}")
    return True, "Orders placed successfully"


def squareoff_straddle_adjustment_leg(strat, leg_id, reason="Manual"):
    """Squares off a specific active adjustment leg."""
    kite = get_kite_client()
    if not kite:
        return False, "Not logged in"

    sname = strat.get("name", "Straddle Total SL")
    adj = strat.setdefault("adjustments", {})
    active_orders = adj.setdefault("active_orders", {})
    leg_data = active_orders.get(leg_id)
    if not leg_data or leg_data.get("status") != "ACTIVE":
        return False, f"Adjustment leg '{leg_id}' is not active"

    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_straddle_exchange(instrument)
    sym = leg_data.get("symbol")
    qty = int(leg_data.get("quantity") or get_straddle_lot_size(instrument))
    product = leg_data.get("product") or strat.get("product", "NRML").upper()
    action = leg_data.get("action", "SELL").upper()
    exit_txn = kite.TRANSACTION_TYPE_BUY if action == "SELL" else kite.TRANSACTION_TYPE_SELL
    pos_tag = strat.get("run_tag") or "adj_exit"
    curr_ltp = float(leg_data.get("current_ltp", 0.0))

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
        leg_data["status"] = "SQUARED_OFF"
        leg_data["exit_price"] = curr_ltp
        leg_data["exit_reason"] = reason
        remove_pending_straddle_order(f"{strat.get('id')}_{leg_id}_ADJ")
        log_straddle(f"[{sname}] ⚡ Adjustment leg '{leg_id}' ({sym}) squared off ({reason}). Order ID: {oid}")
        save_straddle_strategies(straddle_strategies_store)
        return True, f"Adjustment leg '{leg_id}' squared off ({reason})"
    except Exception as e:
        log_straddle(f"[{sname}] Error squaring off adjustment leg '{leg_id}' ({sym}): {e}")
        return False, f"Error: {e}"


def place_straddle_adjustment_order(strat, leg_id, sym, opt_type, strike, action, qty, sl_type, sl_value, enable_tsl, tsl_type, tsl_value, tsl_step, tag_suffix="adj"):
    """Places entry order for an adjustment leg and initializes its SL & TSL tracking."""
    kite = get_kite_client()
    if not kite:
        return False, "Not logged in"

    sname = strat.get("name", "Straddle Total SL")
    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_straddle_exchange(instrument)
    product = strat.get("product", "NRML").upper()
    action_upper = str(action or "SELL").upper()
    entry_txn = kite.TRANSACTION_TYPE_SELL if action_upper == "SELL" else kite.TRANSACTION_TYPE_BUY
    pos_tag = f"{strat.get('run_tag', 'std')}_{tag_suffix}"[:20]

    # Fetch live quote for best bid / LTP
    best_bid_price = 0.0
    best_bid_qty = 0
    try:
        quote_res = kite.quote([f"{exchange}:{sym}"])
        inst_quote = quote_res.get(f"{exchange}:{sym}", {})
        if inst_quote.get("last_price"):
            last_ltp = float(inst_quote["last_price"])
        depth_bids = inst_quote.get("depth", {}).get("buy", [])
        if depth_bids and depth_bids[0].get("price", 0) > 0:
            best_bid_price = float(depth_bids[0]["price"])
            best_bid_qty = int(depth_bids[0].get("quantity", 0))
    except Exception as e:
        logger.warning(f"Error fetching quote for adjustment {sym}: {e}")
        try:
            q = kite.ltp([f"{exchange}:{sym}"])
            last_ltp = float(q.get(f"{exchange}:{sym}", {}).get("last_price", 0.0))
        except Exception:
            last_ltp = 100.0

    if last_ltp <= 0:
        last_ltp = 100.0

    base_price = best_ask_price if (action_upper == "SELL" and best_ask_price > 0) else (best_bid_price if best_bid_price > 0 else float(last_ltp))

    # Calculate initial SL trigger price
    sl_type_upper = str(sl_type or "PERCENT").upper()
    sl_val = float(sl_value or 30.0)

    if action_upper == "SELL":
        entry_trigger = None
        order_price = round((base_price * 0.99) * 20) / 20
        order_type_val = kite.ORDER_TYPE_LIMIT
        if sl_type_upper == "PERCENT":
            sl_price = round(last_ltp * (1.0 + sl_val / 100.0), 2)
        else:
            sl_price = round(last_ltp + sl_val, 2)
    else:
        entry_trigger = None
        order_price = round((base_price * 1.01) * 20) / 20
        order_type_val = kite.ORDER_TYPE_LIMIT
        if sl_type_upper == "PERCENT":
            sl_price = round(max(0.05, last_ltp * (1.0 - sl_val / 100.0)), 2)
        else:
            sl_price = round(max(0.05, last_ltp - sl_val), 2)

    log_straddle(f"[{sname}] 🚀 Executing Adjustment Trade '{leg_id}': {action_upper} {sym} (Strike {strike}) Qty:{qty} @ Limit ₹{order_price:.2f}" + (f", Trigger: ₹{entry_trigger:.2f} (Best Bid: ₹{best_bid_price:.2f} [Qty: {best_bid_qty}])" if entry_trigger else "") + f" | Initial SL: ₹{sl_price:.2f} ({sl_val} {sl_type_upper}) | TSL: {'ON' if enable_tsl else 'OFF'}")

    try:
        place_kwargs = {
            "variety": kite.VARIETY_REGULAR,
            "exchange": exchange,
            "tradingsymbol": sym,
            "transaction_type": entry_txn,
            "quantity": qty,
            "product": product,
            "order_type": order_type_val,
            "price": float(order_price),
            "tag": pos_tag
        }
        if entry_trigger:
            place_kwargs["trigger_price"] = float(entry_trigger)

        order_id = kite.place_order(**place_kwargs)
        log_straddle(f"[{sname}] Adjustment {action_upper} {sym} Placed. Order ID: {order_id}")

        adj = strat.setdefault("adjustments", {})
        active_orders = adj.setdefault("active_orders", {})
        active_orders[leg_id] = {
            "id": leg_id,
            "symbol": sym,
            "option_type": opt_type,
            "strike": strike,
            "action": action_upper,
            "quantity": qty,
            "product": product,
            "entry_price": last_ltp,
            "current_ltp": last_ltp,
            "exit_price": 0.0,
            "order_id": order_id,
            "status": "ACTIVE",
            "sl_type": sl_type_upper,
            "sl_value": sl_val,
            "current_sl_trigger": sl_price,
            "enable_tsl": bool(enable_tsl),
            "tsl_type": str(tsl_type or "POINTS").upper(),
            "tsl_value": float(tsl_value or 10.0),
            "tsl_step": float(tsl_step or 10.0),
            "best_ltp": last_ltp,
            "tsl_reference_ltp": last_ltp,
            "pnl": 0.0,
            "entered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        upsert_pending_straddle_order(f"{strat.get('id')}_{leg_id}_ADJ", {
            "strategy_id": strat.get("id"),
            "strategy_name": sname,
            "instrument": instrument,
            "leg": leg_id,
            "purpose": "ADJUSTMENT_ENTRY",
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
        save_straddle_strategies(straddle_strategies_store)
        return True, "Adjustment order placed successfully"
    except Exception as e:
        log_straddle(f"[{sname}] Failed adjustment order placement for {sym}: {e}")
        return False, f"Failed: {e}"


def squareoff_straddle_strategy_for(strat, reason="Manual"):
    """Squares off both CE and PE legs simultaneously for the straddle strategy, as well as all active adjustment legs."""
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

    # 1. Square off Base CE & PE Legs
    for leg in ["CE", "PE"]:
        sym = strat["orders"][leg].get("symbol")
        curr_ltp = strat["orders"][leg].get("current_ltp", 0.0)
        best_ask_price = 0.0
        best_ask_qty = 0
        best_bid_price = 0.0
        best_bid_qty = 0

        try:
            quote_res = kite.quote([f"{exchange}:{sym}"])
            inst_quote = quote_res.get(f"{exchange}:{sym}", {})
            if inst_quote.get("last_price"):
                curr_ltp = float(inst_quote["last_price"])
            depth_asks = inst_quote.get("depth", {}).get("sell", [])
            if depth_asks and depth_asks[0].get("price", 0) > 0:
                best_ask_price = float(depth_asks[0]["price"])
                best_ask_qty = int(depth_asks[0].get("quantity", 0))
            depth_bids = inst_quote.get("depth", {}).get("buy", [])
            if depth_bids and depth_bids[0].get("price", 0) > 0:
                best_bid_price = float(depth_bids[0]["price"])
                best_bid_qty = int(depth_bids[0].get("quantity", 0))
        except Exception:
            pass

        strat["orders"][leg]["exit_price"] = curr_ltp

        if sym and strat["orders"][leg].get("status") == "ACTIVE":
            if exit_txn == kite.TRANSACTION_TYPE_BUY:
                base_exit_p = best_ask_price if best_ask_price > 0 else curr_ltp
                exit_limit = round((base_exit_p * 1.01) * 20) / 20 if base_exit_p > 0 else 0.0
                log_straddle(f"[{sname}] Exit BUY Order for base leg {leg} ({sym}): Best Ask/Offer: ₹{best_ask_price:.2f} (Depth Qty: {best_ask_qty}), LTP: ₹{curr_ltp:.2f} -> Limit: ₹{exit_limit:.2f} (+1%)...")
            else:
                base_exit_p = best_bid_price if best_bid_price > 0 else curr_ltp
                exit_limit = round((base_exit_p * 0.99) * 20) / 20 if base_exit_p > 0 else 0.0
                log_straddle(f"[{sname}] Exit SELL Order for base leg {leg} ({sym}): Best Bid: ₹{best_bid_price:.2f} (Depth Qty: {best_bid_qty}), LTP: ₹{curr_ltp:.2f} -> Limit: ₹{exit_limit:.2f} (-1%)...")

            try:
                if exit_limit > 0:
                    oid = kite.place_order(
                        variety=kite.VARIETY_REGULAR,
                        exchange=exchange,
                        tradingsymbol=sym,
                        transaction_type=exit_txn,
                        quantity=qty,
                        product=product,
                        order_type=kite.ORDER_TYPE_LIMIT,
                        price=float(exit_limit),
                        tag=pos_tag
                    )
                else:
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
                log_straddle(f"[{sname}] Exit order placed for base leg {leg} ({sym}) on {exchange}. Order ID: {oid}")
                strat["orders"][leg]["status"] = "SQUARED_OFF"
                remove_pending_straddle_order(f"{strat.get('id')}_{leg}_ENTRY")
            except Exception as e:
                log_straddle(f"[{sname}] Limit exit failed for base leg {leg} ({sym}): {e}. Retrying with MARKET order...")
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
                    log_straddle(f"[{sname}] Market exit order placed for base leg {leg} ({sym}). Order ID: {oid}")
                    strat["orders"][leg]["status"] = "SQUARED_OFF"
                    remove_pending_straddle_order(f"{strat.get('id')}_{leg}_ENTRY")
                except Exception as mkt_e:
                    log_straddle(f"[{sname}] Market exit order ALSO failed for base leg {leg} ({sym}): {mkt_e}")

    # 2. Square off all active Adjustment Legs
    adj = strat.get("adjustments", {})
    active_orders = adj.get("active_orders", {})
    for adj_id, leg_data in list(active_orders.items()):
        if leg_data.get("status") == "ACTIVE":
            adj_sym = leg_data.get("symbol")
            adj_qty = int(leg_data.get("quantity") or qty)
            adj_action = leg_data.get("action", "SELL").upper()
            adj_exit_txn = kite.TRANSACTION_TYPE_BUY if adj_action == "SELL" else kite.TRANSACTION_TYPE_SELL
            adj_ltp = float(leg_data.get("current_ltp", 0.0))
            best_adj_ask = 0.0
            best_adj_bid = 0.0

            try:
                q_adj = kite.quote([f"{exchange}:{adj_sym}"])
                inst_q = q_adj.get(f"{exchange}:{adj_sym}", {})
                if inst_q.get("last_price"):
                    adj_ltp = float(inst_q["last_price"])
                d_asks = inst_q.get("depth", {}).get("sell", [])
                if d_asks and d_asks[0].get("price", 0) > 0:
                    best_adj_ask = float(d_asks[0]["price"])
                d_bids = inst_q.get("depth", {}).get("buy", [])
                if d_bids and d_bids[0].get("price", 0) > 0:
                    best_adj_bid = float(d_bids[0]["price"])
            except Exception:
                pass

            if adj_exit_txn == kite.TRANSACTION_TYPE_BUY:
                base_adj_p = best_adj_ask if best_adj_ask > 0 else adj_ltp
                adj_exit_limit = round((base_adj_p * 1.01) * 20) / 20 if base_adj_p > 0 else 0.0
            else:
                base_adj_p = best_adj_bid if best_adj_bid > 0 else adj_ltp
                adj_exit_limit = round((base_adj_p * 0.99) * 20) / 20 if base_adj_p > 0 else 0.0

            try:
                if adj_exit_limit > 0:
                    oid = kite.place_order(
                        variety=kite.VARIETY_REGULAR,
                        exchange=exchange,
                        tradingsymbol=adj_sym,
                        transaction_type=adj_exit_txn,
                        quantity=adj_qty,
                        product=product,
                        order_type=kite.ORDER_TYPE_LIMIT,
                        price=float(adj_exit_limit),
                        tag=pos_tag
                    )
                else:
                    oid = kite.place_order(
                        variety=kite.VARIETY_REGULAR,
                        exchange=exchange,
                        tradingsymbol=adj_sym,
                        transaction_type=adj_exit_txn,
                        quantity=adj_qty,
                        product=product,
                        order_type=kite.ORDER_TYPE_MARKET,
                        tag=pos_tag
                    )
                log_straddle(f"[{sname}] Exit order placed for adjustment leg '{adj_id}' ({adj_sym}). Order ID: {oid}")
                leg_data["status"] = "SQUARED_OFF"
                leg_data["exit_price"] = adj_ltp
                leg_data["exit_reason"] = f"Strategy Exit ({reason})"
                remove_pending_straddle_order(f"{strat.get('id')}_{adj_id}_ADJ")
            except Exception as e:
                log_straddle(f"[{sname}] Limit exit failed for adjustment leg '{adj_id}': {e}. Retrying with MARKET order...")
                try:
                    oid = kite.place_order(
                        variety=kite.VARIETY_REGULAR,
                        exchange=exchange,
                        tradingsymbol=adj_sym,
                        transaction_type=adj_exit_txn,
                        quantity=adj_qty,
                        product=product,
                        order_type=kite.ORDER_TYPE_MARKET,
                        tag=pos_tag
                    )
                    log_straddle(f"[{sname}] Market exit order placed for adjustment leg '{adj_id}'. Order ID: {oid}")
                    leg_data["status"] = "SQUARED_OFF"
                    leg_data["exit_price"] = adj_ltp
                    leg_data["exit_reason"] = f"Strategy Exit ({reason})"
                    remove_pending_straddle_order(f"{strat.get('id')}_{adj_id}_ADJ")
                except Exception as mkt_e:
                    log_straddle(f"[{sname}] Market exit order ALSO failed for adjustment leg '{adj_id}': {mkt_e}")

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
    4. Evaluates Automatic & Manual Adjustment Trades (Decay triggers, price thresholds, SL & Trailing SL).
    5. Triggers simultaneous Market exit upon breach.
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

    # 1. Timed & Triggered Entry Check
    for s in active_strats:
        sname = s.get("name", "Straddle Total SL")
        orders_data = s.setdefault("orders", {})
        orders_placed = orders_data.get("orders_placed", False)
        entry_t = s.get("entry_time", "15:00:00")
        exit_t = s.get("exit_time", "15:15:00")
        strat_type = str(s.get("strategy_type") or "STRADDLE").upper()
        leg_sel = str(s.get("leg_selection") or "BOTH").upper()
        entry_trigger = str(s.get("entry_trigger_type") or "CURRENT_PRICE").upper()
        entry_action = str(s.get("entry_action") or "SELL").upper()

        if not orders_placed:
            if now_time < entry_t:
                s["status"] = f"Awaiting Entry Time ({entry_t})"
                continue
            if now_time > exit_t:
                s["status"] = f"Past Exit Time ({exit_t})"
                continue

            # Check if strike calculation is needed
            ce_sym = s.get("selected_ce")
            pe_sym = s.get("selected_pe")
            if (leg_sel in ("BOTH", "CE_ONLY") and not ce_sym) or (leg_sel in ("BOTH", "PE_ONLY") and not pe_sym):
                ok, msg = calculate_straddle_strikes_for(s)
                if not ok:
                    log_straddle(f"[{sname}] ⚠️ Strike calculation failed: {msg}. Retrying next cycle.")
                    continue
                ce_sym = s.get("selected_ce")
                pe_sym = s.get("selected_pe")

            # Check Entry Trigger Condition for Single Leg
            if strat_type == "INDIVIDUAL_LEG" and entry_trigger in ("PREMIUM_DECAY", "SPECIFIC_PREMIUM"):
                target_sym = ce_sym if leg_sel == "CE_ONLY" else pe_sym
                exch = get_straddle_exchange(s.get("index_name"))
                if not target_sym:
                    continue

                curr_ltp = 0.0
                try:
                    q_res = kite.ltp([f"{exch}:{target_sym}"])
                    curr_ltp = float(q_res.get(f"{exch}:{target_sym}", {}).get("last_price", 0.0))
                except Exception as e:
                    logger.warning(f"Error fetching trigger check quote for {target_sym}: {e}")

                if curr_ltp <= 0:
                    continue

                initial_ref_prem = 0.0
                try:
                    ref_val = s.get("initial_total_premium") or s.get(f"selected_{leg_sel[:2].lower()}_ltp")
                    if ref_val is not None and str(ref_val).strip() != "" and str(ref_val).strip().upper() != "ATM":
                        initial_ref_prem = float(ref_val)
                except Exception:
                    initial_ref_prem = curr_ltp

                if initial_ref_prem <= 0:
                    initial_ref_prem = curr_ltp
                    s["initial_total_premium"] = curr_ltp

                trigger_met = False
                trigger_desc = ""

                if entry_trigger == "PREMIUM_DECAY":
                    try:
                        decay_req_pct = float(s.get("trigger_decay_pct") or 20.0)
                    except Exception:
                        decay_req_pct = 20.0

                    if initial_ref_prem > 0:
                        decay_pct = ((initial_ref_prem - curr_ltp) / initial_ref_prem) * 100.0
                        if decay_pct >= decay_req_pct:
                            trigger_met = True
                            trigger_desc = f"Premium decayed by {decay_pct:.1f}% >= {decay_req_pct:.1f}% (From ₹{initial_ref_prem:.2f} to ₹{curr_ltp:.2f})"
                        else:
                            s["status"] = f"Awaiting Decay {decay_pct:.1f}%/{decay_req_pct:.1f}% (LTP: ₹{curr_ltp:.2f})"
                            continue

                elif entry_trigger == "SPECIFIC_PREMIUM":
                    target_prem = float(s.get("trigger_premium_val") or 0.0)
                    if target_prem > 0:
                        if entry_action == "SELL":
                            # For SELL, trigger when price drops to or below target premium
                            if curr_ltp <= target_prem:
                                trigger_met = True
                                trigger_desc = f"LTP ₹{curr_ltp:.2f} reached target <= ₹{target_prem:.2f}"
                            else:
                                s["status"] = f"Awaiting Prem <= ₹{target_prem:.2f} (LTP: ₹{curr_ltp:.2f})"
                                continue
                        else:
                            # For BUY, trigger when price rises to or above target premium
                            if curr_ltp >= target_prem:
                                trigger_met = True
                                trigger_desc = f"LTP ₹{curr_ltp:.2f} reached target >= ₹{target_prem:.2f}"
                            else:
                                s["status"] = f"Awaiting Prem >= ₹{target_prem:.2f} (LTP: ₹{curr_ltp:.2f})"
                                continue

                if trigger_met:
                    log_straddle(f"[{sname}] 🎯 Single Leg Entry Trigger Met ({trigger_desc})! Executing Entry...")
                    place_straddle_orders_for(s)
                else:
                    continue
            else:
                # Immediate / Current Price entry
                log_straddle(f"[{sname}] ⏰ Scheduled Entry Time ({entry_t}) reached! Executing Entry Orders...")
                place_straddle_orders_for(s)

    # 2. Quote Collection for Active Straddles & Adjustment Legs
    symbols_to_quote = set()
    for s in active_strats:
        exch = get_straddle_exchange(s.get("index_name"))
        # Base setup symbols
        if s.get("orders", {}).get("orders_placed"):
            for leg in ["CE", "PE"]:
                sym = s["orders"][leg].get("symbol")
                if sym:
                    symbols_to_quote.add(f"{exch}:{sym}")

        # Underlying instrument (Cash Spot or Futures) for Strategy Range & Movement tracking
        u_sym = s.get("underlying_symbol")
        if not u_sym:
            u_type = s.get("underlying_type") or "CASH"
            _, u_sym, _, _ = get_underlying_price_and_expiry(s.get("index_name"), u_type)
            s["underlying_symbol"] = u_sym
        if u_sym:
            symbols_to_quote.add(u_sym)

        # Adjustment symbols (active & manual pending)
        adj = s.get("adjustments", {})
        if adj.get("enabled"):
            mode = adj.get("mode", "ALL")
            enable_spot_dist = bool(adj.get("enable_spot_dist", True if mode in ("SPOT_DISTANCE", "ALL") or adj.get("spot_distance_rules") else False))
            enable_manual = bool(adj.get("enable_manual", True if (mode in ("MANUAL", "ALL") or len(adj.get("manual_legs", [])) > 0) else False))

            # Track spot symbol for spot movement rules
            if enable_spot_dist:
                symbols_to_quote.add(get_spot_symbol(s.get("index_name")))

            # Active adjustment orders
            for adj_id, leg_data in adj.get("active_orders", {}).items():
                if leg_data.get("status") == "ACTIVE" and leg_data.get("symbol"):
                    symbols_to_quote.add(f"{exch}:{leg_data['symbol']}")

            # Pending manual legs needing quotes
            if enable_manual:
                for mleg in adj.get("manual_legs", []):
                    if mleg.get("status", "PENDING") == "PENDING":
                        m_sym = mleg.get("symbol")
                        if not m_sym and mleg.get("strike") and s.get("resolved_expiry"):
                            resolved = resolve_straddle_option_symbol(s.get("index_name"), s.get("resolved_expiry"), mleg.get("strike"), mleg.get("option_type", "CE"))
                            if resolved:
                                mleg["symbol"] = resolved
                                m_sym = resolved
                        if m_sym:
                            symbols_to_quote.add(f"{exch}:{m_sym}")

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
            lot_size = get_straddle_lot_size(s.get("index_name"))
            entry_action = s.get("entry_action", "SELL").upper()
            init_tot_prem = float(s.get("initial_total_premium", 0.0))
            sl_trigger_prem = float(s.get("sl_trigger_premium", 0.0))
            tp_trigger_prem = float(s.get("tp_trigger_premium", 0.0))

            # --- 0. Update Underlying Live Price & Strategy Range ---
            u_key = s.get("underlying_symbol")
            if u_key and u_key in quotes:
                curr_u_ltp = float(quotes[u_key]["last_price"])
                s["underlying_ltp"] = curr_u_ltp
                
                # Base entry price for underlying
                base_u_entry = float(s.get("entry_underlying_ltp") or s.get("base_spot_entry") or 0.0)
                if base_u_entry <= 0:
                    base_u_entry = curr_u_ltp
                    s["entry_underlying_ltp"] = curr_u_ltp
                    s["base_spot_entry"] = curr_u_ltp

                # Update Strategy High / Low Range
                cur_min = float(s.get("underlying_min_ltp") or base_u_entry or curr_u_ltp)
                cur_max = float(s.get("underlying_max_ltp") or base_u_entry or curr_u_ltp)
                if cur_min <= 0 or curr_u_ltp < cur_min:
                    s["underlying_min_ltp"] = curr_u_ltp
                if cur_max <= 0 or curr_u_ltp > cur_max:
                    s["underlying_max_ltp"] = curr_u_ltp

                # Movement from entry
                u_diff = curr_u_ltp - base_u_entry
                u_diff_pct = (u_diff / base_u_entry * 100.0) if base_u_entry > 0 else 0.0
                s["underlying_diff_pts"] = round(u_diff, 2)
                s["underlying_diff_pct"] = round(u_diff_pct, 2)

            current_total_prem = 0.0
            base_pnl = 0.0

            # --- A. Update Base Straddle Legs ---
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
                    s["orders"][leg]["pnl"] = round(leg_pnl, 2)
                    base_pnl += leg_pnl

            s["current_total_premium"] = round(current_total_prem, 2)
            s["base_pnl"] = round(base_pnl, 2)

            # --- B. Process Multi-Adjustment Engines (Decay, Spot Distance, Custom Extra Legs) ---
            adj_pnl = 0.0
            adj = s.get("adjustments", {})
            if adj.get("enabled"):
                mode = adj.get("mode", "ALL")
                auto_cfg = adj.get("auto_config", {})
                dist_cfg = adj.get("spot_distance_config", {})
                manual_legs = adj.get("manual_legs", [])
                active_orders = adj.get("active_orders", {})
                adj["active_orders"] = active_orders

                enable_auto = bool(auto_cfg.get("enabled", True if mode in ("AUTOMATIC", "ALL") else False))
                enable_spot_dist = bool(adj.get("enable_spot_dist", True if mode in ("SPOT_DISTANCE", "ALL") or adj.get("spot_distance_rules") else False))
                enable_manual = bool(adj.get("enable_manual", True if (mode in ("MANUAL", "ALL") or len(manual_legs) > 0) else False))

                # 1. Automatic Decay Adjustment: Sells leg when premium decays near target % (e.g. 15% target - 2% buffer = 13%)
                if enable_auto:
                    decay_target_pct = float(auto_cfg.get("trigger_decay_percent", 15.0))
                    decay_buffer_pct = float(auto_cfg.get("near_buffer_percent", 0.0))
                    effective_decay_trigger = max(0.0, decay_target_pct - decay_buffer_pct)
                    max_adjs = int(auto_cfg.get("max_adjustments", 3))
                    adj_lots = int(auto_cfg.get("lots", 1))
                    adj_qty = max(lot_size, adj_lots * lot_size)

                    for leg in ["CE", "PE"]:
                        count_key = f"{leg.lower()}_adjustments_done"
                        adjs_done = int(auto_cfg.get(count_key, 0))
                        base_entry = float(s["orders"][leg].get("first_entry_price") or s["orders"][leg].get("entry_price", 0.0))
                        curr_ltp = float(s["orders"][leg].get("current_ltp", 0.0))
                        base_sym = s["orders"][leg].get("symbol")
                        base_strike = s.get("selected_strike")

                        # Check if any previous auto adjustment for this leg is currently active
                        current_leg_adj_active = any(
                            k.startswith(f"auto_{leg.lower()}_") and v.get("status") == "ACTIVE"
                            for k, v in active_orders.items()
                        )

                        if adjs_done < max_adjs and not current_leg_adj_active and base_entry > 0 and curr_ltp > 0 and base_sym:
                            # Premium decay percentage = ((Entry - Current) / Entry) * 100
                            decay_pct = ((base_entry - curr_ltp) / base_entry) * 100.0
                            if decay_pct >= effective_decay_trigger:
                                next_adj_num = adjs_done + 1
                                log_straddle(f"[{sname}] 🎯 AUTOMATIC ADJUSTMENT #{next_adj_num}/{max_adjs} TRIGGERED for {leg} ({base_sym})! Premium decayed by {decay_pct:.1f}% (Target: {decay_target_pct:.1f}%, Buffer: {decay_buffer_pct:.1f}%, Triggered at >= {effective_decay_trigger:.1f}%) from ₹{base_entry:.2f} to ₹{curr_ltp:.2f}. Executing {adj_lots} Lot(s) ({adj_qty} qty) with SL & TSL...")
                                leg_id = f"auto_{leg.lower()}_adj_{next_adj_num}"
                                ok, msg = place_straddle_adjustment_order(
                                    strat=s,
                                    leg_id=leg_id,
                                    sym=base_sym,
                                    opt_type=leg,
                                    strike=base_strike,
                                    action="SELL",
                                    qty=adj_qty,
                                    sl_type=auto_cfg.get("sl_type", "PERCENT"),
                                    sl_value=auto_cfg.get("sl_value", 30.0),
                                    enable_tsl=auto_cfg.get("enable_tsl", True),
                                    tsl_type=auto_cfg.get("tsl_type", "POINTS"),
                                    tsl_value=auto_cfg.get("tsl_value", 10.0),
                                    tsl_step=auto_cfg.get("tsl_step", 10.0),
                                    tag_suffix=f"adj_{leg.lower()}_{next_adj_num}"
                                )
                                if ok:
                                    auto_cfg[count_key] = next_adj_num
                                    auto_cfg[f"{leg.lower()}_triggered"] = True

                # 2. Spot Distance Move Mode: Process Multiple Spot Distance Rules with Near Buffer
                if enable_spot_dist:
                    spot_rules = adj.get("spot_distance_rules")
                    if not spot_rules and adj.get("spot_distance_config"):
                        spot_rules = [adj.get("spot_distance_config")]
                    
                    base_spot = float(s.get("base_spot_entry") or 0.0)
                    spot_key = get_spot_symbol(s.get("index_name"))
                    curr_spot = float(quotes.get(spot_key, {}).get("last_price") or 0.0)

                    if base_spot > 0 and curr_spot > 0 and spot_rules:
                        spot_diff = curr_spot - base_spot  # positive = moved up, negative = moved down

                        for r_idx, r_cfg in enumerate(spot_rules):
                            r_id = r_cfg.get("id") or f"srule_{r_idx + 1}"
                            r_cfg["id"] = r_id
                            move_step = float(r_cfg.get("move_step_pts") or 500.0)
                            buffer_pct = float(r_cfg.get("near_buffer_pct", 10.0))  # e.g. 10% near distance
                            effective_move_step = max(0.0, move_step * (1.0 - (buffer_pct / 100.0)))
                            
                            offset_pts = float(r_cfg.get("strike_offset_pts") or 2000.0)
                            round_mult = float(r_cfg.get("round_multiple") or 500.0)
                            adj_action = str(r_cfg.get("action") or "SELL").upper()
                            adj_lots = int(r_cfg.get("lots") or 1)
                            adj_qty = max(lot_size, adj_lots * lot_size)
                            max_adjs = int(r_cfg.get("max_adjustments") or 5)
                            up_done = int(r_cfg.get("up_adjustments_done") or 0)
                            down_done = int(r_cfg.get("down_adjustments_done") or 0)

                            # A. Check Downward Market Move (Spot dropped near or past step)
                            down_thresh = (down_done * move_step) + effective_move_step
                            if spot_diff <= -down_thresh and down_done < max_adjs:
                                next_down_num = down_done + 1
                                raw_strike = curr_spot - offset_pts
                                target_strike = round(raw_strike / round_mult) * round_mult if round_mult > 0 else raw_strike
                                opt_type = "CE"  # CE leg when market falls
                                
                                actions_to_place = ["BUY", "SELL"] if adj_action in ("BOTH", "BUY_AND_SELL", "BUY_SELL") else [adj_action]
                                resolved_sym = resolve_straddle_option_symbol(s.get("index_name"), s.get("resolved_expiry"), target_strike, opt_type)
                                if resolved_sym:
                                    log_straddle(f"[{sname}] 🎯 SPOT DISTANCE RULE #{r_idx+1} ({adj_action}) DOWN #{next_down_num}/{max_adjs} TRIGGERED! Spot fell by {abs(spot_diff):.1f} pts (From ₹{base_spot:.2f} to ₹{curr_spot:.2f} <= Near-Threshold -{down_thresh:.1f} pts [{buffer_pct}% near {move_step} pts]). Executing {' & '.join(actions_to_place)} {resolved_sym} ({target_strike} {opt_type} [Spot ₹{curr_spot:.1f} - {offset_pts} pts, rounded to nearest {round_mult}]) with {adj_lots} Lot(s)...")
                                    any_ok = False
                                    for act in actions_to_place:
                                        adj_id = f"spot_dist_r{r_idx+1}_down_{next_down_num}_{act.lower()}"
                                        ok, msg = place_straddle_adjustment_order(
                                            strat=s,
                                            leg_id=adj_id,
                                            sym=resolved_sym,
                                            opt_type=opt_type,
                                            strike=target_strike,
                                            action=act,
                                            qty=adj_qty,
                                            sl_type=r_cfg.get("sl_type", "PERCENT"),
                                            sl_value=r_cfg.get("sl_value", 30.0),
                                            enable_tsl=r_cfg.get("enable_tsl", True),
                                            tsl_type=r_cfg.get("tsl_type", "POINTS"),
                                            tsl_value=r_cfg.get("tsl_value", 10.0),
                                            tsl_step=r_cfg.get("tsl_step", 10.0),
                                            tag_suffix=f"spot_r{r_idx+1}_dn_{next_down_num}_{act.lower()}"
                                        )
                                        if ok:
                                            any_ok = True
                                    if any_ok:
                                        r_cfg["down_adjustments_done"] = next_down_num

                            # B. Check Upward Market Move (Spot rose near or past step)
                            up_thresh = (up_done * move_step) + effective_move_step
                            if spot_diff >= up_thresh and up_done < max_adjs:
                                next_up_num = up_done + 1
                                raw_strike = curr_spot + offset_pts
                                target_strike = round(raw_strike / round_mult) * round_mult if round_mult > 0 else raw_strike
                                opt_type = "PE"  # PE leg when market rises
                                
                                actions_to_place = ["BUY", "SELL"] if adj_action in ("BOTH", "BUY_AND_SELL", "BUY_SELL") else [adj_action]
                                resolved_sym = resolve_straddle_option_symbol(s.get("index_name"), s.get("resolved_expiry"), target_strike, opt_type)
                                if resolved_sym:
                                    log_straddle(f"[{sname}] 🎯 SPOT DISTANCE RULE #{r_idx+1} ({adj_action}) UP #{next_up_num}/{max_adjs} TRIGGERED! Spot rose by +{spot_diff:.1f} pts (From ₹{base_spot:.2f} to ₹{curr_spot:.2f} >= Near-Threshold +{up_thresh:.1f} pts [{buffer_pct}% near {move_step} pts]). Executing {' & '.join(actions_to_place)} {resolved_sym} ({target_strike} {opt_type} [Spot ₹{curr_spot:.1f} + {offset_pts} pts, rounded to nearest {round_mult}]) with {adj_lots} Lot(s)...")
                                    any_ok = False
                                    for act in actions_to_place:
                                        adj_id = f"spot_dist_r{r_idx+1}_up_{next_up_num}_{act.lower()}"
                                        ok, msg = place_straddle_adjustment_order(
                                            strat=s,
                                            leg_id=adj_id,
                                            sym=resolved_sym,
                                            opt_type=opt_type,
                                            strike=target_strike,
                                            action=act,
                                            qty=adj_qty,
                                            sl_type=r_cfg.get("sl_type", "PERCENT"),
                                            sl_value=r_cfg.get("sl_value", 30.0),
                                            enable_tsl=r_cfg.get("enable_tsl", True),
                                            tsl_type=r_cfg.get("tsl_type", "POINTS"),
                                            tsl_value=r_cfg.get("tsl_value", 10.0),
                                            tsl_step=r_cfg.get("tsl_step", 10.0),
                                            tag_suffix=f"spot_r{r_idx+1}_up_{next_up_num}_{act.lower()}"
                                        )
                                        if ok:
                                            any_ok = True
                                    if any_ok:
                                        r_cfg["up_adjustments_done"] = next_up_num

                # 3. Manual / Custom Extra Legs Mode: Check Trigger Prices with Near Buffer
                if enable_manual and manual_legs:
                    for idx, mleg in enumerate(manual_legs):
                        m_status = mleg.get("status", "PENDING")
                        m_id = mleg.get("id") or f"manual_{idx+1}"
                        mleg["id"] = m_id
                        m_sym = mleg.get("symbol")
                        m_action = str(mleg.get("action", "SELL")).upper()
                        m_trigger = float(mleg.get("trigger_price", 0.0))
                        m_buffer_pct = float(mleg.get("near_buffer_pct", 10.0))  # e.g. 10% near
                        m_strike = mleg.get("strike")
                        m_opt_type = str(mleg.get("option_type", "CE")).upper()
                        m_lots = int(mleg.get("lots", 1))
                        m_qty = int(mleg.get("quantity") or (m_lots * lot_size))

                        if m_status == "PENDING" and m_sym and m_trigger > 0:
                            q_key = f"{exch}:{m_sym}"
                            if q_key in quotes:
                                curr_ltp = float(quotes[q_key]["last_price"])
                                mleg["current_ltp"] = curr_ltp
                                trigger_hit = False

                                # Effective near-trigger calculation
                                # BUY: triggers when LTP rises near target
                                effective_buy_trigger = m_trigger * (1.0 - (m_buffer_pct / 100.0)) if m_buffer_pct > 0 else m_trigger
                                # SELL: triggers when LTP drops near target
                                effective_sell_trigger = m_trigger * (1.0 + (m_buffer_pct / 100.0)) if m_buffer_pct > 0 else m_trigger

                                if m_action == "BUY" and curr_ltp >= effective_buy_trigger:
                                    trigger_hit = True
                                    log_straddle(f"[{sname}] 🎯 MANUAL ADJUSTMENT TRIGGERED for {m_action} {m_sym}! LTP ₹{curr_ltp:.2f} >= Near-Trigger ₹{effective_buy_trigger:.2f}")

                                elif m_action == "SELL" and curr_ltp <= effective_sell_trigger:
                                    trigger_hit = True
                                    log_straddle(f"[{sname}] 🎯 MANUAL ADJUSTMENT TRIGGERED for {m_action} {m_sym}! LTP ₹{curr_ltp:.2f} <= Near-Trigger ₹{effective_sell_trigger:.2f}")

                                if trigger_hit:
                                    ok, msg = place_straddle_adjustment_order(
                                        strat=s,
                                        leg_id=m_id,
                                        sym=m_sym,
                                        opt_type=m_opt_type,
                                        strike=m_strike,
                                        action=m_action,
                                        qty=m_qty,
                                        sl_type=mleg.get("sl_type", "PERCENT"),
                                        sl_value=mleg.get("sl_value", 30.0),
                                        enable_tsl=mleg.get("enable_tsl", True),
                                        tsl_type=mleg.get("tsl_type", "POINTS"),
                                        tsl_value=mleg.get("tsl_value", 10.0),
                                        tsl_step=mleg.get("tsl_step", 10.0),
                                        tag_suffix=f"man_{idx+1}"
                                    )
                                    if ok:
                                        mleg["status"] = "TRIGGERED"
                                        mleg["triggered_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                # 4. Monitor Active Adjustment Orders: SL & Trailing Stop Loss
                for adj_id, leg_data in list(active_orders.items()):
                    if leg_data.get("status") != "ACTIVE":
                        continue

                    adj_sym = leg_data.get("symbol")
                    q_key = f"{exch}:{adj_sym}"
                    if adj_sym and q_key in quotes:
                        curr_ltp = float(quotes[q_key]["last_price"])
                        leg_data["current_ltp"] = curr_ltp
                        adj_action = leg_data.get("action", "SELL").upper()
                        adj_qty = int(leg_data.get("quantity") or lot_size)
                        entry_p = float(leg_data.get("entry_price", curr_ltp))
                        sl_trigger = float(leg_data.get("current_sl_trigger", 0.0))

                        # PnL Calculation for adjustment leg
                        if adj_action == "SELL":
                            leg_pnl = (entry_p - curr_ltp) * adj_qty
                        else:
                            leg_pnl = (curr_ltp - entry_p) * adj_qty
                        leg_data["pnl"] = round(leg_pnl, 2)
                        adj_pnl += leg_pnl

                        # Trailing Stop Loss Logic for Adjustment Leg
                        if leg_data.get("enable_tsl"):
                            tsl_type = leg_data.get("tsl_type", "POINTS").upper()
                            tsl_val = float(leg_data.get("tsl_value", 10.0))
                            tsl_step = float(leg_data.get("tsl_step", 10.0))
                            ref_ltp = float(leg_data.get("tsl_reference_ltp", entry_p))
                            best_ltp = float(leg_data.get("best_ltp", entry_p))

                            if adj_action == "SELL":
                                if curr_ltp < best_ltp:
                                    leg_data["best_ltp"] = curr_ltp
                                if (ref_ltp - curr_ltp) >= tsl_step and tsl_step > 0:
                                    steps_count = int((ref_ltp - curr_ltp) // tsl_step)
                                    pts_to_trail = steps_count * tsl_val
                                    new_sl = round(sl_trigger - pts_to_trail, 2)
                                    leg_data["current_sl_trigger"] = new_sl
                                    leg_data["tsl_reference_ltp"] = round(ref_ltp - (steps_count * tsl_step), 2)
                                    log_straddle(f"[{sname}] 🎯 TSL TRAIL for Adjustment '{adj_id}': Trailed SL ➔ ₹{new_sl:.2f}")

                            else:
                                if curr_ltp > best_ltp:
                                    leg_data["best_ltp"] = curr_ltp
                                if (curr_ltp - ref_ltp) >= tsl_step and tsl_step > 0:
                                    steps_count = int((curr_ltp - ref_ltp) // tsl_step)
                                    pts_to_trail = steps_count * tsl_val
                                    new_sl = round(sl_trigger + pts_to_trail, 2)
                                    leg_data["current_sl_trigger"] = new_sl
                                    leg_data["tsl_reference_ltp"] = round(ref_ltp + (steps_count * tsl_step), 2)
                                    log_straddle(f"[{sname}] 🎯 TSL TRAIL for Adjustment '{adj_id}': Trailed SL ➔ ₹{new_sl:.2f}")

                        # Check Stop Loss Trigger for Adjustment Leg
                        if sl_trigger > 0:
                            if adj_action == "SELL" and curr_ltp >= sl_trigger:
                                log_straddle(f"[{sname}] 💥 STOP LOSS HIT on Adjustment Leg '{adj_id}' ({adj_sym})! LTP: ₹{curr_ltp:.2f} >= SL Trigger: ₹{sl_trigger:.2f}. Squaring off...")
                                squareoff_straddle_adjustment_leg(s, adj_id, reason=f"SL Hit @ ₹{curr_ltp:.2f}")
                            elif adj_action == "BUY" and curr_ltp <= sl_trigger:
                                log_straddle(f"[{sname}] 💥 STOP LOSS HIT on Adjustment Leg '{adj_id}' ({adj_sym})! LTP: ₹{curr_ltp:.2f} <= SL Trigger: ₹{sl_trigger:.2f}. Squaring off...")
                                squareoff_straddle_adjustment_leg(s, adj_id, reason=f"SL Hit @ ₹{curr_ltp:.2f}")

            # --- C. Trailing Stop Loss on Base Setup (Total Premium or Individual Leg) ---
            if s.get("enable_tsl") and init_tot_prem > 0 and current_total_prem > 0:
                trail_pts = float(s.get("tsl_value", 10.0))
                step_pts = float(s.get("tsl_step", 10.0))
                curr_sl_trigger = float(s.get("current_sl_trigger_prem") or sl_trigger_prem)
                ref_prem = float(s.get("tsl_reference_prem") or init_tot_prem)
                best_prem = float(s.get("best_total_premium") or init_tot_prem)

                if entry_action == "SELL":
                    # Favorable move: Total premium decays / decreases
                    if current_total_prem < best_prem:
                        s["best_total_premium"] = current_total_prem

                    # If premium dropped by at least step_pts from reference
                    if (ref_prem - current_total_prem) >= step_pts and step_pts > 0:
                        steps_count = int((ref_prem - current_total_prem) // step_pts)
                        pts_to_trail = steps_count * trail_pts
                        new_sl = round(curr_sl_trigger - pts_to_trail, 2)
                        s["current_sl_trigger_prem"] = new_sl
                        s["sl_trigger_premium"] = new_sl
                        s["tsl_reference_prem"] = round(ref_prem - (steps_count * step_pts), 2)
                        log_straddle(f"[{sname}] 🎯 TSL TRAIL for Base Setup: Premium dropped to ₹{current_total_prem:.2f}. Trailed SL lower from ₹{curr_sl_trigger:.2f} ➔ ₹{new_sl:.2f} (Ref: ₹{s['tsl_reference_prem']:.2f})")
                        sl_trigger_prem = new_sl

                else:
                    # Favorable move: Total premium increases
                    if current_total_prem > best_prem:
                        s["best_total_premium"] = current_total_prem

                    # If premium rose by at least step_pts from reference
                    if (current_total_prem - ref_prem) >= step_pts and step_pts > 0:
                        steps_count = int((current_total_prem - ref_prem) // step_pts)
                        pts_to_trail = steps_count * trail_pts
                        new_sl = round(curr_sl_trigger + pts_to_trail, 2)
                        s["current_sl_trigger_prem"] = new_sl
                        s["sl_trigger_premium"] = new_sl
                        s["tsl_reference_prem"] = round(ref_prem + (steps_count * step_pts), 2)
                        log_straddle(f"[{sname}] 🎯 TSL TRAIL for Base Setup: Premium rose to ₹{current_total_prem:.2f}. Trailed SL higher from ₹{curr_sl_trigger:.2f} ➔ ₹{new_sl:.2f} (Ref: ₹{s['tsl_reference_prem']:.2f})")
                        sl_trigger_prem = new_sl

            # Total combined PnL
            total_strat_pnl = round(base_pnl + adj_pnl, 2)
            s["pnl"] = total_strat_pnl
            s["unrealized_pnl"] = total_strat_pnl
            s["last_checked"] = datetime.now().strftime("%H:%M:%S")
            record_straddle_running_pnl(s, total_strat_pnl)

            # Check Stop Loss & Target Profit (for Base Strategy / Single Leg Setup)
            effective_sl_prem = float(s.get("current_sl_trigger_prem") or sl_trigger_prem)
            if init_tot_prem > 0 and current_total_prem > 0:
                if entry_action == "SELL":
                    # SHORT STRADDLE / SHORT SINGLE LEG
                    if current_total_prem >= effective_sl_prem and effective_sl_prem > 0:
                        log_straddle(f"[{sname}] 🛑 STOP LOSS / TSL TRIGGERED! Premium expanded to ₹{current_total_prem:.2f}. Squaring off position...")
                        squareoff_straddle_strategy_for(s, reason=f"SL / TSL Hit @ ₹{current_total_prem:.2f}")
                    elif current_total_prem <= tp_trigger_prem and tp_trigger_prem > 0:
                        log_straddle(f"[{sname}] 🎯 TARGET PROFIT HIT! Premium decayed to ₹{current_total_prem:.2f}. Squaring off position...")
                        squareoff_straddle_strategy_for(s, reason=f"Target Hit @ ₹{current_total_prem:.2f}")
                else:
                    # LONG STRADDLE / LONG SINGLE LEG
                    if current_total_prem <= effective_sl_prem and effective_sl_prem > 0:
                        log_straddle(f"[{sname}] 🛑 STOP LOSS / TSL TRIGGERED! Premium dropped to ₹{current_total_prem:.2f}. Squaring off position...")
                        squareoff_straddle_strategy_for(s, reason=f"SL / TSL Hit @ ₹{current_total_prem:.2f}")
                    elif current_total_prem >= tp_trigger_prem and tp_trigger_prem > 0:
                        log_straddle(f"[{sname}] 🎯 TARGET PROFIT HIT! Premium expanded to ₹{current_total_prem:.2f}. Squaring off position...")
                        squareoff_straddle_strategy_for(s, reason=f"Target Hit @ ₹{current_total_prem:.2f}")

        save_straddle_strategies(straddle_strategies_store)
    except Exception as e:
        logger.error(f"Error in Straddle Total SL monitoring loop: {e}")


def straddle_total_sl_background_loop():
    """Dedicated background thread loop for Positional Straddle Total SL engine (every 3 seconds)."""
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
