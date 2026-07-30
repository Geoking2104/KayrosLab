#!/usr/bin/env node
// KayrosLab — kayros-cli : JSON in / JSON out (EF-255).
//
//   echo '{"cmd":"workspace.list","token":"t1"}' | node core/bin/kayros-cli.mjs
//   node core/bin/kayros-cli.mjs --schema
//
// Une commande par ligne (JSONL), une reponse JSON par ligne. Rien d'autre sur
// stdout : la sortie est faite pour etre consommee par un programme.

import { createEngine } from '../index.mjs';
import { createCanvasStudio, executerLot, schema, TokenStore, EventLog } from '../canvas/index.mjs';

const args = process.argv.slice(2);
if (args.includes('--schema')) {
  process.stdout.write(`${JSON.stringify(schema(), null, 2)}\n`);
  process.exit(0);
}

const engine = createEngine(
  process.env.KAYROS_BACKEND_URL
    ? { backendUrl: `${process.env.KAYROS_BACKEND_URL}/v1/llm`, embeddingsUrl: `${process.env.KAYROS_BACKEND_URL}/v1/embed` }
    : (process.env.KAYROS_SOVEREIGNTY === 'local' ? { sovereignty: 'local' } : {}),
);
const studio = createCanvasStudio(engine);
studio.engine = engine;

const tokens = new TokenStore();
// Le jeton vient de l'environnement, jamais de la ligne de commande : un
// argument se retrouve dans l'historique du shell et dans `ps`.
if (process.env.KAYROS_AGENT_TOKEN) {
  tokens.emettre({
    token: process.env.KAYROS_AGENT_TOKEN,
    agentId: process.env.KAYROS_AGENT_ID ?? 'cli',
    workspaces: (process.env.KAYROS_WORKSPACES ?? '').split(',').filter(Boolean),
    scopes: (process.env.KAYROS_SCOPES ?? 'read').split(','),
  });
}

const entree = await new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

const resultats = await executerLot(entree, { studio, tokens, journal: new EventLog() });
for (const r of resultats) process.stdout.write(`${JSON.stringify(r)}\n`);
process.exit(resultats.every((r) => r.ok) ? 0 : 1);
