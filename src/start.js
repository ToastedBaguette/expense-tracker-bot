import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const hasDiscord = !!process.env.DISCORD_TOKEN;
const hasWhatsApp = !!process.env.AUTHORIZED_NUMBERS;

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

async function main() {
  // If only one platform is configured, start it directly
  if (hasDiscord && !hasWhatsApp) {
    console.log("Starting Discord bot...\n");
    await import("./discord.js");
    return;
  }

  if (hasWhatsApp && !hasDiscord) {
    console.log("Starting WhatsApp bot...\n");
    await import("./index.js");
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
    console.log("\nStarting WhatsApp bot...\n");
    await import("./index.js");
  } else {
    console.log("\nStarting Discord bot...\n");
    await import("./discord.js");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
