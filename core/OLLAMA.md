# Brancher le cœur KayrosLab sur Ollama (LLM local souverain)

Le cœur (`core/`) sait déjà parler à un vrai Ollama via `OllamaProvider` / `createEngine({ sovereignty: 'local' })`.
Ce guide couvre l'usage **local** (aucune donnée ne sort de la machine).

## 1. Prérequis

Ollama est installé et lancé (vérifié : `http://localhost:11434` répond).
Il faut **installer au moins un modèle** :

```bash
ollama pull llama3.2        # ~2 Go, rapide (recommandé pour démarrer)
# alternatives :
# ollama pull llama3.1      # 8B, plus lent, meilleure qualité
# ollama pull qwen2.5:7b    # bon raisonnement
```

Vérifier :

```bash
ollama list                 # doit afficher le modèle
curl http://localhost:11434/api/tags
```

## 2. Démo en ligne de commande (Node)

Depuis la racine du dépôt (Node 20+) :

```bash
node core/ollama-demo.mjs llama3.2
```

Le script fait de **vrais appels LLM** (un par étape de l'orchestrateur), puis passe par un
**gate de gouvernance** (mode strict) auto-validé pour la démo. Node peut joindre `localhost:11434` sans souci.

## 3. Usage depuis le navigateur (app `kayroslab-reference.html`)

Deux obstacles quand la page est servie depuis `https://…githack.com` :

1. **Mixed content** : une page `https://` ne peut pas appeler `http://localhost:11434`.
2. **CORS** : Ollama n'autorise pas toutes les origines par défaut.

Solutions (palier P1, local) :

- **Servir l'app en local** (même origine que possible) :
  ```bash
  # depuis le dossier du dépôt
  python -m http.server 8080
  # puis ouvrir http://localhost:8080/kayroslab-reference.html
  ```
- **Autoriser l'origine côté Ollama** (CORS) en lançant Ollama avec :
  ```bash
  # Windows (PowerShell) :  $env:OLLAMA_ORIGINS="http://localhost:8080"; ollama serve
  # macOS/Linux :           OLLAMA_ORIGINS="http://localhost:8080" ollama serve
  ```
  (ou `OLLAMA_ORIGINS=*` en développement uniquement — jamais en production).

Dans le code de l'app :

```js
import { createEngine } from './core/index.mjs';
const eng = createEngine({ sovereignty: 'local', model: 'llama3.2' });
// eng.orchestrator.run(plan, { governance: 'supervise', sovereignty: 'local' })
```

## 4. Production (palier P2)

En production, **ne pas** appeler Ollama/Claude directement depuis le client : passer par le
**backend proxy Fastify** (les clés et l'accès LLM restent côté serveur, cf. `SPECIFICATIONS_TECHNIQUES.md` §10).

## Rappel

- `sovereignty: 'local'` force le routage vers Ollama (`RoutingPolicy`).
- En cas d'échec Ollama, le moteur bascule sur l'adaptateur `mock` (fallback tracé).
