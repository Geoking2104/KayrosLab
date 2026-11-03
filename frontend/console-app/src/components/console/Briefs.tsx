import { useCallback, useEffect, useState } from "react";
import { useConsole } from "@/lib/console/store";
import { api } from "@/lib/console/api";
import { wordDiff } from "@/lib/console/word-diff";
import { Button } from "./ui";
import { StatusBadge } from "./ContextComposer";
import { t } from "@/lib/i18n";

/** Diff mot à mot : version validée → nouvelle reformulation. */
export function BriefDiff({ before, after }: { before: string; after: string }) {
  return (
    <p className="whitespace-pre-wrap rounded-md bg-paper p-2 text-sm" data-testid="brief-diff">
      {wordDiff(before, after).map((p, i) => p.op === "same" ? <span key={i}>{p.text}</span>
        : p.op === "add" ? <ins key={i} className="bg-go-soft text-go no-underline" data-op="add">{p.text}</ins>
        : <del key={i} className="bg-stop-soft text-stop" data-op="del">{p.text}</del>)}
    </p>
  );
}

type Loaded = { validated: any[]; pending: any[] };

/**
 * Briefs avant lancement (Projets → Enchaînement, Instruct) : sources validées injectées,
 * brouillons non injectés. Reformuler → diff avec la version validée → valider ; invalider.
 */
export function BriefsPanel({ load }: { load: () => Promise<Loaded> }) {
  const { refreshLive } = useConsole();
  const [data, setData] = useState<Loaded>({ validated: [], pending: [] });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Record<string, { brief: string; structured: Record<string, string> }>>({});
  const reload = useCallback(() => load().then(setData).catch(() => setData({ validated: [], pending: [] })), [load]);
  useEffect(() => { void reload(); }, [reload]);
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setError("");
    try { await fn(); await reload(); await refreshLive?.(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };
  const rephrase = (c: any) => act(c.id, async () => {
    const r = await api.rephraseContext({ type: c.mode === "interne" ? "interne" : "rfp", raw: c.raw_input || c.content, fields: c.structured || {} });
    if (r.source !== "model") throw new Error(t("Reformulation indisponible : votre brouillon est conservé, relisez-le avant de valider."));
    setProposal((p) => ({ ...p, [c.id]: { brief: r.brief, structured: r.structured } }));
  });
  const acceptProposal = (c: any) => act(c.id, async () => {
    const p = proposal[c.id];
    await api.patchContext(c.id, { content: p.brief, structured: p.structured, status: "validated" });
    setProposal((x) => { const { [c.id]: _drop, ...rest } = x; return rest; });
  });
  if (!data.validated.length && !data.pending.length) return null;
  return (
    <div className="mb-3 rounded-lg border border-line p-3" data-testid="prelaunch-briefs">
      <p className="text-sm font-medium">{t("Briefs transmis aux collectifs")}</p>
      <ul className="mt-1 grid gap-1 text-sm">
        {data.validated.map((c) => (
          <li key={c.id} className="flex items-baseline gap-2">
            <StatusBadge status="validated" /><span className="font-medium">{c.name}</span>
            <span className="min-w-0 flex-1 truncate text-ink-soft" title={c.content}>{String(c.content || "").slice(0, 160)}</span>
            {c.mode ? <Button variant="ghost" disabled={busy === c.id} onClick={() => void act(c.id, () => api.invalidateContext(c.id, t("invalidation manuelle")))}>{t("Invalider")}</Button> : null}
          </li>
        ))}
      </ul>
      {data.pending.length ? (
        <>
          <p className="mt-2 text-xs text-hold">{t("Non transmis tant qu’ils ne sont pas validés :")}</p>
          <ul className="mt-1 grid gap-2 text-sm">
            {data.pending.map((c) => (
              <li key={c.id} className="grid gap-1" data-testid="pending-brief">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status="draft" /><span className="font-medium">{c.name}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft" title={c.content}>{String(c.content || c.raw_input || "").slice(0, 160)}</span>
                  <Button variant="secondary" disabled={busy === c.id} onClick={() => void rephrase(c)}>{t("Reformuler à nouveau")}</Button>
                  <Button disabled={busy === c.id || !String(c.content || "").trim()} onClick={() => void act(c.id, () => api.patchContext(c.id, { status: "validated" }))}>{t("Valider")}</Button>
                </div>
                {c.invalidated_reason ? <p className="text-xs text-muted" data-testid="invalidated-reason">{t("Repassé en brouillon : {{r}}", { r: c.invalidated_reason })}</p> : null}
                {proposal[c.id] ? (
                  <div className="grid gap-1">
                    <p className="text-xs text-muted">{t("Version validée → nouvelle reformulation")}</p>
                    <BriefDiff before={c.validated_content || c.content || ""} after={proposal[c.id].brief} />
                    <div className="flex gap-2">
                      <Button disabled={busy === c.id} onClick={() => void acceptProposal(c)}>{t("Valider la nouvelle version")}</Button>
                      <Button variant="ghost" onClick={() => setProposal((x) => { const { [c.id]: _drop, ...rest } = x; return rest; })}>{t("Écarter")}</Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
    </div>
  );
}

/** Briefs d’un collectif (écran Instruct). */
export function SessionBriefs({ sessionId }: { sessionId: string }) {
  const load = useCallback(() => api.sessionBriefs(sessionId), [sessionId]);
  return <BriefsPanel load={load} />;
}
