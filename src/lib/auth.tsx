import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ADMIN_USERS, ROLE_LABELS, type AdminRole } from "../mock";
import { tokApi, TokApiError, UNAUTHENTICATED_EVENT } from "./tokApi";
import type { MeResponse } from "./tokenConsole/types.gen";
import type { SelfServiceSignupRequest, SignupResponse } from "./tokenConsole/spec-deviations";
import { clearSharedLists } from "./tokenConsole/sharedList";
import { clearLiveCache } from "./api.live";
import { setOmniOperator } from "./omniApi";
import { staffApi } from "./api.staff";
import { pageKeyFor, StaffDisabledError, type StaffView } from "./staffContract";

/** Sign-in against the tokenization (accounting) service — the same staff
 * accounts tokenization-web used. The session is the service's HttpOnly
 * cookie, reached same-origin through `/tok` (see tokApi.ts).
 *
 * After the engine lets someone in, omnichannel's staff directory says what
 * they may do (staffContract.ts): POST /staff/me/sign-in (GET /staff/me on a
 * reload) answers their roles and permission keys, which `canAccess` and
 * `can` check. A disabled member is signed out with a message. Where this
 * omnichannel has no directory, or it cannot be reached, nothing is enforced
 * here (every account sees every page, as decided on 2026-09-23); the
 * engine's own roles still decide what it lets through.
 *
 * `role`/`canAccess`/`can` keep their prior shape; every existing page
 * destructures one of them. */
export type StaffUser = {
  email: string;
  name: string;
  initials: string;
  /** The tokenization service's roles, verbatim. */
  tokRoles: string[];
  /** Holds ADMIN in the tokenization service (gates /api/admin/**). */
  isTokAdmin: boolean;
  /** The directory's record; null where there is no directory to ask. */
  staff: StaffView | null;
};

type AuthState = {
  role: AdminRole | null;
  user: StaffUser | null;
  /** True until the initial /me check resolves — see ProtectedRoute, which
   * must not flash the login screen at someone already signed in. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (req: SelfServiceSignupRequest) => Promise<SignupResponse>;
  logout: () => Promise<void>;
  /** Whether this user may open a route (`search` for ?flow=payout). */
  canAccess: (path: string, search?: string) => boolean;
  /** Whether this user holds a permission key. Without a directory every
   * signed-in user holds all of them; the service still checks its own rules. */
  can: (permission: string) => boolean;
  /** Whether the directory's permissions are being enforced. */
  enforced: boolean;
  /** Why the last session ended, for the sign-in screen (a disabled member). */
  signedOutReason: string | null;
  /** Re-read the signed-in member's record (after their roles change). */
  refreshStaff: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

const SIGNED_IN_ROLE: AdminRole = "system_admin";

function toUser(me: MeResponse, staff: StaffView | null = null): StaffUser {
  const email = me.email ?? "";
  const name = me.fullName?.trim() || email || "Signed in";
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  const tokRoles = me.roles ?? [];
  return { email, name, initials, tokRoles, isTokAdmin: me.admin === true || tokRoles.includes("ADMIN"), staff };
}

/** The directory's record for an engine sign-in. A refusal (disabled) throws;
 *  anything else that goes wrong leaves the directory out (null). */
async function staffFor(me: MeResponse, how: "signIn" | "resume"): Promise<StaffView | null> {
  setOmniOperator(me.email ?? undefined);
  const body = { ...(me.fullName?.trim() ? { fullName: me.fullName.trim() } : {}), engineRoles: me.roles ?? [] };
  try {
    return await staffApi[how](body);
  } catch (e) {
    if (e instanceof StaffDisabledError) throw e;
    console.error("staff directory sign-in failed; permissions not enforced", e);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<StaffUser | null>(null);
  // Omnichannel calls name the signed-in staff member (omniApi.ts). Set
  // before the render that shows the pages, so their first calls carry it.
  const setUser = useCallback((u: StaffUser | null) => {
    setOmniOperator(u?.email);
    setUserState(u);
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);
  // A disabled member: end the engine session too, so a reload does not let them back in.
  const refuse = useCallback(async (e: StaffDisabledError) => {
    try { await tokApi.form("/auth/logout", {}); } catch { /* signed out either way */ }
    setUser(null);
    setSignedOutReason(e.message);
  }, [setUser]);
  // Session checks still in flight. The service answers an unauthenticated
  // request with a new anonymous session cookie, so one of these landing
  // after a login would overwrite the new session — login waits them out.
  const pendingChecks = useRef(new Set<Promise<unknown>>());

  // The cookie is HttpOnly — GET /auth/me on mount is the only way to learn
  // whether this tab is already signed in.
  useEffect(() => {
    let cancelled = false;
    const check = tokApi.get<MeResponse>("/auth/me");
    pendingChecks.current.add(check);
    const settled = () => pendingChecks.current.delete(check);
    check.then(settled, settled);
    check
      .then(async (me) => {
        try {
          const staff = await staffFor(me, "resume");
          if (!cancelled) setUser(toUser(me, staff));
        } catch (e) {
          if (!cancelled && e instanceof StaffDisabledError) await refuse(e);
        }
      })
      .catch((err) => {
        if (!cancelled && !(err instanceof TokApiError && err.isUnauthenticated)) {
          console.error("tokenization /auth/me failed", err);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setUser, refuse]);

  // The server can end a session at any time (expiry, or an admin disabling
  // the account). Any 401 from a data call means exactly that, so drop to the
  // login screen instead of leaving every page to fail on its own.
  useEffect(() => {
    const onUnauthenticated = () => setUser(null);
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [setUser]);

  const login = useCallback(async (email: string, password: string) => {
    await Promise.allSettled([...pendingChecks.current]);
    await tokApi.form("/auth/login", { email, password });
    // Login answers {admin, email} only; /me carries the name and roles.
    const me = await tokApi.get<MeResponse>("/auth/me");
    setSignedOutReason(null);
    try {
      setUser(toUser(me, await staffFor(me, "signIn")));
    } catch (e) {
      if (e instanceof StaffDisabledError) {
        await refuse(e);
        // The sign-in form shows it as the reason.
        throw e;
      }
      throw e;
    }
  }, [setUser, refuse]);

  const refreshStaff = useCallback(async () => {
    if (!user) return;
    try {
      const staff = await staffApi.resume({ engineRoles: user.tokRoles });
      setUserState((u) => (u ? { ...u, staff } : u));
    } catch (e) {
      if (e instanceof StaffDisabledError) await refuse(e);
    }
  }, [user, refuse]);

  // Creates a PENDING account — no session. The caller says so.
  const signup = useCallback((req: SelfServiceSignupRequest) => tokApi.post<SignupResponse>("/auth/signup", req), []);

  const logout = useCallback(async () => {
    try {
      await tokApi.form("/auth/logout", {});
    } catch {
      // Already signed out server-side is still "signed out".
    } finally {
      clearSharedLists();
      clearLiveCache();
      setUser(null);
    }
  }, [setUser]);

  // Omnichannel's audit names the staff member who acted (see omniApi.ts).

  const held = user?.staff ? new Set(user.staff.permissions) : null;
  const can = (permission: string) => user !== null && (!held || held.has(permission));
  const canAccess = (path: string, search = "") => {
    if (!user) return false;
    const key = pageKeyFor(path, search);
    return !key || can(key);
  };
  const role = user ? SIGNED_IN_ROLE : null;
  const enforced = !!held;

  return (
    <Ctx.Provider value={{ role, user, isLoading, login, signup, logout, canAccess, can, enforced, signedOutReason, refreshStaff }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ADMIN_USERS is the role -> {name, initials} demo directory, used across the
// demo-data pages as "whose name to show for this role". The real signed-in
// identity is `user` above.
export { ADMIN_USERS, ROLE_LABELS };
export type { AdminRole };
