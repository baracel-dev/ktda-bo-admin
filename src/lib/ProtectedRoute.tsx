import { Suspense, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { Badge, InfoTip, RouteLoader } from "../ui";
import { useAuth } from "./auth";
import { rolesText } from "./staffContract";
import { AdminLayout } from "../layout/AdminLayout";
import { isDemoRoute } from "./dataSource";
import { isRemovedPage } from "./hiddenPages";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { role, user, isLoading, canAccess } = useAuth();
  const location = useLocation();

  // The session is an httpOnly cookie; until GET /auth/me resolves we don't
  // yet know whether this tab is signed in. Rendering the login screen during
  // that window would flash it at someone who already has a valid session.
  if (isLoading) return <RouteLoader />;

  if (!role) return <Navigate to="/login" replace />;

  // The platform's own tools are not part of a client's back office: refused
  // for every role, whatever its page list says.
  if (isRemovedPage(location.pathname)) {
    return (
      <AdminLayout>
        <div data-testid="page-removed" className="flex flex-col items-center text-center gap-3 py-24">
          <div className="h-12 w-12 rounded-full bg-surface-sunken text-text-soft flex items-center justify-center"><ShieldOff size={22} /></div>
          <h1 className="text-lg font-semibold text-text">Not part of this back office</h1>
          <p className="text-sm text-text-soft max-w-sm">
            This page changes or shows the platform's own set-up, so it is run by the platform's operator, not from an institution's back office.
          </p>
        </div>
      </AdminLayout>
    );
  }

  // The staff directory's permissions (lib/auth.tsx): the route refuses, not just the menu.
  if (!canAccess(location.pathname, location.search)) {
    return (
      <AdminLayout>
        <div data-testid="access-denied" className="flex flex-col items-center text-center gap-3 py-24">
          <div className="h-12 w-12 rounded-full bg-danger-bg text-danger flex items-center justify-center"><ShieldOff size={22} /></div>
          <h1 className="text-lg font-semibold text-text">You do not have access to this page</h1>
          <p className="text-sm text-text-soft max-w-sm">
            Your roles ({rolesText(user?.staff?.roles ?? [])}) do not include it. An administrator can change that on Users &amp; roles.
          </p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {isDemoRoute(location.pathname) && <DemoDataNotice />}
      <Suspense fallback={<RouteLoader />}>{children}</Suspense>
    </AdminLayout>
  );
}

/** Says, on every page it applies to, that the figures are sample data — so a
 * demo number is never mistaken for a real one. */
function DemoDataNotice() {
  return (
    <div className="mb-3 flex justify-end">
      <span className="inline-flex items-center gap-1.5">
        <Badge tone="accent" className="whitespace-nowrap">Demo data</Badge>
        <InfoTip text="This page runs on sample data until CORE API is connected. Changes you make work, but only in this browser tab, and a reload resets them." />
      </span>
    </div>
  );
}
