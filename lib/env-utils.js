function normalizeBooleanValue(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getEnvString(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' ? value : fallback;
}

function getEnvUrl(name, fallback = '') {
  const rawValue = getEnvString(name, fallback);
  return String(rawValue).replace(/\/+$|^\s+|\s+$/g, '');
}

function getEnvNumber(name, fallback = 0, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getEnvBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  return normalizeBooleanValue(value);
}

module.exports = {
  getEnvString,
  getEnvUrl,
  getEnvNumber,
  getEnvBoolean
};
