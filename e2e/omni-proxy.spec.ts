import { expect, test } from "@playwright/test";

/* The deployed /omni proxy sets omnichannel's institution header
 * (X-Dev-Institution) from its own configuration, never from the browser, and
 * lets the caller read its own institution. No browser is needed: the proxy is
 * called directly and every fetch it makes is recorded. */

const KTDA = "11111111-1111-4111-8111-111111111111";
const FORGED = "00000000-0000-0000-0000-0000000000c0";
const ENV = { OMNI_TARGET: "https://omni.test", TOK_TARGET: "https://engine.test" };

type Call = { url: string; headers: Headers };
type Handler = (ctx: { request: Request; env: Record<string, string> }) => Promise<Response>;

// The Cloudflare Pages proxy for /omni: plain JS with no types, loaded by path.
const PROXY = "../functions/omni/[[path]].js";
const proxy = async () => ((await import(PROXY)) as { onRequest: Handler }).onRequest;

async function call(path: string, opts: { env?: Record<string, string>; method?: string; headers?: Record<string, string>; me?: number; cookie?: string | null } = {}) {
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    // The session check against the engine, then omnichannel itself.
    if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ email: "officer@ktda.test" }), { status: opts.me ?? 200 });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json", "x-total-count": "45", "x-page": "1", "x-size": "20", "x-total-pages": "3" } });
  }) as typeof fetch;
  try {
    const request = new Request(`https://bo.test${path}`, {
      method: opts.method ?? "GET",
      headers: { ...(opts.cookie === null ? {} : { cookie: opts.cookie ?? "JSESSIONID=abc" }), ...opts.headers },
    });
    const onRequest = await proxy();
    const res = await onRequest({ request, env: { ...ENV, ...opts.env } });
    return { res, upstream: calls.find((c) => c.url.startsWith(ENV.OMNI_TARGET)) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("the configured institution is sent, and a browser's own value is never forwarded", async () => {
  const { res, upstream } = await call("/omni/api/operator/bulk-loads", {
    env: { OMNI_INSTITUTION_ID: KTDA },
    headers: { "x-dev-institution": FORGED },
  });
  expect(res.status).toBe(200);
  expect(upstream?.headers.get("x-dev-institution")).toBe(KTDA);
});

test("with no institution configured, no institution header goes at all", async () => {
  const { upstream } = await call("/omni/api/operator/bulk-loads", { headers: { "x-dev-institution": FORGED } });
  expect(upstream).toBeDefined();
  expect(upstream?.headers.has("x-dev-institution")).toBe(false);
});

test("the back office may read its own institution, and nothing else about institutions", async () => {
  const read = await call("/omni/api/operator/institutions", { env: { OMNI_INSTITUTION_ID: KTDA } });
  expect(read.res.status).toBe(200);
  expect(read.upstream?.url).toBe("https://omni.test/api/operator/institutions");

  const settings = await call("/omni/api/operator/institution/settings", { env: { OMNI_INSTITUTION_ID: KTDA } });
  expect(settings.res.status).toBe(200);
  expect(settings.upstream?.headers.get("x-dev-institution")).toBe(KTDA);
  const settingsWrite = await call("/omni/api/operator/institution/settings", { method: "POST" });
  expect(settingsWrite.res.status).toBe(404);

  const other = await call(`/omni/api/operator/institutions/${KTDA}`);
  expect(other.res.status).toBe(404);
  expect(other.upstream).toBeUndefined();

  const write = await call("/omni/api/operator/institutions", { method: "POST" });
  expect(write.res.status).toBe(404);
  expect(write.upstream).toBeUndefined();
});

test("currency exchange, the market and its content are not reachable at all", async () => {
  for (const [method, path] of [
    ["GET", "/omni/api/operator/fx/settings"],
    ["GET", "/omni/api/operator/fx/conversions"],
    ["POST", "/omni/api/operator/fx/settings/changes"],
    ["GET", "/omni/api/operator/market/settings"],
    ["POST", "/omni/api/operator/market/settings/changes"],
    ["GET", "/omni/api/operator/content"],
  ]) {
    const { res, upstream } = await call(path, { method, env: { OMNI_INSTITUTION_ID: KTDA } });
    expect(res.status, `${method} ${path}`).toBe(404);
    expect(upstream, `${method} ${path}`).toBeUndefined();
  }
});

test("signed out: no cookie, or one the engine refuses, answers 401 and omnichannel is never called", async () => {
  for (const opts of [{ cookie: null }, { me: 401 }]) {
    for (const path of ["/omni/api/operator/bulk-loads", "/omni/api/operator/institutions"]) {
      const { res, upstream } = await call(path, opts);
      expect(res.status).toBe(401);
      expect(upstream).toBeUndefined();
    }
  }
});

test("the farmer journey's reads, a farmer's wallet and the single register pass, with the paging headers; nothing deeper under farmers does", async () => {
  const list = await call("/omni/api/operator/farmers?state=REGISTERED&q=TEST&page=1&size=20");
  expect(list.res.status).toBe(200);
  for (const [h, v] of [["x-total-count", "45"], ["x-page", "1"], ["x-size", "20"], ["x-total-pages", "3"]]) expect(list.res.headers.get(h)).toBe(v);
  expect((await call("/omni/api/operator/farmers/summary")).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/TEST000001")).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/TEST000001/wallet")).res.status).toBe(200);
  const moves = await call("/omni/api/operator/farmers/TEST000001/wallet/movements?currency=KES&page=2&size=20");
  expect(moves.res.status).toBe(200);
  expect(moves.res.headers.get("x-total-pages")).toBe("3");
  const below = await call("/omni/api/operator/farmers/TEST000001/wallet/movements/x");
  expect(below.res.status).toBe(404);
  expect(below.upstream).toBeUndefined();
  expect((await call("/omni/api/operator/farmers", { method: "POST" })).res.status).toBe(200);
  // Farmer KYC: the farmer behind a profile, and starting and deciding KYC.
  expect((await call("/omni/api/operator/farmers/by-customer/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/by-customer/not-a-uuid")).res.status).toBe(404);
  expect((await call("/omni/api/operator/farmers/TEST000001/kyc/start", { method: "POST" })).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/TEST000001/kyc/decision", { method: "POST" })).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/TEST000001/kyc/decision")).res.status).toBe(404);
  expect((await call("/omni/api/operator/farmers/TEST000001/kyc/other", { method: "POST" })).res.status).toBe(404);
  // Assisted onboarding and a farmer's photos.
  expect((await call("/omni/api/operator/farmers/TEST000001/assisted-onboarding", { method: "POST" })).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/TEST000001/documents", { method: "POST" })).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/TEST000001/documents")).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/TEST000001/assisted-onboarding")).res.status).toBe(404);
  expect((await call("/omni/api/operator/farmers/TEST000001/documents/x")).res.status).toBe(404);
  expect((await call("/omni/api/operator/farmers?channel=AGENT&page=1&size=20")).res.status).toBe(200);
  // The KYC sweep: no grower number in the path, so its own rule.
  const sweep = await call("/omni/api/operator/farmers/kyc/sweep", { method: "POST" });
  expect(sweep.res.status).toBe(200);
  expect(sweep.upstream).toBeDefined();
  expect((await call("/omni/api/operator/farmers/kyc/sweep")).res.status).toBe(200);
  expect((await call("/omni/api/operator/farmers/kyc/sweep/x")).res.status).toBe(404);
  expect((await call("/omni/api/operator/farmers/kyc/sweep", { method: "PUT" })).res.status).toBe(404);
  // Merchants and agents: reads, and the staff actions only.
  for (const path of ["merchants?status=IN_REVIEW&page=1&size=20", "merchants/summary", "merchants/M-10200", "agents?status=LOW_FLOAT", "agents/summary", "agents/A-0042", "agents/A-0042/activities?page=1&size=20"]) {
    expect((await call(`/omni/api/operator/${path}`)).res.status, path).toBe(200);
  }
  for (const path of ["merchants", "merchants/M-10200/documents", "merchants/M-10200/brs-check", "merchants/M-10200/decision", "agents", "agents/A-0042/suspend", "agents/A-0042/reinstate", "agents/A-0042/float/top-up", "agents/A-0042/activities"]) {
    expect((await call(`/omni/api/operator/${path}`, { method: "POST" })).res.status, `POST ${path}`).toBe(200);
  }
  const put = await call("/omni/api/operator/merchants/M-10200", { method: "PUT" });
  expect(put.res.status).toBe(200);
  expect(put.upstream?.url).toContain("/api/operator/merchants/M-10200");
  for (const [method, path] of [["POST", "merchants/M-10200"], ["GET", "merchants/M-10200/decision"], ["PUT", "merchants"], ["PUT", "merchants/M-10200/decision"], ["PUT", "agents/A-0042"], ["DELETE", "agents/A-0042"], ["POST", "agents/A-0042/float"], ["GET", "agents/A-0042/x"]]) {
    expect((await call(`/omni/api/operator/${path}`, { method })).res.status, `${method} ${path}`).toBe(404);
  }
  // One farmer is a read, not something to post to.
  expect((await call("/omni/api/operator/farmers/TEST000001", { method: "POST" })).res.status).toBe(404);
  const deeper = await call("/omni/api/operator/farmers/TEST000001/wallet", { method: "POST" });
  expect(deeper.res.status).toBe(404);
  expect(deeper.upstream).toBeUndefined();
});

test("a payment run's release and exception report pass, and the actor is the session's, never the operator the browser names", async () => {
  const run = "44444444-4444-4444-8444-444444444444";
  const { res, upstream } = await call(`/omni/api/operator/bulk-loads/${run}/release`, {
    method: "POST",
    headers: { "x-operator-subject": "staff:someone-else@ktda.test", "x-dev-subject": "staff:forged@ktda.test" },
  });
  expect(res.status).toBe(200);
  expect(upstream?.url).toBe(`https://omni.test/api/operator/bulk-loads/${run}/release`);
  expect(upstream?.headers.get("x-dev-subject")).toBe("staff:officer@ktda.test");
  expect(upstream?.headers.has("x-operator-subject")).toBe(false);
  const deeper = await call(`/omni/api/operator/bulk-loads/${run}/release/x`, { method: "POST" });
  expect(deeper.res.status).toBe(404);
  // A SAP run's exception report (CSV) is a read; its file name comes back.
  const report = await call(`/omni/api/operator/bulk-loads/${run}/exceptions`);
  expect(report.res.status).toBe(200);
  expect(report.upstream?.url).toBe(`https://omni.test/api/operator/bulk-loads/${run}/exceptions`);
  expect((await call(`/omni/api/operator/bulk-loads/${run}/exceptions`, { method: "POST" })).res.status).toBe(404);
  // The ledger's rows by outcome (CSV with Accept: text/csv) are a read too.
  const rows = await call(`/omni/api/operator/bulk-loads/${run}/rows?outcome=REFUSED`, { headers: { accept: "text/csv" } });
  expect(rows.res.status).toBe(200);
  expect(rows.upstream?.url).toBe(`https://omni.test/api/operator/bulk-loads/${run}/rows?outcome=REFUSED`);
  expect(rows.upstream?.headers.get("accept")).toBe("text/csv");
});

test("an unconfirmed payout's two confirmations pass; nothing else under a payment does", async () => {
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  for (const action of ["confirm-sent", "confirm-not-sent"]) {
    const { res, upstream } = await call(`/omni/api/operator/payments/${id}/${action}`, { method: "POST" });
    expect(res.status, action).toBe(200);
    expect(upstream?.url).toBe(`https://omni.test/api/operator/payments/${id}/${action}`);
  }
  expect((await call(`/omni/api/operator/payments/${id}/confirm-maybe`, { method: "POST" })).res.status).toBe(404);
});
