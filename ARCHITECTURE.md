# VLAD OS — Architecture

Deux processus locaux et des fichiers : c'est tout.

```
  iPhone / navigateur                      Mac
 ┌──────────────────┐   /api (proxy)   ┌───────────────────────────────┐
 │  HUD  (Vite :5173) │ ───────────────▶ │  Pont  voice/vlad-server.js    │
 │  ui/app.jsx        │                 │  (Node, :8788, sans dépendance)│
 │  ui/widgets/*.jsx  │ ◀─── JSON ───── │                               │
 └──────────────────┘                  │  ├─ STT  stt-worker.py (Whisper)│
                                        │  ├─ TTS  tts-worker.py (Kokoro) │
        Telegram ◀──── long polling ─── │  │       / edge-tts / say      │
                                        │  ├─ Cerveau : process `claude`  │
                                        │  │   persistant (stream-json)   │
                                        │  ├─ mail-worker.py (IMAP Gmail) │
                                        │  └─ widgets-api.js, tracker.js  │
                                        └──────────────┬────────────────┘
                                                       │ lit / écrit
                    vault/ · MEMOIRE-VLAD.md · tracker.json · layout.json · .env
```

## Une question vocale, de bout en bout

1. **Micro** → le HUD enregistre (ou la reconnaissance vocale du navigateur) → `POST /ask` ou `/listen`.
2. **Transcription** locale par Whisper (`stt-worker.py`, modèle chargé une fois).
3. **Cerveau** : le texte part dans UN process `claude` gardé vivant, avec un prompt système court (la persona, dans `vlad-server.js`) et seulement les outils de lecture (Read, Grep, Glob, WebSearch, WebFetch).
4. **Réponse en streaming**, découpée en phrases → synthèse vocale phrase par phrase : VLAD commence à parler avant d'avoir fini de réfléchir.
5. **Marqueurs** dans la réponse, jamais lus à voix haute :
   - `[[TACHE: …]]` → écrit directement dans `tracker.json` (page Agenda, onglets Semaine / Habitudes) ;
   - `[[MAIL: …]]` → le pont lit les mails demandés et relance le cerveau ;
   - `[[ACTION: …]]` → action proposée, exécutée **seulement** après un « confirme » vocal, par un `claude` ponctuel qui a les droits d'écriture.

## Les briques

| Dossier / fichier | Rôle |
|---|---|
| `ui/app.jsx` | HUD : œil, onde vocale, dock de saisie, colonnes de widgets |
| `ui/widget-board.jsx` | Disposition, mode édition, bibliothèque de widgets |
| `ui/widgets/` | Un fichier par widget, découvert automatiquement |
| `ui/progres.jsx` | Onglets **Semaine**, **Habitudes**, **Rapport** de la page Agenda |
| `ui/agenda.jsx` | Page **Agenda** : mois, journée, journée type + onglets de suivi |
| `ui/vault-overview.jsx` | Page **Vault** : graphe des notes |
| `voice/vlad-server.js` | Le pont : HTTP, voix, cerveau, Telegram, tâches planifiées |
| `voice/widgets-api.js` | Routes des widgets : disposition, RSS, sites, GitHub, notes |
| `voice/tracker.js` | Tâches, habitudes, check-in (aussi utilisable en CLI) |
| `voice/vault-data.js` | Construit le graphe du Vault |
| `skills/` | Domaines de compétence (`SKILL.md`) |
| `vault/` | Tes notes Markdown (seuls les modèles sont versionnés) |

## Tâches planifiées (si Telegram est configuré)

Brief du matin (`BRIEF_HOUR`), rappels avant rendez-vous (`RAPPEL_MINUTES`), check-in du soir (`CHECKIN_HOUR`), consolidation du carnet (`CONSOLIDE_HOUR`), rapport du dimanche, tri des mails toutes les 10 minutes.

## Ce qui ne quitte jamais le Mac

L'audio (Whisper et Kokoro sont locaux), le vault, le carnet, les tâches, la disposition. Seul le texte des échanges part vers Claude, via ton propre compte Claude Code. Les connecteurs que tu actives (Gmail, Calendly, GitHub, Telegram, ElevenLabs) parlent à leur service respectif.
