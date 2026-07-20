import type { DeviceSession, Settings } from "./types";

/**
 * Defaults for a brand-new install.
 *
 * LifeVault ships with NO demo/sample data: a new user starts with an empty
 * vault — no documents, expenses, subscriptions, appointments or
 * notifications — and no monthly budget until they set one themselves.
 */
export const DEFAULT_SETTINGS: Settings = {
  currency: "AUD",
  darkMode: false,
  biometric: false,
  monthlyBudget: 0,
  language: "en",
  notifications: {
    documents: true,
    subscriptions: true,
    bills: true,
    appointments: true,
    budget: true,
  },
};

/** Best-effort label for the device the app is currently running on. */
function deviceLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android device";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "This device";
}

/**
 * The single session a fresh install starts with — the device in hand.
 * This is real data (it describes the current device), not a demo record.
 */
export function currentDeviceSession(): DeviceSession {
  return {
    id: "ses_this_device",
    device: deviceLabel(),
    location: "This device",
    app: "LifeVault · 1.0",
    lastActive: new Date().toISOString(),
    current: true,
  };
}

/* ------------------------------------------------------------------ */
/* Demo-data purge (pre-release installs only)                         */
/*                                                                     */
/* Earlier builds seeded sample documents, expenses, subscriptions,    */
/* appointments, notifications, fake device sessions, a demo account   */
/* and a $3,800 budget. The registries below let AppContext strip that */
/* data from installs that persisted it (e.g. TestFlight devices).     */
/* User-created ids come from uid() and look like                      */
/* "exp_<timestamp36>_<counter>", so exact matches are always demo.    */
/* ------------------------------------------------------------------ */

/** Email of the demo account earlier builds seeded into the registry. */
export const DEMO_ACCOUNT_EMAIL = "mia.thompson@example.com";

/** Monthly budget value earlier builds seeded by default. */
export const DEMO_DEFAULT_BUDGET = 3800;

/** Fake device-session ids earlier builds seeded. */
export const DEMO_SESSION_IDS: ReadonlySet<string> = new Set([
  "ses_current",
  "ses_ipad",
  "ses_macbook",
  "ses_windows",
]);

/** Exact record ids seeded by pre-release builds. */
export const DEMO_RECORD_IDS: ReadonlySet<string> = new Set([
  // Documents
  "doc_passport",
  "doc_licence",
  "doc_home_insurance",
  "doc_car_rego",
  "doc_medicare",
  "doc_employment",
  "doc_degree",
  "doc_macbook",
  // Expenses (exp_1 … exp_15)
  ...Array.from({ length: 15 }, (_, i) => `exp_${i + 1}`),
  // Subscriptions
  "sub_netflix",
  "sub_spotify",
  "sub_icloud",
  "sub_gym",
  "sub_prime",
  "sub_adobe",
  "sub_nrma_car",
  "sub_stan",
  "sub_youfoodz",
  // Appointments
  "apt_dentist",
  "apt_car",
  "apt_gp",
  "apt_lease",
  "apt_haircut",
  "apt_accountant",
  // Notifications (ntf_1 … ntf_8)
  ...Array.from({ length: 8 }, (_, i) => `ntf_${i + 1}`),
]);
