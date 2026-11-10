/* Omnichannel's staff directory (staffContract.ts). */
import { omniCall, OmniApiError } from "./omniApi";
import { missingEndpoint } from "./omniMaybe";
import {
  STAFF_DISABLED, STAFF_PATH, StaffDisabledError,
  type AccessMatrix, type StaffPermission, type StaffRole, type StaffRoleDef, type StaffStatus, type StaffView,
} from "./staffContract";

const one = (id: string) => `${STAFF_PATH}/${encodeURIComponent(id)}`;
/** Only a record with a permissions list is enforced; anything else is no directory. */
const valid = (v: unknown): StaffView | null =>
  v && typeof v === "object" && Array.isArray((v as StaffView).permissions) && Array.isArray((v as StaffView).roles) ? (v as StaffView) : null;
const isDisabled = (e: unknown) => e instanceof OmniApiError && e.status === 403 && e.code === STAFF_DISABLED;

export const staffApi = {
  /** After a sign-in: the member as the directory has them, or null where
   *  this omnichannel has no directory. A disabled member throws
   *  StaffDisabledError. */
  signIn: async (body: { fullName?: string; engineRoles?: string[] }): Promise<StaffView | null> => {
    try {
      return valid(await omniCall.post<StaffView>(`${STAFF_PATH}/me/sign-in`, body));
    } catch (e) {
      if (isDisabled(e)) throw new StaffDisabledError();
      if (missingEndpoint(e)) return null;
      throw e;
    }
  },
  /** On a session that was already signed in (a reload): the member's record,
   *  falling back to the sign-in call when there is none to read yet. */
  resume: async (body: { fullName?: string; engineRoles?: string[] }): Promise<StaffView | null> => {
    try {
      return valid(await omniCall.get<StaffView>(`${STAFF_PATH}/me`));
    } catch (e) {
      if (isDisabled(e)) throw new StaffDisabledError();
      return staffApi.signIn(body);
    }
  },
  list: (q?: { status?: StaffStatus | null; q?: string }) => {
    const p = new URLSearchParams();
    if (q?.status) p.set("status", q.status);
    if (q?.q?.trim()) p.set("q", q.q.trim());
    const s = p.toString();
    return omniCall.list<StaffView>(`${STAFF_PATH}${s ? `?${s}` : ""}`);
  },
  invite: (body: { email: string; fullName: string; roles: StaffRole[] }) => omniCall.post<StaffView>(STAFF_PATH, body),
  update: (id: string, body: { fullName?: string; roles?: StaffRole[] }) => omniCall.put<StaffView>(one(id), body),
  setStatus: (id: string, status: "ACTIVE" | "DISABLED") => omniCall.post<StaffView>(`${one(id)}/status`, { status }),
  roles: () => omniCall.list<StaffRoleDef>(`${STAFF_PATH}/roles`),
  permissions: () => omniCall.list<StaffPermission>(`${STAFF_PATH}/permissions`),
  access: () => omniCall.get<AccessMatrix>(`${STAFF_PATH}/access`),
  setAccess: (role: string, keys: string[]) => omniCall.put<AccessMatrix>(`${STAFF_PATH}/access/${encodeURIComponent(role)}`, { keys }),
};
