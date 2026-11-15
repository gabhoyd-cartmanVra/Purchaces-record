@echo off
title NXTsavings - Nextglobal Weekly Budget
cd /d "%~dp0"
echo ========================================================
echo   Iniciando NXTsavings (Nexxtglobal Weekly Budget)
echo ========================================================
python -m pip install -r requirements.txt --quiet
start "" "http://localhost:8000"
python NXTsavings.py
pause
