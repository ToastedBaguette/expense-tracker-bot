import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getTodayDateFormatted } from "./gemini.js";

dotenv.config();

const spreadsheetId = process.env.SPREADSHEET_ID;

let cachedSheetTitles = null;
let lastCacheTime = 0;

// Appends read the next free row and then write to it, so writes run one at a time to stop
// two messages handled at once from claiming the same row (guards this process only)
let writeQueue = Promise.resolve();

function withWriteLock(task) {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => {});
  return run;
}

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
  }

  if (!auth) {
    throw new Error(
      "No valid Google credentials found. Please configure GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_REFRESH_TOKEN in .env"
    );
  }

  return google.sheets({ version: "v4", auth });
}

/**
 * Retrieves the available sheet tab titles from Google Sheets.
 * Cached for 15 minutes; pass `refresh` to bypass the cache.
 */
export async function getAvailableSheetTitles(sheets, refresh = false) {
  const now = Date.now();
  if (!refresh && cachedSheetTitles && now - lastCacheTime < 15 * 60 * 1000) {
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
    if (!cachedSheetTitles) throw err;
    console.warn("Error fetching sheet titles, using cached list:", err.message);
    return cachedSheetTitles;
  }
}

/**
 * Finds the sheet tab whose title contains both the month and the year of `dateStr`
 * ("D-MMM-YYYY"). Returns null when there is no such tab.
 */
export async function findSheetName(dateStr, sheets) {
  const parts = (dateStr || "").split("-");
  if (parts.length < 3) return null;

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

  const isMatch = (t) => {
    const lower = t.toLowerCase();
    return lower.includes(year) && aliases.some((a) => lower.includes(a));
  };

  // A tab added in the last 15 minutes isn't in the cache yet, so refetch once before giving up
  return (
    (await getAvailableSheetTitles(sheets)).find(isMatch) ??
    (await getAvailableSheetTitles(sheets, true)).find(isMatch) ??
    null
  );
}

/**
 * Resolves the sheet tab for `dateStr`. Throws when that month has no tab, so transactions
 * are never written into another month's tab.
 */
export async function resolveSheetName(dateStr, sheets) {
  const sheetName = await findSheetName(dateStr, sheets);
  if (!sheetName) {
    throw new Error(
      `No sheet tab found for the month of ${dateStr}. ` +
      `Duplicate last month's tab, rename it to that month (e.g. "October 2026"), then try again.`
    );
  }
  return sheetName;
}

/**
 * Adds extra income to cell K3 of the appropriate month
 */
export function addIncome(incomeData) {
  return withWriteLock(() => addIncomeUnlocked(incomeData));
}

async function addIncomeUnlocked(incomeData) {
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
export function appendExpenses(expenses) {
  return withWriteLock(() => appendExpensesUnlocked(expenses));
}

async function appendExpensesUnlocked(expenses) {
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
 * Checks whether any transaction in Column B is dated `dateStr` ("D-MMM-YYYY").
 * USER_ENTERED dates are usually stored as serial numbers (days since 30-Dec-1899),
 * so both serials and plain-text dates are matched. A month without a tab has no transactions.
 * Returns the matching rows as { category, description, amount, source }.
 */
export async function getTransactionsOnDate(dateStr) {
  const sheets = await getSheetsClient();
  const sheetName = await findSheetName(dateStr, sheets);
  if (!sheetName) return [];

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!B3:F996`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const [day, mon, year] = dateStr.split("-");
  const serial =
    (Date.UTC(Number(year), months.indexOf(mon.toLowerCase()), Number(day)) - Date.UTC(1899, 11, 30)) /
    (24 * 60 * 60 * 1000);

  return (res.data.values || [])
    .filter(([cell]) =>
      typeof cell === "number"
        ? Math.floor(cell) === serial
        : String(cell ?? "").trim().toLowerCase() === dateStr.toLowerCase()
    )
    .map(([, category, description, amount, source]) => ({
      category: category || "Other",
      description: description || "-",
      amount: Number(amount) || 0,
      source: source || "-",
    }));
}

/**
 * Fetches the budget summary and breakdowns for a given month (defaults to the current month)
 */
export async function getMonthlySummary(sheetName = null) {
  const sheets = await getSheetsClient();

  if (!sheetName) {
    sheetName = await resolveSheetName(getTodayDateFormatted(), sheets);
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
