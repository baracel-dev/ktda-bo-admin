import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";

/** Says why an action is not on offer: the signed-in member's roles do not
 *  hold its permission key (staffContract.ts). */
export function NoPermission({ className = "text-[12.5px] text-text-soft" }: { className?: string }) {
  return (
    <p className={className} data-testid="no-permission">
      Your roles do not allow this. An administrator can change that on Users &amp; roles.
    </p>
  );
}

/** Renders `children` when the member holds `perm`, else `fallback` (the
 *  NoPermission line by default). Without a staff directory everyone holds
 *  every key (lib/auth.tsx). */
export function Allowed({ perm, children, fallback }: { perm: string; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  if (can(perm)) return <>{children}</>;
  return <>{fallback === undefined ? <NoPermission /> : fallback}</>;
}
