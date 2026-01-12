const TRADE_CARD_TEMPLATE_URL = '/static/Trade-Summary-Card-Template.png';
const TRADE_CARD_FONT = "system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans'";
const TRADE_CARD_COLORS = {
  text: '#f5f7fb',
  label: '#dbe4ef',
  muted: '#b7c1ce',
  positive: '#7de3a1',
  negative: '#ff7285',
  pillLong: '#7de3a1',
  pillLongBg: 'rgba(125,227,161,0.12)',
  pillShort: '#ff7285',
  pillShortBg: 'rgba(255,114,133,0.12)'
};

const TRADE_CARD_LAYOUT = {
  ticker: { x: 130, y: 260, fontSize: 52, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
  roiValue: { x: 130, y: 370, fontSize: 68, fontWeight: 700, color: TRADE_CARD_COLORS.positive, align: 'left' },
  roiLabel: { x: 130, y: 420, fontSize: 22, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
  rValue: { x: 480, y: 370, fontSize: 68, fontWeight: 700, color: TRADE_CARD_COLORS.positive, align: 'left' },
  rLabel: { x: 480, y: 420, fontSize: 22, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
  entryLabel: { x: 130, y: 520, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
  entryValue: { x: 130, y: 575, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
  stopLabel: { x: 430, y: 520, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
  stopValue: { x: 430, y: 575, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
  entryDateLabel: { x: 130, y: 620, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
  entryDateValue: { x: 130, y: 665, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
  closeDateLabel: { x: 430, y: 620, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
  closeDateValue: { x: 430, y: 665, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
  footerLeft: { x: 130, y: 860, fontSize: 26, fontWeight: 600, color: '#14171f', align: 'left' },
  footerRight: { x: 1406, y: 860, fontSize: 24, fontWeight: 500, color: '#14171f', align: 'right' }
};

let templateImagePromise;

function tradeCardFormatCurrencyUSD(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function tradeCardFormatROI(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function tradeCardFormatR(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const formatted = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1);
  return `${sign}${formatted}R`;
}

function tradeCardFormatDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function tradeCardFormatRelative(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(diffSec) < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(-diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 7) return rtf.format(-diffDay, 'day');
  const diffWeek = Math.round(diffDay / 7);
  return rtf.format(-diffWeek, 'week');
}

function parseTemplateImage() {
  if (templateImagePromise) return templateImagePromise;
  templateImagePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load trade summary template.'));
    img.src = TRADE_CARD_TEMPLATE_URL;
  });
  return templateImagePromise;
}

function setFont(ctx, layout) {
  ctx.font = `${layout.fontWeight} ${layout.fontSize}px ${TRADE_CARD_FONT}`;
  ctx.fillStyle = layout.color;
  ctx.textAlign = layout.align || 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawText(ctx, text, layout) {
  if (!text) return;
  setFont(ctx, layout);
  ctx.fillText(text, layout.x, layout.y, layout.maxWidth);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function renderTradeCard(trade) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    const placeholder = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
    const bytes = typeof atob === 'function'
      ? Uint8Array.from(atob(placeholder), c => c.charCodeAt(0))
      : Uint8Array.from(Buffer.from(placeholder, 'base64'));
    return new Blob([bytes], { type: 'image/png' });
  }

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const template = await parseTemplateImage();
  const width = template.width;
  const height = template.height;
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to render trade summary card.');
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(template, 0, 0, width, height);

  const ticker = trade?.ticker || '—';
  drawText(ctx, ticker, TRADE_CARD_LAYOUT.ticker);

  const pillText = trade?.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const pillColor = trade?.direction === 'SHORT' ? TRADE_CARD_COLORS.pillShort : TRADE_CARD_COLORS.pillLong;
  const pillBg = trade?.direction === 'SHORT' ? TRADE_CARD_COLORS.pillShortBg : TRADE_CARD_COLORS.pillLongBg;
  ctx.font = `600 20px ${TRADE_CARD_FONT}`;
  const pillPaddingX = 16;
  const pillTextWidth = ctx.measureText(pillText).width;
  const pillWidth = pillTextWidth + pillPaddingX * 2;
  const pillHeight = 30;
  const pillX = TRADE_CARD_LAYOUT.ticker.x + ctx.measureText(ticker).width + 20;
  const pillY = TRADE_CARD_LAYOUT.ticker.y - 26;
  drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 10);
  ctx.fillStyle = pillBg;
  ctx.fill();
  ctx.strokeStyle = pillColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = pillColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pillText, pillX + pillWidth / 2, pillY + pillHeight / 2 + 1);

  drawText(ctx, tradeCardFormatROI(trade?.roiPct), TRADE_CARD_LAYOUT.roiValue);
  drawText(ctx, 'ROI', TRADE_CARD_LAYOUT.roiLabel);
  drawText(ctx, tradeCardFormatR(trade?.rMultiple), TRADE_CARD_LAYOUT.rValue);
  drawText(ctx, 'R-MULTIPLE', TRADE_CARD_LAYOUT.rLabel);

  drawText(ctx, 'Entry Price', TRADE_CARD_LAYOUT.entryLabel);
  drawText(ctx, tradeCardFormatCurrencyUSD(trade?.entryPrice), TRADE_CARD_LAYOUT.entryValue);
  drawText(ctx, 'Stop Price', TRADE_CARD_LAYOUT.stopLabel);
  drawText(ctx, tradeCardFormatCurrencyUSD(trade?.stopPrice), TRADE_CARD_LAYOUT.stopValue);

  drawText(ctx, 'Entry Date', TRADE_CARD_LAYOUT.entryDateLabel);
  drawText(ctx, tradeCardFormatDate(trade?.entryDate), TRADE_CARD_LAYOUT.entryDateValue);
  drawText(ctx, 'Close Date', TRADE_CARD_LAYOUT.closeDateLabel);
  drawText(ctx, tradeCardFormatDate(trade?.closeDate), TRADE_CARD_LAYOUT.closeDateValue);

  const footerLeft = trade?.username || '—';
  const sharedAt = trade?.sharedAt ? new Date(trade.sharedAt) : new Date();
  const footerRight = `Shared ${tradeCardFormatRelative(sharedAt)} - ${tradeCardFormatDate(sharedAt)}`;
  drawText(ctx, footerLeft, TRADE_CARD_LAYOUT.footerLeft);
  drawText(ctx, footerRight, TRADE_CARD_LAYOUT.footerRight);

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/png', 1.0);
  });
}

async function renderTradeCardDataUrl(trade) {
  const blob = await renderTradeCard(trade);
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

if (typeof window !== 'undefined') {
  window.tradeCardRenderer = {
    renderTradeCard,
    renderTradeCardDataUrl,
    formatCurrencyUSD: tradeCardFormatCurrencyUSD,
    formatROI: tradeCardFormatROI,
    formatR: tradeCardFormatR,
    formatDate: tradeCardFormatDate,
    formatRelative: tradeCardFormatRelative,
    TRADE_CARD_LAYOUT
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    renderTradeCard,
    renderTradeCardDataUrl,
    formatCurrencyUSD: tradeCardFormatCurrencyUSD,
    formatROI: tradeCardFormatROI,
    formatR: tradeCardFormatR,
    formatDate: tradeCardFormatDate,
    formatRelative: tradeCardFormatRelative,
    TRADE_CARD_LAYOUT
  };
}
