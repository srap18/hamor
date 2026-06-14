import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://www.molok-alqarasna.com";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries = [
          { path: "/", changefreq: "daily", priority: "1.0" },
          { path: "/login", changefreq: "monthly", priority: "0.6" },
          { path: "/signup", changefreq: "monthly", priority: "0.7" },
          { path: "/pricing", changefreq: "weekly", priority: "0.8" },
          { path: "/shop", changefreq: "weekly", priority: "0.8" },
          { path: "/fish-market", changefreq: "daily", priority: "0.8" },
          { path: "/ship-market", changefreq: "weekly", priority: "0.7" },
          { path: "/ships-shop", changefreq: "weekly", priority: "0.7" },
          { path: "/backgrounds-shop", changefreq: "weekly", priority: "0.6" },
          { path: "/vip", changefreq: "weekly", priority: "0.7" },
          { path: "/competitions", changefreq: "daily", priority: "0.7" },
          { path: "/arena", changefreq: "weekly", priority: "0.6" },
          { path: "/boss", changefreq: "weekly", priority: "0.6" },
          { path: "/dragon", changefreq: "weekly", priority: "0.6" },
          { path: "/chat", changefreq: "weekly", priority: "0.5" },
          { path: "/friends", changefreq: "weekly", priority: "0.5" },
          { path: "/terms", changefreq: "monthly", priority: "0.4" },
          { path: "/privacy", changefreq: "monthly", priority: "0.4" },
          { path: "/refund", changefreq: "monthly", priority: "0.4" },
        ];

        const urls = entries
          .map(
            (e) =>
              `  <url>\n    <loc>${BASE_URL}${e.path}</loc>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
          )
          .join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
