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
    // Intent preloading can race an auth redirect on mobile taps and leave
    // TanStack Router with a disposed match (`_nonReactive`). Load only after
    // the user actually navigates; route chunks are cached after first use.
    defaultPreload: false,


    // Native-app feel: never flash a loading screen unless the wait is really long.
    defaultPendingMs: 2000,
    defaultPendingMinMs: 0,
    defaultViewTransition: false,
  });

  return router;
};
