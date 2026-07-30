import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMistralContextualPositionning } from './mistral-contextual-search.mjs';

const fullScores = Object.fromEntries([
  'architecture', 'stack', 'data_layer', 'security', 'ia_ml', 'scale_perf', 'api_surface',
  'business_model', 'pricing', 'go_to_market', 'icp', 'revenue_model', 'customer_success', 'unit_economics',
].map((id) => [id, 72]));

function jsonResponse(data, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    headers: { get: () => '' },
    json: async () => data,
    text: async () => '',
  };
}

function emptyExternalFetch(chatPayload) {
  return async (url) => {
    const href = String(url);
    if (href.includes('api.github.com/search/repositories')) return jsonResponse({ items: [] });
    if (href.includes('gitlab.com/api/v4/projects')) return jsonResponse([]);
    if (href.includes('lite.duckduckgo.com')) return jsonResponse('', true);
    if (href.includes('/v1/conversations')) return jsonResponse({ error: 'not available' }, false, 404);
    if (href.includes('/v1/chat/completions')) {
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(chatPayload) } }] });
    }
    return jsonResponse({}, false, 404);
  };
}

describe('runMistralContextualPositionning', () => {
  it('returns only Mistral-scored contextual examples and filters prior demo references', async () => {
    const result = await runMistralContextualPositionning('outil industriel de maintenance predictive', {
      apiKey: 'test-key',
      fetchImpl: emptyExternalFetch({
        baselineScores: fullScores,
        examples: [
          {
            name: 'Aha! Ideas',
            url: 'https://www.aha.io/',
            ontologyScores: fullScores,
          },
          {
            name: 'Contextual Project',
            type: 'open_source',
            url: 'https://example.org/contextual-project',
            whyAligned: 'Alignement explicite avec la maintenance predictive.',
            evidence: ['Signal externe fourni par Mistral'],
            technologySignals: ['Modele de prediction'],
            businessSignals: ['Cas industriel'],
            ontologyScores: fullScores,
          },
        ],
      }),
    });

    assert.equal(result.provider, 'mistral');
    assert.equal(result.competitors.length, 1);
    assert.equal(result.competitors[0].name, 'Contextual Project');
    assert.equal(result.kayrosIndex >= 0, true);
    assert.deepEqual(result.sourceCoverage.map((source) => source.label), ['GitHub', 'GitLab', 'Crunchbase', 'IdeaProof']);
  });

  it('rejects incomplete Mistral scoring instead of falling back to local heuristics', async () => {
    await assert.rejects(
      () => runMistralContextualPositionning('idee utilisateur sans scoring complet', {
        apiKey: 'test-key',
        fetchImpl: emptyExternalFetch({
          examples: [{
            name: 'Contextual Project',
            url: 'https://example.org/contextual-project',
            ontologyScores: fullScores,
          }],
        }),
      }),
      /baselineScores/,
    );
  });
});
