const DEFAULT_STATUS = {
  RESOLVED: 'resolved',
  AMBIGUOUS: 'ambiguous',
  UNRESOLVED: 'unresolved',
  MANUAL_OVERRIDE: 'manual_override'
};

const DEFAULT_SOURCES = {
  T212_METADATA_EXACT: 't212_metadata_exact',
  T212_METADATA_SCORED: 't212_metadata_scored',
  LOCAL_CACHE: 'local_cache',
  MANUAL_OVERRIDE: 'manual_override',
  FALLBACK_NAME_MATCH: 'fallback_name_match'
};

const NOISE_SUFFIXES = [
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'plc', 'ltd', 'limited', 'sa', 'nv', 'ag', 'holdings', 'holding'
];

function normalizeInstrumentName(raw) {
  if (!raw) return '';
  let value = String(raw).toLowerCase().trim();
  value = value.replace(/[’']/g, '');
  value = value.replace(/&/g, ' and ');
  value = value.replace(/[.,/#!$%^*;:{}=\\_`~()\[\]\-+|"?<>]/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  if (!value) return '';

  const tokens = value.split(' ');
  const preservedTail = [];
  while (tokens.length > 1) {
    const tail = tokens[tokens.length - 1];
    if (['class', 'adr', 'ord'].includes(tail)) {
      preservedTail.unshift(tokens.pop());
      continue;
    }
    if (/^[a-z]$/.test(tail) && tokens[tokens.length - 2] === 'class') {
      preservedTail.unshift(tokens.pop());
      continue;
    }
    break;
  }
  while (tokens.length > 1 && NOISE_SUFFIXES.includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return [...tokens, ...preservedTail].join(' ').trim();
}

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase();
}

function scoreInstrumentCandidate(raw = {}, candidate = {}, opts = {}) {
  const hints = opts.hints || {};
  let score = 0;
  const reasons = [];

  const rawName = normalizeInstrumentName(raw.rawName || raw.name || '');
  const candidateName = normalizeInstrumentName(candidate.name || candidate.displayName || '');
  if (rawName && candidateName && rawName === candidateName) {
    score += 0.45;
    reasons.push('exact_normalized_name');
  } else if (rawName && candidateName && (candidateName.includes(rawName) || rawName.includes(candidateName))) {
    score += 0.22;
    reasons.push('near_name');
  }

  const rawTicker = normalizeTicker(raw.rawTicker || raw.ticker || '');
  const candidateTicker = normalizeTicker(candidate.ticker || candidate.symbol || '');
  if (rawTicker && candidateTicker) {
    if (rawTicker === candidateTicker) {
      score += 0.24;
      reasons.push('exact_ticker');
    } else if (rawTicker.split('_')[0] === candidateTicker.split('_')[0]) {
      score += 0.14;
      reasons.push('ticker_prefix');
    }
  }

  const rawExchange = normalizeTicker(raw.rawExchange || raw.exchange || '');
  const candidateExchange = normalizeTicker(candidate.exchange || candidate.exchangeCode || candidate.mic || '');
  if (rawExchange && candidateExchange && rawExchange === candidateExchange) {
    score += 0.12;
    reasons.push('exchange_match');
  }

  const rawCurrency = normalizeTicker(raw.rawCurrency || raw.currency || '');
  const candidateCurrency = normalizeTicker(candidate.currency || candidate.quoteCurrency || '');
  if (rawCurrency && candidateCurrency && rawCurrency === candidateCurrency) {
    score += 0.08;
    reasons.push('currency_match');
  }

  const rawType = normalizeTicker(raw.rawInstrumentType || raw.instrumentType || '');
  const candidateType = normalizeTicker(candidate.instrumentType || candidate.type || '');
  if (rawType && candidateType && rawType === candidateType) {
    score += 0.06;
    reasons.push('instrument_type_match');
  }

  if (candidate.isActive !== false) {
    score += 0.03;
    reasons.push('active_listing');
  }

  if (hints.previousSuccess === true) {
    score += 0.04;
    reasons.push('history_boost');
  }

  const bounded = Math.max(0, Math.min(1, score));
  return { score: bounded, reasons };
}

function pickBestCandidate(raw, candidates = [], opts = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { best: null, runnerUp: null };
  }
  const ranked = candidates
    .map(candidate => ({
      candidate,
      ...scoreInstrumentCandidate(raw, candidate, opts)
    }))
    .sort((a, b) => b.score - a.score);

  return {
    best: ranked[0] || null,
    runnerUp: ranked[1] || null
  };
}

function evaluateScoredResolution(ranking = {}) {
  const best = ranking?.best || null;
  const runnerUp = ranking?.runnerUp || null;
  if (!best) {
    return {
      resolutionStatus: DEFAULT_STATUS.UNRESOLVED,
      confidenceScore: 0,
      acceptance: 'no_candidate'
    };
  }

  const reasons = Array.isArray(best.reasons) ? best.reasons : [];
  const score = Number(best.score || 0);
  const gap = runnerUp ? Math.abs(score - Number(runnerUp.score || 0)) : Infinity;
  const hasExactName = reasons.includes('exact_normalized_name');
  const hasNearName = reasons.includes('near_name');
  const hasExactTicker = reasons.includes('exact_ticker');
  const hasContext = reasons.includes('exchange_match') || reasons.includes('currency_match') || reasons.includes('instrument_type_match');
  const strongCombinedEvidence = hasExactName && (hasExactTicker || hasContext);
  const moderateCombinedEvidence = (hasExactName || hasNearName) && hasExactTicker && hasContext;

  if (gap < 0.1 && score < 0.96) {
    return {
      resolutionStatus: DEFAULT_STATUS.AMBIGUOUS,
      confidenceScore: score,
      acceptance: 'close_runner_up'
    };
  }
  if (score >= 0.92 && strongCombinedEvidence && gap >= 0.08) {
    return {
      resolutionStatus: DEFAULT_STATUS.RESOLVED,
      confidenceScore: score,
      acceptance: 'strong_combined_evidence'
    };
  }
  if (score >= 0.96 && moderateCombinedEvidence && gap >= 0.08) {
    return {
      resolutionStatus: DEFAULT_STATUS.RESOLVED,
      confidenceScore: score,
      acceptance: 'very_high_score_combined_evidence'
    };
  }
  if (gap < 0.14 && score >= 0.75) {
    return {
      resolutionStatus: DEFAULT_STATUS.AMBIGUOUS,
      confidenceScore: score,
      acceptance: 'high_ambiguity'
    };
  }
  return {
    resolutionStatus: DEFAULT_STATUS.UNRESOLVED,
    confidenceScore: score,
    acceptance: 'insufficient_evidence'
  };
}

function buildResolverResult({ mapping = null, canonical = null, confidenceScore = 0, resolutionStatus, resolutionSource, debug = {} }) {
  return {
    mapping,
    canonicalTicker: canonical?.ticker || '',
    canonicalName: canonical?.name || '',
    canonicalExchange: canonical?.exchange || '',
    canonicalMic: canonical?.mic || '',
    canonicalCurrency: canonical?.currency || '',
    confidenceScore,
    resolutionStatus,
    resolutionSource,
    requiresManualReview: resolutionStatus === DEFAULT_STATUS.AMBIGUOUS || resolutionStatus === DEFAULT_STATUS.UNRESOLVED,
    debug
  };
}

module.exports = {
  RESOLUTION_STATUS: DEFAULT_STATUS,
  RESOLUTION_SOURCE: DEFAULT_SOURCES,
  normalizeInstrumentName,
  normalizeTicker,
  scoreInstrumentCandidate,
  pickBestCandidate,
  evaluateScoredResolution,
  buildResolverResult
};
