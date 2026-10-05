# VLAD OS — Personnaliser

## 1. Qui parle à qui

Dans `.env` :

```bash
VLAD_USER=Alex              # VLAD s'adresse à toi par ce prénom
VLAD_COMPANY=Mon Studio     # facultatif : ton activité, pour le contexte
VLAD_CALENDAR=Alex          # calendrier de l'app Calendrier où VLAD crée les événements
```

Pour aller plus loin, la persona complète est la constante `PERSONA` de `voice/vlad-server.js` (ton, règles de l'oral, marqueurs).

## 2. Les widgets

Bouton **⊞ WIDGETS** sur l'accueil, puis **+ Ajouter un widget**. Pour en écrire un : [`ui/widgets/README.md`](ui/widgets/README.md).
Accueil proposé par défaut à un nouvel appareil : `DISPOSITION_DEFAUT` dans `ui/widgets/index.js`.

## 3. Les couleurs

Le thème « porcelaine » est dans le bloc `:root` de `ui/styles.css` :

```css
:root {
  --bg: #edeef3;      /* fond */
  --ink: #38406A;     /* texte */
  --dim: #6e799d;     /* texte secondaire */
  --blue: #4b6398;    /* accent */
  --warn: #c94f63;    /* alertes */
}
```

Les pages Agenda (avec ses onglets de suivi) et Vault ont leur feuille (`agenda.css`, `progres.css`, `vault-overview.css`).

### Le verre liquide des widgets

Sur ordinateur, les widgets sont des panneaux de verre liquide ([plasma-ui](https://github.com/CruxGarden/plasma-ui), WebGL) ; sur mobile, ce sont des cartes classiques.
- **Déplacer un widget** : attrape-le par son titre et pose-le où tu veux. Il s'aimante à la grille et à ses voisins, fusionne au contact d'un autre, et sa position est retenue. En mode ⊞ WIDGETS, « Réaligner » remet tout en place.
- **Réglages** (teinte, givre, reflet) : `ui/plasma-fond.jsx`.
- **Revenir aux cartes classiques** : dans la console du navigateur, `localStorage.vlad_plasma = "0"` puis recharger.

## 4. La voix

Par ordre de préférence, le pont utilise : ElevenLabs (si `ELEVEN_KEY` + `ELEVEN_VOICE`), puis la voix Edge « Rémy », puis Kokoro `ff_siwis` (la seule voix française de Kokoro), puis les voix macOS. Précision de la transcription : `VLAD_WHISPER` (tiny → medium).

## 5. Les skills

Un skill = `skills/<nom>/SKILL.md` : quand l'utiliser, exemples de demandes, règles métier. Remplis-les avec ton activité (tarifs, charte, façon de travailler) : c'est ce qui rend VLAD utile pour *toi*.

## 6. Garder la signature

La licence (PolyForm Shield) demande de conserver la ligne `Required Notice` du fichier `LICENSE`. Merci de laisser aussi la petite signature **« VLAD OS · Ts8r Studio »** en bas de l'accueil.
