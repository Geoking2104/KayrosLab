/**
 * Abstraction du moteur de rendu (CDC §5, risque R1).
 *
 * React Flow plafonne autour de 1 000-1 500 noeuds. Cette interface existe
 * pour que la bascule vers Konva ou PixiJS soit un remplacement de module et
 * non une reecriture de l'application. Aucun composant applicatif ne doit
 * importer `@xyflow/react` directement : tout passe par un renderer.
 *
 * Contrat :
 *   render({ nodes, edges, selection, onSelect, onMove, onConnect, onEdit })
 *   capabilities() -> { maxNoeudsConseille, nom }
 */
export class CanvasRenderer {
  static get nom() { return 'abstrait'; }
  static capabilities() { return { nom: 'abstrait', maxNoeudsConseille: 0 }; }
}

/** Seuil au-dela duquel on alerte plutot que de laisser l'interface ramer. */
export const SEUIL_ALERTE_NOEUDS = 1200;
