#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';

function argument(name, fallback = '') {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1] || fallback;
  const inline = process.argv.find((item) => item.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

const clientId = argument('client-id');
const tenantId = argument('tenant-id');
const scopes = argument('scopes', 'portal:read,swarm:read,swarm:run').split(',').map((value) => value.trim()).filter(Boolean);
const expiresAt = argument('expires-at') || null;

if (!clientId || !tenantId) {
  console.error('Usage: node scripts/generate-mcp-token.mjs --client-id <tool> --tenant-id <tenant> [--scopes portal:read,swarm:read,swarm:run] [--expires-at ISO-8601]');
  process.exit(1);
}

const token = `kmcp_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
const client = {
  client_id: clientId,
  tenant_id: tenantId,
  token_sha256: tokenHash,
  scopes,
  ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
};

console.log('Store this token in the coding tool secret store or environment. It will not be shown again:');
console.log(token);
console.log('\nAppend this entry to KAYROS_MCP_CLIENTS_JSON on the server:');
console.log(JSON.stringify(client, null, 2));
