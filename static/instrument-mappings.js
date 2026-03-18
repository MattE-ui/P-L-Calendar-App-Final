(function () {
  function computeSourceKey(instrument) {
    if (instrument?.uid) {
      return `TRADING212|UID:${instrument.uid}`;
    }
    if (instrument?.isin) {
      return `TRADING212|ISIN:${instrument.isin}`;
    }
    if (instrument?.name) {
      return `TRADING212|NAME:${String(instrument.name || '').trim().toLowerCase()}|CCY:${instrument?.currency || ''}`;
    }
    return `TRADING212|TICKER:${instrument?.ticker}|CCY:${instrument?.currency}`;
  }

  window.computeSourceKey = computeSourceKey;
})();
