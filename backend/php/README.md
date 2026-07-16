# Proxy PHP — déploiement sur hébergement mutualisé OVH

Ce proxy tourne nativement sur ton hébergement OVH (`filenyb.cluster129.hosting.ovh.net`).

## 1. Configurer

1. Copier `config.sample.php` → `config.php`.
2. Renseigner dans `config.php` :
   - `ANTHROPIC_API_KEY` (ta clé Anthropic) et `ANTHROPIC_MODEL` (modèle API courant, cf. docs Anthropic).
   - `ALLOWED_ORIGIN` = ton domaine (ex. `https://www.kayroslab.com`).
   - (optionnel) `SHARED_SECRET` pour exiger l'en-tête `X-Kayros-Secret`.
   - `OLLAMA_ENDPOINT` seulement si un Ollama est joignable **depuis l'hébergement** (souvent non → utiliser `anthropic`).

## 2. Déployer par FTP

Via l'explorateur FTP OVH (le lien manager que tu as) **ou** FileZilla (déjà installé), déposer dans `www/api/` :

- `govern.php`
- `config.php`  (⚠️ le vrai, avec la clé — **ne pas** mettre sur GitHub)
- `.htaccess`   (protège `config.php`)

Ne PAS uploader `config.sample.php` en prod (facultatif).

## 3. Tester

```bash
curl -s -X POST https://www.kayroslab.com/api/govern.php \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Dis bonjour en une phrase."}],"provider":"anthropic"}'
```

Réponse attendue : `{"text":"...","provider":"anthropic","usage":{...}}`.

## 4. Brancher l'app

Voir `../README.md` (section « Câblage côté navigateur ») avec
`backendUrl: 'https://www.kayroslab.com/api/govern.php'`.

## Notes

- Nécessite l'extension **cURL** PHP (activée par défaut chez OVH).
- Le proxy relaie une complétion ; l'orchestration gouvernée (agents + gates) tourne côté client (`core/`).
  Pour l'orchestration côté serveur, utiliser le backend Fastify.
