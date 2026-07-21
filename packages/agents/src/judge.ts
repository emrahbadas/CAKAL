import type { AgentRunResult, ScoringFactors, ScoringResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Opportunity Judge — Fırsat Yargıcı
 *
 * Her fırsatı çok boyutlu puanlar: kâr, uygunluk, aciliyet, güven, risk.
 * Profili okuyarak fit skorunu kişiselleştirir.
 * Scoring Engine'i genişleterek bağlamsal ve kişisel puanlama yapar.
 */
export class OpportunityJudgeAgent extends BaseAgent {
  readonly name = 'judge' as const;
  readonly description = 'Fırsatları çok boyutlu puanlar, profil bazlı kişisel değerlendirme yapar';

  // Puanlama ağırlıkları
  private readonly weights = {
    profitPotential: 0.25,
    riskLevel: 0.20,
    urgency: 0.15,
    profileMatch: 0.20,
    patternConfidence: 0.10,
    sourceReliability: 0.10,
  };

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const action = input.data?.action as string;

      switch (action) {
        case 'judge_single':
          return this.judgeSingle(input, context, startTime);
        case 'judge_batch':
          return this.judgeBatch(input, context, startTime);
        case 'compare':
          return this.compare(input, context, startTime);
        case 'explain_score':
          return this.explainScore(input, startTime);
        default:
          return this.buildResult(true, {
            action: 'info',
            message: 'Opportunity Judge hazır. Desteklenen aksiyonlar: judge_single, judge_batch, compare, explain_score',
            weights: this.weights,
          }, startTime);
      }
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  /**
   * Tek bir fırsatı detaylı puanlar
   */
  private judgeSingle(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const opportunity = input.data?.opportunity as Record<string, unknown>;

    if (!opportunity) {
      return this.buildResult(false, null, startTime, 'Fırsat verisi gerekli');
    }

    const scoring = this.scoreOpportunity(opportunity, context);
    const verdict = this.getVerdict(scoring.totalScore);
    const actionAdvice = this.getActionAdvice(scoring, opportunity);

    return this.buildResult(true, {
      action: 'judgement',
      opportunity: {
        title: opportunity.title,
        category: opportunity.category,
        source: opportunity.source,
      },
      scoring,
      verdict,
      actionAdvice,
      redFlags: this.detectRedFlags(opportunity, scoring),
      greenFlags: this.detectGreenFlags(opportunity, scoring),
    }, startTime);
  }

  /**
   * Birden fazla fırsatı toplu puanlar ve sıralar
   */
  private judgeBatch(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const opportunities = input.data?.opportunities as Array<Record<string, unknown>> | undefined;
    const limit = input.data?.limit as number || 5;

    if (!opportunities || opportunities.length === 0) {
      return this.buildResult(true, {
        action: 'batch_judgement',
        results: [],
        message: 'Puanlanacak fırsat yok.',
      }, startTime);
    }

    const judged = opportunities.map((opp) => {
      const scoring = this.scoreOpportunity(opp, context);
      return {
        opportunity: {
          id: opp.id,
          title: opp.title,
          category: opp.category,
          source: opp.source,
          expectedProfit: opp.expectedProfit ?? opp.expected_profit,
        },
        totalScore: scoring.totalScore,
        verdict: this.getVerdict(scoring.totalScore),
        factors: scoring.factors,
      };
    });

    // En yüksek puandan düşüğe sırala
    const ranked = judged.sort((a, b) => b.totalScore - a.totalScore).slice(0, limit);

    return this.buildResult(true, {
      action: 'batch_judgement',
      totalJudged: judged.length,
      returned: ranked.length,
      results: ranked,
      topPick: ranked[0],
      averageScore: Math.round(judged.reduce((sum, j) => sum + j.totalScore, 0) / judged.length),
    }, startTime);
  }

  /**
   * İki fırsatı karşılaştırır
   */
  private compare(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const oppA = input.data?.opportunityA as Record<string, unknown>;
    const oppB = input.data?.opportunityB as Record<string, unknown>;

    if (!oppA || !oppB) {
      return this.buildResult(false, null, startTime, 'İki fırsat verisi gerekli (opportunityA, opportunityB)');
    }

    const scoreA = this.scoreOpportunity(oppA, context);
    const scoreB = this.scoreOpportunity(oppB, context);

    const comparison: Array<{ factor: string; a: number; b: number; winner: string }> = [];

    const factorNames: Array<{ key: keyof ScoringFactors; label: string }> = [
      { key: 'profitPotential', label: 'Kâr Potansiyeli' },
      { key: 'riskLevel', label: 'Risk (düşük=iyi)' },
      { key: 'urgency', label: 'Aciliyet' },
      { key: 'profileMatch', label: 'Profil Uyumu' },
      { key: 'patternConfidence', label: 'Pattern Güveni' },
    ];

    for (const { key, label } of factorNames) {
      const aVal = scoreA.factors[key];
      const bVal = scoreB.factors[key];
      const winner = key === 'riskLevel'
        ? (aVal < bVal ? 'A' : aVal > bVal ? 'B' : 'eşit')
        : (aVal > bVal ? 'A' : aVal < bVal ? 'B' : 'eşit');
      comparison.push({ factor: label, a: aVal, b: bVal, winner });
    }

    const overallWinner = scoreA.totalScore > scoreB.totalScore ? 'A' : scoreA.totalScore < scoreB.totalScore ? 'B' : 'eşit';

    return this.buildResult(true, {
      action: 'comparison',
      a: { title: oppA.title, totalScore: scoreA.totalScore, verdict: this.getVerdict(scoreA.totalScore) },
      b: { title: oppB.title, totalScore: scoreB.totalScore, verdict: this.getVerdict(scoreB.totalScore) },
      factorComparison: comparison,
      overallWinner,
      recommendation: this.getComparisonRecommendation(scoreA, scoreB, oppA, oppB),
    }, startTime);
  }

  /**
   * Bir puanın detaylı açıklamasını yapar
   */
  private explainScore(input: AgentInput, startTime: number): AgentRunResult {
    const factors = input.data?.factors as ScoringFactors;
    const totalScore = input.data?.totalScore as number;

    if (!factors || totalScore === undefined) {
      return this.buildResult(false, null, startTime, 'Faktörler ve toplam puan gerekli');
    }

    const explanations: Array<{ factor: string; value: number; weight: number; contribution: number; interpretation: string }> = [];

    type WeightKey = 'profitPotential' | 'riskLevel' | 'urgency' | 'profileMatch' | 'patternConfidence' | 'sourceReliability';
    const factorDetails: Array<{ key: keyof ScoringFactors; label: string; weightKey: WeightKey }> = [
      { key: 'profitPotential', label: 'Kâr Potansiyeli', weightKey: 'profitPotential' },
      { key: 'riskLevel', label: 'Risk Seviyesi', weightKey: 'riskLevel' },
      { key: 'urgency', label: 'Aciliyet', weightKey: 'urgency' },
      { key: 'profileMatch', label: 'Profil Uyumu', weightKey: 'profileMatch' },
      { key: 'patternConfidence', label: 'Pattern Güveni', weightKey: 'patternConfidence' },
    ];

    for (const { key, label, weightKey } of factorDetails) {
      const value = factors[key];
      const weight = this.weights[weightKey as keyof typeof this.weights];
      const effectiveValue = key === 'riskLevel' ? 100 - value : value;
      const contribution = Math.round(effectiveValue * weight);

      explanations.push({
        factor: label,
        value,
        weight,
        contribution,
        interpretation: this.interpretFactor(key, value),
      });
    }

    return this.buildResult(true, {
      action: 'explanation',
      totalScore,
      verdict: this.getVerdict(totalScore),
      factors: explanations,
      summary: this.buildScoreSummary(totalScore, factors),
    }, startTime);
  }

  // --- Puanlama Motorları ---

  private scoreOpportunity(opp: Record<string, unknown>, context: AgentContext): ScoringResult {
    const factors = this.extractFactors(opp, context);
    const invertedRisk = 100 - factors.riskLevel;

    const totalScore = Math.round(
      factors.profitPotential * this.weights.profitPotential +
      invertedRisk * this.weights.riskLevel +
      factors.urgency * this.weights.urgency +
      factors.profileMatch * this.weights.profileMatch +
      factors.patternConfidence * this.weights.patternConfidence +
      (this.getSourceReliability(opp.source as string) * this.weights.sourceReliability)
    );

    return {
      totalScore: Math.min(100, Math.max(0, totalScore)),
      factors,
      explanation: this.buildExplanation(factors, totalScore),
    };
  }

  private extractFactors(opp: Record<string, unknown>, context: AgentContext): ScoringFactors {
    const rawScore = opp.score;
    const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : 50;
    const rawExpectedProfit = opp.expectedProfit ?? opp.expected_profit;
    const expectedProfit = typeof rawExpectedProfit === 'number' && Number.isFinite(rawExpectedProfit)
      ? rawExpectedProfit
      : undefined;
    const category = opp.category as string;
    const urgency = opp.urgency as string;
    const source = opp.source as string;

    // Kâr potansiyeli
    let profitPotential = score;
    if (expectedProfit !== undefined) {
      if (expectedProfit >= 5000) profitPotential = Math.max(profitPotential, 90);
      else if (expectedProfit >= 1000) profitPotential = Math.max(profitPotential, 70);
      else if (expectedProfit >= 200) profitPotential = Math.max(profitPotential, 50);
    }

    // Risk seviyesi
    let riskLevel = 50;
    if (source === 'sahibinden' || source === 'trendyol') riskLevel = 30;
    if (source === 'aliexpress' || source === 'dhgate') riskLevel = 60;
    if (category === 'finans') riskLevel = 70;
    if (category === 'arbitraj') riskLevel = 55;
    const explicitRiskLevel = opp.riskLevel;
    if (typeof explicitRiskLevel === 'number' && Number.isFinite(explicitRiskLevel)) {
      riskLevel = explicitRiskLevel;
    }

    // Aciliyet
    let urgencyScore = 50;
    if (urgency === 'critical') urgencyScore = 95;
    else if (urgency === 'high') urgencyScore = 80;
    else if (urgency === 'medium') urgencyScore = 50;
    else if (urgency === 'low') urgencyScore = 20;

    // Profil uyumu
    let profileMatch = 50;
    const profile = context.userProfile as Record<string, unknown> | undefined;
    if (profile) {
      const preferredDomains = (profile.preferredDomains || profile.preferred_domains) as string[] | undefined;
      if (preferredDomains && category && preferredDomains.includes(category)) {
        profileMatch = 80;
      }

      const riskTolerance = (profile.riskTolerance || profile.risk_tolerance) as string;
      if (riskTolerance === 'low' && riskLevel > 60) profileMatch -= 20;
      if (riskTolerance === 'high' && riskLevel <= 40) profileMatch += 10;

      const successfulPatterns = (profile.successfulPatterns || profile.successful_patterns) as string[] | undefined;
      if (successfulPatterns && category && successfulPatterns.some((p) => p.includes(category))) {
        profileMatch += 15;
      }
    }

    // Pattern güveni
    let patternConfidence = 30;
    if (context.recentPatterns && Array.isArray(context.recentPatterns)) {
      const matchingPattern = (context.recentPatterns as Array<Record<string, unknown>>).find(
        (p) =>
          ((p.tags as string[]) || []).includes(category) && p.status === 'active'
      );
      if (matchingPattern) {
        const rawConfidence = (matchingPattern as Record<string, unknown>).confidence;
        const confidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
          ? rawConfidence
          : 0.5;
        patternConfidence = Math.round(confidence * 100);
      }
    }

    return {
      profitPotential: Math.min(100, Math.max(0, profitPotential)),
      riskLevel: Math.min(100, Math.max(0, riskLevel)),
      urgency: Math.min(100, Math.max(0, urgencyScore)),
      profileMatch: Math.min(100, Math.max(0, profileMatch)),
      patternConfidence: Math.min(100, Math.max(0, patternConfidence)),
    };
  }

  private getSourceReliability(source?: string): number {
    const reliability: Record<string, number> = {
      sahibinden: 75,
      trendyol: 80,
      letgo: 60,
      aliexpress: 50,
      perplexity: 70,
      amazon: 85,
      ebay: 65,
    };
    return reliability[source?.toLowerCase() || ''] || 50;
  }

  // --- Değerlendirme ---

  private getVerdict(score: number): { label: string; emoji: string; action: string } {
    if (score >= 85) return { label: 'MÜKEMMEL FIRSAT', emoji: '🔥', action: 'Hemen harekete geç' };
    if (score >= 70) return { label: 'İYİ FIRSAT', emoji: '🟢', action: 'Değerlendir, zamanın var ama gecikme' };
    if (score >= 55) return { label: 'ORTA', emoji: '🟡', action: 'Detaylı araştır, hızlı karar verme' };
    if (score >= 40) return { label: 'DÜŞÜK', emoji: '🟠', action: 'Alternatif ara' };
    return { label: 'KAÇIN', emoji: '🔴', action: 'Zaman harcama, başka fırsatlara bak' };
  }

  private getActionAdvice(scoring: ScoringResult, opp: Record<string, unknown>): string[] {
    const advice: string[] = [];
    const f = scoring.factors;

    if (f.profitPotential >= 70 && f.riskLevel <= 40) {
      advice.push('Düşük riskli ve yüksek kârlı — öncelikli değerlendir');
    }
    if (f.urgency >= 80) {
      advice.push('Acil fırsat — hızlı karar ver, pencere kapanıyor');
    }
    if (f.riskLevel >= 70) {
      advice.push('Yüksek risk — küçük tutarla dene veya atla');
    }
    if (f.profileMatch < 40) {
      advice.push('Profiline tam uymuyor — extra dikkat gerekli');
    }
    if (f.patternConfidence >= 70) {
      advice.push('Daha önce benzer fırsatlarda başarı var — güvenle ilerle');
    }
    if (advice.length === 0) {
      advice.push('Standart değerlendirme — normal prosedürle ilerle');
    }

    return advice;
  }

  private detectRedFlags(opp: Record<string, unknown>, scoring: ScoringResult): string[] {
    const flags: string[] = [];
    if (scoring.factors.riskLevel >= 80) flags.push('Çok yüksek risk');
    if (scoring.factors.profitPotential < 30) flags.push('Düşük kâr potansiyeli');
    if (scoring.factors.profileMatch < 30) flags.push('Profile uyumsuz');

    const source = opp.source as string;
    if (!source || source === 'unknown') flags.push('Kaynak belirsiz');

    return flags;
  }

  private detectGreenFlags(opp: Record<string, unknown>, scoring: ScoringResult): string[] {
    const flags: string[] = [];
    if (scoring.factors.profitPotential >= 80) flags.push('Yüksek kâr potansiyeli');
    if (scoring.factors.riskLevel <= 30) flags.push('Düşük risk');
    if (scoring.factors.profileMatch >= 80) flags.push('Profiline çok uygun');
    if (scoring.factors.patternConfidence >= 70) flags.push('Başarılı pattern eşleşmesi');
    if (scoring.factors.urgency >= 80) flags.push('Acil — erken hareket avantajı');
    return flags;
  }

  private getComparisonRecommendation(scoreA: ScoringResult, scoreB: ScoringResult, oppA: Record<string, unknown>, oppB: Record<string, unknown>): string {
    const diff = Math.abs(scoreA.totalScore - scoreB.totalScore);
    const winner = scoreA.totalScore >= scoreB.totalScore ? oppA : oppB;
    const loser = scoreA.totalScore >= scoreB.totalScore ? oppB : oppA;

    if (diff >= 20) return `"${winner.title}" açık ara daha iyi. "${loser.title}"ı atla.`;
    if (diff >= 10) return `"${winner.title}" biraz daha avantajlı ama "${loser.title}" de değerlendirilebilir.`;
    return `İkisi de yakın. Risk toleransına ve zamanlamasına göre karar ver.`;
  }

  private interpretFactor(key: keyof ScoringFactors, value: number): string {
    const labels: Record<string, Record<string, string>> = {
      profitPotential: { high: 'Yüksek kazanç beklentisi', mid: 'Orta seviye kazanç', low: 'Düşük kazanç beklentisi' },
      riskLevel: { high: 'Yüksek risk — dikkatli ol', mid: 'Makul risk', low: 'Düşük risk — güvenli' },
      urgency: { high: 'Acil aksiyon gerekli', mid: 'Zamanın var ama gecikme', low: 'Aciliyet yok' },
      profileMatch: { high: 'Profiline çok uygun', mid: 'Kısmen uygun', low: 'Profiline uymuyor' },
      patternConfidence: { high: 'Güçlü pattern eşleşmesi', mid: 'Kısmi pattern desteği', low: 'Pattern desteği zayıf' },
    };

    const level = value >= 70 ? 'high' : value >= 40 ? 'mid' : 'low';
    return labels[key]?.[level] || `Değer: ${value}`;
  }

  private buildExplanation(factors: ScoringFactors, score: number): string {
    const parts: string[] = [];
    if (factors.profitPotential >= 70) parts.push('yüksek kâr potansiyeli');
    if (factors.riskLevel <= 30) parts.push('düşük risk');
    if (factors.urgency >= 70) parts.push('acil fırsat');
    if (factors.profileMatch >= 70) parts.push('profiline uygun');
    if (factors.patternConfidence >= 70) parts.push('güvenilir pattern');
    if (parts.length === 0) return `Puan: ${score}. Ortalama bir fırsat.`;
    return `Puan: ${score}. Nedenleri: ${parts.join(', ')}.`;
  }

  private buildScoreSummary(totalScore: number, factors: ScoringFactors): string {
    const strongPoints: string[] = [];
    const weakPoints: string[] = [];

    if (factors.profitPotential >= 70) strongPoints.push('kâr potansiyeli');
    else if (factors.profitPotential < 40) weakPoints.push('kâr potansiyeli');

    if (factors.riskLevel <= 30) strongPoints.push('düşük risk');
    else if (factors.riskLevel >= 70) weakPoints.push('yüksek risk');

    if (factors.profileMatch >= 70) strongPoints.push('profil uyumu');
    else if (factors.profileMatch < 40) weakPoints.push('profil uyumsuzluğu');

    let summary = `Toplam puan: ${totalScore}/100.`;
    if (strongPoints.length > 0) summary += ` Güçlü yönler: ${strongPoints.join(', ')}.`;
    if (weakPoints.length > 0) summary += ` Zayıf yönler: ${weakPoints.join(', ')}.`;
    return summary;
  }
}
