#!/usr/bin/env bash
# VLAD — brancher (ou rebrancher) Google Classroom + Drive : ouvre le navigateur, 20 secondes.
# Prérequis : .google-client.json dans ce dossier (voir BRANCHER-GOOGLE.md).
cd "$(dirname "$0")"
set -a; [ -f .env ] && . ./.env; set +a
PY="${VLAD_PYTHON:-.venv/bin/python}"; [ -x "$PY" ] || PY=python3
"$PY" voice/classroom-sync.py auth && echo "✓ VLAD est autorisé. Synchronisation immédiate…" \
  && curl -s -X POST "http://localhost:${VLAD_PORT:-8788}/classroom/sync" >/dev/null && echo "✓ lancée (devoirs dans l'Agenda, cours dans ◈ COURS)."
