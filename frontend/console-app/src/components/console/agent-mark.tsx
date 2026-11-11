import { Bot, Cpu, Landmark, Scale, Store, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Agent } from "@/lib/console/model";
import { PersonaAvatar } from "./persona-avatar";

type Tone = { color: string; soft: string; Icon: LucideIcon };

export function agentTone(agent?: Pick<Agent, "role" | "department" | "kind"> | null): Tone {
  if (agent?.kind === "impersonator") return { color: "#5b4cdb", soft: "#eeecfb", Icon: UserRound };
  const text = `${agent?.role ?? ""} ${agent?.department ?? ""}`;
  if (/financ|daf|cfo/i.test(text)) return { color: "#157347", soft: "#e7f4ec", Icon: Landmark };
  if (/jurid|legal|droit/i.test(text)) return { color: "#0176d3", soft: "#eaf5fe", Icon: Scale };
  if (/tech|cto|produit|ingén/i.test(text)) return { color: "#0f766e", soft: "#e6f4f2", Icon: Cpu };
  if (/commerc|sales|marché|vente/i.test(text)) return { color: "#8a6d1a", soft: "#f8f1dc", Icon: Store };
  if (/rh|people|humain/i.test(text)) return { color: "#b42318", soft: "#fbe9e7", Icon: Users };
  return { color: "#0176d3", soft: "#eaf5fe", Icon: Bot };
}

type MarkAgent = Pick<Agent, "role" | "department" | "kind"> & Partial<Pick<Agent, "name" | "compliance">>;

export function AgentMark({ agent, size = 32 }: { agent?: MarkAgent | null; size?: number }) {
  // Persona conforme (drapeau serveur KAYROS_PERSONA_PUBLIC_MODEL) : portrait ou initiales + badge K.
  if (agent?.kind === "impersonator" && agent.compliance) {
    return <PersonaAvatar name={agent.name || agent.role} portraitUrl={agent.compliance.portrait_url} size={size} />;
  }
  const tone = agentTone(agent);
  const Icon = tone.Icon;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl"
      style={{ width: size, height: size, background: tone.soft, color: tone.color }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.75} />
    </span>
  );
}
