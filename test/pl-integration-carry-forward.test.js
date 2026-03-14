const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureUserShape,
  ensurePortfolioHistory,
  carryForwardTradingAccountDayValues
} = require('../server');

test('carryForwardTradingAccountDayValues copies prior day end for non-updated accounts', () => {
  const user = {
    username: 'tester',
    passwordHash: 'x',
    portfolio: 0,
    initialPortfolio: 0,
    initialNetDeposits: 0,
    profileComplete: true,
    security: {},
    tradeJournal: {},
    portfolioHistory: {
      '2026-03': {
        '2026-03-13': {
          end: 10000,
          cashIn: 0,
          cashOut: 0,
          accounts: {
            t212: { end: 6000, cashIn: 0, cashOut: 0 },
            ibkr: { end: 4000, cashIn: 0, cashOut: 0 }
          }
        }
      }
    },
    multiTradingAccountsEnabled: true,
    tradingAccounts: [
      { id: 'primary', label: 'Primary', currentValue: 0, currentNetDeposits: 0 },
      { id: 't212', label: 'Trading 212', currentValue: 6000, currentNetDeposits: 0, integrationEnabled: true, integrationProvider: 'trading212' },
      { id: 'ibkr', label: 'IBKR', currentValue: 4000, currentNetDeposits: 0 }
    ]
  };

  ensureUserShape(user, user.username);
  const history = ensurePortfolioHistory(user);
  const payload = {
    end: 6100,
    cashIn: 0,
    cashOut: 0,
    accounts: {
      t212: { end: 6100, cashIn: 0, cashOut: 0 }
    }
  };

  const mutated = carryForwardTradingAccountDayValues(user, history, '2026-03-14', payload, 't212');

  assert.equal(mutated, true);
  assert.equal(payload.accounts.t212.end, 6100);
  assert.equal(payload.accounts.ibkr.end, 4000);
  assert.equal(payload.accounts.ibkr.cashIn, 0);
  assert.equal(payload.accounts.ibkr.cashOut, 0);
});

test('carryForwardTradingAccountDayValues does not overwrite existing day account value', () => {
  const user = {
    username: 'tester',
    passwordHash: 'x',
    portfolio: 0,
    initialPortfolio: 0,
    initialNetDeposits: 0,
    profileComplete: true,
    security: {},
    tradeJournal: {},
    portfolioHistory: {
      '2026-03': {
        '2026-03-13': {
          end: 10000,
          cashIn: 0,
          cashOut: 0,
          accounts: {
            t212: { end: 6000, cashIn: 0, cashOut: 0 },
            ibkr: { end: 4000, cashIn: 0, cashOut: 0 }
          }
        }
      }
    },
    multiTradingAccountsEnabled: true,
    tradingAccounts: [
      { id: 'primary', label: 'Primary', currentValue: 0, currentNetDeposits: 0 },
      { id: 't212', label: 'Trading 212', currentValue: 6000, currentNetDeposits: 0, integrationEnabled: true, integrationProvider: 'trading212' },
      { id: 'ibkr', label: 'IBKR', currentValue: 4000, currentNetDeposits: 0 }
    ]
  };

  ensureUserShape(user, user.username);
  const history = ensurePortfolioHistory(user);
  const payload = {
    end: 10150,
    cashIn: 0,
    cashOut: 0,
    accounts: {
      t212: { end: 6150, cashIn: 0, cashOut: 0 },
      ibkr: { end: 4000, cashIn: 0, cashOut: 0 }
    }
  };

  const mutated = carryForwardTradingAccountDayValues(user, history, '2026-03-14', payload, 't212');

  assert.equal(mutated, false);
  assert.equal(payload.accounts.ibkr.end, 4000);
});
