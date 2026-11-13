// /tok/* on Cloudflare Pages -> the tokenization (accounting) engine's /api/*,
// through the engine's own load balancer (port 8086) rather than
// tokenization-web's, which goes away with tokenization-web.
// The deployed twin of the /tok dev proxy in vite.config.ts.
//
// Same origin as the app on purpose: the service sends no CORS headers and its
// session is a JSESSIONID cookie (SameSite=Lax), so a cross-origin call from
// pages.dev would be blocked before authentication is even considered. The
// browser's Origin is dropped for the same reason.
//
// The engine is the Pages environment variable TOK_TARGET. There is no
// default: until it is set every call answers 503 saying so. A target with a
// self-signed certificate is refused by Cloudflare (526) and answers 503 too.

const FORWARDED = ["accept", "content-type", "cookie"];

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!env.TOK_TARGET) return notConfigured();
  const target = env.TOK_TARGET + url.pathname.replace(/^\/tok/, "/api") + url.search;

  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    return unavailable();
  }
  // 52x: Cloudflare could not complete TLS with, or reach, the origin.
  if (upstream.status >= 520 && upstream.status <= 530) return unavailable();

  const out = new Headers();
  // The X-* totals are how a paged list says how many rows there are
  // (api/ListPaging.java); without them the client cannot page and throws.
  for (const name of ["content-type", "retry-after", "x-total-count", "x-page", "x-size", "x-total-pages"]) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  // The session cookie must land on THIS origin. Strip any Domain the service
  // might name and mark it Secure: pages.dev is https-only.
  //
  // Never on a 401: the service opens a fresh anonymous session on every
  // unauthenticated request and sets its cookie. A 401 that lands after a
  // login (an in-flight /auth/me, say) would replace the real session with
  // that empty one and sign the user straight back out.
  if (upstream.status !== 401) {
    for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
      out.append("set-cookie", rewriteCookie(cookie));
    }
  }
  out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function rewriteCookie(cookie) {
  const parts = cookie
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^domain=/i.test(p) && !/^secure$/i.test(p));
  parts.push("Secure");
  return parts.join("; ");
}

function notConfigured() {
  return new Response(JSON.stringify({ error: "This site has no engine configured yet (TOK_TARGET)." }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function unavailable() {
  return new Response(
    JSON.stringify({ error: "The tokenization service is unreachable from this site right now. Please try again shortly." }),
    { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
