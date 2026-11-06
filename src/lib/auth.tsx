import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ADMIN_USERS, ROLE_LABELS, type AdminRole } from "../mock";
import { tokApi, TokApiError, UNAUTHENTICATED_EVENT } from "./tokApi";
import type { MeResponse } from "./tokenConsole/types.gen";
import type { SelfServiceSignupRequest, SignupResponse } from "./tokenConsole/spec-deviations";
import { clearSharedLists } from "./tokenConsole/sharedList";
import { clearLiveCache } from "./api.live";
import { setOmniOperator } from "./omniApi";

/** Sign-in against the tokenization (accounting) service — the same staff
 * accounts tokenization-web used. The session is the service's HttpOnly
 * cookie, reached same-origin through `/tok` (see tokApi.ts).
 *
 * Decided with the product owner (2026-09-23): anyone who can sign in sees
 * every BO Admin page, so every account maps to `system_admin` here. The
 * service's own roles (ADMIN, ACCOUNTANT, DEVELOPER, DEVOPS) still decide
 * what it lets through — e.g. only ADMIN passes /api/admin/** — and pages
 * report its 403 rather than second-guessing it.
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
  canAccess: (path: string) => boolean;
  /** Whether this user holds a permission key. Every signed-in user holds all
   * of them; the service still checks its own rules on the request. */
  can: (permission: string) => boolean;
};

const Ctx = createContext<AuthState | null>(null);

const SIGNED_IN_ROLE: AdminRole = "system_admin";

function toUser(me: MeResponse): StaffUser {
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
  return { email, name, initials, tokRoles, isTokAdmin: me.admin === true || tokRoles.includes("ADMIN") };
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
      .then((me) => {
        if (!cancelled) setUser(toUser(me));
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
  }, [setUser]);

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
    setUser(toUser(me));
  }, [setUser]);

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

  const canAccess = (_path: string) => user !== null;
  const can = (_permission: string) => user !== null;
  const role = user ? SIGNED_IN_ROLE : null;

  return (
    <Ctx.Provider value={{ role, user, isLoading, login, signup, logout, canAccess, can }}>
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
