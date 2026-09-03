"""
main.py — Unified Master Launcher for Kite Connect Trading Systems

Launches both:
1. server.py (Flask Web Application, Intraday Strategies, Order & MTM Engine)
2. pos_strngl.py (Positional Strangle Multi-Day Strategy Engine)
"""

import sys
import os
import time
import subprocess
import signal
import threading

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def start_server():
    """Runs the main Flask web and trading server."""
    print("🚀 [Main] Starting server.py on http://127.0.0.1:5050...")
    try:
        import server
        # Server starts Flask app and intraday background threads
        server.app.run(host="0.0.0.0", port=5050, debug=False, use_reloader=False)
    except Exception as e:
        print(f"❌ [Main] Error running server.py: {e}")

def start_pos_strangle():
    """Starts the positional strangle strategy engine."""
    print("🧭 [Main] Initializing pos_strngl.py engine...")
    try:
        import pos_strngl
        # pos_strngl starts its internal background daemon thread upon import
        print("✅ [Main] pos_strngl.py engine initialized and monitoring.")
    except Exception as e:
        print(f"❌ [Main] Error initializing pos_strngl.py: {e}")

def start_straddle_total_sl():
    """Starts the Positional Straddle Total SL strategy engine."""
    print("🎯 [Main] Initializing straddle_total_sl.py engine...")
    try:
        import straddle_total_sl
        # straddle_total_sl starts its internal background daemon thread upon import
        print("✅ [Main] straddle_total_sl.py engine initialized and monitoring.")
    except Exception as e:
        print(f"❌ [Main] Error initializing straddle_total_sl.py: {e}")

def start_commodity():
    """Starts the MCX Commodity Options & Futures strategy engine."""
    print("🛢️ [Main] Initializing commodity.py engine...")
    try:
        import commodity
        # commodity starts its internal background daemon thread upon import
        print("✅ [Main] commodity.py engine initialized and monitoring.")
    except Exception as e:
        print(f"❌ [Main] Error initializing commodity.py: {e}")

def main():
    print("=" * 65)
    print("  KITE CONNECT TRADING SYSTEM — UNIFIED MASTER LAUNCHER")
    print("  Components: server.py + pos_strngl.py + straddle_total_sl.py + commodity.py")
    print("=" * 65)

    # 1. Initialize positional strangle engine
    start_pos_strangle()

    # 2. Initialize positional straddle total SL engine
    start_straddle_total_sl()

    # 3. Initialize commodity options & futures engine
    start_commodity()

    # 4. Run Flask Web Server in main thread
    start_server()

if __name__ == "__main__":
    main()
