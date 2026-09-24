# Claude Code - GymIN

## Workflow obbligatorio

- Prima di iniziare qualsiasi modifica, aggiornare localmente `main`:
  ```bash
  git fetch origin --prune
  git switch main
  git pull --ff-only
  ```
- Se si deve lavorare, creare sempre un branch dedicato da `main` aggiornato:
  ```bash
  git switch -c fix/<descrizione-corta>
  ```
- Non lavorare mai direttamente su `main`.
- Fare commit sul branch, poi push e aprire un Pull Request verso `main`.
- Se il branch è vecchio o c'è un nuovo `main`, ricalibrare prima di continuare:
  ```bash
  git fetch origin --prune
  git switch main
  git pull --ff-only
  git switch -
  git rebase main
  ```
- Unire su `main` solo tramite PR, a meno che l'utente non chieda esplicitamente un'eccezione.

## Regole pratiche

- Prima di qualsiasi patch, verificare lo stato del repo con `git status`.
- La modifica deve essere minima e mirata al problema.
- Quando si usano branch e PR, includere sempre un riassunto chiaro di cosa è stato cambiato e come è stato verificato.
- Se esistono branch/PR aperti, preferire il lavoro su un branch isolato e aggiornato con `main`.

## Obiettivo

Mantenere il repo sempre sincronizzato con la versione più recente di `main` e usare PR come canale ufficiale per integrare le modifiche.
