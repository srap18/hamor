import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isLowBandwidth } from "./lib/perf-mode";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
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
    defaultPreload: isLowBandwidth ? "intent" : "render",
    defaultPreloadDelay: isLowBandwidth ? 50 : 0,
    // Native-app feel: never flash a loading screen unless the wait is really long,
    // and use the View Transitions API so swapping pages animates smoothly.
    defaultPendingMs: 2000,
    defaultPendingMinMs: 0,
    defaultViewTransition: true,
  });

  return router;
};
