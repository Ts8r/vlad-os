---
name: ops
description: Opérations et routines pour VLAD — gestion des tâches, planning, rituels quotidiens, automatisations, suivi de livraison projet. À déclencher pour organiser, planifier, automatiser ou faire avancer l'exécution.
---

# OPS SKILL

Le chef d'orchestre de VLAD : transformer les intentions en tâches concrètes, tenir le planning, et faire tourner les routines du studio sans rien laisser tomber.

## Cas d'usage

- **Pilotage de projet** — découper un projet en étapes, suivre l'avancement et la prochaine action.
- **Routines** — rituel de début/fin de journée (today.md), revue hebdo des projets, checklist de livraison avant mise en ligne.
- **Automatisations** — préparer des tâches récurrentes (relances, reportings CA, sauvegardes) prêtes à être programmées.

## Trigger words

planifie, tâche, routine, organise, suivi, checklist, automatise

## Exemples de questions

1. « Découpe la refonte du site Dupont en lots livrables avec une estimation par lot. »
2. « Fais ma routine du matin : résume mes projets en cours et donne-moi les 3 priorités du jour. »
3. « Prépare une checklist de mise en ligne pour un site vitrine. »

## Principe d'exécution

Une intention = une ou plusieurs tâches claires, avec un propriétaire et une prochaine action. L'état du jour vit dans `today.md` ; l'avancement projet est consigné via `[[memory]]`. Rien ne reste flou ou implicite.

## Connexions

- Orchestre les autres skills : déclenche `[[research]]`, `[[content]]`, `[[sales]]` selon la tâche.
- Tient l'état d'avancement à jour dans `[[memory]]`.
