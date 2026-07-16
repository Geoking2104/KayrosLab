<?php
// Copier ce fichier en config.php et renseigner les valeurs. NE PAS committer config.php.
return [
  'ANTHROPIC_API_KEY' => 'sk-ant-...votre-cle...',        // cle serveur, jamais exposee au navigateur
  'ANTHROPIC_MODEL'   => 'claude-3-5-sonnet-latest',      // adapter au modele API courant (voir docs Anthropic)
  'ANTHROPIC_MAXTOK'  => 1024,
  'OLLAMA_ENDPOINT'   => 'http://localhost:11434',        // Ollama joignable depuis l hebergement (souvent non, cf README)
  'OLLAMA_MODEL'      => 'llama3.2',
  'ALLOWED_ORIGIN'    => 'https://www.kayroslab.com',     // origine autorisee (evite *)
  'SHARED_SECRET'     => '',                              // si non vide: header X-Kayros-Secret requis
  'DEFAULT_PROVIDER'  => 'anthropic',                     // 'anthropic' ou 'ollama'
];
