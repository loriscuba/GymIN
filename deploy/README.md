# Deploy su Oracle Cloud — base riusabile multi-progetto

Ospita **più progetti su una sola VM** (Always Free), un **sottodominio** ciascuno
con il suo vhost Nginx. Aggiungere un progetto non tocca gli altri.

Guida completa passo-passo: artifact **GymIN Deploy**.

## Prerequisiti
- VM Ubuntu 22.04 (Oracle Cloud Always Free, Ampere ARM)
- Porte **80/443** aperte nella **Security List** della VCN (console OCI)
- Un dominio con un **record A per ogni sottodominio** → IP pubblico della VM
  (es. `gymin.miodominio.it`, `sito2.miodominio.it` → stesso IP)

## 1 · Prepara la VM (una sola volta)

```bash
git clone https://github.com/loriscuba/GymIN.git ~/gymin
cd ~/gymin
bash deploy/host-init.sh          # nginx, git, certbot, rsync, firewall 80/443
# bash deploy/host-init.sh --node # aggiungi Node.js 20 se ti servono backend
```

## 2 · Pubblica un progetto (ripeti per ognuno)

```bash
sudo bash deploy/site.sh <nome> <sottodominio> --repo <giturl> [--webdir web] [--branch main]

# esempi
sudo bash deploy/site.sh gymin gymin.miodominio.it --repo https://github.com/loriscuba/GymIN.git
sudo bash deploy/site.sh sito2 sito2.miodominio.it --repo https://github.com/loriscuba/sito2.git --webdir public
```

- `<nome>` — cartella/etichetta interna del progetto (a-z, 0-9, - _)
- `<sottodominio>` — il dominio che punterà a questo progetto
- `--webdir` — cartella statica dentro il repo (default `web`; usa `public`, `dist`, …)
- Il repo viene clonato in `/opt/sites/<nome>` e servito da `/var/www/<nome>`

## 3 · HTTPS per un sottodominio (dopo aver puntato il DNS)

```bash
sudo certbot --nginx -d gymin.miodominio.it
```

## 4 · Aggiornare un progetto dopo un push

```bash
sudo bash deploy/site-update.sh <nome>            # es: gymin
sudo bash deploy/site-update.sh sito2 --webdir public
```

## Scorciatoia solo-GymIN

Prepara la VM e pubblica GymIN in un colpo solo (usa host-init + site sotto):

```bash
bash deploy/setup.sh
SERVER_NAME=gymin.miodominio.it bash deploy/setup.sh
```

## Capacità ARM esaurita ("Out of host capacity")

La shape gratuita `VM.Standard.A1.Flex` è spesso satura. Per crearla appena si
libera capacità, usa lo script di retry **dalla OCI Cloud Shell** (CLI già autenticata):

```bash
git clone https://github.com/loriscuba/GymIN.git
bash GymIN/deploy/oci-launch-retry.sh
# opzioni:  OCPUS=1 MEMORY_GB=6 SLEEP_SECONDS=60 DISPLAY_NAME=hub bash ...
```

Trova da solo compartment/AD/subnet/immagine, riprova finché entra e ti stampa
l'IP pubblico. Prima serve aver creato la VCN con la procedura guidata.

## Note
- **Una VM basta** per molti progetti: l'ARM Always Free (fino a 4 OCPU / 24 GB)
  regge tanti siti statici / Node dietro un unico Nginx.
- Per backend con database/mail: un **container Docker per progetto** + Nginx come
  reverse proxy (vedi la sezione "Backend" della guida). Relay SMTP su porta **587**
  (la 25 è bloccata da Oracle).
