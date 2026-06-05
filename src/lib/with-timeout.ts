// Wraps a promise with a timeout so hanging network calls don't freeze the UI.
// On timeout the returned promise REJECTS — callers should use try/finally to
// reset their loading/busy state and (optionally) show a toast.
export function withTimeout<T>(p: Promise<T>, ms = 15000, label = "request"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
