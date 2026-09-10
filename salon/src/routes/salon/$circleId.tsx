import { createFileRoute } from "@tanstack/react-router";
import { Seance } from "@/components/salon/Seance";

export const Route = createFileRoute("/salon/$circleId")({
  component: CirclePage,
});

function CirclePage() {
  const { circleId } = Route.useParams();
  return <Seance circleId={circleId} />;
}
