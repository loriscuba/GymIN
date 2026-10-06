@echo off
rem ======================================================================
rem  GymIN - Impostazioni consigliate per il PC dell'ingresso.
rem  Da eseguire UNA volta con "Esegui come amministratore".
rem  - niente sospensione, ibernazione, spegnimento schermo (con corrente)
rem  - niente sospensione selettiva USB (il lettore RFID resta sempre attivo)
rem  - orologio sincronizzato automaticamente (servizio Ora di Windows)
rem  Le altre impostazioni (accesso automatico, volume, aggiornamenti)
rem  sono descritte in LEGGIMI.txt.
rem ======================================================================
net session >nul 2>&1
if errorlevel 1 (
  echo Questo script va eseguito come AMMINISTRATORE:
  echo clic destro su configura-windows.bat ^> "Esegui come amministratore".
  pause
  exit /b 1
)

echo [1/3] Risparmio energia: niente sospensione ne' spegnimento schermo...
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off
rem sospensione selettiva USB disattivata (piano attuale, con corrente)
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setactive SCHEME_CURRENT

echo [2/3] Orologio: sincronizzazione automatica...
sc config w32time start= auto >nul
net start w32time >nul 2>&1
w32tm /config /manualpeerlist:"time.windows.com,0x9 ntp1.inrim.it,0x9" /syncfromflags:manual /update >nul
w32tm /resync /force
tzutil /s "W. Europe Standard Time"

echo [3/3] Screen saver disattivato per l'utente corrente...
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f >nul

echo.
echo Fatto. Controlla anche le impostazioni manuali descritte in LEGGIMI.txt.
pause
