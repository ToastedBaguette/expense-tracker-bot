# WhatsApp Expense Tracker Bot 🤖💸

Automated personal expense tracking bot for WhatsApp powered by **Baileys**, **Google Gemini 2.5 Flash Vision**, and **Google Sheets**.

---

## ✨ Key Features

- 📸 **Receipt & Transfer OCR**: Send a screenshot of any Indonesian banking app or e-wallet (BCA Mobile, Seabank, GoPay, Grab, QRIS, Livin, OVO, ShopeePay, Indomaret). Gemini Vision automatically extracts the date, merchant, amount, category, and payment source.
- ✍️ **Natural Language Chat**: Send simple messages like `"Makan siang warteg 18rb seabank"` or `"Kopi 25k bca"`.
- 📊 **Google Sheets Sync**: Appends transactions directly into the active monthly sheet (e.g., `September 2026`) matching your exact template columns:
  - `Date` (e.g. `5-Sep-2026`)
  - `Category` (`Food`, `Living`, `Invest`, `Entertainment`, `Other`)
  - `Description`
  - `Amount`
  - `Source` (`BCA`, `Seabank`, `Grab`, `Superbank`, `Gopay`, `OVO`)
- 💰 **Live Budget Inquiries**: Type `budget` or `laporan` to get your real-time Remaining Budget, Total Spent, and Category breakdowns.
- 🔒 **Private & Secure**: Only responds to authorized phone numbers defined in `.env`. Sensitive credentials and session tokens are strictly git-ignored.

---

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Fill in your configuration:
- `GEMINI_API_KEY`: Get a free key from [Google AI Studio](https://aistudio.google.com/).
- `SPREADSHEET_ID`: Your Google Sheets ID (e.g., `1LRGekJQ0mUugQbWRs_2lzYeEk7nBPHKdcdveOgTmk_I`).
- `AUTHORIZED_NUMBERS`: Your WhatsApp number with country code (e.g. `6282112345678`).
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to your Google Service Account JSON (or configure OAuth).

### 3. Run the Bot
```bash
npm start
```

### 4. Link WhatsApp
- A QR code will display in the terminal.
- Open **WhatsApp** on your phone > **Linked Devices (Perangkat Tertaut)** > **Link a Device**.
- Scan the QR code. Once authenticated, session data is preserved in `auth_info_baileys/` so you don't need to rescan on restart.

---

## 📱 How to Use in WhatsApp

### 1. Log by Screenshot
Just send a screenshot of your payment receipt! The bot reads it, appends it to your spreadsheet, and confirms:
```
✅ Transaksi Berhasil Dicatat dari Screenshot!

📅 Tanggal: 5-Sep-2026
🏷️ Kategori: Food
📝 Deskripsi: Kopi Kenangan
💵 Jumlah: Rp 25.000
💳 Sumber: BCA

💰 Sisa Budget (September 2026): Rp 9.775.000
💸 Total Pengeluaran: Rp 25.000
```

### 2. Log by Text
Send a quick chat message:
- `"Makan warteg 18rb seabank"`
- `"Beli pulsa 50k grab"`
- `"Bayar wifi fam 233rb bca"`

### 3. Check Budget
Send `"budget"`, `"sisa budget"`, or `"laporan"` to view your current status.
