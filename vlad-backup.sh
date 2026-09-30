#!/usr/bin/env bash
# VLAD — sauvegarde quotidienne de la MÉMOIRE.
# Destination : ~/Documents/VLAD_Backups/<date>/  (Documents = iCloud Drive →
# copie hors du Mac si Documents est synchronisé). Sans sauvegarde, un Mac
# mort = mémoire de VLAD perdue (irrécupérable, contrairement
# aux clés du .env qui se régénèrent en 15 min).
#   - données en clair : journal, carnet, base clients, appairage Telegram…
#   - .env CHIFFRÉ (AES-256) : mot de passe dans le trousseau macOS, service
#     « vlad-backup » (synchronisé par le trousseau iCloud si activé).
#   - rotation : 30 jours.
# Restauration : bash vlad-backup.sh restore <date>
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/Documents/VLAD_Backups"
TODAY=$(date +%F)
FICHIERS=(.journal.json MEMOIRE-VLAD.md clients.json projects.json tracker.json layout.json .rapport.json .telegram-chat.json .mail-seen.json .brief-last)

pw() {  # mot de passe de chiffrement, créé au premier passage
  security find-generic-password -a vlad -s vlad-backup -w 2>/dev/null \
    || { local p; p=$(openssl rand -base64 24); security add-generic-password -a vlad -s vlad-backup -w "$p" -T "" >/dev/null; echo "$p"; }
}

if [ "$1" = "restore" ]; then
  D="$DST/${2:?date manquante (AAAA-MM-JJ)}"
  [ -d "$D" ] || { echo "sauvegarde $2 introuvable"; exit 1; }
  for f in "${FICHIERS[@]}"; do [ -f "$D/$f" ] && cp "$D/$f" "$SRC/$f" && echo "  ← $f"; done
  [ -f "$D/env.enc" ] && openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$(pw)" -in "$D/env.enc" -out "$SRC/.env" && echo "  ← .env (déchiffré)"
  echo "✓ restauré depuis $2 — relance le pont."
  exit 0
fi

mkdir -p "$DST/$TODAY"
n=0
for f in "${FICHIERS[@]}"; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DST/$TODAY/$f" && n=$((n+1)); done
[ -f "$SRC/.env" ] && openssl enc -aes-256-cbc -pbkdf2 -salt -pass pass:"$(pw)" -in "$SRC/.env" -out "$DST/$TODAY/env.enc" && n=$((n+1))
# vault (notes markdown) si présent
[ -d "$SRC/vault" ] && cp -R "$SRC/vault" "$DST/$TODAY/" 2>/dev/null && n=$((n+1))
# rotation
/usr/bin/find "$DST" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true
echo "✓ sauvegarde $TODAY : $n éléments → $DST/$TODAY"
