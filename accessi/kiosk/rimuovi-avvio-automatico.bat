@echo off
rem GymIN - Toglie il terminale ingresso dall'Esecuzione automatica di Windows.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\GymIN Ingresso.lnk" >nul 2>&1
echo Il terminale non partira' piu' in automatico all'accesso.
echo (Il collegamento sul Desktop resta: puoi cancellarlo a mano.)
pause
