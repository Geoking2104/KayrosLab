import { create } from 'zustand';
import { createEngine } from '@core/index.mjs';
import { createCanvasStudio, buildMatrix, promote, causesToHypotheses } from '@core/canvas/index.mjs';
import { updateNode, addEdge, pinNode, getNode } from '@core/canvas/model.mjs';
import { api, modeDistant, setJeton, getJeton, ErreurApi } from './api.js';
import { TempsReel, appliquerDistant } from './realtime.js';

/**
 * Etat de l'application. DEUX MODES, une seule interface :
 *
 *   - local   : le coeur tourne dans le navigateur, rien ne sort (palier P0/P1) ;
 *   - distant : le backend detient les donnees et les cles (palier P2).
 *
 * Aucune logique metier n'est dupliquee : en local le studio du coeur fait le
 * travail, en distant le backend appelle exactement le meme code. Le frontend
 * n'est qu'une surface, dans les deux cas.
 */
const DISTANT = modeDistant();

const engine = createEngine({});          // mock hors ligne ; en distant, inutilise
const studioLocal = DISTANT ? null : createCanvasStudio(engine);

const WS = 'ws-local';

/** Convertit une erreur d'API en message lisible, sans avaler le motif. */
const message = (e) => (e instanceof ErreurApi
  ? `${e.message}${e.corps?.motif && e.corps.motif !== e.message ? ` — ${e.corps.motif}` : ''}`
  : e.message);

export const useCanvas = create((set, get) => ({
  engine, studio: studioLocal,
  distant: DISTANT,
  jeton: getJeton(),
  ws: null,
  wsId: WS,
  selection: null,
  notes: {},
  occupe: null,
  cout: null,
  flux: [],
  message: null,
  matriceDistante: null,
  tempsReel: null,
  presence: [],
  connecteTR: false,
  statutTR: null,

  /** Enveloppe commune : marque l'occupation et remonte les motifs de refus. */
  async _operation(libelle, fn) {
    set({ occupe: libelle });
    try { return await fn(); }
    catch (e) { set({ message: message(e) }); return null; }
    finally { set({ occupe: null }); }
  },

  async init(idCanvas = null) {
    const id = idCanvas ?? get().wsId;
    if (!DISTANT) {
      const ws = await studioLocal.create({ id, nom: "Session d'idéation", createdBy: 'local' });
      set({ ws, wsId: id });
      return;
    }
    if (!getJeton()) { set({ message: 'Jeton requis pour se connecter au backend.' }); return; }
    await get()._operation('Connexion', async () => {
      // On reprend le canvas existant s'il y en a un : le rechargement de page
      // ne doit pas repartir d'une page blanche.
      const { workspaces } = await api.listerCanvas();
      const existant = workspaces?.[0];
      if (existant) { set({ ws: existant, wsId: existant.id }); return; }
      const { workspace } = await api.creerCanvas({ nom: "Session d'idéation" });
      set({ ws: workspace, wsId: workspace.id });
    });
    get()._demarrerTempsReel();
  },

  /** EF-220 : s'abonner aux modifications des autres participants. */
  _demarrerTempsReel() {
    if (!DISTANT || get().tempsReel) return;
    const tr = new TempsReel({
      workspaceId: get().wsId,
      onEtat: (distant) => set((st) => ({ ws: appliquerDistant(st.ws, distant) })),
      onPresence: (p) => set({ presence: p }),
      onStatut: ({ connecte, motif }) => set({ connecteTR: connecte, statutTR: motif }),
    });
    tr.connecter();
    set({ tempsReel: tr });
  },

  connecter(t) { setJeton(t); set({ jeton: t, message: null }); get().init(); },
  deconnecter() {
    get().tempsReel?.fermer();
    setJeton('');
    set({ jeton: '', ws: null, tempsReel: null, presence: [], connecteTR: false });
  },

  async ajouterNoeud(titre, type = 'idee') {
    if (!titre?.trim()) return;
    const { wsId } = get();
    await get()._operation('Ajout', async () => {
      const ws = DISTANT
        ? (await api.ajouterNoeud(wsId, { titre, type })).workspace
        : await studioLocal.addNode(wsId, { titre, type });
      set({ ws, message: null });
    });
  },

  async majNoeud(id, patch) {
    const { wsId, ws } = get();
    if (DISTANT) {
      // Application optimiste : l'edition de texte doit rester fluide. Le
      // serveur fait foi, mais on n'attend pas l'aller-retour a chaque frappe.
      set({ ws: updateNode(ws, id, patch) });
      try { await api.majNoeud(wsId, id, patch); }
      catch (e) { set({ message: message(e), ws }); }
      return;
    }
    const next = updateNode(ws, id, patch);
    await studioLocal.repo.save(next);
    set({ ws: next });
  },

  async deplacer(id, x, y) { return get().majNoeud(id, { x: Math.round(x), y: Math.round(y) }); },

  async relier(from, to, relation = 'soutient') {
    const { wsId, ws } = get();
    await get()._operation(null, async () => {
      const next = DISTANT
        ? (await api.ajouterArete(wsId, { from, to, relation })).workspace
        : (await studioLocal.repo.save(addEdge(ws, { from, to, relation })));
      set({ ws: next, message: null });
    });
  },

  async epingler(id) {
    const { ws } = get();
    return get().majNoeud(id, { pinned: !getNode(ws, id).pinned });
  },

  async reclusteriser() {
    const { wsId, ws } = get();
    await get()._operation('Regroupement sémantique', async () => {
      const r = DISTANT
        ? await api.reclusteriser(wsId)
        : await studioLocal.recluster(wsId, { llm: engine.llm });
      set({
        ws: r.workspace,
        message: r.nonIndexes?.length ? `${r.nonIndexes.length} nœud(s) non vectorisé(s) — non regroupés` : null,
      });
    });
  },

  async swarm(noeudId, personaIds) {
    const { wsId } = get();
    set({ flux: [], cout: null });
    await get()._operation('Sparring en cours', async () => {
      // EF-230 : en distant on prefere le flux SSE, qui rend chaque persona
      // des qu'elle repond au lieu d'attendre les six.
      const tr = get().tempsReel;
      if (DISTANT && tr) {
        return new Promise((resolve) => {
          tr.swarmStreame(noeudId, personaIds, {
            onPersona: (p) => set((st) => ({
              flux: [...st.flux, { ok: p.ok, persona: { nom: p.persona }, verdict: p.verdict, erreur: p.erreur }],
              cout: p.cout ?? st.cout,
            })),
            onFin: (f) => { set({ cout: f.cout, message: f.echecs?.length ? `${f.echecs.length} persona(s) en échec` : null }); resolve(); },
            onErreur: (e) => { set({ message: e.motif }); resolve(); },
          });
        });
      }
      const r = DISTANT
        ? await api.swarm(wsId, noeudId, { personaIds })
        : await studioLocal.swarm(wsId, noeudId, {
            personaIds,
            onOutput: (s) => set((st) => ({ flux: [...st.flux, s], cout: s.cout ?? st.cout })),
          });
      set({
        ws: r.workspace, cout: r.cout,
        // En distant le flux n'est pas streame : on reconstitue l'essentiel
        // plutot que de laisser le panneau vide.
        flux: DISTANT
          ? [...(r.appuis ?? []).map((n) => ({ ok: true, persona: { nom: n }, verdict: 'soutient' })),
             ...(r.desaccords ?? []).map((n) => ({ ok: true, persona: { nom: n }, verdict: 'contredit' })),
             ...(r.echecs ?? []).map((x) => ({ ok: false, persona: { nom: x.persona }, erreur: x.erreur }))]
          : get().flux,
        message: r.echecs?.length ? `${r.echecs.length} persona(s) en échec` : null,
      });
    });
  },

  async framework(noeudId, nom) {
    const { wsId } = get();
    await get()._operation(nom, async () => {
      const r = DISTANT
        ? await api.framework(wsId, noeudId, { nom })
        : (nom === 'pre-mortem'
            ? await studioLocal.preMortem(wsId, noeudId)
            : await studioLocal.framework(wsId, noeudId, nom));
      set({ ws: r.workspace, message: r.echecs?.length ? `${r.echecs.length} transformation(s) en échec` : null });
    });
  },

  async ingerer(fichier) {
    const { wsId } = get();
    const contenu = await fichier.text();
    await get()._operation('Ingestion', async () => {
      // EF-209 : le plafond est verifie AVANT la lecture cote serveur aussi.
      const q = DISTANT ? await api.quota(wsId, contenu.length) : studioLocal.quota(wsId, contenu.length);
      if (q.depasserait) { set({ message: `Plafond dépassé : ${q.restant} caractères restants` }); return; }
      const r = DISTANT
        ? await api.ingerer(wsId, { nom: fichier.name, mime: fichier.type || 'text/plain', contenu })
        : await studioLocal.ingest(wsId, { nom: fichier.name, mime: fichier.type || 'text/plain', contenu });
      set({ message: r.ok ? `« ${r.doc.nom} » ingéré (${r.doc.chunks.length} fragments)` : r.motif });
    });
  },

  noter(id, champ, valeur) {
    set((st) => ({ notes: { ...st.notes, [id]: { ...st.notes[id], [champ]: valeur === '' ? undefined : Number(valeur) } } }));
    if (DISTANT) get()._rafraichirMatrice();
  },

  async _rafraichirMatrice() {
    const { wsId, notes } = get();
    try { set({ matriceDistante: await api.matrice(wsId, notes) }); } catch { /* la matrice n'est pas critique */ }
  },

  matrice() {
    const { ws, notes, distant, matriceDistante } = get();
    if (distant) return matriceDistante;
    return ws ? buildMatrix(ws, notes) : null;
  },

  async promouvoir(noeudId) {
    const { wsId, ws } = get();
    await get()._operation('Promotion', async () => {
      let idea; let traitement; let next = ws;
      if (DISTANT) {
        const r = await api.promouvoir(wsId, { nodeId: noeudId });
        idea = r.idea; traitement = r.traitement;
        next = (await api.lireCanvas(wsId)).workspace;
      } else {
        const r = promote(ws, { nodeId: noeudId, ideaId: `idee-${Date.now()}`, author: 'local' });
        await studioLocal.repo.save(r.workspace);
        idea = r.idea; traitement = r.traitement; next = r.workspace;
      }
      const angles = traitement.cibles.filter((c) => c.origine === 'angle_mort').length;
      set({ ws: next, message: `Idée « ${idea.title} » créée · ${traitement.hypotheses.length} hypothèse(s), ${angles} angle(s) mort(s)` });
    });
  },

  selectionner(id) { set({ selection: id }); },
  effacerMessage() { set({ message: null }); },
  causesToHypotheses,
}));
