import { useEffect, useState } from "react";

/**
 * True while an ad-bomb clip is on screen.
 *
 * Many Android devices only expose one or two hardware H.264 decoders. If the
 * background/dragon videos keep theirs, the ad-bomb clip decodes audio only and
 * the picture stays black. Components that render a decorative <video> use this
 * hook to unmount their element while an ad-bomb plays, releasing the decoder.
 */
export function useAdBombYield(): boolean {
  const [yielded, setYielded] = useState<boolean>(
    () => typeof window !== "undefined" && !!(window as unknown as { __adBombActive?: boolean }).__adBombActive,
  );

  useEffect(() => {
    const onAd = (e: Event) => setYielded(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener("ad-bomb:active", onAd as EventListener);
    setYielded(!!(window as unknown as { __adBombActive?: boolean }).__adBombActive);
    return () => window.removeEventListener("ad-bomb:active", onAd as EventListener);
  }, []);

  return yielded;
}
