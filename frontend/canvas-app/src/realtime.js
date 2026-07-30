/**
 * Client temps reel (EF-220 / EF-221 / EF-230).
 *
 * `EventSource` ne porte pas d'en-tete personnalise : le jeton passe en
 * parametre de requete. C'est une contrainte du standard, assumee et limitee au
 * strict necessaire — aucune autre route ne procede ainsi.
 */

import { mergeWorkspaces, empreinte } from '@core/canvas/index.mjs';
import { getJeton } from './api.js';

const RACINE = import.meta.env.VITE_BACKEND_URL ?? '';

export class TempsReel {
  /**
   * @param {{workspaceId:string, onEtat:Function, onPresence:Function, onStatut:Function}} o
   */
  constructor({ workspaceId, onEtat, onPresence, onStatut }) {
    this.workspaceId = workspaceId;
    this.onEtat = onEtat;
    this.onPresence = onPresence;
    this.onStatut = onStatut ?? (() => {});
    this.source = null;
    this.abonneId = null;
    this._tentatives = 0;
    this._arrete = false;
  }

  connecter() {
    this._arrete = false;
    const url = `${RACINE}/v1/canvas/${this.workspaceId}/stream?token=${encodeURIComponent(getJeton())}`;
    this.source = new EventSource(url);

    this.source.addEventListener('bienvenue', (e) => {
      const d = JSON.parse(e.data);
      this.abonneId = d.abonneId;
      this._tentatives = 0;
      this.onPresence?.(d.presence);
      this.onStatut({ connecte: true, motif: null });
    });

    this.source.addEventListener('etat', (e) => this.onEtat?.(JSON.parse(e.data)));
    this.source.addEventListener('presence', (e) => this.onPresence?.(JSON.parse(e.data)));

    this.source.onerror = () => {
      if (this._arrete) return;
      this.source?.close();
      // Reconnexion a intervalle croissant, plafonnee : marteler un serveur
      // en difficulte ne le fait pas revenir plus vite.
      this._tentatives += 1;
      const delai = Math.min(1000 * 2 ** (this._tentatives - 1), 30_000);
      this.onStatut({ connecte: false, motif: `reconnexion dans ${Math.round(delai / 1000)} s` });
      setTimeout(() => { if (!this._arrete) this.connecter(); }, delai);
    };
  }

  fermer() {
    this._arrete = true;
    this.source?.close();
    this.source = null;
    this.onStatut({ connecte: false, motif: null });
  }

  /**
   * EF-221 : pousse l'etat local complet et recupere la fusion.
   * On envoie l'ETAT, pas une liste d'operations : rejouer des operations sur
   * un etat qui a change entre-temps est la source classique de perte.
   */
  async synchroniser(workspace) {
    const res = await fetch(`${RACINE}/v1/canvas/${this.workspaceId}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getJeton()}` },
      body: JSON.stringify({ workspace, abonneId: this.abonneId }),
    });
    if (!res.ok) throw new Error(`synchronisation refusée (${res.status})`);
    return res.json();
  }

  /** EF-230 : swarm streame. Renvoie une fonction d'interruption. */
  swarmStreame(nodeId, personaIds, { onPersona, onFin, onErreur }) {
    const p = personaIds?.length ? `&personaIds=${encodeURIComponent(personaIds.join(','))}` : '';
    const src = new EventSource(
      `${RACINE}/v1/canvas/${this.workspaceId}/nodes/${nodeId}/swarm/stream?token=${encodeURIComponent(getJeton())}${p}`,
    );
    src.addEventListener('persona', (e) => onPersona?.(JSON.parse(e.data)));
    src.addEventListener('fin', (e) => { onFin?.(JSON.parse(e.data)); src.close(); });
    src.addEventListener('erreur', (e) => { onErreur?.(JSON.parse(e.data)); src.close(); });
    src.onerror = () => { src.close(); };
    return () => src.close();
  }
}

/**
 * Fusionne un etat distant avec l'etat local.
 * Le CRDT du coeur fait le travail : le frontend ne reimplemente aucune regle
 * de resolution, il applique la meme que le serveur.
 */
export function appliquerDistant(local, distant) {
  if (!local) return distant;
  // L'historique local est conserve : le snapshot reseau ne le transporte pas.
  const fusionne = mergeWorkspaces({ ...distant, history: local.history }, local);
  return empreinte(fusionne) === empreinte(local) ? local : fusionne;
}
