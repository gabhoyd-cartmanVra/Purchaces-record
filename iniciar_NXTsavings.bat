@echo off
title NXTsavings - Nextglobal Petty Cash
cd /d "%~dp0"
echo ========================================================
echo   Iniciando NXTsavings (Nextglobal Weekly Budget)
echo ========================================================
python -m pip install -r requirements.txt --quiet
start "" "http://localhost:8000"
python NXTsavings.py
pause
