import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { hasPlayerReturnSource, isPlayerRoutePath } from "@/lib/navigation-source";

/**
 * Smart back button: returns to previous page in browser history.
 * Falls back to "/" if there's no prior entry (e.g. opened via deep link).
 */
export function BackButton({
  className,
  children,
  fallback = "/",
  "aria-label": ariaLabel = "العودة",
}: {
  className?: string;
  children: ReactNode;
  fallback?: string;
  "aria-label"?: string;
}) {
  const router = useRouter();
  const onClick = () => {
    if (typeof window !== "undefined" && isPlayerRoutePath(window.location.pathname) && hasPlayerReturnSource()) {
      router.navigate({ to: "/", replace: true });
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      router.navigate({ to: fallback });
    }
  };
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={className}>
      {children}
    </button>
  );
}

