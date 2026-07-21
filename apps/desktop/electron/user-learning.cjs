const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown';
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeText(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).join(', ');
  }
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if ('value' in value) return normalizeText(value.value);
    if ('text' in value) return normalizeText(value.text);
    if ('name' in value) return normalizeText(value.name);
    if ('title' in value) return normalizeText(value.title);
    if ('label' in value) return normalizeText(value.label);
    return '';
  }
  return String(value).trim();
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => normalizeText(value)).filter(Boolean))];
}

function extractEntryText(entry) {
  const raw = parseMaybeJson(entry?.entry_value);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return normalizeText(raw.value ?? raw.text ?? raw.name ?? raw.title ?? raw.label ?? raw);
  }
  return normalizeText(raw);
}

function clampScore(value) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

async function ensureDefaultUserProfile(supabaseClient) {
  if (!supabaseClient) return null;
  try {
    await supabaseClient
      .from('user_profile')
      .upsert({ id: DEFAULT_USER_ID }, { onConflict: 'id' });

    const { data, error } = await supabaseClient
      .from('user_profile')
      .select('*')
      .eq('id', DEFAULT_USER_ID)
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[Learning] ensureDefaultUserProfile failed:', err.message);
    return null;
  }
}

async function upsertStrategyPattern(supabaseClient, patternName, payload) {
  const { data: existingRows, error: selectError } = await supabaseClient
    .from('strategy_patterns')
    .select('*')
    .eq('name', patternName)
    .limit(1);
  if (selectError) throw selectError;

  const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;
  if (existing) {
    const { data, error } = await supabaseClient
      .from('strategy_patterns')
      .update({
        description: payload.description,
        success_count: payload.success_count,
        fail_count: payload.fail_count,
        avg_profit: payload.avg_profit,
        confidence: payload.confidence,
        status: payload.status,
        tags: payload.tags,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabaseClient
    .from('strategy_patterns')
    .insert({
      name: patternName,
      description: payload.description,
      success_count: payload.success_count,
      fail_count: payload.fail_count,
      avg_profit: payload.avg_profit,
      confidence: payload.confidence,
      status: payload.status,
      tags: payload.tags,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function consolidateUserLearning(supabaseClient, options = {}) {
  if (!supabaseClient) return { updated: false, message: 'DB not connected' };

  const profile = await ensureDefaultUserProfile(supabaseClient);
  if (!profile) return { updated: false, message: 'Profile unavailable' };

  const [entriesRes, feedbackRes, patternsRes] = await Promise.allSettled([
    supabaseClient
      .from('user_index_entries')
      .select('entry_type, entry_key, entry_value, confidence, source, created_at')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseClient
      .from('recommendation_feedback')
      .select('outcome, actual_profit, notes, recommendations(*, opportunities(*))')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false })
      .limit(120),
    supabaseClient
      .from('strategy_patterns')
      .select('id, name, description, success_count, fail_count, avg_profit, confidence, status, tags, strategy_weights(*)')
      .order('confidence', { ascending: false })
      .limit(50),
  ]);

  const entries = entriesRes.status === 'fulfilled' ? (entriesRes.value.data || []) : [];
  const feedbacksRaw = feedbackRes.status === 'fulfilled' ? (feedbackRes.value.data || []) : [];
  const existingPatterns = patternsRes.status === 'fulfilled' ? (patternsRes.value.data || []) : [];

  const feedbacks = feedbacksRaw.map((feedback) => ({
    ...feedback,
    category: feedback.recommendations?.opportunities?.category || 'diger',
    source: feedback.recommendations?.opportunities?.source || 'unknown',
  }));

  const positiveFeedbacks = feedbacks.filter((feedback) => feedback.outcome === 'profit');
  const negativeFeedbacks = feedbacks.filter((feedback) => feedback.outcome === 'loss');
  const neutralFeedbacks = feedbacks.filter((feedback) => feedback.outcome === 'neutral' || feedback.outcome === 'skipped');
  const consideredFeedbacks = positiveFeedbacks.length + negativeFeedbacks.length + neutralFeedbacks.length;
  const totalProfit = positiveFeedbacks.reduce((sum, feedback) => sum + (feedback.actual_profit || 0), 0);
  const totalLoss = negativeFeedbacks.reduce((sum, feedback) => sum + Math.abs(feedback.actual_profit || 0), 0);
  const profitRate = consideredFeedbacks > 0 ? positiveFeedbacks.length / Math.max(1, positiveFeedbacks.length + negativeFeedbacks.length) : 0;

  const existingDomains = Array.isArray(profile.preferred_domains) ? profile.preferred_domains : [];
  const interestTerms = entries
    .filter((entry) => ['interest', 'preference'].includes(String(entry.entry_type || '').toLowerCase()))
    .map(extractEntryText)
    .filter(Boolean);
  const experienceTerms = entries
    .filter((entry) => ['experience', 'location', 'constraint'].includes(String(entry.entry_type || '').toLowerCase()))
    .map((entry) => `${entry.entry_key}:${extractEntryText(entry)}`)
    .filter(Boolean);

  const preferredDomains = uniqueStrings([
    ...existingDomains,
    ...interestTerms,
  ]).slice(0, 12);

  const activePatternNames = existingPatterns
    .filter((pattern) => String(pattern.status || '').toLowerCase() === 'active' && (pattern.confidence || 0) >= 0.5)
    .map((pattern) => pattern.name);

  const blockedPatternNames = uniqueStrings([
    ...existingPatterns
      .filter((pattern) => String(pattern.status || '').toLowerCase() === 'weakened')
      .map((pattern) => pattern.name),
    ...negativeFeedbacks
      .map((feedback) => feedback.category ? `category_${slugify(feedback.category)}` : '')
      .filter(Boolean),
  ]).slice(0, 20);

  const keyCounts = new Map();
  for (const entry of entries) {
    const key = normalizeText(entry.entry_key || entry.entry_type || 'unknown');
    if (!key) continue;
    const item = keyCounts.get(key) || { count: 0, confidenceSum: 0, sample: '', types: new Set() };
    item.count += 1;
    item.confidenceSum += Number(entry.confidence || 0.5);
    item.sample = item.sample || extractEntryText(entry);
    item.types.add(String(entry.entry_type || 'unknown'));
    keyCounts.set(key, item);
  }

  const rankedSignals = [...keyCounts.entries()]
    .map(([key, item]) => ({
      key,
      count: item.count,
      averageConfidence: item.count > 0 ? item.confidenceSum / item.count : 0.5,
      sample: item.sample,
      types: [...item.types],
    }))
    .sort((a, b) => b.count - a.count || b.averageConfidence - a.averageConfidence)
    .slice(0, 5);

  const signalPatternNames = [];
  for (const signal of rankedSignals) {
    const patternName = `user_signal_${slugify(signal.key)}`;
    const pattern = await upsertStrategyPattern(supabaseClient, patternName, {
      description: `Kullanıcı sinyali: ${signal.key}${signal.sample ? ` - ${signal.sample}` : ''}`,
      success_count: signal.count,
      fail_count: 0,
      avg_profit: 0,
      confidence: Math.min(1, Math.max(0.2, signal.averageConfidence)),
      status: signal.count >= 1 ? 'active' : 'on-hold',
      tags: ['user', 'signal', ...signal.types.map(slugify).slice(0, 3)],
    });
    signalPatternNames.push(pattern.name);

    await supabaseClient
      .from('strategy_weights')
      .insert({
        pattern_id: pattern.id,
        weight: Math.round(Math.min(1, Math.max(-1, signal.averageConfidence * 2 - 1)) * 100) / 100,
        reason: `Learning consolidation (${options.source || 'manual'})`,
      })
      .then(null, () => {});
  }

  const entryBreadth = Math.min(1, entries.length / 40);
  const feedbackCoverage = Math.min(1, consideredFeedbacks / 12);
  const feedbackQuality = consideredFeedbacks > 0
    ? Math.max(0, Math.min(1, (positiveFeedbacks.length + neutralFeedbacks.length * 0.5) / consideredFeedbacks))
    : 0.15;
  const signalDepth = Math.min(1, rankedSignals.length / 5);
  const patternMaturity = Math.min(1, (activePatternNames.length + signalPatternNames.length) / 10);
  const stability = Math.max(0, 1 - (negativeFeedbacks.length / Math.max(1, consideredFeedbacks)));
  const profileCompleteness = [
    preferredDomains.length > 0,
    activePatternNames.length > 0,
    consideredFeedbacks > 0,
    entries.length > 0,
  ].filter(Boolean).length / 4;

  const learningScore = clampScore(
    12
    + (entryBreadth * 20)
    + (feedbackCoverage * 15)
    + (feedbackQuality * 20)
    + (signalDepth * 10)
    + (patternMaturity * 15)
    + (stability * 8)
    + (profileCompleteness * 10)
  );

  let riskTolerance = profile.risk_tolerance || 'medium';
  if (consideredFeedbacks >= 3) {
    if (profitRate >= 0.7 && negativeFeedbacks.length <= 1) riskTolerance = 'high';
    else if (profitRate <= 0.45 || negativeFeedbacks.length > positiveFeedbacks.length) riskTolerance = 'low';
    else riskTolerance = 'medium';
  }

  const decisionSpeed = learningScore >= 55 ? 'fast' : 'slow';
  const successfulPatterns = uniqueStrings([
    ...(Array.isArray(profile.successful_patterns) ? profile.successful_patterns : []),
    ...activePatternNames,
    ...signalPatternNames,
  ]).slice(0, 20);

  const mergedBlocks = uniqueStrings([
    ...(Array.isArray(profile.blocked_patterns) ? profile.blocked_patterns : []),
    ...blockedPatternNames,
  ]).slice(0, 20);

  const profilePatch = {
    preferred_domains: preferredDomains,
    successful_patterns: successfulPatterns,
    blocked_patterns: mergedBlocks,
    risk_tolerance: riskTolerance,
    decision_speed: decisionSpeed,
    total_profit: totalProfit,
    total_loss: totalLoss,
    transaction_count: consideredFeedbacks,
    learning_score: learningScore,
    updated_at: new Date().toISOString(),
  };

  const { error: profileUpdateError } = await supabaseClient
    .from('user_profile')
    .update(profilePatch)
    .eq('id', DEFAULT_USER_ID);
  if (profileUpdateError) throw profileUpdateError;

  const summary = {
    source: options.source || 'manual',
    learningScore,
    profileCompleteness: Math.round(profileCompleteness * 100),
    feedbackQuality: Math.round(feedbackQuality * 100),
    riskTolerance,
    decisionSpeed,
    totalProfit,
    totalLoss,
    preferredDomains,
    topSignals: rankedSignals.map((signal) => ({ key: signal.key, count: signal.count, sample: signal.sample })),
    positiveFeedbacks: positiveFeedbacks.length,
    negativeFeedbacks: negativeFeedbacks.length,
    neutralFeedbacks: neutralFeedbacks.length,
  };

  await supabaseClient.from('profile_events').insert({
    user_id: DEFAULT_USER_ID,
    event_type: 'learning_consolidation',
    event_data: summary,
  }).then(null, () => {});

  return {
    updated: true,
    profilePatch,
    summary,
  };
}

module.exports = {
  DEFAULT_USER_ID,
  ensureDefaultUserProfile,
  consolidateUserLearning,
  slugify,
  normalizeText,
  extractEntryText,
};
