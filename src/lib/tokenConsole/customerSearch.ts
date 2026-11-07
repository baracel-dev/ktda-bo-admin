import type { CustomerQuery } from "../omniApi";

/* How the Customer desk search box reads what staff type, and where it lives. */

/** The Customer desk, searching for `q` when given. */
export const customerDeskLink = (q?: string | null) =>
  `/token-console/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`;

/** The KYC desk on a farmer's KYC tab, with that farmer open. */
export const kycDeskLink = (growerNo: string, kycStatus: string) =>
  `/token-console/kyc?kyc=${encodeURIComponent(kycStatus)}&grower=${encodeURIComponent(growerNo)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Kenyan number as people type it (0712…, 712…, 254712…, +254 712…) in
 *  the international form omnichannel stores; null when it is not one. */
export function toInternational(text: string): string | null {
  const t = text.replace(/[\s()-]/g, "");
  if (/^\+\d{9,15}$/.test(t)) return t;
  if (/^254\d{9}$/.test(t)) return `+${t}`;
  if (/^0\d{9}$/.test(t)) return `+254${t.slice(1)}`;
  if (/^[17]\d{8}$/.test(t)) return `+254${t}`;
  return null;
}

/** What was typed, as the searches to run in order; null when it is none of
 *  a phone number, an email or an id. An id could be either kind, so the
 *  investor id is tried first (what staff copy from the register). */
export function queriesFor(text: string): CustomerQuery[] | null {
  const t = text.trim();
  if (!t) return null;
  if (t.includes("@")) return [{ email: t.toLowerCase() }];
  if (UUID.test(t)) return [{ investorId: t }, { profileId: t }];
  const phone = toInternational(t);
  return phone ? [{ phone }] : null;
}
