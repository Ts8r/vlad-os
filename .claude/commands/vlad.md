---
description: Ouvre VLAD (HUD + pont vocal Opus/Whisper FR) comme une extension
allowed-tools: Bash(bash vlad.sh:*), Bash(lsof:*)
---

Lance VLAD OS : démarre le pont vocal (Whisper FR → Opus → voix FR) et le HUD,
puis ouvre le navigateur.

!`bash vlad.sh`

Une fois ouvert, dis simplement à l'utilisateur que VLAD est prêt sur
http://localhost:5173 et qu'il peut parler au micro 🎙️ ou écrire. Pour couper le
son et répondre en chat, le bouton « 🔇 Silencieux ». Pour arrêter : `/vlad stop`
(ou `bash vlad.sh stop`).
