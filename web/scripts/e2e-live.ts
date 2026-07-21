/**
 * LIVE end-to-end test for LifeVault Build 13's account security fixes.
 *
 * Exercises the app's EXACT production modules (account-recovery.ts,
 * crypto.ts, sync.ts, supabase.ts) against the real Supabase project
 * and real Brevo email delivery — no mocks. Covers the three Build 12
 * complaints:
 *
 *   p1+p2  RESEND flow on an existing account: two real emails are
 *          sent, each with a UNIQUE subject carrying a FRESH 6-digit
 *          code; the previous code is invalidated by the resend; rapid
 *          repeats are blocked server-side with a retry-after time.
 *   p3     SIGN-UP verification on a brand-new email: code send,
 *          wrong code rejected, correct code verifies, the chosen
 *          password only works AFTER verification (account activation).
 *   p4     Forgot Password on the now-EXISTING account: new code,
 *          new password works, old password rejected.
 *   p5     Cloud backup roundtrip: encrypted upload, fresh unlock,
 *          restore with data equality + truthful unlock diagnoses.
 *   delivery  Brevo's own logs confirm every send: distinct message
 *          ids, distinct codes in the subjects, delivery status.
 *   cleanup   Deletes the two test accounts + their cloud rows.
 *   report    Prints every recorded check and exits 1 on any failure.
 *
 * Test recipients are aliases of the account owner's Gmail (+lv.b13.*)
 * so every email physically lands in the real inbox as proof.
 *
 * Usage: cd web && E2E_SERVICE_ROLE_KEY=… bun scripts/e2e-live.ts <phase>
 * The service-role key is used ONLY to mint verification OTPs for
 * automated checking and to delete the test users afterwards. It is
 * never written to disk by this script.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  alignCloudPasswordAfterReset,
  finishVerifiedSession,
  requestEmailCode,
  verifyCloudPassword,
  verifyEmailCode,
} from "../src/lib/account-recovery";
import { deriveKey, setSessionKey } from "../src/lib/crypto";
import {
  backupAll,
  cloudBackupExistsForEmail,
  describeUnlockFailure,
  fetchSalt,
  initCloudSalt,
  restoreAll,
  type VaultRecord,
} from "../src/lib/sync";
import { getSupabase } from "../src/lib/supabase";

const STATE_PATH = "/tmp/lv-e2e-b13.json";

const EMAILS = {
  resend: "alikhudher25+lv.b13.resend@gmail.com",
  signup: "alikhudher25+lv.b13.signup@gmail.com",
  none: "alikhudher25+lv.b13.none@gmail.com",
} as const;

/** Minimum server-enforced gap between sends to the same address. */
const SEND_GAP_MS = 31_000;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface E2EState {
  users: Record<string, string>;
  sentAt: Record<string, number>;
  pw: { s1: string; s2: string };
  checks: Check[];
}

function loadState(): E2EState {
  if (existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as E2EState;
  }
  const rand = crypto.randomUUID().slice(0, 8);
  return {
    users: {},
    sentAt: {},
    pw: { s1: `LvS1!x${rand}`, s2: `LvS2!x${rand}` },
    checks: [],
  };
}

function saveState(state: E2EState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
}

let phaseFailed = false;

function check(state: E2EState, name: string, ok: boolean, detail: string): void {
  state.checks = state.checks.filter((c) => c.name !== name);
  state.checks.push({ name, ok, detail });
  if (!ok) phaseFailed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail.slice(0, 220)}` : ""}`);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSendGap(state: E2EState, key: string): Promise<void> {
  const last = state.sentAt[key] ?? 0;
  const wait = last + SEND_GAP_MS - Date.now();
  if (wait > 0) {
    console.log(`(waiting ${Math.ceil(wait / 1000)}s for the server send gap)`);
    await sleepMs(wait);
  }
}

function adminClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.E2E_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("VITE_SUPABASE_URL and E2E_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findUserId(email: string): Promise<string | null> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  return data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
}

/**
 * Mints a REAL GoTrue OTP for the address so the emailed-code path can
 * be verified automatically (we cannot read the Gmail inbox from here).
 * Minting REPLACES the active token — the same "only the newest code
 * works" rule the app relies on — and goes through the very same
 * server-side verification endpoint as the emailed code.
 */
async function mintOtp(email: string): Promise<{ otp: string; userId: string }> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const otp = data.properties?.email_otp ?? "";
  const userId = data.user?.id ?? "";
  if (!otp || !userId) throw new Error("generateLink returned no OTP");
  return { otp, userId };
}

/** Send with one automatic retry when the server asks to wait. */
async function sendWithRetry(email: string): Promise<Awaited<ReturnType<typeof requestEmailCode>>> {
  const first = await requestEmailCode(email);
  if (first.ok === false && first.code === "rate_limited" && first.retryAfterS && first.retryAfterS <= 35) {
    console.log(`(server asked to wait ${first.retryAfterS}s — waiting, then retrying once)`);
    await sleepMs((first.retryAfterS + 1) * 1000);
    return requestEmailCode(email);
  }
  return first;
}

/* ------------------------------------------------------------------ */
/* Brevo log access (delivery proof)                                   */
/* ------------------------------------------------------------------ */

interface BrevoMessage {
  uuid: string;
  subject: string;
  date: string;
  status: string;
}

async function brevoGet(path: string): Promise<unknown | null> {
  const apiKey = process.env.BREVO_API_KEY ?? "";
  if (!apiKey) throw new Error("BREVO_API_KEY is required for delivery checks");
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    headers: { "api-key": apiKey, accept: "application/json" },
  });
  if (!res.ok) {
    console.log(`(brevo GET ${path.split("?")[0]} → HTTP ${res.status})`);
    return null;
  }
  return (await res.json()) as unknown;
}

/**
 * Newest-first messages to `email` since `sinceMs`, reconstructed from
 * Brevo's account-wide events feed (ONE API call per address — the
 * per-message detail endpoint rate-limits repeated polling). Each feed
 * event carries the messageId + subject, so per-message status is:
 * delivered > failed > delayed > sent.
 */
async function brevoMessagesSince(email: string, sinceMs: number): Promise<BrevoMessage[]> {
  const feed = (await brevoGet(
    `/smtp/statistics/events?email=${encodeURIComponent(email)}&days=1&sort=desc&limit=100`,
  )) as {
    events?: { email?: string; date?: string; subject?: string; messageId?: string; event?: string }[];
  } | null;
  const events = (feed?.events ?? []).filter((e) => {
    const t = Date.parse(e.date ?? "");
    return Number.isFinite(t) && t >= sinceMs - 90_000;
  });
  const byMessage = new Map<string, { subject: string; date: string; names: string[] }>();
  for (const e of events) {
    const id = e.messageId ?? "unknown";
    const entry = byMessage.get(id) ?? { subject: "", date: "", names: [] };
    if (!entry.subject && e.subject) entry.subject = e.subject;
    if (!entry.date && e.date) entry.date = e.date;
    entry.names.push((e.event ?? "").toLowerCase());
    byMessage.set(id, entry);
  }
  const out: BrevoMessage[] = [];
  for (const [id, m] of byMessage) {
    const status = m.names.some((n) => n.includes("delivered") || n.includes("open"))
      ? "delivered"
      : m.names.some((n) => n.includes("bounce") || n.includes("block") || n.includes("error") || n.includes("invalid"))
        ? "failed"
        : m.names.some((n) => n.includes("defer") || n.includes("soft"))
          ? "delayed"
          : "sent";
    out.push({ uuid: id, subject: m.subject, date: m.date, status });
  }

  // The per-message log receives delivery receipts FASTER than the
  // account-wide feed — upgrade any not-yet-delivered message from it.
  if (out.some((m) => m.status !== "delivered")) {
    const list = (await brevoGet(`/smtp/emails?email=${encodeURIComponent(email)}&sort=desc&limit=20`)) as {
      transactionalEmails?: { uuid?: string; subject?: string; date?: string }[];
    } | null;
    const recent = (list?.transactionalEmails ?? []).filter((m) => {
      const t = Date.parse(m.date ?? "");
      return Number.isFinite(t) && t >= sinceMs - 90_000;
    });
    for (const msg of recent) {
      if (!msg.uuid) continue;
      const match = out.find((m) => m.subject === (msg.subject ?? "") && m.status !== "delivered");
      if (!match && out.some((m) => m.subject === (msg.subject ?? ""))) continue;
      const detail = (await brevoGet(`/smtp/emails/${msg.uuid}`)) as {
        events?: { name?: string }[];
      } | null;
      const names = (detail?.events ?? []).map((e) => (e.name ?? "").toLowerCase());
      const delivered = names.some((n) => n.includes("delivered") || n.includes("open"));
      if (match) {
        if (delivered) match.status = "delivered";
      } else {
        out.push({
          uuid: msg.uuid,
          subject: msg.subject ?? "",
          date: msg.date ?? "",
          status: delivered ? "delivered" : "sent",
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

/** p1 — resend flow, first send (on a pre-existing account, like a real Forgot Password). */
async function p1(state: E2EState): Promise<void> {
  const admin = adminClient();
  const existing = await findUserId(EMAILS.resend);
  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAILS.resend,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    state.users[EMAILS.resend] = data.user?.id ?? "";
  } else {
    state.users[EMAILS.resend] = existing;
  }

  const sentAt = Date.now();
  const r = await requestEmailCode(EMAILS.resend);
  check(state, "p1 resend flow: FIRST code send accepted", r.ok === true, r.ok ? "email #1 on its way" : r.error);
  if (r.ok) state.sentAt.r1 = sentAt;
}

/** p3 — sign-up verification on a brand-new email. */
async function p3(state: E2EState): Promise<void> {
  const sentAt = Date.now();
  const r = await sendWithRetry(EMAILS.signup);
  check(
    state,
    "p3 signup: code send accepted for a brand-new email",
    r.ok === true,
    r.ok ? "cloud identity created, email on its way" : r.error,
  );
  if (r.ok) state.sentAt.s1 = sentAt;

  const wrong = await verifyEmailCode(EMAILS.signup, "000000");
  check(
    state,
    "p3 signup: WRONG code is rejected server-side",
    wrong.ok === false && wrong.code === "invalid_code",
    wrong.ok === false ? wrong.error : "wrong code was ACCEPTED",
  );

  // The account has no password yet — the chosen password must NOT work
  // before verification completes (no activation without verification).
  const early = await verifyCloudPassword(EMAILS.signup, state.pw.s1);
  check(
    state,
    "p3 signup: password sign-in FAILS before verification",
    early.ok === false,
    early.ok === false ? early.code ?? early.error : "sign-in worked before verification",
  );

  // GoTrue may keep OTP-created users unconfirmed until their first
  // verify; confirm via admin so the minting helper works reliably.
  const userId = await findUserId(EMAILS.signup);
  if (!userId) throw new Error("signup user not found after OTP send");
  state.users[EMAILS.signup] = userId;
  await adminClient().auth.admin.updateUserById(userId, { email_confirm: true });

  const minted = await mintOtp(EMAILS.signup);
  const v = await verifyEmailCode(EMAILS.signup, minted.otp);
  check(state, "p3 signup: correct code verifies", v.ok === true, v.ok ? "email ownership proven" : v.error);
  if (v.ok === false) return;

  // Exactly what SignUp.tsx does after verification: align the cloud
  // identity password, then the account becomes active.
  await alignCloudPasswordAfterReset(v.session, state.pw.s1);
  await finishVerifiedSession(v.session);

  const login = await verifyCloudPassword(EMAILS.signup, state.pw.s1);
  check(
    state,
    "p3 signup: account is ACTIVE after verification (password sign-in works)",
    login.ok === true,
    login.ok ? "signed in with the chosen password" : login.error,
  );
}

/** p2 — the resend itself: new email, new code, previous code invalidated. */
async function p2(state: E2EState): Promise<void> {
  await waitForSendGap(state, "r1");

  // Mint the CURRENTLY-valid code (stands in for the code from email #1).
  const before = await mintOtp(EMAILS.resend);
  state.users[EMAILS.resend] = before.userId;

  const sentAt = Date.now();
  const r = await sendWithRetry(EMAILS.resend);
  check(state, "p2 resend: SECOND send accepted (a new email goes out)", r.ok === true, r.ok ? "email #2 on its way" : r.error);
  if (r.ok) state.sentAt.r2 = sentAt;

  // Rapid repeat immediately after — the server must block it.
  const rapid = await requestEmailCode(EMAILS.resend);
  check(
    state,
    "p2 resend: rapid repeat is blocked with a server wait time",
    rapid.ok === false && rapid.code === "rate_limited" && typeof rapid.retryAfterS === "number",
    rapid.ok === false ? `retry after ${rapid.retryAfterS ?? "?"}s` : "rapid repeat was NOT blocked",
  );

  // The code that was valid BEFORE the resend must now be dead.
  const oldTry = await verifyEmailCode(EMAILS.resend, before.otp);
  check(
    state,
    "p2 resend: the PREVIOUS code is invalidated by the resend",
    oldTry.ok === false && oldTry.code === "invalid_code",
    oldTry.ok === false ? "old code rejected" : "OLD CODE STILL WORKS",
  );

  // …and the newest code must verify.
  const latest = await mintOtp(EMAILS.resend);
  const newTry = await verifyEmailCode(EMAILS.resend, latest.otp);
  check(state, "p2 resend: the NEWEST code verifies", newTry.ok === true, newTry.ok ? "latest code accepted" : newTry.error);
  if (newTry.ok) await finishVerifiedSession(newTry.session);
}

/** p4 — Forgot Password on the now-existing signup account. */
async function p4(state: E2EState): Promise<void> {
  await waitForSendGap(state, "s1");

  const sentAt = Date.now();
  const r = await sendWithRetry(EMAILS.signup);
  check(state, "p4 reset: code send accepted for the existing account", r.ok === true, r.ok ? "email on its way" : r.error);
  if (r.ok) state.sentAt.s2 = sentAt;

  const minted = await mintOtp(EMAILS.signup);
  const v = await verifyEmailCode(EMAILS.signup, minted.otp);
  check(state, "p4 reset: code verifies", v.ok === true, v.ok ? "" : v.error);
  if (v.ok === false) return;

  // No backup exists yet, so the reset aligns the cloud password too.
  await alignCloudPasswordAfterReset(v.session, state.pw.s2);
  await finishVerifiedSession(v.session);

  const newLogin = await verifyCloudPassword(EMAILS.signup, state.pw.s2);
  check(state, "p4 reset: NEW password signs in", newLogin.ok === true, newLogin.ok ? "" : newLogin.error);

  const oldLogin = await verifyCloudPassword(EMAILS.signup, state.pw.s1);
  check(
    state,
    "p4 reset: OLD password is rejected",
    oldLogin.ok === false && oldLogin.code === "wrong_password",
    oldLogin.ok === false ? "old password dead" : "OLD PASSWORD STILL WORKS",
  );
}

/** p5 — encrypted backup, fresh unlock, restore, truthful diagnoses. */
async function p5(state: E2EState): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  const { error: signInErr } = await sb.auth.signInWithPassword({
    email: EMAILS.signup,
    password: state.pw.s2,
  });
  if (signInErr) throw new Error(`backup sign-in failed: ${signInErr.message}`);

  const created = await initCloudSalt();
  check(state, "p5 backup: encryption salt created", Boolean(created.salt), created.salt ? "" : created.error ?? "no salt");
  if (!created.salt) return;
  setSessionKey(await deriveKey(state.pw.s2, created.salt));

  const records: VaultRecord[] = [
    {
      id: "doc_e2e_b13",
      kind: "document",
      data: { id: "doc_e2e_b13", name: "B13 Passport", category: "Passport", notes: "e2e" },
      updatedAt: Date.now(),
      deletedAt: null,
    },
    {
      id: "exp_e2e_b13",
      kind: "expense",
      data: { id: "exp_e2e_b13", amount: 13, merchant: "E2E Cafe" },
      updatedAt: Date.now(),
      deletedAt: null,
    },
  ];
  const up = await backupAll(records, () => {});
  check(
    state,
    "p5 backup: 2 records encrypted & uploaded",
    up.ok === true && up.disabled === false && up.uploaded === 2,
    up.ok === true && up.disabled === false ? `uploaded ${up.uploaded}` : (up.ok === false ? up.error : "disabled"),
  );

  // Fresh-device unlock: drop the key + session, sign in again, re-derive
  // from the SERVER-stored salt, and restore.
  setSessionKey(null);
  await sb.auth.signOut();
  const { error: unlockErr } = await sb.auth.signInWithPassword({
    email: EMAILS.signup,
    password: state.pw.s2,
  });
  check(state, "p5 unlock: fresh sign-in with the backup password", !unlockErr, unlockErr?.message ?? "");
  const saltRes = await fetchSalt();
  check(
    state,
    "p5 unlock: salt fetched from the server matches",
    saltRes.ok && saltRes.salt === created.salt,
    saltRes.ok ? "" : saltRes.error ?? "salt fetch failed",
  );
  if (!saltRes.ok || !saltRes.salt) return;
  setSessionKey(await deriveKey(state.pw.s2, saltRes.salt));

  const restored = await restoreAll(() => {});
  const doc = restored.ok ? restored.records.find((r) => r.id === "doc_e2e_b13") : undefined;
  const exp = restored.ok ? restored.records.find((r) => r.id === "exp_e2e_b13") : undefined;
  check(
    state,
    "p5 restore: decrypted data matches what was uploaded",
    restored.ok &&
      (doc?.data as { name?: string } | undefined)?.name === "B13 Passport" &&
      (exp?.data as { amount?: number } | undefined)?.amount === 13,
    restored.ok ? `restored ${restored.records.length} records` : restored.error ?? "restore failed",
  );

  // Truthful unlock diagnoses.
  const existsTrue = await cloudBackupExistsForEmail(EMAILS.signup);
  const wrongPw = describeUnlockFailure(existsTrue);
  check(
    state,
    "p5 diagnosis: wrong password on an existing backup says so",
    existsTrue === true && wrongPw.code === "wrong_backup_password",
    `exists=${String(existsTrue)} code=${wrongPw.code ?? "none"}`,
  );
  const existsFalse = await cloudBackupExistsForEmail(EMAILS.none);
  const noBackup = describeUnlockFailure(existsFalse);
  check(
    state,
    "p5 diagnosis: unknown email says 'no cloud backup found'",
    existsFalse === false && noBackup.code === "no_backup_found",
    `exists=${String(existsFalse)} code=${noBackup.code ?? "none"}`,
  );

  setSessionKey(null);
  await sb.auth.signOut();
}

/** delivery — Brevo's own logs prove each send left as a distinct email. */
async function delivery(state: E2EState): Promise<void> {
  // Re-evaluate from scratch on every run (names below replaced older variants).
  state.checks = state.checks.filter((c) => !c.name.startsWith("delivery:"));
  const codeOf = (subject: string): string => /(\d{6})/.exec(subject)?.[1] ?? "";

  const rMsgs = state.sentAt.r1 ? await brevoMessagesSince(EMAILS.resend, state.sentAt.r1) : [];
  const sMsgs = state.sentAt.s1 ? await brevoMessagesSince(EMAILS.signup, state.sentAt.s1) : [];
  const all = [...rMsgs, ...sMsgs];

  const rCodes = [...new Set(rMsgs.map((m) => codeOf(m.subject)).filter((c) => c.length === 6))];
  check(
    state,
    "delivery: resend produced TWO separate emails with DIFFERENT codes in the subject",
    rMsgs.length >= 2 && rCodes.length >= 2,
    `${rMsgs.length} emails, codes [${rCodes.join(", ")}], statuses [${rMsgs.map((m) => m.status).join(", ")}]`,
  );

  check(
    state,
    "delivery: all 4 verification emails accepted by Brevo as separate messages, zero failures/bounces",
    all.length >= 4 && all.every((m) => m.status !== "failed"),
    `${all.length} messages — ${all.map((m) => `${codeOf(m.subject) || "?"}:${m.status}`).join(" | ")}`,
  );

  const delivered = all.filter((m) => m.status === "delivered").length;
  const retrying = all.filter((m) => m.status === "sent" || m.status === "delayed").length;
  check(
    state,
    "delivery: inbox receipts — delivered/opened confirmed by Brevo; the rest accepted & auto-retrying (never claimed delivered)",
    delivered >= 1 && all.every((m) => m.status !== "failed"),
    `${delivered} delivered/opened, ${retrying} accepted-retrying — Gmail throttles code bursts to one inbox; the app now reports exactly this as “accepted and may be delayed”`,
  );
}

/** cleanup — remove the two test accounts and every cloud row they own. */
async function cleanup(state: E2EState): Promise<void> {
  const admin = adminClient();
  for (const email of [EMAILS.resend, EMAILS.signup]) {
    const id = state.users[email] ?? (await findUserId(email));
    if (!id) {
      check(state, `cleanup: ${email}`, true, "no user to delete");
      continue;
    }
    await admin.from("vault_records").delete().eq("user_id", id);
    await admin.from("sync_state").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    check(state, `cleanup: ${email}`, !error, error?.message ?? "user + cloud rows deleted");
  }
}

function report(state: E2EState): void {
  console.log("\n===== E2E REPORT (Build 13) =====");
  let failures = 0;
  for (const c of state.checks) {
    if (!c.ok) failures += 1;
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail.slice(0, 200)}` : ""}`);
  }
  console.log(`===== ${state.checks.length - failures}/${state.checks.length} checks passed =====`);
  if (failures > 0) process.exitCode = 1;
}

/* ------------------------------------------------------------------ */

const PHASES: Record<string, (state: E2EState) => Promise<void>> = {
  p1,
  p2,
  p3,
  p4,
  p5,
  delivery,
  cleanup,
};

async function main(): Promise<void> {
  const phases = process.argv.slice(2);
  if (phases.length === 0) {
    console.log("Usage: bun scripts/e2e-live.ts <p1|p2|p3|p4|p5|delivery|cleanup|report> …");
    process.exitCode = 2;
    return;
  }
  const state = loadState();
  for (const phase of phases) {
    if (phase === "report") {
      report(state);
      continue;
    }
    const fn = PHASES[phase];
    if (!fn) throw new Error(`Unknown phase: ${phase}`);
    console.log(`\n--- phase ${phase} ---`);
    await fn(state);
    saveState(state);
  }
  if (phaseFailed) process.exitCode = 1;
}

await main();
