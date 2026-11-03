import { useEffect, useState } from "react";
import { api as http, type EnrichProviders, type EnrichRequest, type EnrichResult, type EnrichedProfile, type PersonaConfidence, type SpeakResult } from "@/lib/console/api";
import { Button, Field, TextArea, controlClass } from "./ui";
import { cn } from "@/lib/cn";
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

type Step = "crystal" | "linkedin" | "x" | "emails" | "result";
const STEPS: { id: Step; label: string }[] = [
  { id: "crystal", get label() { return t("1. CrystalKnows"); } },
  { id: "linkedin", get label() { return t("2. LinkedIn"); } },
  { id: "x", get label() { return t("3. X"); } },
  { id: "emails", get label() { return t("4. E-mails"); } },
  { id: "result", get label() { return t("5. Profil"); } },
];

export type ParsedEmail = { from?: string; body: string };
const HEADER = /^(de|from)\s*:\s*(.+)$/i;
/**
 * Découpe un texte collé en e-mails : une ligne « --- » ou un en-tête « De : » / « From: »
 * ouvre un nouveau message ; l’expéditeur est conservé pour ne garder que ceux de la personne.
 */
export function splitEmails(raw: string): ParsedEmail[] {
  const out: ParsedEmail[] = [];
  let cur: ParsedEmail = { body: "" };
  const flush = () => { if (cur.body.trim()) out.push({ ...cur, body: cur.body.trim() }); cur = { body: "" }; };
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    if (/^-{3,}\s*$/.test(line)) { flush(); continue; }
    const head = line.match(HEADER);
    if (head && !/^\s*>/.test(line)) { flush(); cur.from = head[2].trim(); continue; }
    if (/^(objet|subject|à|to|date|envoyé|sent)\s*:/i.test(line) && !cur.body.trim()) continue;
    cur.body += `${line}\n`;
  }
  flush();
  return out;
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

/** Badge de provenance du DISC : CrystalKnows réel, estimation plafonnée ou saisie. */
export function ConfidenceBadge({ confidence }: { confidence: PersonaConfidence }) {
  const tone = confidence.kind === "crystalknows" ? "bg-accent-soft text-go" : confidence.kind === "estimate" ? "bg-paper text-hold" : "bg-paper text-muted";
  return <span data-testid="confidence" data-kind={confidence.kind} className={cn("inline-block rounded-full px-2 py-0.5 text-xs", tone)}>{confidence.label}</span>;
}

/** Aperçu « ainsi je parlerais » avant d’entrer dans un collectif. */
export function SpeakPreview({ live, profile, agentId }: { live: boolean; profile?: unknown; agentId?: string }) {
  const [idea, setIdea] = useState("");
  const [said, setSaid] = useState<SpeakResult | null>(null);
  const [error, setError] = useState("");
  async function go() {
    setError("");
    if (!live) { setError(t("Connectez-vous à l’API : l’enrichissement est calculé par le serveur.")); return; }
    try { setSaid(await http.speak({ idea: idea.trim() || t("cette proposition"), ...(agentId ? { agent_id: agentId } : { human_profile: profile }) })); }
    catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="grid gap-2" data-testid="speak-preview">
      <Field label={t("Ainsi je parlerais — idée à tester")}>
        <input className={controlClass} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={t("Ex. lancer une offre premium")} />
      </Field>
      <Button variant="ghost" onClick={go}>{t("Écouter la persona")}</Button>
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
      {said ? (
        <blockquote data-testid="speak" className="rounded-lg border border-line p-3 text-sm">
          <p>{said.message}</p>
          <p className="mt-1 text-xs text-muted">{said.notice}</p>
          {said.source ? <p className="mt-1 text-xs text-muted" data-testid="speak-source">{said.source === "model"
            ? t("Réplique du modèle ({{provider}}).", { provider: said.model_provider ?? "?" })
            : t("Aperçu déterministe (modèle absent ou réplique infidèle).")}</p> : null}
        </blockquote>
      ) : null}
    </div>
  );
}

/**
 * Assistant d’import en 5 étapes : CrystalKnows (page publique, export JSON ou API),
 * export LinkedIn, X, e-mails, puis fiche + aperçu de voix. `agentId` : ré-enrichissement.
 */
export function ProfileEnrich({
  live,
  name,
  crystalUrl = "",
  agentId,
  onResult,
  enrich,
}: {
  live: boolean;
  name: string;
  crystalUrl?: string;
  agentId?: string;
  onResult: (result: EnrichResult) => void;
  /** Surcharge (ré-enrichissement via le store). */
  enrich?: (body: EnrichRequest) => Promise<EnrichResult>;
}) {
  const [step, setStep] = useState<Step>("crystal");
  const [crystalMode, setCrystalMode] = useState<"public" | "html" | "export" | "api">("public");
  const [url, setUrl] = useState(crystalUrl);
  const [pageHtml, setPageHtml] = useState("");
  const [exportJson, setExportJson] = useState("");
  const [apiEmail, setApiEmail] = useState("");
  const [linkedin, setLinkedin] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState("");
  const [author, setAuthor] = useState("");
  const [xUser, setXUser] = useState("");
  const [xPosts, setXPosts] = useState("");
  const [xArchive, setXArchive] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [gmailToken, setGmailToken] = useState("");
  const [outlookToken, setOutlookToken] = useState("");
  const [providers, setProviders] = useState<EnrichProviders | null>(null);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    http.personalityProviders?.().then((p) => { if (alive) setProviders(p); }).catch(() => {});
    return () => { alive = false; };
  }, [live]);

  const parsed = splitEmails(emails);
  const kept = author.trim() ? parsed.filter((m) => !m.from || m.from.toLowerCase().includes(author.trim().toLowerCase())) : parsed;

  function body(): EnrichRequest | string {
    const out: EnrichRequest = { assigned_name: name.trim() || undefined };
    if (crystalMode === "public" && url.trim()) out.crystal_public_url = url.trim();
    if (crystalMode === "html" && pageHtml.trim()) out.crystal_public_html = pageHtml;
    if (crystalMode === "export" && exportJson.trim()) {
      try { out.crystal_export = JSON.parse(exportJson); } catch { return t("Export JSON CrystalKnows illisible."); }
    }
    if (crystalMode === "api" && apiEmail.trim()) out.crystal_api = { email: apiEmail.trim() };
    if (Object.keys(linkedin).length) out.linkedin_export = linkedin;
    if (parsed.length) { out.emails = parsed.map((m) => (m.from ? { from: m.from, body: m.body } : m.body)); if (author.trim()) out.email_address = author.trim(); }
    if (xUser.trim()) out.x_username = xUser.trim();
    if (xPosts.trim()) out.x_posts = splitPosts(xPosts);
    if (xArchive) out.x_archive = xArchive;
    if (gmailToken.trim()) out.gmail = { access_token: gmailToken.trim() };
    if (outlookToken.trim()) out.outlook = { access_token: outlookToken.trim() };
    if ((gmailToken.trim() || outlookToken.trim()) && author.trim()) out.email_address = author.trim();
    return out;
  }

  async function run() {
    setError("");
    if (!live) { setError(t("Connectez-vous à l’API : l’enrichissement est calculé par le serveur.")); return; }
    const b = body();
    if (typeof b === "string") { setError(b); return; }
    setBusy(true);
    try {
      const next = enrich ? await enrich(b) : await http.enrichProfile(b);
      setResult(next);
      setStep("result");
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
      <h3 className="text-sm font-medium">{agentId ? t("Ré-enrichir le profil") : t("Enrichir le profil")}</h3>
      <nav className="flex flex-wrap gap-1" role="tablist">
        {STEPS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={step === s.id}
            className={cn("rounded-full px-2.5 py-1 text-xs", step === s.id ? "bg-accent-soft font-medium" : "text-muted")}
            onClick={() => setStep(s.id)}>{s.label}</button>
        ))}
      </nav>

      {step === "crystal" ? (
        <div className="grid gap-3">
          <Field label={t("Mode CrystalKnows")}>
            <select className={controlClass} value={crystalMode} onChange={(e) => setCrystalMode(e.target.value as typeof crystalMode)}>
              <option value="public">{t("Page publique (/p/…)")}</option>
              <option value="html">{t("Page enregistrée (HTML collé)")}</option>
              <option value="export">{t("Profil privé : export JSON")}</option>
              <option value="api">{t("Profil privé : API (CRYSTALKNOWS_API_TOKEN)")}</option>
            </select>
          </Field>
          {crystalMode === "public" ? (
            <Field label={t("Page publique CrystalKnows")} hint={t("Lue une fois, sans session. Un profil privé n’est pas récupérable.")}>
              <input className={controlClass} value={url} placeholder="https://www.crystalknows.com/p/…" onChange={(e) => setUrl(e.target.value)} />
            </Field>
          ) : crystalMode === "html" ? (
            <Field label={t("Code source de la page")} hint={t("Enregistrez la page publique puis collez son HTML. Aucun appel réseau.")}>
              <TextArea value={pageHtml} onChange={(e) => setPageHtml(e.target.value)} />
            </Field>
          ) : crystalMode === "export" ? (
            <Field label={t("Export JSON CrystalKnows")} hint={t("Fichier exporté par la personne depuis son compte CrystalKnows.")}>
              <TextArea value={exportJson} onChange={(e) => setExportJson(e.target.value)} />
            </Field>
          ) : (
            <>
              {providers ? <p className={cn("text-xs", providers.crystalknows_api.ready ? "text-muted" : "text-hold")} data-testid="ready-crystal">{providers.crystalknows_api.ready ? t("Jeton serveur CrystalKnows configuré.") : t("CRYSTALKNOWS_API_TOKEN absent côté serveur : ce mode sera refusé.")}</p> : null}
              <Field label={t("E-mail de la personne")} hint={t("API CrystalKnows v4 : jeton serveur CRYSTALKNOWS_API_TOKEN requis, consomme des crédits.")}>
                <input className={controlClass} value={apiEmail} onChange={(e) => setApiEmail(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      ) : null}

      {step === "linkedin" ? (
        <div className="grid gap-2 text-sm">
          <ol className="list-decimal pl-5 text-ink-soft">
            <li>{t("La personne ouvre LinkedIn → Préférences → Confidentialité des données → Obtenir une copie de vos données.")}</li>
            <li>{t("Elle choisit « Profil », « Postes » et « Compétences », puis télécharge l’archive.")}</li>
            <li>{t("Déposez ici Profile.csv, Positions.csv et Skills.csv.")}</li>
          </ol>
          <Field label={t("Export LinkedIn (CSV)")} hint={t("LinkedIn n’est jamais scrapé.")}>
            <input type="file" multiple accept=".csv" aria-label={t("Export LinkedIn (CSV)")} onChange={async (e) => setLinkedin(await readFiles(e.target.files))} />
          </Field>
          {Object.keys(linkedin).length ? <p className="text-xs text-muted">{Object.keys(linkedin).join(", ")}</p> : null}
        </div>
      ) : null}

      {step === "x" ? (
        <div className="grid gap-3">
          {providers && !providers.x_api.ready ? <p className="text-xs text-hold" data-testid="ready-x">{t("X_BEARER_TOKEN absent côté serveur : le compte seul sera refusé ; collez des posts ou l’archive.")}</p> : null}
          <Field label={t("Compte X")} hint={t("Lu par l’API X officielle si le serveur a X_BEARER_TOKEN. Sinon, collez des posts ou l’archive.")}>
            <input className={controlClass} value={xUser} placeholder="@…" onChange={(e) => setXUser(e.target.value)} />
          </Field>
          <Field label={t("Posts X, un par ligne")}>
            <TextArea value={xPosts} onChange={(e) => setXPosts(e.target.value)} />
          </Field>
          <Field label={t("Archive X (tweets.js)")} hint={t("Paramètres X → Votre compte → Télécharger une archive.")}>
            <input type="file" accept=".js,.json" aria-label={t("Archive X (tweets.js)")} onChange={async (e) => setXArchive((await e.target.files?.[0]?.text()) ?? "")} />
          </Field>
        </div>
      ) : null}

      {step === "emails" ? (
        <div className="grid gap-3">
          <Field label={t("E-mails écrits par la personne")} hint={t("Collez un fil entier : chaque « De : » ou ligne --- ouvre un message. Citations et signatures sont retirées.")}>
            <TextArea value={emails} onChange={(e) => setEmails(e.target.value)} />
          </Field>
          <details className="rounded-lg border border-line p-2 text-sm">
            <summary>{t("Importer depuis Gmail ou Outlook (sans copier-coller)")}</summary>
            <p className="mt-2 text-xs text-muted">{t("Jeton OAuth lecture seule de la personne (Gmail : gmail.readonly ; Outlook : Mail.Read). Seuls les messages envoyés sont lus ; le jeton sert à cette requête et n’est pas enregistré.")}</p>
            <Field label={t("Jeton Gmail")}>
              <input type="password" autoComplete="off" className={controlClass} value={gmailToken} onChange={(e) => setGmailToken(e.target.value)} />
            </Field>
            <Field label={t("Jeton Outlook")}>
              <input type="password" autoComplete="off" className={controlClass} value={outlookToken} onChange={(e) => setOutlookToken(e.target.value)} />
            </Field>
          </details>
          <Field label={t("Adresse de l’auteur (optionnel)")}>
            <input className={controlClass} value={author} onChange={(e) => setAuthor(e.target.value)} />
          </Field>
          {parsed.length ? <p className="text-xs text-muted" data-testid="email-count">{t("{{kept}} message(s) de la personne sur {{total}}", { kept: kept.length, total: parsed.length })}</p> : null}
        </div>
      ) : null}

      {step === "result" && result ? (
        <div className="grid gap-2 rounded-lg bg-paper p-3 text-sm" data-testid="enriched-profile">
          <div className="flex items-center gap-3">
            {result.profile.avatar_url ? <img src={result.profile.avatar_url} alt="" className="size-10 rounded-full" /> : null}
            <div>
              <p className="font-medium">{result.profile.assigned_name ?? name}</p>
              <p className="text-xs text-muted">{[d?.disc_type && `DISC ${d.disc_type}`, d?.archetype].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          {result.confidence ? <ConfidenceBadge confidence={result.confidence} /> : null}
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
          <SpeakPreview live={live} profile={result.profile} />
        </div>
      ) : step === "result" ? <p className="text-sm text-muted">{t("Renseignez au moins une source, puis construisez le profil.")}</p> : null}

      <Button onClick={run} disabled={busy}>{busy ? t("Analyse…") : t("Construire le profil")}</Button>
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
    </section>
  );
}
