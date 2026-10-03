import dotenv from "dotenv";
import { getTodayDateFormatted } from "./gemini.js";
import { hasTransactionsOnDate } from "./sheets.js";

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
 * Every day at REMINDER_TIME (local time, set TZ on servers), calls `send(text)`
 * if no transaction has been logged in the sheet for today.
 */
export function scheduleDailyReminder(send) {
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
      if (await hasTransactionsOnDate(todayStr)) return;
      await send(
        `Pengingat: belum ada pengeluaran yang dicatat hari ini (${todayStr}). ` +
        `Jangan lupa catat pengeluaranmu! Abaikan pesan ini kalau hari ini memang tidak ada pengeluaran.`
      );
    } catch (err) {
      console.error("Daily reminder error:", err);
    }
  }, 30 * 1000);

  const hh = String(time.hour).padStart(2, "0");
  const mm = String(time.minute).padStart(2, "0");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`Daily reminder scheduled at ${hh}:${mm} (${tz}).`);
}
