"""
greeks.py — Black-Scholes Option Pricing & Greeks Calculator for Zerodha Kite Trading

Features:
- Implied Volatility (IV) calculation via Newton-Raphson & Bisection numerical solver
- Option Greeks calculation:
    * Delta (Sensitivity to Spot price movement)
    * Gamma (Rate of change of Delta)
    * Theta (1-day time decay in ₹)
    * Vega (Sensitivity per 1% change in IV in ₹)
    * Rho (Sensitivity to interest rates)
- Supports both Call (CE) and Put (PE) options
- Zero external package failures: works seamlessly with scipy/numpy or standalone math
"""

import math
import logging
from datetime import datetime, date

logger = logging.getLogger("greeks")

# Default Indian risk-free interest rate (7.0% per annum / RBI 91-day T-Bill)
DEFAULT_RISK_FREE_RATE = 0.07

def _norm_cdf(x):
    """Cumulative distribution function for standard normal distribution."""
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

def _norm_pdf(x):
    """Probability density function for standard normal distribution."""
    return (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * x * x)


def black_scholes_price(S, K, T, r, sigma, opt_type="CE"):
    """
    Calculates Black-Scholes theoretical option price.
    
    Parameters:
    - S: Spot / Underlying Price (e.g. 24500.0)
    - K: Strike Price (e.g. 24500.0)
    - T: Time to Expiry in Years (e.g. 5/365 = 0.0137)
    - r: Risk-free rate (e.g. 0.07)
    - sigma: Volatility / IV (e.g. 0.15 for 15% IV)
    - opt_type: 'CE' or 'PE'
    """
    if S <= 0 or K <= 0 or T <= 0 or sigma <= 0:
        return max(0.0, (S - K) if opt_type.upper() == "CE" else (K - S))

    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)

        if opt_type.upper() == "CE":
            price = S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
        else:
            price = K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)
        return max(0.0, price)
    except Exception:
        return 0.0


def calculate_implied_volatility(market_price, S, K, T, r=DEFAULT_RISK_FREE_RATE, opt_type="CE"):
    """
    Calculates Implied Volatility (IV) given market LTP using Newton-Raphson with bisection fallback.
    Returns IV as a float between 0.01 and 5.0 (e.g. 0.15 = 15% IV).
    """
    if market_price <= 0 or S <= 0 or K <= 0 or T <= 0:
        return 0.15  # Fallback reasonable default (15% IV)

    # Intrinsic value check
    intrinsic = max(0.0, (S - K) if opt_type.upper() == "CE" else (K - S))
    if market_price < intrinsic:
        market_price = intrinsic + 0.05

    # 1. Newton-Raphson Iteration
    sigma = 0.20  # Initial guess 20%
    for _ in range(50):
        price = black_scholes_price(S, K, T, r, sigma, opt_type)
        diff = price - market_price
        if abs(diff) < 1e-4:
            return max(0.01, min(sigma, 5.0))

        try:
            d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
            vega = S * math.sqrt(T) * _norm_pdf(d1)
            if abs(vega) < 1e-6:
                break
            sigma -= diff / vega
            if sigma <= 0.001 or sigma > 5.0:
                break
        except Exception:
            break

    # 2. Bisection Fallback
    low_sigma = 0.001
    high_sigma = 5.0
    for _ in range(60):
        mid_sigma = (low_sigma + high_sigma) / 2.0
        price = black_scholes_price(S, K, T, r, mid_sigma, opt_type)
        diff = price - market_price
        if abs(diff) < 1e-4:
            return round(mid_sigma, 4)
        if diff > 0:
            high_sigma = mid_sigma
        else:
            low_sigma = mid_sigma

    return round(mid_sigma, 4)


def calculate_greeks(S, K, expiry_date, ltp=None, iv=None, r=DEFAULT_RISK_FREE_RATE, opt_type="CE"):
    """
    Computes all standard Black-Scholes Greeks:
    - Delta: Price sensitivity
    - Gamma: Delta sensitivity
    - Theta: Daily time decay in ₹ per share
    - Vega: P&L sensitivity per 1% change in IV in ₹ per share
    - Rho: Sensitivity per 1% change in interest rate
    - IV: Implied Volatility in % (e.g. 14.5%)
    """
    # 1. Calculate time to expiry T in years
    now = datetime.now()
    if isinstance(expiry_date, str):
        try:
            exp_dt = datetime.strptime(expiry_date.strip(), "%Y-%m-%d")
        except Exception:
            exp_dt = now
    elif isinstance(expiry_date, (datetime, date)):
        exp_dt = datetime.combine(expiry_date, datetime.min.time()) if isinstance(expiry_date, date) and not isinstance(expiry_date, datetime) else expiry_date
    else:
        exp_dt = now

    # Set expiry time at 15:30:00 on expiry day
    exp_dt = exp_dt.replace(hour=15, minute=30, second=0)
    seconds_remaining = max(300, (exp_dt - now).total_seconds())
    T = seconds_remaining / (365.0 * 86400.0)

    # 2. Derive IV if not passed directly
    if iv is None or iv <= 0:
        if ltp and ltp > 0:
            sigma = calculate_implied_volatility(ltp, S, K, T, r, opt_type)
        else:
            sigma = 0.15
    else:
        sigma = float(iv) if float(iv) < 1.0 else float(iv) / 100.0

    sigma = max(0.001, min(sigma, 5.0))

    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)

        pdf_d1 = _norm_pdf(d1)
        cdf_d1 = _norm_cdf(d1)
        cdf_d2 = _norm_cdf(d2)

        opt_upper = opt_type.upper()
        if opt_upper == "CE":
            delta = cdf_d1
            theta = (-(S * pdf_d1 * sigma) / (2.0 * math.sqrt(T)) - r * K * math.exp(-r * T) * cdf_d2) / 365.0
            rho = (K * T * math.exp(-r * T) * cdf_d2) / 100.0
        else:
            delta = cdf_d1 - 1.0
            theta = (-(S * pdf_d1 * sigma) / (2.0 * math.sqrt(T)) + r * K * math.exp(-r * T) * (1.0 - cdf_d2)) / 365.0
            rho = (-K * T * math.exp(-r * T) * (1.0 - cdf_d2)) / 100.0

        gamma = pdf_d1 / (S * sigma * math.sqrt(T))
        vega = (S * math.sqrt(T) * pdf_d1) / 100.0  # ₹ change per 1% IV change

        return {
            "spot": round(S, 2),
            "strike": round(K, 2),
            "opt_type": opt_upper,
            "iv": round(sigma * 100.0, 2),        # as percentage e.g. 14.50%
            "iv_raw": round(sigma, 4),
            "delta": round(delta, 4),
            "gamma": round(gamma, 6),
            "theta": round(theta, 2),              # Daily decay in ₹ per quantity
            "vega": round(vega, 2),                # ₹ change per 1% IV
            "rho": round(rho, 4),
            "days_to_expiry": round(T * 365.0, 2)
        }
    except Exception as e:
        logger.error(f"Error calculating Greeks: {e}")
        return {
            "spot": S,
            "strike": K,
            "opt_type": opt_type.upper(),
            "iv": round(sigma * 100.0, 2),
            "iv_raw": round(sigma, 4),
            "delta": 0.50 if opt_type.upper() == "CE" else -0.50,
            "gamma": 0.0001,
            "theta": 0.0,
            "vega": 0.0,
            "rho": 0.0,
            "days_to_expiry": round(T * 365.0, 2)
        }
