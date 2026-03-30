const crypto = require('crypto');

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map(value => value.trim());
}

function parseCsvTable(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const lines = source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { headers: [], rows: [] };
  }
  const firstLine = parseCsvLine(lines[0]);
  const hasHeader = firstLine.some(col => /[A-Za-z]/.test(col));
  const headers = hasHeader ? firstLine : [];
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map(line => {
    const cols = parseCsvLine(line);
    if (!headers.length) return cols;
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? '';
    });
    return row;
  });
  return { headers, rows };
}

function parseIbkrDateTime(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const compact = value.replace(/\s+/g, '');
  let match = compact.match(/^(\d{4})(\d{2})(\d{2});(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    return {
      iso: `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`,
      dateKey: `${y}-${m}-${d}`
    };
  }
  match = compact.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, y, m, d, hh, mm, ssRaw] = match;
    const ss = ssRaw || '00';
    return {
      iso: `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`,
      dateKey: `${y}-${m}-${d}`
    };
  }
  match = compact.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    return {
      iso: `${y}-${m}-${d}T00:00:00Z`,
      dateKey: `${y}-${m}-${d}`
    };
  }
  return null;
}

function parseIbkrNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().replace(/,/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildIbkrImportFingerprint(fields = {}) {
  const payload = [
    String(fields.accountId || '').trim().toUpperCase(),
    String(fields.symbol || '').trim().toUpperCase(),
    String(fields.description || '').trim(),
    String(fields.tradeDateTime || '').trim(),
    String(fields.quantity || '').trim(),
    String(fields.tradePrice || '').trim(),
    String(fields.buySell || '').trim().toUpperCase(),
    String(fields.assetClass || '').trim().toUpperCase()
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = {
  parseCsvTable,
  parseIbkrDateTime,
  parseIbkrNumber,
  buildIbkrImportFingerprint
};
