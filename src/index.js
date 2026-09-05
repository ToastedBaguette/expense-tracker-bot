import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import path from "path";
import { parseExpenseFromImage, parseExpenseFromText } from "./gemini.js";
import { appendExpenses, addIncome, getMonthlySummary } from "./sheets.js";

dotenv.config();

const AUTH_DIR = path.resolve("./auth_info_baileys");
const AUTHORIZED_NUMBERS = (process.env.AUTHORIZED_NUMBERS || "")
  .split(",")
  .map((num) => num.trim().replace(/[^0-9]/g, ""))
  .filter(Boolean);

// Cache to prevent the bot from responding to its own sent messages
const botSentMessageIds = new Set();

// Deduplication cache: tracks message IDs that are currently being or have already been processed
const processedMessageIds = new Set();

// Bot start timestamp (in seconds) to filter out stale history messages replayed on reconnect
const botStartTime = Math.floor(Date.now() / 1000);

/**
 * Checks if the sender is authorized
 */
function isAuthorized(senderJid) {
  if (AUTHORIZED_NUMBERS.length === 0) return true; // allow all if not set
  const senderNumber = senderJid.replace(/[^0-9]/g, "");
  return AUTHORIZED_NUMBERS.some((num) => senderNumber.includes(num));
}

/**
 * Format currency number to IDR string
 */
function formatRupiah(num) {
  const n = Number(num) || 0;
  if (n < 0) {
    return "-Rp " + Math.abs(n).toLocaleString("id-ID");
  }
  return "Rp " + n.toLocaleString("id-ID");
}

/**
 * Formats expense logging confirmation cleanly with minimal icons
 */
function formatExpensesConfirmation(expenses, res) {
  const isSingle = expenses.length === 1;
  const hasReimbursement = expenses.some((e) => e.isReimbursement || Number(e.amount) < 0);

  let header;
  if (isSingle) {
    header = hasReimbursement
      ? "*Reimbursement / Split-Bill Berhasil Dicatat*"
      : "*Transaksi Berhasil Dicatat*";
  } else {
    header = `*${expenses.length} Transaksi Berhasil Dicatat*`;
  }

  let msg = `${header}\n`;
  msg += `------------------------------------\n`;

  for (const exp of expenses) {
    const isNeg = Number(exp.amount) < 0 || exp.isReimbursement;
    const tag = isNeg ? " • Reimbursement" : "";
    msg += `• *${exp.date}* | ${exp.description}\n`;
    msg += `  ${formatRupiah(exp.amount)} (${exp.category} • ${exp.source}${tag})\n`;
  }

  msg += `------------------------------------\n`;

  if (!isSingle) {
    const totalBatch = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    msg += `Total Transaksi Ini: *${formatRupiah(totalBatch)}*\n`;
  }

  msg += `Sisa Budget (${res.sheetName}): *${res.summary.remainingBudget}*\n`;
  msg += `Total Pengeluaran: *${res.summary.totalExpenses}*`;

  return msg;
}

/**
 * Formats income addition confirmation
 */
function formatIncomeConfirmation(incomeResult) {
  let msg = `*Pemasukan Berhasil Ditambahkan*\n`;
  msg += `------------------------------------\n`;
  msg += `• Deskripsi: *${incomeResult.description || "Pemasukan"}*\n`;
  msg += `• Jumlah: *+${formatRupiah(incomeResult.addedAmount)}* (${incomeResult.source || "BCA"})\n`;
  msg += `------------------------------------\n`;
  msg += `Total Pemasukan (${incomeResult.sheetName}): *${incomeResult.summary.income}*\n`;
  msg += `Sisa Budget: *${incomeResult.summary.remainingBudget}*\n`;
  msg += `Total Pengeluaran: *${incomeResult.summary.totalExpenses}*`;
  return msg;
}

/**
 * Formats monthly summary into a neat, minimal message
 */
function formatSummaryMessage(summary) {
  let msg = `*Laporan Keuangan — ${summary.month}*\n`;
  msg += `------------------------------------\n`;
  msg += `Pemasukan: *${summary.income}*\n`;
  msg += `Total Pengeluaran: *${summary.totalExpenses}*\n`;
  msg += `Sisa Budget: *${summary.remainingBudget}*\n\n`;

  const activeCategories = (summary.categories || []).filter(
    (c) => c.name && c.total && c.total !== "Rp0"
  );
  if (activeCategories.length > 0) {
    msg += `*Kategori:*\n`;
    for (const cat of activeCategories) {
      msg += `• ${cat.name}: ${cat.total}\n`;
    }
    msg += `\n`;
  }

  const activeSources = (summary.sources || []).filter(
    (s) => s.name && s.total && s.total !== "Rp0"
  );
  if (activeSources.length > 0) {
    msg += `*Sumber Dana:*\n`;
    for (const src of activeSources) {
      msg += `• ${src.name}: ${src.total}\n`;
    }
  }

  return msg.trim();
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  // Helper to send message and track ID to avoid loops
  async function reply(jid, content) {
    try {
      const sent = await sock.sendMessage(jid, content);
      if (sent?.key?.id) {
        botSentMessageIds.add(sent.key.id);
        setTimeout(() => botSentMessageIds.delete(sent.key.id), 5 * 60 * 1000);
      }
      return sent;
    } catch (err) {
      console.error("Error sending message:", err);
    }
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan QR code ini untuk menghubungkan WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Koneksi terputus. Reconnecting:", shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === "open") {
      console.log("\nBot WhatsApp berhasil terhubung dan siap digunakan!");
      console.log("ID Akun:", sock.user?.id);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const myPhone = (sock.user?.id || "").split(":")[0].replace(/[^0-9]/g, "");
    const myLid = (sock.user?.lid || "").split(":")[0].replace(/[^0-9]/g, "");

    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue;

      // 1. DEDUPLICATION: Check if this message was already processed
      if (processedMessageIds.has(msg.key.id)) {
        continue;
      }

      // 2. SKIP MESSAGES SENT BY BOT ITSELF
      if (botSentMessageIds.has(msg.key.id)) {
        continue;
      }

      // 3. IGNORE HISTORICAL / OLD MESSAGES REPLAYED ON RECONNECT
      const rawTimestamp = msg.messageTimestamp;
      const msgTimestamp =
        typeof rawTimestamp === "number"
          ? rawTimestamp
          : rawTimestamp?.low || 0;

      // If message is older than when the bot started, skip it
      if (msgTimestamp && msgTimestamp < botStartTime - 10) {
        continue;
      }

      const senderJid = msg.key.remoteJid;
      if (!senderJid) continue;
      if (senderJid === "status@broadcast") continue;

      const isSelfChat =
        (myPhone && senderJid.includes(myPhone)) ||
        (myLid && senderJid.includes(myLid));

      if (msg.key.fromMe && !isSelfChat) {
        continue;
      }

      if (!msg.key.fromMe && !isAuthorized(senderJid)) {
        continue;
      }

      // Immediately mark as processed to prevent race conditions during async calls
      processedMessageIds.add(msg.key.id);
      setTimeout(() => processedMessageIds.delete(msg.key.id), 30 * 60 * 1000);

      const messageType = Object.keys(msg.message)[0];
      const isImage = messageType === "imageMessage";

      const textBody =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      // 1. Process Receipt Screenshot (Expenses, Income, or Mutation)
      if (isImage) {
        await reply(senderJid, {
          text: "Menganalisis bukti transaksi...",
        });

        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const mimeType = msg.message.imageMessage?.mimetype || "image/jpeg";
          const caption = msg.message.imageMessage?.caption || "";

          const parsed = await parseExpenseFromImage(buffer, mimeType, caption);

          if (parsed.type === "INCOME" && parsed.income) {
            const res = await addIncome(parsed.income);
            const replyText = formatIncomeConfirmation(res);
            await reply(senderJid, { text: replyText });
          } else if (parsed.type === "EXPENSE" && parsed.expenses && parsed.expenses.length > 0) {
            const res = await appendExpenses(parsed.expenses);
            const replyText = formatExpensesConfirmation(parsed.expenses, res);
            await reply(senderJid, { text: replyText });
          } else {
            await reply(senderJid, {
              text: "Gambar tidak terbaca sebagai transaksi yang valid.",
            });
          }
        } catch (err) {
          console.error("Gagal memproses screenshot:", err);
          await reply(senderJid, {
            text: `Terjadi kesalahan saat membaca bukti transaksi: ${err.message}`,
          });
        }
        continue;
      }

      // 2. Process Text Queries (Budget Check)
      const cleanText = textBody.toLowerCase().trim();
      if (
        cleanText === "budget" ||
        cleanText === "sisa budget" ||
        cleanText === "cek budget" ||
        cleanText === "summary" ||
        cleanText === "laporan"
      ) {
        try {
          await reply(senderJid, { text: "Mengambil data laporan..." });
          const summary = await getMonthlySummary();
          const summaryText = formatSummaryMessage(summary);
          await reply(senderJid, { text: summaryText });
        } catch (err) {
          await reply(senderJid, { text: `Gagal mengambil ringkasan: ${err.message}` });
        }
        continue;
      }

      // 3. Process Natural Language Entry (Expense, Reimbursement, or Income)
      if (textBody.trim().length > 0) {
        try {
          const parsed = await parseExpenseFromText(textBody);

          if (parsed.type === "INCOME" && parsed.income) {
            const res = await addIncome(parsed.income);
            const replyText = formatIncomeConfirmation(res);
            await reply(senderJid, { text: replyText });
          } else if (parsed.type === "EXPENSE" && parsed.expenses && parsed.expenses.length > 0) {
            const res = await appendExpenses(parsed.expenses);
            const replyText = formatExpensesConfirmation(parsed.expenses, res);
            await reply(senderJid, { text: replyText });
          } else {
            const help =
              `*WhatsApp Expense Bot*\n\n` +
              `Cara mencatat transaksi:\n` +
              `1. Kirim foto screenshot bukti pembayaran / mutasi.\n` +
              `2. Catat pengeluaran:\n` +
              `   • _"Makan warteg 18rb seabank"_\n` +
              `   • _"Naik grab 35k seabank, bensin 20k bca"_\n` +
              `3. Catat reimbursement / teman bayar utang:\n` +
              `   • _"Hans bayar makan 50rb bca"_\n` +
              `4. Catat pemasukan tambahan:\n` +
              `   • _"Dapat freelance 1.5jt bca"_\n` +
              `5. Ketik *budget* untuk melihat sisa budget & ringkasan bulan ini.`;
            await reply(senderJid, { text: help });
          }
        } catch (err) {
          console.error("Gagal memproses pesan teks:", err);
          await reply(senderJid, {
            text: `Terjadi kesalahan: ${err.message}`,
          });
        }
      }
    }
  });
}

startBot().catch((err) => console.error("Fatal Bot Error:", err));
