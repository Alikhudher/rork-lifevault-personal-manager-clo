/**
 * Free-tier AI scan usage tracking.
 *
 * Tracks the number of AI document scans performed in the current month
 * for free users. Premium users have unlimited scans (no tracking).
 *
 * Count is persisted in localStorage with a month key so it resets
 * automatically when the calendar month changes.
 */

const STORAGE_KEY = "lifevault-scan-usage-v1";

interface ScanUsageData {
  /** ISO month key: "2026-08" */
  monthKey: string;
  /** Number of scans performed this month */
  count: number;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function loadData(): ScanUsageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { monthKey: currentMonthKey(), count: 0 };
    const parsed = JSON.parse(raw) as Partial<ScanUsageData>;
    const month = currentMonthKey();
    // If the stored month differs from the current month, reset the counter.
    if (parsed.monthKey !== month) {
      return { monthKey: month, count: 0 };
    }
    return {
      monthKey: month,
      count: typeof parsed.count === "number" ? parsed.count : 0,
    };
  } catch {
    return { monthKey: currentMonthKey(), count: 0 };
  }
}

function saveData(data: ScanUsageData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

/** Get the current month's scan count for free users. Returns 0 on web/preview. */
export function getMonthlyScanCount(): number {
  return loadData().count;
}

/**
 * Check if a free user can still perform an AI scan.
 * Returns true if under the monthly limit, false if the limit is reached.
 */
export function canFreeScan(limit: number): boolean {
  const data = loadData();
  return data.count < limit;
}

/**
 * Increment the monthly scan counter. Called after a successful scan.
 * No-op for premium users (caller should check isPremium first).
 */
export function incrementScanCount(): void {
  const data = loadData();
  data.count += 1;
  saveData(data);
}

/**
 * Get remaining free scans for the current month.
 * Returns 0 if the limit has been reached.
 */
export function remainingFreeScans(limit: number): number {
  const data = loadData();
  return Math.max(0, limit - data.count);
}
