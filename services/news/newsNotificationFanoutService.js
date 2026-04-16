const { isScheduledSignal, isPublishedSignal } = require('./newsEventService');
const { NEWS_DELIVERY_CHANNELS } = require('./newsNotificationDispatchService');
const { scoreNewsEvent, getRankingModeProfile } = require('./newsRankingService');
const { getUserTickerUniverse } = require('./newsUserRelevanceService');

const WINDOW_KEY_IMMEDIATE = 'immediate';
const WINDOW_KEY_ONE_DAY_BEFORE = 'one_day_before';
const WINDOW_KEY_ONE_HOUR_BEFORE = 'one_hour_before';
const WINDOW_KEY_FIFTEEN_MINUTES_BEFORE = 'fifteen_minutes_before';
const WINDOW_KEY_DAILY_DIGEST = 'daily_digest';

const DELIVERY_WINDOW_DEFINITIONS = Object.freeze({
  [WINDOW_KEY_IMMEDIATE]: { preferenceField: 'notifyImmediate', offsetMs: 0 },
  [WINDOW_KEY_ONE_DAY_BEFORE]: { preferenceField: 'notifyOneDayBefore', offsetMs: 24 * 60 * 60 * 1000 },
  [WINDOW_KEY_ONE_HOUR_BEFORE]: { preferenceField: 'notifyOneHourBefore', offsetMs: 60 * 60 * 1000 },
  [WINDOW_KEY_FIFTEEN_MINUTES_BEFORE]: { preferenceField: 'notifyFifteenMinutesBefore', offsetMs: 15 * 60 * 1000 },
  [WINDOW_KEY_DAILY_DIGEST]: { preferenceField: 'dailyDigestEnabled', offsetMs: null }
});

function normalizeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getWindowGraceMs(now, options = {}) {
  const configured = Number(options.windowGraceMs);
  if (Number.isFinite(configured) && configured >= 60 * 1000) return Math.floor(configured);
  const poll = Number(options.pollIntervalMs);
  if (Number.isFinite(poll) && poll >= 60 * 1000) return Math.max(5 * 60 * 1000, Math.floor(poll * 2));
  return 10 * 60 * 1000;
}

function isWithinWindow(nowTs, targetTs, graceMs) {
  return nowTs >= targetTs && nowTs < (targetTs + graceMs);
}

function resolveDigestSchedule(now, userPreferences) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowTs = nowDate.getTime();
  if (!Number.isFinite(nowTs)) return null;
  const digestTime = String(userPreferences?.digestTime || process.env.NEWS_DAILY_DIGEST_TIME_UTC || '16:00').trim();
  const parts = digestTime.split(':').map(Number);
  const digestHour = Number.isFinite(parts[0]) ? Math.min(Math.max(parts[0], 0), 23) : 16;
  const digestMinute = Number.isFinite(parts[1]) ? Math.min(Math.max(parts[1], 0), 59) : 0;
  const slot = new Date(Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate(),
    digestHour,
    digestMinute,
    0,
    0
  ));
  return {
    digestSlotStartedAt: slot.toISOString(),
    digestWindowKey: `${WINDOW_KEY_DAILY_DIGEST}:${slot.toISOString().slice(0, 10)}`
  };
}

function getDueDeliveryWindowsForEvent(event, now, userPreferences, options = {}) {
  const nowIso = normalizeIsoDate(now) || new Date().toISOString();
  const nowTs = Date.parse(nowIso);
  if (!event || event.isActive === false || !Number.isFinite(nowTs)) return [];

  const graceMs = getWindowGraceMs(now, options);
  const due = [];
  const scheduledAt = normalizeIsoDate(event.scheduledAt);
  const publishedAt = normalizeIsoDate(event.publishedAt);

  if (scheduledAt && isScheduledSignal(event.sourceType, event.eventType)) {
    const scheduledTs = Date.parse(scheduledAt);
    const advanceWindows = [
      WINDOW_KEY_ONE_DAY_BEFORE,
      WINDOW_KEY_ONE_HOUR_BEFORE,
      WINDOW_KEY_FIFTEEN_MINUTES_BEFORE,
      WINDOW_KEY_IMMEDIATE
    ];
    for (const key of advanceWindows) {
      const definition = DELIVERY_WINDOW_DEFINITIONS[key];
      if (!userPreferences?.[definition.preferenceField]) continue;
      const targetTs = scheduledTs - (definition.offsetMs || 0);
      if (!isWithinWindow(nowTs, targetTs, graceMs)) continue;
      due.push({
        key,
        dueAt: new Date(targetTs).toISOString(),
        dueStartAt: new Date(targetTs).toISOString(),
        dueEndAt: new Date(targetTs + graceMs).toISOString()
      });
    }
  }

  if (publishedAt && isPublishedSignal(event.sourceType, event.eventType) && userPreferences?.notifyImmediate) {
    const publishedTs = Date.parse(publishedAt);
    if (isWithinWindow(nowTs, publishedTs, graceMs)) {
      due.push({
        key: WINDOW_KEY_IMMEDIATE,
        dueAt: publishedAt,
        dueStartAt: publishedAt,
        dueEndAt: new Date(publishedTs + graceMs).toISOString()
      });
    }
  }

  if (userPreferences?.dailyDigestEnabled) {
    const digest = resolveDigestSchedule(now, userPreferences);
    if (digest) {
      due.push({
        key: WINDOW_KEY_DAILY_DIGEST,
        dueAt: digest.digestSlotStartedAt,
        dueStartAt: digest.digestSlotStartedAt,
        dueEndAt: new Date(Date.parse(digest.digestSlotStartedAt) + graceMs).toISOString(),
        digestWindowKey: digest.digestWindowKey
      });
    }
  }

  return due;
}

function eventTypeEnabledByPreference(preferences, event) {
  if (!event) return false;
  switch (event.eventType) {
    case 'fomc':
    case 'cpi':
    case 'rate_decision':
      return !!preferences.macroEnabled;
    case 'earnings':
      return !!preferences.earningsEnabled;
    case 'stock_news':
      return !!preferences.stockNewsEnabled;
    case 'world_news':
      return !!preferences.worldNewsEnabled;
    case 'internal_post':
      return !!preferences.internalPostsEnabled;
    default:
      return true;
  }
}

function isNowWithinQuietHours(preferences, now) {
  const start = String(preferences?.quietHoursStart || '').trim();
  const end = String(preferences?.quietHoursEnd || '').trim();
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return false;

  const nowDate = now instanceof Date ? now : new Date(now);
  const minutes = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
  const [startHours, startMinutes] = start.split(':').map(Number);
  const [endHours, endMinutes] = end.split(':').map(Number);
  const startTotal = startHours * 60 + startMinutes;
  const endTotal = endHours * 60 + endMinutes;

  if (startTotal === endTotal) return false;
  if (startTotal < endTotal) return minutes >= startTotal && minutes < endTotal;
  return minutes >= startTotal || minutes < endTotal;
}

function shouldDeliverEventToUser({
  userId,
  event,
  preferences,
  now,
  deliveryWindow,
  shouldNotifyUserForEvent,
  isEventRelevantToUser,
  userTickerUniverse,
  sourceProfiles = []
}) {
  if (!userId || !event || !preferences || !deliveryWindow) {
    return { allowed: false, reason: 'invalid_arguments' };
  }
  if (event.isActive === false) return { allowed: false, reason: 'inactive_event' };
  if (!eventTypeEnabledByPreference(preferences, event)) return { allowed: false, reason: 'event_type_disabled' };
  if (preferences.highImportanceOnly && Number(event.importance || 0) < 80) return { allowed: false, reason: 'high_importance_only' };

  const windowKey = String(deliveryWindow.key || '');
  if (windowKey !== WINDOW_KEY_DAILY_DIGEST && isNowWithinQuietHours(preferences, now)) {
    return { allowed: false, reason: 'quiet_hours' };
  }

  if (windowKey === WINDOW_KEY_IMMEDIATE && (event.eventType === 'stock_news' || event.eventType === 'world_news')) {
    const profile = getRankingModeProfile(preferences?.rankingMode);
    const configuredThreshold = Number.isFinite(Number(process.env.NEWS_NOTIFICATION_HEADLINE_MIN_SCORE))
      ? Number(process.env.NEWS_NOTIFICATION_HEADLINE_MIN_SCORE)
      : profile.thresholds.notificationHeadlineMinScore;
    const threshold = Math.max(profile.thresholds.notificationHeadlineMinScore, configuredThreshold);
    const isRelevant = typeof isEventRelevantToUser === 'function' ? !!isEventRelevantToUser(event, userId) : false;
    const score = scoreNewsEvent(event, {
      userId,
      now,
      rankingMode: preferences?.rankingMode,
      userTickerUniverse,
      isPortfolioRelevant: isRelevant,
      sourceProfiles
    });
    if (score.totalScore < threshold) return { allowed: false, reason: 'headline_ranking_threshold' };
  }

  if ((preferences.portfolioOnly || preferences.watchlistOnly) && typeof isEventRelevantToUser === 'function') {
    const relevant = isEventRelevantToUser(event, userId);
    if (!relevant) return { allowed: false, reason: 'portfolio_only_blocked' };
  }

  if (typeof shouldNotifyUserForEvent === 'function') {
    const sourceOfTruthPass = shouldNotifyUserForEvent(userId, event);
    if (!sourceOfTruthPass) return { allowed: false, reason: 'source_of_truth_blocked' };
  }

  if (windowKey === WINDOW_KEY_DAILY_DIGEST) {
    return { allowed: !!preferences.dailyDigestEnabled, reason: preferences.dailyDigestEnabled ? 'digest_due' : 'digest_disabled' };
  }

  const prefField = DELIVERY_WINDOW_DEFINITIONS[windowKey]?.preferenceField;
  if (prefField && !preferences[prefField]) {
    return { allowed: false, reason: 'delivery_window_disabled' };
  }

  return { allowed: true, reason: 'eligible' };
}

function buildDeliveryLogKeyFields({ userId, event, channel, deliveryWindow }) {
  const eventId = String(event?.id || '').trim();
  const windowKey = String(deliveryWindow?.digestWindowKey || deliveryWindow?.key || '').trim();
  return {
    userId: String(userId || '').trim(),
    newsEventId: eventId,
    deliveryChannel: String(channel || '').trim(),
    deliveryWindowKey: windowKey
  };
}

function buildChannelPayload({ userId, event, channel, deliveryWindow, context = {} }) {
  const title = String(event?.title || 'Market update').trim() || 'Market update';
  const body = String(event?.summary || event?.body || '').trim() || 'New market event available.';
  const deepLinkUrl = buildNewsNotificationDeepLink({ event, deliveryWindow, context });

  return {
    userId,
    eventId: String(event?.id || ''),
    channel,
    title,
    body,
    summary: body,
    deepLinkUrl,
    deliveryWindow: String(deliveryWindow?.key || ''),
    deliveryWindowKey: String(deliveryWindow?.digestWindowKey || deliveryWindow?.key || ''),
    eventType: event?.eventType || null,
    sourceType: event?.sourceType || null,
    metadata: {
      importance: Number(event?.importance || 0),
      ticker: event?.canonicalTicker || event?.ticker || null,
      scheduledAt: event?.scheduledAt || null,
      publishedAt: event?.publishedAt || null,
      ...context
    }
  };
}

function buildNewsNotificationDeepLink({ event, deliveryWindow, context = {} }) {
  const eventId = String(event?.id || '');
  const windowKey = String(deliveryWindow?.key || '');
  const isDigest = !!context?.digest || windowKey === WINDOW_KEY_DAILY_DIGEST || String(eventId).startsWith('digest:');
  const sourceType = String(event?.sourceType || '').toLowerCase();
  const eventType = String(event?.eventType || '').toLowerCase();
  const userScope = context?.audienceScope === 'portfolio' || context?.portfolioOnly === true;

  let tab = 'news';
  if (isDigest) {
    tab = 'for-you';
  } else if (eventType === 'earnings' || userScope) {
    tab = 'for-you';
  } else if (sourceType === 'macro' || eventType === 'fomc' || eventType === 'cpi' || isScheduledSignal(event?.sourceType, event?.eventType)) {
    tab = 'calendar';
  }

  const params = new URLSearchParams();
  params.set('tab', tab);
  if (eventId) params.set('eventId', eventId);
  if (isDigest && context?.digestWindowKey) params.set('digestWindowKey', String(context.digestWindowKey));
  return `/news.html?${params.toString()}`;
}

function selectChannelsFromPreferences(preferences) {
  const channels = [];
  if (preferences?.notifyInApp) channels.push('in_app');
  if (preferences?.notifyPush) channels.push('push');
  if (preferences?.notifyEmail) channels.push('email');
  return channels.filter((channel) => NEWS_DELIVERY_CHANNELS.includes(channel));
}

function computeCandidateScanBounds(nowIso, options = {}) {
  const nowTs = Date.parse(nowIso);
  const graceMs = getWindowGraceMs(nowIso, options);
  const maxAdvanceMs = 24 * 60 * 60 * 1000;
  const scheduledBackfillMs = Number(options.scheduledBackfillMs) || (90 * 60 * 1000);
  const publishedLookbackMs = Number(options.publishedLookbackMs) || (2 * 60 * 60 * 1000);
  const digestLookbackMs = Number(options.digestLookbackMs) || (24 * 60 * 60 * 1000);
  return {
    graceMs,
    scheduled: {
      from: new Date(nowTs - scheduledBackfillMs).toISOString(),
      to: new Date(nowTs + maxAdvanceMs + graceMs).toISOString()
    },
    published: {
      from: new Date(nowTs - publishedLookbackMs).toISOString(),
      to: nowIso
    },
    digest: {
      from: new Date(nowTs - digestLookbackMs).toISOString(),
      to: nowIso
    }
  };
}

async function runNewsNotificationFanout(options = {}) {
  const {
    loadDB,
    saveDB,
    ensureNewsEventTables,
    getUserNewsPreferences,
    shouldNotifyUserForEvent,
    isEventRelevantToUser,
    resolveUserTickerUniverse = () => new Set(),
    resolveUserWatchlistTickerUniverse = () => new Set(),
    listNewsSourceProfiles = () => [],
    appendUserEventDeliveryLog,
    dispatchChannelPayload,
    logger = console,
    now = new Date().toISOString()
  } = options;

  if (typeof loadDB !== 'function' || typeof saveDB !== 'function' || typeof ensureNewsEventTables !== 'function') {
    throw new Error('runNewsNotificationFanout requires loadDB/saveDB/ensureNewsEventTables');
  }
  if (typeof getUserNewsPreferences !== 'function' || typeof appendUserEventDeliveryLog !== 'function') {
    throw new Error('runNewsNotificationFanout requires preference resolver and delivery log appender');
  }

  const startedAt = Date.now();
  const nowIso = normalizeIsoDate(now) || new Date().toISOString();
  const bounds = computeCandidateScanBounds(nowIso, options);

  const db = loadDB();
  ensureNewsEventTables(db);
  const activeEvents = Array.isArray(db.newsEvents) ? db.newsEvents.filter((event) => event?.isActive !== false) : [];

  const scheduledCandidates = activeEvents.filter((event) => {
    if (!isScheduledSignal(event.sourceType, event.eventType)) return false;
    const at = normalizeIsoDate(event.scheduledAt);
    return !!at && at >= bounds.scheduled.from && at <= bounds.scheduled.to;
  });
  const publishedCandidates = activeEvents.filter((event) => {
    if (!isPublishedSignal(event.sourceType, event.eventType)) return false;
    const at = normalizeIsoDate(event.publishedAt);
    return !!at && at >= bounds.published.from && at <= bounds.published.to;
  });
  const digestCandidates = activeEvents.filter((event) => {
    const compareAt = normalizeIsoDate(event.publishedAt || event.scheduledAt);
    return !!compareAt && compareAt >= bounds.digest.from && compareAt <= bounds.digest.to;
  });

  const candidateMap = new Map();
  for (const event of [...scheduledCandidates, ...publishedCandidates]) {
    candidateMap.set(event.id, event);
  }
  const candidates = Array.from(candidateMap.values());

  const users = Object.keys(db.users || {});
  const diagnostics = {
    success: true,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    now: nowIso,
    elapsedMs: 0,
    scanBounds: bounds,
    candidateCounts: {
      scheduled: scheduledCandidates.length,
      published: publishedCandidates.length,
      digest: digestCandidates.length,
      total: candidates.length
    },
    usersEvaluated: users.length,
    eligibility: {
      allowed: 0,
      blocked: 0,
      reasons: {},
      byMode: {}
    },
    deliveryLog: {
      inserted: 0,
      deduped: 0,
      invalid: 0
    },
    dispatchTotalsByChannel: {
      in_app: 0,
      push: 0,
      email: 0
    },
    dispatchErrorsByChannel: {
      in_app: 0,
      push: 0,
      email: 0
    },
    totalsByDeliveryWindow: {
      [WINDOW_KEY_IMMEDIATE]: 0,
      [WINDOW_KEY_ONE_DAY_BEFORE]: 0,
      [WINDOW_KEY_ONE_HOUR_BEFORE]: 0,
      [WINDOW_KEY_FIFTEEN_MINUTES_BEFORE]: 0,
      [WINDOW_KEY_DAILY_DIGEST]: 0
    },
    digest: {
      usersDue: 0,
      eventsAggregated: 0,
      batchesDispatched: 0
    },
    deepLinkTabs: {
      'for-you': 0,
      calendar: 0,
      news: 0
    },
    errors: []
  };

  const digestGroups = new Map();
  const sourceProfiles = listNewsSourceProfiles();

  for (const userId of users) {
    const preferences = getUserNewsPreferences(userId);
    const rankingMode = String(preferences?.rankingMode || 'balanced');
    diagnostics.eligibility.byMode[rankingMode] ||= { allowed: 0, blocked: 0, reasons: {} };
    const channels = selectChannelsFromPreferences(preferences);
    const hasDigest = !!preferences.dailyDigestEnabled;
    const userTickerUniverse = getUserTickerUniverse(userId, {
      resolvePortfolioTickerUniverse: resolveUserTickerUniverse,
      resolveWatchlistTickerUniverse: resolveUserWatchlistTickerUniverse
    });

    for (const event of candidates) {
      const dueWindows = getDueDeliveryWindowsForEvent(event, nowIso, preferences, options)
        .filter((window) => window.key !== WINDOW_KEY_DAILY_DIGEST);
      for (const deliveryWindow of dueWindows) {
        const decision = shouldDeliverEventToUser({
          userId,
          event,
          preferences,
          now: nowIso,
          deliveryWindow,
          shouldNotifyUserForEvent,
          isEventRelevantToUser,
          userTickerUniverse,
          sourceProfiles
        });

        if (!decision.allowed) {
          diagnostics.eligibility.blocked += 1;
          diagnostics.eligibility.reasons[decision.reason] = (diagnostics.eligibility.reasons[decision.reason] || 0) + 1;
          diagnostics.eligibility.byMode[rankingMode].blocked += 1;
          diagnostics.eligibility.byMode[rankingMode].reasons[decision.reason] = (diagnostics.eligibility.byMode[rankingMode].reasons[decision.reason] || 0) + 1;
          continue;
        }

        diagnostics.eligibility.allowed += 1;
        diagnostics.eligibility.byMode[rankingMode].allowed += 1;
        diagnostics.totalsByDeliveryWindow[deliveryWindow.key] += 1;

        for (const channel of channels) {
          const keyFields = buildDeliveryLogKeyFields({ userId, event, channel, deliveryWindow });
          const logResult = appendUserEventDeliveryLog(db, {
            ...keyFields,
            deliveryReason: `news_fanout:${deliveryWindow.key}`,
            deliveredAt: nowIso
          });

          if (!logResult?.inserted) {
            if (logResult?.reason === 'duplicate') diagnostics.deliveryLog.deduped += 1;
            else diagnostics.deliveryLog.invalid += 1;
            continue;
          }

          diagnostics.deliveryLog.inserted += 1;
          const payload = buildChannelPayload({
            userId,
            event,
            channel,
            deliveryWindow,
            context: { dedupeKey: keyFields.deliveryWindowKey }
          });
          const deepLinkTab = new URLSearchParams(String(payload.deepLinkUrl || '').split('?')[1] || '').get('tab');
          if (deepLinkTab && diagnostics.deepLinkTabs[deepLinkTab] !== undefined) {
            diagnostics.deepLinkTabs[deepLinkTab] += 1;
          }

          try {
            if (typeof dispatchChannelPayload === 'function') {
              await dispatchChannelPayload(payload);
            }
            diagnostics.dispatchTotalsByChannel[channel] += 1;
          } catch (error) {
            diagnostics.dispatchErrorsByChannel[channel] += 1;
            diagnostics.errors.push({
              stage: 'dispatch',
              channel,
              userId,
              eventId: event.id,
              error: error?.message || String(error)
            });
          }
        }
      }
    }

    if (!hasDigest) continue;

    const digestProbe = resolveDigestSchedule(nowIso, preferences);
    if (!digestProbe) continue;
    const digestWindow = {
      key: WINDOW_KEY_DAILY_DIGEST,
      dueAt: digestProbe.digestSlotStartedAt,
      digestWindowKey: digestProbe.digestWindowKey
    };
    if (!isWithinWindow(Date.parse(nowIso), Date.parse(digestProbe.digestSlotStartedAt), bounds.graceMs)) continue;

    diagnostics.digest.usersDue += 1;
    const digestItems = digestCandidates.filter((event) => {
      const decision = shouldDeliverEventToUser({
        userId,
        event,
        preferences,
        now: nowIso,
        deliveryWindow: digestWindow,
        shouldNotifyUserForEvent,
          isEventRelevantToUser
          ,
          userTickerUniverse,
          sourceProfiles
        });
      if (!decision.allowed) return false;
      const alreadyDeliveredIndividually = (db.userEventDeliveryLog || []).some((row) => row.userId === userId
        && row.newsEventId === event.id
        && row.deliveryWindowKey !== digestWindow.digestWindowKey);
      return !alreadyDeliveredIndividually;
    });

    if (!digestItems.length) continue;
    diagnostics.digest.eventsAggregated += digestItems.length;
    const groupKey = `${userId}:${digestWindow.digestWindowKey}`;
    digestGroups.set(groupKey, { userId, digestWindow, channels, preferences, items: digestItems });
  }

  for (const digest of digestGroups.values()) {
    const syntheticDigestEvent = {
      id: `digest:${digest.digestWindow.digestWindowKey}`,
      sourceType: 'news',
      eventType: 'internal_post',
      title: `Daily digest: ${digest.items.length} update${digest.items.length === 1 ? '' : 's'}`,
      summary: digest.items.slice(0, 3).map((event) => event.title).join(' • '),
      metadataJson: {
        digest: true,
        digestWindowKey: digest.digestWindow.digestWindowKey,
        itemIds: digest.items.map((event) => event.id)
      }
    };

    for (const channel of digest.channels) {
      const keyFields = buildDeliveryLogKeyFields({
        userId: digest.userId,
        event: syntheticDigestEvent,
        channel,
        deliveryWindow: digest.digestWindow
      });
      const logResult = appendUserEventDeliveryLog(db, {
        ...keyFields,
        deliveryReason: 'news_fanout:daily_digest',
        deliveredAt: nowIso
      });

      if (!logResult?.inserted) {
        if (logResult?.reason === 'duplicate') diagnostics.deliveryLog.deduped += 1;
        else diagnostics.deliveryLog.invalid += 1;
        continue;
      }

      diagnostics.deliveryLog.inserted += 1;
      diagnostics.totalsByDeliveryWindow[WINDOW_KEY_DAILY_DIGEST] += 1;
      diagnostics.digest.batchesDispatched += 1;

      const payload = buildChannelPayload({
        userId: digest.userId,
        event: syntheticDigestEvent,
        channel,
        deliveryWindow: digest.digestWindow,
        context: {
          digest: true,
          digestWindowKey: digest.digestWindow.digestWindowKey,
          itemCount: digest.items.length,
          itemIds: digest.items.map((event) => event.id)
        }
      });
      const deepLinkTab = new URLSearchParams(String(payload.deepLinkUrl || '').split('?')[1] || '').get('tab');
      if (deepLinkTab && diagnostics.deepLinkTabs[deepLinkTab] !== undefined) {
        diagnostics.deepLinkTabs[deepLinkTab] += 1;
      }

      try {
        if (typeof dispatchChannelPayload === 'function') {
          await dispatchChannelPayload(payload);
        }
        diagnostics.dispatchTotalsByChannel[channel] += 1;
      } catch (error) {
        diagnostics.dispatchErrorsByChannel[channel] += 1;
        diagnostics.errors.push({
          stage: 'digest_dispatch',
          channel,
          userId: digest.userId,
          error: error?.message || String(error)
        });
      }
    }
  }

  saveDB(db);

  diagnostics.finishedAt = new Date().toISOString();
  diagnostics.elapsedMs = Date.now() - startedAt;
  diagnostics.success = diagnostics.errors.length === 0;

  return diagnostics;
}

module.exports = {
  WINDOW_KEY_IMMEDIATE,
  WINDOW_KEY_ONE_DAY_BEFORE,
  WINDOW_KEY_ONE_HOUR_BEFORE,
  WINDOW_KEY_FIFTEEN_MINUTES_BEFORE,
  WINDOW_KEY_DAILY_DIGEST,
  DELIVERY_WINDOW_DEFINITIONS,
  runNewsNotificationFanout,
  getDueDeliveryWindowsForEvent,
  shouldDeliverEventToUser,
  buildDeliveryLogKeyFields,
  buildChannelPayload,
  buildNewsNotificationDeepLink
};
