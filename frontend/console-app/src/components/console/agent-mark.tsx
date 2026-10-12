import { Bot, Cpu, Landmark, Scale, Store, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Agent } from "@/lib/console/model";

type Tone = { color: string; soft: string; Icon: LucideIcon };

export function agentTone(agent?: Pick<Agent, "role" | "department" | "kind"> | null): Tone {
  if (agent?.kind === "impersonator") return { color: "#4a154b", soft: "#f6eef6", Icon: UserRound };
  const text = `${agent?.role ?? ""} ${agent?.department ?? ""}`;
  if (/financ|daf|cfo/i.test(text)) return { color: "#146c43", soft: "#e5f4ec", Icon: Landmark };
  if (/jurid|legal|droit/i.test(text)) return { color: "#1e4d78", soft: "#e7eef5", Icon: Scale };
  if (/tech|cto|produit|ingén/i.test(text)) return { color: "#0b5cab", soft: "#e7f2fb", Icon: Cpu };
  if (/commerc|sales|marché|vente/i.test(text)) return { color: "#8a5a10", soft: "#f8f1e3", Icon: Store };
  if (/rh|people|humain/i.test(text)) return { color: "#9f2c22", soft: "#f8e8e6", Icon: Users };
  return { color: "#0f766e", soft: "#e5f3f1", Icon: Bot };
}

export function AgentMark({ agent, size = 32 }: { agent?: Pick<Agent, "role" | "department" | "kind"> | null; size?: number }) {
  const tone = agentTone(agent);
  const Icon = tone.Icon;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg"
      style={{ width: size, height: size, background: tone.soft, color: tone.color }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.75} />
    </span>
  );
}
