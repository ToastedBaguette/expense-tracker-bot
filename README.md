# Expense Tracker Bot

Automated personal finance tracking bot powered by **Google Gemini Vision** and **Google Sheets**.
Send a receipt screenshot or type expenses in natural language — the bot extracts transactions and logs them directly into your spreadsheet.

Supports **Discord** (recommended) and **WhatsApp**.

---

## Table of Contents

1. [Features](#features)
2. [How It Works](#how-it-works)
3. [Prerequisites](#prerequisites)
4. [Step 1 — Create the Google Sheets Template](#step-1--create-the-google-sheets-template)
5. [Step 2 — Get a Gemini API Key](#step-2--get-a-gemini-api-key)
6. [Step 3 — Set Up Google Sheets Credentials](#step-3--set-up-google-sheets-credentials)
7. [Step 4 — Create a Discord Bot](#step-4--create-a-discord-bot)
8. [Step 5 — Configure Environment Variables](#step-5--configure-environment-variables)
9. [Step 6 — Install and Run](#step-6--install-and-run)
10. [Usage Examples](#usage-examples)
11. [Optional: Google Sheets MCP Setup](#optional-google-sheets-mcp-setup)
12. [Running on WhatsApp (Alternative)](#running-on-whatsapp-alternative)
13. [Project Structure](#project-structure)
14. [Troubleshooting](#troubleshooting)
15. [License](#license)

---

## Features

- **Receipt OCR** — Upload a screenshot of any payment app (BCA, QRIS, GoPay, Seabank, Grab, Livin, OVO, ShopeePay, Indomaret) and Gemini Vision automatically extracts the transaction.
- **Natural Language Input** — Type expenses conversationally in Indonesian or English:
  `"Makan siang 25rb bca, naik grab 35k seabank, bensin 30k bca"`
- **Multi-Transaction** — Record multiple expenses in a single message.
- **Income Tracking** — Report salary, freelance, or bonus income:
  `"Dapat freelance 1.5jt bca"`
- **Reimbursement / Split-Bill** — When a friend pays you back, it reduces the category total:
  `"Hans bayar makan 50rb bca"` → recorded as -Rp 50.000
- **Live Budget Summary** — Type `budget` or `laporan` to see remaining balance and breakdowns.
- **Categories**: Food, Living, Transport, Family, Entertainment, Other
- **Payment Sources**: BCA, Seabank, Grab, Superbank, Gopay, OVO

---

## How It Works

```
You (Discord/WhatsApp)
  │
  ├─ Send text message or receipt screenshot
  │
  ▼
Gemini Vision / NLP
  │
  ├─ Extracts: date, category, description, amount, source
  │
  ▼
Google Sheets API
  │
  ├─ Appends transaction to the correct monthly tab
  ├─ Updates formulas automatically
  │
  ▼
Bot replies with confirmation + remaining budget
```

The bot uses the **Google Sheets REST API** (`googleapis` npm package) directly — it does not require MCP at runtime. MCP is an optional, separate tool for managing your spreadsheet through an AI assistant (see [Optional: Google Sheets MCP Setup](#optional-google-sheets-mcp-setup)).

---

## Prerequisites

- **Node.js** v18 or later — [Download](https://nodejs.org/)
- A **Google Account** with access to Google Sheets
- A **Google Gemini API key** (free tier available)
- A **Discord account** with a private server (for the Discord bot)

---

## Step 1 — Create the Google Sheets Template

Create a new Google Sheets spreadsheet that the bot will write to. The spreadsheet uses monthly tabs (one per month, e.g. "September 2026", "Aug 2026").

### 1.1 Create the spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
2. Name it something like **"Expenses"**.
3. Rename the first sheet tab to the current month, e.g. `September 2026`.

### 1.2 Set up the transaction columns (B:F)

Starting from **row 2**, add these headers in cells **B2 through F2**:

| Cell | Header      |
|------|-------------|
| B2   | Date        |
| C2   | Category    |
| D2   | Description |
| E2   | Amount      |
| F2   | Source      |

Transactions will be appended starting from **row 3** downward (B3:F3, B4:F4, etc.).

**Column A** is intentionally left empty as a spacer.

### 1.3 Set up the daily breakdown table (H:I)

This table shows total spending per day of the month.

| Cell | Value                                                    |
|------|----------------------------------------------------------|
| H2   | `Date`                                                   |
| I2   | `Total`                                                  |
| H3   | `1` (the day number, as a date serial or just the number)|
| I3   | `=SUMPRODUCT((DAY(B$3:B$996)=DAY(H3))*(E$3:E$996))`     |

Fill H3:H33 with days 1 through 31 (or use actual date serials for the month).
Copy the `I3` formula down through `I33`.

### 1.4 Set up the summary area (K:M)

| Cell | Label / Formula                                                  |
|------|------------------------------------------------------------------|
| K2   | `Overview` (header)                                              |
| K3   | `Income` (label)     — put your monthly income value, e.g. `9800000` |
| L3   | `Total Expenses` — formula: `=SUM(L6:L11)`                      |
| M3   | `Remaining` — formula: `=K3-L3`                                 |

### 1.5 Set up category totals (K6:L11)

| Cell | Category      | Formula                                            |
|------|---------------|----------------------------------------------------|
| K6   | Food          | L6: `=SUMIFS(E$3:E$996,C$3:C$996,"Food")`          |
| K7   | Living        | L7: `=SUMIFS(E$3:E$996,C$3:C$996,"Living")`        |
| K8   | Transport     | L8: `=SUMIFS(E$3:E$996,C$3:C$996,"Transport")`     |
| K9   | Family        | L9: `=SUMIFS(E$3:E$996,C$3:C$996,"Family")`        |
| K10  | Entertainment | L10: `=SUMIFS(E$3:E$996,C$3:C$996,"Entertainment")`|
| K11  | Other         | L11: `=SUMIFS(E$3:E$996,C$3:C$996,"Other")`        |

### 1.6 Set up source totals (K14:L18)

| Cell | Source   | Formula                                           |
|------|----------|---------------------------------------------------|
| K14  | Gopay    | L14: `=SUMIFS(E$3:E$996,F$3:F$996,"Gopay")`      |
| K15  | BCA      | L15: `=SUMIFS(E$3:E$996,F$3:F$996,"BCA")`        |
| K16  | Seabank  | L16: `=SUMIFS(E$3:E$996,F$3:F$996,"Seabank")`    |
| K17  | Grab     | L17: `=SUMIFS(E$3:E$996,F$3:F$996,"Grab")`       |
| K18  | Superbank| L18: `=SUMIFS(E$3:E$996,F$3:F$996,"Superbank")`  |

### 1.7 (Optional) Add data validation for Category column

Select the range **C3:C996**, go to **Data > Data validation**, and add a dropdown list with:
`Food, Living, Transport, Family, Entertainment, Other`

### 1.8 Note the Spreadsheet ID

Your spreadsheet URL looks like:
```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
```

Copy the long string between `/d/` and `/edit` — that is your **Spreadsheet ID**. You will need this for the `.env` file.

### 1.9 Duplicate for new months

Each month, duplicate the sheet tab and rename it (e.g. "October 2026"). Clear the transaction rows (B3:F downward) and update the income in K3 if needed. The formulas will recalculate automatically.

---

## Step 2 — Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click **Get API key** in the left sidebar.
4. Click **Create API key** and select or create a Google Cloud project.
5. Copy the generated API key.

The free tier is sufficient for personal use.

---

## Step 3 — Set Up Google Sheets Credentials

The bot needs permission to read and write to your Google Sheets spreadsheet. There are two options:

### Option A: Service Account (Recommended for servers)

A service account is a dedicated Google account for your bot. This is the most reliable method.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Enable the **Google Sheets API**:
   - Go to **APIs & Services > Library**.
   - Search for "Google Sheets API" and click **Enable**.
4. Create a service account:
   - Go to **APIs & Services > Credentials**.
   - Click **Create Credentials > Service Account**.
   - Give it a name (e.g. "expense-bot") and click **Done**.
5. Create a key for the service account:
   - Click on the service account you just created.
   - Go to the **Keys** tab.
   - Click **Add Key > Create new key > JSON**.
   - A `.json` file will be downloaded. Save it as `service_account.json` in the project root.
6. Share your spreadsheet with the service account:
   - Open your Google Sheets spreadsheet.
   - Click **Share**.
   - Paste the service account email (looks like `expense-bot@your-project.iam.gserviceaccount.com`).
   - Give it **Editor** access.

### Option B: OAuth 2.0 (Personal use)

If you prefer to authenticate as yourself:

1. In Google Cloud Console, go to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Select **Desktop app** as the application type.
4. Download the credentials JSON.
5. Use the client ID, client secret, and a refresh token in your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_REFRESH_TOKEN=your_refresh_token
   ```

You can obtain a refresh token by running the OAuth consent flow with your client credentials. Many tutorials and tools exist for this (e.g., Google's OAuth 2.0 Playground at https://developers.google.com/oauthplayground).

---

## Step 4 — Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and name it (e.g. "Expense Bot").
3. In the left menu, click **Bot**.
4. Click **Reset Token** and copy your bot token — save it somewhere safe.
5. Scroll down to **Privileged Gateway Intents** and enable:
   - **Message Content Intent** (required for the bot to read messages)
6. Go to **OAuth2 > URL Generator**:
   - Under **Scopes**, check `bot`.
   - Under **Bot Permissions**, check:
     - Send Messages
     - Embed Links
     - Attach Files
     - Read Message History
   - Copy the generated invite URL.
7. Open the URL in your browser and invite the bot to your private server.

### (Optional) Restrict to a specific channel

If you want the bot to only respond in one channel (e.g. `#expenses`):

1. Open Discord and go to **Settings > Advanced > Developer Mode** (enable it).
2. Right-click the channel you want and click **Copy Channel ID**.
3. Paste it as `DISCORD_CHANNEL_ID` in your `.env` file.

### (Optional) Restrict to specific users

1. Right-click your username in Discord and click **Copy User ID**.
2. Paste it as `DISCORD_AUTHORIZED_USERS` in your `.env` file (comma-separated for multiple users).

---

## Step 5 — Configure Environment Variables

1. Clone the repository:
   ```bash
   git clone https://github.com/ToastedBaguette/expense-tracker-bot.git
   cd expense-tracker-bot
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your values:

   ```env
   # Gemini API Key (from Step 2)
   GEMINI_API_KEY=your_gemini_api_key

   # Google Sheets (from Step 1 and Step 3)
   SPREADSHEET_ID=your_spreadsheet_id
   GOOGLE_APPLICATION_CREDENTIALS=./service_account.json

   # Discord (from Step 4)
   DISCORD_TOKEN=your_discord_bot_token

   # (Optional) Restrict bot to a specific channel
   DISCORD_CHANNEL_ID=

   # (Optional) Restrict bot to specific Discord users
   DISCORD_AUTHORIZED_USERS=
   ```

   If using OAuth instead of a service account, replace `GOOGLE_APPLICATION_CREDENTIALS` with:
   ```env
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_REFRESH_TOKEN=your_refresh_token
   ```

---

## Step 6 — Install and Run

```bash
npm install
npm start
```

If both Discord and WhatsApp are configured in `.env`, the bot will prompt you to choose:

```
Both Discord and WhatsApp are configured.

  1. Discord (recommended)
  2. WhatsApp

Select platform [1/2]:
```

If only one platform is configured, it starts automatically. You can also bypass the prompt with:

```bash
npm run start:discord    # always start Discord
npm run start:whatsapp   # always start WhatsApp
```

---

## Usage Examples

### Record a single expense

```
Makan warteg 18rb seabank
```

Bot will parse: Food, "Warteg", Rp 18.000, Seabank — and log it to the current month's sheet.

### Record multiple expenses at once

```
Kopi 25k bca, bensin 35k seabank, parkir 5k gopay
```

Bot logs all three transactions in one go and shows the combined total.

### Record income

```
Dapat freelance 1.5jt bca
```

Bot adds Rp 1.500.000 to the Income cell (K3) of the current month.

### Record a reimbursement / split bill

```
Hans bayar makan 50rb bca
```

Bot records -Rp 50.000 under Food, reducing that category's total.

### Upload a receipt screenshot

Simply upload/attach an image of a receipt, bank transfer, QRIS payment, or mutation list. The bot uses Gemini Vision to read and extract all transactions from the image.

### Check budget

```
budget
```

Bot replies with your current month's income, total expenses, remaining budget, and breakdowns by category and payment source.

---

## Optional: Google Sheets MCP Setup

> **Note**: The bot itself does not use MCP. MCP (Model Context Protocol) is a separate tool that allows AI assistants like Gemini Code Assist or Antigravity to interact with your Google Sheets directly. This is useful if you want to manage or query your spreadsheet through an AI assistant alongside the bot.

If you use an MCP-compatible AI assistant and want to connect it to Google Sheets, follow the official guide:

**Reference**: [Configure the Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers)

### Quick overview

1. Open your MCP client's configuration file. For example, in Antigravity / Gemini Code Assist, this is typically at:
   ```
   ~/.gemini/config/mcp_config.json
   ```

2. Add the Google Sheets MCP server entry:
   ```json
   {
     "mcpServers": {
       "sheets": {
         "url": "https://sheetsmcp.googleapis.com/mcp/v1",
         "authorizationToken": "<leave empty or follow OAuth flow>"
       }
     }
   }
   ```

3. On first use, the MCP client will trigger an OAuth consent flow in your browser. Approve the Google Sheets permissions.

4. Once authenticated, you can ask your AI assistant to read, update, or create spreadsheet data directly through the MCP connection.

This is completely independent from the expense tracker bot and is an optional convenience for power users.

---

## Running on WhatsApp (Alternative)

> **Note**: The WhatsApp integration uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial library. It works but can be less stable than Discord due to session encryption issues on reconnect.

```bash
npm run start:whatsapp
```

1. A QR code will appear in your terminal.
2. Open WhatsApp on your phone.
3. Go to **Settings > Linked Devices > Link a Device**.
4. Scan the QR code.
5. Send messages or screenshots to your own WhatsApp number (self-chat) or from an authorized number.

Configure authorized phone numbers in `.env`:
```env
AUTHORIZED_NUMBERS=628XXXXXXXXXX
```

---

## Project Structure

```
expense-tracker-bot/
├── src/
│   ├── start.js        # Unified launcher with platform selection
│   ├── gemini.js       # Gemini Vision OCR + NLP text parser
│   ├── sheets.js       # Google Sheets API client (read/write)
│   ├── discord.js      # Discord bot (recommended)
│   └── index.js        # WhatsApp bot (alternative)
├── .env.example        # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

| File          | Description                                                                 |
|---------------|-----------------------------------------------------------------------------|
| `start.js`    | Entry point. Prompts for platform choice when both Discord and WhatsApp are configured. |
| `gemini.js`   | Sends images/text to Gemini for structured extraction. Multi-model fallback (gemini-3.5-flash → gemini-3.6-flash → gemini-flash-latest). |
| `sheets.js`   | Handles authentication (service account / OAuth), resolves sheet tab names dynamically, appends expenses, adds income, reads summaries. |
| `discord.js`  | Discord.js bot with rich embed responses, image attachment OCR, channel and user restrictions. |
| `index.js`    | WhatsApp bot via Baileys with QR login, message deduplication, and self-chat support. |

---

## Troubleshooting

**Bot doesn't respond to messages in Discord**
- Make sure **Message Content Intent** is enabled in the Discord Developer Portal under Bot settings.
- If using `DISCORD_CHANNEL_ID`, verify the channel ID is correct.
- Check that the bot has permission to read and send messages in the channel.

**"No valid Google credentials found" error**
- Ensure `service_account.json` exists in the project root and the path in `.env` is correct.
- If using OAuth, ensure all three variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) are set.

**Spreadsheet not updating / Permission denied**
- If using a service account, make sure you shared the spreadsheet with the service account email and gave it **Editor** access.
- Check that `SPREADSHEET_ID` in `.env` matches your spreadsheet.

**Gemini API errors (503 / RESOURCE_EXHAUSTED)**
- The bot has automatic fallback across multiple Gemini models. If all models are busy, wait a moment and try again.
- Check your Gemini API quota at [Google AI Studio](https://aistudio.google.com/).

**WhatsApp "MessageCounterError: Key used already"**
- Delete the `auth_info_baileys/` folder and restart the bot to re-scan the QR code.
- This is a known issue with the Baileys library's Signal Protocol session management.

---

## License

MIT
