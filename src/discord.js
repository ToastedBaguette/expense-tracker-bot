import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
} from "discord.js";
import dotenv from "dotenv";
import { parseExpenseFromImage, parseExpenseFromText } from "./gemini.js";
import { appendExpenses, addIncome, getMonthlySummary } from "./sheets.js";

dotenv.config();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.warn("⚠️ Warning: DISCORD_TOKEN is not set in .env!");
}

const targetChannelId = process.env.DISCORD_CHANNEL_ID;
const authorizedUsers = (process.env.DISCORD_AUTHORIZED_USERS || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

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
 * Checks if user is authorized to interact with the bot
 */
function isUserAuthorized(userId) {
  if (authorizedUsers.length === 0) return true;
  return authorizedUsers.includes(userId);
}

/**
 * Checks if the channel is allowed
 */
function isChannelAllowed(channelId) {
  if (!targetChannelId) return true;
  return targetChannelId === channelId;
}

client.once("ready", () => {
  console.log("\n=======================================================");
  console.log(`🤖 Discord Expense Bot online as: ${client.user.tag}`);
  console.log(`📡 Ready to receive receipts and expense messages!`);
  if (targetChannelId) {
    console.log(`🔒 Restricted to Channel ID: ${targetChannelId}`);
  }
  console.log("=======================================================\n");
});

client.on("messageCreate", async (message) => {
  // Ignore bots and webhooks
  if (message.author.bot) return;

  // Check authorization & channel
  if (!isUserAuthorized(message.author.id)) return;
  if (!isChannelAllowed(message.channel.id)) return;

  const text = message.content.trim();
  const lowerText = text.toLowerCase();

  // 1. Budget Summary Query
  if (
    lowerText === "budget" ||
    lowerText === "sisa budget" ||
    lowerText === "cek budget" ||
    lowerText === "laporan" ||
    lowerText === "summary"
  ) {
    try {
      const summary = await getMonthlySummary();

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`📊 Laporan Keuangan — ${summary.month}`)
        .addFields(
          { name: "Pemasukan", value: `**${summary.income}**`, inline: true },
          { name: "Pengeluaran", value: `**${summary.totalExpenses}**`, inline: true },
          { name: "Sisa Budget", value: `**${summary.remainingBudget}**`, inline: true }
        );

      const activeCategories = (summary.categories || [])
        .filter((c) => c.name && c.total && c.total !== "Rp0")
        .map((c) => `• **${c.name}**: ${c.total}`)
        .join("\n");

      if (activeCategories) {
        embed.addFields({ name: "Kategori", value: activeCategories, inline: false });
      }

      const activeSources = (summary.sources || [])
        .filter((s) => s.name && s.total && s.total !== "Rp0")
        .map((s) => `• **${s.name}**: ${s.total}`)
        .join("\n");

      if (activeSources) {
        embed.addFields({ name: "Sumber Dana", value: activeSources, inline: false });
      }

      embed.setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("Discord budget query error:", err);
      await message.reply(`❌ Gagal mengambil laporan: ${err.message}`);
    }
    return;
  }

  // 2. Check for image attachments (Screenshots, Receipts)
  const imageAttachment = message.attachments.find((att) =>
    att.contentType?.startsWith("image/")
  );

  if (imageAttachment) {
    const statusMsg = await message.reply("🔍 *Menganalisis bukti transaksi dengan Gemini Vision...*");

    try {
      const resImg = await fetch(imageAttachment.url);
      const arrayBuffer = await resImg.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = imageAttachment.contentType || "image/jpeg";

      const parsed = await parseExpenseFromImage(buffer, mimeType, text);

      if (parsed.type === "INCOME" && parsed.income) {
        const res = await addIncome(parsed.income);
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle("💰 Pemasukan Berhasil Ditambahkan")
          .addFields(
            { name: "Deskripsi", value: parsed.income.description || "Pemasukan", inline: true },
            { name: "Jumlah", value: `+${formatRupiah(parsed.income.amount)}`, inline: true },
            { name: "Sumber", value: parsed.income.source || "BCA", inline: true },
            { name: `Total Pemasukan (${res.sheetName})`, value: res.summary.income, inline: true },
            { name: "Sisa Budget", value: res.summary.remainingBudget, inline: true },
            { name: "Total Pengeluaran", value: res.summary.totalExpenses, inline: true }
          )
          .setTimestamp();

        await statusMsg.edit({ content: null, embeds: [embed] });
      } else if (parsed.type === "EXPENSE" && parsed.expenses && parsed.expenses.length > 0) {
        const res = await appendExpenses(parsed.expenses);

        const isSingle = parsed.expenses.length === 1;
        const totalBatch = parsed.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(isSingle ? "✅ Transaksi Berhasil Dicatat" : `✅ ${parsed.expenses.length} Transaksi Berhasil Dicatat`);

        let itemsDesc = "";
        for (const exp of parsed.expenses) {
          const isNeg = Number(exp.amount) < 0 || exp.isReimbursement;
          const tag = isNeg ? " *(Reimbursement)*" : "";
          itemsDesc += `• **${exp.date}** | ${exp.description}\n  ${formatRupiah(exp.amount)} (${exp.category} • ${exp.source}${tag})\n`;
        }

        embed.setDescription(itemsDesc);

        if (!isSingle) {
          embed.addFields({ name: "Total Transaksi Ini", value: formatRupiah(totalBatch), inline: true });
        }

        embed.addFields(
          { name: `Sisa Budget (${res.sheetName})`, value: res.summary.remainingBudget, inline: true },
          { name: "Total Pengeluaran", value: res.summary.totalExpenses, inline: true }
        );

        embed.setTimestamp();
        await statusMsg.edit({ content: null, embeds: [embed] });
      } else {
        await statusMsg.edit("⚠️ Gambar tidak terbaca sebagai transaksi yang valid.");
      }
    } catch (err) {
      console.error("Discord image processing error:", err);
      await statusMsg.edit(`❌ Terjadi kesalahan saat membaca gambar: ${err.message}`);
    }
    return;
  }

  // 3. Process Natural Language Text Entry
  if (text.length > 0) {
    try {
      const parsed = await parseExpenseFromText(text);

      if (parsed.type === "INCOME" && parsed.income) {
        const res = await addIncome(parsed.income);
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle("💰 Pemasukan Berhasil Ditambahkan")
          .addFields(
            { name: "Deskripsi", value: parsed.income.description || "Pemasukan", inline: true },
            { name: "Jumlah", value: `+${formatRupiah(parsed.income.amount)}`, inline: true },
            { name: "Sumber", value: parsed.income.source || "BCA", inline: true },
            { name: `Total Pemasukan (${res.sheetName})`, value: res.summary.income, inline: true },
            { name: "Sisa Budget", value: res.summary.remainingBudget, inline: true },
            { name: "Total Pengeluaran", value: res.summary.totalExpenses, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else if (parsed.type === "EXPENSE" && parsed.expenses && parsed.expenses.length > 0) {
        const res = await appendExpenses(parsed.expenses);

        const isSingle = parsed.expenses.length === 1;
        const totalBatch = parsed.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(isSingle ? "✅ Transaksi Berhasil Dicatat" : `✅ ${parsed.expenses.length} Transaksi Berhasil Dicatat`);

        let itemsDesc = "";
        for (const exp of parsed.expenses) {
          const isNeg = Number(exp.amount) < 0 || exp.isReimbursement;
          const tag = isNeg ? " *(Reimbursement)*" : "";
          itemsDesc += `• **${exp.date}** | ${exp.description}\n  ${formatRupiah(exp.amount)} (${exp.category} • ${exp.source}${tag})\n`;
        }

        embed.setDescription(itemsDesc);

        if (!isSingle) {
          embed.addFields({ name: "Total Transaksi Ini", value: formatRupiah(totalBatch), inline: true });
        }

        embed.addFields(
          { name: `Sisa Budget (${res.sheetName})`, value: res.summary.remainingBudget, inline: true },
          { name: "Total Pengeluaran", value: res.summary.totalExpenses, inline: true }
        );

        embed.setTimestamp();
        await message.reply({ embeds: [embed] });
      } else {
        // Helpful guide if text wasn't recognized as financial transaction
        const embed = new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle("💡 Cara Menggunakan Expense Bot")
          .setDescription(
            "Ketik pengeluaran atau unggah bukti transaksi:\n\n" +
            "• **Catat Pengeluaran:** `Makan warteg 18rb seabank`\n" +
            "• **Banyak Transaksi Sekaligus:** `Kopi 25k bca, bensin 35k seabank`\n" +
            "• **Reimbursement:** `Hans bayar makan 50rb bca`\n" +
            "• **Pemasukan:** `Dapat freelance 1.5jt bca`\n" +
            "• **Cek Status Budget:** Ketik `budget` atau `laporan`\n" +
            "• **Screenshot:** Cukup upload foto/screenshot bukti transaksi!"
          );
        await message.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error("Discord text error:", err);
      await message.reply(`❌ Terjadi kesalahan: ${err.message}`);
    }
  }
});

if (token) {
  client.login(token).catch((err) => {
    console.error("❌ Failed to login to Discord:", err.message);
  });
} else {
  console.log("ℹ️ To start the Discord bot, set DISCORD_TOKEN in your .env file.");
}
