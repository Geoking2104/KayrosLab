import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  smtpFromEnv,
  parseSmtpUrl,
  autheliaNotifierYaml,
  patchAutheliaConfig,
} from '../lib/smtp.mjs';

describe('SMTP IONOS', () => {
  it('lit une URL smtps', () => {
    const parsed = parseSmtpUrl('smtps://contact%40kayroslab.com:s%3Bcret@smtp.ionos.fr:465');
    assert.equal(parsed.host, 'smtp.ionos.fr');
    assert.equal(parsed.port, 465);
    assert.equal(parsed.secure, true);
    assert.equal(parsed.user, 'contact@kayroslab.com');
    assert.equal(parsed.pass, 's;cret');
  });

  it('prend IONOS dès qu’un mot de passe est fourni', () => {
    const smtp = smtpFromEnv({
      KAYROS_SMTP_PASS: 'secret-ionos',
    });
    assert.equal(smtp.enabled, true);
    assert.equal(smtp.host, 'smtp.ionos.fr');
    assert.equal(smtp.port, 465);
    assert.equal(smtp.options.secure, true);
    assert.equal(smtp.user, 'contact@kayroslab.com');
    assert.equal(smtp.from, 'KayrosLab <contact@kayroslab.com>');
    assert.equal(smtp.authelia.address, 'submissions://smtp.ionos.fr:465');
  });

  it('reste éteint sans secret', () => {
    const smtp = smtpFromEnv({ KAYROS_SMTP_HOST: 'smtp.ionos.fr' });
    assert.equal(smtp.enabled, false);
    assert.equal(smtp.host, null);
    assert.match(autheliaNotifierYaml(smtp), /filesystem/);
  });

  it('n’écrit pas le mot de passe Authelia en clair YAML cassé', () => {
    const smtp = smtpFromEnv({
      KAYROS_SMTP_USER: 'contact@kayroslab.com',
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
    const smtp = smtpFromEnv({ KAYROS_SMTP_PASS: 'secret-ionos' });
    const after = patchAutheliaConfig(before, smtp);
    assert.match(after, /notifier:\n  smtp:/);
    assert.doesNotMatch(after, /notification\.txt/);
    assert.match(after, /access_control:/);
  });
});
