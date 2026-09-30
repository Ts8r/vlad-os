#!/usr/bin/env bash
# VLAD OS — lanceur "extension" : démarre le pont vocal + le HUD (détachés),
# puis ouvre le navigateur. Idempotent : ne relance pas ce qui tourne déjà.
# Usage : bash vlad.sh   (ou via la commande Claude Code /vlad)
set -e
cd "$(dirname "$0")"
# Lancé depuis le Finder, le PATH ne contient pas npm/node : on le fixe ici.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

BRIDGE_PORT=8788
HUD_PORT=5173
LOG_DIR="/tmp"

is_up() { lsof -ti tcp:"$1" >/dev/null 2>&1; }

# Arrêt propre : bash vlad.sh stop
if [ "$1" = "stop" ]; then
  echo "→ Arrêt de VLAD…"
  # décharger l'agent launchd d'abord, sinon KeepAlive relance le pont aussitôt
  launchctl bootout "gui/$(id -u)/com.vlad-os.bridge" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/com.vlad-os.hud" 2>/dev/null || true
  lsof -ti tcp:"$BRIDGE_PORT" | xargs kill 2>/dev/null || true
  lsof -ti tcp:"$HUD_PORT" | xargs kill 2>/dev/null || true
  echo "✓ VLAD arrêté.  (redémarrage : bash vlad.sh — recharge aussi l'agent launchd)"
  exit 0
fi

# 1) Pont vocal — port 8788, GÉRÉ PAR LAUNCHD (KeepAlive : ressuscite seul s'il meurt)
AGENT="$HOME/Library/LaunchAgents/com.vlad-os.bridge.plist"
if is_up "$BRIDGE_PORT"; then
  echo "✓ Pont vocal déjà actif (:$BRIDGE_PORT)"
elif [ -f "$AGENT" ]; then
  echo "→ Démarrage du pont vocal via launchd (:$BRIDGE_PORT)…"
  launchctl bootstrap "gui/$(id -u)" "$AGENT" 2>/dev/null \
    || launchctl kickstart "gui/$(id -u)/com.vlad-os.bridge" 2>/dev/null || true
else
  echo "→ Démarrage du pont vocal (:$BRIDGE_PORT)…"
  VLAD_PYTHON="${VLAD_PYTHON:-$PWD/.venv/bin/python}" \
    nohup node voice/vlad-server.js > "$LOG_DIR/vlad-bridge.log" 2>&1 &
fi

# 2) HUD (Vite) — port 5173, GÉRÉ PAR LAUNCHD lui aussi (14/09 : mode serveur)
HUD_AGENT="$HOME/Library/LaunchAgents/com.vlad-os.hud.plist"
if is_up "$HUD_PORT"; then
  echo "✓ HUD déjà actif (:$HUD_PORT)"
elif [ -f "$HUD_AGENT" ]; then
  echo "→ Démarrage du HUD via launchd (:$HUD_PORT)…"
  launchctl bootstrap "gui/$(id -u)" "$HUD_AGENT" 2>/dev/null \
    || launchctl kickstart "gui/$(id -u)/com.vlad-os.hud" 2>/dev/null || true
else
  echo "→ Démarrage du HUD (:$HUD_PORT)…"
  nohup npm run ui > "$LOG_DIR/vlad-hud.log" 2>&1 &
fi

# 3) Laisser Vite démarrer puis ouvrir le navigateur
for i in $(seq 1 20); do is_up "$HUD_PORT" && break; sleep 0.4; done
URL="http://localhost:$HUD_PORT"
echo "→ Ouverture de $URL"
[ -n "$VLAD_NO_OPEN" ] || open "$URL" 2>/dev/null || true

echo ""
echo "🤖 VLAD est prêt.  HUD : $URL   ·   Pont : http://localhost:$BRIDGE_PORT"
echo "   Logs : $LOG_DIR/vlad-hud.log  ·  $LOG_DIR/vlad-bridge.log"
echo "   Stop : bash vlad.sh stop"
