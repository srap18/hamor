import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/backgrounds-shop")({
  beforeLoad: () => {
    throw redirect({ to: "/shop" });
  },
});
