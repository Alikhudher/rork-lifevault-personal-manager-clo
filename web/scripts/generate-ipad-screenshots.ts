/**
 * iPad Pro 13" App Store Connect screenshot generator.
 *
 * Builds the web app, serves the dist/ folder, then uses Playwright to
 * capture 5 portrait screenshots at 2064×2752 px (1032×1376 CSS @ 2× DPR)
 * with realistic but generic mock data.
 *
 * Usage:  bun run scripts/generate-ipad-screenshots.ts
 */

import { spawn } from "child_process";
import { createReadStream, existsSync, statSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { join, extname } from "path";
import { chromium, type Browser } from "playwright";

// ── iPad Pro 13" portrait viewport ──────────────────────────────────
const VIEWPORT_W = 1032;
const VIEWPORT_H = 1376;
const DPR = 2; // 2064×2752 output

const OUT_DIR = join(process.cwd(), "screenshots", "ipad");
const DIST_DIR = join(process.cwd(), "dist");

// ── Mock data (generic, no real PII) ────────────────────────────────

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function dateOnlyDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const MOCK_STATE = {
  onboarded: true,
  user: {
    name: "Alex Morgan",
    email: "alex.morgan@example.com",
    photo: null,
    createdAt: new Date("2024-06-15").toISOString(),
    emailVerified: true,
  },
  lastEmail: "alex.morgan@example.com",
  accounts: [
    {
      email: "alex.morgan@example.com",
      name: "Alex Morgan",
      photo: null,
      passwordHash: "mockhash",
      passwordSalt: "mocksalt",
      passwordChangedAt: Date.now(),
      createdAt: new Date("2024-06-15").toISOString(),
      emailVerified: true,
    },
  ],
  settings: {
    currency: "AUD",
    darkMode: false,
    biometric: false,
    monthlyBudget: 3800,
    language: "en",
    notifications: {
      documents: true,
      subscriptions: true,
      bills: true,
      appointments: true,
      budget: true,
    },
  },
  security: {
    biometricEnabled: false,
    pinEnabled: false,
    pinLength: 4,
    autoLockDelay: null,
    hideInAppSwitcher: false,
  },
  documents: [
    {
      id: "ss_doc_1",
      name: "Passport",
      category: "Passport",
      issueDate: dateOnlyDaysFromNow(-365 * 2),
      expiryDate: dateOnlyDaysFromNow(365 * 3),
      notes: "Renewal reminder set",
      reminderDays: 90,
      fileName: "passport.pdf",
      fileKind: "pdf" as const,
      fileData: null,
      createdAt: new Date("2024-06-20").toISOString(),
    },
    {
      id: "ss_doc_2",
      name: "Driver Licence",
      category: "Driver Licence",
      issueDate: dateOnlyDaysFromNow(-180),
      expiryDate: dateOnlyDaysFromNow(20),
      notes: "Expires next month",
      reminderDays: 30,
      fileName: "licence.jpg",
      fileKind: "image" as const,
      fileData: null,
      createdAt: new Date("2024-07-01").toISOString(),
    },
    {
      id: "ss_doc_3",
      name: "Home Insurance Policy",
      category: "Insurance",
      issueDate: dateOnlyDaysFromNow(-30),
      expiryDate: dateOnlyDaysFromNow(335),
      notes: "Annual renewal",
      reminderDays: 30,
      fileName: "home_insurance.pdf",
      fileKind: "pdf" as const,
      fileData: null,
      createdAt: new Date("2024-08-10").toISOString(),
    },
    {
      id: "ss_doc_4",
      name: "Vehicle Registration",
      category: "Vehicle",
      issueDate: dateOnlyDaysFromNow(-60),
      expiryDate: dateOnlyDaysFromNow(5),
      notes: "Renew soon",
      reminderDays: 14,
      fileName: "rego.pdf",
      fileKind: "pdf" as const,
      fileData: null,
      createdAt: new Date("2024-09-05").toISOString(),
    },
    {
      id: "ss_doc_5",
      name: "Medicare Card",
      category: "Medical",
      issueDate: dateOnlyDaysFromNow(-200),
      expiryDate: null,
      notes: "No expiry",
      reminderDays: 365,
      fileName: null,
      fileKind: "pdf" as const,
      fileData: null,
      createdAt: new Date("2024-10-12").toISOString(),
    },
    {
      id: "ss_doc_6",
      name: "Employment Contract",
      category: "Employment",
      issueDate: dateOnlyDaysFromNow(-90),
      expiryDate: null,
      notes: "Permanent role",
      reminderDays: 365,
      fileName: "contract.pdf",
      fileKind: "pdf" as const,
      fileData: null,
      createdAt: new Date("2024-11-01").toISOString(),
    },
  ],
  expenses: [
    {
      id: "ss_exp_1",
      amount: 42.5,
      date: isoDaysFromNow(0),
      category: "Food",
      merchant: "Fresh Market",
      notes: "",
      paymentMethod: "Debit Card" as const,
    },
    {
      id: "ss_exp_2",
      amount: 28.0,
      date: isoDaysFromNow(0),
      category: "Transport",
      merchant: "City Transit",
      notes: "Weekly pass",
      paymentMethod: "Debit Card" as const,
    },
    {
      id: "ss_exp_3",
      amount: 15.9,
      date: isoDaysFromNow(-1),
      category: "Food",
      merchant: "Corner Café",
      notes: "Lunch",
      paymentMethod: "Credit Card" as const,
    },
    {
      id: "ss_exp_4",
      amount: 89.99,
      date: isoDaysFromNow(-2),
      category: "Shopping",
      merchant: "Electronics Store",
      notes: "USB cable & case",
      paymentMethod: "Credit Card" as const,
    },
    {
      id: "ss_exp_5",
      amount: 60.0,
      date: isoDaysFromNow(-3),
      category: "Fuel",
      merchant: "Fuel Station",
      notes: "Full tank",
      paymentMethod: "Debit Card" as const,
    },
    {
      id: "ss_exp_6",
      amount: 1200.0,
      date: isoDaysFromNow(-5),
      category: "Rent",
      merchant: "Property Manager",
      notes: "Monthly rent",
      paymentMethod: "Bank Transfer" as const,
    },
    {
      id: "ss_exp_7",
      amount: 35.5,
      date: isoDaysFromNow(-6),
      category: "Bills",
      merchant: "Telco Provider",
      notes: "Phone bill",
      paymentMethod: "Debit Card" as const,
    },
    {
      id: "ss_exp_8",
      amount: 52.0,
      date: isoDaysFromNow(-7),
      category: "Entertainment",
      merchant: "Cinema Tickets",
      notes: "Movie night",
      paymentMethod: "Credit Card" as const,
    },
    {
      id: "ss_exp_9",
      amount: 18.75,
      date: isoDaysFromNow(-8),
      category: "Food",
      merchant: "Bakery",
      notes: "Breakfast",
      paymentMethod: "Cash" as const,
    },
    {
      id: "ss_exp_10",
      amount: 95.0,
      date: isoDaysFromNow(-10),
      category: "Health",
      merchant: "Pharmacy",
      notes: "Prescription",
      paymentMethod: "Debit Card" as const,
    },
  ],
  subscriptions: [
    {
      id: "ss_sub_1",
      name: "Streaming Service",
      price: 19.99,
      frequency: "monthly" as const,
      nextPaymentDate: dateOnlyDaysFromNow(3),
      category: "Entertainment" as const,
      paymentMethod: "Credit Card" as const,
      reminderDays: 3,
      status: "active" as const,
    },
    {
      id: "ss_sub_2",
      name: "Cloud Storage",
      price: 2.99,
      frequency: "monthly" as const,
      nextPaymentDate: dateOnlyDaysFromNow(12),
      category: "Subscriptions" as const,
      paymentMethod: "Credit Card" as const,
      reminderDays: 3,
      status: "active" as const,
    },
    {
      id: "ss_sub_3",
      name: "Music App",
      price: 11.99,
      frequency: "monthly" as const,
      nextPaymentDate: dateOnlyDaysFromNow(18),
      category: "Entertainment" as const,
      paymentMethod: "Credit Card" as const,
      reminderDays: 3,
      status: "active" as const,
    },
    {
      id: "ss_sub_4",
      name: "Fitness App",
      price: 14.99,
      frequency: "monthly" as const,
      nextPaymentDate: dateOnlyDaysFromNow(25),
      category: "Health" as const,
      paymentMethod: "Credit Card" as const,
      reminderDays: 7,
      status: "active" as const,
    },
  ],
  appointments: [
    {
      id: "ss_apt_1",
      title: "Dental Check-up",
      date: dateOnlyDaysFromNow(2),
      time: "10:00",
      location: "City Dental",
      notes: "6-month check",
      reminder: "1 day before",
    },
    {
      id: "ss_apt_2",
      title: "Car Service",
      date: dateOnlyDaysFromNow(7),
      time: "08:30",
      location: "Auto Centre",
      notes: "20,000 km service",
      reminder: "2 days before",
    },
    {
      id: "ss_apt_3",
      title: "GP Appointment",
      date: dateOnlyDaysFromNow(14),
      time: "14:00",
      location: "Medical Centre",
      notes: "",
      reminder: "1 day before",
    },
    {
      id: "ss_apt_4",
      title: "Accountant Meeting",
      date: dateOnlyDaysFromNow(21),
      time: "11:00",
      location: "Tax Office",
      notes: "Tax return",
      reminder: "3 days before",
    },
  ],
  notifications: [
    {
      id: "ss_ntf_1",
      type: "document",
      title: "Driver Licence expiring soon",
      message: "Your licence expires in 20 days. Renew now to stay road-legal.",
      date: isoDaysFromNow(-1),
      read: false,
    },
    {
      id: "ss_ntf_2",
      type: "subscription",
      title: "Streaming Service payment due",
      message: "$19.99 will be charged in 3 days.",
      date: isoDaysFromNow(-2),
      read: false,
    },
    {
      id: "ss_ntf_3",
      type: "appointment",
      title: "Dental check-up tomorrow",
      message: "Your appointment is at 10:00 AM at City Dental.",
      date: isoDaysFromNow(-3),
      read: false,
    },
  ],
  sessions: [
    {
      id: "ses_this_device",
      device: "iPad Pro",
      location: "This device",
      app: "LifeVault · 1.0",
      lastActive: new Date().toISOString(),
      current: true,
    },
  ],
};

const STORAGE_KEY = "lifevault-state-v1";

// ── Screenshot targets ──────────────────────────────────────────────

interface ScreenshotTarget {
  path: string;
  file: string;
  /** Extra setup: click elements, switch views, etc. */
  setup?: (page: import("playwright").Page) => Promise<void>;
}

const TARGETS: ScreenshotTarget[] = [
  { path: "/", file: "01-home.png" },
  { path: "/documents", file: "02-documents.png" },
  { path: "/expenses", file: "03-expenses.png" },
  {
    path: "/calendar",
    file: "04-calendar.png",
    setup: async (page) => {
      // Switch to month view for a richer screenshot
      const monthBtn = page.locator('button[aria-label="Month view"]');
      if (await monthBtn.isVisible()) {
        await monthBtn.click();
        await page.waitForTimeout(500);
      }
    },
  },
  { path: "/premium", file: "05-premium.png" },
];

// ── Helpers ─────────────────────────────────────────────────────────

/** Build the web app with Vite. */
function buildApp(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

/** Serve the dist/ folder as a single-page app (fallback to index.html). */
function serveDist(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = req.url ?? "/";
      let filePath = join(DIST_DIR, reqUrl.split("?")[0] ?? "");
      if (reqUrl.endsWith("/") || !extname(filePath)) {
        filePath = join(DIST_DIR, "index.html");
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        filePath = join(DIST_DIR, "index.html");
      }
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
      createReadStream(filePath).pipe(res);
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine server port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => server.close(),
      });
    });
    server.on("error", reject);
  });
}

/** Inject the mock localStorage state before the app loads. */
async function injectMockState(page: import("playwright").Page) {
  await page.addInitScript((stateJson: string, key: string) => {
    localStorage.setItem(key, stateJson);
  }, JSON.stringify(MOCK_STATE), STORAGE_KEY);
}

/** Ensure a PNG has no alpha channel by re-encoding via canvas (in-browser). */
async function stripAlpha(page: import("playwright").Page, screenshotPath: string) {
  // Playwright captures opaque screenshots by default when the page
  // background is set. We set the page background to white as a safety net.
  await page.evaluate(() => {
    document.documentElement.style.background = "#f8fafc";
  });
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("▸ Building web app...");
  await buildApp();

  console.log("▸ Starting local server...");
  const server = await serveDist();

  // Clean output directory
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  console.log("▸ Launching Chromium (iPad Pro 13\" portrait)...");
  const browser: Browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  // Load the app once so the page context exists, then inject mock state.
  // addInitScript alone is not reliable because the app reads localStorage
  // during its initial synchronous render before any injected script runs.
  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ stateJson, key }: { stateJson: string; key: string }) => {
    localStorage.setItem(key, stateJson);
  }, { stateJson: JSON.stringify(MOCK_STATE), key: STORAGE_KEY });

  for (const target of TARGETS) {
    const url = `${server.url}${target.path}`;
    console.log(`  Capturing ${target.file} (${target.path})...`);

    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Run any extra setup (e.g. switching calendar to month view)
    if (target.setup) {
      await target.setup(page);
      await page.waitForTimeout(500);
    }

    // Set background to opaque white (strip alpha safety net)
    await stripAlpha(page, target.file);

    // Wait for animations to settle
    await page.waitForTimeout(800);

    const outPath = join(OUT_DIR, target.file);
    await page.screenshot({
      path: outPath,
      type: "png",
      fullPage: false,
    });

    console.log(`  ✓ Saved ${outPath}`);
  }

  await browser.close();
  server.close();

  console.log("\n▸ All screenshots saved to web/screenshots/ipad/");
  console.log("  01-home.png   — Home (budget, stats, quick actions, activity)");
  console.log("  02-documents.png — Documents (search, tabs, 6 docs in 2-col grid)");
  console.log("  03-expenses.png  — Expenses (totals, budget, categories, recent)");
  console.log("  04-calendar.png  — Calendar (month view with appointments)");
  console.log("  05-premium.png   — Premium (hero, features, plan picker)");
}

main().catch((err) => {
  console.error("✗ Screenshot generation failed:", err);
  process.exit(1);
});
