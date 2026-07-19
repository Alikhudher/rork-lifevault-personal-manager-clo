/**
 * LifeVault Universal AI Document Understanding Engine.
 *
 * Not an ID scanner. A true intelligent document assistant that can understand
 * almost ANY document, image, or handwritten note the user uploads — and then
 * extract structured data, classify it, summarise it, answer follow-up
 * questions, and propose concrete follow-on actions (expense, calendar event,
 * reminder, filed document).
 *
 * Capabilities:
 *  - Vision + reasoning via `google/gemini-3-flash` on the Vercel AI Gateway.
 *  - Multilingual (English + Arabic + mixed) — instructed explicitly.
 *  - Handwritten text reading.
 *  - Multi-page: caller passes an array of page images; they're sent as
 *    multiple image parts in one request.
 *  - Multi-document: a single image may contain several documents (e.g. a
 *    photo of two receipts); the model returns one result per detected doc.
 *  - Entity extraction: dates, appointments, expiry/due dates, names,
 *    addresses, emails, phones, IDs, reference numbers, money + currency,
 *    medicines, legal clauses, education info, banking info, travel info.
 *  - Image enhancement: caller pre-enhances via `enhanceForOCR` for poor
 *    quality photos (grayscale + contrast stretch + unsharp mask).
 *  - Smart summary + structured data + follow-on actions.
 *  - Q&A: `askAboutScan` lets the user ask follow-up questions about a
 *    previously scanned document, using the captured text + entities as
 *    context so we don't re-send the image every time.
 *
 * Auth & transport: same as before — `Authorization: Bearer <TOOLKIT_SECRET>`
 * + `x-rork-app-key` header, endpoint `/v2/vercel/v1/chat/completions`.
 */
import {
  APPOINTMENT_REMINDERS,
  BILLING_FREQUENCIES,
  DOCUMENT_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  REMINDER_OPTIONS,
  type Appointment,
  type DocumentCategory,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
  type Subscription,
  type VaultDocument,
} from "./types";

/* ----------------------------- config ----------------------------- */

/*
 * Public AI gateway configuration.
 *
 * These values are PUBLIC (not secrets) — they are the same values Rork
 * injects as EXPO_PUBLIC_* env vars in the dev preview. They identify the
 * project to the Rork AI toolkit proxy and use the shared delegated-auth
 * token (`rork_web_delegated_auth`), which only authorizes gateway access
 * for this project's billed usage — it is not a user credential.
 *
 * We read them from Vite env vars first (so the Codemagic build / dashboard
 * can override them), then fall back to EXPO_PUBLIC_* (Rork dev injection),
 * then to the baked-in defaults below. The defaults guarantee that
 * production / TestFlight builds always have a working AI config even when
 * the EXPO_PUBLIC_* vars are not present in the CI environment — which is
 * what caused "AI features aren't configured for this build" in TestFlight.
 */
const DEFAULT_TOOLKIT_URL = "https://toolkit.rork.com";
const DEFAULT_APP_KEY = "rpk_p2samtqe2dbgg0rtbnht2cbcza07h7kn";
const DEFAULT_TOOLKIT_SECRET = "rork_web_delegated_auth";

const TOOLKIT_URL =
  (import.meta.env.VITE_TOOLKIT_URL as string | undefined) ??
  (import.meta.env.EXPO_PUBLIC_TOOLKIT_URL as string | undefined) ??
  DEFAULT_TOOLKIT_URL;

const CHAT_URL = `${TOOLKIT_URL}/v2/vercel/v1/chat/completions`;

/** Model verified via getModelUsage — vision + reasoning + multilingual. */
const MODEL_ID = "google/gemini-3-flash";

const APP_KEY =
  (import.meta.env.VITE_RORK_APP_KEY as string | undefined) ??
  (import.meta.env.EXPO_PUBLIC_RORK_APP_KEY as string | undefined) ??
  DEFAULT_APP_KEY;

const TOOLKIT_SECRET =
  (import.meta.env.VITE_RORK_TOOLKIT_SECRET_KEY as string | undefined) ??
  (import.meta.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY as string | undefined) ??
  DEFAULT_TOOLKIT_SECRET;

/* ----------------------------- types ----------------------------- */

/**
 * The universal document kind taxonomy. Open-ended by design — the model may
 * return any of these, and we group them into broader filing categories via
 * `kindToCategory`. `other` is the fallback for anything not on the list.
 */
export type DocKind =
  | "government"
  | "passport"
  | "national_id"
  | "driver_licence"
  | "vehicle_registration"
  | "immigration"
  | "medical_report"
  | "prescription"
  | "lab_result"
  | "vaccination"
  | "insurance"
  | "tax"
  | "legal_contract"
  | "court"
  | "police"
  | "bank_statement"
  | "credit_card_statement"
  | "utility_bill"
  | "receipt"
  | "invoice"
  | "payslip"
  | "employment_contract"
  | "school_document"
  | "university_document"
  | "certificate"
  | "diploma"
  | "student_id"
  | "report_card"
  | "handwritten_note"
  | "meeting_note"
  | "sticky_note"
  | "shopping_list"
  | "calendar"
  | "appointment_card"
  | "flight_ticket"
  | "boarding_pass"
  | "hotel_reservation"
  | "event_ticket"
  | "warranty"
  | "product_manual"
  | "business_card"
  | "qr_code"
  | "barcode"
  | "screenshot"
  | "printed_form"
  | "filled_form"
  | "pdf"
  | "scanned_document"
  | "other";

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  government: "Government document",
  passport: "Passport",
  national_id: "National ID",
  driver_licence: "Driver licence",
  vehicle_registration: "Vehicle registration",
  immigration: "Immigration document",
  medical_report: "Medical / Hospital report",
  prescription: "Prescription",
  lab_result: "Lab result",
  vaccination: "Vaccination record",
  insurance: "Insurance document",
  tax: "Tax document",
  legal_contract: "Legal contract",
  court: "Court document",
  police: "Police document",
  bank_statement: "Bank statement",
  credit_card_statement: "Credit card statement",
  utility_bill: "Utility bill",
  receipt: "Receipt",
  invoice: "Invoice",
  payslip: "Payslip",
  employment_contract: "Employment contract",
  school_document: "School document",
  university_document: "University document",
  certificate: "Certificate",
  diploma: "Diploma",
  student_id: "Student ID",
  report_card: "Report card",
  handwritten_note: "Handwritten note",
  meeting_note: "Meeting note",
  sticky_note: "Sticky note",
  shopping_list: "Shopping list",
  calendar: "Calendar",
  appointment_card: "Appointment card",
  flight_ticket: "Flight ticket",
  boarding_pass: "Boarding pass",
  hotel_reservation: "Hotel reservation",
  event_ticket: "Event ticket",
  warranty: "Warranty document",
  product_manual: "Product manual",
  business_card: "Business card",
  qr_code: "QR code",
  barcode: "Barcode",
  screenshot: "Screenshot",
  printed_form: "Printed form",
  filled_form: "Filled form",
  pdf: "PDF document",
  scanned_document: "Scanned document",
  other: "Document",
};

/** Maps a fine-grained DocKind into a LifeVault filing DocumentCategory. */
function kindToCategory(kind: DocKind): DocumentCategory {
  switch (kind) {
    case "passport":
    case "national_id":
      return "ID";
    case "driver_licence":
      return "Driver Licence";
    case "vehicle_registration":
      return "Vehicle";
    case "medical_report":
    case "prescription":
    case "lab_result":
    case "vaccination":
      return "Medical";
    case "insurance":
      return "Insurance";
    case "tax":
      return "Tax";
    case "legal_contract":
    case "court":
    case "police":
      return "Legal";
    case "immigration":
      return "Immigration";
    case "bank_statement":
    case "credit_card_statement":
      return "Banking";
    case "utility_bill":
      return "Bill";
    case "receipt":
      return "Receipt";
    case "invoice":
      return "Invoice";
    case "payslip":
      return "Payslip";
    case "employment_contract":
      return "Employment";
    case "school_document":
    case "university_document":
    case "report_card":
    case "student_id":
      return "Education";
    case "certificate":
    case "diploma":
      return "Certificate";
    case "warranty":
      return "Warranty";
    case "product_manual":
      return "Manual";
    case "flight_ticket":
    case "boarding_pass":
    case "hotel_reservation":
      return "Travel";
    case "event_ticket":
    case "appointment_card":
    case "calendar":
      return "Event";
    case "business_card":
      return "Business Card";
    case "handwritten_note":
    case "meeting_note":
    case "sticky_note":
    case "shopping_list":
      return "Note";
    case "printed_form":
    case "filled_form":
      return "Form";
    case "screenshot":
      return "Screenshot";
    case "qr_code":
    case "barcode":
    case "pdf":
    case "scanned_document":
    case "government":
    case "other":
    default:
      return "Other";
  }
}

/** Group label for chips in the UI — coarser than DocKind, friendlier. */
export type DocGroup =
  | "Identity"
  | "Medical"
  | "Money"
  | "Legal"
  | "Travel"
  | "Work"
  | "Education"
  | "Notes"
  | "Other";

export const DOC_GROUP_LABEL: Record<DocGroup, string> = {
  Identity: "Identity",
  Medical: "Medical",
  Money: "Money & Bills",
  Legal: "Legal",
  Travel: "Travel",
  Work: "Work",
  Education: "Education",
  Notes: "Notes",
  Other: "Other",
};

function kindToGroup(kind: DocKind): DocGroup {
  switch (kind) {
    case "passport":
    case "national_id":
    case "driver_licence":
    case "vehicle_registration":
    case "government":
      return "Identity";
    case "medical_report":
    case "prescription":
    case "lab_result":
    case "vaccination":
      return "Medical";
    case "bank_statement":
    case "credit_card_statement":
    case "utility_bill":
    case "receipt":
    case "invoice":
    case "payslip":
      return "Money";
    case "legal_contract":
    case "court":
    case "police":
    case "tax":
    case "immigration":
      return "Legal";
    case "flight_ticket":
    case "boarding_pass":
    case "hotel_reservation":
    case "event_ticket":
      return "Travel";
    case "employment_contract":
    case "business_card":
      return "Work";
    case "school_document":
    case "university_document":
    case "certificate":
    case "diploma":
    case "student_id":
    case "report_card":
      return "Education";
    case "handwritten_note":
    case "meeting_note":
    case "sticky_note":
    case "shopping_list":
    case "calendar":
    case "appointment_card":
      return "Notes";
    default:
      return "Other";
  }
}

/* ----------------------------- entities ----------------------------- */

/**
 * A typed entity extracted from the document. `type` lets the UI render
 * entities as chips with appropriate affordances (e.g. tap a phone to call).
 */
export type EntityType =
  | "date"
  | "appointment"
  | "expiry"
  | "due"
  | "reminder"
  | "name"
  | "address"
  | "email"
  | "phone"
  | "id_number"
  | "reference"
  | "money"
  | "medicine"
  | "legal_clause"
  | "education"
  | "banking"
  | "travel"
  | "url"
  | "other";

export interface ExtractedEntity {
  type: EntityType;
  label: string;
  /** Human-readable value (e.g. "A$ 1,234.56", "Dr. Sarah Lee"). */
  value: string;
  /** ISO date (yyyy-MM-dd) when the entity is date-like; otherwise null. */
  isoDate?: string | null;
  /** ISO time (HH:mm) when the entity is an appointment time; otherwise null. */
  isoTime?: string | null;
  /** Numeric amount when the entity is money; otherwise null. */
  amount?: number | null;
  /** Currency code (ISO 4217) when the entity is money; otherwise null. */
  currency?: string | null;
}

/* ----------------------------- actions ----------------------------- */

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

/* ----------------------------- scan result ----------------------------- */

export interface ScanResult {
  /** Stable id within a single scan (so multi-doc results can be tracked). */
  id: string;
  kind: DocKind;
  group: DocGroup;
  title: string;
  summary: string;
  /** Detected primary language(s), e.g. "en", "ar", "en+ar". */
  language: string;
  /** Confidence 0..1 — model's own self-assessment of recognition quality. */
  confidence: number;
  /** Free-form key/value pairs the UI renders as a detail list. */
  fields: { label: string; value: string }[];
  /** Typed entities for chip rendering + smart affordances. */
  entities: ExtractedEntity[];
  category: DocumentCategory;
  expiryDate: string | null;
  issueDate: string | null;
  /** Raw OCR'd/understood text, kept for follow-up Q&A. */
  text: string;
  suggestedActions: SuggestedAction[];
}

export interface ScanOutcome {
  /** One or more documents detected across all supplied pages. */
  documents: ScanResult[];
  /** The image data URLs used (enhanced), for the UI to display. */
  pages: string[];
}

/* ----------------------------- low-level chat ----------------------------- */

interface ChatChoice {
  message?: { content?: string };
}
interface ChatResponse {
  choices?: ChatChoice[];
}

/** Compact redacted summary of chat messages for diagnostic logging. */
function summarizeMessages(messages: unknown[]): string {
  try {
    return messages
      .map((m) => {
        const msg = m as { role?: string; content?: unknown };
        const role = msg.role ?? "?";
        const c = msg.content;
        if (typeof c === "string") return `${role}:text(${c.length})`;
        if (Array.isArray(c)) {
          const parts = c
            .map((p) => {
              const part = p as { type?: string; text?: string; image_url?: { url?: string } };
              if (part.type === "text") return `text(${(part.text ?? "").length})`;
              if (part.type === "image_url") {
                const url = part.image_url?.url ?? "";
                const size = url.startsWith("data:")
                  ? `~${Math.round((url.length * 3) / 4 / 1024)}KB`
                  : `${url.length}chars`;
                return `image(${size})`;
              }
              return part.type ?? "?";
            })
            .join(",");
          return `${role}:[${parts}]`;
        }
        return `${role}:?`;
      })
      .join(" | ");
  } catch {
    return "<unsummarizable>";
  }
}

/**
 * Low-level chat completion. Returns the assistant's text content.
 * Throws `AI_HTTP_ERROR` with status on non-2xx, `AI_EMPTY` on empty reply.
 *
 * NOTE: Do NOT send `response_format: { type: "json_object" }` for Gemini
 * models on the Vercel AI Gateway — it returns HTTP 400 when combined with
 * vision input. We rely on a strict system prompt + safeJsonParse.
 */
async function chatComplete(
  messages: unknown[],
  options?: {
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string> {
  if (!TOOLKIT_URL) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (APP_KEY) headers["x-rork-app-key"] = APP_KEY;
  if (TOOLKIT_SECRET) headers["Authorization"] = `Bearer ${TOOLKIT_SECRET}`;

  const body: Record<string, unknown> = {
    model: MODEL_ID,
    messages,
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.maxTokens ?? 2200,
  };

  const reqSummary = summarizeMessages(messages as unknown[]);
  console.info(
    `[ai] chatComplete -> ${CHAT_URL} | model=${MODEL_ID} | temp=${body.temperature} | max_tokens=${body.max_tokens} | msgs=${reqSummary}`,
  );

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    console.error(
      `[ai] HTTP ${res.status} from gateway | model=${MODEL_ID} | body=${detail.slice(0, 500)} | reqMsgs=${reqSummary}`,
    );
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

/* ----------------------------- JSON parsing ----------------------------- */

/**
 * Robustly extract a JSON object (or array of objects) from a model response.
 * Handles markdown fences, prose-wrapped JSON, trailing commas, single quotes.
 */
function safeJsonParse<T>(raw: string): T | null {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // continue
  }
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }
  // Try object first, then array.
  const obj = extractFirstJsonBlock(raw, "{", "}");
  if (obj) {
    try {
      return JSON.parse(obj) as T;
    } catch {
      try {
        return JSON.parse(cleanJsonString(obj)) as T;
      } catch {
        // continue
      }
    }
  }
  const arr = extractFirstJsonBlock(raw, "[", "]");
  if (arr) {
    try {
      return JSON.parse(arr) as T;
    } catch {
      try {
        return JSON.parse(cleanJsonString(arr)) as T;
      } catch {
        // give up
      }
    }
  }
  return null;
}

function extractFirstJsonBlock(s: string, open: string, close: string): string | null {
  const start = s.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

function cleanJsonString(s: string): string {
  return s
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/'([^']*)'/g, '"$1"');
}

/* ----------------------------- scan prompt ----------------------------- */

const SCAN_SYSTEM = `You are LifeVault's universal document understanding engine. You receive one or more photos from the user. Each photo may contain ONE or SEVERAL documents (e.g. two receipts in one photo, or multiple pages of one contract). Your job is to deeply understand every document present and return structured data.

You can recognise almost ANY document, including but not limited to: government documents, medical records, hospital reports, prescriptions, lab results, vaccination records, insurance documents, tax documents, legal contracts, court documents, police documents, immigration documents, passports, national IDs, driver licences, vehicle registrations, bank statements, credit card statements, utility bills, receipts, invoices, payslips, employment contracts, school documents, university documents, certificates, diplomas, student IDs, report cards, handwritten notes, meeting notes, sticky notes, shopping lists, calendars, appointment cards, flight tickets, boarding passes, hotel reservations, event tickets, warranty documents, product manuals, business cards, QR codes, barcodes, screenshots, printed forms, filled forms, PDFs, and scanned paper documents.

You must:
1. Detect how many distinct documents are present across all images. Return ONE result per document. If a single image clearly contains multiple separate documents (e.g. two receipts side by side), return multiple results. If multiple images are pages of the SAME document, return ONE result with combined fields.
2. Classify each document with the most specific "kind" from the allowed list below.
3. Read printed text AND handwritten text with high accuracy. Treat Arabic handwriting, mixed Arabic/English, and multilingual documents as first-class — preserve the original language(s) and set "language" accordingly (e.g. "en", "ar", "en+ar").
4. Understand the document's MEANING, not just the characters. Infer dates, appointments, reminders, expiry/due dates, names, addresses, emails, phones, ID/reference numbers, money + currency, medicines, legal clauses, education info, banking info, and travel info. Extract each as a typed entity.
5. Produce a concise smart summary (1-3 sentences) describing what the document is and why it matters.
6. Suggest follow-on actions ONLY when they genuinely make sense for the document kind:
   - Any document with a payment amount -> suggest an expense.
   - Appointment card / event ticket / flight / boarding pass / calendar / medical appointment -> suggest a calendar appointment.
   - Any formal document (ID, passport, licence, insurance, contract, medical, warranty, certificate, subscription, bill) -> suggest saving as a document.
   - Anything with an expiry/due date -> suggest a reminder.
   - Bills -> suggest both an expense AND a document.
7. Pick the closest filing "category" from the allowed enum.

Return ONLY a JSON object (no markdown, no prose) with this exact shape:
{
  "documents": [
    {
      "kind": "<one of the kinds listed below>",
      "title": "<short human title, max ~70 chars>",
      "summary": "<1-3 sentence description>",
      "language": "<language code(s)>",
      "confidence": <number 0..1>,
      "fields": [{"label": "...", "value": "..."}],
      "entities": [
        {"type": "<one of: date, appointment, expiry, due, reminder, name, address, email, phone, id_number, reference, money, medicine, legal_clause, education, banking, travel, url, other>", "label": "...", "value": "...", "isoDate": "yyyy-MM-dd" | null, "isoTime": "HH:mm" | null, "amount": number | null, "currency": "AUD|USD|EUR|..." | null}
      ],
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
      "text": "<the full OCR'd / understood text of the document, preserve line breaks, include handwritten content verbatim>"
    }
  ]
}

Allowed "kind" values: ${Object.keys(DOC_KIND_LABEL).join(", ")}.

Rules:
- Use ISO yyyy-MM-dd for all dates. Use null when not visible.
- Money "amount" must be a plain JSON number (no symbols).
- "category" must be one of the exact enum values listed.
- "paymentMethod" must be one of the exact enum values, or "" if unknown.
- Do NOT invent values that are not visible or reasonably inferable. Prefer null / empty string.
- Keep "fields" to the 4-10 most useful key/value pairs.
- "text" should be the readable content of the document — this is used for follow-up questions, so include all meaningful printed and handwritten text.
- For handwritten notes, "text" preserves the exact writing; "summary" interprets it.
- For QR/barcodes, decode the payload into "text" and "entities" if possible.
- Confidence reflects how clearly the document was read (1.0 = perfect, 0.3 = barely legible).`;

/* ----------------------------- raw -> ScanResult ----------------------------- */

interface RawEntity {
  type?: EntityType;
  label?: string;
  value?: string;
  isoDate?: string | null;
  isoTime?: string | null;
  amount?: number | null;
  currency?: string | null;
}

interface RawScanDoc {
  kind?: DocKind;
  title?: string;
  summary?: string;
  language?: string;
  confidence?: number;
  fields?: { label?: string; value?: string }[];
  entities?: RawEntity[];
  category?: DocumentCategory;
  expiryDate?: string | null;
  issueDate?: string | null;
  date?: string | null;
  amount?: number | null;
  merchant?: string;
  paymentMethod?: PaymentMethod;
  time?: string | null;
  location?: string;
  reminderDays?: (typeof REMINDER_OPTIONS)[number];
  text?: string;
}

interface RawScan {
  documents?: RawScanDoc[];
}

function coerceKind(k: string | undefined): DocKind {
  if (k && (Object.keys(DOC_KIND_LABEL) as string[]).includes(k)) {
    return k as DocKind;
  }
  return "other";
}

function coerceCategory(c: string | undefined, fallback: DocumentCategory): DocumentCategory {
  if (c && DOCUMENT_CATEGORIES.includes(c as DocumentCategory)) {
    return c as DocumentCategory;
  }
  return fallback;
}

function coercePaymentMethod(p: string | undefined): PaymentMethod {
  if (p && PAYMENT_METHODS.includes(p as PaymentMethod)) {
    return p as PaymentMethod;
  }
  return "Debit Card";
}

function coerceReminderDays(r: number | undefined): (typeof REMINDER_OPTIONS)[number] {
  if (r !== undefined && (REMINDER_OPTIONS as readonly number[]).includes(r)) {
    return r as (typeof REMINDER_OPTIONS)[number];
  }
  return 30;
}

/** Maps a raw scan document into a structured ScanResult + suggested actions. */
function buildScanResult(raw: RawScanDoc, index: number): ScanResult {
  const kind = coerceKind(raw.kind);
  const fallbackCategory = kindToCategory(kind);
  const category = coerceCategory(raw.category, fallbackCategory);
  const expiryDate = normalizeDate(raw.expiryDate);
  const issueDate = normalizeDate(raw.issueDate);
  const date = normalizeDate(raw.date);
  const amount =
    typeof raw.amount === "number" && isFinite(raw.amount) ? raw.amount : null;
  const merchant = (raw.merchant ?? "").trim();
  const paymentMethod = coercePaymentMethod(raw.paymentMethod);
  const reminderDays = coerceReminderDays(raw.reminderDays);
  const time = normalizeTime(raw.time) ?? "09:00";
  const location = (raw.location ?? "").trim();
  const language = (raw.language ?? "en").trim() || "en";
  const confidence =
    typeof raw.confidence === "number" && isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.7;
  const title = (raw.title ?? DOC_KIND_LABEL[kind]).trim();
  const summary = (raw.summary ?? "").trim();
  const text = (raw.text ?? "").trim();

  const fields: { label: string; value: string }[] = (raw.fields ?? [])
    .filter(
      (f): f is { label: string; value: string } =>
        typeof f.label === "string" && typeof f.value === "string",
    )
    .slice(0, 10);

  const entities: ExtractedEntity[] = (raw.entities ?? [])
    .filter((e) => e && typeof e.value === "string" && e.value.trim())
    .map((e) => ({
      type: e.type ?? "other",
      label: (e.label ?? "").trim() || (e.type ?? "other"),
      value: (e.value ?? "").trim(),
      isoDate: normalizeDate(e.isoDate) ?? null,
      isoTime: normalizeTime(e.isoTime) ?? null,
      amount:
        typeof e.amount === "number" && isFinite(e.amount) ? e.amount : null,
      currency: (e.currency ?? "").trim() || null,
    }))
    .slice(0, 24);

  const suggestedActions: SuggestedAction[] = [];

  // 1. Expense — when there's a payment amount.
  if (amount !== null && amount > 0) {
    suggestedActions.push({
      kind: "expense",
      amount,
      date: date ?? todayISO(),
      category: pickExpenseCategory(kind, merchant, entities),
      merchant: merchant || title || "Unknown",
      notes: summary,
      paymentMethod,
    });
  }

  // 2. Calendar appointment — when the document represents a dated event.
  const isEventLike =
    kind === "appointment_card" ||
    kind === "event_ticket" ||
    kind === "flight_ticket" ||
    kind === "boarding_pass" ||
    kind === "hotel_reservation" ||
    kind === "calendar";
  // Medical appointments: appointment cards or reports with a next-visit date.
  const hasAppointmentEntity = entities.some(
    (e) => e.type === "appointment" && (e.isoDate || e.isoTime),
  );
  if (isEventLike || (hasAppointmentEntity && (date || expiryDate))) {
    // Prefer an appointment entity's date/time when available.
    const appt = entities.find((e) => e.type === "appointment");
    const apptDate = appt?.isoDate ?? date ?? null;
    const apptTime = appt?.isoTime ?? time;
    if (apptDate) {
      suggestedActions.push({
        kind: "appointment",
        title,
        date: apptDate,
        time: apptTime,
        location,
        notes: summary,
        reminder: pickAppointmentReminder(kind),
      });
    }
  }

  // 3. Save as document — for formal / important documents.
  const isFormalDoc =
    kind !== "receipt" &&
    kind !== "handwritten_note" &&
    kind !== "sticky_note" &&
    kind !== "shopping_list" &&
    kind !== "qr_code" &&
    kind !== "barcode" &&
    kind !== "screenshot";
  if (isFormalDoc) {
    suggestedActions.push({
      kind: "document",
      name: title,
      category,
      issueDate,
      expiryDate,
      notes: summary,
      reminderDays,
    });
  }

  // 4. Reminder — anything with an expiry or due date.
  const dueEntity = entities.find((e) => e.type === "due" || e.type === "expiry" || e.type === "reminder");
  const reminderDate = dueEntity?.isoDate ?? expiryDate;
  if (reminderDate) {
    suggestedActions.push({
      kind: "reminder",
      title: `${title} — ${dueEntity?.type === "due" ? "due" : "expires"} ${reminderDate}`,
      date: reminderDate,
      notes: summary,
    });
  }

  return {
    id: `scan_${index}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    group: kindToGroup(kind),
    title,
    summary,
    language,
    confidence,
    fields,
    entities,
    category,
    expiryDate,
    issueDate,
    text,
    suggestedActions,
  };
}

function pickAppointmentReminder(kind: DocKind): string {
  if (kind === "flight_ticket" || kind === "boarding_pass") return "1 day before";
  if (kind === "medical_report" || kind === "appointment_card" || kind === "vaccination") {
    return "1 day before";
  }
  // Default: pick a sensible reminder from the APPOINTMENT_REMINDERS list.
  return APPOINTMENT_REMINDERS.includes("1 day before") ? "1 day before" : APPOINTMENT_REMINDERS[0];
}

function pickExpenseCategory(
  kind: DocKind,
  merchant: string,
  entities: ExtractedEntity[],
): ExpenseCategory {
  const m = merchant.toLowerCase();
  if (/electric|gas|water|internet|phone|energy|utility|nbn|optus|telstra|vodafone|agl|origin/.test(m))
    return "Bills";
  if (/fuel|shell|bp|caltex|7-eleven|ampol|exxon|mobil/.test(m)) return "Fuel";
  if (/woolworths|coles|iga|aldi|costco|supermarket|grocery/.test(m)) return "Food";
  if (/uber|lyft|taxi|train|bus|transport|opal|myki/.test(m)) return "Transport";
  if (/pharmacy|chemist|medical|clinic|dental|hospital/.test(m)) return "Health";
  if (/netflix|spotify|disney|stan|youtube|prime/.test(m)) return "Entertainment";
  // Hint from entities (e.g. a medicine entity → Health).
  if (entities.some((e) => e.type === "medicine")) return "Health";
  if (kind === "utility_bill") return "Bills";
  if (kind === "receipt" || kind === "invoice") return "Other";
  if (kind === "payslip") return "Other";
  if (kind === "medical_report" || kind === "prescription" || kind === "lab_result" || kind === "vaccination") {
    return "Health";
  }
  return "Other";
}

/* ----------------------------- response normalization ----------------------------- */

/**
 * Coerce whatever the model returned into the `{ documents: RawScanDoc[] }`
 * shape the rest of the pipeline expects. The prompt asks for a nested
 * `{ "documents": [...] }` object, but `google/gemini-3-flash` sometimes
 * returns any of these instead:
 *   - the requested `{ documents: [...] }` object
 *   - a bare array `[{...}, {...}]`
 *   - a single flat document object `{ kind, title, ... }` (no `documents` wrapper)
 *   - `{ documents: { ... } }` (object instead of array)
 * All of those are valid scans of a single document and must be accepted —
 * rejecting them is what caused the "Couldn't parse the AI response" regression.
 */
function normalizeScanResponse(raw: unknown): RawScan | null {
  if (!raw || typeof raw !== "object") return null;
  // Shape 1: the requested `{ documents: [...] }` object.
  if (Array.isArray((raw as RawScan).documents)) {
    return raw as RawScan;
  }
  // Shape 2: a bare array of document objects.
  if (Array.isArray(raw)) {
    const docs = raw.filter(
      (d): d is RawScanDoc => !!d && typeof d === "object" && !Array.isArray(d),
    );
    if (docs.length > 0) return { documents: docs };
    return null;
  }
  // Shape 3: `documents` is a single object, not an array — wrap it.
  const docsField = (raw as { documents?: unknown }).documents;
  if (docsField && typeof docsField === "object" && !Array.isArray(docsField)) {
    return { documents: [docsField as RawScanDoc] };
  }
  // Shape 4: a flat document object with no `documents` wrapper (recognized by
  // the presence of at least one scan field).
  const obj = raw as RawScanDoc;
  if (
    typeof obj.kind === "string" ||
    typeof obj.title === "string" ||
    typeof obj.summary === "string" ||
    Array.isArray(obj.fields) ||
    Array.isArray(obj.entities) ||
    typeof obj.category === "string" ||
    typeof obj.text === "string"
  ) {
    return { documents: [obj] };
  }
  return null;
}

/* ----------------------------- public: scanDocuments ----------------------------- */

/**
 * Scan one or more document photos and return a universal understanding
 * result. Each page is enhanced for OCR before being sent to the model.
 *
 * @param pages Array of image data URLs (one per captured page/photo).
 */
export async function scanDocuments(pages: string[]): Promise<ScanOutcome> {
  if (pages.length === 0) {
    throw new Error("AI_NO_PAGES");
  }
  const { enhanceForOCR } = await import("./enhance-image");
  // Enhance each page in parallel; enhancement falls back to the original
  // image on any internal error, so this never throws.
  const enhanced = await Promise.all(
    pages.map((p) => enhanceForOCR(p, 3_000_000).catch(() => ({ dataUrl: p, base64: "", mimeType: "image/jpeg" as const }))),
  );
  const imageParts = enhanced.map((e) => ({
    type: "image_url" as const,
    image_url: { url: e.dataUrl },
  }));

  const messages = [
    { role: "system", content: SCAN_SYSTEM },
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            pages.length === 1
              ? "Analyse this document and return the JSON object."
              : `Analyse these ${pages.length} pages and return the JSON object. Treat them as related pages of one document unless they are clearly different documents.`,
        },
        ...imageParts,
      ],
    },
  ];

  const raw = await chatComplete(messages, {
    temperature: 0.1,
    maxTokens: 3200,
  });
  let parsed = normalizeScanResponse(safeJsonParse<unknown>(raw));

  // Retry once with a stricter prompt if parsing failed.
  if (!parsed || !Array.isArray(parsed.documents) || parsed.documents.length === 0) {
    console.warn(
      `[ai] scan parse failed or empty, retrying with stricter prompt. Raw (first 800 chars): ${raw.slice(0, 800)}`,
    );
    const retryMessages = [
      {
        role: "system",
        content: `${SCAN_SYSTEM}\n\nIMPORTANT: Respond with ONLY a raw JSON object. No markdown, no code fences, no explanation — just the JSON object starting with { and ending with }. The "documents" array must contain at least one entry.`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Return only the JSON object now." },
          ...imageParts,
        ],
      },
    ];
    const retryRaw = await chatComplete(retryMessages, {
      temperature: 0,
      maxTokens: 3200,
    });
    parsed = normalizeScanResponse(safeJsonParse<unknown>(retryRaw));
  }

  if (!parsed || !Array.isArray(parsed.documents) || parsed.documents.length === 0) {
    throw new Error("AI_PARSE_FAILED");
  }

  const documents = parsed.documents.map((d, i) => buildScanResult(d, i));
  return {
    documents,
    pages: enhanced.map((e) => e.dataUrl),
  };
}

/** Backwards-compatible single-page entry point. */
export async function scanDocument(imageDataUrl: string): Promise<ScanResult> {
  const outcome = await scanDocuments([imageDataUrl]);
  return outcome.documents[0];
}

/* ----------------------------- public: askAboutScan ----------------------------- */

export interface AskContext {
  /** The document's understood text (from ScanResult.text). */
  text: string;
  /** Its summary + kind + entities, as concise context. */
  kind: DocKind;
  title: string;
  summary: string;
  entities: ExtractedEntity[];
}

const ASK_SYSTEM = `You are LifeVault's document assistant. The user has scanned a document and is asking a follow-up question about it. You receive the document's understood text, a summary, and extracted entities as context.

Answer clearly and concisely in the SAME LANGUAGE the user asks in (English or Arabic). If the answer is not in the document, say so plainly — do not invent information. When the answer references a specific value (a date, an amount, a name), quote it exactly.

Respond with a JSON object only (no markdown, no prose):
{
  "answer": "<1-4 sentence direct answer>",
  "actions": [
    // Optional: suggested follow-on actions if the question reveals a new
    // appointment, expense, reminder, or document that should be filed.
    // Same action shapes as the scan engine. Omit "actions" if none apply.
  ]
}`;

interface RawAsk {
  answer?: string;
  actions?: SuggestedAction[];
}

/**
 * Answer a follow-up question about a previously scanned document.
 * Uses the captured text + entities as context so we don't re-send the image.
 */
export async function askAboutScan(
  question: string,
  ctx: AskContext,
): Promise<{ answer: string; actions: SuggestedAction[] }> {
  const entityLines = ctx.entities
    .map((e) => `- ${e.label}: ${e.value}${e.isoDate ? ` (${e.isoDate})` : ""}`)
    .join("\n");
  const context = [
    `DOCUMENT KIND: ${ctx.kind}`,
    `TITLE: ${ctx.title}`,
    `SUMMARY: ${ctx.summary}`,
    `ENTITIES:\n${entityLines || "(none)"}`,
    `TEXT:\n${ctx.text || "(no text captured)"}`,
  ].join("\n\n");

  const messages = [
    { role: "system", content: ASK_SYSTEM },
    {
      role: "user",
      content: `DOCUMENT CONTEXT:\n${context}\n\nQUESTION:\n${question}`,
    },
  ];

  const raw = await chatComplete(messages, {
    temperature: 0.2,
    maxTokens: 900,
  });
  const parsed = safeJsonParse<RawAsk>(raw);
  if (!parsed) {
    console.warn(
      `[ai] ask parse failed. Raw (first 600 chars): ${raw.slice(0, 600)}`,
    );
    // Fall back to treating the raw text as the answer.
    return { answer: raw.trim(), actions: [] };
  }
  const answer = (parsed.answer ?? "").trim() || "I couldn't find that in the document.";
  const actions = Array.isArray(parsed.actions) ? parsed.actions.filter(isValidAction) : [];
  return { answer, actions };
}

function isValidAction(a: unknown): a is SuggestedAction {
  if (!a || typeof a !== "object") return false;
  const kind = (a as { kind?: string }).kind;
  return kind === "expense" || kind === "appointment" || kind === "document" || kind === "reminder";
}

/* ----------------------------- natural-language search ----------------------------- */

export interface VaultSnapshot {
  documents: VaultDocument[];
  expenses: Expense[];
  subscriptions: Subscription[];
  appointments: Appointment[];
}

export interface SearchMatch {
  type: "document" | "expense" | "subscription" | "appointment";
  id: string;
  label: string;
  sub: string;
}

export interface SearchResults {
  answer: string;
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

const SEARCH_SYSTEM = `You are LifeVault's natural-language search assistant. The user asks a question about their own saved data; you receive a snapshot of their vault as context. Answer in the user's language (English or Arabic).

Return JSON only (no markdown, no prose):
{
  "answer": "<1-3 sentence direct answer referencing concrete items. If nothing matches, say so plainly.>",
  "matchIds": ["<id1>", "<id2>", ...]
}

Rules:
- "matchIds" must be IDs that actually appear in the context, ranked most-relevant-first. Max 12.
- Never invent IDs.`;

interface RawSearch {
  answer?: string;
  matchIds?: string[];
}

function buildSearchMatches(matchIds: string[], vault: VaultSnapshot): SearchMatch[] {
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
  const raw = await chatComplete(messages, {
    temperature: 0.2,
    maxTokens: 800,
  });
  const parsed = safeJsonParse<RawSearch>(raw);
  if (!parsed) {
    console.warn(
      `[ai] search parse failed. Raw (first 600 chars): ${raw.slice(0, 600)}`,
    );
    throw new Error("AI_PARSE_FAILED");
  }
  const answer =
    (parsed.answer ?? "").trim() || "I couldn't find anything matching that.";
  const matches = buildSearchMatches(parsed.matchIds ?? [], vault);
  return { answer, matches };
}

/* ----------------------------- date utilities ----------------------------- */

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
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

/* ----------------------------- re-exports ----------------------------- */

export { DOC_KIND_LABEL as SCAN_KIND_LABEL, DOC_GROUP_LABEL as SCAN_GROUP_LABEL };
export type { DocumentCategory, ExpenseCategory };
export { DOCUMENT_CATEGORIES, EXPENSE_CATEGORIES, BILLING_FREQUENCIES, APPOINTMENT_REMINDERS };
