@echo off
rem ======================================================================
rem  GymIN - Ferma il terminale ingresso (chiude il Chrome del kiosk e
rem  impedisce che venga riaperto). Per ripartire: avvia-ingresso.bat
rem  oppure riavvia il PC.
rem ======================================================================
if not exist "%LOCALAPPDATA%\GymIN-Ingresso" mkdir "%LOCALAPPDATA%\GymIN-Ingresso"
echo stop> "%LOCALAPPDATA%\GymIN-Ingresso\STOP"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*GymIN-Ingresso*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Terminale fermato.
timeout /t 3 >nul
