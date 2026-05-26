import { createFileRoute, redirect } from "@tanstack/react-router";

// The old local-only ships shop has been retired. The real, persisted
// shipyard lives at /ship-market — redirect there so buying/selling always
// syncs with the player's account and harbor fleet.
export const Route = createFileRoute("/ships-shop")({
  beforeLoad: () => {
    throw redirect({ to: "/ship-market" });
  },
  component: () => null,
});
