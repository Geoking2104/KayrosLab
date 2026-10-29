import { useState } from "react";
import { api as http, type EnrichRequest, type EnrichResult, type EnrichedProfile } from "@/lib/console/api";
import { Button, Field, TextArea, controlClass } from "./ui";
import { t } from "@/lib/i18n";

const SECTION_LABELS: Record<string, string> = {
  communication: "Première impression",
  working_together: "Comportements",
  energizers: "Ce qui le motive",
  drainers: "Ce qui l’épuise",
  strengths: "Forces",
  blindspots: "Angles morts",
  building_trust: "Gagner sa confiance",
  driving_action: "Le faire passer à l’action",
  negotiating: "Négocier",
  following_up: "Relancer",
  emails: "Lui écrire",
};

/** Découpe un texte collé en e-mails (séparateur : ligne « --- »). */
export function splitEmails(raw: string): string[] {
  return raw.split(/\n-{3,}\s*\n/).map((x) => x.trim()).filter(Boolean);
}
/** Un post par ligne. */
export function splitPosts(raw: string): string[] {
  return raw.split("\n").map((x) => x.trim()).filter(Boolean);
}

async function readFiles(list: FileList | null): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of Array.from(list ?? [])) out[file.name] = await file.text();
  return out;
}

export function enrichedClue(profile: EnrichedProfile): string {
  const d = profile.descriptif ?? {};
  return [
    d.disc_type ? `DISC ${d.disc_type}${d.archetype ? ` · ${d.archetype}` : ""}` : "",
    d.qualities?.length ? d.qualities.join(", ") : "",
    d.overview ?? "",
  ].filter(Boolean).join(" · ").slice(0, 500);
}

/**
 * Panneau « Enrichir le profil » : page publique CrystalKnows, export LinkedIn,
 * e-mails écrits par la personne et posts X, fusionnés côté serveur.
 */
export function ProfileEnrich({
  live,
  name,
  crystalUrl = "",
  onResult,
}: {
  live: boolean;
  name: string;
  crystalUrl?: string;
  onResult: (result: EnrichResult) => void;
}) {
  const [url, setUrl] = useState(crystalUrl);
  const [linkedin, setLinkedin] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState("");
  const [author, setAuthor] = useState("");
  const [xUser, setXUser] = useState("");
  const [xPosts, setXPosts] = useState("");
  const [xArchive, setXArchive] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EnrichResult | null>(null);

  async function run() {
    setError("");
    if (!live) {
      setError(t("Connectez-vous à l’API : l’enrichissement est calculé par le serveur."));
      return;
    }
    const body: EnrichRequest = { assigned_name: name.trim() || undefined };
    if (url.trim()) body.crystal_public_url = url.trim();
    if (Object.keys(linkedin).length) body.linkedin_export = linkedin;
    if (emails.trim()) { body.emails = splitEmails(emails); if (author.trim()) body.email_address = author.trim(); }
    if (xUser.trim()) body.x_username = xUser.trim();
    if (xPosts.trim()) body.x_posts = splitPosts(xPosts);
    if (xArchive) body.x_archive = xArchive;
    setBusy(true);
    try {
      const next = await http.enrichProfile(body);
      setResult(next);
      onResult(next);
    } catch (e) {
      setError((e as Error).message || t("Refusé"));
    } finally {
      setBusy(false);
    }
  }

  const d = result?.profile.descriptif;
  return (
    <section className="grid gap-3 rounded-lg border border-line p-3" aria-label={t("Enrichir le profil")}>
      <h3 className="text-sm font-medium">{t("Enrichir le profil")}</h3>
      <Field label={t("Page publique CrystalKnows")} hint={t("Lue une fois, sans session. Un profil privé n’est pas récupérable.")}>
        <input className={controlClass} value={url} placeholder="https://www.crystalknows.com/p/…" onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label={t("Export LinkedIn (CSV)")} hint={t("Profile.csv, Positions.csv, Skills.csv de « Obtenir une copie de vos données ». LinkedIn n’est pas scrapé.")}>
        <input type="file" multiple accept=".csv" aria-label={t("Export LinkedIn (CSV)")} onChange={async (e) => setLinkedin(await readFiles(e.target.files))} />
      </Field>
      <Field label={t("E-mails écrits par la personne")} hint={t("Collez-les, séparés par une ligne ---. Citations et signatures sont retirées.")}>
        <TextArea value={emails} onChange={(e) => setEmails(e.target.value)} />
      </Field>
      <Field label={t("Adresse de l’auteur (optionnel)")}>
        <input className={controlClass} value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Field>
      <Field label={t("Compte X")} hint={t("Lu par l’API X officielle si le serveur a X_BEARER_TOKEN. Sinon, collez des posts ou l’archive.")}>
        <input className={controlClass} value={xUser} placeholder="@…" onChange={(e) => setXUser(e.target.value)} />
      </Field>
      <Field label={t("Posts X, un par ligne")}>
        <TextArea value={xPosts} onChange={(e) => setXPosts(e.target.value)} />
      </Field>
      <Field label={t("Archive X (tweets.js)")}>
        <input type="file" accept=".js,.json" aria-label={t("Archive X (tweets.js)")} onChange={async (e) => setXArchive((await e.target.files?.[0]?.text()) ?? "")} />
      </Field>
      <Button onClick={run} disabled={busy}>{busy ? t("Analyse…") : t("Construire le profil")}</Button>
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
      {result ? (
        <div className="grid gap-2 rounded-lg bg-paper p-3 text-sm" data-testid="enriched-profile">
          <div className="flex items-center gap-3">
            {result.profile.avatar_url ? <img src={result.profile.avatar_url} alt="" className="size-10 rounded-full" /> : null}
            <div>
              <p className="font-medium">{result.profile.assigned_name ?? name}</p>
              <p className="text-xs text-muted">
                {[d?.disc_type && `DISC ${d.disc_type}`, d?.archetype, result.estimate ? t("estimé ({{p}} %)", { p: Math.round(result.estimate.confidence * 100) }) : null].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          {d?.qualities?.length ? <p>{d.qualities.join(" · ")}</p> : null}
          {d?.overview ? <p className="text-muted">{d.overview}</p> : null}
          {Object.entries(SECTION_LABELS).map(([id, label]) => (d?.sections?.[id]?.length ? (
            <div key={id}>
              <p className="text-xs font-semibold uppercase tracking-[0.08em]">{t(label)}</p>
              <ul className="list-disc pl-5">{d.sections[id].slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null))}
          <p className="text-xs text-muted">{t("Sources : {{list}}", { list: result.evidence.map((e) => e.source).join(", ") })}</p>
          {result.warnings.map((w) => <p key={w} className="text-xs text-hold">{w}</p>)}
        </div>
      ) : null}
    </section>
  );
}
