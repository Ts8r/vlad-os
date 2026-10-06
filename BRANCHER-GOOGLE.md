# Brancher VLAD à Google Classroom et Drive

Une fois branché, toutes les 30 minutes et **en lecture seule** :

- chaque **devoir** Classroom devient une tâche dans l'Agenda (onglet Semaine), à sa date limite, avec son lien ;
- les **supports de cours** (PDF, Google Docs) sont téléchargés dans `cours/`, puis VLAD les lit : résumé, notions, points à savoir et **QCM de 10 questions** dans la page ◈ COURS ;
- chaque cours est rangé sous le nom du cours Classroom ;
- un message Telegram te prévient quand un devoir ou un cours arrive (si Telegram est branché).

VLAD ne modifie jamais rien sur Classroom ni sur le Drive.

> **Pas une clé d'API.** Une clé d'API Google ne lit que des données publiques. Pour lire *ton* Classroom, il faut un **identifiant OAuth** à ton nom, puis ton accord une fois dans le navigateur. Chacun crée le sien : il ne se partage pas.

Durée : 15 minutes, une seule fois.

## 1. Créer l'accès Google — [console.cloud.google.com](https://console.cloud.google.com)

Connecte-toi avec le compte de ton école (celui de Classroom).

1. Crée un projet, par exemple « VLAD ».
2. **API et services → Bibliothèque** : active **Google Classroom API** et **Google Drive API**.
3. **Écran de consentement OAuth** : type *Externe*, nom « VLAD », et ajoute **ton adresse** dans *Utilisateurs test*.
4. **Identifiants → Créer des identifiants → ID client OAuth**, type **Application de bureau**.
5. Télécharge le fichier JSON, renomme-le exactement `.google-client.json` et place-le dans le dossier de VLAD.

## 2. Indiquer ton compte

Dans `.env` :

```bash
VLAD_GOOGLE_EMAIL=prenom.nom@monecole.fr
VLAD_FORMATION=BTS SIO 1re année      # pour des QCM au bon niveau
```

## 3. Autoriser VLAD (20 secondes)

```bash
bash vlad-google.sh
```

Le navigateur s'ouvre : choisis ton compte d'école et accepte. Google affiche « application non validée » : c'est normal (c'est ta propre appli), clique sur *Continuer*. La première synchronisation part tout de suite.

## 4. Vérifier

- **Agenda → Semaine** : les devoirs apparaissent à leur date.
- **◈ COURS** : les cours arrivent au fil de leur lecture (30 à 90 secondes par support), avec leur QCM.
- Forcer une synchronisation : `curl -X POST http://localhost:8788/classroom/sync`

## En cas de souci

- **« Mon accès à Google Classroom a expiré »** : tant que ton projet Google reste en mode *Test*, Google coupe l'accès **tous les 7 jours**. Relance `bash vlad-google.sh`.
- **« client absent »** : `.google-client.json` n'est pas dans le dossier de VLAD, ou n'a pas exactement ce nom.
- **« accès bloqué par l'administrateur »** : ton école interdit les applications tierces sur ses comptes. Il faut demander à l'administrateur d'autoriser l'appli ; en attendant, dépose tes PDF à la main dans ◈ COURS.
- **Rien ne remonte** : le pont doit tourner (`bash vlad.sh`).
