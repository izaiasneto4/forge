// Shown while the server boots, so a cold launch gets a window at once. Loaded
// as a data: URL; the preload exposes no bridge to it.
const STARTING_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Ordem</title><style>
  html, body { margin: 0; height: 100%; background: #131315; color: #8e8e93; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  body { display: grid; place-items: center; -webkit-app-region: drag; user-select: none; }
  .mark { width: 56px; height: 56px; margin: 0 auto 16px; opacity: .9; animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .45; } }
  p { margin: 0; text-align: center; }
</style></head><body><div>
  <svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><path fill="#F5F5F5" fill-rule="evenodd" d="M173.88 148.83H304.71A11.13 11.13 0 0 1 315.85 159.96V187.8A8.35 8.35 0 0 0 324.2 196.15H352.04A11.13 11.13 0 0 1 363.17 207.29V338.12A61.24 61.24 0 0 1 301.93 399.36H173.88A61.24 61.24 0 0 1 112.64 338.12V210.07A61.24 61.24 0 0 1 173.88 148.83ZM185.02 204.5A16.7 16.7 0 0 0 168.31 221.2V326.98A16.7 16.7 0 0 0 185.02 343.69H290.8A16.7 16.7 0 0 0 307.5 326.98V221.2A16.7 16.7 0 0 0 290.8 204.5ZM349.25 112.64H388.23A11.13 11.13 0 0 1 399.36 123.77V162.75A11.13 11.13 0 0 1 388.23 173.88H349.25A11.13 11.13 0 0 1 338.12 162.75V123.77A11.13 11.13 0 0 1 349.25 112.64Z"/></svg>
  <p>Starting Ordem…</p>
</div></body></html>`

export const STARTING_PAGE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(STARTING_HTML)}`
