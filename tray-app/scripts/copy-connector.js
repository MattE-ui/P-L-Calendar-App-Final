const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '..', '..', 'ibkr-connector', 'dist');
const target = path.resolve(__dirname, '..', 'app', 'connector');

if (!fs.existsSync(source)) {
  console.error('Connector build output not found. Run ibkr-connector build first.');
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });

for (const file of fs.readdirSync(source)) {
  const srcFile = path.join(source, file);
  const destFile = path.join(target, file);
  fs.copyFileSync(srcFile, destFile);
}

console.log('Connector files copied to tray app.');
