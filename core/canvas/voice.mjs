// KayrosLab — Canvas : voix vers noeuds.
// EF-204 (transcription segmentee en noeuds de concept), EF-205 (local ou rien).

import { createNode } from './model.mjs';

/**
 * EF-205 : la transcription doit etre LOCALE au palier souverain.
 *
 * Le moteur est injecte (whisper.cpp cote backend, WebGPU cote navigateur) :
 * le coeur ne transcrit pas, il decide si transcrire est permis et met en
 * forme le resultat. Si aucun moteur local n'est disponible en palier `local`,
 * la fonction est DESACTIVEE — jamais basculee en silence vers le cloud.
 */
export class VoiceService {
  /**
   * @param {{transcriber?:{local:boolean, transcribe:Function}, sovereignty?:'cloud'|'local'}} opts
   */
  constructor({ transcriber = null, sovereignty = 'cloud' } = {}) {
    this.transcriber = transcriber;
    this.sovereignty = sovereignty;
  }

  /** Etat de la fonction, consultable par l'interface pour griser le bouton. */
  disponibilite() {
    if (!this.transcriber) return { disponible: false, motif: 'aucun moteur de transcription branche' };
    if (this.sovereignty === 'local' && !this.transcriber.local) {
      return { disponible: false, motif: 'palier souverain actif et moteur non local — fonction desactivee' };
    }
    return { disponible: true, motif: null, local: Boolean(this.transcriber.local) };
  }

  /** @returns {Promise<{ok:boolean, texte?:string, motif?:string}>} */
  async transcrire(audio, { langue = 'fr' } = {}) {
    const d = this.disponibilite();
    if (!d.disponible) return { ok: false, motif: d.motif };
    try {
      const r = await this.transcriber.transcribe(audio, { langue });
      const texte = String(r?.texte ?? r ?? '').trim();
      if (!texte) return { ok: false, motif: 'transcription vide' };
      return { ok: true, texte, local: d.local };
    } catch (e) {
      return { ok: false, motif: `echec de transcription : ${e.message}` };
    }
  }
}

/**
 * EF-204 : segmente une transcription en NOEUDS DE CONCEPT formates.
 *
 * Une transcription brute deversee dans un seul noeud ne vaut rien : l'interet
 * est de transformer un monologue en concepts manipulables. La segmentation
 * suit les marqueurs de rupture du discours parle, puis les phrases.
 */
const RUPTURES = /\b(ensuite|par ailleurs|autre (?:idee|point|chose)|deuxiemement|troisiemement|premierement|en revanche|sinon|et puis|autre sujet)\b/gi;

export function segmenterTranscription(texte, { minLongueur = 25, max = 25 } = {}) {
  const t = String(texte ?? '').trim();
  if (!t) return [];

  // 1er niveau : marqueurs explicites de changement de sujet.
  let blocs = t.split(RUPTURES).filter((x) => x && !RUPTURES.test(x)).map((x) => x.trim()).filter(Boolean);
  RUPTURES.lastIndex = 0;
  if (blocs.length <= 1) {
    // 2e niveau : groupes de phrases.
    const phrases = t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    blocs = [];
    for (let i = 0; i < phrases.length; i += 2) blocs.push(phrases.slice(i, i + 2).join(' '));
  }

  return blocs
    .filter((b) => b.length >= minLongueur)
    .slice(0, max)
    .map((b, i) => {
      const phrases = b.split(/(?<=[.!?])\s+/).filter(Boolean);
      const titre = (phrases[0] ?? b).replace(/[.!?]+$/, '').slice(0, 90);
      const puces = phrases.slice(1).map((p) => `- ${p.trim()}`);
      return { index: i, titre, corps: puces.join('\n'), brut: b };
    });
}

/** Convertit une transcription en noeuds prets a etre ajoutes au canvas. */
export function transcriptionVersNoeuds(texte, { authorId = 'voix', type = 'idee', provenance = null } = {}) {
  return segmenterTranscription(texte).map((s) => createNode({
    type, titre: s.titre, corps: s.corps,
    authorId, authorKind: 'human',   // la voix est celle d'un humain, pas d'un agent
    // La transcription est une source : elle est tracee comme telle (EF-201).
    provenance: provenance ?? { url: null, sourceDocId: null, origine: 'transcription' },
    meta: { origine: 'voix', segment: s.index },
  }));
}
