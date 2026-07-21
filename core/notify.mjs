// KayrosLab — Canaux de notification.
// Le hook de gouvernance appelait un notifier qui ne faisait qu'ecrire dans les logs :
// un censeur hors de l'application n'etait donc jamais prevenu. Ce module fournit de
// VRAIS canaux, sans ajouter de dependance au cœur (webhook = fetch natif ; l'email
// passe par une fonction `send` INJECTEE, donc libre choix du fournisseur).

/** Met en forme un evenement de gate en message lisible. */
export function formatGateEvent(evt = {}, { titre = null, destinataires = [] } = {}) {
  const sujet = `[KayrosLab] Arbitrage requis — ${titre ?? evt.ideaId ?? 'idée'}`;
  const a = evt.evaluation;
  const instruction = a && a.count
    ? `Vote pondéré ${a.moyennePonderee}/100 sur ${a.count} évaluateur(s) — suggère ${a.recommandation}${a.consensus ? '' : ' (avis dispersés)'}.`
    : 'Aucun vote préalable : la décision ne sera pas instruite.';
  const texte = [
    `Un gate de gouvernance attend votre arbitrage.`,
    ``,
    `Idée      : ${titre ?? evt.ideaId ?? '—'}`,
    `Type      : ${evt.gateType ?? evt.type ?? '—'}`,
    `Rôle requis : ${evt.requiredRole ?? '—'}`,
    `Ouvert le : ${evt.createdAt ?? '—'}`,
    ``,
    instruction,
    ``,
    `Rappel : le vote instruit la décision, il ne la remplace pas. Un refus ou une révision doit être motivé.`,
  ].join('\n');
  return { sujet, texte, destinataires, evt };
}

/** Canal console (developpement / secours). */
export class ConsoleNotifier {
  constructor({ logger = console } = {}) { this.id = 'console'; this.logger = logger; }
  async send(msg) { this.logger.info?.(`${msg.sujet}\n${msg.texte}`); return { canal: this.id, ok: true }; }
}

/**
 * Canal webhook (Slack, Teams, n8n, Zapier…). Zero dependance : `fetch` natif.
 * C'est le canal reel le plus simple a mettre en place cote exploitation.
 */
export class WebhookNotifier {
  constructor({ url, headers = {}, fetchImpl, timeoutMs = 5000 } = {}) {
    if (!url) throw new Error('WebhookNotifier: url requise');
    this.id = 'webhook'; this.url = url; this.headers = headers; this._fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('WebhookNotifier: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  async send(msg) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    try {
      const res = await this._f()(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        // `text` : compatible Slack/Teams. `gate` : charge utile exploitable par un automate.
        body: JSON.stringify({ text: `*${msg.sujet}*\n${msg.texte}`, sujet: msg.sujet, gate: msg.evt, destinataires: msg.destinataires }),
        signal: ctrl?.signal,
      });
      if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
      return { canal: this.id, ok: true };
    } finally { if (t) clearTimeout(t); }
  }
}

/**
 * Canal email. La fonction `send({to, subject, text})` est INJECTEE : le cœur ne
 * depend d'aucun client SMTP. Le backend branche nodemailer, une API, ou autre.
 */
export class EmailNotifier {
  constructor({ send, from = null } = {}) {
    if (typeof send !== 'function') throw new Error('EmailNotifier: fonction send requise');
    this.id = 'email'; this._send = send; this.from = from;
  }
  async send(msg) {
    const to = (msg.destinataires ?? []).filter(Boolean);
    if (!to.length) return { canal: this.id, ok: false, raison: 'aucun destinataire' };
    await this._send({ to, from: this.from, subject: msg.sujet, text: msg.texte });
    return { canal: this.id, ok: true, destinataires: to.length };
  }
}

/**
 * Diffusion multi-canaux. Un canal en panne (SMTP down, webhook injoignable) ne doit
 * JAMAIS empecher les autres ni bloquer l'ouverture du gate : on isole chaque echec.
 */
export class CompositeNotifier {
  constructor(canaux = []) { this.id = 'composite'; this.canaux = canaux.filter(Boolean); }
  async send(msg) {
    const res = await Promise.allSettled(this.canaux.map((c) => c.send(msg)));
    return res.map((r, i) => r.status === 'fulfilled'
      ? r.value
      : { canal: this.canaux[i]?.id ?? 'inconnu', ok: false, erreur: String(r.reason?.message ?? r.reason) });
  }
}

/**
 * Fabrique le notifier a brancher sur GovernanceService.
 * `resolveDestinataires(evt)` renvoie les emails des censeurs concernes (role + tenant).
 */
export function gateNotifier({ canal, resolveDestinataires = async () => [], resolveTitre = async () => null } = {}) {
  return async (evt) => {
    if (!canal) return null;
    try {
      const [destinataires, titre] = await Promise.all([resolveDestinataires(evt), resolveTitre(evt)]);
      return await canal.send(formatGateEvent(evt, { titre, destinataires }));
    } catch (e) {
      // Une notification qui echoue ne remet pas en cause le gate lui-meme.
      return { ok: false, erreur: String(e?.message ?? e) };
    }
  };
}
