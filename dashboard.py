"""
dashboard.py — Open Interest (OI) & Market Analytics Engine for Kite Connect

Features:
- Real-time Max CE OI Strike (Resistance) & Max PE OI Strike (Support) calculation
- Live Put-Call Ratio (PCR) with Market Sentiment classification
- OI Shift Detection: tracks strike movements, direction (UP/DOWN), point distance, and timestamp
- Strike-by-strike Open Interest distribution table & comparison for top active strikes
- Multi-Index Support: NIFTY, BANKNIFTY, SENSEX, FINNIFTY, MIDCPNIFTY
- Weekly and Monthly expiry resolution
"""

import os
import sys
import json
import logging
import time
from datetime import datetime, date

logger = logging.getLogger("dashboard_oi")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("%(asctime)s - [DashboardOI] %(levelname)s - %(message)s"))
    logger.addHandler(ch)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "pykiteconnect"))
from kiteconnect import KiteConnect

OI_HISTORY_FILE = os.path.join(BASE_DIR, "oi_shift_history.json")

# Spot symbol mapping for underlying indices
INDEX_SPOT_MAP = {
    "NIFTY": "NSE:NIFTY 50",
    "BANKNIFTY": "NSE:NIFTY BANK",
    "FINNIFTY": "NSE:NIFTY FIN SERVICE",
    "MIDCPNIFTY": "NSE:NIFTY MID SELECT",
    "SENSEX": "BSE:SENSEX",
    "BANKEX": "BSE:BANKEX"
}

# In-memory tracking of previous Max OI per instrument & expiry
# Structure: { "NIFTY_2026-09-03": { "max_ce_strike": 24500, "max_pe_strike": 24000, "last_updated": "...", "shifts": [] } }
oi_shift_tracker = {}
kite_client_instance = None


def set_kite_client(client):
    """Set the authenticated KiteConnect client instance."""
    global kite_client_instance
    kite_client_instance = client


def load_oi_shift_history():
    """Loads historical OI shift state from local JSON file."""
    global oi_shift_tracker
    if os.path.exists(OI_HISTORY_FILE):
        try:
            with open(OI_HISTORY_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    oi_shift_tracker = saved
        except Exception as e:
            logger.warning(f"Error loading {OI_HISTORY_FILE}: {e}")
    return oi_shift_tracker


def save_oi_shift_history():
    """Saves historical OI shift state to local JSON file."""
    try:
        with open(OI_HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(oi_shift_tracker, f, indent=4)
    except Exception as e:
        logger.error(f"Error saving {OI_HISTORY_FILE}: {e}")


# Initialize shift history on import
load_oi_shift_history()


def get_spot_ltp(kite, index_name):
    """Fetches the live cash spot price for the given index."""
    spot_sym = INDEX_SPOT_MAP.get(index_name.upper(), f"NSE:{index_name}")
    try:
        quote = kite.ltp(spot_sym)
        if spot_sym in quote:
            return float(quote[spot_sym].get("last_price", 0.0)), spot_sym
    except Exception as e:
        logger.warning(f"Failed to fetch spot LTP for {spot_sym}: {e}")
    return 0.0, spot_sym


def get_option_instruments_for_index(kite, index_name):
    """
    Fetches option contracts for the specified index across NFO and BFO exchanges.
    """
    index_upper = index_name.upper()
    exchange = "BFO" if index_upper in ["SENSEX", "BANKEX"] else "NFO"
    
    try:
        all_inst = kite.instruments(exchange)
        opts = [
            i for i in all_inst
            if str(i.get("name", "")).upper() == index_upper and i.get("instrument_type") in ["CE", "PE"]
        ]
        return opts, exchange
    except Exception as e:
        logger.error(f"Error fetching {exchange} instruments for {index_upper}: {e}")
        return [], exchange


def get_available_expiries(kite, index_name):
    """Returns sorted upcoming expiry dates for the index."""
    opts, _ = get_option_instruments_for_index(kite, index_name)
    if not opts:
        return []
    
    today_str = date.today().strftime("%Y-%m-%d")
    dates_set = set()
    for o in opts:
        exp = o.get("expiry")
        if exp:
            exp_str = exp.strftime("%Y-%m-%d") if isinstance(exp, (datetime, date)) else str(exp)
            if exp_str >= today_str:
                dates_set.add(exp_str)
    return sorted(list(dates_set))


def analyze_open_interest(kite, index_name="NIFTY", target_expiry=None, strike_range_pct=0.08):
    """
    Core function: Analyzes Open Interest (OI) distribution, detects Max CE/PE OI strikes,
    calculates PCR, detects strike shifts, and formats data for dashboard display.
    """
    index_upper = index_name.upper()
    spot_price, spot_symbol = get_spot_ltp(kite, index_upper)
    
    opts, exchange = get_option_instruments_for_index(kite, index_upper)
    if not opts:
        return {
            "status": "error",
            "message": f"No option instruments found for {index_upper}"
        }

    # Available upcoming expiries
    today_str = date.today().strftime("%Y-%m-%d")
    dates_set = set()
    for o in opts:
        exp = o.get("expiry")
        if exp:
            exp_str = exp.strftime("%Y-%m-%d") if isinstance(exp, (datetime, date)) else str(exp)
            if exp_str >= today_str:
                dates_set.add(exp_str)
    available_expiries = sorted(list(dates_set))

    if not available_expiries:
        return {
            "status": "error",
            "message": f"No upcoming expiry dates found for {index_upper}"
        }

    # Resolve selected expiry
    if not target_expiry or target_expiry == "CURRENT" or target_expiry not in available_expiries:
        resolved_expiry = available_expiries[0]
    elif target_expiry == "NEXT":
        resolved_expiry = available_expiries[1] if len(available_expiries) > 1 else available_expiries[0]
    else:
        resolved_expiry = target_expiry

    # Filter options for the specific expiry
    expiry_opts = [
        o for o in opts
        if (o.get("expiry").strftime("%Y-%m-%d") if isinstance(o.get("expiry"), (datetime, date)) else str(o.get("expiry"))) == resolved_expiry
    ]

    if not expiry_opts:
        return {
            "status": "error",
            "message": f"No contracts found for {index_upper} on expiry {resolved_expiry}"
        }

    # Filter near spot if spot price available (+/- strike_range_pct)
    scan_opts = expiry_opts
    if spot_price > 0:
        min_strike = spot_price * (1.0 - strike_range_pct)
        max_strike = spot_price * (1.0 + strike_range_pct)
        narrowed = [o for o in expiry_opts if min_strike <= float(o.get("strike", 0.0)) <= max_strike]
        if len(narrowed) >= 10:
            scan_opts = narrowed

    # Query live quotes for the selected symbols (batch of up to 400)
    symbols = [f"{exchange}:{o.get('tradingsymbol')}" for o in scan_opts]
    sym_map = {f"{exchange}:{o.get('tradingsymbol')}": o for o in scan_opts}

    quotes = {}
    chunk_size = 400
    for idx in range(0, len(symbols), chunk_size):
        chunk = symbols[idx:idx + chunk_size]
        try:
            q_res = kite.quote(chunk)
            if q_res:
                quotes.update(q_res)
        except Exception as e:
            logger.warning(f"Error fetching quote batch: {e}")

    # Aggregate OI by strike
    strikes_data = {}

    total_ce_oi = 0
    total_pe_oi = 0
    max_ce_oi = 0
    max_ce_strike = None
    max_ce_info = {}

    max_pe_oi = 0
    max_pe_strike = None
    max_pe_info = {}

    for sym, q in quotes.items():
        info = sym_map.get(sym)
        if not info:
            continue

        strike = float(info.get("strike", 0.0))
        opt_type = info.get("instrument_type")
        oi = int(q.get("oi", 0) or 0)
        ltp = float(q.get("last_price", 0.0) or 0.0)
        vol = int(q.get("volume", 0) or 0)
        oi_day_high = int(q.get("oi_day_high", 0) or 0)
        oi_day_low = int(q.get("oi_day_low", 0) or 0)
        # Compute intraday OI change if available (oi - oi_day_low or day variation)
        oi_change = int(q.get("oi_change", 0) or (oi - oi_day_low if oi_day_low > 0 else 0))

        if strike not in strikes_data:
            strikes_data[strike] = {
                "strike": strike,
                "ce_oi": 0, "ce_ltp": 0.0, "ce_vol": 0, "ce_sym": "--",
                "ce_oi_change": 0, "ce_oi_day_high": 0, "ce_oi_day_low": 0,
                "pe_oi": 0, "pe_ltp": 0.0, "pe_vol": 0, "pe_sym": "--",
                "pe_oi_change": 0, "pe_oi_day_high": 0, "pe_oi_day_low": 0,
                "diff_from_spot": round(strike - spot_price, 1) if spot_price > 0 else 0
            }

        if opt_type == "CE":
            strikes_data[strike]["ce_oi"] = oi
            strikes_data[strike]["ce_ltp"] = ltp
            strikes_data[strike]["ce_vol"] = vol
            strikes_data[strike]["ce_sym"] = info.get("tradingsymbol")
            strikes_data[strike]["ce_oi_change"] = oi_change
            strikes_data[strike]["ce_oi_day_high"] = oi_day_high
            strikes_data[strike]["ce_oi_day_low"] = oi_day_low
            total_ce_oi += oi

            if oi > max_ce_oi:
                max_ce_oi = oi
                max_ce_strike = strike
                max_ce_info = {
                    "strike": strike,
                    "oi": oi,
                    "oi_change": oi_change,
                    "ltp": ltp,
                    "symbol": info.get("tradingsymbol"),
                    "volume": vol,
                    "oi_high": oi_day_high,
                    "oi_low": oi_day_low,
                    "diff_pts": round(strike - spot_price, 1) if spot_price > 0 else 0
                }
        elif opt_type == "PE":
            strikes_data[strike]["pe_oi"] = oi
            strikes_data[strike]["pe_ltp"] = ltp
            strikes_data[strike]["pe_vol"] = vol
            strikes_data[strike]["pe_sym"] = info.get("tradingsymbol")
            strikes_data[strike]["pe_oi_change"] = oi_change
            strikes_data[strike]["pe_oi_day_high"] = oi_day_high
            strikes_data[strike]["pe_oi_day_low"] = oi_day_low
            total_pe_oi += oi

            if oi > max_pe_oi:
                max_pe_oi = oi
                max_pe_strike = strike
                max_pe_info = {
                    "strike": strike,
                    "oi": oi,
                    "oi_change": oi_change,
                    "ltp": ltp,
                    "symbol": info.get("tradingsymbol"),
                    "volume": vol,
                    "oi_high": oi_day_high,
                    "oi_low": oi_day_low,
                    "diff_pts": round(strike - spot_price, 1) if spot_price > 0 else 0
                }

    # Calculate Put-Call Ratio (PCR)
    pcr = round(total_pe_oi / total_ce_oi, 2) if total_ce_oi > 0 else 0.0
    if pcr >= 1.25:
        sentiment = "Extremely Bullish (Heavy Put Writing / Strong Support)"
        sentiment_code = "BULLISH"
    elif pcr >= 1.0:
        sentiment = "Mildly Bullish (Put Writing Dominates)"
        sentiment_code = "MILD_BULLISH"
    elif pcr >= 0.8:
        sentiment = "Neutral / Range-Bound Market"
        sentiment_code = "NEUTRAL"
    elif pcr >= 0.6:
        sentiment = "Mildly Bearish (Call Writing Dominates)"
        sentiment_code = "MILD_BEARISH"
    else:
        sentiment = "Extremely Bearish (Heavy Call Writing / Strong Resistance)"
        sentiment_code = "BEARISH"

    # Sorted strike table
    all_strikes_sorted = sorted(strikes_data.values(), key=lambda x: x["strike"])

    # Extract Top 5 CE OI strikes & Top 5 PE OI strikes for total OI breakdown
    top_ce_strikes = sorted(all_strikes_sorted, key=lambda x: x["ce_oi"], reverse=True)[:5]
    top_pe_strikes = sorted(all_strikes_sorted, key=lambda x: x["pe_oi"], reverse=True)[:5]

    # Extract Top 5 strikes with Max Change in OI (Absolute & Positive shifts)
    top_ce_oi_change = sorted(all_strikes_sorted, key=lambda x: abs(x.get("ce_oi_change", 0)), reverse=True)[:5]
    top_pe_oi_change = sorted(all_strikes_sorted, key=lambda x: abs(x.get("pe_oi_change", 0)), reverse=True)[:5]
    top_overall_oi_change = sorted(
        all_strikes_sorted, 
        key=lambda x: max(abs(x.get("ce_oi_change", 0)), abs(x.get("pe_oi_change", 0))), 
        reverse=True
    )[:5]

    # Strike Shift Detection & Tracking
    tracker_key = f"{index_upper}_{resolved_expiry}"
    now_time_str = datetime.now().strftime("%H:%M:%S")
    now_date_str = datetime.now().strftime("%Y-%m-%d")

    current_tracker = oi_shift_tracker.get(tracker_key, {
        "prev_max_ce_strike": None,
        "prev_max_pe_strike": None,
        "ce_shift": None,
        "pe_shift": None,
        "last_updated": "",
        "shifts_history": []
    })

    prev_ce = current_tracker.get("prev_max_ce_strike")
    prev_pe = current_tracker.get("prev_max_pe_strike")

    ce_shift_info = current_tracker.get("ce_shift")
    pe_shift_info = current_tracker.get("pe_shift")

    # Detect CE Shift
    if prev_ce is not None and max_ce_strike is not None and prev_ce != max_ce_strike:
        diff = max_ce_strike - prev_ce
        direction = "UP" if diff > 0 else "DOWN"
        ce_shift_info = {
            "from_strike": prev_ce,
            "to_strike": max_ce_strike,
            "diff_pts": diff,
            "direction": direction,
            "time": now_time_str,
            "date": now_date_str,
            "interpretation": f"Resistance shifted {'UP (Bullish / Expanding Higher)' if direction == 'UP' else 'DOWN (Bearish / Resistance Lowering)'}"
        }
        current_tracker["shifts_history"].insert(0, {
            "type": "CE_RESISTANCE_SHIFT",
            **ce_shift_info
        })
        logger.info(f"[{index_upper} {resolved_expiry}] 🚨 Max CE OI Shift detected: {prev_ce} -> {max_ce_strike} ({direction} {diff:+g} pts)")

    # Detect PE Shift
    if prev_pe is not None and max_pe_strike is not None and prev_pe != max_pe_strike:
        diff = max_pe_strike - prev_pe
        direction = "UP" if diff > 0 else "DOWN"
        pe_shift_info = {
            "from_strike": prev_pe,
            "to_strike": max_pe_strike,
            "diff_pts": diff,
            "direction": direction,
            "time": now_time_str,
            "date": now_date_str,
            "interpretation": f"Support shifted {'UP (Bullish / Base Moving Higher)' if direction == 'UP' else 'DOWN (Bearish / Support Weakening)'}"
        }
        current_tracker["shifts_history"].insert(0, {
            "type": "PE_SUPPORT_SHIFT",
            **pe_shift_info
        })
        logger.info(f"[{index_upper} {resolved_expiry}] 🚨 Max PE OI Shift detected: {prev_pe} -> {max_pe_strike} ({direction} {diff:+g} pts)")

    # Update tracker state
    current_tracker["prev_max_ce_strike"] = max_ce_strike
    current_tracker["prev_max_pe_strike"] = max_pe_strike
    current_tracker["ce_shift"] = ce_shift_info
    current_tracker["pe_shift"] = pe_shift_info
    current_tracker["last_updated"] = f"{now_date_str} {now_time_str}"
    oi_shift_tracker[tracker_key] = current_tracker
    save_oi_shift_history()

    return {
        "status": "ok",
        "index_name": index_upper,
        "spot_symbol": spot_symbol,
        "spot_price": spot_price,
        "expiry": resolved_expiry,
        "available_expiries": available_expiries,
        "exchange": exchange,
        "last_updated": f"{now_date_str} {now_time_str}",
        "pcr": pcr,
        "sentiment": sentiment,
        "sentiment_code": sentiment_code,
        "total_ce_oi": total_ce_oi,
        "total_pe_oi": total_pe_oi,
        "max_ce": max_ce_info,
        "max_pe": max_pe_info,
        "ce_shift": ce_shift_info,
        "pe_shift": pe_shift_info,
        "shifts_history": current_tracker.get("shifts_history", [])[:10],
        "top_ce_strikes": top_ce_strikes,
        "top_pe_strikes": top_pe_strikes,
        "top_ce_oi_change": top_ce_oi_change,
        "top_pe_oi_change": top_pe_oi_change,
        "top_overall_oi_change": top_overall_oi_change,
        "strikes_table": all_strikes_sorted
    }
