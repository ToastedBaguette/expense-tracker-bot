import dotenv from "dotenv";
import { getTodayDateFormatted } from "./gemini.js";
import { getTransactionsOnDate, getMonthlySummary } from "./sheets.js";

dotenv.config();

// A failed or missed send is retried every RETRY_DELAY_MINUTES until RETRY_WINDOW_MINUTES past REMINDER_TIME
const RETRY_DELAY_MINUTES = 2;
const RETRY_WINDOW_MINUTES = 30;

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
 * Builds today's message: a summary of today's transactions (via `formatSummary`), a reminder if
 * none have been logged, or a warning if this month has no sheet tab to log them into.
 */
async function buildDailyMessage(now, todayStr, formatSummary) {
  const transactions = await getTransactionsOnDate(todayStr);

  if (transactions === null) {
    const tabName = now.toLocaleString("en-US", { month: "long", year: "numeric" });
    return (
      `Pengingat: tab untuk bulan ini belum ada di spreadsheet, jadi pengeluaran hari ini (${todayStr}) belum bisa dicatat. ` +
      `Duplikat tab bulan lalu, ganti namanya menjadi "${tabName}", lalu catat pengeluaranmu.`
    );
  }

  if (transactions.length === 0) {
    return (
      `Pengingat: belum ada pengeluaran yang dicatat hari ini (${todayStr}). ` +
      `Jangan lupa catat pengeluaranmu! Abaikan pesan ini kalau hari ini memang tidak ada pengeluaran.`
    );
  }

  // Reimbursements are stored as negative amounts, so this is the net spend
  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  const monthly = await getMonthlySummary();
  return formatSummary({ date: todayStr, transactions, total, monthly });
}

/**
 * Every day at REMINDER_TIME (local time, set TZ on servers), sends a summary of today's
 * transactions, or a reminder if none have been logged. `formatSummary({ date, transactions,
 * total, monthly })` builds the platform-specific summary message, which is passed to `send`.
 *
 * A failed send, or one missed because the bot was offline at REMINDER_TIME, is retried until
 * RETRY_WINDOW_MINUTES past it. Whether today's message was sent is only kept in memory, so a
 * restart inside that window after a successful send sends it again.
 */
export function scheduleDailyReminder(send, formatSummary) {
  const time = getReminderTime();
  if (!time) return;

  const target = time.hour * 60 + time.minute;
  const label = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
  let sentDate = null;
  let nextAttemptAt = 0;

  // Poll twice a minute so the target minute is never skipped by timer drift
  setInterval(async () => {
    const now = new Date();
    const todayStr = getTodayDateFormatted();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < target || minutes >= target + RETRY_WINDOW_MINUTES) return;
    if (sentDate === todayStr || Date.now() < nextAttemptAt) return;

    // Set before sending, so the polls during this attempt don't start a second one
    nextAttemptAt = Date.now() + RETRY_DELAY_MINUTES * 60 * 1000;

    try {
      await send(await buildDailyMessage(now, todayStr, formatSummary));
      sentDate = todayStr;
      console.log(`Daily summary/reminder sent for ${todayStr}.`);
    } catch (err) {
      console.error(
        `Daily summary/reminder for ${todayStr} failed ` +
        `(retrying every ${RETRY_DELAY_MINUTES} min until ${RETRY_WINDOW_MINUTES} min past ${label}):`,
        err
      );
    }
  }, 30 * 1000);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`Daily summary/reminder scheduled at ${label} (${tz}).`);
}
