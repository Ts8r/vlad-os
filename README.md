# VLAD OS

**A voice-first personal assistant that runs on your Mac and thinks with Claude Code.**

VLAD (*Virtual Logic Assistance Director*) listens, answers out loud, reads your files, your calendar and your mail, keeps your tasks and habits, and remembers what you tell it — all behind a calm HUD with a customizable widget board.

> 🇫🇷 VLAD speaks French out of the box (interface, voice, prompts). [Version française plus bas.](#-en-français)

---

## What it does

| | |
|---|---|
| 🎙️ **Voice, locally** | Speech-to-text with Whisper and text-to-speech with Kokoro / Edge / macOS voices. Your audio never leaves the machine. |
| 🧠 **Claude Code as the brain** | One persistent `claude` process, trimmed to the bone (~1 s to first token, cents per day). Read-only on your files; anything that changes something needs a spoken "confirm". |
| 🧩 **Widget library** | Pick, remove and arrange widgets on the home screen — layout shared between your Mac and your phone. Optional on desktop: liquid-glass panels rendered in WebGL ([plasma-ui](https://github.com/CruxGarden/plasma-ui), MIT) — see RESKIN.md. Weather, Pomodoro, quick note, site status, RSS, GitHub, calendar, mail, system… |
| 📅 **Agenda** | Month and day views from your calendars, a customizable typical day, plus weekly tasks, monthly habits, mood check-in and a Sunday report. VLAD can add or tick tasks by voice. |
| 🗂️ **Vault** | Your notes as an Obsidian-style vault, drawn as a neural graph. VLAD searches it before answering. |
| 📱 **Everywhere** | Installable as a PWA on iPhone, plus an optional Telegram bot (morning brief, meeting reminders, evening check-in). |

## Requirements

- **macOS** (uses `say`, the Calendar app and `osascript` for actions)
- **Node.js ≥ 18** and **Python 3.10+**
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)** installed and signed in (`claude auth login`) — VLAD uses *your* Claude account. Other assistants are not supported yet.

## Quick start

```bash
git clone https://github.com/Ts8r/vlad-os && cd vlad-os
bash setup.sh          # Node deps + local voice (.venv) + checks
open -e .env           # set VLAD_USER=<your first name>, everything else is optional
bash vlad.sh           # starts the bridge (:8788) and the HUD (:5173)
```

Stop with `bash vlad.sh stop`. Every connector (calendar, Gmail, Calendly, Telegram, GitHub, ElevenLabs) is optional and documented in [`.env.example`](.env.example): an unconfigured widget simply says "to configure".

## Make it yours

- **Widgets** — click **⊞ WIDGETS** on the home screen to add, remove and arrange them. Writing your own is one file: see [`ui/widgets/README.md`](ui/widgets/README.md).
- **Skills** — `skills/<name>/SKILL.md` describes a domain (sales, content, research…). Edit them to match your business.
- **Look & persona** — colors, name and voice: see [`RESKIN.md`](RESKIN.md). How the pieces fit: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## License

**[PolyForm Shield 1.0.0](LICENSE)** — © 2026 Ts8r Studio.

- ✅ Free to use and adapt, personally or for your own work.
- ❌ You may not sell VLAD OS or offer a product that competes with it.
- ✍️ Keep the `Required Notice` line of the license with every copy, and please keep the small **"VLAD OS · Ts8r Studio"** credit in the interface.

---

## 🇫🇷 En français

**VLAD OS est un assistant personnel vocal qui tourne sur ton Mac, avec Claude Code comme cerveau.**

Il t'écoute, te répond à voix haute, lit tes fichiers, ton agenda et tes mails, tient tes tâches et tes habitudes, et retient ce que tu lui dis. Le tout dans un HUD épuré dont tu choisis les widgets.

### Installer

Il te faut macOS, Node 18+, Python 3.10+ et **Claude Code connecté à ton compte** (`claude auth login`) : VLAD utilise ton propre abonnement Claude.

```bash
git clone https://github.com/Ts8r/vlad-os && cd vlad-os
bash setup.sh          # dépendances + voix locale
open -e .env           # renseigne VLAD_USER=<ton prénom>, le reste est facultatif
bash vlad.sh           # pont (:8788) + HUD (:5173)
```

### Adapter à tes outils

- **⊞ WIDGETS** sur l'accueil : ajoute, retire et range les widgets. La disposition est partagée entre le Mac et l'iPhone.
- **Un nouveau widget = un fichier** dans `ui/widgets/` ([mode d'emploi](ui/widgets/README.md)).
- **Tes connecteurs** (agenda iCal, Gmail, Calendly, Telegram, GitHub…) se branchent dans `.env`. Sans clé, le widget affiche « à configurer ».
- **Tes skills** (`skills/`) et ton carnet (`MEMOIRE-VLAD.md`) donnent à VLAD le contexte de ton activité.

### Licence

[PolyForm Shield 1.0.0](LICENSE), © 2026 Ts8r Studio.

- Tu peux utiliser et adapter VLAD gratuitement, pour toi ou pour ton travail.
- Tu ne peux pas le revendre ni en faire un produit concurrent.
- Garde la mention « Required Notice » de la licence et la petite signature **« VLAD OS · Ts8r Studio »** dans l'interface.
