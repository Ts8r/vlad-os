#!/usr/bin/env bash
# VLAD — mode éveil À LA DEMANDE (pas de réglage permanent de veille,
# la batterie reste préservée).
# Tant que cette fenêtre est ouverte, le Mac ne dort pas → VLAD reste joignable
# depuis l'iPhone et Telegram. Ctrl+C (ou fermer la fenêtre) = retour à la normale.
set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

# services debout (idempotent : ne relance que ce qui manque)
VLAD_NO_OPEN=1 bash vlad.sh >/dev/null 2>&1 || true

BAT=$(pmset -g batt | grep -o "AC Power" || true)
echo ""
echo "☕  VLAD reste éveillé — le Mac ne dormira pas."
[ -z "$BAT" ] && echo "⚠️  Sur BATTERIE : branche-le, sinon l'autonomie va fondre."
echo "    Joignable : Telegram (si configuré) · http://localhost:5173"
echo "    Pour rendre le sommeil au Mac : Ctrl+C, ou ferme cette fenêtre."
echo ""

# -i : pas de veille système · -m : disques éveillés · -s : valable secteur
exec caffeinate -ims
