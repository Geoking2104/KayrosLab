import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import {
  TeamsAdapter,
  ConnectorService,
  AccountLinkService,
  InteractionEvent,
  AbstractView,
} from './connectors.mjs';
import {
  getBearerToken,
  splitJwt,
  verifyTeamsToken,
  fetchJwks,
  TeamsKeyCache,
  teamsActivityId,
} from './connectors-teams-deep.mjs';
import { GovernanceService, GateType } from './governance.mjs';

const ISSUER = 'https://api.botframework.com';
const AUDIENCE = '8f3b2a1c-0000-1111-2222-333344445555';

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { jwk: { kty: 'RSA', kid: 'k1', use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }, privateKey, publicKey };
}

function signToken({ header = { kid: 'k1', alg: 'RS256', typ: 'JWT' }, claims = {}, privateKey }) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const data = `${b64url(header)}.${b64url(claims)}`;
  const sig = createSign('RSA-SHA256').update(data).end().sign(privateKey);
  return `${data}.${sig.toString('base64url')}`;
}

function jwks(fetchImpl, jwksUri, keys) {
  // wire a mock openid config + jwks endpoint into fetchImpl
  const wrapped = async (url, opts) => {
    if (url === 'https://login.botframework.com/v3/.well-known/openidconfiguration') {
      return { ok: true, json: async () => ({ jwks_uri: jwksUri, issuer: ISSUER }) };
    }
    if (url === jwksUri) return { ok: true, json: async () => ({ keys }) };
    return fetchImpl(url, opts);
  };
  return wrapped;
}

describe('teams deep helpers', () => {
  it('getBearerToken parses Authorization header', () => {
    assert.equal(getBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
    assert.equal(getBearerToken('Basic xyz'), null);
    assert.equal(getBearerToken(null), null);
  });

  it('splitJwt decodes header/claims and signature bytes', () => {
    const { privateKey } = makeKeyPair();
    const token = signToken({ claims: { iss: ISSUER, aud: AUDIENCE }, privateKey });
    const jwt = splitJwt(token);
    assert.equal(jwt.header.alg, 'RS256');
    assert.equal(jwt.claims.aud, AUDIENCE);
    assert.equal(jwt.signature.length, 256);
    assert.equal(splitJwt('abc'), null);
  });

  it('teamsActivityId is stable', () => {
    const body = { id: 'a1', type: 'invoke', from: { id: 'U1', aadObjectId: 'A1' }, text: '', value: { action: { id: 'approve:g1' } }, timestamp: '2026-01-01T00:00:00Z' };
    const id = teamsActivityId(body);
    assert.match(id, /^teams:A1:invoke:a1:/);
    assert.equal(teamsActivityId({}), null);
  });

  it('TeamsKeyCache TTL', () => {
    const cache = new TeamsKeyCache({ ttlMs: 1000 });
    assert.equal(cache.get(), null);
    cache.set([{ kid: 'k1' }]);
    assert.equal(cache.get().length, 1);
    cache.clear();
    assert.equal(cache.get(), null);
  });

  it('fetchJwks resolves the key set via openid config', async () => {
    const { jwk } = makeKeyPair();
    const fetchImpl = jwks(null, 'https://keys.example/jwks', [jwk]);
    const keys = await fetchJwks({ fetchImpl });
    assert.equal(keys.length, 1);
    assert.equal(keys[0].kid, 'k1');
  });
});

describe('teams JWT verification', () => {
  const { jwk, privateKey } = makeKeyPair();
  function makeToken(claims = {}) {
    return signToken({ claims: { iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600, nbf: Math.floor(Date.now() / 1000) - 60, ...claims }, privateKey });
  }

  it('accepts a valid RS256 token from Bot Framework keys', async () => {
    assert.equal(await verifyTeamsToken(makeToken(), { appId: AUDIENCE, keys: [jwk] }), true);
  });

  it('rejects a token signed with a different private key (same kid)', async () => {
    const other = makeKeyPair();
    const token = signToken({ claims: { iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600 }, privateKey: other.privateKey });
    assert.equal(await verifyTeamsToken(token, { appId: AUDIENCE, keys: [jwk] }), false);
  });

  it('rejects wrong audience', async () => {
    const token = makeToken({ aud: 'evil-app' });
    assert.equal(await verifyTeamsToken(token, { appId: AUDIENCE, keys: [jwk] }), false);
  });

  it('rejects a wrong issuer', async () => {
    const token = makeToken({ iss: 'https://evil.example' });
    assert.equal(await verifyTeamsToken(token, { appId: AUDIENCE, keys: [jwk] }), false);
  });

  it('rejects an expired token', async () => {
    const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    assert.equal(await verifyTeamsToken(token, { appId: AUDIENCE, keys: [jwk] }), false);
  });

  it('rejects tokens without kid or bad alg', async () => {
    const token = signToken({ header: { alg: 'RS256' }, claims: { iss: ISSUER, aud: AUDIENCE }, privateKey });
    assert.equal(await verifyTeamsToken(token, { appId: AUDIENCE, keys: [jwk] }), false);
    const token2 = signToken({ header: { kid: 'k1', alg: 'HS256' }, claims: { iss: ISSUER, aud: AUDIENCE }, privateKey });
    assert.equal(await verifyTeamsToken(token2, { appId: AUDIENCE, keys: [jwk] }), false);
  });

  it('verifies via network (openid + jwks) too', async () => {
    const token = makeToken();
    const fetchImpl = jwks(null, 'https://keys.example/jwks', [jwk]);
    assert.equal(await verifyTeamsToken(token, { appId: AUDIENCE, fetchImpl }), true);
  });
});

describe('teams adapter verifySignature', () => {
  const { jwk, privateKey } = makeKeyPair();
  function token() {
    return signToken({ claims: { iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600 }, privateKey });
  }
  const fetchImpl = jwks(async (url) => {
    // fall-through for any other network (e.g. bot token). only openid/jwks used here.
    return { ok: false, json: async () => ({}) };
  }, 'https://keys.example/jwks', [jwk]);

  it('accepts a valid signed request', async () => {
    const adapter = new TeamsAdapter({ botId: AUDIENCE, openIdConfigUrl: 'https://login.botframework.com/v3/.well-known/openidconfiguration', fetchImpl });
    assert.equal(await adapter.verifySignature({ headers: { authorization: `Bearer ${token()}` } }), true);
  });

  it('rejects missing/blank bearer and unknown app', async () => {
    const adapter = new TeamsAdapter({ botId: AUDIENCE, fetchImpl });
    assert.equal(await adapter.verifySignature({ headers: {} }), false);
    const noApp = new TeamsAdapter({ fetchImpl });
    assert.equal(await noApp.verifySignature({ headers: { authorization: `Bearer ${token()}` } }), false);
  });

  it('rejects a tampered token', async () => {
    const adapter = new TeamsAdapter({ botId: AUDIENCE, fetchImpl });
    const good = token();
    const tampered = `${good.slice(0, -4)}AAAA`;
    assert.equal(await adapter.verifySignature({ headers: { authorization: `Bearer ${tampered}` } }), false);
  });
});

describe('teams parseRequest', () => {
  const adapter = new TeamsAdapter({});
  it('normalizes a slash command message', () => {
    const evt = adapter.parseRequest({
      body: { type: 'message', text: '/submit Lancer un depot', from: { id: 'U1', aadObjectId: 'A1' }, conversation: { id: 'conv:1' }, channelData: { team: { id: 'T1' } } },
    });
    assert.equal(evt.platform, 'teams');
    assert.equal(evt.actionId, 'slash_submit');
    assert.equal(evt.userId, 'A1');
    assert.equal(evt.channelId, 'conv:1');
    assert.equal(evt.teamId, 'T1');
  });

  it('normalizes an adaptiveCard/action invoke', () => {
    const evt = adapter.parseRequest({
      body: { type: 'invoke', name: 'adaptiveCard/action', from: { id: 'U1' }, conversation: { id: 'conv:2' }, value: { action: { id: 'approve:g1', data: { gateId: 'g1' } } } },
    });
    assert.equal(evt.actionId, 'approve:g1');
    assert.equal(evt.payload.gateId, 'g1');
  });

  it('returns null for plain messages and unknown payloads', () => {
    assert.equal(adapter.parseRequest({ body: { type: 'message', text: 'bonjour', from: { id: 'U1' } } }), null);
    assert.equal(adapter.parseRequest({ body: { type: 'conversationUpdate' } }), null);
  });
});

describe('teams renderView / activity', () => {
  const adapter = new TeamsAdapter({});
  it('builds an AdaptiveCard with FactSet + Submit actions + accent', () => {
    const card = adapter.renderView(new AbstractView({
      title: 'Gate open', text: 'Arbitrage requis', color: '#ef4444',
      fields: [{ label: 'Idee', value: 'Demarche LTL' }],
      actions: [{ id: 'approve:g1', label: 'Approuver', style: 'primary' }],
    }));
    assert.equal(card.type, 'AdaptiveCard');
    assert.equal(card.version, '1.5');
    assert.equal(card.accent, 'attention');
    assert.equal(card.body[2].type, 'FactSet');
    assert.equal(card.actions[0].id, 'approve:g1');
    assert.equal(card.actions[0].data.actionId, 'approve:g1');
  });
});

describe('teams postMessage / updateMessage / token', () => {
  it('posts through webhookUrl', async () => {
    const calls = [];
    const adapter = new TeamsAdapter({ webhookUrl: 'https://team.example/webhook', fetchImpl: async (url, opts) => { calls.push({ url, method: opts.method }); return { ok: true }; } });
    const res = await adapter.postMessage('any', new AbstractView({ title: 'T', fields: [{ label: 'F', value: 'V' }] }));
    assert.equal(res.ok, true);
    assert.equal(calls[0].url, 'https://team.example/webhook');
    assert.ok(calls[0].method === 'POST');
  });

  it('posts proactively via Bot Framework when bot configured', async () => {
    const calls = [];
    const adapter = new TeamsAdapter({
      botId: AUDIENCE, botPassword: 'secret',
      fetchImpl: async (url, opts) => {
        calls.push({ url, method: opts.method });
        if (url.includes('/oauth2/v2.0/token')) return { ok: true, json: async () => ({ access_token: 'tok123', expires_in: 3600 }) };
        if (url.includes('/conversations/conv:1/activities') && opts.method === 'POST') return { ok: true, json: async () => ({ id: 'act1' }) };
        return { ok: false, text: async () => 'nope', json: async () => ({}) };
      },
    });
    const res = await adapter.postMessage('conv:1', new AbstractView({ title: 'T' }));
    assert.equal(res.ok, true);
    assert.equal(res.messageId, 'act1');
    const tokenCall = calls.find((c) => c.url.includes('/oauth2/v2.0/token'));
    assert.ok(tokenCall);
    assert.ok(calls.some((c) => c.url.includes('/conversations/conv:1/activities') && c.method === 'POST'));
  });

  it('updateMessage PATCHes activity with bearer token', async () => {
    const seen = [];
    const adapter = new TeamsAdapter({
      botId: AUDIENCE, botPassword: 'secret',
      fetchImpl: async (url, opts) => {
        if (url.includes('/oauth2/v2.0/token')) return { ok: true, json: async () => ({ access_token: 'tok123', expires_in: 3600 }) };
        seen.push({ url, method: opts.method, auth: opts.headers.Authorization });
        return { ok: true };
      },
    });
    const res = await adapter.updateMessage('conv:1', 'act1', new AbstractView({ title: 'T2' }));
    assert.equal(res.ok, true);
    assert.match(seen[0].url, /conversations\/conv:1\/activities\/act1$/);
    assert.equal(seen[0].method, 'PUT');
    assert.equal(seen[0].auth, 'Bearer tok123');
  });

  it('fails without webhook or bot credentials', async () => {
    const adapter = new TeamsAdapter({ fetchImpl: async () => ({ ok: false }) });
    const res = await adapter.postMessage('conv:1', new AbstractView({ title: 'T' }));
    assert.equal(res.ok, false);
  });
});

describe('teams gate flow via ConnectorService', () => {
  function setup({ role = 'comex' } = {}) {
    const gov = new GovernanceService();
    const linkService = new AccountLinkService();
    const { token } = linkService.createToken({ platformId: 'teams:A1', userId: 'A1', platform: 'teams' });
    linkService.link(token, { id: 'k1', email: 'comex@k.com', role, tenantId: 't1' });
    const adapter = new TeamsAdapter({ linkService, fetchImpl: async () => ({ ok: true }) });
    const connector = new ConnectorService({ adapters: [adapter], linkService, governance: gov });
    const { gateId } = gov.open({ type: GateType.COMEX_ARBITRAGE, ideaId: 'idea1', requiredRole: 'comex' });
    return { gov, connector, gateId };
  }

  it('approve resolves the gate via an Adaptive Card action', async () => {
    const { gov, connector, gateId } = setup();
    const evt = new InteractionEvent({ platform: 'teams', actionId: `approve:${gateId}`, userId: 'teams:A1', channelId: 'conv:1' });
    const res = await connector.handleInteraction(evt);
    assert.equal(res.type, 'ack');
    assert.equal(gov.list().length, 0);
  });

  it('reject opens the motif modal then resolves with reason', async () => {
    const { gov, connector, gateId } = setup();
    const evt = new InteractionEvent({ platform: 'teams', actionId: `reject:${gateId}`, userId: 'teams:A1', channelId: 'conv:1' });
    const modal = await connector.handleInteraction(evt);
    assert.equal(modal.type, 'modal');
    const confirmed = await connector.handleInteraction({ ...evt, _motifConfirmed: true, payload: { reason: 'Non aligne avec la strategie' } });
    assert.equal(confirmed.type, 'ack');
    assert.equal(gov.list().length, 0);
  });

  it('blocks unlinked users', async () => {
    const { connector, gateId } = setup();
    const evt = new InteractionEvent({ platform: 'teams', actionId: `approve:${gateId}`, userId: 'teams:STRANGER', channelId: 'conv:1' });
    const res = await connector.handleInteraction(evt);
    assert.equal(res.type, 'ephemeral');
  });

  it('buildGateView renders resolvable button ids', () => {
    const adapter = new TeamsAdapter({});
    const view = adapter.buildGateView({ gateId: 'g9', requiredRole: 'comex', type: 'comex_arbitrage', ideaId: 'idea1' });
    const ids = view.actions.map((a) => a.id);
    assert.deepEqual(ids, ['approve:g9', 'revise:g9', 'reject:g9']);
  });
});