import type { ScoringFactors, ScoringResult, Opportunity, UserProfile } from '@cakal/shared-types';

/**
 * Scoring Engine
 *
 * Fırsatları puanlar. Ağırlıklar:
 * - Kâr potansiyeli: %30
 * - Risk seviyesi: %20
 * - Aciliyet: %15
 * - Profil uyumu: %20
 * - Pattern güvenilirliği: %15
 */

const WEIGHTS = {
  profitPotential: 0.30,
  riskLevel: 0.20,
  urgency: 0.15,
  profileMatch: 0.20,
  patternConfidence: 0.15,
};

export function scoreOpportunity(
  rawFactors: Partial<ScoringFactors>,
  userProfile?: UserProfile
): ScoringResult {
  const factors: ScoringFactors = {
    profitPotential: rawFactors.profitPotential ?? 50,
    riskLevel: rawFactors.riskLevel ?? 50,
    urgency: rawFactors.urgency ?? 50,
    profileMatch: rawFactors.profileMatch ?? 50,
    patternConfidence: rawFactors.patternConfidence ?? 30,
  };

  // Adjust profile match if user profile is available
  if (userProfile) {
    // Risk adjustment: lower score if opportunity risk exceeds user tolerance
    const riskCap = userProfile.riskTolerance === 'low' ? 40 : userProfile.riskTolerance === 'medium' ? 70 : 100;
    if (factors.riskLevel > riskCap) {
      factors.profileMatch = Math.max(0, factors.profileMatch - 20);
    }
  }

  // Invert risk (lower risk = higher score contribution)
  const invertedRisk = 100 - factors.riskLevel;

  const totalScore = Math.round(
    factors.profitPotential * WEIGHTS.profitPotential +
    invertedRisk * WEIGHTS.riskLevel +
    factors.urgency * WEIGHTS.urgency +
    factors.profileMatch * WEIGHTS.profileMatch +
    factors.patternConfidence * WEIGHTS.patternConfidence
  );

  const explanation = buildExplanation(factors, totalScore);

  return { totalScore: Math.min(100, Math.max(0, totalScore)), factors, explanation };
}

function buildExplanation(factors: ScoringFactors, score: number): string {
  const parts: string[] = [];

  if (factors.profitPotential >= 70) parts.push('yüksek kâr potansiyeli');
  if (factors.riskLevel <= 30) parts.push('düşük risk');
  if (factors.urgency >= 70) parts.push('acil fırsat');
  if (factors.profileMatch >= 70) parts.push('profiline uygun');
  if (factors.patternConfidence >= 70) parts.push('güvenilir pattern');

  if (parts.length === 0) {
    return `Puan: ${score}. Ortalama bir fırsat.`;
  }

  return `Puan: ${score}. Nedenleri: ${parts.join(', ')}.`;
}

export function rankOpportunities(
  opportunities: Array<{ raw: Partial<ScoringFactors>; data: Partial<Opportunity> }>,
  userProfile?: UserProfile,
  limit = 5
): Array<{ data: Partial<Opportunity>; scoring: ScoringResult }> {
  return opportunities
    .map((opp) => ({
      data: opp.data,
      scoring: scoreOpportunity(opp.raw, userProfile),
    }))
    .sort((a, b) => b.scoring.totalScore - a.scoring.totalScore)
    .slice(0, limit);
}
