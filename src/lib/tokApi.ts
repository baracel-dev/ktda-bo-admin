/* Fetch wrapper for the tokenization (accounting) service — BO Admin's real
 * backend for sign-in, Baracel Unyt and every page that shows live
 * tokenization data.
 *
 * Always same-origin: `/tok/*` is proxied to the service's `/api/*` (Vite in
 * development, functions/tok on Cloudflare Pages). The session is the
 * service's HttpOnly JSESSIONID cookie, so there is no token to hold here.
 *
 * The service answers failures in TWO envelopes, confirmed against UAT:
 *   application errors  {"error":"Invalid email or password"}       — for a human
 *   framework errors    {"timestamp","status","error":"Forbidden","path"} — `error`
 *                       is only the reason phrase; the status is what matters.
 * Showing "Forbidden" or "Bad Request" to an operator tells them nothing, so the
 * second shape gets a message chosen from the status. */

export const TOK_BASE = import.meta.env.VITE_TOK_BASE ?? "/tok";

/** Fired on any 401 so the auth provider can drop a session the server has
 *  already ended (expired, or disabled by an admin) instead of every page
 *  failing on its own. */
export const UNAUTHENTICATED_EVENT = "tok:unauthenticated";

export class TokApiError extends Error {
  readonly status: number;
  /** True when the server answered with Spring's own error envelope — i.e. the
   *  route or method itself failed, not a business rule. A framework 404 means
   *  "this endpoint is not deployed", which some pages report differently. */
  readonly framework: boolean;
  constructor(status: number, message: string, framework = false) {
    super(message);
    this.name = "TokApiError";
    this.status = status;
    this.framework = framework;
  }
  get isUnauthenticated() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isMissingEndpoint() {
    return this.status === 404 && this.framework;
  }
}

type ErrorEnvelope = { error?: string; message?: string; path?: string };

function frameworkMessage(status: number, reason: string | undefined) {
  switch (status) {
    case 400:
      return "The request was rejected as malformed — a required field is probably missing.";
    case 401:
      return "Your session has ended. Please sign in again.";
    case 403:
      return "Your account does not have permission for this action.";
    case 404:
      return "Not found.";
    default:
      return reason ?? `Request failed (${status}).`;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A proxy can answer HTML where the app sends JSON; keep it visible.
    return text;
  }
}

async function parse<T>(res: Response, isAuthCall: boolean): Promise<T> {
  // 204 and any empty body must not go through JSON.parse.
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (res.ok) return data as T;

  const env = (data && typeof data === "object" ? data : {}) as ErrorEnvelope;
  const framework = env.path !== undefined;
  const message = framework
    ? frameworkMessage(res.status, env.error)
    : env.error ?? env.message ?? (typeof data === "string" && data.length < 200 ? data : `Request failed (${res.status}).`);

  // A wrong password on /auth/login is a 401 too, but it is not "your session
  // ended" — only broadcast 401s from calls that assumed a session.
  if (res.status === 401 && !isAuthCall && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
  }
  throw new TokApiError(res.status, message, framework);
}

async function request(method: string, path: string, body?: unknown, contentType?: string): Promise<Response> {
  try {
    return await fetch(`${TOK_BASE}${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": contentType ?? "application/json" } : {},
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  } catch {
    throw new TokApiError(0, "Cannot reach the tokenization service. Check your connection and try again.");
  }
}

async function send<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  return parse<T>(await request(method, path, body, contentType), path.startsWith("/auth/"));
}

/** One page of a list, and how many there are: the same shape as omnichannel's (omniApi.ts). */
export type Page<T> = { items: T[]; page: number; pages: number; total: number };

/** The engine pages any list on `page`/`size` (api/ListPaging.java, and in the
 *  database for the big ones — apps/PAGINATION-CONTRACT.md): the body stays an
 *  array and the totals come in X-Total-Count / X-Total-Pages. */
async function getPage<T>(path: string, page: number, size: number): Promise<Page<T>> {
  const res = await request("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${size}`);
  const body = await parse<unknown>(res, false);
  const items = Array.isArray(body) ? (body as T[]) : [];
  const num = (name: string) => {
    const raw = res.headers.get(name);
    const v = Number(raw);
    return raw !== null && raw.trim() !== "" && Number.isFinite(v) ? v : null;
  };
  const total = num("X-Total-Count");
  // No total means something between here and the engine dropped the paging
  // headers (a proxy that does not forward them). Treating the page as the
  // whole list would show 20 rows as "20 in total", so say so instead.
  if (total === null) {
    throw new TokApiError(res.status, "The list came back without its page totals (X-Total-Count), so it can't be paged. The proxy in front of the tokenization service must forward the X-Total-* headers.");
  }
  return { items, page: num("X-Page") ?? page, pages: num("X-Total-Pages") ?? Math.ceil(total / size), total };
}

export const tokApi = {
  get: <T>(path: string) => send<T>("GET", path),
  getPage,
  post: <T>(path: string, body?: unknown) => send<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => send<T>("PUT", path, body ?? {}),
  del: <T>(path: string) => send<T>("DELETE", path),
  /** Spring Security's login/logout filters take url-encoded fields, not JSON —
   *  posting JSON to them fails with a 401 that looks like bad credentials. */
  form: <T>(path: string, fields: Record<string, string>) =>
    send<T>("POST", path, new URLSearchParams(fields).toString(), "application/x-www-form-urlencoded"),
};

/** Query string that drops empty params: the backend reads `?status=` as an
 *  empty value, not "unset", and answers with nothing. */
export function qs(params: Record<string, string | number | boolean | readonly string[] | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // A list is a repeatable param (`?status=A&status=B`).
    if (Array.isArray(v)) {
      for (const one of v) if (one !== "") sp.append(k, one);
    } else if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
