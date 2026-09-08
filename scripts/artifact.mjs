/**
 * Render the landing page into a single self-contained HTML file for publishing
 * as a Claude Artifact.
 *
 * The artifact host wraps whatever it is given in its own <!doctype>/<head>/
 * <body>, so this cannot ship an <html> or <body> tag. That is why this is a
 * script rather than a copy-paste: next/font puts its --font-* variables on a
 * class it expects to sit on <html>, and there is no <html> here, so a tiny
 * inline script moves those classes onto document.documentElement at load.
 * Without it --font-sans resolves to nothing and the whole page silently falls
 * back to the system stack.
 *
 * The site is light-only. Its own body rule paints background and colour
 * explicitly, so the page keeps its ground in a viewer whose theme is dark
 * rather than inheriting the host's.
 *
 * Usage: node scripts/artifact.mjs [--route /path] [--out file]
 *                                   [--link /route=https://…]…
 *
 * Runs `next build` first. Routes other than the one being rendered are not in
 * the file, so their links are rewritten: to a published URL when --link gives
 * one, and to an inert anchor otherwise.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const PORT = 3123;
const SCRATCH =
  "/tmp/claude-0/-home-user-dev/f15182dd-5706-5de7-9e3e-333359592ddf/scratchpad";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ROUTE = flag("--route", "/");
const TITLES = { "/": "Resident", "/positions": "Resident Positions", "/docs": "Resident Docs" };
const TITLE = flag("--title", TITLES[ROUTE] ?? "Resident");
const OUT = flag("--out", `${SCRATCH}/${ROUTE === "/" ? "resident" : ROUTE.slice(1)}.html`);

/** Routes that live at a published URL rather than in this file. */
const LINKS = new Map(
  args
    .map((a, i) => (a === "--link" ? args[i + 1] : null))
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf("=");
      if (at < 0) throw new Error(`--link wants /route=url, got ${pair}`);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
);

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never came up at ${url}`);
}

/** Inner HTML of <body>, and the class list Next put on <html>. */
function split(html) {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!body) throw new Error("no <body> in the rendered page");
  const cls = html.match(/<html[^>]*\sclass="([^"]*)"/);
  if (!cls) throw new Error("no class on <html> — the font variables are lost");
  return { body: body[1], htmlClass: cls[1] };
}

await run("npm", ["run", "build"]);

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: "ignore",
  detached: true,
});

try {
  const base = `http://127.0.0.1:${PORT}`;
  await waitFor(base);

  const page = await (await fetch(base + ROUTE)).text();
  const { body: rendered, htmlClass } = split(page);

  // The RSC flight payload re-encodes the whole page and points at chunk URLs
  // that do not exist once this is a standalone file. It is dead weight here.
  let body = rendered.replace(/<script[\s\S]*?<\/script>/g, "");

  // Rewrite every internal link: this route to a self-anchor, a route with a
  // published URL to that URL, anything else to an inert anchor. Longest route
  // first, so /positions is not clobbered by the rule for /.
  const routes = [...new Set([...LINKS.keys(), ROUTE, "/", "/docs", "/positions"])]
    .sort((a, b) => b.length - a.length);
  for (const route of routes) {
    const href =
      route === ROUTE ? "#" : (LINKS.get(route) ?? (route === "/docs" ? "#risk" : "#"));
    body = body.replaceAll(`href="${route}"`, `href="${href}"`);
  }

  const hrefs = [...page.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((h) => h.startsWith("/"));
  if (!hrefs.length) throw new Error("no stylesheets found in the built page");

  let css = (
    await Promise.all(
      hrefs.map(async (h) => (await fetch(base + h)).text()),
    )
  ).join("\n");

  // next/font emits @font-face rules pointing at ../media/*.woff2, which do not
  // exist standalone. Left in, they define "Chivo" with a src that never loads
  // and shadow the identically named families the Google Fonts link provides,
  // so the page renders in the fallback stack. Drop exactly those; the metric-
  // override "… Fallback" faces are local(Arial) and self-contained, so they
  // stay.
  const dropped = [];
  css = css.replace(/@font-face\{[^{}]*\}/g, (rule) =>
    rule.includes("url(../media/") ? (dropped.push(rule), "") : rule,
  );

  const script = `(function () {
  ${JSON.stringify(htmlClass)}.split(" ").filter(Boolean)
    .forEach(function (c) { document.documentElement.classList.add(c); });
})();`;

  writeFileSync(
    OUT,
    `<title>${TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chivo:wght@400;500;600&family=Chivo+Mono&family=Roboto+Mono&display=swap">
<style>
${css}
body { margin: 0; }
</style>
${body}
<script>
${script}
</script>
`,
  );

  console.log(
    `wrote ${OUT} from ${ROUTE} (${(css.length / 1024) | 0}KB css, ` +
      `${dropped.length} unresolvable @font-face rules dropped)`,
  );
} finally {
  process.kill(-server.pid);
}
