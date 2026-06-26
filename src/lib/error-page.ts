export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>حدث خطأ</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 'Cairo','Tajawal',system-ui,-apple-system,sans-serif; background:#0a1929; color:#f5c45e; display:grid; place-items:center; min-height:100vh; margin:0; padding:1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; color:#ffe9a8; }
      p { color:#cbd5e1; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.5rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; font-weight:700; }
      .primary { background:#f5c45e; color:#0a1929; }
      .secondary { background:transparent; color:#f5c45e; border-color:#f5c45e; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>حدث خطأ</h1>
      <p>عذراً، حدث خطأ غير متوقع. حاول مرة أخرى أو ارجع للرئيسية.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">حاول مرة أخرى</button>
        <a class="secondary" href="/">الرئيسية</a>
      </div>
    </div>
  </body>
</html>`;
}
