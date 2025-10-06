const state = {
  view: 'month',
  selected: new Date(),
  data: {},
  portfolioGBP: 0,
  currency: 'GBP',
  rates: { GBP: 1 }
};

const currencySymbols = { GBP: '£', USD: '$' };
const viewAvgLabels = { day: 'Daily', week: 'Weekly', month: 'Daily', year: 'Monthly' };

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthenticated');
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday start
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ym(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currencyAmount(valueGBP, currency = state.currency) {
  const base = Number(valueGBP);
  if (Number.isNaN(base)) return null;
  if (currency === 'GBP') return base;
  const rate = state.rates[currency];
  if (!rate) return null;
  return base * rate;
}

function formatCurrency(valueGBP, currency = state.currency) {
  if (currency === 'GBP') {
    const amount = Number(valueGBP) || 0;
    const sign = amount < 0 ? '-' : '';
    return `${sign}${currencySymbols[currency]}${Math.abs(amount).toFixed(2)}`;
  }
  const amount = currencyAmount(Math.abs(valueGBP), currency);
  if (amount === null) return '—';
  const sign = valueGBP < 0 ? '-' : '';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function formatSignedCurrency(valueGBP, currency = state.currency) {
  if (valueGBP === 0) return `${currencySymbols[currency]}0.00`;
  const amount = currencyAmount(Math.abs(valueGBP), currency);
  if (amount === null) return '—';
  const sign = valueGBP > 0 ? '+' : '-';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function toGBP(value, currency = state.currency) {
  if (currency === 'GBP') return value;
  const rate = state.rates[currency];
  if (!rate) return value;
  return value / rate;
}

function signPrefix(num) {
  return num > 0 ? '+' : '';
}

function getMonthData(date) {
  const key = ym(date);
  return state.data?.[key] || {};
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0.00%';
  return `${signPrefix(value)}${Math.abs(value).toFixed(2)}%`;
}

function getDailyEntry(date) {
  const key = formatDate(date);
  const month = getMonthData(date);
  if (!(key in month)) return null;
  const record = month[key] || {};
  const opening = Number(record.start);
  const closing = Number(record.end);
  if (!Number.isFinite(closing)) return null;
  const cashInRaw = Number(record.cashIn ?? 0);
  const cashOutRaw = Number(record.cashOut ?? 0);
  const cashIn = Number.isFinite(cashInRaw) && cashInRaw >= 0 ? cashInRaw : 0;
  const cashOut = Number.isFinite(cashOutRaw) && cashOutRaw >= 0 ? cashOutRaw : 0;
  const hasOpening = Number.isFinite(opening);
  const netCash = cashIn - cashOut;
  const change = hasOpening ? closing - opening - netCash : null;
  const pct = hasOpening && opening !== 0 ? (change / opening) * 100 : null;
  return {
    date,
    opening: hasOpening ? opening : null,
    closing,
    change,
    pct,
    cashIn,
    cashOut,
    cashFlow: netCash
  };
}

function getDaysInMonth(date) {
  const start = startOfMonth(date);
  const total = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const days = [];
  for (let i = 1; i <= total; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), i));
  }
  return days;
}

function getWeeksInMonth(date) {
  const start = startOfMonth(date);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const weeks = [];
  let cursor = startOfWeek(start);
  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const displayStart = weekStart < start ? start : weekStart;
    const displayEnd = weekEnd > end ? end : weekEnd;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      if (day < start || day > end) continue;
      const entry = getDailyEntry(day);
      if (entry) days.push(entry);
    }
    const changeEntries = days.filter(entry => entry?.change !== null);
    const totalChange = changeEntries.reduce((sum, entry) => sum + entry.change, 0);
    const totalCashFlow = days.reduce((sum, entry) => sum + (entry?.cashFlow ?? 0), 0);
    const firstEntry = changeEntries[0] || days[0];
    const baseline = firstEntry ? (firstEntry.opening ?? firstEntry.closing ?? null) : null;
    const pct = !changeEntries.length || baseline === null || baseline === 0
      ? null
      : (totalChange / baseline) * 100;
    weeks.push({
      totalChange,
      pct,
      hasChange: changeEntries.length > 0,
      totalCashFlow,
      recordedDays: days.length,
      displayStart: displayStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      displayEnd: displayEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function getYearMonths(date) {
  const year = date.getFullYear();
  const months = [];
  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(year, m, 1);
    const days = getDaysInMonth(monthDate)
      .map(getDailyEntry)
      .filter(Boolean);
    const changeEntries = days.filter(entry => entry.change !== null);
    const totalChange = changeEntries.reduce((sum, entry) => sum + entry.change, 0);
    const totalCashFlow = days.reduce((sum, entry) => sum + (entry.cashFlow ?? 0), 0);
    const firstEntry = changeEntries[0] || days[0];
    const baseline = firstEntry ? (firstEntry.opening ?? firstEntry.closing) : null;
    const pct = !changeEntries.length || baseline === null || baseline === 0
      ? null
      : (totalChange / baseline) * 100;
    months.push({
      monthDate,
      totalChange,
      pct,
      totalCashFlow,
      recordedDays: days.length,
      hasChange: changeEntries.length > 0
    });
  }
  return months;
}

function getValuesForSummary() {
  if (state.view === 'year') {
    return getYearMonths(state.selected).map(item => ({
      change: item.hasChange ? item.totalChange : null,
      pct: item.hasChange ? item.pct : null
    }));
  }
  if (state.view === 'week') {
    return getWeeksInMonth(state.selected).map(item => ({
      change: item.hasChange ? item.totalChange : null,
      pct: item.hasChange ? item.pct : null
    }));
  }
  return getDaysInMonth(state.selected)
    .map(getDailyEntry)
    .filter(Boolean)
    .map(item => ({ change: item.change, pct: item.pct }));
}

function setActiveView() {
  $$('#view-controls button[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  });
}

function updateCurrencySelect() {
  const sel = $('#currency-select');
  if (!sel) return;
  const usdOption = sel.querySelector('option[value="USD"]');
  const hasUSD = !!state.rates.USD;
  if (usdOption) {
    usdOption.disabled = !hasUSD;
  }
  if (!hasUSD && state.currency === 'USD') {
    state.currency = 'GBP';
  }
  sel.value = state.currency;
}

function updatePortfolioPill() {
  const el = $('#portfolio-display');
  if (!el) return;
  const base = formatCurrency(state.portfolioGBP);
  if (state.currency === 'USD') {
    const alt = formatCurrency(state.portfolioGBP, 'GBP');
    el.innerHTML = `Portfolio: ${base} <span>≈ ${alt}</span>`;
  } else if (state.rates.USD) {
    const alt = formatCurrency(state.portfolioGBP, 'USD');
    el.innerHTML = `Portfolio: ${base} <span>≈ ${alt}</span>`;
  } else {
    el.textContent = `Portfolio: ${base}`;
  }
}

function updatePeriodSelect() {
  const sel = $('#period-select');
  if (!sel) return;
  const desired = state.view === 'year'
    ? String(state.selected.getFullYear())
    : startOfMonth(state.selected).toISOString();

  let needsRebuild = sel.dataset.view !== state.view;
  if (!needsRebuild) {
    const exists = Array.from(sel.options).some(opt => opt.value === desired);
    if (!exists) needsRebuild = true;
  }

  if (needsRebuild) {
    sel.dataset.view = state.view;
    sel.innerHTML = '';
    if (state.view === 'year') {
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        const year = now.getFullYear() - i;
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.textContent = String(year);
        sel.appendChild(opt);
      }
    } else {
      const now = new Date();
      for (let i = 0; i < 24; i++) {
        const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const opt = document.createElement('option');
        opt.value = dt.toISOString();
        opt.textContent = dt.toLocaleString('en-GB', { month: 'short', year: 'numeric' });
        sel.appendChild(opt);
      }
    }
  }

  const optionValues = Array.from(sel.options).map(o => o.value);
  if (optionValues.includes(desired)) {
    sel.value = desired;
  } else if (sel.options.length) {
    sel.selectedIndex = 0;
    const value = sel.value;
    if (state.view === 'year') {
      state.selected = new Date(Number(value), 0, 1);
    } else {
      state.selected = startOfMonth(new Date(value));
    }
  }
}

function renderTitle() {
  const title = $('#title');
  if (!title) return;
  const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
  if (state.view === 'year') {
    title.textContent = `${state.selected.getFullYear()} Performance`;
  } else if (state.view === 'month') {
    title.textContent = monthFormatter.format(state.selected);
  } else if (state.view === 'week') {
    title.textContent = `${monthFormatter.format(state.selected)} Weekly View`;
  } else {
    title.textContent = `${monthFormatter.format(state.selected)} Daily View`;
  }
}

function renderSummary() {
  const avgEl = $('#avg');
  if (!avgEl) return;
  const values = getValuesForSummary();
  let changeSum = 0;
  let changeCount = 0;
  let pctSum = 0;
  let pctCount = 0;
  values.forEach(item => {
    if (item?.change !== null && item?.change !== undefined) {
      changeSum += item.change;
      changeCount++;
    }
    if (item?.pct !== null && item?.pct !== undefined) {
      pctSum += item.pct;
      pctCount++;
    }
  });
  if (!changeCount) {
    avgEl.textContent = 'No recorded data yet';
    avgEl.classList.remove('positive', 'negative');
    return;
  }
  const avgGBP = changeSum / changeCount;
  const avgPct = pctCount ? (pctSum / pctCount) : null;
  const label = viewAvgLabels[state.view] || 'Average';
  const pctText = avgPct === null ? '' : ` (${formatPercent(avgPct)})`;
  avgEl.textContent = `${label} avg change: ${formatSignedCurrency(avgGBP)}${pctText}`;
  avgEl.classList.toggle('positive', avgGBP > 0);
  avgEl.classList.toggle('negative', avgGBP < 0);
}

function renderDay() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const days = getDaysInMonth(state.selected);
  days.forEach(date => {
    const key = formatDate(date);
    const entry = getDailyEntry(date);
    const closing = entry?.closing ?? null;
    const change = entry?.change ?? null;
    const pct = entry?.pct ?? null;
    const cashFlow = entry?.cashFlow ?? 0;
    const row = document.createElement('div');
    row.className = 'list-row';
    if (change > 0) row.classList.add('profit');
    if (change < 0) row.classList.add('loss');
    const changeText = change === null
      ? 'Δ —'
      : `Δ ${formatSignedCurrency(change)}${pct === null ? '' : ` (${formatPercent(pct)})`}`;
    const cashHtml = cashFlow === 0
      ? ''
      : `<span class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</span>`;
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div class="row-sub">${key}</div>
      </div>
      <div class="row-value">
        <strong>${closing === null ? '—' : formatCurrency(closing)}</strong>
        <span>${changeText}</span>
        ${cashHtml}
      </div>
    `;
    row.addEventListener('click', () => openEntryModal(key, entry));
    grid.appendChild(row);
  });
}

function renderWeek() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const weeks = getWeeksInMonth(state.selected);
  weeks.forEach(week => {
    const row = document.createElement('div');
    row.className = 'list-row';
    if (week.totalChange > 0) row.classList.add('profit');
    if (week.totalChange < 0) row.classList.add('loss');
    const hasEntries = week.recordedDays > 0;
    const hasChange = week.hasChange;
    const changeText = hasChange ? `Δ ${formatSignedCurrency(week.totalChange)}` : 'Δ —';
    const pctText = hasChange ? formatPercent(week.pct) : '—';
    const cashFlow = week.totalCashFlow ?? 0;
    const cashHtml = cashFlow === 0
      ? ''
      : `<span class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</span>`;
    const rangeLabel = week.displayStart === week.displayEnd
      ? week.displayStart
      : `${week.displayStart} – ${week.displayEnd}`;
    const subLabel = hasEntries
      ? `${week.recordedDays} recorded day${week.recordedDays === 1 ? '' : 's'}`
      : 'No entries recorded';
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${rangeLabel}</div>
        <div class="row-sub">${subLabel}</div>
      </div>
      <div class="row-value">
        <strong>${changeText}</strong>
        <span>${pctText}</span>
        ${cashHtml}
      </div>
    `;
    grid.appendChild(row);
  });
}

function renderMonth() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const headers = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  headers.forEach(day => {
    const h = document.createElement('div');
    h.className = 'dow';
    h.textContent = day;
    grid.appendChild(h);
  });

  const first = startOfMonth(state.selected);
  const startDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

  for (let i = 0; i < startDay; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'cell';
    placeholder.style.visibility = 'hidden';
    grid.appendChild(placeholder);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(first.getFullYear(), first.getMonth(), day);
    const key = formatDate(date);
    const entry = getDailyEntry(date);
    const closing = entry?.closing ?? null;
    const change = entry?.change ?? null;
    const pct = entry?.pct ?? null;
    const cashFlow = entry?.cashFlow ?? 0;
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (change > 0) cell.classList.add('profit');
    if (change < 0) cell.classList.add('loss');
    const changeText = change === null
      ? 'Δ —'
      : `Δ ${formatSignedCurrency(change)}${pct === null ? '' : ` (${formatPercent(pct)})`}`;
    const cashHtml = cashFlow === 0
      ? ''
      : `<div class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</div>`;
    cell.innerHTML = `
      <div class="date">${day}</div>
      <div class="val">${closing === null ? '—' : formatCurrency(closing)}</div>
      <div class="pct">${changeText}</div>
      ${cashHtml}
    `;
    cell.addEventListener('click', () => openEntryModal(key, entry));
    grid.appendChild(cell);
  }
}

function renderYear() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const months = getYearMonths(state.selected);
  months.forEach(item => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (item.totalChange > 0) cell.classList.add('profit');
    if (item.totalChange < 0) cell.classList.add('loss');
    const hasData = item.recordedDays > 0;
    const hasChange = item.hasChange;
    const pctText = hasChange ? formatPercent(item.pct) : '—';
    const cashFlow = item.totalCashFlow ?? 0;
    const cashHtml = cashFlow === 0
      ? ''
      : `<div class="cashflow">Cash flow: ${formatSignedCurrency(cashFlow)}</div>`;
    const metaText = hasData
      ? `${item.recordedDays} recorded day${item.recordedDays === 1 ? '' : 's'}`
      : 'No entries yet';
    cell.innerHTML = `
      <div class="date">${item.monthDate.toLocaleDateString('en-GB', { month: 'short' })}</div>
      <div class="val">${hasChange ? `Δ ${formatSignedCurrency(item.totalChange)}` : 'Δ —'}</div>
      <div class="pct">${pctText}</div>
      ${cashHtml}
      <div class="meta">${metaText}</div>
    `;
    cell.addEventListener('click', () => {
      state.view = 'month';
      state.selected = startOfMonth(item.monthDate);
      updatePeriodSelect();
      render();
    });
    grid.appendChild(cell);
  });
}

function renderView() {
  const grid = $('#grid');
  if (!grid) return;
  grid.className = `grid view-${state.view}`;
  if (state.view === 'day') return renderDay();
  if (state.view === 'week') return renderWeek();
  if (state.view === 'month') return renderMonth();
  return renderYear();
}

function render() {
  updateCurrencySelect();
  updatePortfolioPill();
  setActiveView();
  updatePeriodSelect();
  renderTitle();
  renderView();
  renderSummary();
}

async function loadRates() {
  try {
    const res = await api('/api/rates');
    const rates = res?.rates || {};
    state.rates = { GBP: 1, ...rates };
  } catch (e) {
    console.warn('Unable to load exchange rates', e);
    state.rates = { GBP: 1, ...(state.rates.USD ? { USD: state.rates.USD } : {}) };
  }
}

async function loadData() {
  try {
    state.data = await api('/api/pl');
  } catch (e) {
    console.error('Failed to load profit data', e);
    state.data = {};
  }
  try {
    const res = await api('/api/portfolio');
    state.portfolioGBP = Number(res?.portfolio) || 0;
  } catch (e) {
    console.error('Failed to load portfolio', e);
    state.portfolioGBP = 0;
  }
}

function openEntryModal(dateStr, existingEntry = null) {
  const modal = $('#profit-modal');
  if (!modal) return;
  const title = $('#modal-date');
  if (title) {
    title.textContent = new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
  const entry = existingEntry ?? getDailyEntry(new Date(dateStr));
  const currentValGBP = entry?.closing ?? null;
  const depositGBP = entry?.cashIn ?? 0;
  const withdrawalGBP = entry?.cashOut ?? 0;
  const label = $('#profit-modal-label');
  if (label) label.textContent = `Closing portfolio value (${state.currency})`;
  const depositLabel = $('#cash-in-label');
  if (depositLabel) depositLabel.textContent = `Deposits (${state.currency})`;
  const withdrawalLabel = $('#cash-out-label');
  if (withdrawalLabel) withdrawalLabel.textContent = `Withdrawals (${state.currency})`;
  const input = $('#edit-profit-input');
  if (input) {
    if (currentValGBP === null || currentValGBP === undefined) {
      input.value = '';
    } else {
      const amount = currencyAmount(currentValGBP, state.currency);
      const fallback = currencyAmount(currentValGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      input.value = Number.isFinite(value) ? value.toFixed(2) : '';
    }
  }
  const depositInput = $('#cash-in-input');
  if (depositInput) {
    if (depositGBP > 0) {
      const amount = currencyAmount(depositGBP, state.currency);
      const fallback = currencyAmount(depositGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      depositInput.value = Number.isFinite(value) ? value.toFixed(2) : '';
    } else {
      depositInput.value = '';
    }
  }
  const withdrawalInput = $('#cash-out-input');
  if (withdrawalInput) {
    if (withdrawalGBP > 0) {
      const amount = currencyAmount(withdrawalGBP, state.currency);
      const fallback = currencyAmount(withdrawalGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      withdrawalInput.value = Number.isFinite(value) ? value.toFixed(2) : '';
    } else {
      withdrawalInput.value = '';
    }
  }
  modal.classList.remove('hidden');
  const saveBtn = $('#save-profit-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const rawStr = $('#edit-profit-input').value.trim();
      if (rawStr === '') return;
      const raw = Number(rawStr);
      if (Number.isNaN(raw) || raw < 0) return;
      const depositStr = depositInput ? depositInput.value.trim() : '';
      const withdrawalStr = withdrawalInput ? withdrawalInput.value.trim() : '';
      const depositVal = depositStr === '' ? 0 : Number(depositStr);
      const withdrawalVal = withdrawalStr === '' ? 0 : Number(withdrawalStr);
      if (Number.isNaN(depositVal) || depositVal < 0) return;
      if (Number.isNaN(withdrawalVal) || withdrawalVal < 0) return;
      try {
        await api('/api/pl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: dateStr,
            value: toGBP(raw),
            cashIn: toGBP(depositVal),
            cashOut: toGBP(withdrawalVal)
          })
        });
        modal.classList.add('hidden');
        await loadData();
        render();
      } catch (e) {
        console.error(e);
      }
    };
  }
  const deleteBtn = $('#delete-profit-btn');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      try {
        await api('/api/pl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateStr, value: null })
        });
        modal.classList.add('hidden');
        await loadData();
        render();
      } catch (e) {
        console.error(e);
      }
    };
  }
}

function bindControls() {
  const periodSelect = $('#period-select');
  if (periodSelect) {
    periodSelect.addEventListener('change', () => {
      if (state.view === 'year') {
        state.selected = new Date(Number(periodSelect.value), 0, 1);
      } else {
        state.selected = startOfMonth(new Date(periodSelect.value));
      }
      render();
    });
  }

  const currencySelect = $('#currency-select');
  if (currencySelect) {
    currencySelect.addEventListener('change', () => {
      state.currency = currencySelect.value;
      render();
    });
  }

  $$('#view-controls button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!view || state.view === view) return;
      state.view = view;
      if (view === 'year') {
        state.selected = new Date(state.selected.getFullYear(), 0, 1);
      } else {
        state.selected = startOfMonth(state.selected);
      }
      updatePeriodSelect();
      render();
    });
  });

  $('#portfolio-btn')?.addEventListener('click', () => {
    const modalTitle = $('#portfolio-modal-title');
    if (modalTitle) modalTitle.textContent = `Portfolio value (${state.currency})`;
    const input = $('#portfolio-input');
    if (input) {
      const amount = currencyAmount(state.portfolioGBP, state.currency);
      const fallback = currencyAmount(state.portfolioGBP, 'GBP');
      const value = amount === null ? fallback : amount;
      input.value = (Number.isFinite(value) ? value : 0).toFixed(2);
    }
    $('#portfolio-modal')?.classList.remove('hidden');
  });

  $('#save-portfolio-btn')?.addEventListener('click', async () => {
    const input = $('#portfolio-input');
    if (!input) return;
    const raw = Number(input.value);
    if (Number.isNaN(raw) || raw < 0) return;
    try {
      await api('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio: toGBP(raw) })
      });
      $('#portfolio-modal')?.classList.add('hidden');
      await loadData();
      render();
    } catch (e) {
      console.error(e);
    }
  });

  $('#close-portfolio-btn')?.addEventListener('click', () => {
    $('#portfolio-modal')?.classList.add('hidden');
  });

  $('#close-profit-btn')?.addEventListener('click', () => {
    $('#profit-modal')?.classList.add('hidden');
  });

  $('#logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }
    window.location.href = '/login.html';
  });
}

async function init() {
  state.selected = startOfMonth(new Date());
  bindControls();
  updatePeriodSelect();
  setActiveView();
  try {
    await loadRates();
  } catch (e) {
    console.warn(e);
  }
  await loadData();
  render();
}

window.addEventListener('DOMContentLoaded', init);
