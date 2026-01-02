async function api(path, opts = {}) {
  const isGuest = sessionStorage.getItem('guestMode') === 'true' || localStorage.getItem('guestMode') === 'true';
  if (isGuest && typeof window.handleGuestRequest === 'function') {
    return window.handleGuestRequest(path, opts);
  }
  const res = await fetch(path, { credentials: 'include', ...opts });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (res.status === 401) {
    if (data?.error && data.error.includes('Guest session expired')) {
      window.location.href = '/login.html?expired=guest';
    } else {
      window.location.href = '/login.html';
    }
    throw new Error('Unauthenticated');
  }
  if (res.status === 409 && data?.code === 'profile_incomplete') {
    window.location.href = '/profile.html';
    throw new Error('Profile incomplete');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

const isGuestSession = () => sessionStorage.getItem('guestMode') === 'true'
  || localStorage.getItem('guestMode') === 'true';

const state = {
  currency: 'GBP',
  rates: { GBP: 1 },
  transactions: [],
  notes: {},
  splits: {},
  splitProfitsEnabled: false,
  data: {},
  profiles: [],
  filters: {
    from: '',
    to: '',
    type: '',
    search: ''
  }
};

async function loadTransactionPrefs() {
  if (isGuestSession()) return;
  try {
    const prefs = await api('/api/transactions/prefs');
    state.splitProfitsEnabled = !!prefs?.splitProfits;
    localStorage.setItem('plc-transactions-prefs', JSON.stringify({ splitProfits: state.splitProfitsEnabled }));
  } catch (e) {
    console.warn('Failed to load transaction prefs', e);
  }
}

async function saveTransactionPrefs() {
  if (isGuestSession()) return;
  try {
    await api('/api/transactions/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ splitProfits: state.splitProfitsEnabled })
    });
  } catch (e) {
    console.warn('Failed to save transaction prefs', e);
  }
}

async function loadTransactionProfiles() {
  if (isGuestSession()) return;
  try {
    const res = await api('/api/transactions/profiles');
    if (Array.isArray(res?.profiles)) {
      state.profiles = res.profiles;
      localStorage.setItem('plc-transactions-profiles', JSON.stringify(state.profiles));
    }
  } catch (e) {
    console.warn('Failed to load transaction profiles', e);
  }
}

async function saveTransactionProfiles() {
  if (isGuestSession()) return;
  try {
    await api('/api/transactions/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: state.profiles })
    });
  } catch (e) {
    console.warn('Failed to save transaction profiles', e);
  }
}

const currencySymbols = { GBP: '£', USD: '$', EUR: '€' };

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
  const sign = valueGBP < 0 ? '-' : '';
  return `${sign}${currencySymbols[currency]}${amount.toFixed(2)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0.00%';
  const num = Number(value);
  const sign = num < 0 ? '-' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
}

function setMetricTrend(el, value) {
  if (!el) return;
  const isPositive = Number.isFinite(value) && value > 0;
  const isNegative = Number.isFinite(value) && value < 0;
  el.classList.toggle('positive', isPositive);
  el.classList.toggle('negative', isNegative);
  if (!isPositive && !isNegative) {
    el.classList.remove('positive');
    el.classList.remove('negative');
  }
}

async function loadRates() {
  try {
    const res = await api('/api/rates');
    const rates = res?.rates || {};
    state.rates = { GBP: 1, ...rates };
  } catch (e) {
    console.warn('Unable to load exchange rates', e);
    state.rates = {
      GBP: 1,
      ...(state.rates.USD ? { USD: state.rates.USD } : {}),
      ...(state.rates.EUR ? { EUR: state.rates.EUR } : {})
    };
  }
}

function buildTransactions(data) {
  const transactions = [];
  Object.entries(data || {}).forEach(([, days]) => {
    Object.entries(days || {}).forEach(([dateKey, record]) => {
      if (!record) return;
      const cashIn = Number(record.cashIn ?? 0);
      const cashOut = Number(record.cashOut ?? 0);
      const note = typeof record.note === 'string' ? record.note.trim() : '';
      if (Number.isFinite(cashIn) && cashIn > 0) {
        const noteKey = buildNoteKey(dateKey, 'Deposit', cashIn);
        const note = state.notes[noteKey] || '';
        transactions.push({
          id: `${dateKey}-deposit`,
          date: dateKey,
          type: 'Deposit',
          amount: cashIn,
          note,
          noteKey
        });
      }
      if (Number.isFinite(cashOut) && cashOut > 0) {
        const noteKey = buildNoteKey(dateKey, 'Withdrawal', cashOut);
        const note = state.notes[noteKey] || '';
        transactions.push({
          id: `${dateKey}-withdrawal`,
          date: dateKey,
          type: 'Withdrawal',
          amount: -cashOut,
          note,
          noteKey
        });
      }
    });
  });
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  return transactions;
}

function applyFilters(transactions) {
  const { from, to, type, search } = state.filters;
  const fromTime = from ? Date.parse(from) : null;
  const toTime = to ? Date.parse(to) : null;
  const query = search.trim().toLowerCase();
  return transactions.filter(tx => {
    const txTime = Date.parse(tx.date);
    if (fromTime && txTime < fromTime) return false;
    if (toTime && txTime > toTime) return false;
    if (type && tx.type !== type) return false;
    if (query && !tx.note.toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderTransactions(transactions = []) {
  const tbody = document.getElementById('transactions-body');
  const empty = document.getElementById('transactions-empty');
  if (!tbody || !empty) return;
  tbody.innerHTML = '';
  if (!transactions.length) {
    empty.classList.remove('is-hidden');
    return;
  }
  empty.classList.add('is-hidden');
  transactions.forEach(tx => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    const typeCell = document.createElement('td');
    const amountCell = document.createElement('td');
    const noteCell = document.createElement('td');
    const editCell = document.createElement('td');
    const splitCell = document.createElement('td');
    editCell.className = 'transaction-action-cell';
    splitCell.className = 'transaction-action-cell';
    dateCell.textContent = tx.date;
    typeCell.textContent = tx.type;
    amountCell.textContent = formatSignedCurrency(tx.amount, 'GBP');
    amountCell.classList.toggle('positive', tx.amount > 0);
    amountCell.classList.toggle('negative', tx.amount < 0);
    noteCell.textContent = tx.note || '—';
    const editBtn = document.createElement('button');
    editBtn.className = 'ghost';
    editBtn.type = 'button';
    editBtn.textContent = 'Edit Notes';
    editBtn.addEventListener('click', () => openNoteModal(tx));
    editCell.appendChild(editBtn);
    if (state.splitProfitsEnabled) {
      const splitBtn = document.createElement('button');
      splitBtn.className = 'ghost';
      splitBtn.type = 'button';
      splitBtn.textContent = 'Split Profits Settings';
      splitBtn.addEventListener('click', () => openSplitModal(tx));
      splitCell.appendChild(splitBtn);
    }
    row.append(dateCell, typeCell, amountCell, noteCell, editCell, splitCell);
    tbody.appendChild(row);
  });
}

function readFilters() {
  state.filters = {
    from: document.getElementById('filter-from')?.value || '',
    to: document.getElementById('filter-to')?.value || '',
    type: document.getElementById('filter-type')?.value || '',
    search: document.getElementById('filter-search')?.value || ''
  };
}

function bindFilters() {
  document.getElementById('apply-filters-btn')?.addEventListener('click', () => {
    readFilters();
    renderTransactions(applyFilters(state.transactions));
  });
  document.getElementById('reset-filters-btn')?.addEventListener('click', () => {
    state.filters = { from: '', to: '', type: '', search: '' };
    const fromEl = document.getElementById('filter-from');
    const toEl = document.getElementById('filter-to');
    const typeEl = document.getElementById('filter-type');
    const searchEl = document.getElementById('filter-search');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    if (typeEl) typeEl.value = '';
    if (searchEl) searchEl.value = '';
    renderTransactions(state.transactions);
  });
}

function openNoteModal(tx) {
  const modal = document.getElementById('transactions-note-modal');
  const input = document.getElementById('transactions-note-input');
  const status = document.getElementById('transactions-note-status');
  const saveBtn = document.getElementById('transactions-note-save-btn');
  if (!modal || !input || !saveBtn) return;
  modal.dataset.noteKey = tx.noteKey || '';
  input.value = tx.note || '';
  if (status) status.textContent = '';
  modal.classList.remove('hidden');
  input.focus();
}

function closeNoteModal() {
  const modal = document.getElementById('transactions-note-modal');
  const status = document.getElementById('transactions-note-status');
  if (status) status.textContent = '';
  modal?.classList.add('hidden');
}

async function saveNote() {
  const modal = document.getElementById('transactions-note-modal');
  const input = document.getElementById('transactions-note-input');
  const status = document.getElementById('transactions-note-status');
  if (!modal || !input) return;
  const noteKey = modal.dataset.noteKey;
  if (!noteKey) return;
  const nextNote = input.value.trim();
  if (status) {
    status.textContent = 'Saving...';
    status.classList.remove('is-error');
  }
  try {
    state.notes[noteKey] = nextNote;
    localStorage.setItem('plc-transactions-notes', JSON.stringify(state.notes));
    const target = state.transactions.find(tx => tx.noteKey === noteKey);
    if (target) {
      target.note = nextNote;
    }
    renderTransactions(applyFilters(state.transactions));
    if (status) {
      status.textContent = 'Saved.';
      status.classList.remove('is-error');
    }
    closeNoteModal();
  } catch (e) {
    if (status) {
      status.textContent = e?.message || 'Failed to save note.';
      status.classList.add('is-error');
    }
  }
}

function buildSplitRow(split = {}) {
  const row = document.createElement('div');
  row.className = 'transactions-split-row';
  const profiles = state.profiles.length
    ? state.profiles
    : [{ id: '', name: 'No profiles available' }];
  const profileDisabledAttr = state.profiles.length ? '' : ' disabled data-locked="true"';
  const options = profiles.map(profile => {
    const selected = profile.name === split.profile ? ' selected' : '';
    return `<option value="${profile.name}"${selected}>${profile.name}</option>`;
  }).join('');
  const shareOptions = profiles.map(profile => {
    const selected = profile.name === split.profitSplitProfile ? ' selected' : '';
    return `<option value="${profile.name}"${selected}>${profile.name}</option>`;
  }).join('');
  const profitSplitEnabled = Boolean(split.profitSplitEnabled);
  const profitSplitRatio = Number.isFinite(Number(split.profitSplitRatio))
    ? Number(split.profitSplitRatio)
    : 50;
  row.innerHTML = `
    <div class="transactions-split-main">
      <div class="tool-field">
        <label>Profile</label>
        <select class="transactions-split-profile"${profileDisabledAttr}>
          ${options}
        </select>
      </div>
      <div class="tool-field">
        <label>Amount</label>
        <input type="number" step="0.01" min="0" class="transactions-split-amount" value="${split.amount ?? ''}">
      </div>
      <button type="button" class="ghost transactions-remove-split">Remove</button>
    </div>
    <div class="transactions-split-sub">
      <div class="transactions-split-toggle">
        <label class="toggle-switch" aria-label="Split this profile's profits">
          <input type="checkbox" class="transactions-split-profit-toggle"${profitSplitEnabled ? ' checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <span>Split this profile's profits</span>
      </div>
      <div class="transactions-split-sub-fields${profitSplitEnabled ? '' : ' is-hidden'}">
        <div class="tool-field">
          <label>Split with</label>
          <select class="transactions-split-share-profile"${profileDisabledAttr}>
            ${shareOptions}
          </select>
        </div>
        <div class="tool-field">
          <label>Split %</label>
          <input type="number" min="1" max="99" step="1" class="transactions-split-share-ratio" value="${profitSplitRatio}">
        </div>
      </div>
    </div>
  `;
  row.querySelector('.transactions-remove-split')?.addEventListener('click', () => {
    row.remove();
    updateSplitSummary(document.getElementById('transactions-split-modal'));
  });
  const profitToggle = row.querySelector('.transactions-split-profit-toggle');
  const subFields = row.querySelector('.transactions-split-sub-fields');
  const updateSubFields = enabled => {
    subFields?.classList.toggle('is-hidden', !enabled);
    subFields?.querySelectorAll('select, input').forEach(field => {
      if (!enabled) {
        field.disabled = true;
        return;
      }
      if (field.dataset.locked === 'true') return;
      field.disabled = false;
    });
  };
  updateSubFields(profitToggle?.checked);
  profitToggle?.addEventListener('change', event => {
    updateSubFields(event.target.checked);
  });
  return row;
}

function openSplitModal(tx) {
  const modal = document.getElementById('transactions-split-modal');
  const list = document.getElementById('transactions-split-list');
  const total = document.getElementById('transactions-split-total');
  const ratio = document.getElementById('transactions-split-ratio');
  const status = document.getElementById('transactions-split-status');
  if (!modal || !list || !total || !ratio) return;
  modal.dataset.noteKey = tx.noteKey || '';
  modal.dataset.type = tx.type || '';
  total.value = Math.abs(tx.amount || 0).toFixed(2);
  ratio.textContent = '—';
  list.innerHTML = '';
  const existing = state.splits[tx.noteKey] || {};
  const splits = Array.isArray(existing.rawSplits)
    ? existing.rawSplits
    : (Array.isArray(existing.splits) ? existing.splits : []);
  splits.forEach(split => list.appendChild(buildSplitRow(split)));
  if (!splits.length) {
    list.appendChild(buildSplitRow());
  }
  if (status) {
    status.textContent = '';
    status.classList.remove('is-error');
  }
  modal.classList.remove('hidden');
  updateSplitSummary(modal);
  bindSplitSummary(modal);
}

function closeSplitModal() {
  const modal = document.getElementById('transactions-split-modal');
  const status = document.getElementById('transactions-split-status');
  if (status) {
    status.textContent = '';
    status.classList.remove('is-error');
  }
  modal?.classList.add('hidden');
}

function saveSplitSettings() {
  const modal = document.getElementById('transactions-split-modal');
  const list = document.getElementById('transactions-split-list');
  const total = document.getElementById('transactions-split-total');
  const status = document.getElementById('transactions-split-status');
  if (!modal || !list || !total) return;
  const noteKey = modal.dataset.noteKey;
  if (!noteKey) return;
  const rawSplits = Array.from(list.querySelectorAll('.transactions-split-row')).map(row => ({
    profile: row.querySelector('.transactions-split-profile')?.value.trim() || '',
    amount: Number(row.querySelector('.transactions-split-amount')?.value || 0),
    profitSplitEnabled: row.querySelector('.transactions-split-profit-toggle')?.checked || false,
    profitSplitProfile: row.querySelector('.transactions-split-share-profile')?.value.trim() || '',
    profitSplitRatio: Number(row.querySelector('.transactions-split-share-ratio')?.value || 0)
  })).filter(split => split.profile || split.amount);
  const totalValue = Number(total.value || 0);
  if (!Number.isFinite(totalValue) || totalValue < 0) {
    if (status) {
      status.textContent = 'Enter a valid total amount.';
      status.classList.add('is-error');
    }
    return;
  }
  if (!rawSplits.length) {
    delete state.splits[noteKey];
    try {
      localStorage.setItem('plc-transactions-splits', JSON.stringify(state.splits));
      if (status) {
        status.textContent = 'Saved.';
        status.classList.remove('is-error');
      }
    } catch (e) {
      if (status) {
        status.textContent = 'Failed to save split settings.';
        status.classList.add('is-error');
      }
    }
    closeSplitModal();
    return;
  }
  const splitTotal = rawSplits.reduce((sum, split) => sum + (Number.isFinite(split.amount) ? split.amount : 0), 0);
  if (Math.abs(splitTotal - totalValue) > 0.01) {
    if (status) {
      status.textContent = `Split amounts must equal ${totalValue.toFixed(2)}.`;
      status.classList.add('is-error');
    }
    return;
  }
  const txType = modal.dataset.type || '';
  const splits = normalizeProfitSplits(rawSplits);
  state.splits[noteKey] = {
    total: Number(total.value || 0),
    splits,
    rawSplits,
    type: txType,
    noteKey
  };
  try {
    localStorage.setItem('plc-transactions-splits', JSON.stringify(state.splits));
    if (status) {
      status.textContent = 'Saved.';
      status.classList.remove('is-error');
    }
  } catch (e) {
    if (status) {
      status.textContent = 'Failed to save split settings.';
      status.classList.add('is-error');
    }
  }
  closeSplitModal();
}

function renderProfiles() {
  const list = document.getElementById('transactions-profiles-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.profiles.length) {
    const empty = document.createElement('p');
    empty.className = 'tool-note';
    empty.textContent = 'No profiles yet. Add one to start tracking splits.';
    list.appendChild(empty);
    return;
  }
  state.profiles.forEach(profile => {
    const row = document.createElement('div');
    row.className = 'integration-fields';
    row.innerHTML = `
      <div class="tool-field">
        <label>Profile name</label>
        <input type="text" value="${profile.name}" disabled>
      </div>
      <div class="tool-field">
        <label>Notes</label>
        <input type="text" value="${profile.note || ''}" placeholder="Optional note">
      </div>
      <div class="filter-actions">
        <button type="button" class="ghost profile-stats-btn">Statistics</button>
        <button type="button" class="ghost danger remove-profile-btn">Remove</button>
      </div>
    `;
    row.querySelector('.remove-profile-btn')?.addEventListener('click', () => {
      state.profiles = state.profiles.filter(p => p.id !== profile.id);
      persistProfiles();
      renderProfiles();
    });
    row.querySelector('.profile-stats-btn')?.addEventListener('click', () => openProfileStats(profile));
    const noteInput = row.querySelector('input[placeholder="Optional note"]');
    noteInput?.addEventListener('change', () => {
      profile.note = noteInput.value.trim();
      persistProfiles();
    });
    list.appendChild(row);
  });
}

function bindSplitSummary(modal) {
  if (modal.dataset.boundSummary) return;
  modal.addEventListener('input', event => {
    const target = event.target;
    if (!target) return;
    if (target.id === 'transactions-split-total' || target.classList.contains('transactions-split-amount')) {
      updateSplitSummary(modal);
    }
  });
  modal.dataset.boundSummary = 'true';
}

function updateSplitSummary(modal) {
  const ratio = document.getElementById('transactions-split-ratio');
  const total = document.getElementById('transactions-split-total');
  const list = document.getElementById('transactions-split-list');
  if (!ratio || !total || !list) return;
  if (modal?.dataset?.type !== 'Deposit') {
    ratio.textContent = '—';
    return;
  }
  const totalValue = Number(total.value || 0);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    ratio.textContent = '—';
    return;
  }
  const amounts = Array.from(list.querySelectorAll('.transactions-split-amount'))
    .map(input => Number(input.value || 0))
    .filter(value => Number.isFinite(value) && value > 0);
  if (!amounts.length) {
    ratio.textContent = '—';
    return;
  }
  const ratios = amounts.map(amount => Math.round((amount / totalValue) * 100));
  ratio.textContent = ratios.join('/');
}

function persistProfiles() {
  try {
    localStorage.setItem('plc-transactions-profiles', JSON.stringify(state.profiles));
  } catch (e) {
    console.warn('Failed to save profiles', e);
  }
  saveTransactionProfiles();
}

function openProfileStats(profile) {
  const modal = document.getElementById('transactions-profile-modal');
  if (!modal) return;
  const stats = calculateProfileStats(profile.name);
  document.getElementById('transactions-profile-title').textContent = `${profile.name} stats`;
  document.getElementById('transactions-profile-deposits').textContent = formatCurrency(stats.deposits);
  document.getElementById('transactions-profile-withdrawals').textContent = formatCurrency(stats.withdrawals);
  document.getElementById('transactions-profile-value').textContent = formatCurrency(stats.portfolioValue);
  document.getElementById('transactions-profile-return').textContent = formatPercent(stats.rateOfReturn);
  document.getElementById('transactions-profile-performance').textContent = formatSignedCurrency(stats.netPerformance);
  modal.classList.remove('hidden');
}

function closeProfileStats() {
  document.getElementById('transactions-profile-modal')?.classList.add('hidden');
}

function calculateProfileStats(profileName) {
  let deposits = 0;
  let withdrawals = 0;
  let netDeposits = 0;
  let portfolioValue = 0;
  Object.values(state.splits).forEach(split => {
    const isDeposit = split.type === 'Deposit';
    const isWithdrawal = split.type === 'Withdrawal';
    if (!isDeposit && !isWithdrawal) return;
    const splitItems = getSplitItems(split);
    splitItems.forEach(item => {
      if (item.profile !== profileName) return;
      const amount = Number(item.amount || 0);
      if (!Number.isFinite(amount)) return;
      const signedAmount = isDeposit ? amount : -amount;
      if (isDeposit) deposits += amount;
      if (isWithdrawal) withdrawals += amount;
      netDeposits += signedAmount;
      const dateMs = parseTransactionDate(split.noteKey, split.type);
      const performanceFactor = getPortfolioPerformanceFactor(dateMs);
      portfolioValue += signedAmount * performanceFactor;
    });
  });
  const netPerformance = portfolioValue - netDeposits;
  const rateOfReturn = netDeposits ? (netPerformance / netDeposits) * 100 : 0;
  return { deposits, withdrawals, portfolioValue, netPerformance, rateOfReturn };
}

function roundCurrency(amount) {
  return Math.round(amount * 100) / 100;
}

function normalizeProfitSplits(rawSplits) {
  const normalized = [];
  rawSplits.forEach(split => {
    const profile = split.profile?.trim();
    const amount = Number(split.amount || 0);
    if (!profile || !Number.isFinite(amount) || amount <= 0) return;
    const otherProfile = split.profitSplitProfile?.trim();
    const ratio = Number(split.profitSplitRatio || 0);
    const shouldSplit = split.profitSplitEnabled
      && otherProfile
      && otherProfile !== profile
      && Number.isFinite(ratio)
      && ratio > 0
      && ratio < 100;
    if (!shouldSplit) {
      normalized.push({ profile, amount });
      return;
    }
    const otherAmount = roundCurrency(amount * (ratio / 100));
    const remainingAmount = roundCurrency(amount - otherAmount);
    if (remainingAmount > 0) {
      normalized.push({ profile, amount: remainingAmount });
    }
    if (otherAmount > 0) {
      normalized.push({ profile: otherProfile, amount: otherAmount });
    }
  });
  return normalized;
}

function getSplitItems(split) {
  if (Array.isArray(split?.splits) && split.splits.length) {
    return split.splits;
  }
  if (Array.isArray(split?.rawSplits)) {
    return normalizeProfitSplits(split.rawSplits);
  }
  return [];
}

function parseTransactionDate(noteKey, type) {
  if (!noteKey || !type) return null;
  const marker = `-${type}-`;
  const index = noteKey.indexOf(marker);
  if (index === -1) return null;
  const datePart = noteKey.slice(0, index);
  if (!datePart) return null;
  const ts = Date.parse(datePart);
  return Number.isNaN(ts) ? null : ts;
}

function getPortfolioPerformanceFactor(depositDateMs) {
  if (!depositDateMs || !state.data) return 1;
  const entry = findClosestEntry(depositDateMs);
  if (!entry) return 1;
  const baseline = Number.isFinite(entry.closing) ? entry.closing : entry.opening;
  const latest = Number.isFinite(state.metrics?.latestGBP) ? state.metrics.latestGBP : null;
  if (!Number.isFinite(baseline) || !Number.isFinite(latest) || baseline <= 0) return 1;
  const netDepositsAfter = sumNetDepositsAfter(depositDateMs);
  const adjustedLatest = latest - netDepositsAfter;
  if (!Number.isFinite(adjustedLatest) || adjustedLatest <= 0) return 1;
  return adjustedLatest / baseline;
}

function findClosestEntry(dateMs) {
  let closest = null;
  let closestBefore = null;
  Object.entries(state.data || {}).forEach(([, days]) => {
    Object.entries(days || {}).forEach(([dateKey, record]) => {
      const date = Date.parse(dateKey);
      if (Number.isNaN(date)) return;
      const closing = Number(record?.end);
      const opening = Number(record?.start);
      const hasClosing = Number.isFinite(closing);
      const hasOpening = Number.isFinite(opening);
      if (!hasClosing && !hasOpening) return;
      const payload = {
        date,
        closing: hasClosing ? closing : null,
        opening: hasOpening ? opening : null
      };
      if (date >= dateMs) {
        if (!closest || date < closest.date) {
          closest = payload;
        }
        return;
      }
      if (!closestBefore || date > closestBefore.date) {
        closestBefore = payload;
      }
    });
  });
  return closestBefore || closest;
}

function sumNetDepositsAfter(dateMs) {
  let netDeposits = 0;
  Object.entries(state.data || {}).forEach(([, days]) => {
    Object.entries(days || {}).forEach(([dateKey, record]) => {
      const date = Date.parse(dateKey);
      if (Number.isNaN(date) || date <= dateMs) return;
      const cashIn = Number(record?.cashIn ?? 0);
      const cashOut = Number(record?.cashOut ?? 0);
      if (Number.isFinite(cashIn)) netDeposits += cashIn;
      if (Number.isFinite(cashOut)) netDeposits -= cashOut;
    });
  });
  return netDeposits;
}

async function loadHeroMetrics() {
  try {
    const res = await api('/api/portfolio');
    const portfolio = Number(res?.portfolio);
    const netDeposits = Number(res?.netDepositsTotal);
    const portfolioValue = Number.isFinite(portfolio) ? portfolio : 0;
    const netDepositsValue = Number.isFinite(netDeposits) ? netDeposits : 0;
    const netPerformance = portfolioValue - netDepositsValue;
    await loadRates();
    state.metrics = { latestGBP: portfolioValue };
    const netPerfPct = netDepositsValue ? (netPerformance / Math.abs(netDepositsValue)) * 100 : 0;
    const altCurrency = state.currency === 'GBP'
      ? (state.rates.USD ? 'USD' : (state.rates.EUR ? 'EUR' : null))
      : 'GBP';
    const portfolioEl = document.getElementById('header-portfolio-value');
    if (portfolioEl) portfolioEl.textContent = formatCurrency(portfolioValue);
    const portfolioSub = document.getElementById('header-portfolio-sub');
    if (portfolioSub) {
      const altValue = altCurrency ? formatCurrency(portfolioValue, altCurrency) : '—';
      portfolioSub.textContent = altCurrency && altValue !== '—' ? `≈ ${altValue}` : '';
    }
    const netDepositsEl = document.getElementById('hero-net-deposits-value');
    if (netDepositsEl) netDepositsEl.textContent = formatSignedCurrency(netDepositsValue);
    const netDepositsSub = document.getElementById('hero-net-deposits-sub');
    if (netDepositsSub) {
      const altDeposits = altCurrency ? formatSignedCurrency(netDepositsValue, altCurrency) : '—';
      netDepositsSub.textContent = altCurrency && altDeposits !== '—' ? `≈ ${altDeposits}` : '';
    }
    const netPerfEl = document.getElementById('hero-net-performance-value');
    if (netPerfEl) netPerfEl.textContent = formatSignedCurrency(netPerformance);
    const netPerfSub = document.getElementById('hero-net-performance-sub');
    if (netPerfSub) {
      const pieces = [];
      if (altCurrency) {
        const altPerf = formatSignedCurrency(netPerformance, altCurrency);
        if (altPerf !== '—') pieces.push(`≈ ${altPerf}`);
      }
      pieces.push(formatPercent(netPerfPct));
      netPerfSub.textContent = pieces.join(' • ');
    }
    setMetricTrend(document.getElementById('hero-net-performance'), netPerformance);
    const portfolioCard = document.getElementById('hero-portfolio');
    if (portfolioCard) {
      setMetricTrend(portfolioCard, portfolioValue - netDepositsValue);
    }
    const netDepositsCard = document.getElementById('hero-net-deposits');
    if (netDepositsCard) {
      netDepositsCard.classList.remove('positive', 'negative');
    }
  } catch (e) {
    console.warn('Failed to load hero metrics', e);
  }
}

function setupNav() {
  const navToggle = document.getElementById('nav-toggle-btn');
  const navDrawer = document.getElementById('nav-drawer');
  const navOverlay = document.getElementById('nav-drawer-overlay');
  const navClose = document.getElementById('nav-close-btn');
  const setNavOpen = open => {
    if (!navDrawer || !navOverlay || !navToggle) return;
    navDrawer.classList.toggle('hidden', !open);
    navOverlay.classList.toggle('hidden', !open);
    navOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  navToggle?.addEventListener('click', () => {
    const isOpen = !navDrawer?.classList.contains('hidden');
    setNavOpen(!isOpen);
  });
  navClose?.addEventListener('click', () => setNavOpen(false));
  navOverlay?.addEventListener('click', () => setNavOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    setNavOpen(false);
  });
  document.getElementById('calendar-btn')?.addEventListener('click', () => {
    window.location.href = '/';
  });
  document.getElementById('analytics-btn')?.addEventListener('click', () => {
    window.location.href = '/analytics.html';
  });
  document.getElementById('trades-btn')?.addEventListener('click', () => {
    window.location.href = '/trades.html';
  });
  document.getElementById('transactions-btn')?.addEventListener('click', () => {
    window.location.href = '/transactions.html';
  });
  document.getElementById('profile-btn')?.addEventListener('click', () => {
    window.location.href = '/profile.html';
  });
  document.getElementById('portfolio-btn')?.addEventListener('click', () => {
    window.location.href = '/';
  });
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login.html';
    }
  });
  document.getElementById('quick-settings-btn')?.addEventListener('click', () => {
    setNavOpen(false);
    const modal = document.getElementById('transactions-settings-modal');
    const splitToggle = document.getElementById('transactions-qs-split-profits');
    const profilesSection = document.getElementById('transactions-split-profiles');
    const applyPrefs = prefs => {
      if (splitToggle) splitToggle.checked = !!prefs?.splitProfits;
    };
    try {
      const saved = localStorage.getItem('plc-transactions-prefs');
      if (saved) {
        applyPrefs(JSON.parse(saved));
      }
    } catch (e) {
      console.warn(e);
    }
    if (!isGuest) {
      loadTransactionPrefs().then(() => applyPrefs({ splitProfits: state.splitProfitsEnabled }));
    }
    if (profilesSection) {
      profilesSection.classList.toggle('is-hidden', !splitToggle?.checked);
    }
    renderProfiles();
    modal?.classList.remove('hidden');
  });
  document.getElementById('transactions-qs-split-profits')?.addEventListener('change', (event) => {
    const enabled = event.target.checked;
    const profilesSection = document.getElementById('transactions-split-profiles');
    if (profilesSection) {
      profilesSection.classList.toggle('is-hidden', !enabled);
    }
    state.splitProfitsEnabled = enabled;
    try {
      localStorage.setItem('plc-transactions-prefs', JSON.stringify({ splitProfits: enabled }));
    } catch (e) {
      console.warn(e);
    }
    saveTransactionPrefs();
    renderTransactions(applyFilters(state.transactions));
    renderProfiles();
  });
  const closeQs = () => document.getElementById('transactions-settings-modal')?.classList.add('hidden');
  document.getElementById('transactions-close-qs-btn')?.addEventListener('click', closeQs);
  document.getElementById('transactions-save-qs-btn')?.addEventListener('click', () => {
    const splitToggle = document.getElementById('transactions-qs-split-profits');
    const profilesSection = document.getElementById('transactions-split-profiles');
    const prefs = {};
    if (splitToggle) prefs.splitProfits = splitToggle.checked;
    try {
      localStorage.setItem('plc-transactions-prefs', JSON.stringify(prefs));
      state.splitProfitsEnabled = !!prefs.splitProfits;
      renderTransactions(applyFilters(state.transactions));
      if (profilesSection) {
        profilesSection.classList.toggle('is-hidden', !state.splitProfitsEnabled);
      }
    } catch (e) {
      console.warn(e);
    }
    saveTransactionPrefs();
    closeQs();
  });
  document.getElementById('transactions-note-close-btn')?.addEventListener('click', closeNoteModal);
  document.getElementById('transactions-note-cancel-btn')?.addEventListener('click', closeNoteModal);
  document.getElementById('transactions-note-save-btn')?.addEventListener('click', saveNote);
  document.getElementById('transactions-split-close-btn')?.addEventListener('click', closeSplitModal);
  document.getElementById('transactions-split-cancel-btn')?.addEventListener('click', closeSplitModal);
  document.getElementById('transactions-split-save-btn')?.addEventListener('click', saveSplitSettings);
  document.getElementById('transactions-add-split-btn')?.addEventListener('click', () => {
    const list = document.getElementById('transactions-split-list');
    if (list) {
      list.appendChild(buildSplitRow());
      updateSplitSummary(document.getElementById('transactions-split-modal'));
    }
  });
  document.getElementById('transactions-add-profile-btn')?.addEventListener('click', () => {
    const name = window.prompt('Profile name');
    if (!name) return;
    const profile = { id: `${Date.now()}-${Math.random()}`, name: name.trim(), note: '' };
    state.profiles.push(profile);
    persistProfiles();
    renderProfiles();
  });
  document.getElementById('transactions-profile-close-btn')?.addEventListener('click', closeProfileStats);
  document.getElementById('transactions-profile-close-btn-bottom')?.addEventListener('click', closeProfileStats);
}

async function loadTransactions() {
  try {
    try {
      const saved = localStorage.getItem('plc-transactions-notes');
      state.notes = saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.warn('Failed to load transaction notes', e);
      state.notes = {};
    }
    try {
      const savedSplits = localStorage.getItem('plc-transactions-splits');
      state.splits = savedSplits ? JSON.parse(savedSplits) : {};
    } catch (e) {
      console.warn('Failed to load transaction splits', e);
      state.splits = {};
    }
    try {
      const savedPrefs = localStorage.getItem('plc-transactions-prefs');
      const prefs = savedPrefs ? JSON.parse(savedPrefs) : {};
      state.splitProfitsEnabled = !!prefs?.splitProfits;
    } catch (e) {
      console.warn('Failed to load transaction prefs', e);
      state.splitProfitsEnabled = false;
    }
    try {
      const savedProfiles = localStorage.getItem('plc-transactions-profiles');
      state.profiles = savedProfiles ? JSON.parse(savedProfiles) : [];
    } catch (e) {
      console.warn('Failed to load profiles', e);
      state.profiles = [];
    }
    await loadTransactionPrefs();
    await loadTransactionProfiles();
    const data = await api('/api/pl');
    state.data = data || {};
    state.transactions = buildTransactions(state.data);
    pruneSplitSettings();
    renderTransactions(state.transactions);
  } catch (e) {
    console.error('Failed to load transactions', e);
  }
}

function pruneSplitSettings() {
  if (!state.splits || typeof state.splits !== 'object') return;
  const validKeys = new Set(state.transactions.map(tx => tx.noteKey));
  const nextSplits = Object.fromEntries(
    Object.entries(state.splits).filter(([noteKey]) => validKeys.has(noteKey))
  );
  if (Object.keys(nextSplits).length === Object.keys(state.splits).length) return;
  state.splits = nextSplits;
  try {
    localStorage.setItem('plc-transactions-splits', JSON.stringify(state.splits));
  } catch (e) {
    console.warn('Failed to save transaction splits', e);
  }
}

function buildNoteKey(date, type, amount) {
  return `${date}-${type}-${amount}`;
}

setupNav();
loadHeroMetrics();
loadTransactions();
bindFilters();
