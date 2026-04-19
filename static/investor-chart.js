/* ════════════════════════════════════════════════════════════
   investor-chart.js — reusable SVG line chart
   Used by: investor-portal.js (investor dashboard)
            profile-investor-accounts-page.js (master view)
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const RANGES = ['1M', '3M', '1Y', 'ALL'];
  const PAD = { left: 54, right: 16, top: 14, bottom: 36 };
  const GRID_ROWS = 4;
  const SERIES_COLORS = ['var(--accent)', '#6366f1'];

  function fmtCurrency(v, currency) {
    const sym = currency || '£';
    const abs = Math.abs(v);
    if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sym}${(v / 1e3).toFixed(1)}k`;
    return `${sym}${Number(v).toFixed(2)}`;
  }

  function fmtPct(v) {
    const sign = v >= 0 ? '+' : '';
    return `${sign}${Number(v).toFixed(2)}%`;
  }

  function fmtDateShort(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function fmtDateLong(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function fmtMonthYear(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }

  function toReturnPts(points) {
    if (!points.length) return [];
    const base = points[0].value;
    if (!base) return points.map(p => ({ ...p, value: 0 }));
    return points.map(p => ({ ...p, value: (p.value / base - 1) * 100 }));
  }

  function pickXLabelIdxs(pts, max) {
    const n = pts.length;
    if (!n) return [];
    if (n === 1) return [0];
    const count = Math.min(n, max);
    const idxs = [];
    for (let i = 0; i < count; i++) {
      idxs.push(Math.round(i * (n - 1) / (count - 1)));
    }
    return [...new Set(idxs)];
  }

  function niceYRange(min, max) {
    const span = max - min || 1;
    const rawStep = span / GRID_ROWS;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const niceMult = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    const step = mag * niceMult;
    const nMin = Math.floor(min / step) * step;
    const nMax = Math.ceil(max / step) * step;
    return { min: nMin, max: nMax, step: (nMax - nMin) / GRID_ROWS };
  }

  function createInvestorChart(container, opts) {
    opts = opts || {};

    let state = {
      series:         opts.series         || [],
      viewMode:       opts.viewMode        || 'value',
      range:          opts.range           || 'ALL',
      showViewToggle: opts.showViewToggle  !== false,
      showLegend:     opts.showLegend      === true,
      currency:       opts.currency        || '£',
      emptyMessage:   opts.emptyMessage    || 'No data available for this range.',
      onRangeChange:  opts.onRangeChange   || null,
      onViewChange:   opts.onViewChange    || null,
    };

    container.innerHTML = '';
    container.classList.add('ic-wrap');

    // Controls
    const controls = document.createElement('div');
    controls.className = 'ic-controls';
    container.appendChild(controls);

    const rangeBtns = document.createElement('div');
    rangeBtns.className = 'ic-range-btns';
    RANGES.forEach(function (r) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-range-btn' + (r === state.range ? ' is-active' : '');
      btn.textContent = r;
      btn.dataset.range = r;
      rangeBtns.appendChild(btn);
    });
    controls.appendChild(rangeBtns);

    const viewToggle = document.createElement('div');
    viewToggle.className = 'ic-view-toggle';
    if (!state.showViewToggle) viewToggle.hidden = true;
    [['value', 'Value'], ['return', 'Return %']].forEach(function (pair) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-view-btn' + (pair[0] === state.viewMode ? ' is-active' : '');
      btn.textContent = pair[1];
      btn.dataset.view = pair[0];
      viewToggle.appendChild(btn);
    });
    controls.appendChild(viewToggle);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'ic-legend';
    if (!state.showLegend) legend.hidden = true;
    container.appendChild(legend);

    // SVG wrap
    const svgWrap = document.createElement('div');
    svgWrap.className = 'ic-svg-wrap';
    container.appendChild(svgWrap);

    // Inline critical layout so chart is self-sufficient even if investor-portal.css isn't loaded
    svgWrap.style.position = 'relative';
    svgWrap.style.lineHeight = '0';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'ic-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('overflow', 'visible'); // prevents x-label clipping at right edge
    svg.style.display = 'block';
    svg.style.width = '100%';
    svgWrap.appendChild(svg);

    const tooltip = document.createElement('div');
    tooltip.className = 'ic-tooltip';
    tooltip.hidden = true;
    svgWrap.appendChild(tooltip);

    // Empty state
    const emptyEl = document.createElement('div');
    emptyEl.className = 'ic-empty';
    emptyEl.hidden = true;
    container.appendChild(emptyEl);

    function mkEl(tag, attrs) {
      const e = document.createElementNS(svgNS, tag);
      if (attrs) Object.entries(attrs).forEach(function (kv) { e.setAttribute(kv[0], kv[1]); });
      return e;
    }

    function renderLegend() {
      legend.innerHTML = '';
      if (!state.showLegend) return;
      state.series.forEach(function (s, i) {
        const item = document.createElement('label');
        item.className = 'ic-legend-item' + (s.visible === false ? ' is-hidden' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = s.visible !== false;
        cb.dataset.sid = s.id || String(i);
        const swatch = document.createElement('span');
        swatch.className = 'ic-legend-swatch';
        swatch.style.background = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
        const lbl = document.createElement('span');
        lbl.textContent = s.label || s.id || ('Series ' + (i + 1));
        item.appendChild(cb);
        item.appendChild(swatch);
        item.appendChild(lbl);
        legend.appendChild(item);

        cb.addEventListener('change', function () {
          s.visible = cb.checked;
          item.classList.toggle('is-hidden', !cb.checked);
          renderChart();
        });
      });
    }

    function renderChart() {
      svg.innerHTML = '';

      const active = state.series.filter(function (s) {
        return s.visible !== false && s.points && s.points.length > 0;
      });

      const display = active.map(function (s, i) {
        return {
          id: s.id,
          label: s.label || s.id || ('Series ' + (i + 1)),
          color: s.color || SERIES_COLORS[i % SERIES_COLORS.length],
          pts: state.viewMode === 'return' ? toReturnPts(s.points) : s.points,
        };
      });

      const allPts = display.reduce(function (acc, s) { return acc.concat(s.pts); }, []);
      const maxSeriesLen = display.reduce(function (m, s) { return Math.max(m, s.pts.length); }, 0);

      if (maxSeriesLen < 2) {
        emptyEl.textContent = state.emptyMessage;
        emptyEl.hidden = false;
        svgWrap.hidden = true;
        return;
      }
      emptyEl.hidden = true;
      svgWrap.hidden = false;

      const W = (svgWrap.getBoundingClientRect().width || 500);
      const H = 240;
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

      const cX = PAD.left;
      const cY = PAD.top;
      const cW = W - PAD.left - PAD.right;
      const cH = H - PAD.top - PAD.bottom;

      const vals = allPts.map(function (p) { return p.value; });
      const rawMin = Math.min.apply(null, vals);
      const rawMax = Math.max.apply(null, vals);
      const yr = niceYRange(rawMin, rawMax);
      const ySpan = yr.max - yr.min || 1;

      function toY(v) { return cY + cH - ((v - yr.min) / ySpan) * cH; }
      function toX(i, total) { return cX + (total <= 1 ? cW / 2 : (i / (total - 1)) * cW); }

      // Grid lines + Y labels
      for (let g = 0; g <= GRID_ROWS; g++) {
        const v = yr.min + g * yr.step;
        const y = toY(v);
        svg.appendChild(mkEl('line', { x1: cX, y1: y, x2: cX + cW, y2: y, class: 'ic-grid-line' }));
        const lbl = state.viewMode === 'return' ? fmtPct(v) : fmtCurrency(v, state.currency);
        const t = mkEl('text', { x: cX - 6, y: y, class: 'ic-y-label', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
        t.textContent = lbl;
        svg.appendChild(t);
      }

      // Series lines + fills
      const longest = display.reduce(function (a, b) { return b.pts.length > a.pts.length ? b : a; });

      display.forEach(function (s, si) {
        if (s.pts.length < 2) return;
        const n = s.pts.length;
        const dArr = s.pts.map(function (p, i) {
          return (i === 0 ? 'M' : 'L') + toX(i, n).toFixed(1) + ',' + toY(p.value).toFixed(1);
        });
        const pathD = dArr.join(' ');

        // Gradient fill for first series
        if (si === 0) {
          const gid = 'icg' + Date.now().toString(36) + si;
          const defs = mkEl('defs');
          const grad = mkEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
          const s0 = mkEl('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': '0.16' });
          const s1 = mkEl('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': '0' });
          grad.appendChild(s0); grad.appendChild(s1);
          defs.appendChild(grad);
          svg.appendChild(defs);
          const areaD = pathD +
            ' L' + toX(n - 1, n).toFixed(1) + ',' + (cY + cH).toFixed(1) +
            ' L' + toX(0, n).toFixed(1) + ',' + (cY + cH).toFixed(1) + ' Z';
          svg.appendChild(mkEl('path', { d: areaD, fill: 'url(#' + gid + ')', stroke: 'none' }));
        }

        svg.appendChild(mkEl('path', { d: pathD, class: 'ic-line', style: 'stroke:' + s.color, fill: 'none' }));
      });

      // X labels — first anchors left, last anchors right, middle anchors centre
      const xMax = W < 360 ? 4 : W < 520 ? 5 : 6;
      const xIdxs = pickXLabelIdxs(longest.pts, xMax);
      const useMonthFmt = longest.pts.length > 200;
      xIdxs.forEach(function (i, ai) {
        const pt = longest.pts[i];
        if (!pt) return;
        const anchor = ai === 0 ? 'start' : ai === xIdxs.length - 1 ? 'end' : 'middle';
        const t = mkEl('text', {
          x: toX(i, longest.pts.length),
          y: cY + cH + 18,
          class: 'ic-x-label',
          'text-anchor': anchor,
        });
        t.textContent = useMonthFmt ? fmtMonthYear(pt.date) : fmtDateShort(pt.date);
        svg.appendChild(t);
      });

      // Crosshair elements
      const xhLine = mkEl('line', { x1: 0, y1: cY, x2: 0, y2: cY + cH, class: 'ic-crosshair-line', visibility: 'hidden' });
      svg.appendChild(xhLine);
      const xhDots = display.map(function (s) {
        const dot = mkEl('circle', { cx: 0, cy: 0, r: 4, class: 'ic-dot', style: 'fill:' + s.color, visibility: 'hidden' });
        svg.appendChild(dot);
        return dot;
      });

      function handlePtr(clientX) {
        const svgRect = svg.getBoundingClientRect();
        const relX = clientX - svgRect.left - PAD.left;
        if (relX < 0 || relX > cW) { hideXH(); return; }

        const ratio = relX / cW;
        const refN = longest.pts.length;
        const refIdx = Math.max(0, Math.min(refN - 1, Math.round(ratio * (refN - 1))));
        const refPt = longest.pts[refIdx];
        if (!refPt) return;

        const x = toX(refIdx, refN);
        xhLine.setAttribute('x1', x); xhLine.setAttribute('x2', x);
        xhLine.setAttribute('visibility', 'visible');

        let html = '<div class="ic-tt-date">' + fmtDateLong(refPt.date) + '</div>';
        display.forEach(function (s, si) {
          const sN = s.pts.length;
          const sIdx = Math.max(0, Math.min(sN - 1, Math.round(ratio * (sN - 1))));
          const pt = s.pts[sIdx];
          if (!pt) return;
          xhDots[si].setAttribute('cx', toX(sIdx, sN));
          xhDots[si].setAttribute('cy', toY(pt.value));
          xhDots[si].setAttribute('visibility', 'visible');
          const valStr = state.viewMode === 'return' ? fmtPct(pt.value) : fmtCurrency(pt.value, state.currency);
          html += '<div class="ic-tt-row"><span class="ic-tt-swatch" style="background:' + s.color + '"></span>' +
                  '<span class="ic-tt-lbl">' + s.label + '</span>' +
                  '<span class="ic-tt-val">' + valStr + '</span></div>';
        });
        tooltip.innerHTML = html;
        tooltip.hidden = false;

        const tipW = tooltip.getBoundingClientRect().width || 150;
        const rightSpace = svgRect.width - x - 8;
        tooltip.style.left = (rightSpace >= tipW + 4 ? x + 10 : x - tipW - 10) + 'px';
        tooltip.style.top = PAD.top + 'px';
      }

      function hideXH() {
        xhLine.setAttribute('visibility', 'hidden');
        xhDots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
        tooltip.hidden = true;
      }

      svg.addEventListener('mousemove', function (e) { handlePtr(e.clientX); });
      svg.addEventListener('mouseleave', hideXH);
      svg.addEventListener('touchstart', function (e) { e.preventDefault(); if (e.touches[0]) handlePtr(e.touches[0].clientX); }, { passive: false });
      svg.addEventListener('touchmove', function (e) { e.preventDefault(); if (e.touches[0]) handlePtr(e.touches[0].clientX); }, { passive: false });
      svg.addEventListener('touchend', hideXH);
    }

    // Control event listeners
    rangeBtns.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('.ic-range-btn');
      if (!btn) return;
      const r = btn.dataset.range;
      if (r === state.range) return;
      state.range = r;
      rangeBtns.querySelectorAll('.ic-range-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.range === r);
      });
      if (state.onRangeChange) state.onRangeChange(r);
    });

    viewToggle.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('.ic-view-btn');
      if (!btn) return;
      const v = btn.dataset.view;
      if (v === state.viewMode) return;
      state.viewMode = v;
      viewToggle.querySelectorAll('.ic-view-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.view === v);
      });
      if (state.onViewChange) state.onViewChange(v);
      renderChart();
    });

    // Resize observer
    let rzTimer;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(function () {
        clearTimeout(rzTimer);
        rzTimer = setTimeout(renderChart, 80);
      });
      ro.observe(svgWrap);
    }

    // Initial render
    renderLegend();
    renderChart();

    return {
      update: function (newOpts) {
        newOpts = newOpts || {};
        let needLegend = false, needChart = false;
        if (newOpts.series !== undefined) { state.series = newOpts.series; needLegend = true; needChart = true; }
        if (newOpts.viewMode !== undefined && newOpts.viewMode !== state.viewMode) {
          state.viewMode = newOpts.viewMode;
          viewToggle.querySelectorAll('.ic-view-btn').forEach(function (b) {
            b.classList.toggle('is-active', b.dataset.view === state.viewMode);
          });
          needChart = true;
        }
        if (newOpts.range !== undefined && newOpts.range !== state.range) {
          state.range = newOpts.range;
          rangeBtns.querySelectorAll('.ic-range-btn').forEach(function (b) {
            b.classList.toggle('is-active', b.dataset.range === state.range);
          });
          needChart = true;
        }
        if (newOpts.currency !== undefined) { state.currency = newOpts.currency; needChart = true; }
        if (newOpts.emptyMessage !== undefined) { state.emptyMessage = newOpts.emptyMessage; }
        if (needLegend) renderLegend();
        if (needChart) renderChart();
      },
    };
  }

  window.createInvestorChart = createInvestorChart;
})();
