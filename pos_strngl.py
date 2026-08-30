"""
pos_strngl.py — Multi-Strategy Positional Strangle Engine for Zerodha Kite Connect

Features:
- Multi-Strategy management (Create, Edit, Delete, Run, Stop individual positional strangles)
- Grouping by Underlying Index / Instrument (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX)
- Multi-day / Overnight positional holding (NRML product type)
- Automated CE & PE strike selection based on target premium
- Stop-loss & Target profit monitoring (Points or Percentage)
- Automated leg adjustments / roll-forward when threshold is breached
- Persistent strategy store saved to pos_strangle.json
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

logger = logging.getLogger("pos_strangle")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("%(asctime)s - [PosStrangle] %(levelname)s - %(message)s"))
    logger.addHandler(ch)

POS_STRANGLE_FILE = os.path.join(BASE_DIR, "pos_strangle.json")
CREDENTIALS_FILE = os.path.join(BASE_DIR, "credentials.json")
CACHE_FILE = os.path.join(BASE_DIR, "session_cache.json")
POS_PNL_CSV = os.path.join(BASE_DIR, "pos_strategy_PnL.csv")
POS_PNL_XLSX = os.path.join(BASE_DIR, "pos_strategy_PnL.xlsx")
LOT_SIZES_FILE = os.path.join(BASE_DIR, "lot_sizes.json")

DEFAULT_POS_LOT_SIZES = {
    "NIFTY": 65,
    "BANKNIFTY": 30,
    "FINNIFTY": 25,
    "MIDCPNIFTY": 50,
    "SENSEX": 10,
    "BANKEX": 15
}

def get_pos_lot_size(index_name):
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
PENDING_POS_ORDERS_FILE = os.path.join(BASE_DIR, "pending_pos_orders.json")


def get_pos_exchange(index_name):
    """Returns correct broker exchange for instrument: BFO for SENSEX/BANKEX, else NFO."""
    idx = str(index_name or "").upper()
    if "SENSEX" in idx or "BANKEX" in idx or "BSE" in idx:
        return "BFO"
    return "NFO"


def load_pending_pos_orders():
    """Loads local persistent record of pending positional orders from pending_pos_orders.json."""
    if not os.path.exists(PENDING_POS_ORDERS_FILE):
        return {}
    try:
        with open(PENDING_POS_ORDERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning(f"Failed loading {PENDING_POS_ORDERS_FILE}: {e}")
        return {}


def save_pending_pos_orders(orders_dict):
    """Saves local persistent record of pending positional orders to pending_pos_orders.json."""
    try:
        with open(PENDING_POS_ORDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(orders_dict, f, indent=2)
    except Exception as e:
        logger.error(f"Failed saving {PENDING_POS_ORDERS_FILE}: {e}")


def upsert_pending_pos_order(order_key, order_info):
    """Upserts a pending positional order in the local pending orders book."""
    orders = load_pending_pos_orders()
    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    order_info["updated_at"] = now_ts
    if order_key not in orders:
        order_info["created_at"] = now_ts
    else:
        order_info["created_at"] = orders[order_key].get("created_at", now_ts)
    orders[order_key] = order_info
    save_pending_pos_orders(orders)
    return orders


def remove_pending_pos_order(order_key):
    """Removes or clears an order from the local pending orders book."""
    orders = load_pending_pos_orders()
    if order_key in orders:
        del orders[order_key]
        save_pending_pos_orders(orders)


# In-memory execution logs
pos_logs = []
MAX_POS_LOGS = 300

def log_pos(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{ts}] {msg}"
    pos_logs.append(entry)
    if len(pos_logs) > MAX_POS_LOGS:
        pos_logs.pop(0)
    logger.info(msg)


def load_pos_pnl_records():
    """Loads existing trade log records from pos_strategy_PnL.csv to manage serial numbers & cumulative totals."""
    records = []
    if not os.path.exists(POS_PNL_CSV):
        return records
    try:
        with open(POS_PNL_CSV, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
            if len(lines) > 1:
                for line in lines[1:]:
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 15:
                        # Full comprehensive trading journal schema
                        records.append({
                            "Serial_No": int(parts[0]) if parts[0].isdigit() else len(records) + 1,
                            "Date": parts[1],
                            "Strategy_Name": parts[2],
                            "Instrument": parts[3],
                            "Lot_Size": int(parts[4]) if parts[4].isdigit() else parts[4],
                            "CE_Symbol": parts[5],
                            "CE_Entry_Price": parts[6],
                            "CE_Exit_Price": parts[7],
                            "PE_Symbol": parts[8],
                            "PE_Entry_Price": parts[9],
                            "PE_Exit_Price": parts[10],
                            "Day_PnL": float(parts[11]) if parts[11].replace("-","").replace(".","").isdigit() else 0.0,
                            "Cumulative_PnL": float(parts[12]) if parts[12].replace("-","").replace(".","").isdigit() else 0.0,
                            "Exit_Date": parts[13],
                            "Status": parts[14] if len(parts) > 14 else "OPEN"
                        })
                    elif len(parts) >= 7:
                        # Backward compatibility fallback
                        records.append({
                            "Serial_No": int(parts[0]) if parts[0].isdigit() else len(records) + 1,
                            "Date": parts[1],
                            "Strategy_Name": parts[2],
                            "Instrument": parts[3],
                            "Lot_Size": 65,
                            "CE_Symbol": "--",
                            "CE_Entry_Price": "--",
                            "CE_Exit_Price": "--",
                            "PE_Symbol": "--",
                            "PE_Entry_Price": "--",
                            "PE_Exit_Price": "--",
                            "Day_PnL": float(parts[5]) if parts[5].replace("-","").replace(".","").isdigit() else 0.0,
                            "Cumulative_PnL": float(parts[6]) if parts[6].replace("-","").replace(".","").isdigit() else 0.0,
                            "Exit_Date": parts[4],
                            "Status": parts[7] if len(parts) > 7 else "CLOSED"
                        })
    except Exception as e:
        logger.warning(f"Failed parsing {POS_PNL_CSV}: {e}")
    return records


def record_pos_trade_entry(strat):
    """Logs initial position entry with CE and PE positions & entry prices in pos_strategy_PnL.csv and Excel journal."""
    try:
        strat_id = strat.get("id")
        strat_name = strat.get("name", "Positional Strangle")
        instrument = (strat.get("index_name") or "NIFTY").upper()
        lot_size = int(strat.get("quantity") or get_pos_lot_size(instrument))
        now_dt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        strat["start_date"] = now_dt

        ce_sym = strat.get("selected_ce") or strat.get("orders", {}).get("CE", {}).get("symbol") or "--"
        pe_sym = strat.get("selected_pe") or strat.get("orders", {}).get("PE", {}).get("symbol") or "--"

        ce_entry = strat.get("orders", {}).get("CE", {}).get("first_entry_price") or strat.get("orders", {}).get("CE", {}).get("entry_price") or strat.get("selected_ce_ltp") or 0.0
        pe_entry = strat.get("orders", {}).get("PE", {}).get("first_entry_price") or strat.get("orders", {}).get("PE", {}).get("entry_price") or strat.get("selected_pe_ltp") or 0.0

        records = load_pos_pnl_records()
        serial_no = len(records) + 1

        # Calculate previous cumulative PnL
        prev_cum_pnl = records[-1]["Cumulative_PnL"] if records else 0.0

        new_entry = {
            "Serial_No": serial_no,
            "Date": now_dt,
            "Strategy_Name": strat_name,
            "Instrument": instrument,
            "Lot_Size": lot_size,
            "CE_Symbol": ce_sym,
            "CE_Entry_Price": f"{float(ce_entry):.2f}" if ce_entry else "--",
            "CE_Exit_Price": "--",
            "PE_Symbol": pe_sym,
            "PE_Entry_Price": f"{float(pe_entry):.2f}" if pe_entry else "--",
            "PE_Exit_Price": "--",
            "Day_PnL": 0.0,
            "Cumulative_PnL": prev_cum_pnl,
            "Exit_Date": "-- (OPEN)",
            "Status": "OPEN"
        }
        records.append(new_entry)

        rewrite_pos_pnl_files(records)
        log_pos(f"[{strat_name}] 📝 Entry recorded in {POS_PNL_CSV} (S.No #{serial_no}, Date: {now_dt}, CE: {ce_sym} @ ₹{ce_entry:.2f}, PE: {pe_sym} @ ₹{pe_entry:.2f})")
    except Exception as e:
        logger.error(f"Error recording positional trade entry: {e}")


def record_pos_trade_exit(strat, final_pnl):
    """Updates exit date, CE/PE exit prices, final PnL and cumulative PnL in pos_strategy_PnL.csv and Excel sheet."""
    try:
        strat_name = strat.get("name", "Positional Strangle")
        instrument = (strat.get("index_name") or "NIFTY").upper()
        lot_size = int(strat.get("quantity") or get_pos_lot_size(instrument))
        exit_dt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        records = load_pos_pnl_records()

        ce_sym = strat.get("selected_ce") or strat.get("orders", {}).get("CE", {}).get("symbol") or "--"
        pe_sym = strat.get("selected_pe") or strat.get("orders", {}).get("PE", {}).get("symbol") or "--"

        ce_entry = strat.get("orders", {}).get("CE", {}).get("first_entry_price") or strat.get("orders", {}).get("CE", {}).get("entry_price") or strat.get("selected_ce_ltp") or 0.0
        pe_entry = strat.get("orders", {}).get("PE", {}).get("first_entry_price") or strat.get("orders", {}).get("PE", {}).get("entry_price") or strat.get("selected_pe_ltp") or 0.0

        ce_exit = strat.get("orders", {}).get("CE", {}).get("exit_price") or strat.get("orders", {}).get("CE", {}).get("current_ltp") or 0.0
        pe_exit = strat.get("orders", {}).get("PE", {}).get("exit_price") or strat.get("orders", {}).get("PE", {}).get("current_ltp") or 0.0

        # Find matching open record for this strategy name / instrument
        target_rec = None
        for r in reversed(records):
            if r.get("Strategy_Name") == strat_name and r.get("Instrument") == instrument and r.get("Status") == "OPEN":
                target_rec = r
                break

        if target_rec:
            target_rec["Exit_Date"] = exit_dt
            target_rec["Day_PnL"] = round(float(final_pnl), 2)
            target_rec["CE_Exit_Price"] = f"{float(ce_exit):.2f}" if ce_exit else "--"
            target_rec["PE_Exit_Price"] = f"{float(pe_exit):.2f}" if pe_exit else "--"
            target_rec["Status"] = "CLOSED"
        else:
            # Create fresh exit record if start was not logged in session
            serial_no = len(records) + 1
            target_rec = {
                "Serial_No": serial_no,
                "Date": strat.get("start_date") or exit_dt,
                "Strategy_Name": strat_name,
                "Instrument": instrument,
                "Lot_Size": lot_size,
                "CE_Symbol": ce_sym,
                "CE_Entry_Price": f"{float(ce_entry):.2f}" if ce_entry else "--",
                "CE_Exit_Price": f"{float(ce_exit):.2f}" if ce_exit else "--",
                "PE_Symbol": pe_sym,
                "PE_Entry_Price": f"{float(pe_entry):.2f}" if pe_entry else "--",
                "PE_Exit_Price": f"{float(pe_exit):.2f}" if pe_exit else "--",
                "Day_PnL": round(float(final_pnl), 2),
                "Cumulative_PnL": 0.0,
                "Exit_Date": exit_dt,
                "Status": "CLOSED"
            }
            records.append(target_rec)

        # Recalculate cumulative PnL across all records
        running_cum = 0.0
        for r in records:
            running_cum = round(running_cum + float(r.get("Day_PnL", 0.0)), 2)
            r["Cumulative_PnL"] = running_cum

        rewrite_pos_pnl_files(records)
        log_pos(f"[{strat_name}] 🏁 Exit recorded in {POS_PNL_CSV} (Exit: {exit_dt}, PnL: ₹{final_pnl:.2f}, Cumulative: ₹{target_rec.get('Cumulative_PnL', 0):.2f}, CE Exit: ₹{ce_exit}, PE Exit: ₹{pe_exit})")
    except Exception as e:
        logger.error(f"Error recording positional trade exit: {e}")


def record_pos_trade_running_pnl(strat, current_pnl):
    """Updates live running PnL and current leg exit prices for active OPEN trade in pos_strategy_PnL.csv."""
    try:
        strat_name = strat.get("name", "Positional Strangle")
        instrument = (strat.get("index_name") or "NIFTY").upper()
        records = load_pos_pnl_records()
        updated = False
        for r in reversed(records):
            if r.get("Strategy_Name") == strat_name and r.get("Instrument") == instrument and r.get("Status") == "OPEN":
                r["Day_PnL"] = round(float(current_pnl), 2)
                ce_exit = strat.get("orders", {}).get("CE", {}).get("exit_price")
                pe_exit = strat.get("orders", {}).get("PE", {}).get("exit_price")
                if ce_exit:
                    r["CE_Exit_Price"] = f"{float(ce_exit):.2f}"
                if pe_exit:
                    r["PE_Exit_Price"] = f"{float(pe_exit):.2f}"
                updated = True
                break
        if updated:
            running_cum = 0.0
            for r in records:
                running_cum = round(running_cum + float(r.get("Day_PnL", 0.0)), 2)
                r["Cumulative_PnL"] = running_cum
            rewrite_pos_pnl_files(records)
    except Exception as e:
        logger.debug(f"Could not update running pnl in CSV: {e}")


def rewrite_pos_pnl_files(records):
    """Rewrites pos_strategy_PnL.csv and updates multi-sheet pos_strategy_PnL.xlsx."""
    # 1. Write structured CSV
    with open(POS_PNL_CSV, "w", encoding="utf-8") as f:
        f.write("# ==========================================================================\n")
        f.write("# POSITIONAL STRATEGY P&L TRADE JOURNAL\n")
        f.write("# ==========================================================================\n")
        f.write("Serial_No,Date,Strategy_Name,Instrument,Lot_Size,CE_Symbol,CE_Entry_Price,CE_Exit_Price,PE_Symbol,PE_Entry_Price,PE_Exit_Price,Day_PnL,Cumulative_PnL,Exit_Date,Status\n")
        for r in records:
            f.write(f"{r['Serial_No']},{r['Date']},{r['Strategy_Name']},{r['Instrument']},{r.get('Lot_Size','--')},{r.get('CE_Symbol','--')},{r.get('CE_Entry_Price','--')},{r.get('CE_Exit_Price','--')},{r.get('PE_Symbol','--')},{r.get('PE_Entry_Price','--')},{r.get('PE_Exit_Price','--')},{float(r.get('Day_PnL', 0.0)):.2f},{float(r.get('Cumulative_PnL', 0.0)):.2f},{r.get('Exit_Date','--')},{r.get('Status','OPEN')}\n")

    # 2. Write multi-sheet Excel file (one sheet per instrument + full journal)
    try:
        import pandas as pd
        inst_groups = {}
        for r in records:
            inst = r["Instrument"]
            if inst not in inst_groups:
                inst_groups[inst] = []
            inst_groups[inst].append({
                "Serial No": r["Serial_No"],
                "Date": r["Date"],
                "Strategy Name": r["Strategy_Name"],
                "Instrument": r["Instrument"],
                "Lot Size": r.get("Lot_Size", "--"),
                "CE Symbol": r.get("CE_Symbol", "--"),
                "CE Entry": r.get("CE_Entry_Price", "--"),
                "CE Exit": r.get("CE_Exit_Price", "--"),
                "PE Symbol": r.get("PE_Symbol", "--"),
                "PE Entry": r.get("PE_Entry_Price", "--"),
                "PE Exit": r.get("PE_Exit_Price", "--"),
                "Day PnL": r.get("Day_PnL", 0.0),
                "Cumulative PnL": r.get("Cumulative_PnL", 0.0),
                "Exit Date": r.get("Exit_Date", "--"),
                "Status": r.get("Status", "OPEN")
            })

        with pd.ExcelWriter(POS_PNL_XLSX, engine="openpyxl", mode="w") as writer:
            df_all = pd.DataFrame(records)
            df_all.to_excel(writer, sheet_name="All_Trades", index=False)
            for inst, rows in inst_groups.items():
                df = pd.DataFrame(rows)
                sheet_name = f"{inst}_Trades"[:31]
                df.to_excel(writer, sheet_name=sheet_name, index=False)
    except Exception:
        pass

def create_default_pos_strategy(index_name="NIFTY", name=None):
    qty = get_pos_lot_size(index_name)
    strat_id = f"pos_{str(index_name).lower()}_{int(time.time()*1000)}"
    return {
        "id": strat_id,
        "name": name or f"{index_name} Positional Strangle",
        "active": False,
        "status": "Idle",
        "index_name": index_name,
        "expiry": "",
        "entry_action": "SELL",
        "product": "NRML",
        "ce_premium": 80.0,
        "pe_premium": 80.0,
        "sl_type": "PERCENT",
        "ce_sl_percent": 50.0,
        "pe_sl_percent": 50.0,
        "sl_percent": 50.0,
        "sl_points": 40.0,
        "tp_percent": 70.0,  # Calculated on combined initial total premium (CE + PE)
        "enable_tsl": False,
        "tsl_points": 10.0,
        "reentry_count": 1,  # Max re-entries allowed per leg
        "adjustment_mode": "ROLL_CLOSER",
        "adjustment_threshold_percent": 100.0,
        "quantity": qty,
        "entry_time": "15:00:00",
        "morning_sl_time": "09:17:00",
        "exit_time": "15:15:00",
        "exit_days_before_expiry": 0,
        "orders": {
            "CE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "order_id": None, "sl_order_id": None, "reentry_order_id": None, "sl_modified_to_be": False, "tsl_active": False, "tsl_base_ltp": 0.0, "current_sl_trigger": 0.0, "tsl_hit": False, "awaiting_1pct_reentry": False, "reentries_done": 0, "status": "PENDING"},
            "PE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "order_id": None, "sl_order_id": None, "reentry_order_id": None, "sl_modified_to_be": False, "tsl_active": False, "tsl_base_ltp": 0.0, "current_sl_trigger": 0.0, "tsl_hit": False, "awaiting_1pct_reentry": False, "reentries_done": 0, "status": "PENDING"},
            "orders_placed": False
        },
        "initial_total_premium": 0.0,
        "selected_ce": None,
        "selected_ce_ltp": 0.0,
        "selected_ce_strike": "--",
        "selected_pe": None,
        "selected_pe_ltp": 0.0,
        "selected_pe_strike": "--",
        "run_tag": None,
        "entry_date": "",
        "last_sl_date": "",
        "pnl": 0.0,
        "unrealized_pnl": 0.0,
        "realized_pnl": 0.0,
        "last_checked": ""
    }

def load_pos_strategies():
    """Loads list of positional strategies from pos_strangle.json."""
    if not os.path.exists(POS_STRANGLE_FILE):
        defaults = [
            create_default_pos_strategy("NIFTY", "Nifty Positional Strangle"),
            create_default_pos_strategy("BANKNIFTY", "BankNifty Positional Strangle")
        ]
        save_pos_strategies(defaults)
        return defaults
    try:
        with open(POS_STRANGLE_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, dict):  # upgrade from single object if needed
                data = [data]
            if isinstance(data, list) and len(data) > 0:
                for s in data:
                    s.setdefault("id", f"pos_{int(time.time()*1000)}")
                    s.setdefault("status", "Idle")
                    s.setdefault("index_name", "NIFTY")
                    s.setdefault("entry_action", "SELL")
                    s.setdefault("product", "NRML")
                    s.setdefault("ce_sl_percent", s.get("sl_percent", 50.0))
                    s.setdefault("pe_sl_percent", s.get("sl_percent", 50.0))
                    s.setdefault("tp_percent", 70.0)
                    s.setdefault("enable_tsl", False)
                    s.setdefault("tsl_points", 10.0)
                    s.setdefault("reentry_count", 1)
                    s.setdefault("entry_time", "15:00:00")
                    s.setdefault("morning_sl_time", "09:17:00")
                    s.setdefault("exit_time", "15:15:00")
                    s.setdefault("entry_date", "")
                    s.setdefault("last_sl_date", "")
                    s.setdefault("initial_total_premium", 0.0)
                    s.setdefault("pnl", 0.0)
                    s.setdefault("orders", {
                        "CE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "order_id": None, "sl_order_id": None, "reentry_order_id": None, "sl_modified_to_be": False, "tsl_active": False, "tsl_base_ltp": 0.0, "current_sl_trigger": 0.0, "tsl_hit": False, "awaiting_1pct_reentry": False, "reentries_done": 0, "status": "PENDING"},
                        "PE": {"symbol": None, "first_entry_price": 0.0, "entry_price": 0.0, "current_ltp": 0.0, "order_id": None, "sl_order_id": None, "reentry_order_id": None, "sl_modified_to_be": False, "tsl_active": False, "tsl_base_ltp": 0.0, "current_sl_trigger": 0.0, "tsl_hit": False, "awaiting_1pct_reentry": False, "reentries_done": 0, "status": "PENDING"},
                        "orders_placed": False
                    })
                    for leg in ["CE", "PE"]:
                        s["orders"].setdefault(leg, {})
                        s["orders"][leg].setdefault("first_entry_price", s["orders"][leg].get("entry_price", 0.0))
                        s["orders"][leg].setdefault("reentry_order_id", None)
                        s["orders"][leg].setdefault("reentries_done", 0)
                        s["orders"][leg].setdefault("sl_modified_to_be", False)
                        s["orders"][leg].setdefault("tsl_active", False)
                        s["orders"][leg].setdefault("tsl_base_ltp", 0.0)
                        s["orders"][leg].setdefault("current_sl_trigger", 0.0)
                        s["orders"][leg].setdefault("tsl_hit", False)
                        s["orders"][leg].setdefault("awaiting_1pct_reentry", False)
                return data
    except Exception as e:
        logger.warning(f"Failed to load {POS_STRANGLE_FILE}: {e}")
    defaults = [create_default_pos_strategy("NIFTY")]
    save_pos_strategies(defaults)
    return defaults

def save_pos_strategies(data):
    """Saves list of positional strategies to pos_strangle.json."""
    try:
        clean = [dict(s) for s in data]
        with open(POS_STRANGLE_FILE, "w") as f:
            json.dump(clean, f, indent=4)
    except Exception as e:
        logger.error(f"Failed to save {POS_STRANGLE_FILE}: {e}")

# Global instance state
pos_strategies_store = load_pos_strategies()
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
            logger.warning(f"Could not build Kite client from session cache: {e}")
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
        log_pos("Downloading NFO option instruments...")
        inst = kite.instruments("NFO")
        instruments_cache = [i for i in inst if i.get("segment") == "NFO-OPT"]
        cache_date = today_str
        log_pos(f"Cached {len(instruments_cache)} NFO option contracts.")
        return instruments_cache
    except Exception as e:
        log_pos(f"Error caching instruments: {e}")
        return []

def calculate_pos_strikes_for(strat):
    """Finds best matching CE/PE strikes for target premiums for a given positional strategy."""
    kite = get_kite_client()
    if not kite:
        log_pos(f"[{strat.get('name')}] Cannot calculate strikes: Kite client not authenticated.")
        return False, "Not logged in to Kite"

    inst_list = cache_instruments()
    if not inst_list:
        return False, "Instruments cache empty"

    idx_name = strat.get("index_name", "NIFTY")
    expiry = str(strat.get("expiry") or "").strip()
    target_ce = float(strat.get("ce_premium", 80.0))
    target_pe = float(strat.get("pe_premium", 80.0))

    # Compute all upcoming expiries and monthly expiries (last expiry of each month)
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

    # Resolve dynamic token (CURRENT / CURRENT_MONTH / NEXT / NEXT_MONTH) or explicit date
    exp_upper = expiry.upper()
    if exp_upper in ("CURRENT", "CURRENT_MONTH", "CURRENT_MONTHLY", "CURRENT_EXPIRY", "NEAREST") or not expiry:
        if monthly_expiries:
            expiry = monthly_expiries[0]
            strat["resolved_expiry"] = expiry
            log_pos(f"[{strat.get('name')}] Resolved Current Month Expiry (Last expiry of month): {expiry}")
        elif available_expiries:
            expiry = available_expiries[0]
            strat["resolved_expiry"] = expiry
            log_pos(f"[{strat.get('name')}] Resolved Current Expiry fallback: {expiry}")
        else:
            log_pos(f"[{strat.get('name')}] Calculation error: No valid active expiries found for {idx_name}.")
            return False, f"No active expiries found for {idx_name}"
    elif exp_upper in ("NEXT", "NEXT_MONTH", "NEXT_MONTHLY", "NEXT_EXPIRY", "NEXT_NEAREST"):
        if monthly_expiries:
            expiry = monthly_expiries[1] if len(monthly_expiries) > 1 else monthly_expiries[0]
            strat["resolved_expiry"] = expiry
            log_pos(f"[{strat.get('name')}] Resolved Next Month Expiry (Last expiry of next month): {expiry}")
        elif available_expiries:
            expiry = available_expiries[1] if len(available_expiries) > 1 else available_expiries[0]
            strat["resolved_expiry"] = expiry
            log_pos(f"[{strat.get('name')}] Resolved Next Expiry fallback: {expiry}")
        else:
            log_pos(f"[{strat.get('name')}] Calculation error: No valid active expiries found for {idx_name}.")
            return False, f"No active expiries found for {idx_name}"
    else:
        strat["resolved_expiry"] = expiry

    candidates = [
        i for i in inst_list
        if i.get("name") == idx_name and str(i.get("expiry")).strip() == expiry
    ]

    if not candidates:
        # Fallback to nearest available if specified expiry is not found
        if available_expiries:
            expiry = available_expiries[0]
            strat["expiry"] = expiry
            candidates = [
                i for i in inst_list
                if i.get("name") == idx_name and str(i.get("expiry")).strip() == expiry
            ]
            log_pos(f"[{strat.get('name')}] Falling back to available expiry: {expiry}")

    if not candidates:
        log_pos(f"[{strat.get('name')}] No option contracts found for {idx_name} on {expiry}")
        return False, f"No contracts found for {idx_name} on {expiry}"

    spot_symbols = {
        "NIFTY": "NSE:NIFTY 50",
        "BANKNIFTY": "NSE:NIFTY BANK",
        "FINNIFTY": "NSE:NIFTY FIN SERVICE",
        "MIDCPNIFTY": "NSE:NIFTY MID SELECT",
        "SENSEX": "BSE:SENSEX"
    }
    spot_symbol = spot_symbols.get(idx_name, f"NSE:{idx_name}")
    spot_ltp = 0.0
    try:
        q = kite.ltp(spot_symbol)
        if spot_symbol in q:
            spot_ltp = q[spot_symbol]["last_price"]
    except Exception as e:
        logger.warning(f"Could not fetch spot quote: {e}")

    # Narrow down strikes near spot (+/- 15%)
    narrowed = []
    if spot_ltp > 0:
        val_range = spot_ltp * 0.15
        for c in candidates:
            try:
                strike = float(c.get("strike", 0))
                if abs(strike - spot_ltp) <= val_range:
                    narrowed.append(c)
            except Exception:
                pass
    if not narrowed:
        narrowed = candidates[:200]

    ltp_query = [f"NFO:{c['tradingsymbol']}" for c in narrowed]
    ltp_map = {}
    for i in range(0, len(ltp_query), 100):
        chunk = ltp_query[i:i+100]
        try:
            res = kite.ltp(chunk)
            ltp_map.update(res)
        except Exception as e:
            logger.error(f"Error fetching chunk LTP: {e}")

    best_ce = None
    best_pe = None
    min_ce_diff = float("inf")
    min_pe_diff = float("inf")

    for inst in narrowed:
        key = f"NFO:{inst['tradingsymbol']}"
        if key in ltp_map:
            price = ltp_map[key]["last_price"]
            itype = inst["instrument_type"]
            if itype == "CE":
                diff = abs(price - target_ce)
                if diff < min_ce_diff:
                    min_ce_diff = diff
                    best_ce = (inst, price)
            elif itype == "PE":
                diff = abs(price - target_pe)
                if diff < min_pe_diff:
                    min_pe_diff = diff
                    best_pe = (inst, price)

    global pos_strategies_store
    target_in_store = next((s for s in pos_strategies_store if s.get("id") == strat.get("id")), None)

    if best_ce:
        opt, ltp = best_ce
        strat["selected_ce"] = opt["tradingsymbol"]
        strat["selected_ce_ltp"] = ltp
        strat["selected_ce_strike"] = opt["strike"]
        if target_in_store:
            target_in_store["selected_ce"] = opt["tradingsymbol"]
            target_in_store["selected_ce_ltp"] = ltp
            target_in_store["selected_ce_strike"] = opt["strike"]
        log_pos(f"[{strat.get('name')}] Selected Positional CE: {opt['tradingsymbol']} (Strike {opt['strike']}) LTP: ₹{ltp:.2f} (Target: ₹{target_ce})")

    if best_pe:
        opt, ltp = best_pe
        strat["selected_pe"] = opt["tradingsymbol"]
        strat["selected_pe_ltp"] = ltp
        strat["selected_pe_strike"] = opt["strike"]
        if target_in_store:
            target_in_store["selected_pe"] = opt["tradingsymbol"]
            target_in_store["selected_pe_ltp"] = ltp
            target_in_store["selected_pe_strike"] = opt["strike"]
        log_pos(f"[{strat.get('name')}] Selected Positional PE: {opt['tradingsymbol']} (Strike {opt['strike']}) LTP: ₹{ltp:.2f} (Target: ₹{target_pe})")

    save_pos_strategies(pos_strategies_store)
    return True, f"Strikes calculated for '{strat.get('name')}'"

def place_or_retry_pos_order(strat, leg_type, purpose, target_trigger, target_price=None, order_dict=None):
    """
    Guaranteed order placement for positional Stop Loss and Re-entry orders:
    1. Checks if order is already live on broker (OPEN / TRIGGER PENDING).
    2. Validates trigger vs current LTP to prevent Zerodha rejection (handles gap up/down).
    3. Handles correct exchange (NFO vs BFO for BSE/Sensex/Bankex).
    4. Automatically records order state locally in pending_pos_orders.json.
    5. Returns (bool, order_id_or_msg).
    """
    kite = get_kite_client()
    if not kite:
        return False, "Not logged in to Kite"

    strat_id = strat.get("id", "pos_strat")
    sname = strat.get("name", "Positional Strangle")
    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_pos_exchange(instrument)
    qty = int(strat.get("quantity") or get_pos_lot_size(instrument))
    product = strat.get("product", "NRML").upper()
    entry_action = strat.get("entry_action", "SELL").upper()
    pos_tag = strat.get("run_tag") or f"ps_{strat_id[-4:]}"[:20]

    leg_data = strat["orders"].get(leg_type, {})
    sym = leg_data.get("symbol") or strat.get(f"selected_{leg_type.lower()}")
    if not sym:
        return False, f"Missing symbol for {leg_type}"

    order_key = f"{strat_id}_{leg_type}_{purpose}"
    order_dict = order_dict or {}

    # Check if existing broker order is alive in order book
    existing_order_id = str(leg_data.get("sl_order_id") if purpose in ["SL", "BREAKEVEN_SL"] else leg_data.get("reentry_order_id") or "")
    if existing_order_id and existing_order_id in order_dict:
        st = order_dict[existing_order_id].get("status")
        if st in ["OPEN", "TRIGGER PENDING"]:
            upsert_pending_pos_order(order_key, {
                "strategy_id": strat_id,
                "strategy_name": sname,
                "instrument": instrument,
                "leg": leg_type,
                "purpose": purpose,
                "symbol": sym,
                "exchange": exchange,
                "transaction_type": order_dict[existing_order_id].get("transaction_type", ""),
                "quantity": qty,
                "product": product,
                "order_type": order_dict[existing_order_id].get("order_type", "SL"),
                "trigger_price": float(target_trigger) if target_trigger else None,
                "price": float(order_dict[existing_order_id].get("price", 0.0)),
                "tag": pos_tag,
                "broker_order_id": existing_order_id,
                "status": "PLACED_ON_BROKER",
                "last_error": None
            })
            return True, existing_order_id

    # Fetch live LTP to validate trigger/limit rules
    curr_ltp = 0.0
    try:
        q = kite.ltp(f"{exchange}:{sym}")
        curr_ltp = float(q.get(f"{exchange}:{sym}", {}).get("last_price", 0.0) or 0.0)
    except Exception as e:
        logger.warning(f"Could not fetch LTP for {sym}: {e}")
        curr_ltp = float(leg_data.get("current_ltp") or leg_data.get("first_entry_price") or target_trigger)

    if curr_ltp <= 0:
        curr_ltp = float(target_trigger)

    sl_trigger = None
    sl_price = 0.0

    # -------------------------------------------------------------
    # 1. STOP LOSS (SL / BREAKEVEN_SL) PLACEMENT
    # -------------------------------------------------------------
    if purpose in ["SL", "BREAKEVEN_SL"]:
        if entry_action == "SELL":
            # For short position, SL is a BUY order
            txn_type = kite.TRANSACTION_TYPE_BUY
            sl_trigger = round(float(target_trigger) * 20) / 20

            # Zerodha rule: BUY SL trigger MUST be >= LTP
            if curr_ltp >= sl_trigger:
                # Market already breached trigger: place adjusted trigger above LTP to guarantee acceptance
                sl_trigger = round((curr_ltp + 0.5) * 20) / 20
                sl_price = round((sl_trigger * 1.30) * 20) / 20
                log_pos(f"[{sname}] ⚠️ {leg_type} LTP (₹{curr_ltp:.2f}) >= SL Trigger (₹{target_trigger:.2f}). Adjusting Trigger to ₹{sl_trigger:.2f} (Limit: ₹{sl_price:.2f} [30% Gap])")
            else:
                sl_price = round((sl_trigger * 1.30) * 20) / 20

            order_type = kite.ORDER_TYPE_SL
        else:
            # For long position, SL is a SELL order
            txn_type = kite.TRANSACTION_TYPE_SELL
            sl_trigger = round(float(target_trigger) * 20) / 20

            # Zerodha rule: SELL SL trigger MUST be <= LTP
            if curr_ltp <= sl_trigger:
                sl_trigger = round(max(0.05, curr_ltp - 0.5) * 20) / 20
                sl_price = round(max(0.05, sl_trigger * 0.70) * 20) / 20
                log_pos(f"[{sname}] ⚠️ {leg_type} LTP (₹{curr_ltp:.2f}) <= SL Trigger (₹{target_trigger:.2f}). Adjusting Trigger to ₹{sl_trigger:.2f} (Limit: ₹{sl_price:.2f} [30% Gap])")
            else:
                sl_price = round(max(0.05, sl_trigger * 0.70) * 20) / 20

            order_type = kite.ORDER_TYPE_SL

    # -------------------------------------------------------------
    # 2. RE-ENTRY PLACEMENT
    # -------------------------------------------------------------
    elif purpose == "REENTRY":
        first_p = float(target_trigger)
        if entry_action == "SELL":
            txn_type = kite.TRANSACTION_TYPE_SELL
            if curr_ltp >= first_p:
                # Price is above first entry: place standard SELL SL order (trigger <= LTP)
                order_type = kite.ORDER_TYPE_SL
                sl_trigger = round(first_p * 20) / 20
                sl_price = round((sl_trigger * 0.99) * 20) / 20
            else:
                # Price is already below first entry: place standard LIMIT SELL order
                order_type = kite.ORDER_TYPE_LIMIT
                sl_trigger = None
                sl_price = round(first_p * 20) / 20
        else:
            txn_type = kite.TRANSACTION_TYPE_BUY
            if curr_ltp <= first_p:
                # Price is below first entry: place standard BUY SL order (trigger >= LTP)
                order_type = kite.ORDER_TYPE_SL
                sl_trigger = round(first_p * 20) / 20
                sl_price = round((sl_trigger * 1.01) * 20) / 20
            else:
                # Price is already above first entry: place standard LIMIT BUY order
                order_type = kite.ORDER_TYPE_LIMIT
                sl_trigger = None
                sl_price = round(first_p * 20) / 20

    # Save to local pending orders book
    upsert_pending_pos_order(order_key, {
        "strategy_id": strat_id,
        "strategy_name": sname,
        "instrument": instrument,
        "leg": leg_type,
        "purpose": purpose,
        "symbol": sym,
        "exchange": exchange,
        "transaction_type": txn_type,
        "quantity": qty,
        "product": product,
        "order_type": order_type,
        "trigger_price": float(sl_trigger) if sl_trigger else None,
        "price": float(sl_price),
        "tag": pos_tag,
        "broker_order_id": None,
        "status": "PENDING_PLACEMENT",
        "last_error": None
    })

    # Place order on Kite
    try:
        order_kwargs = {
            "variety": kite.VARIETY_REGULAR,
            "exchange": exchange,
            "tradingsymbol": sym,
            "transaction_type": txn_type,
            "quantity": qty,
            "product": product,
            "order_type": order_type,
            "price": float(sl_price),
            "tag": pos_tag
        }
        if sl_trigger is not None:
            order_kwargs["trigger_price"] = float(sl_trigger)

        log_pos(f"[{sname}] 🚀 Placing {purpose} for {leg_type} ({sym}) on {exchange} (Qty:{qty}, Price:₹{sl_price:.2f}" + (f", Trigger:₹{sl_trigger:.2f}" if sl_trigger else "") + ")...")
        placed_order_id = kite.place_order(**order_kwargs)
        log_pos(f"[{sname}] ✅ {purpose} for {leg_type} ({sym}) successfully placed on broker! Order ID: {placed_order_id}")

        if purpose in ["SL", "BREAKEVEN_SL"]:
            leg_data["sl_order_id"] = placed_order_id
            if sl_trigger:
                leg_data["current_sl_trigger"] = sl_trigger
        elif purpose == "REENTRY":
            leg_data["reentry_order_id"] = placed_order_id
            leg_data["status"] = "REENTRY_PENDING"

        upsert_pending_pos_order(order_key, {
            "strategy_id": strat_id,
            "strategy_name": sname,
            "instrument": instrument,
            "leg": leg_type,
            "purpose": purpose,
            "symbol": sym,
            "exchange": exchange,
            "transaction_type": txn_type,
            "quantity": qty,
            "product": product,
            "order_type": order_type,
            "trigger_price": float(sl_trigger) if sl_trigger else None,
            "price": float(sl_price),
            "tag": pos_tag,
            "broker_order_id": placed_order_id,
            "status": "PLACED_ON_BROKER",
            "last_error": None
        })
        save_pos_strategies(pos_strategies_store)
        return True, str(placed_order_id)

    except Exception as e:
        err_msg = str(e)
        log_pos(f"[{sname}] ❌ Broker rejected {purpose} order for {leg_type} ({sym}): {err_msg}")
        upsert_pending_pos_order(order_key, {
            "strategy_id": strat_id,
            "strategy_name": sname,
            "instrument": instrument,
            "leg": leg_type,
            "purpose": purpose,
            "symbol": sym,
            "exchange": exchange,
            "transaction_type": txn_type,
            "quantity": qty,
            "product": product,
            "order_type": order_type,
            "trigger_price": float(sl_trigger) if sl_trigger else None,
            "price": float(sl_price),
            "tag": pos_tag,
            "broker_order_id": None,
            "status": "FAILED",
            "last_error": err_msg
        })
        return False, err_msg


def place_positional_orders_for(strat):
    """Places fresh multi-day positional strangle entry orders and registers SL orders locally."""
    kite = get_kite_client()
    if not kite:
        log_pos(f"[{strat.get('name')}] Order placement failed: Not logged in.")
        return False, "Not logged in"

    sname = strat.get("name", "Positional Strangle")
    ce_sym = strat.get("selected_ce")
    pe_sym = strat.get("selected_pe")
    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_pos_exchange(instrument)
    qty = int(strat.get("quantity") or get_pos_lot_size(instrument))
    product = strat.get("product", "NRML").upper()
    entry_action = strat.get("entry_action", "SELL").upper()
    sl_type = strat.get("sl_type", "PERCENT").upper()
    ce_sl_pct = float(strat.get("ce_sl_percent", strat.get("sl_percent", 50.0)))
    pe_sl_pct = float(strat.get("pe_sl_percent", strat.get("sl_percent", 50.0)))
    sl_points = float(strat.get("sl_points", 40.0))

    if not ce_sym or not pe_sym:
        log_pos(f"[{sname}] Cannot place orders: CE/PE strikes not selected.")
        return False, "CE/PE strikes not selected"

    today_str = datetime.now().strftime("%m%d_%H%M")
    strat_id_suffix = strat.get("id", "")[-4:]
    pos_tag = f"ps_{today_str}_{strat_id_suffix}"[:20]
    strat["run_tag"] = pos_tag

    # Store combined initial total premium
    ce_init_ltp = float(strat.get("selected_ce_ltp", 80.0))
    pe_init_ltp = float(strat.get("selected_pe_ltp", 80.0))
    strat["initial_total_premium"] = round(ce_init_ltp + pe_init_ltp, 2)
    log_pos(f"[{sname}] Combined Total Premium recorded: ₹{strat['initial_total_premium']:.2f} (CE: ₹{ce_init_ltp:.2f} + PE: ₹{pe_init_ltp:.2f})")

    for sym, opt_type, leg_sl_pct in [(ce_sym, "CE", ce_sl_pct), (pe_sym, "PE", pe_sl_pct)]:
        try:
            last_ltp = float(strat.get(f"selected_{opt_type.lower()}_ltp", 80.0) or 80.0)
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
                # For SELL order: get bid price & quantity, send order with 1% less trigger price and 20% up limit price
                base_price = best_bid_price if best_bid_price > 0 else float(last_ltp)
                entry_txn = kite.TRANSACTION_TYPE_SELL
                entry_trigger = round((base_price * 0.99) * 20) / 20
                entry_limit = round((entry_trigger * 1.20) * 20) / 20

                log_pos(f"[{sname}] Placing SELL SL Order for {sym} Qty:{qty} ({product}) on {exchange} (Best Bid: ₹{best_bid_price:.2f} [Depth Qty: {best_bid_qty}], Base: ₹{base_price:.2f} -> Trigger: ₹{entry_trigger:.2f} [-1%], Limit: ₹{entry_limit:.2f} [+20%])...")
                order_id = kite.place_order(
                    variety=kite.VARIETY_REGULAR,
                    exchange=exchange,
                    tradingsymbol=sym,
                    transaction_type=entry_txn,
                    quantity=qty,
                    product=product,
                    order_type=kite.ORDER_TYPE_SL,
                    price=float(entry_limit),
                    trigger_price=float(entry_trigger),
                    tag=pos_tag
                )
            else:
                # BUY order: fetch best offer/ask price and send order with 1% higher than offer price
                base_price = best_ask_price if best_ask_price > 0 else float(last_ltp)
                entry_txn = kite.TRANSACTION_TYPE_BUY
                order_price = round((base_price * 1.01) * 20) / 20
                log_pos(f"[{sname}] Placing BUY {sym} Qty:{qty} ({product}) on {exchange} (Best Ask/Offer: ₹{best_ask_price:.2f} [Depth Qty: {best_ask_qty}], Base: ₹{base_price:.2f} -> Limit Order: ₹{order_price:.2f} [+1%])...")
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

            log_pos(f"[{sname}] {entry_action} {sym} Order Placed. ID: {order_id}")

            strat["orders"][opt_type]["symbol"] = sym
            strat["orders"][opt_type]["first_entry_price"] = last_ltp
            strat["orders"][opt_type]["entry_price"] = last_ltp
            strat["orders"][opt_type]["current_ltp"] = last_ltp
            strat["orders"][opt_type]["order_id"] = order_id
            strat["orders"][opt_type]["reentry_order_id"] = None
            strat["orders"][opt_type]["status"] = "ACTIVE"
            strat["orders"][opt_type]["sl_modified_to_be"] = False
            strat["orders"][opt_type]["reentries_done"] = 0

            # Compute individual SL trigger
            if entry_action == "BUY":
                calc_sl = last_ltp * (1.0 - (leg_sl_pct / 100.0)) if sl_type == "PERCENT" else last_ltp - sl_points
                calc_sl = max(0.05, calc_sl)
            else:
                calc_sl = last_ltp * (1.0 + (leg_sl_pct / 100.0)) if sl_type == "PERCENT" else last_ltp + sl_points

            # Place SL order with local pending orders book tracking
            place_or_retry_pos_order(strat, opt_type, "SL", calc_sl)

        except Exception as e:
            log_pos(f"[{sname}] Failed order placement for {sym}: {e}")

    now_date = datetime.now().strftime("%Y-%m-%d")
    strat["orders"]["orders_placed"] = True
    strat["status"] = "Holding (Orders Placed)"
    strat["entry_date"] = now_date
    strat["last_sl_date"] = now_date

    global pos_strategies_store
    target_in_store = next((s for s in pos_strategies_store if s.get("id") == strat.get("id")), None)
    if target_in_store:
        target_in_store["orders"]["orders_placed"] = True
        target_in_store["status"] = "Holding (Orders Placed)"
        target_in_store["entry_date"] = now_date
        target_in_store["last_sl_date"] = now_date

    save_pos_strategies(pos_strategies_store)
    record_pos_trade_entry(strat)
    return True, "Orders placed successfully"


def modify_pos_sl_to_breakeven(strat, leg_type):
    """Modifies the other active leg's Stop Loss order to Breakeven (its original entry price)."""
    kite = get_kite_client()
    if not kite:
        return

    sname = strat.get("name", "Positional Strangle")
    leg_data = strat["orders"].get(leg_type, {})
    sl_id = leg_data.get("sl_order_id")
    entry_p = float(leg_data.get("first_entry_price") or leg_data.get("entry_price", 0.0))
    sym = leg_data.get("symbol")
    qty = int(strat.get("quantity") or get_pos_lot_size(strat.get("index_name")))
    entry_action = strat.get("entry_action", "SELL").upper()

    if not sl_id or entry_p <= 0 or leg_data.get("sl_modified_to_be"):
        return

    try:
        sl_trigger = round(entry_p * 20) / 20
        sl_price = round((sl_trigger * 1.30) * 20) / 20 if entry_action == "SELL" else round(max(0.05, sl_trigger * 0.70) * 20) / 20

        kite.modify_order(
            variety=kite.VARIETY_REGULAR,
            order_id=sl_id,
            price=float(sl_price),
            trigger_price=float(sl_trigger),
            quantity=qty,
            order_type=kite.ORDER_TYPE_SL
        )
        leg_data["sl_modified_to_be"] = True
        leg_data["current_sl_trigger"] = sl_trigger
        leg_data["tsl_base_ltp"] = float(leg_data.get("current_ltp") or entry_p)

        order_key = f"{strat.get('id')}_{leg_type}_BREAKEVEN_SL"
        upsert_pending_pos_order(order_key, {
            "strategy_id": strat.get("id"),
            "strategy_name": sname,
            "instrument": strat.get("index_name"),
            "leg": leg_type,
            "purpose": "BREAKEVEN_SL",
            "symbol": sym,
            "exchange": get_pos_exchange(strat.get("index_name")),
            "quantity": qty,
            "product": strat.get("product", "NRML"),
            "trigger_price": float(sl_trigger),
            "price": float(sl_price),
            "broker_order_id": sl_id,
            "status": "PLACED_ON_BROKER",
            "last_error": None
        })

        if strat.get("enable_tsl"):
            leg_data["tsl_active"] = True
            log_pos(f"[{sname}] 🎯 Opposite leg ({leg_type}: {sym}) SL moved to BREAKEVEN (₹{entry_p:.2f}) & Trailing SL (TSL) ARMED with step {strat.get('tsl_points', 10.0)} pts!")
        else:
            log_pos(f"[{sname}] 🎯 Opposite leg ({leg_type}: {sym}) SL modified to BREAKEVEN at First Entry Price: ₹{entry_p:.2f}")
    except Exception as e:
        log_pos(f"[{sname}] Failed modifying {leg_type} SL to Breakeven: {e}")


def trail_pos_sl_for_leg(strat, leg_type, curr_ltp):
    """Trails the active breakeven leg's SL lower (for SELL) or higher (for BUY) when price moves favorably by tsl_points."""
    if not strat.get("enable_tsl"):
        return

    kite = get_kite_client()
    if not kite:
        return

    sname = strat.get("name", "Positional Strangle")
    leg_data = strat["orders"].get(leg_type, {})
    if not leg_data.get("sl_modified_to_be") or leg_data.get("status") != "ACTIVE":
        return

    sl_id = leg_data.get("sl_order_id")
    if not sl_id:
        return

    tsl_pts = float(strat.get("tsl_points", 10.0))
    if tsl_pts <= 0:
        return

    base_ltp = float(leg_data.get("tsl_base_ltp") or leg_data.get("first_entry_price") or leg_data.get("entry_price", 0.0))
    curr_trigger = float(leg_data.get("current_sl_trigger") or leg_data.get("first_entry_price") or leg_data.get("entry_price", 0.0))
    entry_action = strat.get("entry_action", "SELL").upper()
    qty = int(strat.get("quantity") or get_pos_lot_size(strat.get("index_name")))
    sym = leg_data.get("symbol")

    if entry_action == "SELL":
        if curr_ltp <= (base_ltp - tsl_pts):
            steps = int((base_ltp - curr_ltp) // tsl_pts)
            if steps >= 1:
                trail_amount = steps * tsl_pts
                new_trigger = round((curr_trigger - trail_amount) * 20) / 20
                min_trigger = round((curr_ltp + 0.5) * 20) / 20
                if new_trigger < min_trigger:
                    new_trigger = min_trigger
                new_price = round((new_trigger * 1.30) * 20) / 20

                if new_trigger < curr_trigger:
                    try:
                        kite.modify_order(
                            variety=kite.VARIETY_REGULAR,
                            order_id=sl_id,
                            price=float(new_price),
                            trigger_price=float(new_trigger),
                            quantity=qty,
                            order_type=kite.ORDER_TYPE_SL
                        )
                        leg_data["current_sl_trigger"] = new_trigger
                        leg_data["tsl_base_ltp"] = round(base_ltp - (steps * tsl_pts), 2)
                        leg_data["tsl_active"] = True
                        log_pos(f"[{sname}] 🎯 TSL Moved LOWER for {leg_type} ({sym}) by {trail_amount:.1f} pts! New SL Trigger: ₹{new_trigger:.2f} (Limit: ₹{new_price:.2f} [30% Gap], LTP: ₹{curr_ltp:.2f})")
                    except Exception as e:
                        logger.warning(f"[{sname}] Could not trail SL for {leg_type}: {e}")
    else:
        if curr_ltp >= (base_ltp + tsl_pts):
            steps = int((curr_ltp - base_ltp) // tsl_pts)
            if steps >= 1:
                trail_amount = steps * tsl_pts
                new_trigger = round((curr_trigger + trail_amount) * 20) / 20
                max_trigger = round((curr_ltp - 0.5) * 20) / 20
                if new_trigger > max_trigger:
                    new_trigger = max_trigger
                new_price = round(max(0.05, new_trigger * 0.70) * 20) / 20

                if new_trigger > curr_trigger:
                    try:
                        kite.modify_order(
                            variety=kite.VARIETY_REGULAR,
                            order_id=sl_id,
                            price=float(new_price),
                            trigger_price=float(new_trigger),
                            quantity=qty,
                            order_type=kite.ORDER_TYPE_SL
                        )
                        leg_data["current_sl_trigger"] = new_trigger
                        leg_data["tsl_base_ltp"] = round(base_ltp + (steps * tsl_pts), 2)
                        leg_data["tsl_active"] = True
                        log_pos(f"[{sname}] 🎯 TSL Moved HIGHER for {leg_type} ({sym}) by {trail_amount:.1f} pts! New SL Trigger: ₹{new_trigger:.2f} (Limit: ₹{new_price:.2f} [30% Gap], LTP: ₹{curr_ltp:.2f})")
                    except Exception as e:
                        logger.warning(f"[{sname}] Could not trail SL for {leg_type}: {e}")


def place_pos_reentry_order_for_leg(strat, hit_leg_type, order_dict=None):
    """Places re-entry order at original first entry price using guaranteed smart placement."""
    leg_data = strat["orders"].get(hit_leg_type, {})
    first_p = float(leg_data.get("first_entry_price") or leg_data.get("entry_price", 0.0))
    if first_p <= 0:
        log_pos(f"[{strat.get('name')}] Cannot re-enter {hit_leg_type}: Original first entry price not recorded.")
        return

    place_or_retry_pos_order(strat, hit_leg_type, "REENTRY", first_p, order_dict=order_dict)


def place_pos_sl_for_reentered_leg(strat, leg_type):
    """Places fresh Stop Loss order AFTER the re-entry limit order has been executed."""
    leg_sl_pct = float(strat.get(f"{leg_type.lower()}_sl_percent", strat.get("sl_percent", 50.0)))
    sl_type = strat.get("sl_type", "PERCENT").upper()
    sl_points = float(strat.get("sl_points", 40.0))
    first_p = float(strat["orders"][leg_type].get("first_entry_price") or strat["orders"][leg_type].get("entry_price", 80.0))
    entry_action = strat.get("entry_action", "SELL").upper()

    if entry_action == "BUY":
        calc_sl = first_p * (1.0 - (leg_sl_pct / 100.0)) if sl_type == "PERCENT" else first_p - sl_points
        calc_sl = max(0.05, calc_sl)
    else:
        calc_sl = first_p * (1.0 + (leg_sl_pct / 100.0)) if sl_type == "PERCENT" else first_p + sl_points

    place_or_retry_pos_order(strat, leg_type, "SL", calc_sl)


def squareoff_positional_strangle_for(strat):
    """Squares off all active positional strangle legs for a given strategy and clears pending orders."""
    kite = get_kite_client()
    if not kite:
        return False, "Not logged in"

    sname = strat.get("name", "Positional Strangle")
    instrument = (strat.get("index_name") or "NIFTY").upper()
    exchange = get_pos_exchange(instrument)
    qty = int(strat.get("quantity") or get_pos_lot_size(instrument))
    product = strat.get("product", "NRML").upper()
    entry_action = strat.get("entry_action", "SELL").upper()
    exit_txn = kite.TRANSACTION_TYPE_BUY if entry_action == "SELL" else kite.TRANSACTION_TYPE_SELL
    pos_tag = strat.get("run_tag") or "ps_exit"

    log_pos(f"[{sname}] ⚡ Squaring off positional strangle...")

    # 1. Cancel pending SL orders and Re-entry orders
    for leg in ["CE", "PE"]:
        sl_id = strat["orders"][leg].get("sl_order_id")
        if sl_id:
            try:
                kite.cancel_order(variety=kite.VARIETY_REGULAR, order_id=sl_id)
                log_pos(f"[{sname}] Cancelled SL Order {sl_id}")
            except Exception as e:
                logger.warning(f"Could not cancel SL {sl_id}: {e}")

        reentry_id = strat["orders"][leg].get("reentry_order_id")
        if reentry_id:
            try:
                kite.cancel_order(variety=kite.VARIETY_REGULAR, order_id=reentry_id)
                log_pos(f"[{sname}] Cancelled Re-entry Order {reentry_id}")
            except Exception as e:
                logger.warning(f"Could not cancel Re-entry {reentry_id}: {e}")

        # Clear from pending orders book
        remove_pending_pos_order(f"{strat.get('id')}_{leg}_SL")
        remove_pending_pos_order(f"{strat.get('id')}_{leg}_BREAKEVEN_SL")
        remove_pending_pos_order(f"{strat.get('id')}_{leg}_REENTRY")

    # 2. Place Square-off orders for ACTIVE legs
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

        if not strat["orders"][leg].get("exit_price") or float(strat["orders"][leg].get("exit_price", 0.0)) == 0.0:
            strat["orders"][leg]["exit_price"] = curr_ltp

        if sym and strat["orders"][leg].get("status") == "ACTIVE":
            if exit_txn == kite.TRANSACTION_TYPE_BUY:
                # Exiting short position (buying back): use best ask/offer + 1%
                base_exit_p = best_ask_price if best_ask_price > 0 else curr_ltp
                exit_limit = round((base_exit_p * 1.01) * 20) / 20 if base_exit_p > 0 else 0.0
                log_pos(f"[{sname}] Exit BUY Order for {leg} ({sym}): Best Ask/Offer: ₹{best_ask_price:.2f} (Depth Qty: {best_ask_qty}), LTP: ₹{curr_ltp:.2f} -> Limit: ₹{exit_limit:.2f} (+1%)...")
            else:
                base_exit_p = best_bid_price if best_bid_price > 0 else curr_ltp
                exit_limit = round((base_exit_p * 0.99) * 20) / 20 if base_exit_p > 0 else 0.0
                log_pos(f"[{sname}] Exit SELL Order for {leg} ({sym}): Best Bid: ₹{best_bid_price:.2f} (Depth Qty: {best_bid_qty}), LTP: ₹{curr_ltp:.2f} -> Limit: ₹{exit_limit:.2f} (-1%)...")

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
                log_pos(f"[{sname}] Exit order placed for {leg} ({sym}) on {exchange}. Order ID: {oid}")
                strat["orders"][leg]["status"] = "SQUARED_OFF"
            except Exception as e:
                log_pos(f"[{sname}] Limit exit failed for {leg} ({sym}): {e}. Retrying with MARKET order...")
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
                    log_pos(f"[{sname}] Market exit order placed for {leg} ({sym}). Order ID: {oid}")
                    strat["orders"][leg]["status"] = "SQUARED_OFF"
                except Exception as mkt_e:
                    log_pos(f"[{sname}] Market exit order ALSO failed for {leg} ({sym}): {mkt_e}")

    strat["active"] = False
    strat["status"] = "Squared Off"
    strat["orders"]["orders_placed"] = False
    final_pnl = strat.get("pnl", 0.0)

    save_pos_strategies(pos_strategies_store)
    record_pos_trade_exit(strat, final_pnl)
    return True, f"Square off executed for '{sname}'"


def ensure_daily_positional_sl_orders_for(strat, order_dict):
    """
    On market open at morning_sl_time each day:
    1. For ACTIVE legs: Restores missing Stop Loss orders in pending orders book and places them on broker.
    2. For SL_HIT / REENTRY_PENDING legs: Restores Re-entry orders at original first entry price.
    3. Confirms all orders are live before marking daily SL task complete.
    """
    kite = get_kite_client()
    if not kite or not strat.get("active") or not strat.get("orders", {}).get("orders_placed"):
        return

    sname = strat.get("name", "Positional Strangle")
    entry_action = strat.get("entry_action", "SELL").upper()
    sl_type = strat.get("sl_type", "PERCENT").upper()
    sl_points = float(strat.get("sl_points", 40.0))
    morning_sl_t = strat.get("morning_sl_time", "09:17:00")
    max_reentry = int(strat.get("reentry_count", 1))

    all_legs_confirmed = True

    for leg in ["CE", "PE"]:
        leg_data = strat["orders"].get(leg, {})
        sym = leg_data.get("symbol")
        status = leg_data.get("status")
        done_reentry = int(leg_data.get("reentries_done", 0))

        if not sym:
            continue

        # A. If leg SL was hit previously and re-entry is pending:
        if status in ["SL_HIT", "REENTRY_PENDING"] and done_reentry < max_reentry:
            first_p = float(leg_data.get("first_entry_price") or leg_data.get("entry_price", 0.0))
            if first_p > 0:
                ok, _ = place_or_retry_pos_order(strat, leg, "REENTRY", first_p, order_dict=order_dict)
                if not ok:
                    all_legs_confirmed = False

        # B. If leg is ACTIVE: Check and restore Stop Loss order
        elif status == "ACTIVE":
            entry_p = float(leg_data.get("first_entry_price") or leg_data.get("entry_price", 0.0))
            if entry_p <= 0:
                continue

            leg_sl_pct = float(strat.get(f"{leg.lower()}_sl_percent", strat.get("sl_percent", 50.0)))
            is_be = leg_data.get("sl_modified_to_be", False)

            if is_be:
                sl_trigger = round(entry_p * 20) / 20
                purpose = "BREAKEVEN_SL"
            else:
                if entry_action == "BUY":
                    calc_sl = entry_p * (1.0 - (leg_sl_pct / 100.0)) if sl_type == "PERCENT" else entry_p - sl_points
                    sl_trigger = round(max(0.05, calc_sl) * 20) / 20
                else:
                    calc_sl = entry_p * (1.0 + (leg_sl_pct / 100.0)) if sl_type == "PERCENT" else entry_p + sl_points
                    sl_trigger = round(calc_sl * 20) / 20
                purpose = "SL"

            ok, _ = place_or_retry_pos_order(strat, leg, purpose, sl_trigger, order_dict=order_dict)
            if not ok:
                all_legs_confirmed = False

    if all_legs_confirmed:
        strat["last_sl_date"] = datetime.now().strftime("%Y-%m-%d")
        save_pos_strategies(pos_strategies_store)
        log_pos(f"[{sname}] 🌅 All morning ({morning_sl_t}) SL & Re-entry orders confirmed live on broker!")


def monitor_positional_strategies_cycle():
    """Monitors live LTPs, timed execution entry, next-day morning SL restoration, individual leg SL hits, Breakeven modification, Re-entries, and Total Premium TP."""
    global pos_strategies_store
    kite = get_kite_client()
    if not kite:
        return

    active_strats = [s for s in pos_strategies_store if s.get("active")]
    if not active_strats:
        return

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    now_time = now.strftime("%H:%M:%S")

    # Fetch order book for status checks
    try:
        account_orders = kite.orders()
        order_dict = {str(o.get("order_id")): o for o in account_orders}
    except Exception as e:
        order_dict = {}

    for s in active_strats:
        sname = s.get("name", "Positional Strangle")
        orders_data = s.setdefault("orders", {})
        orders_placed = orders_data.get("orders_placed", False)
        entry_t = s.get("entry_time", "15:00:00")
        exit_t = s.get("exit_time", "15:15:00")
        morning_sl_t = s.get("morning_sl_time", "09:17:00")

        # -------------------------------------------------------------
        # 1. TIMED EXECUTION: Initial entry placement if NOT placed yet
        # -------------------------------------------------------------
        if not orders_placed:
            if now_time >= entry_t and now_time <= exit_t:
                log_pos(f"[{sname}] ⏰ Scheduled Entry Time ({entry_t}) reached! Executing positional entry...")
                if not s.get("selected_ce") or not s.get("selected_pe") or float(s.get("selected_ce_ltp", 0)) <= 0:
                    ok, msg = calculate_pos_strikes_for(s)
                    if not ok:
                        log_pos(f"[{sname}] ⚠️ Strike calculation for entry failed: {msg}. Retrying in next cycle.")
                        continue
                
                place_positional_orders_for(s)
            else:
                s["status"] = f"Awaiting Entry ({entry_t})"
                continue

        # -------------------------------------------------------------
        # 2. NEXT-DAY MORNING SL: Send ONLY SL & Re-entry orders (Position is ON)
        # -------------------------------------------------------------
        if orders_placed:
            if s.get("status", "").startswith("Awaiting") or s.get("status") == "Active":
                s["status"] = "Holding Position"

            # Check if morning SL time has arrived and SLs/re-entries have not been placed today
            if now_time >= morning_sl_t and now_time <= "15:30:00":
                if s.get("last_sl_date") != today_str:
                    log_pos(f"[{sname}] 🌅 Next-day SL Time ({morning_sl_t}) reached. Position is ON (holding overnight). Sending morning SL and pending re-entries...")
                    ensure_daily_positional_sl_orders_for(s, order_dict)

    # -------------------------------------------------------------
    # 3. LIVE MONITORING FOR ACTIVE OPEN POSITIONS & RE-ENTRIES
    # -------------------------------------------------------------
    symbols_to_quote = set()
    for s in active_strats:
        if s.get("orders", {}).get("orders_placed"):
            exch = get_pos_exchange(s.get("index_name"))
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

            sname = s.get("name", "Positional Strangle")
            exch = get_pos_exchange(s.get("index_name"))
            total_pnl = 0.0
            qty = int(s.get("quantity") or get_pos_lot_size(s.get("index_name")))
            entry_action = s.get("entry_action", "SELL").upper()
            tp_percent = float(s.get("tp_percent", 70.0))

            ce_sl_id = str(s["orders"]["CE"].get("sl_order_id") or "")
            pe_sl_id = str(s["orders"]["PE"].get("sl_order_id") or "")

            ce_sl_status = order_dict.get(ce_sl_id, {}).get("status") if ce_sl_id else None
            pe_sl_status = order_dict.get(pe_sl_id, {}).get("status") if pe_sl_id else None

            # -------------------------------------------------------------
            # Check if CE SL hit -> Move PE SL to Breakeven & Place CE Re-entry Limit Order
            # -------------------------------------------------------------
            if ce_sl_status == "COMPLETE" and s["orders"]["CE"].get("status") == "ACTIVE":
                ce_order_info = order_dict.get(ce_sl_id, {})
                ce_exit_p = float(ce_order_info.get("average_price") or ce_order_info.get("price") or s["orders"]["CE"].get("current_sl_trigger") or quotes.get(f"{exch}:{s['orders']['CE'].get('symbol')}", {}).get("last_price", 0.0))
                s["orders"]["CE"]["exit_price"] = ce_exit_p
                if s["orders"]["CE"].get("tsl_active"):
                    log_pos(f"[{sname}] 🛑 CE Trailed Stop-Loss (TSL) triggered at ₹{ce_exit_p:.2f}!")
                    s["orders"]["CE"]["status"] = "TSL_HIT"
                    s["orders"]["CE"]["tsl_hit"] = True
                    s["orders"]["CE"]["awaiting_1pct_reentry"] = True
                    first_p = float(s["orders"]["CE"].get("first_entry_price") or s["orders"]["CE"].get("entry_price", 0.0))
                    threshold_p = first_p * 1.01 if entry_action == "SELL" else first_p * 0.99
                    log_pos(f"[{sname}] ⏳ CE TSL Hit: Re-entry is ON HOLD and will only be placed once LTP moves 1% beyond original entry (Trigger Threshold: ₹{threshold_p:.2f}).")
                else:
                    log_pos(f"[{sname}] 🛑 CE Stop-Loss triggered at ₹{ce_exit_p:.2f}!")
                    s["orders"]["CE"]["status"] = "SL_HIT"
                    modify_pos_sl_to_breakeven(s, "PE")
                    place_pos_reentry_order_for_leg(s, "CE", order_dict)

            # -------------------------------------------------------------
            # Check if PE SL hit -> Move CE SL to Breakeven & Place PE Re-entry Limit Order
            # -------------------------------------------------------------
            if pe_sl_status == "COMPLETE" and s["orders"]["PE"].get("status") == "ACTIVE":
                pe_order_info = order_dict.get(pe_sl_id, {})
                pe_exit_p = float(pe_order_info.get("average_price") or pe_order_info.get("price") or s["orders"]["PE"].get("current_sl_trigger") or quotes.get(f"{exch}:{s['orders']['PE'].get('symbol')}", {}).get("last_price", 0.0))
                s["orders"]["PE"]["exit_price"] = pe_exit_p
                if s["orders"]["PE"].get("tsl_active"):
                    log_pos(f"[{sname}] 🛑 PE Trailed Stop-Loss (TSL) triggered at ₹{pe_exit_p:.2f}!")
                    s["orders"]["PE"]["status"] = "TSL_HIT"
                    s["orders"]["PE"]["tsl_hit"] = True
                    s["orders"]["PE"]["awaiting_1pct_reentry"] = True
                    first_p = float(s["orders"]["PE"].get("first_entry_price") or s["orders"]["PE"].get("entry_price", 0.0))
                    threshold_p = first_p * 1.01 if entry_action == "SELL" else first_p * 0.99
                    log_pos(f"[{sname}] ⏳ PE TSL Hit: Re-entry is ON HOLD and will only be placed once LTP moves 1% beyond original entry (Trigger Threshold: ₹{threshold_p:.2f}).")
                else:
                    log_pos(f"[{sname}] 🛑 PE Stop-Loss triggered at ₹{pe_exit_p:.2f}!")
                    s["orders"]["PE"]["status"] = "SL_HIT"
                    modify_pos_sl_to_breakeven(s, "CE")
                    place_pos_reentry_order_for_leg(s, "PE", order_dict)

            # -------------------------------------------------------------
            # Check pending Re-entry Limit Orders for execution confirmation
            # -------------------------------------------------------------
            for leg in ["CE", "PE"]:
                leg_data = s["orders"].get(leg, {})
                if leg_data.get("status") == "REENTRY_PENDING":
                    reentry_id = str(leg_data.get("reentry_order_id") or "")
                    if reentry_id and reentry_id in order_dict:
                        reentry_status = order_dict[reentry_id].get("status")
                        if reentry_status == "COMPLETE":
                            first_p = float(leg_data.get("first_entry_price") or leg_data.get("entry_price", 0.0))
                            done_count = int(leg_data.get("reentries_done", 0)) + 1
                            leg_data["reentries_done"] = done_count
                            leg_data["status"] = "ACTIVE"
                            leg_data["reentry_order_id"] = None
                            leg_data["sl_modified_to_be"] = False
                            leg_data["tsl_active"] = False
                            leg_data["tsl_hit"] = False
                            leg_data["awaiting_1pct_reentry"] = False
                            log_pos(f"[{sname}] 🎉 Re-entry order EXECUTED for {leg} at original entry price ₹{first_p:.2f}! Placing Stop-Loss order...")
                            place_pos_sl_for_reentered_leg(s, leg)

            # -------------------------------------------------------------
            # Calculate current P&L, Total Premium, Trail SL & Check 1% TSL Re-entry
            # -------------------------------------------------------------
            current_total_premium = 0.0
            for leg in ["CE", "PE"]:
                sym = s["orders"][leg].get("symbol")
                q_key = f"{exch}:{sym}"
                if sym and q_key in quotes:
                    curr_ltp = quotes[q_key]["last_price"]
                    s["orders"][leg]["current_ltp"] = curr_ltp
                    current_total_premium += curr_ltp
                    entry_p = float(s["orders"][leg].get("entry_price", curr_ltp))

                    # 1. Trail Stop Loss if active on this leg
                    if s["orders"][leg].get("status") == "ACTIVE" and s["orders"][leg].get("sl_modified_to_be") and s.get("enable_tsl"):
                        trail_pos_sl_for_leg(s, leg, curr_ltp)

                    # 2. Check 1% Re-entry condition for TSL-hit leg
                    if s["orders"][leg].get("awaiting_1pct_reentry"):
                        first_p = float(s["orders"][leg].get("first_entry_price") or s["orders"][leg].get("entry_price", 0.0))
                        cond_met = (curr_ltp >= first_p * 1.01) if entry_action == "SELL" else (curr_ltp <= first_p * 0.99)
                        if cond_met:
                            s["orders"][leg]["awaiting_1pct_reentry"] = False
                            log_pos(f"[{sname}] 🚀 1% threshold achieved for {leg} ({sym}) (LTP: ₹{curr_ltp:.2f} >= ₹{first_p * 1.01:.2f})! Placing Re-entry order...")
                            place_pos_reentry_order_for_leg(s, leg, order_dict)

                    if s["orders"][leg].get("status") == "ACTIVE":
                        if entry_action == "SELL":
                            leg_pnl = (entry_p - curr_ltp) * qty
                        else:
                            leg_pnl = (curr_ltp - entry_p) * qty
                        total_pnl += leg_pnl

            s["pnl"] = round(total_pnl, 2)
            s["unrealized_pnl"] = round(total_pnl, 2)
            s["last_checked"] = datetime.now().strftime("%H:%M:%S")
            record_pos_trade_running_pnl(s, total_pnl)

            # -------------------------------------------------------------
            # Check Combined Total Premium Target Profit (CE + PE)
            # -------------------------------------------------------------
            init_total_prem = float(s.get("initial_total_premium") or (s.get("ce_premium", 80) + s.get("pe_premium", 80)))
            if init_total_prem > 0 and current_total_premium > 0:
                if entry_action == "SELL":
                    target_premium_threshold = init_total_prem * (1.0 - (tp_percent / 100.0))
                    if current_total_premium <= target_premium_threshold:
                        log_pos(f"[{sname}] 🎯 Target Profit reached! Total Premium decayed from ₹{init_total_prem:.2f} to ₹{current_total_premium:.2f} (Target Threshold: ₹{target_premium_threshold:.2f}). Starting Exit Cycle...")
                        squareoff_positional_strangle_for(s)
                else:
                    target_premium_threshold = init_total_prem * (1.0 + (tp_percent / 100.0))
                    if current_total_premium >= target_premium_threshold:
                        log_pos(f"[{sname}] 🎯 Target Profit reached! Total Premium expanded to ₹{current_total_premium:.2f} (Target: ₹{target_premium_threshold:.2f}). Starting Exit Cycle...")
                        squareoff_positional_strangle_for(s)

        save_pos_strategies(pos_strategies_store)
    except Exception as e:
        logger.error(f"Error in positional monitoring loop: {e}")

def positional_strangle_background_loop():
    """Dedicated background thread loop running continuously every 3 seconds."""
    log_pos("Positional Strangle background thread online.")
    while True:
        try:
            monitor_positional_strategies_cycle()
        except Exception as e:
            logger.error(f"Error in pos_strangle thread: {e}")
        time.sleep(3)

# Auto-start daemon thread on module import
_worker_thread = threading.Thread(target=positional_strangle_background_loop, daemon=True)
_worker_thread.start()

if __name__ == "__main__":
    print("\n--- Positional Strangle Multi-Strategy Engine ---")
    pos_strategies_store = load_pos_strategies()
    print(f"Loaded {len(pos_strategies_store)} Positional Strategies:")
    for s in pos_strategies_store:
        print(f"  - [{s.get('index_name')}] {s.get('name')} (Status: {s.get('status')})")
    print("\nMonitoring active in background thread. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nExiting pos_strngl.py...")
