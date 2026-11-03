import { useState } from "react";
import { t } from "@/lib/i18n";
import { api, type DesignerMessage, type DesignerTurn, type PersonaDraft } from "@/lib/console/api";
import { Button, Panel, TextArea } from "./ui";

/**
 * Création conversationnelle de persona (P4), sur le modèle « human-in-the-loop » de CopilotKit :
 * la conversation propose un brouillon (serveur, KayrosLLM.complete via le harness), puis une carte
 * d’approbation humaine affiche le brouillon et les cinq garde-fous. Rien n’est enregistré sans le
 * clic « Approuver et enregistrer », qui appelle uniquement POST /v1/console/impersonators.
 */
export function PersonaDesigner({
  onClose,
  onSaved,
  turn = (messages, draft) => api.designPersonaTurn({ messages, draft }),
  save = (draft) => api.createImpersonator({ ...draft }),
}: {
  onClose: () => void;
  onSaved?: (name: string) => void;
  turn?: (messages: DesignerMessage[], draft?: PersonaDraft) => Promise<DesignerTurn>;
  save?: (draft: PersonaDraft) => Promise<unknown>;
}) {
  const [messages, setMessages] = useState<DesignerMessage[]>([]);
  const [input, setInput] = useState("");
  const [proposal, setProposal] = useState<DesignerTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: DesignerMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setError("");
    try {
      const out = await turn(next, proposal?.draft);
      setMessages([...next, { role: "assistant", content: out.reply }]);
      setProposal(out);
    } catch (e: any) {
      setError(e?.message || t("Le concepteur est indisponible."));
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!proposal?.valid || busy) return;
    setBusy(true); setError("");
    try {
      await save(proposal.draft);
      setSaved(true);
      onSaved?.(proposal.draft.name);
    } catch (e: any) {
      setError(e?.message || t("Refusé"));
    } finally { setBusy(false); }
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium">{t("Concevoir une persona en conversation")}</h2>
      <p className="mt-1 text-sm text-muted">{t("Décrivez la persona (nom, fonction, URLs publiques). Un brouillon vous sera soumis pour approbation avant tout enregistrement.")}</p>
      <ol className="mt-3 flex flex-col gap-2" aria-label={t("Conversation")}>
        {messages.map((m, i) => (
          <li key={i} className={m.role === "user" ? "self-end rounded-lg bg-paper-2 px-3 py-2 text-sm" : "self-start rounded-lg border border-line px-3 py-2 text-sm"}>{m.content}</li>
        ))}
      </ol>
      <div className="mt-3 flex flex-col gap-2">
        <TextArea aria-label={t("Votre message")} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("Ex. : Persona : Alex Martin, CFO. https://exemple.com/alex")} />
        <div className="flex gap-2">
          <Button onClick={send} disabled={busy || !input.trim()}>{t("Envoyer")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Fermer")}</Button>
        </div>
      </div>
      {proposal ? (
        <section role="region" aria-label={t("Carte d’approbation")} className="mt-4 rounded-lg border border-line p-3">
          <h3 className="text-sm font-medium">{t("Carte d’approbation")}</h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            <dt>{t("Nom")}</dt><dd>{proposal.draft.name || "—"}</dd>
            <dt>{t("Fonction")}</dt><dd>{proposal.draft.role || "—"}</dd>
            <dt>{t("Source")}</dt><dd>{proposal.draft.source}</dd>
            <dt>{t("URLs publiques")}</dt><dd>{proposal.draft.public_sources.join(", ") || "—"}</dd>
          </dl>
          {proposal.guardrails.length ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-muted">{proposal.guardrails.map((g) => <li key={g.rule_id}>{g.rule_id}</li>)}</ul>
          ) : null}
          {proposal.issues.length ? <p className="mt-2 text-sm text-stop">{proposal.issues.join(" ; ")}</p> : null}
          {saved ? (
            <p className="mt-2 text-sm" role="status">{t("Persona enregistrée.")}</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button onClick={approve} disabled={!proposal.valid || busy}>{t("Approuver et enregistrer")}</Button>
              <Button variant="secondary" onClick={() => setProposal(null)}>{t("Rejeter le brouillon")}</Button>
            </div>
          )}
        </section>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm text-stop">{error}</p> : null}
    </Panel>
  );
}
