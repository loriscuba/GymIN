@echo off
rem ======================================================================
rem  GymIN - Mette il terminale ingresso nell'Esecuzione automatica di
rem  Windows dell'utente corrente: a ogni accesso parte da solo.
rem  Crea il collegamento "GymIN Ingresso" (finestra ridotta a icona)
rem  nella cartella  shell:startup  e uno uguale sul Desktop, piu'
rem  "Ferma GymIN Ingresso" sul Desktop.
rem ======================================================================
set "BAT=%~dp0avvia-ingresso.bat"
if not exist "%BAT%" (
  echo Non trovo avvia-ingresso.bat nella stessa cartella di questo file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('Desktop'))) {" ^
  "  $l = $w.CreateShortcut((Join-Path $dir 'GymIN Ingresso.lnk'));" ^
  "  $l.TargetPath = '%BAT%';" ^
  "  $l.WorkingDirectory = '%~dp0';" ^
  "  $l.WindowStyle = 7;" ^
  "  $l.Description = 'GymIN - terminale controllo accessi';" ^
  "  $l.Save() };" ^
  "$f = $w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ferma GymIN Ingresso.lnk'));" ^
  "$f.TargetPath = '%~dp0ferma-ingresso.bat';" ^
  "$f.WorkingDirectory = '%~dp0';" ^
  "$f.Description = 'GymIN - ferma il terminale controllo accessi';" ^
  "$f.Save()"
if errorlevel 1 (
  echo Errore nella creazione del collegamento.
  pause
  exit /b 1
)
echo.
echo Fatto: "GymIN Ingresso" e' nell'Esecuzione automatica e sul Desktop,
echo insieme a "Ferma GymIN Ingresso" per chiudere il kiosk.
echo Al prossimo accesso a Windows il terminale partira' da solo.
echo Per avviarlo subito: doppio clic su "GymIN Ingresso" sul Desktop.
pause
