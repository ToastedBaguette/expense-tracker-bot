import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("Warning: GEMINI_API_KEY is not set in .env!");
}

const ai = new GoogleGenAI({ apiKey });

// Candidate models in order of priority (fastest & most stable first)
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
      enum: ["Food", "Living", "Invest", "Entertainment", "Other"],
      description: "Category of the expense.",
    },
    description: {
      type: Type.STRING,
      description: "Clean description or merchant name (e.g. 'Warteg', 'Kopi Kenangan', 'Bensin', 'Kost').",
    },
    amount: {
      type: Type.NUMBER,
      description: "Transaction amount in IDR as positive number (e.g. 25000).",
    },
    source: {
      type: Type.STRING,
      enum: ["BCA", "Seabank", "Grab", "Superbank", "Gopay", "OVO", "Other"],
      description: "Payment source used.",
    },
  },
  required: ["category", "description", "amount", "source"],
};

const MULTI_EXPENSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isExpense: {
      type: Type.BOOLEAN,
      description: "True if the text or image contains one or more expense transactions.",
    },
    expenses: {
      type: Type.ARRAY,
      description: "List of all expense transactions identified in the image or message.",
      items: EXPENSE_ITEM_SCHEMA,
    },
  },
  required: ["isExpense"],
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
async function generateWithFallback(contents, schema = MULTI_EXPENSE_SCHEMA) {
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
 * Analyzes an image (screenshot of single receipt, bank statement, or transaction history)
 * Supports multiple transactions in a single image.
 */
export async function parseExpenseFromImage(imageBuffer, mimeType = "image/jpeg", userCaption = "") {
  try {
    const todayStr = getTodayDateFormatted();
    const prompt = `You are a financial receipt and bank mutation OCR assistant.
Analyze this Indonesian payment receipt, banking app screenshot, or mutation history (e.g. BCA, Seabank, GoPay, Grab, QRIS, Livin, OVO, ShopeePay, Indomaret).

CRITICAL INSTRUCTIONS:
- The image may contain ONE transaction or MULTIPLE transactions (e.g. a bank mutation list or multiple purchases).
- Extract EVERY valid expense transaction into the 'expenses' array.
- For bank mutations, only extract debited expenses/transfers out, ignore incoming transfers/top-ups unless user indicates otherwise.
- Date: Format as D-MMM-YYYY (e.g. 5-Sep-2026). If year or date is missing, use today: ${todayStr}.
- Category: Pick ONE from: Food, Living, Invest, Entertainment, Other.
- Description: Clean short merchant name or purpose.
- Amount: Positive integer in IDR.
- Source: Pick ONE from: BCA, Seabank, Grab, Superbank, Gopay, OVO, Other.
${userCaption ? `User extra caption: "${userCaption}"` : ""}`;

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

    if (result.isExpense && Array.isArray(result.expenses)) {
      result.expenses = result.expenses.map((item) => ({
        ...item,
        date: item.date || todayStr,
      }));
    }

    return result;
  } catch (error) {
    console.error("Gemini Vision OCR Error:", error);
    throw error;
  }
}

/**
 * Parses natural language text (single or multiple lines/transactions)
 * e.g.
 * "makan warteg 18rb seabank, beli pulsa 50k grab"
 * or multi-line:
 * "1. Makan siang 25k bca
 *  2. Kopi 18k seabank
 *  3. Bensin 30k bca"
 */
export async function parseExpenseFromText(text) {
  try {
    const todayStr = getTodayDateFormatted();
    const prompt = `You are an expense parser for personal finance.
User message:
"""
${text}
"""
Current reference date: ${todayStr}.

CRITICAL INSTRUCTIONS:
- The user may send ONE or MULTIPLE expenses in a single message (comma-separated, numbered list, or multi-line).
- Extract ALL distinct expense transactions into the 'expenses' array.
- If the message is an expense, set isExpense: true.
- If the message is just chatting, asking a question, or greeting, set isExpense: false and empty expenses array.
- Each item must have:
  - date: D-MMM-YYYY (default: ${todayStr})
  - category: Food, Living, Invest, Entertainment, or Other
  - description: Clean, concise description
  - amount: Positive integer in IDR (e.g. "18rb" -> 18000, "50k" -> 50000)
  - source: BCA, Seabank, Grab, Superbank, Gopay, OVO, or Other (default: "BCA")`;

    const contents = [{ role: "user", parts: [{ text: prompt }] }];
    const result = await generateWithFallback(contents);

    if (result.isExpense && Array.isArray(result.expenses)) {
      result.expenses = result.expenses.map((item) => ({
        ...item,
        date: item.date || todayStr,
      }));
    }

    return result;
  } catch (error) {
    console.error("Gemini NLP Text Parser Error:", error);
    throw error;
  }
}
