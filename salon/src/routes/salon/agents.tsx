import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/salon/agents")({
  component: () => <Outlet />,
});
