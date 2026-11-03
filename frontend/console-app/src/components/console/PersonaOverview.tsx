import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, type PersonaOverview as Overview } from "@/lib/console/api";
import { Button, Panel } from "./ui";

/** Page persona en lecture seule (P6) : activité, vetos, decisionsTimeline et mémoire. Aucune écriture. */
export function PersonaOverview({ agentId, onClose, load = (id) => api.personaOverview(id) }: {
  agentId: string; onClose: () => void; load?: (id: string) => Promise<Overview>;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let on = true; load(agentId).then((d) => on && setData(d), (e) => on && setError(String(e?.message || e))); return () => { on = false; }; }, [agentId]);
  const when = (v: string | null) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—");
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium">{t("Fiche persona (lecture seule)")}{data ? ` — ${data.persona.display_name ?? data.persona.agent_id}` : ""}</h2>
        <Button variant="secondary" onClick={onClose}>{t("Fermer")}</Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      {!data && !error ? <p className="mt-2 text-sm text-muted">{t("Chargement…")}</p> : null}
      {data ? (
        <div className="mt-3 grid gap-4 text-sm">
          <section>
            <h3 className="font-medium">{t("Activité")} ({data.counts.runs})</h3>
            {data.activity.length ? <ul className="mt-1 grid gap-1">{data.activity.map((a) => (
              <li key={a.run_id}>{when(a.at)} · <strong>{a.verdict}</strong> · {a.question}{a.primary_reason ? ` — ${a.primary_reason}` : ""}</li>
            ))}</ul> : <p className="text-muted">{t("Aucune activité.")}</p>}
          </section>
          <section>
            <h3 className="font-medium">{t("Vetos")} ({data.counts.vetoes})</h3>
            {data.vetoes.length ? <ul className="mt-1 grid gap-1">{data.vetoes.map((v) => <li key={v.run_id}>{when(v.at)} · {v.question}{v.reason ? ` — ${v.reason}` : ""}</li>)}</ul> : <p className="text-muted">{t("Aucun veto.")}</p>}
          </section>
          <section>
            <h3 className="font-medium">{t("Décisions humaines")} ({data.counts.decisions})</h3>
            {data.decisionsTimeline.length ? <ul className="mt-1 grid gap-1">{data.decisionsTimeline.map((d) => <li key={`${d.run_id}-${d.seq}`}>{when(d.ts)} · <strong>{d.decision}</strong> · {d.by}{d.reason ? ` — ${d.reason}` : ""}</li>)}</ul> : <p className="text-muted">{t("Aucune décision.")}</p>}
          </section>
          <section>
            <h3 className="font-medium">{t("Mémoire")}</h3>
            {data.memory.public_evidence.length ? <ul className="mt-1 grid gap-1">{data.memory.public_evidence.map((e) => <li key={e.url}><a className="underline" href={e.url} target="_blank" rel="noreferrer noopener">{e.title || e.url}</a> · {e.status ?? "—"} · {when(e.fetched_at)}</li>)}</ul> : <p className="text-muted">{t("Aucune source publique visitée.")}</p>}
            {data.memory.recent_reasons.length ? <ul className="mt-1 list-disc pl-5">{data.memory.recent_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
          </section>
        </div>
      ) : null}
    </Panel>
  );
}
