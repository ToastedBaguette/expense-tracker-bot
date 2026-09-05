import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const spreadsheetId = process.env.SPREADSHEET_ID;

/**
 * Initializes Google Sheets API client
 */
async function getSheetsClient() {
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
 * Derives sheet tab name from date (e.g. "5-Sep-2026" -> "September 2026")
 */
export function getSheetNameFromDate(dateStr) {
  const monthMap = {
    Jan: "January",
    Feb: "February",
    Mar: "March",
    Apr: "April",
    May: "May",
    Jun: "June",
    Jul: "July",
    Aug: "August",
    Sep: "September",
    Oct: "October",
    Nov: "November",
    Dec: "December",
  };

  if (dateStr) {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const mCode = parts[1];
      const year = parts[2];
      const mFull = monthMap[mCode] || mCode;
      return `${mFull} ${year}`;
    }
  }

  const now = new Date();
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * Appends an expense row to the Google Sheet
 */
export async function appendExpense(expense) {
  const sheets = await getSheetsClient();
  const sheetName = getSheetNameFromDate(expense.date);

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
  if (!sheetName) {
    sheetName = getSheetNameFromDate();
  }

  const sheets = await getSheetsClient();

  try {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        `'${sheetName}'!K3:M3`, // Income, Total Expenses, Remaining Budget
        `'${sheetName}'!K6:L10`, // Category totals
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
