// KayrosLab — Diffusion temps reel du canvas (EF-220).
//
// POURQUOI PAS YJS. Le coeur possede deja un CRDT d'objets teste — commutatif,
// idempotent, associatif (`core/canvas/sync.mjs`). Yjs apporterait un CRDT de
// TEXTE, pertinent pour de la prose editee caractere par caractere, pas pour un
// canvas de noeuds. L'ajouter signifierait une dependance de plus ET deux
// modeles de fusion a maintenir en parallele. Il manquait un transport, pas un
// algorithme : SSE le fournit, sans dependance et sans WebSocket a operer.
//
// LIMITE ASSUMEE. Deux personnes editant simultanement le MEME champ texte
// tombent en dernier-ecrivain-gagne, avec conflit signale. Yjs ferait mieux sur
// ce cas precis ; il reste ouvert si l'usage le reclame.

import { mergeWorkspaces, snapshotReseau, empreinte } from '../../../core/canvas/index.mjs';

/** Intervalle de battement : les proxys coupent les flux inactifs. */
const BATTEMENT_MS = 25_000;

export class CanvasHub {
  constructor({ repo, battementMs = BATTEMENT_MS } = {}) {
    this.repo = repo;
    this.battementMs = battementMs;
    this._salles = new Map();   // workspaceId -> Set<abonne>
  }

  /** Abonnes d'un espace. */
  _salle(id) {
    if (!this._salles.has(id)) this._salles.set(id, new Set());
    return this._salles.get(id);
  }

  /**
   * Inscrit un flux SSE. Renvoie la fonction de desinscription.
   * @param {{workspaceId:string, reply:object, identite:{email:string}, onClose?:Function}} o
   */
  subscribe({ workspaceId, reply, identite }) {
    const abonne = {
      id: `${identite.email}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
      email: identite.email,
      reply,
      depuis: new Date().toISOString(),
    };

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Sans ceci, nginx tamponne le flux et le temps reel devient du differe.
      'x-accel-buffering': 'no',
    });

    const salle = this._salle(workspaceId);
    salle.add(abonne);

    const battement = setInterval(() => {
      // Commentaire SSE : maintient la connexion sans polluer le flux d'evenements.
      try { reply.raw.write(': battement\n\n'); } catch { fermer(); }
    }, this.battementMs);

    const fermer = () => {
      clearInterval(battement);
      salle.delete(abonne);
      if (!salle.size) this._salles.delete(workspaceId);
      this._diffuser(workspaceId, 'presence', this.presence(workspaceId), abonne);
    };

    reply.raw.on('close', fermer);
    reply.raw.on('error', fermer);

    this._emettre(abonne, 'bienvenue', { abonneId: abonne.id, presence: this.presence(workspaceId) });
    this._diffuser(workspaceId, 'presence', this.presence(workspaceId), abonne);
    return fermer;
  }

  /** Qui est connecte sur cet espace — de la presence, pas de l'etat. */
  presence(workspaceId) {
    return [...this._salle(workspaceId)].map((a) => ({ id: a.id, email: a.email, depuis: a.depuis }));
  }

  _emettre(abonne, type, data) {
    try { abonne.reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { /* un abonne mort est retire par son propre `close` */ }
  }

  /** Diffuse a tous sauf, eventuellement, l'auteur de l'action. */
  _diffuser(workspaceId, type, data, sauf = null) {
    for (const a of this._salle(workspaceId)) {
      if (sauf && a.id === sauf.id) continue;
      this._emettre(a, type, data);
    }
  }

  /**
   * Publie un nouvel etat. On envoie le SNAPSHOT allege (sans historique) :
   * l'historique est volumineux et reconstructible, l'envoyer a chaque frappe
   * saturerait le flux pour rien.
   */
  publish(workspaceId, workspace, { auteurId = null } = {}) {
    if (!workspace) return;
    this._diffuser(workspaceId, 'etat', snapshotReseau(workspace), auteurId ? { id: auteurId } : null);
  }

  /** Relaie une sortie de swarm au fil de l'eau (EF-230). */
  publishSwarm(workspaceId, sortie) {
    this._diffuser(workspaceId, 'swarm', sortie);
  }

  /**
   * Reconcilie un etat client avec celui du serveur (EF-221).
   *
   * Le client envoie son etat COMPLET, pas une liste d'operations : rejouer des
   * operations sur un etat qui a change entre-temps est la source classique de
   * perte. La fusion est commutative, l'ordre d'arrivee n'a donc pas d'importance.
   *
   * @returns {Promise<{workspace:object, fusionne:boolean, empreinte:string}>}
   */
  async reconcilier(workspaceId, etatClient, { auteurId = null } = {}) {
    const serveur = await this.repo.get(workspaceId);
    if (!serveur) throw new Error(`reconcilier: workspace introuvable "${workspaceId}"`);
    if (!etatClient) return { workspace: serveur, fusionne: false, empreinte: empreinte(serveur) };

    const avant = empreinte(serveur);
    const fusionne = mergeWorkspaces(serveur, { ...etatClient, id: workspaceId, tenantId: serveur.tenantId });
    const apres = empreinte(fusionne);

    if (avant !== apres) {
      await this.repo.save(fusionne);
      this.publish(workspaceId, fusionne, { auteurId });
    }
    return { workspace: fusionne, fusionne: avant !== apres, empreinte: apres };
  }

  /** Nombre total d'abonnes — utile pour la supervision. */
  stats() {
    return {
      salles: this._salles.size,
      abonnes: [...this._salles.values()].reduce((n, s) => n + s.size, 0),
    };
  }

  /** Ferme tous les flux (arret propre du serveur). */
  fermerTout() {
    for (const salle of this._salles.values()) {
      for (const a of salle) { try { a.reply.raw.end(); } catch { /* deja ferme */ } }
    }
    this._salles.clear();
  }
}
