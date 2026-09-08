import { Check, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKayros } from "@/lib/kayros/store";
import { Kicker, Panel, Pill, t } from "./bits";

function StepMark({ done }: { done: boolean }) {
  return done ? (
    <Check className="size-4 text-positive" strokeWidth={2} />
  ) : (
    <Circle className="size-4 text-faint" strokeWidth={1.75} />
  );
}

export function GuideView() {
  const locale = useKayros((s) => s.locale);
  const tenant = useKayros((s) => s.tenantName);
  const setTenant = useKayros((s) => s.setTenant);
  const swarms = useKayros((s) => s.swarms);
  const agents = useKayros((s) => s.agents);
  const ideas = useKayros((s) => s.ideas);
  const cycle = useKayros((s) => s.cycle);
  const gates = useKayros((s) => s.gates);
  const addIdea = useKayros((s) => s.addIdea);
  const startCycle = useKayros((s) => s.startCycle);
  const setView = useKayros((s) => s.setView);
  const dismissGuide = useKayros((s) => s.dismissGuide);
  const runSwarm = useKayros((s) => s.runSwarm);

  const step1 = tenant.trim().length > 3;
  const step2 = swarms.some((s) => s.agentIds.length >= 2);
  const step3 = ideas.length > 0;
  const step4 = Boolean(cycle);
  const step5 = gates.some((g) => g.status === "resolved") || swarms.some((s) => s.lastRun?.human);
  const doneCount = [step1, step2, step3, step4, step5].filter(Boolean).length;
  const enabled = agents.filter((a) => a.enabled).length;

  const steps = [
    {
      n: "01",
      done: step1,
      fr: "Ouvrir l'atelier",
      en: "Open the workspace",
      bodyFr:
        "Chez Multica on se connecte. Ici l'atelier est local : nommez le tenant. Pas de compte, pas de daemon — le poste tient dans ce navigateur.",
      bodyEn:
        "Multica starts with sign-in. Here the workspace is local: name the tenant. No account, no daemon — the desk lives in this browser.",
      action: (
        <input
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
          className="h-10 w-full max-w-sm rounded-md border border-line bg-paper px-3 text-sm"
          suppressHydrationWarning
        />
      ),
    },
    {
      n: "02",
      done: step2,
      fr: "Composer un essaim",
      en: "Compose a swarm",
      bodyFr:
        "Multica connecte un ordinateur (runtime). KayrosLab connecte un essaim : des agents de rôle, un seuil de vote, un veto. Trois essaims sont déjà semés — Comex, Cycle 8, Boucle KPI.",
      bodyEn:
        "Multica connects a computer (runtime). KayrosLab connects a swarm: role-bound agents, a voting threshold, a veto. Three swarms are seeded — Comex, Cycle 8, KPI loop.",
      action: (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setView("swarms")}>
            {t(locale, "Ouvrir les essaims", "Open swarms")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => runSwarm("swarm-comex", t(locale, "Peut-on GO ce vendredi ?", "Can we GO this Friday?"))}
          >
            {t(locale, "Révéler le Comex", "Run Comex")}
          </Button>
        </div>
      ),
    },
    {
      n: "03",
      done: step3,
      fr: "Déposer une idée",
      en: "File an idea",
      bodyFr:
        "Multica crée un agent puis lui assigne un ticket. Ici l'unité de travail est l'idée : elle apparaît sur le tableau comme une carte, avec un essaim en équipier.",
      bodyEn:
        "Multica creates an agent then assigns an issue. Here the work unit is the idea: it shows up on the board as a card, with a swarm as teammate.",
      action: (
        <Button variant="secondary" onClick={addIdea}>
          {t(locale, "Nouvelle idée", "New idea")}
        </Button>
      ),
    },
    {
      n: "04",
      done: step4,
      fr: "Lancer le cycle",
      en: "Run the cycle",
      bodyFr:
        "Une idée n'est pas un chat. Le cycle la fait avancer : Recueillir → Écouter → Cartographier → Construire → Positionner → Éprouver → Arbitrer → Projeter → Réaliser.",
      bodyEn:
        "An idea is not a chat. The cycle moves it: Intake → Listen → Map → Build → Position → Challenge → Decide → Project → Execute.",
      action: (
        <Button
          onClick={() => {
            startCycle();
            setView("board");
          }}
        >
          {t(locale, "Lancer le cycle", "Run cycle")}
        </Button>
      ),
    },
    {
      n: "05",
      done: step5,
      fr: "Arbitrer à la porte",
      en: "Arbitrate at the gate",
      bodyFr:
        "Multica envoie le travail en review avant le merge. KayrosLab ouvre une porte humaine : approve / revise / reject, motif obligatoire. Vote instruit, veto décide.",
      bodyEn:
        "Multica lands work in review before merge. KayrosLab opens a human gate: approve / revise / reject, reason required. Vote instructs, veto decides.",
      action: (
        <Button variant="secondary" onClick={() => setView("inbox")}>
          {t(locale, "Ouvrir l'inbox", "Open inbox")}
        </Button>
      ),
    },
  ];

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <Kicker>{t(locale, "Guide & installation", "Guide & setup")}</Kicker>
        <h1 className="font-display text-3xl">
          {t(locale, "Premier cycle en cinq minutes", "First cycle in five minutes")}
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          {t(
            locale,
            "Adapté du quickstart Multica — sign in, connect a computer, create an agent — au cycle gouverné KayrosLab. On vole la simplicité du tableau, pas le runtime d'agents de code.",
            "Adapted from Multica's quickstart — sign in, connect a computer, create an agent — to KayrosLab's governed cycle. We steal the board's simplicity, not the coding-agent runtime.",
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">
            {doneCount}/5 {t(locale, "prêts", "ready")}
          </Pill>
          <Pill>
            {enabled} {t(locale, "agents", "agents")}
          </Pill>
          <Pill>
            {swarms.length} {t(locale, "essaims", "swarms")}
          </Pill>
        </div>
      </header>

      <ol className="grid gap-3">
        {steps.map((s) => (
          <li key={s.n}>
            <Panel className={s.done ? "border-positive/30" : undefined}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-raised">
                  <StepMark done={s.done} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-micro text-faint">{s.n}</p>
                  <h2 className="font-display text-lg">{locale === "fr" ? s.fr : s.en}</h2>
                  <p className="mt-1 text-sm text-muted">{locale === "fr" ? s.bodyFr : s.bodyEn}</p>
                  <div className="mt-3">{s.action}</div>
                </div>
              </div>
            </Panel>
          </li>
        ))}
      </ol>

      <Panel>
        <Kicker>{t(locale, "Ce que l'on prend chez Multica", "What we take from Multica")}</Kicker>
        <h2 className="mt-1 font-display text-xl">
          {t(locale, "Le tableau, pas le daemon", "The board, not the daemon")}
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-micro uppercase tracking-wider text-faint">
                <th className="py-2 pr-4">{t(locale, "Geste", "Move")}</th>
                <th className="py-2 pr-4">Multica</th>
                <th className="py-2">KayrosLab</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {[
                [
                  t(locale, "Entrer", "Enter"),
                  t(locale, "Sign in (web / Desktop)", "Sign in (web / Desktop)"),
                  t(locale, "Nommer l'atelier (tenant local)", "Name the workspace (local tenant)"),
                ],
                [
                  t(locale, "Runtime", "Runtime"),
                  t(locale, "Connect a computer + daemon CLI", "Connect a computer + daemon CLI"),
                  t(locale, "Composer un essaim (rôles + veto)", "Compose a swarm (roles + veto)"),
                ],
                [
                  t(locale, "Équipe", "Team"),
                  t(locale, "Create an agent (26 CLIs)", "Create an agent (26 CLIs)"),
                  t(locale, "Registre d'agents système / hybrid", "System / hybrid agent registry"),
                ],
                [
                  t(locale, "Travail", "Work"),
                  t(locale, "Assign an issue", "Assign an issue"),
                  t(locale, "Déposer une idée, lancer le cycle", "File an idea, run the cycle"),
                ],
                [
                  t(locale, "Maison", "Home"),
                  t(locale, "Kanban — cards across columns", "Kanban — cards across columns"),
                  t(locale, "Tableau À traiter → Mesuré", "Board Backlog → Measured"),
                ],
                [
                  t(locale, "Humain", "Human"),
                  t(locale, "Inbox + review before merge", "Inbox + review before merge"),
                  t(locale, "Inbox + porte (vote / veto)", "Inbox + gate (vote / veto)"),
                ],
                [
                  t(locale, "Install", "Install"),
                  "multica setup / --with-server",
                  t(locale, "Cette console ; prod = Fastify + Ollama", "This console; prod = Fastify + Ollama"),
                ],
              ].map((row) => (
                <tr key={row[0]} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 font-medium text-ink">{row[0]}</td>
                  <td className="py-2 pr-4">{row[1]}</td>
                  <td className="py-2">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <Kicker>{t(locale, "Ce que KayrosLab n'est pas", "What KayrosLab is not")}</Kicker>
          <p className="mt-2 text-sm text-muted">
            {t(
              locale,
              "Pas un orchestrateur de Claude Code / Codex / Cursor sur votre machine. Multica drive 26 CLI ; KayrosLab gouverne une décision stratégique jusqu'à un KPI. Les agents sont des rôles (Planner, Red Team, CFO consenti), pas des runtimes de code.",
              "Not an orchestrator of Claude Code / Codex / Cursor on your machine. Multica drives 26 CLIs; KayrosLab governs a strategic decision through to a KPI. Agents are roles (Planner, Red Team, consented CFO), not code runtimes.",
            )}
          </p>
        </Panel>
        <Panel>
          <Kicker>{t(locale, "Installation production", "Production setup")}</Kicker>
          <p className="mt-2 text-sm text-muted">
            {t(
              locale,
              "Cette console est l'atelier jouable. En production : Node 20+, Fastify /v1, option Ollama (quant-aware) ou proxy Claude / Mistral, option Postgres. Le cœur reste zero-dep. Les secrets ne passent jamais ici.",
              "This console is the playable workbench. In production: Node 20+, Fastify /v1, optional Ollama (quant-aware) or Claude / Mistral proxy, optional Postgres. Core stays zero-dep. Secrets never land here.",
            )}
          </p>
        </Panel>
      </div>

      <Panel>
        <Kicker>{t(locale, "Rester dans la boucle", "Stay in the loop")}</Kicker>
        <ul className="mt-3 grid gap-2 text-sm text-muted">
          <li>
            <strong className="text-ink">{t(locale, "Tableau.", "Board.")}</strong>{" "}
            {t(locale, "Maison. Quatre colonnes, cartes déplaçables.", "Home. Four columns, movable cards.")}
          </li>
          <li>
            <strong className="text-ink">Inbox.</strong>{" "}
            {t(
              locale,
              "On vous pingue quand une porte ou un essaim a besoin de vous — pas à chaque trace.",
              "You get pinged when a gate or swarm needs you — not on every trace.",
            )}
          </li>
          <li>
            <strong className="text-ink">{t(locale, "Essaims.", "Swarms.")}</strong>{" "}
            {t(
              locale,
              "Comex (veto C-suite), Cycle 8, Boucle KPI. Personality hybride uniquement avec consentement.",
              "Comex (C-suite veto), Cycle 8, KPI loop. Hybrid personality only with consent.",
            )}
          </li>
          <li>
            <strong className="text-ink">{t(locale, "Atelier.", "Studio.")}</strong>{" "}
            {t(
              locale,
              "Matrice 3×3, mémoire L0–L3, novelty, Positioner, Oracle, forecast — secondaires, jamais la maison.",
              "3×3 matrix, L0–L3 memory, novelty, Positioner, Oracle, forecast — secondary, never home.",
            )}
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              dismissGuide();
              setView("board");
            }}
          >
            {t(locale, "Aller au tableau", "Go to the board")}
          </Button>
          <Button variant="secondary" onClick={() => setView("swarms")}>
            {t(locale, "Voir les essaims", "See swarms")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
