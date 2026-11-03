import { parse } from "yaml";

/**
 * Modèles de personas anonymes (personas/catalog/*.yaml), embarqués au build.
 * Un modèle ne désigne personne : il pré-remplit la fiche ; le nom, la source et le
 * consentement (ou les URLs publiques) restent saisis par l’opérateur, puis validés
 * par le serveur (POST /v1/console/impersonators) avec les garde-fous habituels.
 */
export interface PersonaTemplate {
  id: string;
  title: string;
  description: string;
  role: string;
  department: string;
  purpose: "idea_test" | "objection_rehearsal" | "pitch_review";
  veto: boolean;
  mission: string;
  clues: string[];
}

const PURPOSES = ["idea_test", "objection_rehearsal", "pitch_review"] as const;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Valide un modèle brut ; renvoie null s’il est inexploitable (ou s’il désigne une personne). */
export function toTemplate(raw: unknown): PersonaTemplate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const title = str(r.template_title);
  if (!id || !title || "name" in r) return null;
  const purpose = PURPOSES.includes(r.purpose as (typeof PURPOSES)[number]) ? (r.purpose as PersonaTemplate["purpose"]) : "idea_test";
  return {
    id,
    title,
    description: str(r.description),
    role: str(r.role),
    department: str(r.department),
    purpose,
    veto: r.veto_power !== false,
    mission: str(r.mission),
    clues: Array.isArray(r.clues) ? r.clues.map(str).filter(Boolean) : [],
  };
}

export function parseTemplates(files: Record<string, string>): PersonaTemplate[] {
  return Object.keys(files)
    .sort()
    .map((path) => {
      try { return toTemplate(parse(files[path])); } catch { return null; }
    })
    .filter((tpl): tpl is PersonaTemplate => tpl !== null);
}

const RAW = import.meta.glob("../../../../../personas/catalog/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const PERSONA_TEMPLATES: PersonaTemplate[] = parseTemplates(RAW);
