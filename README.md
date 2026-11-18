# Agenda Chantier

Calendrier de chantier avec un assistant de rappel et une saisie vocale.
Les données sont enregistrées en ligne dans une base **Neon** (PostgreSQL),
via un petit serveur hébergé sur **Vercel**.

## Fonctions

- **Calendrier mensuel** : travaux, rendez-vous et notes « Fait du jour » ;
  les jours passés avec des éléments non validés passent en rouge.
- **Validation** au fur et à mesure, avec la date et l'heure de validation.
- **Saisie vocale** « Dites-le à l'assistant » : on dicte, l'assistant crée les éléments
  (date, heure, type). Micro de l'app (reconnaissance vocale du navigateur) ou micro du clavier.
- **Modifier à la voix, avec votre accord** (`src/commands.js`) : « décale la réunion avec mon patron à 16h »,
  « déplace la chape à jeudi », « repousse la livraison de 2 jours », « annule le rendez-vous avec le plombier »,
  « valide la pose de la chape ». L'assistant propose le changement ; rien n'est modifié sans « Confirmer »,
  et « Annuler » remet l'élément comme avant.
- **Assistant Claude** (`api/assistant.js`, modèle `claude-opus-5-5`, sortie JSON structurée) : comprend
  les notes dictées librement, crée les éléments, et propose modifications / suppressions / validations
  à confirmer. Nécessite `ANTHROPIC_API_KEY` dans Vercel ; sans clé (ou en cas de panne), l'assistant
  simple intégré (`src/parse.js`, `src/commands.js`) prend le relais.
- **Mémoire de l'assistant** : les 15 derniers échanges (14 jours max) sont gardés dans Neon (table
  `assistant_memory`) et renvoyés à Claude, pour comprendre « mets-la à 17h », « ce jour-là »… L'agenda
  actuel fait toujours foi. Visible et effaçable dans l'app (« L'assistant se souvient de… »).
- **Assistant de rappel** (`src/agent.js`) : rendez-vous imminents, briefing du matin,
  validation de fin de journée, retards.
- **Synchronisation** (`src/sync.js`) : chaque modification part au serveur ;
  sans réseau, elle attend sur le téléphone et repart automatiquement.
  Les mêmes données sont visibles depuis tous vos appareils.
- **Mot de passe** pour protéger l'agenda (variable `APP_PASSWORD`).

## Mise en ligne (Vercel + Neon), depuis le téléphone

1. Sur **vercel.com**, connectez-vous avec GitHub, puis **Add New… → Project**
   et importez le dépôt `agenda_travail_rdv`. Laissez les réglages par défaut (Vite) et déployez.
2. Dans le projet Vercel : onglet **Storage → Create Database → Neon** (gratuit),
   puis reliez-la au projet. Vercel ajoute tout seul `DATABASE_URL`.
3. Onglet **Settings → Environment Variables** : ajoutez `APP_PASSWORD` avec le mot de passe de votre choix,
   et `ANTHROPIC_API_KEY` (clé créée sur console.anthropic.com) pour l'assistant Claude.
4. Onglet **Deployments** : **Redeploy** le dernier déploiement pour prendre en compte les variables.
5. Ouvrez l'adresse `https://….vercel.app` sur le téléphone, entrez le mot de passe.
   Dans Chrome : **⋮ → Ajouter à l'écran d'accueil**.

Les tables sont créées automatiquement au premier lancement : rien à faire dans Neon.

**Reprendre les données saisies ailleurs** (ex. la version claude.ai) : Réglages → **Exporter**
sur l'ancienne version, puis Réglages → **Importer** sur la nouvelle.

## Développement

```bash
npm install
npm test          # tests de l'agent, de l'analyse vocale et de l'API (PostgreSQL embarqué)
npm run dev       # interface seule, en mode local (sans serveur)
npx vercel dev    # interface + API, avec un fichier .env.local (voir .env.example)
```

## Structure

- `api/items.js`, `api/settings.js` : API (fonctions Vercel) ; `api/_lib/db.js` : connexion Neon et création des tables.
- `src/` : application React (Vite).

## Suite prévue (SaaS)

- Comptes utilisateurs et plusieurs chantiers (colonne propriétaire sur les tables).
- Rappels envoyés par le serveur (e-mail / WhatsApp) même application fermée (tâche planifiée Vercel).
