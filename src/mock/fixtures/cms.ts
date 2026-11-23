export type ContentApp = "investor" | "bo-admin" | "trustee" | "cms" | "ifa" | "payment-ops";

export type ContentBlock = {
  key: string;
  app: ContentApp;
  label: string;
  /** Where this text shows up in the live app — shown to CMS editors so they don't have to guess. */
  hint?: string;
  locale: "en" | "sw";
  value: Record<string, unknown>;
  updatedAt: string;
  status: "published" | "draft";
};

export const CONTENT_BLOCKS: ContentBlock[] = [
  {
    key: "dashboard",
    app: "bo-admin",
    label: "Dashboard — subtitle",
    hint: "Subtitle under the 'Dashboard' page title.",
    locale: "en",
    value: { subtitle: "Nawiri Digital Tea Payment Solution" },
    updatedAt: "2026-06-01T09:00:00Z",
    status: "published",
  },
  {
    key: "suitability_banner",
    app: "bo-admin",
    label: "Suitability queue — risk banner",
    hint: "Explanatory banner at the top of the Suitability queue page.",
    locale: "en",
    value: {
      text: "The product's self-service, KES-100 onboarding runs against the standard suitability SOP. Below-threshold scores route here rather than auto-activating — this queue is the manual bridge until Compliance approves a simplified pathway for this packaged product.",
    },
    updatedAt: "2026-08-01T09:00:00Z",
    status: "published",
  },
  {
    key: "regulatory_footer",
    app: "bo-admin",
    label: "Regulatory footer",
    hint: "Small print at the bottom of the sidebar.",
    locale: "en",
    value: { text: "Nawiri Digital Tea Payment Solution." },
    updatedAt: "2026-07-15T09:00:00Z",
    status: "published",
  },
];
