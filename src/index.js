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
import { appendExpense, getMonthlySummary } from "./sheets.js";

dotenv.config();

const AUTH_DIR = path.resolve("./auth_info_baileys");
const AUTHORIZED_NUMBERS = (process.env.AUTHORIZED_NUMBERS || "")
  .split(",")
  .map((num) => num.trim().replace(/[^0-9]/g, ""))
  .filter(Boolean);

// Cache to prevent the bot from responding to its own sent messages
const botSentMessageIds = new Set();

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

  // Helper to send message and track its ID so bot doesn't loop on its own replies
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
      console.log("\n=======================================================");
      console.log("✅ Bot WhatsApp berhasil terhubung dan aktif!");
      console.log("ID Akun:", sock.user?.id);
      console.log("📱 CARA MEMULAI:");
      console.log("   1. Buka WhatsApp di HP Anda");
      console.log("   2. Buka chat ke DIRI SENDIRI ('Message yourself' / 'Kirim pesan ke diri Anda')");
      console.log("   3. Ketik 'budget' atau kirim foto screenshot transaksi!");
      console.log("=======================================================\n");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const myPhone = (sock.user?.id || "").split(":")[0].replace(/[^0-9]/g, "");
    const myLid = (sock.user?.lid || "").split(":")[0].replace(/[^0-9]/g, "");

    for (const msg of messages) {
      if (!msg.message) continue;

      // Skip messages sent by this bot process itself
      if (botSentMessageIds.has(msg.key.id)) continue;

      const senderJid = msg.key.remoteJid;
      if (!senderJid) continue;

      // Ignore broadcast status updates
      if (senderJid === "status@broadcast") continue;

      // Check if this message was sent to self ("Message yourself" / chat dengan diri sendiri)
      const isSelfChat =
        (myPhone && senderJid.includes(myPhone)) ||
        (myLid && senderJid.includes(myLid));

      // If the message is marked fromMe:
      // Allow it ONLY if it's sent in a self-chat!
      // If it was sent in a chat with someone else or a group, ignore so we don't interfere with personal chats.
      if (msg.key.fromMe && !isSelfChat) {
        continue;
      }

      // If it's an incoming message from someone else, verify authorization
      if (!msg.key.fromMe && !isAuthorized(senderJid)) {
        console.log(`Pesan diabaikan dari nomor tidak terdaftar: ${senderJid}`);
        continue;
      }

      const messageType = Object.keys(msg.message)[0];
      const isImage = messageType === "imageMessage";

      const textBody =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      // 1. Process Receipt Screenshot
      if (isImage) {
        await reply(senderJid, {
          text: "🔍 *Menganalisis screenshot transaksi dengan Gemini Vision...*",
        });

        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const mimeType = msg.message.imageMessage?.mimetype || "image/jpeg";
          const caption = msg.message.imageMessage?.caption || "";

          const parsed = await parseExpenseFromImage(buffer, mimeType, caption);

          if (!parsed.isExpense) {
            await reply(senderJid, {
              text: "⚠️ Maaf, gambar tidak terbaca sebagai bukti transaksi atau screenshot pembayaran yang valid.",
            });
            continue;
          }

          const res = await appendExpense(parsed);

          let replyText = `✅ *Transaksi Berhasil Dicatat dari Screenshot!*\n\n`;
          replyText += `📅 Tanggal: *${parsed.date}*\n`;
          replyText += `🏷️ Kategori: *${parsed.category}*\n`;
          replyText += `📝 Deskripsi: *${parsed.description}*\n`;
          replyText += `💵 Jumlah: *${formatRupiah(parsed.amount)}*\n`;
          replyText += `💳 Sumber: *${parsed.source}*\n\n`;
          replyText += `💰 *Sisa Budget (${res.sheetName}):* ${res.summary.remainingBudget}\n`;
          replyText += `💸 *Total Pengeluaran:* ${res.summary.totalExpenses}`;

          await reply(senderJid, { text: replyText });
        } catch (err) {
          console.error("Gagal memproses screenshot:", err);
          await reply(senderJid, {
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
          await reply(senderJid, { text: "⏳ Mengambil data laporan keuangan..." });
          const summary = await getMonthlySummary();
          const summaryText = formatSummaryMessage(summary);
          await reply(senderJid, { text: summaryText });
        } catch (err) {
          await reply(senderJid, { text: `❌ Gagal mengambil ringkasan: ${err.message}` });
        }
        continue;
      }

      // 3. Process Natural Language Expense Entry
      if (textBody.trim().length > 0) {
        try {
          const parsed = await parseExpenseFromText(textBody);

          if (parsed.isExpense) {
            const res = await appendExpense(parsed);

            let replyText = `✅ *Transaksi Berhasil Dicatat!*\n\n`;
            replyText += `📅 Tanggal: *${parsed.date}*\n`;
            replyText += `🏷️ Kategori: *${parsed.category}*\n`;
            replyText += `📝 Deskripsi: *${parsed.description}*\n`;
            replyText += `💵 Jumlah: *${formatRupiah(parsed.amount)}*\n`;
            replyText += `💳 Sumber: *${parsed.source}*\n\n`;
            replyText += `💰 *Sisa Budget (${res.sheetName}):* ${res.summary.remainingBudget}\n`;
            replyText += `💸 *Total Pengeluaran:* ${res.summary.totalExpenses}`;

            await reply(senderJid, { text: replyText });
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
            await reply(senderJid, { text: help });
          }
        } catch (err) {
          console.error("Gagal memproses pesan teks:", err);
          await reply(senderJid, {
            text: `❌ Terjadi kesalahan: ${err.message}`,
          });
        }
      }
    }
  });
}

startBot().catch((err) => console.error("Fatal Bot Error:", err));
