// Wire durable account links into Fastify context (v14).

import { DurableAccountLinkService } from '../../../core/account-link-service.mjs';
import { FileAccountLinkStore, PgAccountLinkStore } from '../../../core/account-link-store.mjs';

/**
 * @param {{ pgPool?: object, env?: NodeJS.ProcessEnv }} opts
 */
export async function createLinkService({ pgPool = null, env = process.env } = {}) {
  const linksFile = env.KAYROS_LINKS_FILE || '';
  let store;
  if (pgPool) {
    store = new PgAccountLinkStore(pgPool);
    console.info('[kayroslab] account links store: Postgres');
  } else if (linksFile) {
    store = new FileAccountLinkStore({ path: linksFile });
    console.info('[kayroslab] account links store: file', linksFile);
  } else {
    store = new FileAccountLinkStore();
    console.info('[kayroslab] account links store: memory');
  }
  const linkService = new DurableAccountLinkService({ store });
  await linkService.load();
  return linkService;
}
