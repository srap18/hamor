import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/recharge")({
  beforeLoad: () => {
    throw redirect({ to: "/shop" });
  },
});
