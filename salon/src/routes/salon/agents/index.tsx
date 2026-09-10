import { createFileRoute } from "@tanstack/react-router";
import { Agents } from "@/components/salon/Agents";

export const Route = createFileRoute("/salon/agents/")({ component: Agents });
