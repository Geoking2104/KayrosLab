#!/usr/bin/env node
/**
 * Seed démo / pitch — idées multi-stages pour portfolio & cycle.
 * Usage:
 *   node core/seed-demo.mjs
 *   KAYROS_IDEAS_FILE=/opt/kayroslab/data/ideas.json node core/seed-demo.mjs
 *   DATABASE_URL=postgres://… node core/seed-demo.mjs
 */
import { randomUUID } from 'node:crypto';
import { createIdea, setStage, setStatus } from './model.mjs';
import { InMemoryIdeaRepository, FileIdeaRepository } from './repository.mjs';
import { createPgPool, PgIdeaRepository } from './pg-store.mjs';

const SEED = [
  {
    title: 'Maintenance prédictive IoT UE',
    intake: { problem: 'Arrêts non planifiés usines', hypothesis: 'Capteurs + modèle local réduisent downtime 20%' },
    stage: 'cartographier',
    status: 'en_revue',
  },
  {
    title: 'Onboarding B2B augmenté',
    intake: { problem: 'Churn mois 1–3', hypothesis: 'Parcours guidé + signaux produit' },
    stage: 'eprouver',
    status: 'en_developpement',
  },
  {
    title: 'Marketplace données énergétiques',
    intake: { problem: 'Liquidité P2P faible', hypothesis: 'Tokens + conformité NIS2' },
    stage: 'ecouter',
    status: 'nouveau',
  },
  {
    title: 'Assistant diagnostic DPE pro',
    intake: { problem: 'Temps diagnostiqueur', hypothesis: 'Simulateur 3CL accélère devis' },
    stage: 'projeter',
    status: 'en_developpement',
  },
  {
    title: 'Canal Slack gates COMEX',
    intake: { problem: 'Décisions lentes', hypothesis: 'Gates push + resolve in-chat' },
    stage: 'construire',
    status: 'en_pause',
  },
  {
    title: 'Export OWL concurrentiel',
    intake: { problem: 'Veille non structurée', hypothesis: 'Ontologie Positionner → OWL' },
    stage: 'arbitrer',
    status: 'consideration_future',
  },
];

async function main() {
  const tenantId = process.env.KAYROS_SEED_TENANT || 'default';
  const author = process.env.KAYROS_SEED_AUTHOR || 'seed@kayroslab.com';
  let repo;
  const pool = await createPgPool(process.env);
  if (pool) {
    repo = new PgIdeaRepository(pool);
    console.log('seed → Postgres');
  } else if (process.env.KAYROS_IDEAS_FILE) {
    repo = new FileIdeaRepository({ path: process.env.KAYROS_IDEAS_FILE });
    await repo.load();
    console.log('seed →', process.env.KAYROS_IDEAS_FILE);
  } else {
    repo = new InMemoryIdeaRepository();
    console.log('seed → mémoire (pas de persistance)');
  }

  const created = [];
  for (const s of SEED) {
    let idea = createIdea({
      id: randomUUID(),
      title: s.title,
      intake: s.intake,
      tenantId,
      author,
    });
    idea = setStage(idea, s.stage, { by: author, motif: 'seed demo' });
    idea = setStatus(idea, s.status, { by: author, motif: 'seed demo' });
    await repo.save(idea);
    created.push({ id: idea.id, title: idea.title, stage: idea.stage, status: idea.status });
  }

  console.log(JSON.stringify({ ok: true, count: created.length, ideas: created }, null, 2));
  if (pool) await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
