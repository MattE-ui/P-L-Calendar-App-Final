(function () {
  function computeSourceKey(instrument) {
    if (instrument?.isin) {
      return `TRADING212|ISIN:${instrument.isin}`;
    }
    if (instrument?.uid) {
      return `TRADING212|UID:${instrument.uid}`;
    }
    return `TRADING212|TICKER:${instrument?.ticker}|CCY:${instrument?.currency}`;
  }

  window.computeSourceKey = computeSourceKey;
})();
