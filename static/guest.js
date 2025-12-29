window.GUEST_DATA = {
  portfolio: {
    portfolio: 12000,
    initialNetDeposits: 8000,
    netDepositsTotal: 9000,
    liveOpenPnl: 145.32,
    livePortfolio: 12000,
    profileComplete: true,
    activeTrades: 2
  },
  pl: {
    "2025-12": {
      "2025-12-20": {
        start: 10200,
        end: 10350,
        cashIn: 0,
        cashOut: 0,
        note: "First week trading",
        trades: []
      },
      "2025-12-21": {
        start: 10350,
        end: 10520,
        cashIn: 0,
        cashOut: 0,
        note: "",
        trades: []
      },
      "2025-12-22": {
        start: 10520,
        end: 10840,
        cashIn: 500,
        cashOut: 0,
        note: "Deposit",
        trades: []
      },
      "2025-12-23": {
        start: 10840,
        end: 11020,
        cashIn: 0,
        cashOut: 0,
        note: "",
        trades: []
      },
      "2025-12-24": {
        start: 11020,
        end: 11250,
        cashIn: 0,
        cashOut: 0,
        note: "",
        trades: []
      }
    }
  },
  activeTrades: [
    {
      id: "guest1",
      symbol: "SNDK",
      entry: 232.8,
      stop: 221.01,
      currentStop: 233.0,
      currency: "GBP",
      sizeUnits: 4,
      riskPct: 0.38,
      direction: "long",
      livePrice: 250.45,
      unrealizedGBP: 44.62,
      guaranteedPnlGBP: 0.59,
      positionGBP: 931.2,
      source: "manual"
    },
    {
      id: "guest2",
      symbol: "AAPL",
      entry: 183.2,
      stop: 175.4,
      currency: "USD",
      sizeUnits: 3,
      riskPct: 0.45,
      direction: "long",
      livePrice: 188.25,
      unrealizedGBP: 11.2,
      guaranteedPnlGBP: -6.3,
      positionGBP: 420,
      source: "manual"
    }
  ],
  trades: [
    {
      id: "guest1",
      symbol: "SNDK",
      status: "open",
      openDate: "2025-12-24",
      entry: 232.8,
      stop: 221.01,
      currentStop: 233.0,
      currency: "GBP",
      sizeUnits: 4,
      riskPct: 0.38,
      riskAmountGBP: 44.62,
      positionGBP: 931.2,
      realizedPnlGBP: 0,
      guaranteedPnlGBP: 0.59,
      tradeType: "swing",
      assetClass: "stocks",
      strategyTag: "Breakout",
      marketCondition: "Trend",
      setupTags: ["breakout"],
      emotionTags: ["confident"],
      note: "Guest demo trade",
      source: "manual"
    },
    {
      id: "guest2",
      symbol: "AAPL",
      status: "closed",
      openDate: "2025-12-20",
      closeDate: "2025-12-22",
      entry: 183.2,
      stop: 175.4,
      closePrice: 190.6,
      currency: "USD",
      sizeUnits: 3,
      riskPct: 0.45,
      riskAmountGBP: 23.5,
      positionGBP: 420,
      realizedPnlGBP: 18.4,
      guaranteedPnlGBP: 0,
      tradeType: "day",
      assetClass: "stocks",
      strategyTag: "Momentum",
      marketCondition: "Trending",
      setupTags: ["momentum"],
      emotionTags: ["focused"],
      note: "Closed winner",
      source: "manual"
    }
  ],
  analytics: {
    summary: {
      total: 12,
      wins: 7,
      losses: 5,
      winRate: 0.58,
      lossRate: 0.42,
      avgWin: 64.4,
      avgLoss: 38.2,
      expectancy: 14.6,
      profitFactor: 1.68,
      avgR: 1.2
    },
    drawdown: {
      maxDrawdown: -120,
      durationDays: 4,
      series: []
    },
    distribution: {
      median: 18,
      stddev: 42,
      histogram: []
    },
    streaks: {
      maxWinStreak: 3,
      maxLossStreak: 2
    },
    equityCurve: [
      { date: "2025-12-20", cumulative: 0 },
      { date: "2025-12-21", cumulative: 45 },
      { date: "2025-12-22", cumulative: 80 },
      { date: "2025-12-23", cumulative: 120 },
      { date: "2025-12-24", cumulative: 165 }
    ]
  }
};
