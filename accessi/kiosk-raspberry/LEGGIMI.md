# GymIN · Postazione tornello su Raspberry Pi (prototipo)

Gemello Linux di [`../kiosk/`](../kiosk/) (Windows): stessa pagina `/accessi/ingresso/`, stesse regole, stesso funzionamento offline. Cambia solo il computer: al posto del PC Windows c'è un **Raspberry Pi** con Chromium in modalità kiosk.

## Hardware del prototipo

| Pezzo | Modello provato | Note |
|---|---|---|
| Computer | Raspberry Pi 3 Model B (1 GB) | Sufficiente per la sola pagina ingresso. Se si compra nuovo, meglio un **Pi 4 da 2 GB**: Chromium è più fluido |
| Schermo | Yodoit 15,6" IPS 1920×1080, HDMI, con altoparlanti | La pagina si adatta da sola. **Non è touch**: non serve, il socio passa solo la tessera. Va alimentato con il **suo** alimentatore USB-C: le USB del Pi non bastano |
| Lettore | RFID USB 125 kHz EM4100/TK4100 (emulazione tastiera) | Basta collegarlo al Pi. Le tessere devono essere **125 kHz EM4100**: le MIFARE 13,56 MHz non vengono lette |
| Suono | Altoparlanti del monitor (audio HDMI) | Verde e rosso hanno suoni diversi |
| Apertura tornello | Relè Shelly (facoltativo) | Vedi "Apertura porta" nel README di `accessi/` |
| Altro | microSD da 16 GB o più, alimentatore ufficiale del Pi (5 V 2,5 A micro-USB per il Pi 3, USB-C 3 A per il Pi 4), cavo HDMI, rete via **cavo** se possibile | |

Collegamenti: Pi → HDMI → monitor · lettore RFID → una USB del Pi · rete → porta Ethernet del Pi.

## Installazione

1. **Sistema**: con Raspberry Pi Imager scrivi sulla microSD **Raspberry Pi OS (con desktop)**. Nelle impostazioni dell'Imager crea un utente dedicato (per esempio `ingresso`), imposta il Wi-Fi se non usi il cavo, abilita SSH e scegli il fuso **Europe/Rome**.
2. **Prova il lettore**: apri un editor di testo sul Pi e passa una tessera. Deve comparire un codice (es. `0012345678`) e la riga deve andare a capo da sola.
3. **Copia questa cartella** sul Pi (chiavetta USB, `scp`, oppure `git clone` del repo) ed esegui, **come utente `ingresso`, senza sudo**:
   ```bash
   bash installa.sh
   ```
   Lo script:
   - installa Chromium se manca;
   - copia gli script in `~/GymIN-Ingresso`;
   - mette **GymIN Ingresso** in avvio automatico, più due icone sul Desktop ("GymIN Ingresso" e "Ferma GymIN Ingresso");
   - attiva l'accesso automatico al desktop e tiene lo schermo sempre acceso;
   - imposta il fuso orario di Roma con l'ora sincronizzata;
   - pre-autorizza la pagina a comandare il relè Shelly in LAN (criterio Chromium `LocalNetworkAccessAllowedForUrls`).
4. `sudo reboot`. Dopo circa 10 secondi dal desktop si apre l'ingresso a schermo intero.
5. **Prima apertura (con internet)**: compare "Configura il terminale". Incolla il token creato in **Gestione accessi → Terminali** e attendi "Online" in basso a destra.
6. Passa una tessera: schermo verde o rosso, con il suono.
7. Esegui la **prova offline** descritta in [`../kiosk/LEGGIMI.txt`](../kiosk/LEGGIMI.txt) (punto 7): è identica.

Indirizzo diverso da quello di produzione (es. sito di test): modifica la riga `URL_INGRESSO` all'inizio di `~/GymIN-Ingresso/avvia-ingresso.sh`.

## File

| File | Cosa fa |
|---|---|
| `avvia-ingresso.sh` | Apre Chromium in **kiosk** su `/ingresso` con un **profilo dedicato** (`~/.local/share/GymIN-Ingresso/chromium-profilo`), così cache e coda offline sopravvivono al riavvio. Audio senza click. Se Chromium si chiude o va in crash lo riapre dopo 5 s e non apre mai due kiosk |
| `ferma-ingresso.sh` | Chiude il kiosk senza che si riapra |
| `installa.sh` | Installazione descritta sopra · `bash installa.sh --rimuovi` toglie l'avvio automatico |

## Uso quotidiano

- Il Pi si accende e apre l'ingresso da solo. Funziona anche senza internet: compare la banda "OFFLINE – n accessi da sincronizzare".
- **Uscire dal kiosk**: collega una tastiera, premi Alt+F4 e subito dopo apri "Ferma GymIN Ingresso" sul Desktop (hai 5 secondi). In alternativa, da un altro PC: `ssh ingresso@<ip-del-pi> GymIN-Ingresso/ferma-ingresso.sh`.
- **Spegnere**: `sudo poweroff`, oppure stacca la corrente a palestra chiusa. Meglio non staccarla mentre il Pi scrive sulla microSD.

## Problemi frequenti

- **Nessun suono**: clic destro sull'icona del volume nella barra del desktop → uscita **HDMI**; controlla il volume del monitor.
- **Bordo nero o immagine tagliata**: `sudo raspi-config` → Display Options → Underscan.
- **Pagina lenta sul Pi 3**: chiudi tutto il resto, preferisci il cavo al Wi-Fi. Se resta lento, passa a un Pi 4.
- **Schermo che si spegne**: `sudo raspi-config nonint do_blanking 1` e riavvia.
- Tutti gli altri messaggi del terminale ("Terminale non autorizzato", "Dati non aggiornati da X ore", "Tessera sconosciuta"…) hanno lo stesso significato che su Windows: vedi [`../kiosk/LEGGIMI.txt`](../kiosk/LEGGIMI.txt).
