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
import { appendExpense, getMonthlySummary, getSheetNameFromDate } from "./sheets.js";

dotenv.config();

const AUTH_DIR = path.resolve("./auth_info_baileys");
const AUTHORIZED_NUMBERS = (process.env.AUTHORIZED_NUMBERS || "")
  .split(",")
  .map((num) => num.trim().replace(/[^0-9]/g, ""))
  .filter(Boolean);

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
  return "Rp " + Number(num).toLocaleString("id-ID");
}

/**
 * Formats monthly summary into a clean WhatsApp message
 */
function formatSummaryMessage(summary) {
  let msg = `📊 *Laporan Keuangan - ${summary.month}*\n\n`;
  msg += `💰 *Pemasukan:* ${summary.income}\n`;
  msg += `💸 *Total Pengeluaran:* ${summary.totalExpenses}\n`;
  msg += `💵 *Sisa Budget:* ${summary.remainingBudget}\n\n`;

  if (summary.categories && summary.categories.length > 0) {
    msg += `📂 *Kategori:*\n`;
    for (const cat of summary.categories) {
      if (cat.name && cat.total && cat.total !== "Rp0") {
        msg += `  • ${cat.name}: ${cat.total}\n`;
      }
    }
    msg += `\n`;
  }

  if (summary.sources && summary.sources.length > 0) {
    msg += `💳 *Sumber Dana:*\n`;
    for (const src of summary.sources) {
      if (src.name && src.total && src.total !== "Rp0") {
        msg += `  • ${src.name}: ${src.total}\n`;
      }
    }
  }

  return msg;
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=======================================================");
      console.log("📲 SCAN QR CODE INI MENGGUNAKAN WHATSAPP ANDA:");
      console.log("   (Buka WhatsApp > Perangkat Tertaut / Linked Devices > Tautkan Perangkat)");
      console.log("=======================================================\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("⚠️ Koneksi terputus. Mencoba reconnect:", shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === "open") {
      console.log("✅ Bot WhatsApp berhasil terhubung dan siap digunakan!");
      console.log("Nomor terdaftar:", sock.user?.id);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const senderJid = msg.key.remoteJid;
      if (!isAuthorized(senderJid)) {
        console.log(`Pesan diabaikan dari nomor tidak terdaftar: ${senderJid}`);
        continue;
      }

      const messageType = Object.keys(msg.message)[0];
      const isImage = messageType === "imageMessage";
      const isExtendedText = messageType === "extendedTextMessage";
      const isConversation = messageType === "conversation";

      const textBody =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      // 1. Process Receipt Screenshot
      if (isImage) {
        await sock.sendMessage(senderJid, {
          text: "🔍 *Menganalisis screenshot transaksi dengan Gemini Vision...*",
        });

        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const mimeType = msg.message.imageMessage?.mimetype || "image/jpeg";
          const caption = msg.message.imageMessage?.caption || "";

          const parsed = await parseExpenseFromImage(buffer, mimeType, caption);

          if (!parsed.isExpense) {
            await sock.sendMessage(senderJid, {
              text: "⚠️ Maaf, gambar tidak terbaca sebagai bukti transaksi atau screenshot pembayaran yang valid.",
            });
            continue;
          }

          const res = await appendExpense(parsed);

          let reply = `✅ *Transaksi Berhasil Dicatat dari Screenshot!*\n\n`;
          reply += `📅 Tanggal: *${parsed.date}*\n`;
          reply += `🏷️ Kategori: *${parsed.category}*\n`;
          reply += `📝 Deskripsi: *${parsed.description}*\n`;
          reply += `💵 Jumlah: *${formatRupiah(parsed.amount)}*\n`;
          reply += `💳 Sumber: *${parsed.source}*\n\n`;
          reply += `💰 *Sisa Budget (${res.sheetName}):* ${res.summary.remainingBudget}\n`;
          reply += `💸 *Total Pengeluaran:* ${res.summary.totalExpenses}`;

          await sock.sendMessage(senderJid, { text: reply });
        } catch (err) {
          console.error("Gagal memproses screenshot:", err);
          await sock.sendMessage(senderJid, {
            text: `❌ Terjadi kesalahan saat membaca bukti transaksi: ${err.message}`,
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
          await sock.sendMessage(senderJid, { text: "⏳ Mengambil data laporan keuangan..." });
          const summary = await getMonthlySummary();
          const reply = formatSummaryMessage(summary);
          await sock.sendMessage(senderJid, { text: reply });
        } catch (err) {
          await sock.sendMessage(senderJid, { text: `❌ Gagal mengambil ringkasan: ${err.message}` });
        }
        continue;
      }

      // 3. Process Natural Language Expense Entry
      if (textBody.trim().length > 0) {
        try {
          const parsed = await parseExpenseFromText(textBody);

          if (parsed.isExpense) {
            const res = await appendExpense(parsed);

            let reply = `✅ *Transaksi Berhasil Dicatat!*\n\n`;
            reply += `📅 Tanggal: *${parsed.date}*\n`;
            reply += `🏷️ Kategori: *${parsed.category}*\n`;
            reply += `📝 Deskripsi: *${parsed.description}*\n`;
            reply += `💵 Jumlah: *${formatRupiah(parsed.amount)}*\n`;
            reply += `💳 Sumber: *${parsed.source}*\n\n`;
            reply += `💰 *Sisa Budget (${res.sheetName}):* ${res.summary.remainingBudget}\n`;
            reply += `💸 *Total Pengeluaran:* ${res.summary.totalExpenses}`;

            await sock.sendMessage(senderJid, { text: reply });
          } else {
            // General Help
            const help =
              `👋 *WhatsApp Expense Bot*\n\n` +
              `Kirimkan pengeluaran Anda dengan cara:\n` +
              `1. 📸 *Kirim Screenshot* bukti bayar / QRIS / transfer m-banking.\n` +
              `2. ✍️ *Ketik langsung*, contoh:\n` +
              `   • _"Makan warteg 18rb seabank"_\n` +
              `   • _"Kopi starbucks 55k bca"_\n` +
              `   • _"Beli pulsa 100rb grab"_\n` +
              `3. 📊 Ketik *budget* untuk melihat sisa budget & ringkasan pengeluaran bulan ini.`;
            await sock.sendMessage(senderJid, { text: help });
          }
        } catch (err) {
          console.error("Gagal memproses pesan teks:", err);
          await sock.sendMessage(senderJid, {
            text: `❌ Terjadi kesalahan: ${err.message}`,
          });
        }
      }
    }
  });
}

startBot().catch((err) => console.error("Fatal Bot Error:", err));
