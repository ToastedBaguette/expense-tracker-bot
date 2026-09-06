import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const hasDiscord = !!process.env.DISCORD_TOKEN;
const hasWhatsApp = !!process.env.AUTHORIZED_NUMBERS;
const platformEnv = (process.env.PLATFORM || "").toLowerCase().trim();

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function startDiscord() {
  console.log("Starting Discord bot...\n");
  await import("./discord.js");
}

async function startWhatsApp() {
  console.log("Starting WhatsApp bot...\n");
  await import("./index.js");
}

async function main() {
  // PLATFORM env var takes priority (useful for Docker / CI)
  if (platformEnv === "discord") {
    await startDiscord();
    return;
  }
  if (platformEnv === "whatsapp") {
    await startWhatsApp();
    return;
  }

  // If only one platform is configured, start it directly
  if (hasDiscord && !hasWhatsApp) {
    await startDiscord();
    return;
  }

  if (hasWhatsApp && !hasDiscord) {
    await startWhatsApp();
    return;
  }

  if (!hasDiscord && !hasWhatsApp) {
    console.error(
      "No platform configured.\n" +
      "Set DISCORD_TOKEN for Discord or AUTHORIZED_NUMBERS for WhatsApp in your .env file.\n" +
      "See README.md for setup instructions."
    );
    process.exit(1);
  }

  // Both platforms are configured — let the user choose
  console.log("Both Discord and WhatsApp are configured.\n");
  console.log("  1. Discord (recommended)");
  console.log("  2. WhatsApp");
  console.log("");

  const answer = await prompt("Select platform [1/2]: ");

  if (answer === "2" || answer.toLowerCase().startsWith("w")) {
    await startWhatsApp();
  } else {
    await startDiscord();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
