/**
 * Resolves the WebSocket endpoint the client connects to.
 *
 * Production (GitHub Pages): VITE_WS_URL is baked in at build time by the
 * pages.yml workflow, pointing at the API Gateway WebSocket stage, e.g.
 *   wss://abc123.execute-api.ca-central-1.amazonaws.com/dev
 *
 * Local dev: VITE_WS_URL is unset, so we fall back to the same host that
 * served the page (the original server.js serves both static files and WS).
 */
export function wsUrl() {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}
