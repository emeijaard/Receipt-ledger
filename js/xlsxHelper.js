// Reads/writes the business Excel ledger in-browser using SheetJS
// (loaded from a CDN in index.html as the global `XLSX`). We never send
// the workbook anywhere except straight back to Dropbox.
'use strict';

const XlsxHelper = {
  // This is the user's own template — column order and text matters
  // (including the "currrency" typo, kept exactly as given).
  HEADER_ROW: [
    'Receipt nr', 'Project', 'Payer', 'DESCRIPTION', 'PAID THROUGH',
    'COUNTRY', 'CURRENCY', 'COST (local currrency)', 'CONVERSION RATE', 'COST (EUR)'
  ],
  SHEET_NAME: 'Expenses',

  // Builds a brand-new workbook (as an ArrayBuffer) with just the header row.
  createBlankWorkbook() {
    const ws = XLSX.utils.aoa_to_sheet([this.HEADER_ROW]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.SHEET_NAME);
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  },

  // Receipt numbers look like EX-2026-09-01, EX-2026-09-02, ... — one
  // sequence per calendar month, based on the expense's own date (not
  // today's date). `dataRows` is every row after the header; we scan
  // column A for anything already stamped with this month's "EX-YYYY-MM-"
  // prefix and pick one past the highest number found, so this keeps
  // incrementing correctly even across multiple synced devices as long as
  // each sync re-reads the live file first (which syncBusiness always does).
  nextReceiptNr(dataRows, dateStr) {
    const m = /^(\d{4})-(\d{2})/.exec(dateStr || '');
    const now = new Date();
    const year = m ? m[1] : String(now.getFullYear());
    const month = m ? m[2] : String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `EX-${year}-${month}-`;
    let max = 0;
    for (const row of dataRows) {
      const cell = row && row[0];
      if (typeof cell === 'string' && cell.startsWith(prefix)) {
        const n = parseInt(cell.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  },

  // Takes an existing workbook's ArrayBuffer (or null for "doesn't exist
  // yet"), appends one row, and returns { buffer, receiptNr } — the
  // updated workbook (ready to upload back to Dropbox) plus the receipt
  // number that was assigned, so the caller can name the receipt photo
  // to match (e.g. EX-2026-09-01.jpg).
  appendRow(existingArrayBuffer, entry) {
    let wb;
    let sheetName;

    if (existingArrayBuffer) {
      wb = XLSX.read(new Uint8Array(existingArrayBuffer), { type: 'array', cellDates: false });
      sheetName = wb.SheetNames[0] || this.SHEET_NAME;
    } else {
      wb = XLSX.utils.book_new();
      sheetName = this.SHEET_NAME;
    }

    let ws = wb.Sheets[sheetName];
    let rows = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) : [];

    if (!rows.length) {
      rows = [this.HEADER_ROW.slice()];
    }

    const receiptNr = this.nextReceiptNr(rows.slice(1), entry.date);

    const row = [
      receiptNr,
      entry.project || '',
      entry.payer || '',
      entry.vendor || '', // DESCRIPTION
      entry.paidThrough || '',
      entry.country || '',
      entry.currency,
      entry.amount,
      entry.eurRate != null ? entry.eurRate : '',
      entry.eurAmount != null ? Number(entry.eurAmount.toFixed(2)) : ''
    ];
    rows.push(row);

    const newWs = XLSX.utils.aoa_to_sheet(rows);
    if (wb.Sheets[sheetName]) {
      wb.Sheets[sheetName] = newWs;
    } else {
      XLSX.utils.book_append_sheet(wb, newWs, sheetName);
    }

    return {
      buffer: XLSX.write(wb, { bookType: 'xlsx', type: 'array' }),
      receiptNr
    };
  }
};
