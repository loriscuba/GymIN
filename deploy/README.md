# Deploy su Oracle Cloud (VM Always Free)

Script per pubblicare il frontend GymIN su una VM Ubuntu.
Guida completa passo-passo: vedi l'artifact **GymIN Deploy**.

## Prerequisiti
- Una VM Ubuntu 22.04 (Oracle Cloud Always Free, Ampere ARM)
- Porte **80/443** aperte nella **Security List** della VCN (dalla console OCI)
- Accesso SSH alla VM

## Primo deploy

```bash
# sulla VM
git clone https://github.com/loriscuba/GymIN.git ~/gymin
cd ~/gymin
bash deploy/setup.sh
```

Lo script: aggiorna il sistema, installa Nginx, apre 80/443 nel firewall del SO,
copia `web/` in `/var/www/gymin` e configura Nginx. Al termine GymIN è su `http://IP_PUBBLICO`.

Opzioni:

```bash
SERVER_NAME=gymin.miodominio.it bash deploy/setup.sh   # imposta il dominio
INSTALL_NODE=1 bash deploy/setup.sh                    # installa anche Node.js (per il mailer)
```

## HTTPS (serve un dominio)

```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d gymin.miodominio.it
```

## Aggiornare dopo un push

```bash
cd ~/gymin
bash deploy/update.sh
```

## Modulo mail (opzionale)

Vedi la sezione "Backend" della guida: Mailpit via `docker compose`, worker con PM2,
relay SMTP su porta **587** (la 25 è bloccata da Oracle).
