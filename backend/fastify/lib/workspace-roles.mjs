// Rôle effectif d'un utilisateur dans un espace : la fiche membre (console →
// Membres) prime sur le rôle du compte. Partagé par la console, l'API publique
// et les connecteurs de chat (Slack / Teams / Discord).
import { WorkspaceStore } from './workspace-store.mjs';

export const PERMISSIONS = {
  admin: ['read', 'run', 'arbitrate', 'manage', 'members'],
  comex: ['read', 'run', 'arbitrate', 'manage'],
  contributeur: ['read', 'run'],
  lecteur: ['read'],
};

/** Magasin d'espace du contexte (créé au premier usage). */
export function workspaceStoreFor(ctx) {
  if (!ctx.workspaceStore) {
    const file = process.env.KAYROS_WORKSPACE_FILE ?? './.kayros-workspace.json';
    ctx.workspaceStore = new WorkspaceStore({ file });
  }
  return ctx.workspaceStore;
}

/** { member, role } pour un e-mail et un rôle de compte dans un tenant. */
export async function memberRole(ctx, { tenantId, email, accountRole = null }) {
  const members = await workspaceStoreFor(ctx).list(tenantId || 'default', 'members');
  const member = members.find((m) => m.email === String(email || '').toLowerCase()) || null;
  // Sans fiche membre : comex/admin gardent leur rôle, les autres rôles du compte valent contributeur.
  const fallback = ['comex', 'admin'].includes(accountRole) ? accountRole : 'contributeur';
  return { member, role: member?.role || fallback };
}

export async function memberCan(ctx, identity, permission) {
  const { role } = await memberRole(ctx, identity);
  return (PERMISSIONS[role] || []).includes(permission);
}

/**
 * Rôle de l'utilisateur KayrosLab lié à un compte de chat (`slack:U…`), ou
 * `null` si le compte n'est pas lié (accès au niveau du canal).
 */
export async function linkedChatRole(ctx, platformUserId) {
  if (!ctx.linkService || !platformUserId) return null;
  let link = null;
  try { link = await ctx.linkService.get(platformUserId); } catch { link = null; }
  if (!link) return null;
  let user = null;
  if (ctx.userStore?.findById && link.kayrosUserId) user = await ctx.userStore.findById(link.kayrosUserId).catch(() => null);
  const tenantId = String(user?.tenantId || link.tenantId || 'default');
  const email = user?.email || link.email || '';
  const { role } = await memberRole(ctx, { tenantId, email, accountRole: user?.role || link.role });
  return { tenantId, email, role, permissions: PERMISSIONS[role] || [] };
}

/**
 * Rôle d'un compte de chat NON lié. Par défaut `lecteur` : sans liaison à un
 * compte KayrosLab, pas de mission (aucun contournement des rôles).
 * KAYROS_CHAT_UNLINKED_ROLE=contributeur rouvre l'accès au niveau du canal.
 */
export function unlinkedChatRole(env = process.env) {
  const role = String(env.KAYROS_CHAT_UNLINKED_ROLE || 'lecteur').trim().toLowerCase();
  return PERMISSIONS[role] && !['admin', 'comex'].includes(role) ? role : 'lecteur';
}
