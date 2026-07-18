/**
 * LifeVault AI Assistant — service layer.
 *
 * Two capabilities backed by the Rork AI Gateway (Vercel AI Gateway proxy):
 *  - `scanDocument(imageDataUrl)` — vision LLM classifies a photo and extracts
 *    structured fields (title, dates, amount, merchant, etc.), then proposes
 *    follow-on actions the user can accept (add expense / calendar event /
 *    document / reminder).
 *  - `naturalLanguageSearch(query, vault)` — text LLM answers a natural-language
 *    question over the user's saved vault by searching the provided snapshot.
 *
 * Model: `google/gemini-3-flash` (vision + reasoning + tool-use, ~$0.50/M input,
 * ~$3/M output, ~800ms p50). Verified via getModelUsage — endpoint
 * /v2/vercel/v1/chat/completions, accepts image input via OpenAI-style
 * content parts with `image_url`. Both scan and search use the same model for
 * consistency; the scan path sends an image part, the search path is text-only.
 *
 * Auth: on web/preview builds the Rork runtime injects a delegated bearer, so
 * we omit `Authorization`. Native builds would set the toolkit secret, but
 * this app ships as a web/PWA + iOS Capacitor shell where the runtime handles
 * it. We don't inline the secret key.
 */
import {
  DOCUMENT_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  BILLING_FREQUENCIES,
  REMINDER_OPTIONS,
  APPOINTMENT_REMINDERS,
  type Appointment,
  type DocumentCategory,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
  type Subscription,
  type VaultDocument,
} from "./types";

/** Rork Toolkit base URL. Same for all calls. */
const TOOLKIT_URL =
  (import.meta.env.VITE_TOOLKIT_URL as string | undefined) ??
  (import.meta.env.EXPO_PUBLIC_TOOLKIT_URL as string | undefined) ??
  "";

/** Chat-completions endpoint on the Vercel AI Gateway proxy. */
const CHAT_URL = `${TOOLKIT_URL}/v2/vercel/v1/chat/completions`;

/** Model ID verified via listAvailableModels + getModelUsage. */
const MODEL_ID = "google/gemini-3-flash";

/** Public, non-secret app key for routing/quotas (exposed to client by design). */
const APP_KEY =
  (import.meta.env.VITE_RORK_APP_KEY as string | undefined) ??
  (import.meta.env.EXPO_PUBLIC_RORK_APP_KEY as string | undefined) ??
  "";

/** ---------- Types ---------- */

export type DocKind =
  | "receipt"
  | "invoice"
  | "passport"
  | "id"
  | "driver_licence"
  | "contract"
  | "medical"
  | "event"
  | "ticket"
  | "subscription"
  | "bill"
  | "other";

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  receipt: "Receipt",
  invoice: "Invoice",
  passport: "Passport",
  id: "ID card",
  driver_licence: "Driver licence",
  contract: "Contract",
  medical: "Medical document",
  event: "Event / Appointment",
  ticket: "Ticket",
  subscription: "Subscription",
  bill: "Bill",
  other: "Document",
};

/** Suggested follow-on actions the user can accept with one tap. */
export type SuggestedAction =
  | {
      kind: "expense";
      amount: number | null;
      date: string | null; // yyyy-MM-dd
      category: ExpenseCategory;
      merchant: string;
      notes: string;
      paymentMethod: PaymentMethod;
    }
  | {
      kind: "appointment";
      title: string;
      date: string | null; // yyyy-MM-dd
      time: string; // HH:mm
      location: string;
      notes: string;
      reminder: string;
    }
  | {
      kind: "document";
      name: string;
      category: DocumentCategory;
      issueDate: string | null;
      expiryDate: string | null;
      notes: string;
      reminderDays: (typeof REMINDER_OPTIONS)[number];
    }
  | {
      kind: "reminder";
      title: string;
      date: string; // yyyy-MM-dd
      notes: string;
    };

export interface ScanResult {
  kind: DocKind;
  title: string;
  summary: string;
  /** Free-form extracted fields the UI renders as a key/value list. */
  fields: { label: string; value: string }[];
  category: DocumentCategory;
  expiryDate: string | null;
  suggestedActions: SuggestedAction[];
}

/** ---------- Helpers ---------- */

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Model sometimes wraps JSON in fences or prose. Try to slice out the
    // first {...} block.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

interface ChatChoice {
  message?: { content?: string };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

/**
 * Low-level chat completion. Returns the assistant's text content.
 * Throws `AI_HTTP_ERROR` with status on non-2xx, `AI_EMPTY` on empty reply.
 */
async function chatComplete(
  messages: unknown[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  if (!TOOLKIT_URL) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (APP_KEY) headers["x-rork-app-key"] = APP_KEY;

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL_ID,
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 1500,
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    const err = new Error(
      `AI_HTTP_${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as ChatResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("AI_EMPTY");
  return text;
}

/** ---------- Document scan ---------- */

interface RawScan {
  kind?: DocKind;
  title?: string;
  summary?: string;
  fields?: { label?: string; value?: string }[];
  category?: DocumentCategory;
  expiryDate?: string | null;
  amount?: number | null;
  date?: string | null;
  merchant?: string;
  paymentMethod?: PaymentMethod;
  issueDate?: string | null;
  reminderDays?: (typeof REMINDER_OPTIONS)[number];
  time?: string;
  location?: string;
}

const SCAN_SYSTEM = `You are LifeVault's document scanner. You receive one photo from the user and must:
1. Classify it as exactly one of: receipt, invoice, passport, id, driver_licence, contract, medical, event, ticket, subscription, bill, other.
2. Extract the most relevant structured fields (e.g. title, date, amount, merchant, expiry date, issue date, location, time, name on document, document number, policy number, event name).
3. Pick the closest LifeVault document category for filing.
4. Build suggested follow-on actions the user may accept with one tap, ONLY when the detected kind makes them relevant:
   - receipt / invoice / bill  -> suggest an expense (and a document if it has an expiry or is a formal record)
   - event                      -> suggest a calendar appointment
   - passport / id / driver_licence / contract / medical / subscription -> suggest a document; if it has an expiry date, ALSO suggest a reminder
   - ticket                     -> suggest a calendar appointment (event date) AND a document (the ticket itself)

Return ONLY a JSON object with this shape (no markdown, no prose):
{
  "kind": "<one of the kinds above>",
  "title": "<short human title, max ~60 chars>",
  "summary": "<1-2 sentence description of what this is>",
  "fields": [{"label": "Merchant", "value": "Coles"}, ...],
  "category": "<one of: ${DOCUMENT_CATEGORIES.join(", ")}>",
  "expiryDate": "yyyy-MM-dd" | null,
  "issueDate": "yyyy-MM-dd" | null,
  "date": "yyyy-MM-dd" | null,
  "amount": number | null,
  "merchant": "<name or empty string>",
  "paymentMethod": "<one of: ${PAYMENT_METHODS.join(", ")}">,
  "time": "HH:mm" | null,
  "location": "<text or empty string>",
  "reminderDays": <one of: ${REMINDER_OPTIONS.join(", ")}>
}

Rules:
- Use ISO yyyy-MM-dd for all dates. If a date is not visible, use null.
- Numbers must be plain JSON numbers (no currency symbols).
- "category" must be one of the exact enum values listed.
- "paymentMethod" must be one of the exact enum values, or omit if unknown.
- Do not invent values that are not visible in the image. Prefer null / empty string.
- Keep "fields" to the 4-8 most useful key/value pairs.`;

/** Maps a raw scan into structured ScanResult + suggested actions. */
function buildScanResult(raw: RawScan): ScanResult {
  const kind: DocKind = raw.kind ?? "other";
  const category: DocumentCategory =
    raw.category && DOCUMENT_CATEGORIES.includes(raw.category)
      ? raw.category
      : "Other";
  const expiryDate = normalizeDate(raw.expiryDate);
  const issueDate = normalizeDate(raw.issueDate);
  const date = normalizeDate(raw.date);
  const amount =
    typeof raw.amount === "number" && isFinite(raw.amount) ? raw.amount : null;
  const merchant = (raw.merchant ?? "").trim();
  const paymentMethod =
    raw.paymentMethod && PAYMENT_METHODS.includes(raw.paymentMethod)
      ? raw.paymentMethod
      : "Debit Card";
  const reminderDays =
    raw.reminderDays && REMINDER_OPTIONS.includes(raw.reminderDays)
      ? raw.reminderDays
      : 30;
  const time = normalizeTime(raw.time) ?? "09:00";
  const location = (raw.location ?? "").trim();

  const fields: { label: string; value: string }[] = (raw.fields ?? [])
    .filter(
      (f): f is { label: string; value: string } =>
        typeof f.label === "string" && typeof f.value === "string",
    )
    .slice(0, 8);

  const suggestedActions: SuggestedAction[] = [];

  // Receipt / invoice / bill -> expense.
  if (
    (kind === "receipt" || kind === "invoice" || kind === "bill") &&
    amount !== null
  ) {
    suggestedActions.push({
      kind: "expense",
      amount,
      date: date ?? todayISO(),
      category: pickExpenseCategory(kind, merchant),
      merchant: merchant || "Unknown merchant",
      notes: raw.title ?? "",
      paymentMethod,
    });
  }

  // Event / ticket -> appointment.
  if (kind === "event" || kind === "ticket") {
    suggestedActions.push({
      kind: "appointment",
      title: raw.title ?? "Event",
      date: date ?? todayISO(),
      time,
      location,
      notes: raw.summary ?? "",
      reminder: "1 day before",
    });
  }

  // Important documents -> save in Documents.
  if (
    kind === "passport" ||
    kind === "id" ||
    kind === "driver_licence" ||
    kind === "contract" ||
    kind === "medical" ||
    kind === "subscription" ||
    kind === "ticket" ||
    kind === "bill"
  ) {
    suggestedActions.push({
      kind: "document",
      name: raw.title ?? DOC_KIND_LABEL[kind],
      category,
      issueDate,
      expiryDate,
      notes: raw.summary ?? "",
      reminderDays,
    });
  }

  // Expiry -> reminder.
  if (expiryDate) {
    suggestedActions.push({
      kind: "reminder",
      title: `${raw.title ?? "Document"} expires ${expiryDate}`,
      date: expiryDate,
      notes: raw.summary ?? "",
    });
  }

  return {
    kind,
    title: raw.title ?? DOC_KIND_LABEL[kind],
    summary: raw.summary ?? "",
    fields,
    category,
    expiryDate,
    suggestedActions,
  };
}

function pickExpenseCategory(
  kind: DocKind,
  merchant: string,
): ExpenseCategory {
  const m = merchant.toLowerCase();
  if (/electric|gas|water|internet|phone|energy|utility|nbn|optus|telstra|vodafone|agl|origin/.test(m))
    return "Bills";
  if (/fuel|shell|bp|caltex|7-eleven|ampol|exxon|mobil/.test(m)) return "Fuel";
  if (/woolworths|coles|iga|aldi|costco|supermarket|grocery/.test(m))
    return "Food";
  if (/uber|lyft|taxi|train|bus|transport|opal|myki/.test(m)) return "Transport";
  if (/pharmacy|chemist|medical|clinic|dental|hospital/.test(m)) return "Health";
  if (/netflix|spotify|disney|stan|youtube|prime/.test(m)) return "Entertainment";
  if (kind === "bill") return "Bills";
  if (kind === "invoice") return "Other";
  return "Other";
}

/** ---------- Public: scanDocument ---------- */

export async function scanDocument(imageDataUrl: string): Promise<ScanResult> {
  // Inline the image as an OpenAI-style image_url content part. The Vercel AI
  // Gateway accepts data URLs for vision models. We resize first to stay
  // under the 4.5MB body limit (see resize-for-ai.ts).
  const { resizeForAI } = await import("./resize-for-ai");
  const { base64 } = await resizeForAI(imageDataUrl, 3_000_000);
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const messages = [
    { role: "system", content: SCAN_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: "Scan this image and return the JSON object." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  const raw = await chatComplete(messages, { temperature: 0.1, maxTokens: 1200 });
  const parsed = safeJsonParse<RawScan>(raw);
  if (!parsed) {
    throw new Error("AI_PARSE_FAILED");
  }
  return buildScanResult(parsed);
}

/** ---------- Natural-language search ---------- */

export interface VaultSnapshot {
  documents: VaultDocument[];
  expenses: Expense[];
  subscriptions: Subscription[];
  appointments: Appointment[];
}

export interface SearchMatch {
  type: "document" | "expense" | "subscription" | "appointment";
  id: string;
  /** Short human label for the result row. */
  label: string;
  /** Secondary line (date, amount, status, etc.). */
  sub: string;
}

export interface SearchResults {
  /** Short natural-language answer to the user's question. */
  answer: string;
  /** Matching items from the vault, ranked by relevance. */
  matches: SearchMatch[];
}

function vaultToContext(v: VaultSnapshot): string {
  const lines: string[] = [];
  lines.push(`DOCUMENTS (${v.documents.length}):`);
  for (const d of v.documents) {
    lines.push(
      `- id=${d.id} | ${d.name} | category=${d.category} | issued=${d.issueDate ?? "n/a"} | expires=${d.expiryDate ?? "n/a"} | notes=${d.notes}`,
    );
  }
  lines.push(`EXPENSES (${v.expenses.length}):`);
  for (const e of v.expenses) {
    lines.push(
      `- id=${e.id} | ${e.merchant} | amount=${e.amount} | date=${e.date} | category=${e.category} | method=${e.paymentMethod} | notes=${e.notes}`,
    );
  }
  lines.push(`SUBSCRIPTIONS (${v.subscriptions.length}):`);
  for (const s of v.subscriptions) {
    lines.push(
      `- id=${s.id} | ${s.name} | price=${s.price} | freq=${s.frequency} | next=${s.nextPaymentDate} | category=${s.category} | status=${s.status}`,
    );
  }
  lines.push(`APPOINTMENTS (${v.appointments.length}):`);
  for (const a of v.appointments) {
    lines.push(
      `- id=${a.id} | ${a.title} | date=${a.date} | time=${a.time} | location=${a.location} | reminder=${a.reminder}`,
    );
  }
  return lines.join("\n");
}

const SEARCH_SYSTEM = `You are LifeVault's natural-language search assistant. The user asks a question about their own saved data; you receive a snapshot of their vault as context.

Answer in two parts, as JSON only (no markdown, no prose):
{
  "answer": "<1-3 sentence direct answer to the question, referencing concrete items from the vault. If nothing matches, say so plainly.>",
  "matchIds": ["<id1>", "<id2>", ...]
}

Rules:
- "matchIds" must be the IDs of the items most relevant to the question, ranked most-relevant-first. Maximum 12.
- Only include IDs that actually appear in the context.
- If the user asks "when does X expire?" and X is in the vault, put the expiry date in "answer" and X's id in "matchIds".
- If the user asks for "all X" (e.g. all electricity bills), include every matching item.
- Never invent IDs or items not in the context.`;

interface RawSearch {
  answer?: string;
  matchIds?: string[];
}

function buildSearchMatches(
  matchIds: string[],
  vault: VaultSnapshot,
): SearchMatch[] {
  const byId = new Map<string, SearchMatch>();
  for (const d of vault.documents) {
    byId.set(d.id, {
      type: "document",
      id: d.id,
      label: d.name,
      sub: `${d.category}${d.expiryDate ? ` · expires ${d.expiryDate}` : ""}`,
    });
  }
  for (const e of vault.expenses) {
    byId.set(e.id, {
      type: "expense",
      id: e.id,
      label: e.merchant,
      sub: `${e.category} · ${e.date.slice(0, 10)} · ${e.amount}`,
    });
  }
  for (const s of vault.subscriptions) {
    byId.set(s.id, {
      type: "subscription",
      id: s.id,
      label: s.name,
      sub: `${s.frequency} · next ${s.nextPaymentDate} · ${s.status}`,
    });
  }
  for (const a of vault.appointments) {
    byId.set(a.id, {
      type: "appointment",
      id: a.id,
      label: a.title,
      sub: `${a.date} · ${a.time}${a.location ? ` · ${a.location}` : ""}`,
    });
  }
  const out: SearchMatch[] = [];
  for (const id of matchIds) {
    const m = byId.get(id);
    if (m) out.push(m);
  }
  return out;
}

export async function naturalLanguageSearch(
  query: string,
  vault: VaultSnapshot,
): Promise<SearchResults> {
  const ctx = vaultToContext(vault);
  const messages = [
    { role: "system", content: SEARCH_SYSTEM },
    {
      role: "user",
      content: `VAULT SNAPSHOT:\n${ctx}\n\nQUESTION:\n${query}`,
    },
  ];
  const raw = await chatComplete(messages, { temperature: 0.2, maxTokens: 800 });
  const parsed = safeJsonParse<RawSearch>(raw);
  if (!parsed) {
    throw new Error("AI_PARSE_FAILED");
  }
  const answer =
    (parsed.answer ?? "").trim() || "I couldn't find anything matching that.";
  const matches = buildSearchMatches(parsed.matchIds ?? [], vault);
  return { answer, matches };
}

/** ---------- Date utilities ---------- */

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Accept yyyy-MM-dd directly.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (isFinite(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function normalizeTime(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(":").map(Number);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  return null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Re-exported for the UI to render kind labels. */
export { DOC_KIND_LABEL as SCAN_KIND_LABEL };
export type { DocumentCategory, ExpenseCategory };
export { DOCUMENT_CATEGORIES, EXPENSE_CATEGORIES, BILLING_FREQUENCIES, APPOINTMENT_REMINDERS };
