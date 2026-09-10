import { createFileRoute } from "@tanstack/react-router";
import { Fiche } from "@/components/salon/Fiche";

export const Route = createFileRoute("/salon/agents/$authorId")({
  component: AgentPage,
});

function AgentPage() {
  const { authorId } = Route.useParams();
  return <Fiche authorId={authorId} />;
}
