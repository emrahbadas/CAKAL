import type { StrategyPattern, StrategyWeight } from '@cakal/shared-types';

/**
 * Strategy Manager
 *
 * Strateji ağırlıklarını yönetir:
 * - Başarılı pattern → güçlendir
 * - Başarısız pattern → zayıflat
 * - Belirsiz → beklemeye al
 */

export function updateStrategyWeight(
  current: StrategyWeight,
  outcome: 'success' | 'failure' | 'uncertain',
  magnitude = 0.1
): StrategyWeight {
  let newWeight = current.weight;
  let reason = current.reason;

  switch (outcome) {
    case 'success':
      newWeight = Math.min(1, current.weight + magnitude);
      reason = 'Son geri bildirimde başarılı sonuç';
      break;
    case 'failure':
      newWeight = Math.max(-1, current.weight - magnitude);
      reason = 'Son geri bildirimde başarısız sonuç';
      break;
    case 'uncertain':
      // No change, just note the uncertainty
      reason = 'Sonuç belirsiz — ağırlık değiştirilmedi';
      break;
  }

  return {
    ...current,
    weight: Math.round(newWeight * 100) / 100,
    reason,
    updatedAt: new Date().toISOString(),
  };
}

export function shouldSuggestPattern(pattern: StrategyPattern, weight: StrategyWeight): boolean {
  // Don't suggest patterns with negative weight
  if (weight.weight < 0) return false;

  // Don't suggest patterns with too few examples (avoid single-event noise)
  if (pattern.successCount + pattern.failCount < 3) return false;

  // Don't suggest on-hold patterns
  if (pattern.status === 'on-hold') return false;

  // Require minimum confidence
  if (pattern.confidence < 0.3) return false;

  return true;
}

export function determinePatternStatus(
  pattern: StrategyPattern
): StrategyPattern['status'] {
  const total = pattern.successCount + pattern.failCount;

  if (total < 3) return 'on-hold';
  if (pattern.confidence >= 0.6 && pattern.successCount > pattern.failCount) return 'active';
  if (pattern.failCount > pattern.successCount * 2) return 'weakened';

  return 'on-hold';
}
