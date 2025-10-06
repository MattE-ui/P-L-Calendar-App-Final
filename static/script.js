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

function percentFromPortfolio(valueGBP) {
  if (!state.portfolioGBP) return 0;
  return (valueGBP / state.portfolioGBP) * 100;
}

function signPrefix(num) {
  return num > 0 ? '+' : '';
}

function getMonthData(date) {
  const key = ym(date);
  return state.data?.[key] || {};
}

function getValueForDate(date) {
  const key = formatDate(date);
  const month = getMonthData(date);
  const value = month[key];
  return value === undefined ? 0 : Number(value) || 0;
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
    let total = 0;
    let daysWithData = 0;
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      if (day < start || day > end) continue;
      const val = getValueForDate(day);
      if (val !== 0) daysWithData++;
      total += val;
    }
    weeks.push({
      total,
      daysWithData,
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
    const monthData = getMonthData(monthDate);
    let total = 0;
    let activeDays = 0;
    Object.values(monthData).forEach(v => {
      const num = Number(v) || 0;
      total += num;
      if (num !== 0) activeDays++;
    });
    months.push({ monthDate, total, activeDays });
  }
  return months;
}

function getValuesForSummary() {
  if (state.view === 'year') {
    return getYearMonths(state.selected).map(m => m.total);
  }
  if (state.view === 'week') {
    return getWeeksInMonth(state.selected).map(w => w.total);
  }
  const month = getMonthData(state.selected);
  return getDaysInMonth(state.selected).map(d => Number(month[formatDate(d)]) || 0);
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
  let sum = 0;
  let count = 0;
  values.forEach(v => {
    if (v !== 0) {
      sum += v;
      count++;
    }
  });
  if (!count) {
    avgEl.textContent = 'No recorded data yet';
    avgEl.classList.remove('positive', 'negative');
    return;
  }
  const avgGBP = sum / count;
  const pct = percentFromPortfolio(avgGBP);
  const label = viewAvgLabels[state.view] || 'Average';
  avgEl.textContent = `${label} avg: ${formatSignedCurrency(avgGBP)} (${signPrefix(pct)}${pct.toFixed(2)}%)`;
  avgEl.classList.toggle('positive', avgGBP > 0);
  avgEl.classList.toggle('negative', avgGBP < 0);
}

function renderDay() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const days = getDaysInMonth(state.selected);
  const monthData = getMonthData(state.selected);
  days.forEach(date => {
    const key = formatDate(date);
    const val = Number(monthData[key]) || 0;
    const row = document.createElement('div');
    row.className = 'list-row';
    if (val > 0) row.classList.add('profit');
    if (val < 0) row.classList.add('loss');
    const pct = percentFromPortfolio(val);
    const pctText = val === 0 ? '—' : `${signPrefix(pct)}${pct.toFixed(2)}%`;
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div class="row-sub">${key}</div>
      </div>
      <div class="row-value">
        <strong>${formatCurrency(val)}</strong>
        <span>${pctText}</span>
      </div>
    `;
    row.addEventListener('click', () => openProfitModal(key, val));
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
    if (week.total > 0) row.classList.add('profit');
    if (week.total < 0) row.classList.add('loss');
    const pct = percentFromPortfolio(week.total);
    const pctText = week.total === 0 ? '—' : `${signPrefix(pct)}${pct.toFixed(2)}%`;
    const rangeLabel = week.displayStart === week.displayEnd
      ? week.displayStart
      : `${week.displayStart} – ${week.displayEnd}`;
    const subLabel = week.daysWithData
      ? `${week.daysWithData} active day${week.daysWithData === 1 ? '' : 's'}`
      : 'No entries recorded';
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${rangeLabel}</div>
        <div class="row-sub">${subLabel}</div>
      </div>
      <div class="row-value">
        <strong>${formatCurrency(week.total)}</strong>
        <span>${pctText}</span>
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
  const monthData = getMonthData(first);

  for (let i = 0; i < startDay; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'cell';
    placeholder.style.visibility = 'hidden';
    grid.appendChild(placeholder);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(first.getFullYear(), first.getMonth(), day);
    const key = formatDate(date);
    const val = Number(monthData[key]) || 0;
    const pct = percentFromPortfolio(val);
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (val > 0) cell.classList.add('profit');
    if (val < 0) cell.classList.add('loss');
    cell.innerHTML = `
      <div class="date">${day}</div>
      <div class="val">${formatCurrency(val)}</div>
      <div class="pct">${val === 0 ? '' : `${signPrefix(pct)}${pct.toFixed(2)}%`}</div>
    `;
    cell.addEventListener('click', () => openProfitModal(key, val));
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
    if (item.total > 0) cell.classList.add('profit');
    if (item.total < 0) cell.classList.add('loss');
    const pct = percentFromPortfolio(item.total);
    const pctText = item.total === 0 ? '—' : `${signPrefix(pct)}${pct.toFixed(2)}%`;
    const metaText = item.activeDays
      ? `${item.activeDays} active day${item.activeDays === 1 ? '' : 's'}`
      : 'No entries yet';
    cell.innerHTML = `
      <div class="date">${item.monthDate.toLocaleDateString('en-GB', { month: 'short' })}</div>
      <div class="val">${formatCurrency(item.total)}</div>
      <div class="pct">${pctText}</div>
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

function openProfitModal(dateStr, currentValGBP = 0) {
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
  const label = $('#profit-modal-label');
  if (label) label.textContent = `Profit/Loss (${state.currency})`;
  const input = $('#edit-profit-input');
  if (input) {
    const amount = currencyAmount(currentValGBP, state.currency);
    const fallback = currencyAmount(currentValGBP, 'GBP');
    const value = amount === null ? fallback : amount;
    input.value = (Number.isFinite(value) ? value : 0).toFixed(2);
  }
  modal.classList.remove('hidden');
  const saveBtn = $('#save-profit-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const raw = Number($('#edit-profit-input').value);
      if (Number.isNaN(raw)) return;
      try {
        await api('/api/pl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateStr, value: toGBP(raw) })
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
          body: JSON.stringify({ date: dateStr, value: 0 })
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
