import { useRef, useState } from "react";
import { currentIdea, useKayros } from "@/lib/kayros/store";
import type { FeatureFlags, ViewId } from "@/lib/kayros/types";
import { Button } from "@/components/ui/button";
import { Field, InlineEdit, Kicker, Panel, Pill, t } from "./bits";

export function ConnectorsView() {
  const locale = useKayros((s) => s.locale);
  const connectors = useKayros((s) => s.connectors);
  const updateConnector = useKayros((s) => s.updateConnector);
  const testConnector = useKayros((s) => s.testConnector);

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>Slack · Teams · Discord</Kicker>
        <h1 className="font-display text-2xl">{t(locale, "Connecteurs", "Connectors")}</h1>
        <p className="text-sm text-muted">
          {t(locale, "Aucun secret n'est stocké dans le navigateur.", "No secrets live in the browser.")}
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        {connectors.map((c) => (
          <Panel key={c.platform}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg capitalize">{c.platform}</h2>
              <Pill
                tone={
                  c.status === "connected" ? "positive" : c.status === "error" ? "danger" : "warning"
                }
              >
                {c.status}
              </Pill>
            </div>
            <p className="text-xs text-muted">{c.rooms} salon(s)</p>
            <Field label="webhook">
              <InlineEdit
                value={c.webhook}
                onChange={(webhook) => updateConnector(c.platform, { webhook })}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => testConnector(c.platform)}>
                Test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => updateConnector(c.platform, { enabled: !c.enabled })}
              >
                {c.enabled ? "on" : "off"}
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function McpView() {
  const locale = useKayros((s) => s.locale);
  const tools = useKayros((s) => s.mcpTools);
  const toggleMcp = useKayros((s) => s.toggleMcp);
  const snippet = `{
  "mcpServers": {
    "kayroslab": {
      "url": "https://api.kayroslab.com/mcp",
      "headers": { "Authorization": "Bearer <digest>" }
    }
  }
}`;

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>Codex · Claude Code · Cursor · VS Code</Kicker>
        <h1 className="font-display text-2xl">Developer Portal MCP</h1>
        <p className="text-sm text-muted">
          {t(
            locale,
            "Catalogue least-privilege, tenant-scopé. Les writes ouvrent les mêmes portes.",
            "Least-privilege tenant catalog. Writes still open the same gates.",
          )}
        </p>
      </header>
      <Panel>
        {tools.map((tool) => (
          <label key={tool.id} className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-0">
            <span>
              <strong className="font-mono text-sm">{tool.name}</strong>
              <span className="block text-xs text-muted">{tool.description}</span>
              <span className="text-[11px] text-faint">{tool.scope}</span>
            </span>
            <input type="checkbox" checked={tool.enabled} onChange={() => toggleMcp(tool.id)} />
          </label>
        ))}
      </Panel>
      <Panel>
        <Kicker>cursor.mcp.json</Kicker>
        <pre className="mt-2 overflow-auto font-mono text-xs text-muted">{snippet}</pre>
      </Panel>
    </div>
  );
}

export function StudioView() {
  const locale = useKayros((s) => s.locale);
  const tenant = useKayros((s) => s.tenantName);
  const setTenant = useKayros((s) => s.setTenant);
  const steps = useKayros((s) => s.steps);
  const updateStep = useKayros((s) => s.updateStep);
  const flags = useKayros((s) => s.flags);
  const setFlag = useKayros((s) => s.setFlag);
  const adapters = useKayros((s) => s.adapters);
  const toggleAdapter = useKayros((s) => s.toggleAdapter);
  const kiWeights = useKayros((s) => s.kiWeights);
  const setKiWeights = useKayros((s) => s.setKiWeights);
  const exportJson = useKayros((s) => s.exportJson);
  const importJson = useKayros((s) => s.importJson);
  const resetSeed = useKayros((s) => s.resetSeed);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");

  function download() {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kayros-console-workspace.json";
    a.click();
  }

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>Studio</Kicker>
        <h1 className="font-display text-2xl">{t(locale, "Tout est schéma", "Everything is schema")}</h1>
      </header>
      <Panel>
        <Field label={t(locale, "Nom du tenant", "Tenant name")}>
          <InlineEdit value={tenant} onChange={setTenant} className="font-display text-xl" />
        </Field>
      </Panel>
      <Panel>
        <Kicker>{t(locale, "Étapes", "Steps")}</Kicker>
        <div className="mt-3 grid gap-3">
          {steps.map((s) => (
            <div key={s.id} className="grid gap-2 rounded-lg border border-line p-3 md:grid-cols-4">
              <InlineEdit value={s.fr} onChange={(fr) => updateStep(s.id, { fr })} />
              <InlineEdit value={s.en} onChange={(en) => updateStep(s.id, { en })} />
              <InlineEdit value={s.agentId} onChange={(agentId) => updateStep(s.id, { agentId })} />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => updateStep(s.id, { enabled: e.target.checked })}
                />
                enabled
              </label>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <Kicker>Feature flags</Kicker>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(Object.keys(flags) as (keyof FeatureFlags)[]).map((k) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
              {k}
              <input type="checkbox" checked={flags[k]} onChange={(e) => setFlag(k, e.target.checked)} />
            </label>
          ))}
        </div>
      </Panel>
      <Panel>
        <Kicker>KI weights</Kicker>
        <pre className="mt-2 overflow-auto font-mono text-xs text-muted">{JSON.stringify(kiWeights, null, 2)}</pre>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() =>
            setKiWeights({
              ...kiWeights,
              desirabilite: { impact: 0.5, originalite: 0.5 },
            })
          }
        >
          {t(locale, "Équilibrer désirabilité", "Balance desirability")}
        </Button>
      </Panel>
      <Panel>
        <Kicker>Adapters V16</Kicker>
        {adapters.map((a) => (
          <label key={a.id} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
            <span>
              <strong>{a.name}</strong>
              <span className="block text-xs text-muted">{a.note}</span>
            </span>
            <input type="checkbox" checked={a.enabled} onChange={() => toggleAdapter(a.id)} />
          </label>
        ))}
      </Panel>
      <div className="flex flex-wrap gap-2">
        <Button onClick={download}>{t(locale, "Exporter JSON", "Export JSON")}</Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          {t(locale, "Importer", "Import")}
        </Button>
        <Button variant="ghost" onClick={resetSeed}>
          Reset
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              importJson(await file.text());
              setMsg(t(locale, "Importé.", "Imported."));
            } catch (err) {
              setMsg(err instanceof Error ? err.message : "error");
            }
          }}
        />
      </div>
      {msg && <p className="text-sm text-accent">{msg}</p>}
    </div>
  );
}

export function SpecsView() {
  const locale = useKayros((s) => s.locale);
  const specs = useKayros((s) => s.specs);
  const setSpec = useKayros((s) => s.setSpec);
  const setView = useKayros((s) => s.setView);
  const [kind, setKind] = useState<"functional" | "technical">("functional");
  const idea = useKayros(currentIdea);

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker>
            {t(locale, "Spécifications vivantes", "Living specifications")}
            {idea ? ` · ${idea.title}` : ""}
          </Kicker>
          <h1 className="font-display text-2xl md:text-3xl">
            {kind === "functional"
              ? t(locale, "Spécifications fonctionnelles", "Functional specifications")
              : t(locale, "Spécifications techniques", "Technical specifications")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant={kind === "functional" ? "default" : "secondary"} onClick={() => setKind("functional")}>
            F
          </Button>
          <Button variant={kind === "technical" ? "default" : "secondary"} onClick={() => setKind("technical")}>
            T
          </Button>
        </div>
      </header>
      <div className="grid gap-3">
        {specs
          .filter((s) => s.kind === kind)
          .map((s) => (
            <Panel key={s.id}>
              <div className="flex items-start justify-between gap-2">
                <InlineEdit
                  value={locale === "fr" ? s.titleFr : s.titleEn}
                  onChange={(v) =>
                    setSpec(s.id, locale === "fr" ? { titleFr: v } : { titleEn: v })
                  }
                  className="font-display text-lg"
                />
                {s.linkedView && (
                  <Button size="sm" variant="ghost" onClick={() => setView(s.linkedView as ViewId)}>
                    →
                  </Button>
                )}
              </div>
              <InlineEdit
                value={locale === "fr" ? s.bodyFr : s.bodyEn}
                onChange={(v) => setSpec(s.id, locale === "fr" ? { bodyFr: v } : { bodyEn: v })}
                multiline
                className="mt-3 whitespace-pre-wrap text-sm leading-relaxed"
              />
            </Panel>
          ))}
      </div>
    </div>
  );
}
