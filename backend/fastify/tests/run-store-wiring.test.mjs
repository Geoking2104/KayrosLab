import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile } from 'node:fs/promises';
import { buildTestApp } from './test-helpers.mjs';
import { FileRunStore, InMemoryRunStore } from '../../../core/run-store.mjs';

/**
 * La persistance des runs suspendus est le defaut. Un redemarrage du backend
 * ne doit pas perdre une decision en attente : sans store fichier, un run
 * suspendu meurt avec le processus et personne ne peut plus l'arbitrer.
 */
describe('backend cablage du run store', () => {
  const paths = [];
  after(async () => {
    // Le nettoyage est best-effort : sur un montage sans droit de unlink il
    // echouerait, et un artefact de test qui traine ne doit pas faire echouer
    // une suite qui, elle, a bien verifie ce qu'elle devait verifier.
    for (const p of paths) {
      try { await rm(p, { force: true }); } catch { /* artefact laisse en place */ }
      try { await rm(`${p}.tmp`, { force: true }); } catch { /* idem */ }
    }
  });

  it('sans variable, la persistance fichier est le defaut', async () => {
    // Chaine vide = variable non fournie : on exerce la branche par defaut
    // de la production, que le harnais neutralise autrement pour isoler les
    // tests. Aucun run n'est sauvegarde ici, donc aucun fichier n'est ecrit.
    const { app, ctx } = await buildTestApp({ KAYROS_RUNS_FILE: '' });
    try {
      assert.ok(ctx.runStore instanceof FileRunStore, 'store fichier par defaut');
      assert.equal(ctx.runStore.path, './.kayros-runs.json');
      // L'orchestrateur le voit : c'est lui qui enregistre a la suspension.
      assert.equal(ctx.engine.orchestrator.runStore, ctx.runStore);
    } finally { await app.close(); }
  });

  it('un run enregistre survit a une nouvelle instance du store', async () => {
    const path = './.kayros-runs-test-persist.json';
    paths.push(path);
    const { app, ctx } = await buildTestApp({ KAYROS_RUNS_FILE: path });
    try {
      const { createWorkflowState, applyWorkflowEvent } = await import('../../../core/workflow-state.mjs');
      let state = createWorkflowState({
        runId: 'run-persiste', traceId: 'trace-persiste', ideaId: 'idee-1',
        input: { request: 'Arbitrer plus tard' },
      });
      state = applyWorkflowEvent(state, {
        type: 'gate', gateId: 'g1', gateType: 'decision_arbitrage', nodeId: 'decision-gate',
      });
      await ctx.runStore.save(state, { tenantId: 't1' });

      // Le fichier existe reellement sur disque, pas seulement en memoire.
      const raw = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(raw.length, 1);
      assert.equal(raw[0].runId, 'run-persiste');

      // Un nouveau processus relit ce que le precedent avait laisse.
      const froid = new FileRunStore({ path });
      const back = await froid.get('run-persiste', { tenantId: 't1' });
      assert.equal(back.status, 'pending_review');
      assert.equal(back.gate.nodeId, 'decision-gate');
    } finally { await app.close(); }
  });

  it('KAYROS_RUNS_FILE=memory force explicitement le store volatil', async () => {
    const { app, ctx } = await buildTestApp({ KAYROS_RUNS_FILE: 'memory' });
    try {
      assert.ok(ctx.runStore instanceof InMemoryRunStore, 'store volatil sur demande');
    } finally { await app.close(); }
  });
});
