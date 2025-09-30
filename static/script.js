const state = {
  view: 'month',
  selected: new Date(),
  portfolio: 0,
  monthData: {}
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

async function api(path, opts={}) {
  const res = await fetch(path, { credentials:'include', ...opts });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  return res.json();
}

function ym(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }

function renderTitleAndAvg() {
  const title = $('#title');
  const avgEl = $('#avg');
  const d = state.selected;
  const formatter = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric' });
  title.textContent = formatter.format(d);

  const days = Object.values(state.monthData || {});
  let sum = 0, count = 0;
  for (const v of days) { if (v !== 0 && v !== null && v !== undefined) { sum += v; count++; } }
  const avg = count ? sum / count : 0;
  const pct = state.portfolio ? ((avg / state.portfolio) * 100) : 0;
  avgEl.textContent = `${pct>=0?'+':''}${pct.toFixed(2)}%`;
  avgEl.classList.toggle('positive', pct>0);
  avgEl.classList.toggle('negative', pct<0);
}

function renderMonth() {
  $('#grid').innerHTML = '';
  const d = new Date(state.selected.getFullYear(), state.selected.getMonth(), 1);
  const startDay = (d.getDay() + 6) % 7; // Monday start
  const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();

  // headers Mon..Sun
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(day => {
    const h = document.createElement('div');
    h.textContent = day; h.style.fontWeight='700'; h.style.textAlign='center'; h.style.marginBottom='4px';
    $('#grid').appendChild(h);
  });

  // grid
  $('#grid').style.gridTemplateColumns = 'repeat(7, 1fr)';
  for (let i=0;i<startDay;i++) {
    const e = document.createElement('div'); e.className='cell'; e.style.visibility='hidden';
    $('#grid').appendChild(e);
  }
  for (let day=1; day<=daysInMonth; day++) {
    const date = new Date(d.getFullYear(), d.getMonth(), day);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const val = state.monthData[key] ?? 0;
    const cell = document.createElement('div');
    cell.className = 'cell';
    const pct = state.portfolio ? (val/state.portfolio)*100 : 0;
    if (val>0) cell.classList.add('profit');
    if (val<0) cell.classList.add('loss');
    cell.innerHTML = `<div class="date">${day}</div>
                      <div class="val">£${(val||0).toFixed(2)}</div>
                      <div class="pct">${val===0?'':`${pct>=0?'+':''}${pct.toFixed(2)}%`}</div>`;
    cell.addEventListener('click', ()=> openProfitModal(key, val));
    $('#grid').appendChild(cell);
  }

  renderTitleAndAvg();
}

function setActiveView(btnId) {
  $$('#view-controls button').forEach(b => b.classList.remove('active'));
  $(btnId).classList.add('active');
}

function openProfitModal(dateStr, currentVal) {
  $('#modal-date').textContent = new Date(dateStr).toDateString();
  const input = $('#edit-profit-input');
  input.value = currentVal || 0;
  $('#profit-modal').classList.remove('hidden');
  $('#save-profit-btn').onclick = async () => {
    const value = Number(input.value);
    await api('/api/pl', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date: dateStr, value }) });
    await loadMonth();
    $('#profit-modal').classList.add('hidden');
  };
  $('#delete-profit-btn').onclick = async () => {
    await api('/api/pl', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date: dateStr, value: 0 }) });
    await loadMonth();
    $('#profit-modal').classList.add('hidden');
  };
}

async function loadMonth() {
  const d = state.selected;
  const data = await api(`/api/pl?year=${d.getFullYear()}&month=${d.getMonth()+1}`);
  state.monthData = data || {};
  state.portfolio = (await api('/api/portfolio')).portfolio || 0;
  renderMonth();
}

async function init() {
  // month selector
  const sel = $('#month-select');
  const now = new Date();
  for (let i=0;i<24;i++) {
    const dt = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const opt = document.createElement('option');
    opt.value = dt.toISOString();
    opt.textContent = dt.toLocaleString('en-GB',{month:'short', year:'numeric'});
    if (i===0) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => { state.selected = new Date(sel.value); loadMonth(); };

  $('#portfolio-btn').onclick = async () => {
    $('#portfolio-input').value = state.portfolio || 0;
    $('#portfolio-modal').classList.remove('hidden');
  };
  $('#save-portfolio-btn').onclick = async () => {
    const v = Number($('#portfolio-input').value);
    await api('/api/portfolio', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ portfolio: v }) });
    $('#portfolio-modal').classList.add('hidden');
    await loadMonth();
  };
  $('#close-portfolio-btn').onclick = () => $('#portfolio-modal').classList.add('hidden');
  $('#close-profit-btn').onclick = () => $('#profit-modal').classList.add('hidden');
  $('#logout-btn').onclick = async () => { await api('/api/logout', { method:'POST' }); window.location.href='/login.html'; };

  await loadMonth();
}

window.addEventListener('DOMContentLoaded', init);
