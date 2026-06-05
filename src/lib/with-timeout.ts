// Wraps a thenable (Promise or Supabase builder) with a timeout so hanging
// network calls don't freeze the UI. On timeout the returned promise REJECTS.
export function withTimeout<T>(p: PromiseLike<T>, ms = 15000, label = "request"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

