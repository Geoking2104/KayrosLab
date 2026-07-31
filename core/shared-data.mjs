/**
 * H — Multi-instance friendly shared data layout (file-backed).
 * One directory hosts users / ideas / gates / memory JSON files.
 * For true multi-writer scale, swap repositories for Postgres later;
 * this helper standardizes paths so several Fastify workers can share the same volume.
 */

import { memoryPathForTenant } from './memory.mjs';

/**
 * @param {string} dir absolute or relative shared data directory
 * @returns {{ users, ideas, gates, memory, offload, memoryForTenant }}
 */
export function sharedDataPaths(dir) {
  if (!dir) return null;
  const root = String(dir).replace(/[/\\]+$/, '');
  return {
    root,
    users: `${root}/users.json`,
    ideas: `${root}/ideas.json`,
    gates: `${root}/gates.json`,
    memory: `${root}/memory.json`,
    offload: `${root}/l0`,
    memoryForTenant: (tenantId) => memoryPathForTenant(`${root}/memory.json`, tenantId),
  };
}

/**
 * Apply KAYROS_SHARED_DATA_DIR onto process.env if individual paths are unset.
 * Call early in buildContext before reading file paths.
 */
export function applySharedDataEnv(env = process.env) {
  const dir = env.KAYROS_SHARED_DATA_DIR || env.KAYROS_DATA_DIR || '';
  if (!dir) return null;
  const paths = sharedDataPaths(dir);
  if (!env.KAYROS_USERS_FILE) env.KAYROS_USERS_FILE = paths.users;
  if (!env.KAYROS_IDEAS_FILE) env.KAYROS_IDEAS_FILE = paths.ideas;
  if (!env.KAYROS_GATES_FILE) env.KAYROS_GATES_FILE = paths.gates;
  if (!env.KAYROS_MEMORY_FILE) env.KAYROS_MEMORY_FILE = paths.memory;
  if (!env.KAYROS_OFFLOAD_ROOT) env.KAYROS_OFFLOAD_ROOT = paths.offload;
  return paths;
}
