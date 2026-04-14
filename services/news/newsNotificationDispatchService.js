const crypto = require('crypto');

const NEWS_DELIVERY_CHANNELS = Object.freeze(['in_app', 'push', 'email']);

function createDefaultHandler(channel, logger) {
  return async (payload) => {
    logger.info('[NewsNotificationDispatch] channel handler stubbed.', {
      channel,
      userId: payload?.userId || null,
      eventId: payload?.eventId || null,
      deliveryWindow: payload?.deliveryWindow || null
    });
    return {
      ok: true,
      channel,
      messageId: `stub:${channel}:${crypto.randomUUID()}`,
      stubbed: true
    };
  };
}

function createNewsNotificationDispatchService({ logger = console, handlers = {} } = {}) {
  const resolvedHandlers = {};
  for (const channel of NEWS_DELIVERY_CHANNELS) {
    resolvedHandlers[channel] = typeof handlers[channel] === 'function'
      ? handlers[channel]
      : createDefaultHandler(channel, logger);
  }

  async function dispatchChannelPayload(payload) {
    const channel = String(payload?.channel || '').trim();
    if (!NEWS_DELIVERY_CHANNELS.includes(channel)) {
      throw new Error(`Unsupported news notification channel: ${channel || 'unknown'}`);
    }
    const handler = resolvedHandlers[channel];
    return handler(payload);
  }

  return {
    NEWS_DELIVERY_CHANNELS,
    dispatchChannelPayload
  };
}

module.exports = {
  NEWS_DELIVERY_CHANNELS,
  createNewsNotificationDispatchService
};
