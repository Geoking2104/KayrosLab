import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './test-helpers.mjs';

describe('Contact public', () => {
  let app;
  let ctx;
  let sent;

  beforeEach(async () => {
    sent = [];
    const built = await buildTestApp();
    app = built.app;
    ctx = built.ctx;
    ctx.contactMailer = {
      sendMail: async (payload) => {
        sent.push(payload);
        return { messageId: 'test' };
      },
    };
  });
  afterEach(async () => { if (app) await app.close(); });

  it('envoie une lettre sans pièce', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      payload: {
        kind: 'message',
        name: 'Hôte',
        email: 'hote@example.com',
        message: 'Une question pour la table, assez longue.',
        language: 'fr',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Lettre/);
    assert.equal(sent[0].replyTo, 'hote@example.com');
    assert.equal(sent[0].to.includes('contact@kayroslab.com') || sent[0].to[0] === 'contact@kayroslab.com', true);
  });

  it('joint un fichier à un signalement', async () => {
    const data = Buffer.from('trace du salon').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      payload: {
        kind: 'bug',
        name: 'Lecteur',
        email: 'lecteur@example.com',
        subject: 'Le fil se tait',
        message: 'Après Entrer, la mémoire ne revient pas.',
        files: [{ name: 'trace.txt', type: 'text/plain', data }],
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(sent[0].attachments.length, 1);
    assert.equal(sent[0].attachments[0].filename, 'trace.txt');
    assert.equal(sent[0].attachments[0].content.toString(), 'trace du salon');
  });

  it('refuse une pièce d’un type inconnu', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      payload: {
        kind: 'bug',
        name: 'Lecteur',
        email: 'lecteur@example.com',
        message: 'Voici un exécutable déguisé en remarque.',
        files: [{ name: 'evil.exe', type: 'application/x-msdownload', data: 'aaaa' }],
      },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'FILE');
    assert.equal(sent.length, 0);
  });

  it('ignore le honeypot', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      payload: {
        kind: 'message',
        name: 'Bot',
        email: 'bot@example.com',
        message: 'spam '.repeat(10),
        website: 'https://spam.test',
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(sent.length, 0);
  });

  it('conserve le formulaire commercial existant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      payload: {
        lastName: 'Dupont',
        firstName: 'Anne',
        company: 'Atelier',
        position: 'Directrice',
        email: 'anne@atelier.test',
        language: 'fr',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(sent[0].subject, /Anne Dupont/);
  });

  it('signale un formulaire incomplet', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      payload: { kind: 'message', name: '', email: 'pas-un-mail', message: 'court' },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.code, 'INVALID');
    assert.equal(sent.length, 0);
  });

  it('signale l’absence de relais SMTP', async () => {
    ctx.contactMailer = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contact',
      payload: {
        kind: 'message',
        name: 'Hôte',
        email: 'hote@example.com',
        message: 'Une question pour la table, assez longue.',
      },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().code, 'SMTP_UNCONFIGURED');
    assert.equal(sent.length, 0);
  });
});
