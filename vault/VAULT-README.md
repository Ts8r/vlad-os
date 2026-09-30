---
tags: [meta, readme]
created: 2026-06-16
type: documentation
status: living
---

# 🗄️ VAULT — Mode d'emploi

La mémoire long-terme de VLAD OS (Étape 2). Un coffre Obsidian 100 % local et
à toi : chaque livrable revient ici en `.md`, relié, réutilisable. Branché au
Skill [[memory]].

## Structure des dossiers

| Dossier | Rôle |
|---------|------|
| `inbox/` | Captures brutes, non triées. Point d'entrée rapide. |
| `processed/` | Notes synthétisées et reliées : projets, clients, idées, recherches. |
| `reports/` | Exports auto : revues hebdo, usage des Skills, analyses. |
| `archive/` | Terminé / froid. Conservé pour réutilisation. |

## Comment ajouter une note

1. Copie le `template-*.md` adapté (quick-note, project, client, idée, research…).
2. Renomme-le clairement : `refonte-site-dupont.md`, pas `template-project.md`.
3. Range-le : capture rapide → `inbox/` ; note aboutie → `processed/`.
4. Remplis le frontmatter et relie (voir ci-dessous).

## Comment lier les notes — `[[wikilinks]]`

- Tape `[[` puis le nom du fichier (sans `.md`) → `[[refonte-site-dupont]]`.
- Alias d'affichage : `[[refonte-site-dupont|la refonte du site Dupont]]`.
- Lie **généreusement** : un client → ses projets → ses recherches. Le graphe
  Obsidian révèle les connexions, c'est là que la mémoire devient puissante.

## Format du frontmatter YAML

```yaml
---
tags: [project, client]      # catégories pour filtrer/chercher
created: 2026-06-16        # date de création (AAAA-MM-JJ)
type: project              # quick-note | project | client | idea | research | report | completed
status: active            # raw | active | prospect | done | archived
---
```

## Règle d'or

**Tout livrable produit par VLAD = un fichier `.md` rangé dans ce vault.**
La mémoire grandit seule, session après session, et reste 100 % à toi.

---
*Suivi d'avancement : [[progress]]. Skills : [[memory]] · [[ops]].*
