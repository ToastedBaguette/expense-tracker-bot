import dotenv from "dotenv";
import { getTodayDateFormatted } from "./gemini.js";
import { getTransactionsOnDate, getMonthlySummary } from "./sheets.js";

dotenv.config();

/**
 * Parses REMINDER_TIME ("HH:MM", default 21:00). Returns null when disabled.
 */
function getReminderTime() {
  const raw = (process.env.REMINDER_TIME ?? "21:00").trim().toLowerCase();
  if (raw === "" || raw === "off") return null;

  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    console.warn(`Invalid REMINDER_TIME "${raw}" (expected HH:MM). Daily reminder disabled.`);
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Every day at REMINDER_TIME (local time, set TZ on servers), sends a summary of today's
 * transactions, or a reminder if none have been logged. `formatSummary({ date, transactions,
 * total, monthly })` builds the platform-specific summary message, which is passed to `send`.
 */
export function scheduleDailyReminder(send, formatSummary) {
  const time = getReminderTime();
  if (!time) return;

  let lastCheckedDate = null;

  // Poll twice a minute so the target minute is never skipped by timer drift
  setInterval(async () => {
    const now = new Date();
    const todayStr = getTodayDateFormatted();
    if (now.getHours() !== time.hour || now.getMinutes() !== time.minute) return;
    if (lastCheckedDate === todayStr) return;
    lastCheckedDate = todayStr;

    try {
      const transactions = await getTransactionsOnDate(todayStr);
      if (transactions.length === 0) {
        await send(
          `Pengingat: belum ada pengeluaran yang dicatat hari ini (${todayStr}). ` +
          `Jangan lupa catat pengeluaranmu! Abaikan pesan ini kalau hari ini memang tidak ada pengeluaran.`
        );
        return;
      }

      // Reimbursements are stored as negative amounts, so this is the net spend
      const total = transactions.reduce((sum, t) => sum + t.amount, 0);
      const monthly = await getMonthlySummary();
      await send(formatSummary({ date: todayStr, transactions, total, monthly }));
    } catch (err) {
      console.error("Daily reminder error:", err);
    }
  }, 30 * 1000);

  const hh = String(time.hour).padStart(2, "0");
  const mm = String(time.minute).padStart(2, "0");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`Daily summary/reminder scheduled at ${hh}:${mm} (${tz}).`);
}
