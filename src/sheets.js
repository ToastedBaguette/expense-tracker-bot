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
    console.warn("Error fetching sheet titles:", err.message);
    return cachedSheetTitles || ["September 2026", "Aug 2026"];
  }
}

/**
 * Dynamically resolves the actual sheet tab name that exists in the spreadsheet
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

    const match = titles.find((t) => {
      const lower = t.toLowerCase();
      const hasMonth = aliases.some((a) => lower.includes(a));
      const hasYear = lower.includes(year);
      return hasMonth && hasYear;
    });

    if (match) return match;

    const monthMatch = titles.find((t) => {
      const lower = t.toLowerCase();
      return aliases.some((a) => lower.includes(a));
    });

    if (monthMatch) return monthMatch;
  }

  return titles[0] || "September 2026";
}

/**
 * Adds extra income to cell K3 of the appropriate month
 */
export async function addIncome(incomeData) {
  const sheets = await getSheetsClient();
  const sheetName = await resolveSheetName(incomeData.date, sheets);

  const currentRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!K3`,
    valueRenderOption: "FORMULA",
  });

  const currentVal = currentRes.data.values?.[0]?.[0];
  let newFormula;

  if (typeof currentVal === "string" && currentVal.startsWith("=")) {
    newFormula = `${currentVal}+${incomeData.amount}`;
  } else if (currentVal !== undefined && currentVal !== null) {
    newFormula = `=${currentVal}+${incomeData.amount}`;
  } else {
    newFormula = `=${incomeData.amount}`;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!K3`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[newFormula]],
    },
  });

  const summary = await getMonthlySummary(sheetName);

  return {
    sheetName,
    addedAmount: incomeData.amount,
    description: incomeData.description,
    source: incomeData.source,
    summary,
  };
}

/**
 * Appends multiple expenses at once without inserting full worksheet rows.
 * Writes directly into the next empty rows in Columns B:F to preserve the
 * side tables (Columns H to M) intact.
 */
export async function appendExpenses(expenses) {
  if (!Array.isArray(expenses) || expenses.length === 0) {
    throw new Error("No expenses provided to append");
  }

  const sheets = await getSheetsClient();

  // Group expenses by resolved sheet name
  const sheetGroups = {};
  for (const exp of expenses) {
    const sheetName = await resolveSheetName(exp.date, sheets);
    if (!sheetGroups[sheetName]) {
      sheetGroups[sheetName] = [];
    }
    sheetGroups[sheetName].push([
      exp.date,
      exp.category,
      exp.description,
      exp.amount,
      exp.source,
    ]);
  }

  let lastSheetName = null;
  for (const [sheetName, rows] of Object.entries(sheetGroups)) {
    lastSheetName = sheetName;

    // Find the next available row in Column B (transactions start at row 3)
    const checkRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!B3:B996`,
    });

    const existingRows = checkRes.data.values ? checkRes.data.values.length : 0;
    const startRow = 3 + existingRows;
    const endRow = startRow + rows.length - 1;

    // Update only the targeted range B:F — NEVER inserts sheet rows
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!B${startRow}:F${endRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: rows,
      },
    });
  }

  const summary = await getMonthlySummary(lastSheetName);

  return {
    sheetName: lastSheetName,
    count: expenses.length,
    summary,
  };
}

/**
 * Backward compatibility wrapper for single expense
 */
export async function appendExpense(expense) {
  return await appendExpenses([expense]);
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
        `'${sheetName}'!K6:L11`,  // 6 Categories: Food, Living, Transport, Family, Entertainment, Other
        `'${sheetName}'!K14:L18`, // 5 Sources: Gopay, BCA, Seabank, Grab, Superbank
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
