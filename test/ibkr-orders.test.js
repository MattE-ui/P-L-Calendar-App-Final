const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({}) };
  }
  return originalLoad(request, parent, isMain);
};

const { parseIbkrOrders } = require('../server');

test('parseIbkrOrders handles array payloads', () => {
  const payload = [{
    orderId: '1',
    ticker: 'AAPL',
    orderType: 'STP',
    auxPrice: 120,
    status: 'Submitted',
    action: 'SELL',
    totalQuantity: 5
  }];
  const orders = parseIbkrOrders(payload);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].instrumentTicker, 'AAPL');
  assert.equal(orders[0].stopPrice, 120);
});

test('parseIbkrOrders flattens nested orders arrays', () => {
  const payload = {
    orders: [
      { orders: [{ orderId: '2', symbol: 'MSFT', orderType: 'STP', auxPrice: 50, status: 'Submitted', action: 'SELL' }] },
      { orderId: '3', symbol: 'TSLA', orderType: 'STP LMT', auxPrice: 180, status: 'Submitted', action: 'SELL' }
    ]
  };
  const orders = parseIbkrOrders(payload);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].instrumentTicker, 'MSFT');
  assert.equal(orders[1].instrumentTicker, 'TSLA');
});

test('parseIbkrOrders supports payload.order', () => {
  const payload = {
    order: [{ orderId: '4', symbol: 'NVDA', orderType: 'STP', auxPrice: 400, status: 'Submitted', action: 'SELL' }]
  };
  const orders = parseIbkrOrders(payload);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].instrumentTicker, 'NVDA');
});
