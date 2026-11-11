import { useState } from "react";
import type { PersonaCompliance, PersonaComplianceSource } from "@/lib/console/model";
import { t } from "@/lib/i18n";

/** Initiales (deux au plus) d'un nom affiché. */
export function personaInitials(name: string): string {
  const parts = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return letters.toUpperCase();
}

/** Badge K KayrosLab (SVG) : signale une simulation, toujours rendu, jamais retirable. */
export function KBadge({ size }: { size: number }) {
  return (
    <svg
      data-testid="persona-k-badge"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="absolute"
      style={{ top: -Math.round(size * 0.2), right: -Math.round(size * 0.2) }}
    >
      <circle cx="12" cy="12" r="11" fill="#5b4cdb" stroke="#ffffff" strokeWidth="2" />
      <path d="M8.5 6.5v11M15.5 6.5 9 12l6.5 5.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Portrait (ou initiales) d'un agent personnifié, avec le badge K en haut à droite.
 * Cahier des charges v4 : badge non retirable (aucune prop pour le masquer), 40 % du
 * diamètre et au moins 12 px, libellé « Simulation KayrosLab de {nom} ».
 */
export function PersonaAvatar({ name, portraitUrl, size = 32 }: { name: string; portraitUrl?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const label = t("Simulation KayrosLab de {{name}}", { name });
  const badge = Math.max(12, Math.round(size * 0.4));
  const showImage = Boolean(portraitUrl) && !broken;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} data-testid="persona-avatar">
      {showImage ? (
        <img
          src={portraitUrl ?? undefined}
          alt={label}
          width={size}
          height={size}
          className="h-full w-full rounded-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          role="img"
          aria-label={label}
          className="grid h-full w-full place-items-center rounded-full font-semibold"
          style={{ background: "#eeecfb", color: "#3d2fb8", fontSize: Math.max(10, Math.round(size * 0.38)) }}
        >
          {personaInitials(name)}
        </span>
      )}
      <KBadge size={badge} />
    </span>
  );
}

/** Libellé « Simulation · Estimé » ou « Simulation · Vérifié par la personne » (jamais de pourcentage). */
export function PersonaComplianceLabel({ compliance }: { compliance: PersonaCompliance }) {
  const verified = compliance.verification_status === "verified";
  return (
    <span
      className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: "#eeecfb", color: "#3d2fb8" }}
      data-testid="persona-compliance-label"
    >
      {verified ? t("Simulation · Vérifié par la personne") : t("Simulation · Estimé")}
    </span>
  );
}

function sourceLabel(source: PersonaComplianceSource): string {
  if (source.type === "web") return t("Page publique");
  if (source.type === "email") return t("Textes fournis");
  if (source.type === "manual") return t("Saisie manuelle");
  return source.label;
}

/** Panneau « Contexte de l'agent » : sources de modélisation tracées (provenance, jamais de contenu). */
export function PersonaContextPanel({ compliance }: { compliance: PersonaCompliance }) {
  return (
    <section className="mt-4 rounded-lg border border-line p-3" aria-label={t("Contexte de l’agent")} data-testid="persona-context-panel">
      <h3 className="text-sm font-medium text-ink">{t("Contexte de l’agent")}</h3>
      <p className="mt-1 text-xs text-muted">
        {t("Base légale : intérêt légitime de l’espace (responsable de traitement). Profil estimé à partir de sources tracées ; ce n’est ni une prédiction ni un taux de précision.")}
      </p>
      {compliance.profile_sources.length ? (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {compliance.profile_sources.map((source, index) => (
            <li key={`${source.type}-${source.url ?? index}`} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{sourceLabel(source)}</span>
              {source.url ? <span className="break-all text-xs text-ink-soft">{source.url}</span> : null}
              {source.verified ? <span className="text-xs text-muted">{t("vérifié par la personne")}</span> : null}
              {source.type === "web" && source.visited === false ? <span className="text-xs text-muted">{t("non visitée")}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">{t("Aucune source tracée : saisie manuelle uniquement.")}</p>
      )}
    </section>
  );
}
