#!/usr/bin/env node
// Enregistre la commande slash `/kayros question:<texte>` de l'application
// Discord KayrosLab (API v10, remplacement idempotent : PUT).
//
//   DISCORD_APPLICATION_ID=<ID de l'application> DISCORD_BOT_TOKEN=<jeton du bot> \
//   [DISCORD_GUILD_ID=<serveur de test : commande disponible immédiatement>] \
//   node integrations/discord/register-commands.mjs [--dry-run]
//
// Sans DISCORD_GUILD_ID la commande est globale (propagation jusqu'à ~1 h).
// Le jeton n'est jamais affiché ni écrit sur disque.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const KAYROS_COMMANDS = Object.freeze([
  {
    name: 'kayros',
    type: 1,
    description: 'Poser une question au collectif d’agents KayrosLab',
    description_localizations: { 'en-US': 'Ask the KayrosLab agent collective a question', 'en-GB': 'Ask the KayrosLab agent collective a question' },
    dm_permission: false,
    options: [{
      type: 3, name: 'question', required: true, max_length: 1500,
      description: 'Décision ou question à instruire',
      description_localizations: { 'en-US': 'Decision or question to investigate', 'en-GB': 'Decision or question to investigate' },
    }],
  },
]);

export function commandsEndpoint({ applicationId, guildId = '' }) {
  const app = String(applicationId || '').trim();
  if (!/^\d{5,25}$/.test(app)) throw new Error('DISCORD_APPLICATION_ID requis (identifiant numérique de l’application)');
  const guild = String(guildId || '').trim();
  if (guild && !/^\d{5,25}$/.test(guild)) throw new Error('DISCORD_GUILD_ID doit être numérique');
  return guild
    ? `https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`
    : `https://discord.com/api/v10/applications/${app}/commands`;
}

export async function registerCommands({ applicationId, botToken, guildId = '', fetchImpl = globalThis.fetch } = {}) {
  const url = commandsEndpoint({ applicationId, guildId });
  if (!String(botToken || '').trim()) throw new Error('DISCORD_BOT_TOKEN requis');
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${String(botToken).trim()}` },
    body: JSON.stringify(KAYROS_COMMANDS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Discord a refusé l’enregistrement (${response.status}) : ${JSON.stringify(body)?.slice(0, 300)}`);
  return { url, commands: Array.isArray(body) ? body.map((command) => ({ id: command.id, name: command.name })) : [] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  try {
    if (process.argv.includes('--dry-run')) {
      console.log(`PUT ${commandsEndpoint({ applicationId: env.DISCORD_APPLICATION_ID, guildId: env.DISCORD_GUILD_ID })}`);
      console.log(JSON.stringify(KAYROS_COMMANDS, null, 2));
    } else {
      const result = await registerCommands({ applicationId: env.DISCORD_APPLICATION_ID, botToken: env.DISCORD_BOT_TOKEN, guildId: env.DISCORD_GUILD_ID });
      console.log(`Commandes enregistrées (${result.url}) : ${result.commands.map((c) => `/${c.name}`).join(', ')}`);
    }
  } catch (error) {
    console.error(`Échec : ${error.message}`);
    process.exit(1);
  }
}
