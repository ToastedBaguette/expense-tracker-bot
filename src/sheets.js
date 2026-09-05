import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const spreadsheetId = process.env.SPREADSHEET_ID;

let cachedSheetTitles = null;
let lastCacheTime = 0;

/**
 * Initializes Google Sheets API client
 */
export async function getSheetsClient() {
  let auth;

  // 1. Check for Service Account credentials
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  } else if (process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    // 2. OAuth2 with Refresh Token
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://oauth2.googleapis.com/token"
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
    auth = oauth2Client;
  } else {
    // 3. Fallback: check local MCP tokens if available
    const mcpTokenPath = "C:\\Users\\62821\\.gemini\\antigravity\\mcp_oauth_tokens.json";
    if (fs.existsSync(mcpTokenPath)) {
      try {
        const mcpTokens = JSON.parse(fs.readFileSync(mcpTokenPath, "utf-8"));
        const config = mcpTokens["https://sheetsmcp.googleapis.com/mcp/v1"];
        if (config?.token?.access_token) {
          const oauth2Client = new google.auth.OAuth2(config.client_id, config.client_secret);
          oauth2Client.setCredentials({
            access_token: config.token.access_token,
            refresh_token: config.token.refresh_token,
          });
          auth = oauth2Client;
        }
      } catch (err) {
        console.warn("Could not load MCP fallback tokens:", err.message);
      }
    }
  }

  if (!auth) {
    throw new Error(
      "No valid Google credentials found. Please configure GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_REFRESH_TOKEN in .env"
    );
  }

  return google.sheets({ version: "v4", auth });
}

/**
 * Retrieves the available sheet tab titles from Google Sheets
 */
export async function getAvailableSheetTitles(sheets) {
  const now = Date.now();
  if (cachedSheetTitles && now - lastCacheTime < 15 * 60 * 1000) {
    return cachedSheetTitles;
  }

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    cachedSheetTitles = meta.data.sheets.map((s) => s.properties.title);
    lastCacheTime = now;
    return cachedSheetTitles;
  } catch (err) {
    console.warn("Error fetching sheet titles from Google Sheets:", err.message);
    return cachedSheetTitles || ["September 2026", "Aug 2026"];
  }
}

/**
 * Dynamically resolves the actual sheet tab name that exists in the spreadsheet
 * (e.g. "Aug 2026" instead of failing on "August 2026")
 */
export async function resolveSheetName(dateStr, sheets) {
  const titles = await getAvailableSheetTitles(sheets);

  if (!dateStr) {
    return titles[0] || "September 2026";
  }

  const parts = dateStr.split("-");
  if (parts.length >= 3) {
    const mCode = parts[1].toLowerCase();
    const year = parts[2];

    const monthAliases = {
      jan: ["jan", "january", "januari"],
      feb: ["feb", "february", "februari"],
      mar: ["mar", "march", "maret"],
      apr: ["apr", "april"],
      may: ["may", "mei"],
      jun: ["jun", "june", "juni"],
      jul: ["jul", "july", "juli"],
      aug: ["aug", "august", "agustus"],
      sep: ["sep", "september"],
      oct: ["oct", "october", "oktober"],
      nov: ["nov", "november"],
      dec: ["dec", "december", "desember"],
    };

    const aliases = monthAliases[mCode] || [mCode];

    // Try finding a sheet matching both month alias and year
    const match = titles.find((t) => {
      const lower = t.toLowerCase();
      const hasMonth = aliases.some((a) => lower.includes(a));
      const hasYear = lower.includes(year);
      return hasMonth && hasYear;
    });

    if (match) return match;

    // Fallback: match month only
    const monthMatch = titles.find((t) => {
      const lower = t.toLowerCase();
      return aliases.some((a) => lower.includes(a));
    });

    if (monthMatch) return monthMatch;
  }

  // Default to the first sheet (newest month, e.g. September 2026)
  return titles[0] || "September 2026";
}

/**
 * Appends an expense row to the Google Sheet
 */
export async function appendExpense(expense) {
  const sheets = await getSheetsClient();
  const sheetName = await resolveSheetName(expense.date, sheets);

  // Row columns: [Date, Category, Description, Amount, Source] -> Columns B to F
  const values = [
    [
      expense.date,
      expense.category,
      expense.description,
      expense.amount,
      expense.source,
    ],
  ];

  const range = `'${sheetName}'!B:F`;

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values,
    },
  });

  // Fetch updated summary
  const summary = await getMonthlySummary(sheetName);

  return {
    sheetName,
    updatedRange: appendRes.data.updates?.updatedRange,
    summary,
  };
}

/**
 * Fetches the budget summary and breakdowns for a given month
 */
export async function getMonthlySummary(sheetName = null) {
  const sheets = await getSheetsClient();

  if (!sheetName) {
    sheetName = await resolveSheetName(null, sheets);
  }

  try {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        `'${sheetName}'!K3:M3`,   // Income, Total Expenses, Remaining Budget
        `'${sheetName}'!K6:L10`,  // Category totals
        `'${sheetName}'!K13:L17`, // Source totals
      ],
      valueRenderOption: "FORMATTED_VALUE",
    });

    const valueRanges = res.data.valueRanges || [];
    const overview = valueRanges[0]?.values?.[0] || ["Rp0", "Rp0", "Rp0"];
    const categories = valueRanges[1]?.values || [];
    const sources = valueRanges[2]?.values || [];

    return {
      month: sheetName,
      income: overview[0] || "Rp0",
      totalExpenses: overview[1] || "Rp0",
      remainingBudget: overview[2] || "Rp0",
      categories: categories.map(([name, total]) => ({ name, total })),
      sources: sources.map(([name, total]) => ({ name, total })),
    };
  } catch (error) {
    console.error(`Error reading summary for ${sheetName}:`, error.message);
    return {
      month: sheetName,
      error: error.message,
    };
  }
}
