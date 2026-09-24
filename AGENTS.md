# AGENTS.md

## Repository workflow

- Always start from the latest `main` before making changes.
- Run:
  ```bash
  git fetch origin --prune
  git switch main
  git pull --ff-only
  ```
- Create a feature branch before editing code:
  ```bash
  git switch -c fix/<short-description>
  ```
- Do not commit directly to `main`.
- Push the branch and open a Pull Request against `main`.
- If `main` moved forward, rebase or merge it before continuing.

This project follows a pull-request-only workflow for changes. Local work must be isolated on a branch and merged via PR unless the user explicitly requests otherwise.
