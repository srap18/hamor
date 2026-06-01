import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isLowBandwidth } from "./lib/perf-mode";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Keep data fresh in the cache so revisits are instant
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 5 * 60_000,
    defaultPreloadGcTime: 30 * 60_000,
    // On weak networks: only preload on hover/tap so we don't waste data.
    // On normal connections: preload aggressively so navigation feels instant.
    defaultPreload: isLowBandwidth ? "intent" : "render",
    defaultPreloadDelay: isLowBandwidth ? 50 : 0,
  });

  return router;
};
