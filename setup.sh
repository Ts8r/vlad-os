#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════
#  VLAD OS — installation  (bash setup.sh  ou  npm run setup)
#  macOS · Node ≥ 18 · Python 3.10+ · Claude Code (CLI `claude`)
# ════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"
BLUE="\033[36m"; GREEN="\033[32m"; AMBER="\033[33m"; DIM="\033[2m"; OFF="\033[0m"
say()  { printf "${BLUE}▸${OFF} %s\n" "$1"; }
ok()   { printf "${GREEN}✓${OFF} %s\n" "$1"; }
warn() { printf "${AMBER}!${OFF} %s\n" "$1"; }

printf "\n   V.L.A.D  O.S  ·  installation\n\n"

# 1. Config
if [ ! -f .env ]; then cp .env.example .env; ok ".env créé — ouvre-le et renseigne au moins VLAD_USER"; else ok ".env déjà présent (conservé)"; fi

# 2. Node
say "Dépendances Node…"
npm install --silent && ok "Node prêt"

# 3. Python (voix 100 % locale) : environnement isolé .venv
PY=$(command -v python3.12 || command -v python3.11 || command -v python3 || true)
if [ -z "$PY" ]; then warn "Python 3 introuvable — la voix locale sera désactivée (brew install python@3.12)";
else
  [ -d .venv ] || "$PY" -m venv .venv
  say "Dépendances voix (Whisper, Kokoro, edge-tts) — quelques minutes la première fois…"
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet faster-whisper kokoro soundfile sounddevice numpy edge-tts \
    && ok "Voix prête (.venv)" || warn "Installation voix incomplète — VLAD fonctionne quand même en texte"
fi

# 4. Le cerveau : Claude Code
if command -v claude >/dev/null 2>&1; then ok "Claude Code détecté ($(claude --version 2>/dev/null | head -1))";
else warn "Claude Code absent : npm install -g @anthropic-ai/claude-code puis « claude auth login »"; fi

echo ""
ok "Installation terminée. Lance VLAD avec :  bash vlad.sh"
printf "${DIM}  HUD : http://localhost:5173 · pont : http://localhost:8788 · arrêt : bash vlad.sh stop${OFF}\n\n"
