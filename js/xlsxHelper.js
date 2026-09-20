// Reads/writes the business Excel ledger in-browser using SheetJS
// (loaded from a CDN in index.html as the global `XLSX`). We never send
// the workbook anywhere except straight back to Dropbox.
'use strict';

const XlsxHelper = {
  HEADER_ROW: [
    'Date', 'Unique ID', 'Vendor', 'Category', 'Currency',
    'Amount', 'EUR Rate', 'Amount (EUR)', 'Receipt File', 'Notes'
  ],
  SHEET_NAME: 'Expenses',

  // Builds a brand-new workbook (as an ArrayBuffer) with just the header row.
  createBlankWorkbook() {
    const ws = XLSX.utils.aoa_to_sheet([this.HEADER_ROW]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.SHEET_NAME);
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  },

  // Takes an existing workbook's ArrayBuffer (or null for "doesn't exist
  // yet"), appends one row, and returns the updated workbook as an
  // ArrayBuffer ready to upload back to Dropbox.
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

    const row = [
      entry.date,
      entry.uniqueId,
      entry.vendor || '',
      entry.category || '',
      entry.currency,
      entry.amount,
      entry.eurRate != null ? entry.eurRate : '',
      entry.eurAmount != null ? Number(entry.eurAmount.toFixed(2)) : '',
      entry.receiptFile || '',
      entry.notes || ''
    ];
    rows.push(row);

    const newWs = XLSX.utils.aoa_to_sheet(rows);
    if (wb.Sheets[sheetName]) {
      wb.Sheets[sheetName] = newWs;
    } else {
      XLSX.utils.book_append_sheet(wb, newWs, sheetName);
    }

    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  }
};

