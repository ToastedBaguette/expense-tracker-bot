# Personal Expense Tracker Bot (Discord & WhatsApp) 🤖💸

Automated personal finance tracking bot powered by **Google Gemini Vision** and **Google Sheets**.
Supports both **Discord** (recommended, rock-solid official API with rich embeds) and **WhatsApp**.

---

## ✨ Key Features

- 📸 **Receipt & Mutation OCR**: Upload or send a screenshot of any payment (BCA Mobile, QRIS, GoPay, Seabank, Grab, Livin, OVO, Indomaret). Gemini Vision automatically extracts transactions into your spreadsheet.
- ✍️ **Natural Language & Multi-Transaction**: Send single or multiple expenses at once:
  - `"Makan siang 25rb bca, naik grab 35k seabank, bensin 30k bca"`
- 💵 **Income & Reimbursement Support**:
  - **Reimbursements / Split-Bill**: `"Hans bayar makan 50rb bca"` — recorded as a negative expense (`-Rp 50.000`), reducing that category's total!
  - **Extra Income**: `"Dapat transfer freelance 1.5jt bca"` — automatically added to your monthly Income budget in `K3`.
- 📊 **Tailored Categories**:
  - `Food`, `Living`, `Transport`, `Family`, `Entertainment`, `Other`
- 💳 **Payment Sources**: `BCA`, `Seabank`, `Grab`, `Superbank`, `Gopay`, `OVO`.
- 💰 **Live Budget Inquiries**: Type `budget` or `laporan` to view real-time balance and breakdowns.

---

## 🚀 Running on Discord (Recommended)

### 1. Create a Discord Bot (2 Minutes)
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, name it (e.g. `Expense Bot`).
3. In the left menu, click **Bot** > **Reset Token** (Copy your Bot Token).
4. Scroll down to **Privileged Gateway Intents** and enable:
   - ✅ **Message Content Intent**
5. Go to **OAuth2 > URL Generator**:
   - Scopes: check `bot`.
   - Bot Permissions: check `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`.
   - Copy the generated invite link, open it in your browser, and invite the bot to your private server!

### 2. Configure `.env`
In `.env`, paste your bot token:
```env
DISCORD_TOKEN=your_discord_bot_token_here
# (Optional) Restrict bot to a specific channel (e.g. #expenses)
DISCORD_CHANNEL_ID=
```

### 3. Start the Discord Bot
```bash
npm start
# or: npm run start:discord
```

---

## 📱 Running on WhatsApp (Alternative)

If you prefer WhatsApp:
```bash
npm run start:whatsapp
```
Scan the terminal QR code with your phone via **WhatsApp > Linked Devices > Link a Device**.
