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
    // Intent-preloading races with redirects/unmounts in this router version and
    // throws ("_nonReactive"), which surfaced as the generic error screen.
    defaultPreload: false,

    // Native-app feel: never flash a loading screen unless the wait is really long.
    defaultPendingMs: 2000,
    defaultPendingMinMs: 0,
    defaultViewTransition: false,
  });

  return router;
};
