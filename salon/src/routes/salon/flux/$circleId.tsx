import { createFileRoute } from "@tanstack/react-router";
import { FluxX } from "@/components/salon/FluxX";

export const Route = createFileRoute("/salon/flux/$circleId")({
  component: FluxCircle,
});

function FluxCircle() {
  const { circleId } = Route.useParams();
  return <FluxX circleId={circleId} />;
}
