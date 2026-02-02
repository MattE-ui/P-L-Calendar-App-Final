const { spawnSync } = require('node:child_process');
const path = require('node:path');

const iscc = process.env.INNO_SETUP_ISCC || 'iscc';
const scriptPath = path.join(__dirname, 'VeracitySetup.iss');

const result = spawnSync(iscc, [scriptPath], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('Inno Setup build failed. Ensure Inno Setup is installed and ISCC is on PATH.');
  process.exit(result.status || 1);
}
