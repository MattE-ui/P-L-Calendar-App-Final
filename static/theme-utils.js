(function () {
  function getPnlColorClass(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return 'neutral';
    return n > 0 ? 'positive' : 'negative';
  }

  function applyPnlColorClass(el, value) {
    if (!el) return;
    const tone = getPnlColorClass(value);
    el.classList.toggle('positive', tone === 'positive');
    el.classList.toggle('negative', tone === 'negative');
  }

  window.ThemeUtils = {
    getPnlColorClass,
    applyPnlColorClass
  };
})();
