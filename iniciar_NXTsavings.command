#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "========================================================"
echo "  Iniciando NXTsavings (Nextglobal Weekly Budget)"
echo "========================================================"
python3 -m pip install -r requirements.txt --quiet 2>/dev/null || true
(sleep 1.5 && (xdg-open "http://localhost:8000" 2>/dev/null || open "http://localhost:8000" 2>/dev/null || true)) &
python3 NXTsavings.py
