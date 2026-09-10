import { createFileRoute } from "@tanstack/react-router";
import { Foyer } from "@/components/salon/Foyer";

export const Route = createFileRoute("/salon/")({ component: Foyer });
