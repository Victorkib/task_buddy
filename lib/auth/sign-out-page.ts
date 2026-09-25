import { PRODUCT_NAME } from '@/lib/branding'

const MARK_SVG = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <path d="M15.2 7.2h11.4l5.7 9.9-5.7 9.9H15.2L9.5 17.1 15.2 7.2Z" stroke="#60a5fa" stroke-width="3.6" stroke-linejoin="round"/>
  <path d="M21.4 21h11.4l5.7 9.9-5.7 9.9H21.4l-5.7-9.9L21.4 21Z" stroke="#22c55e" stroke-width="3.6" stroke-linejoin="round"/>
</svg>`

function escapeHtmlAttr(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

export function buildSignOutPageHtml(redirectTo: string) {
  const safeRedirect = escapeHtmlAttr(redirectTo)
  const scriptRedirect = JSON.stringify(redirectTo)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="theme-color" content="#020617" />
  <meta http-equiv="refresh" content="0;url=${safeRedirect}" />
  <title>Signing out · ${PRODUCT_NAME}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100dvh;
      background: #020617;
      color: #e2e8f0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    }
    body {
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .scene {
      position: relative;
      display: grid;
      place-items: center;
      width: min(100%, 24rem);
      padding: 1.5rem;
      padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
    }
    .glow, .grid {
      pointer-events: none;
      position: fixed;
      inset: 0;
    }
    .grid {
      background-image:
        linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px),
        linear-gradient(90deg,rgba(255,255,255,.03) 1px, transparent 1px);
      background-size: 48px 48px;
    }
    .glow::before, .glow::after {
      content: "";
      position: absolute;
      border-radius: 999px;
      filter: blur(64px);
    }
    .glow::before {
      width: 18rem;
      height: 18rem;
      left: 8%;
      top: 18%;
      background: rgba(37, 99, 235, .22);
    }
    .glow::after {
      width: 16rem;
      height: 16rem;
      right: 6%;
      bottom: 10%;
      background: rgba(16, 185, 129, .12);
    }
    .stage {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.25rem;
    }
    .orb {
      position: relative;
      width: 5.75rem;
      height: 5.75rem;
      display: grid;
      place-items: center;
    }
    .ring {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      border: 2px solid rgba(148, 163, 184, .18);
      border-top-color: #3b82f6;
      border-right-color: #22c55e;
      animation: spin .85s linear infinite;
    }
    .mark {
      position: relative;
      width: 3.5rem;
      height: 3.5rem;
      display: grid;
      place-items: center;
      border-radius: 1rem;
      background: linear-gradient(135deg, rgba(59,130,246,.2), rgba(16,185,129,.12));
      box-shadow: 0 12px 32px rgba(15, 23, 42, .45), inset 0 0 0 1px rgba(255,255,255,.1);
    }
    .mark svg { width: 2rem; height: 2rem; }
    h1 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: -.02em;
      color: #fff;
    }
    p {
      margin: .35rem 0 0;
      font-size: .875rem;
      color: #94a3b8;
      line-height: 1.5;
    }
    .bar {
      width: 10rem;
      height: .25rem;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(148, 163, 184, .16);
    }
    .bar > i {
      display: block;
      width: 40%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #2563eb, #22c55e);
      animation: slide 1.1s ease-in-out infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes slide {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(280%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .ring, .bar > i { animation: none; }
      .ring { border-color: #3b82f6; }
      .bar > i { width: 100%; transform: none; }
    }
  </style>
</head>
<body>
  <div class="grid"></div>
  <div class="glow"></div>
  <main class="scene" role="status" aria-live="polite" aria-busy="true">
    <div class="stage">
      <div class="orb" aria-hidden="true">
        <span class="ring"></span>
        <div class="mark">${MARK_SVG}</div>
      </div>
      <div>
        <h1>Signing you out</h1>
        <p>Clearing your ${PRODUCT_NAME} session. This only takes a moment.</p>
      </div>
      <div class="bar" aria-hidden="true"><i></i></div>
    </div>
  </main>
  <script>location.replace(${scriptRedirect})</script>
</body>
</html>`
}
