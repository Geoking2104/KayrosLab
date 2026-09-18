import { openSeal, seal } from './salon-x.mjs';

const SKEW_MS = 60_000;

export function accessExpired(binding, now = Date.now()) {
  if (!binding?.accessSealed) return true;
  const exp = Date.parse(binding.expiresAt || 0);
  if (!Number.isFinite(exp)) return true;
  return exp - SKEW_MS <= now;
}

export async function ensureAccess(store, client, userId, binding) {
  if (!binding) {
    const err = new Error('compte X non lié');
    err.status = 403;
    throw err;
  }
  const current = openSeal(binding.accessSealed);
  if (current && !accessExpired(binding)) return current;
  const refresh = openSeal(binding.refreshSealed);
  if (!refresh) {
    const err = new Error('session X expirée — relier le compte');
    err.status = 401;
    throw err;
  }
  const tokens = await client.refresh(refresh);
  if (!tokens?.access_token) {
    const err = new Error('refresh X refusé');
    err.status = 401;
    throw err;
  }
  binding.accessSealed = seal(tokens.access_token);
  if (tokens.refresh_token) binding.refreshSealed = seal(tokens.refresh_token);
  const ttl = Number(tokens.expires_in);
  binding.expiresAt = new Date(Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 7200) * 1000).toISOString();
  binding.refreshedAt = new Date().toISOString();
  await store.putBinding(userId, binding);
  return tokens.access_token;
}

export async function withAccess(store, client, userId, binding, fn) {
  let token = await ensureAccess(store, client, userId, binding);
  try {
    return await fn(token);
  } catch (err) {
    if (err.status !== 401) throw err;
    binding.expiresAt = new Date(0).toISOString();
    token = await ensureAccess(store, client, userId, binding);
    return fn(token);
  }
}
