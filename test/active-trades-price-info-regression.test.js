const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('active trades render reuse guard includes price info signature', () => {
  const scriptPath = path.join(__dirname, '..', 'static', 'script.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /activeTradesLastPriceInfoSignature/);
  assert.match(source, /const priceInfoSignature = JSON\.stringify\(state\.openPriceInfoByTradeId \|\| \{\}\);/);
  assert.match(source, /&& state\.activeTradesLastPriceInfoSignature === priceInfoSignature/);
  assert.match(source, /state\.activeTradesLastPriceInfoSignature = priceInfoSignature;/);
});
