import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tribe")({
  beforeLoad: () => {
    throw redirect({ to: "/chat", search: { tab: "tribe", solo: "1" } as any });
  },
  component: () => null,
});
