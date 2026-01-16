const TRADE_CARD_TEMPLATES = {
  landscape: '/static/Trade-Summary-Card-Template.png',
  portrait: '/static/Trade-Summary-Card-Template-Portrait.png'
};
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

const TRADE_CARD_LAYOUTS = {
  landscape: {
  ticker: { x: 130, y: 275, fontSize: 52, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
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
  directionPill: { x: 300, y: 239, height: 30 },
  footerLeft: { x: 130, y: 770, fontSize: 26, fontWeight: 600, color: '#000000', align: 'left' },
  footerRight: { x: 1406, y: 770, fontSize: 24, fontWeight: 500, color: '#000000', align: 'right' },
  shareIcon: null
},
  portrait: {
    ticker: { x: 215, y: 250, fontSize: 44, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
    roiValue: { x: 75, y: 350, fontSize: 60, fontWeight: 700, color: TRADE_CARD_COLORS.positive, align: 'left' },
    roiLabel: { x: 75, y: 380, fontSize: 22, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
    rValue: { x: 350, y: 350, fontSize: 60, fontWeight: 700, color: TRADE_CARD_COLORS.positive, align: 'left' },
    rLabel: { x: 350, y: 380, fontSize: 22, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
    entryLabel: { x: 120, y: 500, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
    entryValue: { x: 120, y: 470, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
    stopLabel: { x: 400, y: 500, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
    stopValue: { x: 400, y: 470, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
    entryDateLabel: { x: 120, y: 600, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
    entryDateValue: { x: 120, y: 565, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
    closeDateLabel: { x: 400, y: 600, fontSize: 24, fontWeight: 600, color: TRADE_CARD_COLORS.label, align: 'left' },
    closeDateValue: { x: 400, y: 565, fontSize: 32, fontWeight: 700, color: TRADE_CARD_COLORS.text, align: 'left' },
    directionPill: { x: 355, y: 220, height: 28 },
    footerLeft: { x: 300, y: 1150, fontSize: 26, fontWeight: 600, color: '#000000', align: 'left' },
    footerRight: { x: 500, y: 1200, fontSize: 24, fontWeight: 500, color: '#000000', align: 'right' },
    shareIcon: null
  }
};

let templateImagePromises = new Map();
let templateBoundsPromises = new Map();

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

function tradeCardFormatTimestamp(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  const datePart = tradeCardFormatDate(date);
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
  return `${timePart} - ${datePart}`;
}

function parseTemplateImage(templateUrl) {
  const url = templateUrl || TRADE_CARD_TEMPLATES.landscape;
  const existing = templateImagePromises.get(url);
  if (existing) return existing;
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load trade summary template.'));
    img.src = url;
  });
  templateImagePromises.set(url, promise);
  return promise;
}

async function getTemplateBounds(templateUrl) {
  const url = templateUrl || TRADE_CARD_TEMPLATES.landscape;
  const existing = templateBoundsPromises.get(url);
  if (existing) return existing;
  const promise = parseTemplateImage(url).then(img => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { x: 0, y: 0, width: img.width, height: img.height };
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, width: img.width, height: img.height };
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
  });
  templateBoundsPromises.set(url, promise);
  return promise;
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
  const orientation = trade?.orientation === 'portrait' ? 'portrait' : 'landscape';
  const templateUrl = TRADE_CARD_TEMPLATES[orientation] || TRADE_CARD_TEMPLATES.landscape;
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

  const template = await parseTemplateImage(templateUrl);
  const bounds = await getTemplateBounds(templateUrl);
  const layout = TRADE_CARD_LAYOUTS[orientation] || TRADE_CARD_LAYOUTS.landscape;
  const width = bounds.width;
  const height = bounds.height;
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to render trade summary card.');
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(-bounds.x, -bounds.y);
  ctx.drawImage(template, 0, 0, template.width, template.height);

  const ticker = trade?.ticker || '—';
  drawText(ctx, ticker, layout.ticker);

  const pillText = trade?.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const pillColor = trade?.direction === 'SHORT' ? TRADE_CARD_COLORS.pillShort : TRADE_CARD_COLORS.pillLong;
  const pillBg = trade?.direction === 'SHORT' ? TRADE_CARD_COLORS.pillShortBg : TRADE_CARD_COLORS.pillLongBg;
  ctx.font = `600 20px ${TRADE_CARD_FONT}`;
  const pillPaddingX = 16;
  const pillTextWidth = ctx.measureText(pillText).width;
  const pillWidth = pillTextWidth + pillPaddingX * 2;
  const pillHeight = layout.directionPill?.height ?? 30;
  const pillX = layout.directionPill?.x
    ?? (layout.ticker.x + ctx.measureText(ticker).width + 20);
  const pillY = layout.directionPill?.y ?? (layout.ticker.y - 26);
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

  drawText(ctx, tradeCardFormatROI(trade?.roiPct), layout.roiValue);
  if (orientation !== 'portrait') {
    drawText(ctx, 'ROI', layout.roiLabel);
  }
  drawText(ctx, tradeCardFormatR(trade?.rMultiple), layout.rValue);
  if (orientation !== 'portrait') {
    drawText(ctx, 'R-MULTIPLE', layout.rLabel);
  }

  drawText(ctx, 'Entry Price', layout.entryLabel);
  drawText(ctx, tradeCardFormatCurrencyUSD(trade?.entryPrice), layout.entryValue);
  drawText(ctx, 'Stop Price', layout.stopLabel);
  drawText(ctx, tradeCardFormatCurrencyUSD(trade?.stopPrice), layout.stopValue);

  drawText(ctx, 'Entry Date', layout.entryDateLabel);
  drawText(ctx, tradeCardFormatDate(trade?.entryDate), layout.entryDateValue);
  drawText(ctx, 'Close Date', layout.closeDateLabel);
  drawText(ctx, tradeCardFormatDate(trade?.closeDate), layout.closeDateValue);

  const footerLeft = trade?.username || '—';
  const sharedAt = trade?.sharedAt ? new Date(trade.sharedAt) : new Date();
  const footerRight = `Shared ${tradeCardFormatTimestamp(sharedAt)}`;
  drawText(ctx, footerLeft, layout.footerLeft);
  drawText(ctx, footerRight, layout.footerRight);
  ctx.restore();

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/png', 1.0);
  });
}

async function renderTradeCardDataUrl(trade, options = {}) {
  const payload = options?.orientation ? { ...trade, orientation: options.orientation } : trade;
  const blob = await renderTradeCard(payload);
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
    formatTimestamp: tradeCardFormatTimestamp,
    TRADE_CARD_LAYOUTS,
    TRADE_CARD_TEMPLATES
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
    formatTimestamp: tradeCardFormatTimestamp,
    TRADE_CARD_LAYOUTS,
    TRADE_CARD_TEMPLATES
  };
}
