const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 60 * 1000;
const DEFAULT_STALE_PROCESSING_MS = 30 * 60 * 1000;

function normalizeIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function calculateBackoffMs(attemptCount, options = {}) {
  const baseMs = Number(options.baseBackoffMs);
  const safeBaseMs = Number.isFinite(baseMs) && baseMs >= 1000 ? Math.floor(baseMs) : DEFAULT_BASE_BACKOFF_MS;
  const exponent = Math.max(0, Number(attemptCount || 1) - 1);
  return safeBaseMs * (2 ** exponent);
}

function normalizeOutboxItem(item = {}, nowIso = new Date().toISOString()) {
  const attemptCount = Number.isFinite(Number(item.attemptCount)) ? Math.max(0, Math.floor(Number(item.attemptCount))) : 0;
  const maxAttempts = Number.isFinite(Number(item.maxAttempts)) && Number(item.maxAttempts) > 0
    ? Math.floor(Number(item.maxAttempts))
    : DEFAULT_MAX_ATTEMPTS;
  const statusCandidate = String(item.status || '').trim();
  const allowedStatus = ['pending', 'processing', 'sent', 'failed', 'dead_letter'];
  const status = allowedStatus.includes(statusCandidate)
    ? statusCandidate
    : (statusCandidate === 'ready' ? 'pending' : 'pending');

  return {
    id: String(item.id || ''),
    userId: String(item.userId || item.payload?.userId || ''),
    newsEventId: String(item.newsEventId || item.payload?.eventId || ''),
    channel: String(item.channel || item.payload?.channel || '').trim(),
    payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
    status,
    attemptCount,
    maxAttempts,
    nextAttemptAt: normalizeIso(item.nextAttemptAt) || nowIso,
    claimedAt: normalizeIso(item.claimedAt),
    claimedBy: item.claimedBy ? String(item.claimedBy) : null,
    claimToken: item.claimToken ? String(item.claimToken) : null,
    lastAttemptAt: normalizeIso(item.lastAttemptAt),
    sentAt: normalizeIso(item.sentAt),
    lastErrorCode: item.lastErrorCode ? String(item.lastErrorCode) : null,
    lastErrorMessage: item.lastErrorMessage ? String(item.lastErrorMessage).slice(0, 500) : null,
    createdAt: normalizeIso(item.createdAt) || nowIso,
    updatedAt: normalizeIso(item.updatedAt) || nowIso
  };
}

function shouldRetryOutboxItem(item, errorInfo = {}) {
  const retryable = !!errorInfo.retryable;
  const attempts = Number(item?.attemptCount || 0);
  const maxAttempts = Number(item?.maxAttempts || DEFAULT_MAX_ATTEMPTS);
  if (!retryable) return false;
  return attempts < maxAttempts;
}

function finalizeOutboxItemSuccess(item, result = {}) {
  const expectedClaimToken = result?.expectedClaimToken ? String(result.expectedClaimToken) : null;
  if (expectedClaimToken && item.claimToken && item.claimToken !== expectedClaimToken) {
    return {
      id: item.id,
      status: item.status,
      guardRejected: true,
      guardReason: 'claim_token_mismatch',
      retryScheduled: false
    };
  }
  if (item.status !== 'processing') {
    return {
      id: item.id,
      status: item.status,
      guardRejected: true,
      guardReason: 'state_not_processing',
      retryScheduled: false
    };
  }
  const nowIso = new Date().toISOString();
  item.status = 'sent';
  item.sentAt = nowIso;
  item.updatedAt = nowIso;
  item.lastErrorCode = null;
  item.lastErrorMessage = null;
  item.claimedAt = null;
  item.claimedBy = null;
  item.claimToken = null;
  return {
    id: item.id,
    status: item.status,
    sentAt: item.sentAt,
    channel: item.channel,
    messageId: result?.messageId || null,
    provider: result?.provider || null,
    retryScheduled: false
  };
}

function finalizeOutboxItemFailure(item, errorInfo = {}, options = {}) {
  const expectedClaimToken = options?.expectedClaimToken ? String(options.expectedClaimToken) : null;
  if (expectedClaimToken && item.claimToken && item.claimToken !== expectedClaimToken) {
    return {
      id: item.id,
      status: item.status,
      guardRejected: true,
      guardReason: 'claim_token_mismatch',
      retryScheduled: false
    };
  }
  if (item.status !== 'processing') {
    return {
      id: item.id,
      status: item.status,
      guardRejected: true,
      guardReason: 'state_not_processing',
      retryScheduled: false
    };
  }
  const nowIso = new Date().toISOString();
  item.updatedAt = nowIso;
  item.lastErrorCode = String(errorInfo.code || 'unknown_error');
  item.lastErrorMessage = String(errorInfo.message || 'Unknown outbox processing error').slice(0, 500);
  item.claimedAt = null;
  item.claimedBy = null;
  item.claimToken = null;

  const canRetry = shouldRetryOutboxItem(item, errorInfo);
  if (canRetry) {
    const backoffMs = calculateBackoffMs(item.attemptCount, options);
    item.status = 'pending';
    item.nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
    return {
      id: item.id,
      status: item.status,
      retryScheduled: true,
      nextAttemptAt: item.nextAttemptAt,
      backoffMs,
      errorCode: item.lastErrorCode,
      errorMessage: item.lastErrorMessage
    };
  }

  item.status = errorInfo.retryable ? 'dead_letter' : 'failed';
  return {
    id: item.id,
    status: item.status,
    retryScheduled: false,
    errorCode: item.lastErrorCode,
    errorMessage: item.lastErrorMessage
  };
}

function claimPendingOutboxItems(options = {}) {
  const {
    db,
    now = new Date().toISOString(),
    batchSize = DEFAULT_BATCH_SIZE,
    claimedBy = 'news-outbox-processor'
  } = options;

  const nowIso = normalizeIso(now) || new Date().toISOString();
  const nowTs = Date.parse(nowIso);
  const safeBatchSize = Number.isFinite(Number(batchSize)) && Number(batchSize) > 0
    ? Math.min(250, Math.floor(Number(batchSize)))
    : DEFAULT_BATCH_SIZE;

  const rows = Array.isArray(db?.newsNotificationOutbox) ? db.newsNotificationOutbox : [];
  const claimed = [];

  for (const row of rows) {
    if (claimed.length >= safeBatchSize) break;
    const normalized = normalizeOutboxItem(row, nowIso);
    Object.assign(row, normalized);

    if (row.status !== 'pending') continue;
    const nextAttemptTs = Date.parse(normalizeIso(row.nextAttemptAt) || nowIso);
    if (!Number.isFinite(nextAttemptTs) || nextAttemptTs > nowTs) continue;

    row.status = 'processing';
    row.claimedAt = nowIso;
    row.claimedBy = claimedBy;
    row.claimToken = `claim:${nowTs}:${row.id}:${Math.random().toString(36).slice(2, 10)}`;
    row.lastAttemptAt = nowIso;
    row.attemptCount = Number(row.attemptCount || 0) + 1;
    row.updatedAt = nowIso;
    claimed.push(row);
  }

  return claimed;
}

async function processOutboxItem(item, context = {}) {
  const { dispatchChannelPayload } = context;
  if (typeof dispatchChannelPayload !== 'function') {
    throw new Error('processOutboxItem requires dispatchChannelPayload handler');
  }
  const payload = {
    ...(item.payload || {}),
    channel: item.channel,
    userId: item.userId,
    eventId: item.newsEventId
  };
  const result = await dispatchChannelPayload(payload, item);
  return {
    ok: !!result?.ok,
    channel: item.channel,
    messageId: result?.messageId || null,
    provider: result?.provider || null,
    retryable: !!result?.retryable,
    statusCode: result?.statusCode || null,
    details: result?.details || null
  };
}

async function runNewsNotificationOutboxProcessor(options = {}) {
  const {
    loadDB,
    saveDB,
    ensureNewsEventTables,
    logger = console,
    now = new Date().toISOString(),
    batchSize = DEFAULT_BATCH_SIZE,
    claimedBy = `processor:${process.pid}`
  } = options;

  if (typeof loadDB !== 'function' || typeof saveDB !== 'function' || typeof ensureNewsEventTables !== 'function') {
    throw new Error('runNewsNotificationOutboxProcessor requires loadDB/saveDB/ensureNewsEventTables');
  }

  const startedAt = Date.now();
  const nowIso = normalizeIso(now) || new Date().toISOString();

  const db = loadDB();
  ensureNewsEventTables(db);

  const diagnostics = {
    success: true,
    now: nowIso,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    elapsedMs: 0,
    claimedCount: 0,
    processedCount: 0,
    sentCount: 0,
    failedCount: 0,
    retriedCount: 0,
    deadLetterCount: 0,
    processingReleasedCount: 0,
    countsByChannel: { in_app: 0, push: 0, email: 0 },
    errors: []
  };

  const claimed = claimPendingOutboxItems({ db, now: nowIso, batchSize, claimedBy });
  diagnostics.claimedCount = claimed.length;
  logger.info('[NewsOutboxProcessor] run start.', { now: nowIso, claimedCount: claimed.length, batchSize });
  if (claimed.length) {
    saveDB(db);
  }

  for (const item of claimed) {
    diagnostics.processedCount += 1;
    diagnostics.countsByChannel[item.channel] = (diagnostics.countsByChannel[item.channel] || 0) + 1;
    try {
      const result = await processOutboxItem(item, options);
      if (!result.ok) {
        const failureResult = finalizeOutboxItemFailure(item, {
          retryable: !!result.retryable,
          code: result.statusCode || 'provider_not_ok',
          message: result.details || 'Channel delivery returned non-ok status'
        }, { ...options, expectedClaimToken: item.claimToken });
        if (failureResult.guardRejected) {
          diagnostics.errors.push({
            id: item.id,
            channel: item.channel,
            code: 'finalize_guard_rejected',
            message: failureResult.guardReason
          });
          logger.warn('[NewsOutboxProcessor] finalize failure guard rejected.', { id: item.id, guardReason: failureResult.guardReason });
          continue;
        }
        if (failureResult.retryScheduled) diagnostics.retriedCount += 1;
        else if (failureResult.status === 'dead_letter') diagnostics.deadLetterCount += 1;
        else diagnostics.failedCount += 1;
        saveDB(db);
        continue;
      }
      const successResult = finalizeOutboxItemSuccess(item, { ...result, expectedClaimToken: item.claimToken });
      if (successResult.guardRejected) {
        diagnostics.errors.push({
          id: item.id,
          channel: item.channel,
          code: 'finalize_guard_rejected',
          message: successResult.guardReason
        });
        logger.warn('[NewsOutboxProcessor] finalize success guard rejected.', { id: item.id, guardReason: successResult.guardReason });
        continue;
      }
      diagnostics.sentCount += 1;
      saveDB(db);
    } catch (error) {
      const code = String(error?.code || 'processor_exception');
      const retryable = error?.retryable === true || /timeout|temporar|unavailable|quota|rate/i.test(`${code}:${error?.message || ''}`);
      const failureResult = finalizeOutboxItemFailure(item, {
        retryable,
        code,
        message: error?.message || String(error)
      }, { ...options, expectedClaimToken: item.claimToken });
      if (failureResult.guardRejected) {
        diagnostics.errors.push({
          id: item.id,
          channel: item.channel,
          code: 'finalize_guard_rejected',
          message: failureResult.guardReason
        });
        logger.warn('[NewsOutboxProcessor] finalize exception guard rejected.', { id: item.id, guardReason: failureResult.guardReason });
        continue;
      }
      diagnostics.errors.push({
        id: item.id,
        channel: item.channel,
        code,
        message: error?.message || String(error)
      });
      if (failureResult.retryScheduled) diagnostics.retriedCount += 1;
      else if (failureResult.status === 'dead_letter') diagnostics.deadLetterCount += 1;
      else diagnostics.failedCount += 1;
      saveDB(db);
    }
  }

  // Release stale processing rows if no lock is present.
  const staleProcessingMs = Number.isFinite(Number(options.staleProcessingMs))
    ? Math.max(5 * 60 * 1000, Math.floor(Number(options.staleProcessingMs)))
    : DEFAULT_STALE_PROCESSING_MS;
  const staleCutoffTs = Date.parse(nowIso) - staleProcessingMs;
  for (const row of db.newsNotificationOutbox) {
    if (row.status !== 'processing') continue;
    const claimedAtTs = Date.parse(row.claimedAt || 0);
    const lastAttemptTs = Date.parse(row.lastAttemptAt || 0);
    if (!Number.isFinite(claimedAtTs) || claimedAtTs >= staleCutoffTs) continue;
    if (Number.isFinite(lastAttemptTs) && lastAttemptTs >= staleCutoffTs) continue;
    row.status = 'pending';
    row.claimedAt = null;
    row.claimedBy = null;
    row.claimToken = null;
    row.nextAttemptAt = new Date().toISOString();
    row.updatedAt = new Date().toISOString();
    diagnostics.processingReleasedCount += 1;
  }

  saveDB(db);

  diagnostics.finishedAt = new Date().toISOString();
  diagnostics.elapsedMs = Date.now() - startedAt;
  diagnostics.success = diagnostics.errors.length === 0;

  logger.info('[NewsOutboxProcessor] run end.', {
    elapsedMs: diagnostics.elapsedMs,
    claimedCount: diagnostics.claimedCount,
    sentCount: diagnostics.sentCount,
    failedCount: diagnostics.failedCount,
    retriedCount: diagnostics.retriedCount,
    deadLetterCount: diagnostics.deadLetterCount,
    countsByChannel: diagnostics.countsByChannel,
    errorCount: diagnostics.errors.length
  });

  return diagnostics;
}

module.exports = {
  runNewsNotificationOutboxProcessor,
  processOutboxItem,
  claimPendingOutboxItems,
  finalizeOutboxItemSuccess,
  finalizeOutboxItemFailure,
  shouldRetryOutboxItem,
  normalizeOutboxItem,
  calculateBackoffMs
};
