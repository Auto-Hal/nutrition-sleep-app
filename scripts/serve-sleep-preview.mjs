import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Only explicitly named synthetic SSR fixtures may be served. This is not an
// application proxy and cannot expose repository files, credentials or user data.
const fixtures = new Map([
  ["/sleep-score-preview.html", "sleep-score-preview.html"],
  ...[7, 30, 90].map((range) => [`/sleep-score-preview-${range}.html`, `sleep-score-preview-${range}.html`]),
]);
const fixtureDirectory = resolve(process.cwd(), "test-results");

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let pathname;
  try {
    pathname = new URL(request.url ?? "/", "http://127.0.0.1:4175").pathname;
  } catch {
    response.writeHead(400).end();
    return;
  }
  const filename = fixtures.get(pathname);
  if (!filename) {
    response.writeHead(404).end();
    return;
  }
  try {
    // filename comes exclusively from the fixed allowlist above, never a URL
    // segment or decoded request path. Directory traversal cannot change it.
    const body = await readFile(resolve(fixtureDirectory, filename));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.byteLength });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404).end("Synthetic preview not generated. Run the sleep render test with WRITE_SLEEP_UI_PREVIEW=1.");
  }
});

server.on("error", (error) => {
  console.error(`Synthetic sleep preview server failed: ${error.code ?? "SERVER_ERROR"}`);
  process.exitCode = 1;
});
server.listen(4175, "127.0.0.1", () => {
  console.log("Synthetic sleep UI fixtures: http://127.0.0.1:4175/sleep-score-preview.html");
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close());
}
