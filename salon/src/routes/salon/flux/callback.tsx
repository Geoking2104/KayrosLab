import { createFileRoute } from "@tanstack/react-router";
import { FluxX } from "@/components/salon/FluxX";

export const Route = createFileRoute("/salon/flux/callback")({ component: FluxX });
