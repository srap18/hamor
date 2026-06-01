import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Keep route data hot so revisits feel instant
    defaultPreloadStaleTime: 5 * 60_000,
    defaultPreloadGcTime: 30 * 60_000,
    // Preload route code + data as soon as a <Link> renders on screen
    defaultPreload: "render",
    defaultPreloadDelay: 0,
  });

  return router;
};
