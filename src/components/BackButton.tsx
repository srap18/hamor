import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Smart back button: returns to previous page in browser history.
 * Falls back to "/" if there's no prior entry (e.g. opened via deep link).
 */
export function BackButton({
  className,
  children,
  fallback = "/",
}: {
  className?: string;
  children: ReactNode;
  fallback?: string;
}) {
  const router = useRouter();
  const onClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      router.navigate({ to: fallback });
    }
  };
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
