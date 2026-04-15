function ensureArrayProperty(target, propertyName) {
  if (!target || typeof target !== 'object') {
    return [];
  }

  if (!Array.isArray(target[propertyName])) {
    target[propertyName] = [];
  }

  return target[propertyName];
}

module.exports = {
  ensureArrayProperty
};
