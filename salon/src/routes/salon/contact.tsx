import { createFileRoute } from "@tanstack/react-router";
import { Contact } from "@/components/salon/Contact";

export const Route = createFileRoute("/salon/contact")({ component: Contact });
