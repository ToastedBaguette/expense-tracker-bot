import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("Warning: GEMINI_API_KEY is not set in .env!");
}

const ai = new GoogleGenAI({ apiKey });

// Candidate models in order of priority (most stable & fastest first)
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
];

const EXPENSE_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    date: {
      type: Type.STRING,
      description: "Transaction date formatted as 'D-MMM-YYYY', e.g. '5-Sep-2026'.",
    },
    category: {
      type: Type.STRING,
      enum: ["Food", "Living", "Transport", "Family", "Entertainment", "Other"],
      description: "Category of the expense. Food (meals, coffee, warteg), Living (kost, laundry, pulsa), Transport (grab, kai, bensin), Family (tf fam, wifi fam, transfer orang tua), Entertainment (games, youtube, hangout), Other (gifts, weddings, misc).",
    },
    description: {
      type: Type.STRING,
      description: "Clean description or merchant name (e.g. 'Warteg', 'Kopi Kenangan', 'Bensin', 'Kost').",
    },
    amount: {
      type: Type.NUMBER,
      description: "Amount in IDR Rupiah. Positive for expenses. NEGATIVE for reimbursements, split bills, or refunds from friends (e.g. -50000).",
    },
    isReimbursement: {
      type: Type.BOOLEAN,
      description: "True if someone is paying back money, split-bill, or refund that reduces an expense.",
    },
    source: {
      type: Type.STRING,
      enum: ["BCA", "Seabank", "Grab", "Superbank", "Gopay", "OVO", "Other"],
      description: "Payment source used.",
    },
  },
  required: ["category", "description", "amount", "source"],
};

const FINANCIAL_ACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      enum: ["EXPENSE", "INCOME", "NONE"],
      description: "EXPENSE for spending or split-bill/reimbursements. INCOME for salary, bonuses, freelance, or earnings. NONE for questions or chatting.",
    },
    income: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: "D-MMM-YYYY" },
        description: { type: Type.STRING, description: "Source or note for income, e.g. 'Gaji', 'Freelance', 'Bonus'." },
        amount: { type: Type.NUMBER, description: "Positive amount in IDR." },
        source: { type: Type.STRING, enum: ["BCA", "Seabank", "Grab", "Superbank", "Gopay", "OVO", "Other"] },
      },
    },
    expenses: {
      type: Type.ARRAY,
      description: "List of expense transactions or reimbursements identified.",
      items: EXPENSE_ITEM_SCHEMA,
    },
  },
  required: ["type"],
};

/**
 * Formats current date into "D-MMM-YYYY" e.g. "5-Sep-2026"
 */
export function getTodayDateFormatted() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const d = now.getDate();
  const m = months[now.getMonth()];
  const y = now.getFullYear();
  return `${d}-${m}-${y}`;
}

/**
 * Helper to execute Gemini requests with automatic fallback across models
 */
async function generateWithFallback(contents, schema = FINANCIAL_ACTION_SCHEMA) {
  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      });

      const text = response.text?.trim();
      if (!text) throw new Error("Empty response received from Gemini");

      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      const errMsg = err.message || "";
      const isTransient =
        errMsg.includes("503") ||
        errMsg.includes("429") ||
        errMsg.includes("UNAVAILABLE") ||
        errMsg.includes("high demand") ||
        errMsg.includes("RESOURCE_EXHAUSTED");

      if (isTransient) {
        console.warn(`Model ${model} unavailable/busy. Trying fallback...`);
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }

      console.warn(`Model ${model} failed (${err.message}). Trying fallback...`);
    }
  }

  throw lastError;
}

/**
 * Analyzes an image (screenshot of receipt, transfer in/out, or mutation history)
 */
export async function parseExpenseFromImage(imageBuffer, mimeType = "image/jpeg", userCaption = "") {
  try {
    const todayStr = getTodayDateFormatted();
    const prompt = `You are a personal finance assistant.
Analyze this Indonesian receipt, banking app screenshot (BCA, Seabank, GoPay, Grab, QRIS, Livin, OVO, ShopeePay, Indomaret), or bank mutation.

CATEGORIES:
- Food: warteg, resto, meals, coffee, cafe, snacks, beverages.
- Living: kost, laundry, pulsa, phone/internet subscriptions, haircut, personal daily essentials.
- Transport: Grab/Gojek ride, taxi, KAI, train, bensin/fuel, parking, toll.
- Family: transfers to family/parents, family wifi/bills, family financial support.
- Entertainment: games, movies, YouTube/streaming, aquarium, concerts, outings.
- Other: gifts, weddings, donations, admin fees, miscellaneous.

INCOME & REIMBURSEMENTS:
- If this screenshot shows incoming earnings (Salary/Gaji, Freelance, Bonus), classify type: "INCOME".
- If this screenshot shows a friend paying back money or split bill (e.g. "Tf dari Hans", "Payment Akbar"):
  Classify type: "EXPENSE", set isReimbursement: true, and set amount as a NEGATIVE number (e.g. -50000).
- If normal expense or purchase, classify type: "EXPENSE" with positive amount.
- For bank mutation lists with multiple items, extract all relevant items into 'expenses'.

Current date reference: ${todayStr}
${userCaption ? `User note/caption: "${userCaption}"` : ""}`;

    const contents = [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType: mimeType,
            },
          },
          { text: prompt },
        ],
      },
    ];

    const result = await generateWithFallback(contents);

    if (result.type === "EXPENSE" && Array.isArray(result.expenses)) {
      result.expenses = result.expenses.map((item) => ({
        ...item,
        date: item.date || todayStr,
      }));
    } else if (result.type === "INCOME" && result.income) {
      result.income.date = result.income.date || todayStr;
    }

    return result;
  } catch (error) {
    console.error("Gemini Vision OCR Error:", error);
    throw error;
  }
}

/**
 * Parses natural language text for expenses, reimbursements, or income
 */
export async function parseExpenseFromText(text) {
  try {
    const todayStr = getTodayDateFormatted();
    const prompt = `You are a personal finance assistant for Indonesian expense tracking.
User message:
"""
${text}
"""
Current reference date: ${todayStr}.

CATEGORIES:
- Food: warteg, resto, meals, coffee, cafe, snacks, beverages.
- Living: kost, laundry, pulsa, phone/internet subscriptions, haircut, personal daily essentials.
- Transport: Grab/Gojek ride, taxi, KAI, train, bensin/fuel, parking, toll.
- Family: transfers to family/parents, family wifi/bills, family financial support.
- Entertainment: games, movies, YouTube/streaming, aquarium, concerts, outings.
- Other: gifts, weddings, donations, admin fees, miscellaneous.

RULES:
1. INCOME:
   - If user reports extra income, earnings, salary, freelance, or bonus (e.g. "Gaji masuk 9.8jt", "Dapat freelance 1jt bca", "Bonus 500k"):
     type: "INCOME",
     income: { date: "${todayStr}", description: "Freelance", amount: 1000000, source: "BCA" }

2. REIMBURSEMENTS / SPLIT BILL:
   - If someone paid back or reimbursed (e.g. "Hans bayar makan 50rb bca", "Akbar tf 20rb", "Refund grab 15k"):
     type: "EXPENSE",
     expenses: [{ date: "${todayStr}", category: "Food" (or related), description: "Pembayaran Hans", amount: -50000, isReimbursement: true, source: "BCA" }]
     (Notice amount is NEGATIVE to reduce that category's expense total).

3. REGULAR EXPENSES (Single or Multiple):
   - e.g. "Makan siang 25rb bca, bensin 30rb seabank":
     type: "EXPENSE",
     expenses: [ ... ] with positive amounts.

4. OTHER:
   - If just chatting or greeting, set type: "NONE".`;

    const contents = [{ role: "user", parts: [{ text: prompt }] }];
    const result = await generateWithFallback(contents);

    if (result.type === "EXPENSE" && Array.isArray(result.expenses)) {
      result.expenses = result.expenses.map((item) => ({
        ...item,
        date: item.date || todayStr,
      }));
    } else if (result.type === "INCOME" && result.income) {
      result.income.date = result.income.date || todayStr;
    }

    return result;
  } catch (error) {
    console.error("Gemini NLP Text Parser Error:", error);
    throw error;
  }
}
