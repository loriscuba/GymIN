@echo off
rem ======================================================================
rem  GymIN - Terminale ingresso: avvia Chrome in modalita' kiosk
rem  - profilo Chrome DEDICATO (non cancella i dati alla chiusura:
rem    service worker, cache e coda offline restano sul PC)
rem  - audio senza click (--autoplay-policy=no-user-gesture-required)
rem  - se Chrome si chiude o va in crash viene riaperto dopo 5 secondi
rem  Per fermarlo: ferma-ingresso.bat
rem ======================================================================

rem ---- CONFIGURAZIONE --------------------------------------------------
rem Indirizzo della pagina /ingresso (produzione)
set "URL_INGRESSO=https://loriscuba.github.io/GymIN/accessi/ingresso/"
rem Cartella del profilo Chrome dedicato al terminale
set "BASE=%LOCALAPPDATA%\GymIN-Ingresso"
set "PROFILO=%BASE%\chrome-profilo"
rem ---------------------------------------------------------------------

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined CHROME (
  echo Google Chrome non trovato. Installalo da https://www.google.com/chrome/
  pause
  exit /b 1
)

if not exist "%PROFILO%" mkdir "%PROFILO%"
set "STOP=%BASE%\STOP"
if exist "%STOP%" del "%STOP%"

rem gia' in esecuzione (doppio avvio)? non aprire un secondo kiosk
call :inEsecuzione
if not errorlevel 1 (
  echo Il terminale e' gia' avviato.
  timeout /t 3 >nul
  exit /b 0
)

rem attesa breve all'accensione: lascia partire rete e driver audio
timeout /t 10 /nobreak >nul

:avvio
if exist "%STOP%" goto fine
"%CHROME%" ^
  --user-data-dir="%PROFILO%" ^
  --kiosk "%URL_INGRESSO%" ^
  --autoplay-policy=no-user-gesture-required ^
  --no-first-run ^
  --no-default-browser-check ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --hide-crash-restore-bubble ^
  --disable-features=Translate,TranslateUI ^
  --overscroll-history-navigation=0 ^
  --disable-pinch

:sorveglia
rem Chrome a volte "passa la mano" a un processo gia' aperto e ritorna subito:
rem finche' il Chrome del kiosk e' vivo non lo si riapre
timeout /t 5 /nobreak >nul
if exist "%STOP%" goto fine
call :inEsecuzione
if not errorlevel 1 goto sorveglia
goto avvio

:fine
del "%STOP%" >nul 2>&1
exit /b 0

rem errorlevel 0 se il Chrome del kiosk (profilo GymIN-Ingresso) e' in esecuzione
:inEsecuzione
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*GymIN-Ingresso*' }) { exit 0 } else { exit 1 }"
exit /b %errorlevel%
