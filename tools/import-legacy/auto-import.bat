@echo off
rem GymIN - import automatico abbonamenti (da pianificare ogni mattina dopo la copia delle 9).
rem La cartella si imposta in GYMIN_IMPORT_DIR nel file .env accanto a questo script.
cd /d "%~dp0"
node auto-import.mjs >> auto-import.log 2>&1
