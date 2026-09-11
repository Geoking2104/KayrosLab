import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  smtpFromEnv,
  parseSmtpUrl,
  autheliaNotifierYaml,
  patchAutheliaConfig,
} from '../lib/smtp.mjs';

describe('SMTP Gmail', () => {
  it('lit une URL smtps', () => {
    const parsed = parseSmtpUrl('smtps://geoffroydelatournelle%40gmail.com:s%3Bcret@smtp.gmail.com:465');
    assert.equal(parsed.host, 'smtp.gmail.com');
    assert.equal(parsed.port, 465);
    assert.equal(parsed.secure, true);
    assert.equal(parsed.user, 'geoffroydelatournelle@gmail.com');
    assert.equal(parsed.pass, 's;cret');
  });

  it('prend Gmail dès qu’un mot de passe d’application est fourni', () => {
    const smtp = smtpFromEnv({
      KAYROS_SMTP_PASS: 'abcd efgh ijkl mnop',
    });
    assert.equal(smtp.enabled, true);
    assert.equal(smtp.host, 'smtp.gmail.com');
    assert.equal(smtp.port, 465);
    assert.equal(smtp.options.secure, true);
    assert.equal(smtp.user, 'geoffroydelatournelle@gmail.com');
    assert.equal(smtp.options.auth.pass, 'abcdefghijklmnop');
    assert.equal(smtp.from, 'KayrosLab <geoffroydelatournelle@gmail.com>');
    assert.equal(smtp.authelia.address, 'submissions://smtp.gmail.com:465');
  });

  it('reste éteint sans secret', () => {
    const smtp = smtpFromEnv({ KAYROS_SMTP_HOST: 'smtp.gmail.com' });
    assert.equal(smtp.enabled, false);
    assert.equal(smtp.host, null);
    assert.match(autheliaNotifierYaml(smtp), /filesystem/);
  });

  it('n’écrit pas le mot de passe Authelia en clair YAML cassé', () => {
    const smtp = smtpFromEnv({
      KAYROS_SMTP_USER: 'geoffroydelatournelle@gmail.com',
      KAYROS_SMTP_PASS: "a'b$c",
    });
    const yaml = autheliaNotifierYaml(smtp);
    assert.match(yaml, /password: 'a''b\$c'/);
    assert.doesNotMatch(yaml, /filesystem/);
  });

  it('remplace le notificateur fichier d’Authelia', () => {
    const before = [
      'storage:',
      '  local:',
      '    path: /config/db.sqlite3',
      'notifier:',
      '  filesystem:',
      '    filename: /config/notification.txt',
      'access_control:',
      '  default_policy: deny',
      '',
    ].join('\n');
    const smtp = smtpFromEnv({ KAYROS_SMTP_PASS: 'secret-gmail' });
    const after = patchAutheliaConfig(before, smtp);
    assert.match(after, /notifier:\n  smtp:/);
    assert.doesNotMatch(after, /notification\.txt/);
    assert.match(after, /access_control:/);
  });
});
