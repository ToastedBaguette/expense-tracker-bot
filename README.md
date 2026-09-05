# WhatsApp Expense Tracker Bot 🤖💸

Automated personal finance tracking bot for WhatsApp powered by **Baileys**, **Google Gemini Vision**, and **Google Sheets**.

---

## ✨ Features

- 📸 **Receipt & Mutation OCR**: Send a screenshot of any Indonesian banking app or e-wallet (BCA Mobile, Seabank, GoPay, Grab, QRIS, Livin, OVO, ShopeePay, Indomaret). Gemini Vision automatically extracts single or multiple transactions.
- ✍️ **Natural Language & Multi-Transaction**: Send single or multiple expenses in one message:
  - `"Makan siang 25rb bca, naik grab 35k seabank, bensin 30k bca"`
- 💵 **Income & Reimbursement Support**:
  - **Reimbursements / Split-Bill**: Text `"Hans bayar makan 50rb bca"` — recorded as a negative expense (`-Rp 50.000`), automatically reducing that category's total!
  - **Extra Income**: Text `"Dapat transfer freelance 1.5jt bca"` — automatically added to your monthly Income budget.
- 📊 **Customized Categories**:
  - `Food`: meals, coffee, warteg, snacks, beverages.
  - `Living`: kost, laundry, pulsa, phone/internet subscriptions, haircut.
  - `Transport`: Grab/Gojek ride, taxi, KAI, train, bensin/fuel, parking, toll.
  - `Family`: transfers to family/parents, family wifi/bills, family support.
  - `Entertainment`: games, movies, YouTube/streaming, aquarium, concerts.
  - `Other`: gifts, weddings, donations, admin fees, miscellaneous.
- 💳 **Payment Sources**: `BCA`, `Seabank`, `Grab`, `Superbank`, `Gopay`, `OVO`.
- 💰 **Live Budget Inquiries**: Type `budget` or `laporan` to view real-time balance and breakdowns.
- 🔒 **Private & Secure**: Only responds to authorized numbers defined in `.env`. Sensitive credentials and session tokens are strictly git-ignored.

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

Fill in:
- `GEMINI_API_KEY`: Free key from [Google AI Studio](https://aistudio.google.com/).
- `SPREADSHEET_ID`: Your Google Sheets ID.
- `AUTHORIZED_NUMBERS`: Your WhatsApp number with country code (e.g. `62821...`).

### 3. Run the Bot
```bash
npm start
```

### 4. Link WhatsApp
- Scan the terminal QR code with **WhatsApp > Linked Devices > Link a Device**.
- Session is preserved in `auth_info_baileys/` so you won't need to re-scan on restart.

---

## 📱 How to Use in WhatsApp

1. **Log Single Expense:**
   - `"Makan warteg 18rb seabank"`
2. **Log Multiple Expenses:**
   - `"Makan 20rb bca, bensin 35k seabank, kopi 15k gopay"`
3. **Log Split-Bill / Reimbursement:**
   - `"Akbar bayar makan 35rb bca"`
4. **Log Extra Income:**
   - `"Dapat freelance 1.5jt bca"`
5. **Check Budget:**
   - Type `"budget"` or `"laporan"`
