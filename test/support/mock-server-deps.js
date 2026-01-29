const Module = require('node:module');

const originalLoad = Module._load;

Module._load = function load(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({}) };
  }
  if (request === 'express') {
    const express = () => ({
      use: () => {},
      get: () => {},
      post: () => {},
      delete: () => {},
      put: () => {},
      listen: () => ({ address: () => ({ port: 0 }), close: () => {} })
    });
    express.static = () => (req, res, next) => next && next();
    express.urlencoded = () => (req, res, next) => next && next();
    return express;
  }
  if (request === 'body-parser') {
    return {
      json: () => (req, res, next) => next && next(),
      urlencoded: () => (req, res, next) => next && next()
    };
  }
  if (request === 'cookie-parser') {
    return () => (req, res, next) => next && next();
  }
  if (request === 'bcrypt') {
    return {
      hash: async (value) => `hash:${value}`,
      compare: async (value, hash) => hash === `hash:${value}`
    };
  }
  if (request === 'node-cron') {
    return { schedule: () => ({ stop: () => {} }) };
  }
  if (request === 'node-fetch') {
    return async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Map()
    });
  }
  if (request === 'zod') {
    const makeSchema = (check) => ({
      _check: check,
      optional() {
        return makeSchema((value) => value === undefined || check(value));
      },
      nullable() {
        return makeSchema((value) => value === null || check(value));
      },
      min() {
        return this;
      },
      safeParse(value) {
        const ok = check(value);
        return ok
          ? { success: true, data: value }
          : { success: false, error: { flatten: () => ({}) } };
      }
    });
    const z = {
      string: () => makeSchema((value) => typeof value === 'string' && value.length > 0),
      number: () => makeSchema((value) => typeof value === 'number' && Number.isFinite(value)),
      boolean: () => makeSchema((value) => typeof value === 'boolean'),
      array: (schema) => makeSchema((value) => Array.isArray(value) && value.every((item) => schema._check(item))),
      object: (shape) => makeSchema((value) => {
        if (!value || typeof value !== 'object') return false;
        return Object.entries(shape).every(([key, schema]) => schema._check(value[key]));
      }),
      enum: (values) => makeSchema((value) => values.includes(value))
    };
    return { z };
  }
  return originalLoad(request, parent, isMain);
};
