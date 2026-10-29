import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { useConsole } from "@/lib/console/store";
import type { MemberRole } from "@/lib/console/live";
import { MEMBER_ROLES } from "@/lib/console/roles";
import { Button, Empty, Section, controlClass } from "./ui";
import { go } from "./Shell";
import { t } from "@/lib/i18n";

/** Réglages → Membres : qui a accès à l’espace et avec quel rôle. */
export function Membres() {
  const { live, liveUser, workspace, saveItem, deleteItem, memberRole, permissions } = useConsole();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("contributeur");
  const [error, setError] = useState("");
  const canEdit = permissions.includes("members");
  if (!live) {
    return <Empty title={t("Membres")} body={t("Les membres et leurs rôles sont gérés côté API. Connectez-vous depuis Connexions.")} action={<Button onClick={() => go("connexions")}>{t("Se connecter à l’API")}</Button>} />;
  }
  const check = (res: { ok: boolean; reason?: string }) => { setError(res.ok ? "" : res.reason ?? t("Refusé")); return res.ok; };
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{t("Membres")}</h1>
        <p className="mt-1 text-sm text-muted">{t("Vous êtes {{e}} · rôle {{r}}.", { e: liveUser?.email ?? "", r: MEMBER_ROLES.find((r) => r.id === memberRole)?.label ?? memberRole })}</p>
      </div>
      <Section id="membres-roles" title={t("Rôles")} defaultOpen={false}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {MEMBER_ROLES.map((r) => <li key={r.id} className="rounded-lg border border-line p-3 text-sm"><span className="font-medium">{r.label}</span><span className="block text-xs text-muted">{r.hint}</span></li>)}
        </ul>
      </Section>
      <Section id="membres-liste" title={t("Membres de l’espace")} summary={t("{{n}} membres", { n: workspace.members.length })}>
        {workspace.members.length ? (
          <ul className="grid gap-2" data-testid="members">
            {workspace.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{m.name || m.email} <span className="text-muted">· {m.email}</span></span>
                <select aria-label={t("Rôle de {{v}}", { v: m.email })} disabled={!canEdit} className={`${controlClass} max-w-[160px]`} value={m.role} onChange={async (e) => check(await saveItem("members", m.id, { role: e.target.value }))}>
                  {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {canEdit ? <button type="button" aria-label={t("Retirer {{v}}", { v: m.email })} className="rounded p-1 text-muted hover:text-stop" onClick={async () => check(await deleteItem("members", m.id))}><Trash2 size={14} /></button> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">{t("Aucun membre déclaré : chaque compte garde le rôle de son inscription.")}</p>}
        {canEdit ? (
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim()) return;
            if (check(await saveItem("members", null, { email: email.trim(), name: name.trim(), role }))) { setEmail(""); setName(""); }
          }}>
            <input aria-label={t("E-mail du membre")} placeholder={t("E-mail")} type="email" className={`${controlClass} max-w-[240px]`} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input aria-label={t("Nom du membre")} placeholder={t("Nom")} className={`${controlClass} max-w-[200px]`} value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label={t("Rôle du nouveau membre")} className={`${controlClass} max-w-[160px]`} value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <Button type="submit"><UserPlus size={14} aria-hidden /> {t("Ajouter le membre")}</Button>
          </form>
        ) : <p className="mt-3 text-xs text-muted">{t("Seul un admin peut gérer les membres.")}</p>}
        {error ? <p className="mt-2 text-xs text-stop" role="alert">{error}</p> : null}
      </Section>
    </div>
  );
}
