import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { buildPackage, renderManifest } from '../integrations/teams/build-app-package.mjs';
import { KAYROS_COMMANDS, commandsEndpoint, registerCommands } from '../integrations/discord/register-commands.mjs';

const root = new URL('..', import.meta.url).pathname;
const workflow = readFileSync(join(root, '.github/workflows/deploy-vps-backend.yml'), 'utf8');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.mjs') && !name.endsWith('.test.mjs') ? [path] : [];
  });
}

const chatEnvNames = [...new Set(
  [...sourceFiles(join(root, 'core')), ...sourceFiles(join(root, 'backend/fastify/lib')), ...sourceFiles(join(root, 'backend/fastify/routes'))]
    .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/env\.((?:SLACK|TEAMS|DISCORD)_[A-Z_]+)/g)].map((m) => m[1])),
)].sort();

function block(name) {
  const start = workflow.indexOf(`const ${name} = {`);
  assert.ok(start > 0, `${name} absent`);
  return workflow.slice(start, workflow.indexOf('};', start));
}

test('the deploy workflow forwards every Slack/Teams/Discord setting the code reads', () => {
  assert.ok(chatEnvNames.length >= 15, `noms lus par le code : ${chatEnvNames.join(', ')}`);
  const envsLine = workflow.match(/^\s*envs: (.+)$/m)[1].split(',');
  for (const name of chatEnvNames) {
    assert.match(workflow, new RegExp(`^\\s+${name}: \\$\\{\\{ (secrets|vars)\\.${name} \\}\\}$`, 'm'), `${name} : env du job`);
    assert.ok(envsLine.includes(name), `${name} : liste envs de ssh-action`);
    assert.match(block('optionalSources'), new RegExp(`\\b${name}: process\\.env\\.${name},`), `${name} : optionalSources`);
  }
});

test('an absent chat secret never wipes the value already on the server', () => {
  const replacements = block('replacements');
  for (const name of chatEnvNames) assert.doesNotMatch(replacements, new RegExp(`\\b${name}:`), `${name} ne doit pas être dans replacements (effacé si vide)`);
  // optionalSources n'écrit que les valeurs non vides.
  assert.match(workflow, /for \(const \[name, value\] of Object\.entries\(optionalSources\)\) \{\s+if \(value\) replacements\[name\] = value;/);
  // Les identifiants sont des secrets, jamais des variables en clair.
  for (const name of ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_CLIENT_SECRET', 'TEAMS_BOT_PASSWORD', 'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_SECRET']) {
    assert.match(workflow, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }
});

function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength;
    files[name] = inflateRawSync(buffer.subarray(start, start + size));
    offset = start + size;
  }
  return files;
}

test('Teams app package: manifest bound to TEAMS_APP_ID with both icons, no secret inside', () => {
  const appId = '11111111-2222-4333-8444-555555555555';
  assert.throws(() => renderManifest({}), /TEAMS_APP_ID requis/);
  const manifest = renderManifest({ TEAMS_APP_ID: appId, KAYROS_PUBLIC_API_URL: 'https://api.kayroslab.com' });
  assert.equal(manifest.id, appId);
  assert.equal(manifest.bots[0].botId, appId);
  assert.deepEqual(manifest.bots[0].scopes, ['personal', 'team', 'groupChat']);
  assert.ok(manifest.validDomains.includes('api.kayroslab.com'));
  const files = unzip(buildPackage({ TEAMS_APP_ID: appId, TEAMS_BOT_PASSWORD: 'must-not-leak' }));
  assert.deepEqual(Object.keys(files).sort(), ['color.png', 'manifest.json', 'outline.png']);
  assert.equal(JSON.parse(files['manifest.json']).bots[0].botId, appId);
  assert.doesNotMatch(files['manifest.json'].toString(), /must-not-leak/);
  assert.equal(files['color.png'].readUInt32BE(16), 192, 'icône couleur 192 px');
  assert.equal(files['outline.png'].readUInt32BE(16), 32, 'icône contour 32 px');
});

test('Discord registration script declares /kayros question and PUTs it with the bot token', async () => {
  assert.equal(KAYROS_COMMANDS[0].name, 'kayros');
  assert.equal(KAYROS_COMMANDS[0].options[0].name, 'question', 'option lue par le serveur (discordCommandText)');
  assert.throws(() => commandsEndpoint({ applicationId: '' }), /DISCORD_APPLICATION_ID/);
  assert.equal(commandsEndpoint({ applicationId: '123456', guildId: '987654' }), 'https://discord.com/api/v10/applications/123456/guilds/987654/commands');
  const sent = [];
  const result = await registerCommands({
    applicationId: '123456', botToken: 'bot-token',
    fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => [{ id: '1', name: 'kayros' }] }; },
  });
  assert.equal(sent[0].init.method, 'PUT');
  assert.equal(sent[0].init.headers.Authorization, 'Bot bot-token');
  assert.deepEqual(result.commands, [{ id: '1', name: 'kayros' }]);
  await assert.rejects(() => registerCommands({ applicationId: '123456', botToken: '' }), /DISCORD_BOT_TOKEN/);
});
