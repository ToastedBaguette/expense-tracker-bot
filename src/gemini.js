import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("⚠️ Warning: GEMINI_API_KEY is not set in .env!");
}

const ai = new GoogleGenAI({ apiKey });
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const EXPENSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isExpense: {
      type: Type.BOOLEAN,
      description: "True if the text or image represents an expense or purchase transaction.",
    },
    date: {
      type: Type.STRING,
      description: "Transaction date formatted as 'D-MMM-YYYY', e.g., '5-Sep-2026'. Default to current date if not specified.",
    },
    category: {
      type: Type.STRING,
      enum: ["Food", "Living", "Invest", "Entertainment", "Other"],
      description: "The expense category.",
    },
    description: {
      type: Type.STRING,
      description: "Short clean description or merchant name (e.g. 'Warteg', 'Kopi Kenangan', 'Laundry', 'Kost').",
    },
    amount: {
      type: Type.NUMBER,
      description: "Total transaction amount in IDR Rupiah as a positive integer (e.g. 35000).",
    },
    source: {
      type: Type.STRING,
      enum: ["BCA", "Seabank", "Grab", "Superbank", "Gopay", "OVO", "Other"],
      description: "Payment source or bank account used.",
    },
    note: {
      type: Type.STRING,
      description: "Any extra notes or summary of the receipt.",
    },
  },
  required: ["isExpense"],
};

/**
 * Formats current date into "D-MMM-YYYY" e.g. "5-Sep-2026"
 */
function getTodayDateFormatted() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const d = now.getDate();
  const m = months[now.getMonth()];
  const y = now.getFullYear();
  return `${d}-${m}-${y}`;
}

/**
 * Analyzes an image (screenshot of receipt/banking app) and extracts expense data
 */
export async function parseExpenseFromImage(imageBuffer, mimeType = "image/jpeg", userCaption = "") {
  try {
    const todayStr = getTodayDateFormatted();
    const prompt = `You are a financial receipt OCR assistant. Analyze this Indonesian payment receipt or banking app screenshot (e.g. BCA, Seabank, GoPay, Grab, QRIS, Livin, OVO, ShopeePay, Indomaret).
Extract:
- Date: Format as D-MMM-YYYY (e.g. 5-Sep-2026). If year/date is missing or ambiguous, use today's date: ${todayStr}.
- Category: Pick ONE from: Food, Living, Invest, Entertainment, Other. (Meals/coffee/snacks -> Food; Utilities/bills/kost/pulsa -> Living; Movies/games/aquarium -> Entertainment; Family/friends/donations/random -> Other).
- Description: Clean merchant name or transaction purpose (e.g. "Kopi Kenangan", "Warteg", "Makan Fmart", "Kost", "Laundry").
- Amount: Positive integer in IDR (e.g. 25000).
- Source: Pick ONE from: BCA, Seabank, Grab, Superbank, Gopay, OVO, Other.
${userCaption ? `User extra caption: "${userCaption}"` : ""}`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
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
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: EXPENSE_SCHEMA,
      },
    });

    const result = JSON.parse(response.text.trim());
    if (result.isExpense && !result.date) {
      result.date = todayStr;
    }
    return result;
  } catch (error) {
    console.error("Gemini Vision OCR Error:", error);
    throw error;
  }
}

/**
 * Parses natural language text (e.g. "makan siang warteg 18rb seabank")
 */
export async function parseExpenseFromText(text) {
  try {
    const todayStr = getTodayDateFormatted();
    const prompt = `You are an expense parser for personal finance.
User message: "${text}"
Current reference date: ${todayStr}.

Determine if this message represents an expense entry or a request to log an expense.
If yes, extract:
- isExpense: true
- date: formatted as D-MMM-YYYY (e.g. ${todayStr})
- category: Food, Living, Invest, Entertainment, or Other
- description: short clean description (e.g. "Warteg", "Kopi", "Beli Pulsa")
- amount: integer in IDR (e.g. 18000 for "18rb" or "18k")
- source: BCA, Seabank, Grab, Superbank, Gopay, OVO, or Other (default to "BCA" if unspecified)

If the message is NOT an expense (e.g. user asking a question, greeting, or chatting), set isExpense: false.`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: EXPENSE_SCHEMA,
      },
    });

    return JSON.parse(response.text.trim());
  } catch (error) {
    console.error("Gemini NLP Text Parser Error:", error);
    throw error;
  }
}
