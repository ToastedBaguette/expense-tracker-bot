import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

async function generateTemplate() {
  const templateDir = path.resolve("./template");
  if (!fs.existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true });
  }

  const outputPath = path.join(templateDir, "expense_tracker_template.xlsx");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Expense Tracker Bot";
  workbook.created = new Date();

  // Create a clean template sheet: "Template Month" (e.g. September 2026)
  const sheet = workbook.addWorksheet("September 2026", {
    views: [{ showGridLines: true }],
  });

  // Set column widths
  sheet.getColumn("A").width = 3;  // spacer
  sheet.getColumn("B").width = 14; // Date
  sheet.getColumn("C").width = 16; // Category
  sheet.getColumn("D").width = 28; // Description
  sheet.getColumn("E").width = 16; // Amount
  sheet.getColumn("F").width = 14; // Source
  sheet.getColumn("G").width = 4;  // spacer
  sheet.getColumn("H").width = 14; // Daily Date
  sheet.getColumn("I").width = 16; // Daily Total
  sheet.getColumn("J").width = 4;  // spacer
  sheet.getColumn("K").width = 16; // Overview / Category / Source
  sheet.getColumn("L").width = 18; // Total Expenses / Total
  sheet.getColumn("M").width = 18; // Remaining Budget

  // Styles
  const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  const headerFillDark = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2C3E50" },
  };
  const headerFillGreen = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF27AE60" },
  };
  const headerFillBlue = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2980B9" },
  };
  const headerFillGray = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF7F8C8D" },
  };

  const currencyFormat = '"Rp"#,##0;("Rp"#,##0);"-"';

  // --- Row 2: Headers ---
  // Transactions headers (B2:F2)
  const txHeaders = ["Date", "Category", "Description", "Amount", "Source"];
  ["B", "C", "D", "E", "F"].forEach((col, idx) => {
    const cell = sheet.getCell(`${col}2`);
    cell.value = txHeaders[idx];
    cell.font = headerFont;
    cell.fill = headerFillDark;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Daily Breakdown headers (H2:I2)
  const h2 = sheet.getCell("H2");
  h2.value = "Date";
  h2.font = headerFont;
  h2.fill = headerFillGray;
  h2.alignment = { horizontal: "center", vertical: "middle" };

  const i2 = sheet.getCell("I2");
  i2.value = "Total Expenses";
  i2.font = headerFont;
  i2.fill = headerFillGray;
  i2.alignment = { horizontal: "center", vertical: "middle" };

  // Overview headers (K2:M2)
  const k2 = sheet.getCell("K2");
  k2.value = "Income";
  k2.font = headerFont;
  k2.fill = headerFillBlue;
  k2.alignment = { horizontal: "center", vertical: "middle" };

  const l2 = sheet.getCell("L2");
  l2.value = "Total Expenses";
  l2.font = headerFont;
  l2.fill = headerFillDark;
  l2.alignment = { horizontal: "center", vertical: "middle" };

  const m2 = sheet.getCell("M2");
  m2.value = "Remaining Budget";
  m2.font = headerFont;
  m2.fill = headerFillGreen;
  m2.alignment = { horizontal: "center", vertical: "middle" };

  // --- Row 3: Overview Values and Formulas ---
  // Income default
  const k3 = sheet.getCell("K3");
  k3.value = 9800000;
  k3.numFmt = currencyFormat;
  k3.font = { bold: true };

  // Total Expenses = SUM(L6:L11)
  const l3 = sheet.getCell("L3");
  l3.value = { formula: "SUM(L6:L11)" };
  l3.numFmt = currencyFormat;
  l3.font = { bold: true, color: { argb: "FFE74C3C" } };

  // Remaining = K3 - L3
  const m3 = sheet.getCell("M3");
  m3.value = { formula: "K3-L3" };
  m3.numFmt = currencyFormat;
  m3.font = { bold: true, color: { argb: "FF27AE60" } };

  // --- Categories Table (K5:L11) ---
  const k5 = sheet.getCell("K5");
  k5.value = "Category";
  k5.font = headerFont;
  k5.fill = headerFillDark;

  const l5 = sheet.getCell("L5");
  l5.value = "Total";
  l5.font = headerFont;
  l5.fill = headerFillDark;

  const categories = ["Food", "Living", "Transport", "Family", "Entertainment", "Other"];
  categories.forEach((cat, idx) => {
    const row = 6 + idx;
    const catCell = sheet.getCell(`K${row}`);
    catCell.value = cat;

    const totalCell = sheet.getCell(`L${row}`);
    totalCell.value = { formula: `SUMIF($C$3:$C$996, K${row}, $E$3:$E$996)` };
    totalCell.numFmt = currencyFormat;
  });

  // --- Payment Sources Table (K13:L18) ---
  const k13 = sheet.getCell("K13");
  k13.value = "Source";
  k13.font = headerFont;
  k13.fill = headerFillDark;

  const l13 = sheet.getCell("L13");
  l13.value = "Total";
  l13.font = headerFont;
  l13.fill = headerFillDark;

  const sources = ["BCA", "Seabank", "Grab", "Superbank", "Gopay", "OVO"];
  sources.forEach((src, idx) => {
    const row = 14 + idx;
    const srcCell = sheet.getCell(`K${row}`);
    srcCell.value = src;

    const totalCell = sheet.getCell(`L${row}`);
    totalCell.value = { formula: `SUMIF($F$3:$F$996, K${row}, $E$3:$E$996)` };
    totalCell.numFmt = currencyFormat;
  });

  // --- Daily Breakdown Table (H3:I33) - 31 Days ---
  // Generate dates for September (days 1 to 30)
  for (let day = 1; day <= 31; day++) {
    const row = 2 + day;
    const dateCell = sheet.getCell(`H${row}`);
    // Use ISO date formatted as D-MMM-YYYY
    const d = new Date(Date.UTC(2026, 8, day)); // Sep 2026
    dateCell.value = d;
    dateCell.numFmt = "d-mmm-yyyy";

    const totalCell = sheet.getCell(`I${row}`);
    totalCell.value = { formula: `SUMIF($B$3:$B$996, H${row}, $E$3:$E$996)` };
    totalCell.numFmt = currencyFormat;
  }

  // Format Transaction columns for rows 3..996
  // Set date format on B and currency on E
  for (let r = 3; r <= 100; r++) {
    sheet.getCell(`B${r}`).numFmt = "d-mmm-yyyy";
    sheet.getCell(`E${r}`).numFmt = currencyFormat;
  }

  // Data Validation for Category (C3:C996)
  sheet.dataValidations.add("C3:C996", {
    type: "list",
    allowBlank: true,
    formulae: ['"Food,Living,Transport,Family,Entertainment,Other"'],
    showErrorMessage: true,
    errorTitle: "Invalid Category",
    error: "Please select a valid category from the list",
  });

  // Data Validation for Source (F3:F996)
  sheet.dataValidations.add("F3:F996", {
    type: "list",
    allowBlank: true,
    formulae: ['"BCA,Seabank,Grab,Superbank,Gopay,OVO"'],
    showErrorMessage: true,
    errorTitle: "Invalid Source",
    error: "Please select a valid payment source from the list",
  });

  // Add sample transactions so the user immediately sees how it works
  const sampleData = [
    { date: new Date(Date.UTC(2026, 8, 1)), cat: "Living", desc: "Kost Bulanan", amt: 1500000, src: "BCA" },
    { date: new Date(Date.UTC(2026, 8, 1)), cat: "Food", desc: "Makan Siang Warteg", amt: 25000, src: "BCA" },
    { date: new Date(Date.UTC(2026, 8, 2)), cat: "Transport", desc: "Grab ke Kantor", amt: 32000, src: "Seabank" },
    { date: new Date(Date.UTC(2026, 8, 2)), cat: "Food", desc: "Kopi Kenangan", amt: 22000, src: "Gopay" },
    { date: new Date(Date.UTC(2026, 8, 3)), cat: "Food", desc: "Reimburse Makan Hans", amt: -50000, src: "BCA" },
  ];

  sampleData.forEach((tx, idx) => {
    const row = 3 + idx;
    sheet.getCell(`B${row}`).value = tx.date;
    sheet.getCell(`C${row}`).value = tx.cat;
    sheet.getCell(`D${row}`).value = tx.desc;
    sheet.getCell(`E${row}`).value = tx.amt;
    sheet.getCell(`F${row}`).value = tx.src;
  });

  await workbook.xlsx.writeFile(outputPath);
  console.log(`Template created successfully at: ${outputPath}`);
}

generateTemplate().catch((err) => {
  console.error("Error generating template:", err);
  process.exit(1);
});
