import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Pattern Extractor — Strateji Örüntü Çıkarıcı
 *
 * Feedback verilerini analiz ederek yeni patternler keşfeder,
 * mevcut patternleri güçlendirir veya zayıflatır.
 * Strateji ağırlıklarını otomatik günceller.
 */
export class PatternExtractorAgent extends BaseAgent {
  readonly name = 'pattern-extractor' as const;
  readonly description = 'Feedback verilerinden strateji patternleri çıkarır ve ağırlıkları günceller';

  async run(input: AgentInput, _context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const action = input.data?.action as string;

      switch (action) {
        case 'extract_from_feedback':
          return this.extractFromFeedback(input, startTime);
        case 'update_weights':
          return this.updateWeights(input, startTime);
        case 'daily_analysis':
          return this.dailyAnalysis(input, startTime);
        case 'detect_new_patterns':
          return this.detectNewPatterns(input, startTime);
        default:
          return this.buildResult(true, {
            action: 'info',
            message: 'Pattern Extractor hazır. Desteklenen aksiyonlar: extract_from_feedback, update_weights, daily_analysis, detect_new_patterns',
          }, startTime);
      }
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  /**
   * Tek bir feedback'ten pattern sinyali çıkarır
   */
  private extractFromFeedback(input: AgentInput, startTime: number): AgentRunResult {
    const feedback = input.data?.feedback as Record<string, unknown> | undefined;
    if (!feedback) {
      return this.buildResult(false, null, startTime, 'Feedback verisi eksik');
    }

    const outcome = feedback.outcome as string;
    const category = feedback.category as string | undefined;
    const profit = feedback.actual_profit as number | undefined;
    const source = feedback.source as string | undefined;
    const tags: string[] = [];

    if (category) tags.push(category.toLowerCase());
    if (source) tags.push(source.toLowerCase());

    // Determine pattern signal
    const isSuccess = outcome === 'profit';
    const magnitude = profit ? Math.min(0.3, Math.abs(profit) / 5000) : 0.1;

    const patternSignal = {
      suggestedName: this.generatePatternName(category, source, outcome),
      description: this.generatePatternDescription(category, source, outcome, profit),
      tags,
      outcome: isSuccess ? 'success' : (outcome === 'loss' ? 'failure' : 'uncertain'),
      magnitude,
      category,
      source,
    };

    return this.buildResult(true, {
      action: 'pattern_signal',
      signal: patternSignal,
      shouldCreateNew: true,
      shouldUpdateExisting: true,
    }, startTime);
  }

  /**
   * Mevcut patternlerin ağırlıklarını toplu günceller
   */
  private updateWeights(input: AgentInput, startTime: number): AgentRunResult {
    const patterns = input.data?.patterns as Array<Record<string, unknown>> | undefined;
    const feedbacks = input.data?.feedbacks as Array<Record<string, unknown>> | undefined;

    if (!patterns || !feedbacks) {
      return this.buildResult(false, null, startTime, 'Pattern veya feedback verisi eksik');
    }

    const updates: Array<{
      patternId: string;
      weightDelta: number;
      newStatus: string;
      reason: string;
    }> = [];

    for (const pattern of patterns) {
      const patternTags = (pattern.tags as string[]) || [];
      const patternName = (pattern.name as string || '').toLowerCase();

      // Find matching feedbacks for this pattern
      const matchingFeedbacks = feedbacks.filter(fb => {
        const fbCategory = (fb.category as string || '').toLowerCase();
        const fbSource = (fb.source as string || '').toLowerCase();
        return patternTags.some(tag =>
          fbCategory.includes(tag) || fbSource.includes(tag) || patternName.includes(fbCategory)
        );
      });

      if (matchingFeedbacks.length === 0) continue;

      const profitCount = matchingFeedbacks.filter(f => f.outcome === 'profit').length;
      const lossCount = matchingFeedbacks.filter(f => f.outcome === 'loss').length;
      const totalProfit = matchingFeedbacks
        .filter(f => f.outcome === 'profit')
        .reduce((s, f) => s + ((f.actual_profit as number) || 0), 0);

      const successRate = profitCount / matchingFeedbacks.length;
      let weightDelta = 0;
      let reason = '';

      if (successRate >= 0.7) {
        weightDelta = 0.15;
        reason = `Yüksek başarı oranı: %${Math.round(successRate * 100)} (${profitCount}/${matchingFeedbacks.length})`;
      } else if (successRate >= 0.5) {
        weightDelta = 0.05;
        reason = `Orta başarı oranı: %${Math.round(successRate * 100)}`;
      } else if (successRate < 0.3) {
        weightDelta = -0.15;
        reason = `Düşük başarı oranı: %${Math.round(successRate * 100)} (${lossCount} kayıp)`;
      } else {
        weightDelta = -0.05;
        reason = `Ortalamanın altı: %${Math.round(successRate * 100)}`;
      }

      // Determine new status
      const currentSuccessCount = (pattern.success_count as number || 0) + profitCount;
      const currentFailCount = (pattern.fail_count as number || 0) + lossCount;
      const total = currentSuccessCount + currentFailCount;
      let newStatus = pattern.status as string;

      if (total < 3) {
        newStatus = 'on-hold';
      } else if (currentSuccessCount > currentFailCount * 1.5) {
        newStatus = 'active';
      } else if (currentFailCount > currentSuccessCount * 2) {
        newStatus = 'weakened';
      }

      updates.push({
        patternId: pattern.id as string,
        weightDelta,
        newStatus,
        reason,
      });
    }

    return this.buildResult(true, {
      action: 'weight_updates',
      updates,
      totalProcessed: patterns.length,
      totalUpdated: updates.length,
    }, startTime);
  }

  /**
   * Günlük analiz — tüm verileri tarar, özetler
   */
  private dailyAnalysis(input: AgentInput, startTime: number): AgentRunResult {
    const feedbacks = input.data?.feedbacks as Array<Record<string, unknown>> | undefined;
    const patterns = input.data?.patterns as Array<Record<string, unknown>> | undefined;
    const opportunities = input.data?.opportunities as Array<Record<string, unknown>> | undefined;

    if (!feedbacks || !patterns) {
      return this.buildResult(false, null, startTime, 'Analiz verisi eksik');
    }

    // Category distribution
    const categoryStats: Record<string, { count: number; profit: number; loss: number }> = {};
    for (const fb of feedbacks) {
      const cat = (fb.category as string) || 'diger';
      if (!categoryStats[cat]) categoryStats[cat] = { count: 0, profit: 0, loss: 0 };
      categoryStats[cat].count++;
      if (fb.outcome === 'profit') categoryStats[cat].profit += (fb.actual_profit as number) || 0;
      if (fb.outcome === 'loss') categoryStats[cat].loss += Math.abs((fb.actual_profit as number) || 0);
    }

    // Top performing category
    // `[0]` bilerek aynı satırda: ayrı satıra alındığında dizi-literal gibi
    // okunup ASI tuzağına benziyor (no-unexpected-multiline).
    const topCategory = Object.entries(categoryStats)
      .sort(([, a], [, b]) => (b.profit - b.loss) - (a.profit - a.loss))[0];

    // Pattern health check
    const healthyPatterns = (patterns || []).filter(p => p.status === 'active').length;
    const weakPatterns = (patterns || []).filter(p => p.status === 'weakened').length;

    // Opportunity conversion rate
    const totalOpps = opportunities?.length || 0;
    const feedbackedOpps = feedbacks.length;
    const conversionRate = totalOpps > 0 ? feedbackedOpps / totalOpps : 0;

    return this.buildResult(true, {
      action: 'daily_summary',
      summary: {
        categoryStats,
        topCategory: topCategory ? { name: topCategory[0], ...topCategory[1] } : null,
        patternHealth: { active: healthyPatterns, weakened: weakPatterns, total: (patterns || []).length },
        conversionRate: Math.round(conversionRate * 100),
        totalFeedbacks: feedbacks.length,
        profitFeedbacks: feedbacks.filter(f => f.outcome === 'profit').length,
        lossFeedbacks: feedbacks.filter(f => f.outcome === 'loss').length,
      },
    }, startTime);
  }

  /**
   * Feedback verilerinden yeni patternler keşfeder
   */
  private detectNewPatterns(input: AgentInput, startTime: number): AgentRunResult {
    const feedbacks = input.data?.feedbacks as Array<Record<string, unknown>> | undefined;
    const existingPatterns = input.data?.existingPatterns as Array<Record<string, unknown>> | undefined;

    if (!feedbacks || feedbacks.length < 3) {
      return this.buildResult(true, {
        action: 'no_new_patterns',
        reason: 'Yeni pattern tespiti için en az 3 feedback gerekli',
      }, startTime);
    }

    const existingNames = new Set(
      (existingPatterns || []).map(p => (p.name as string || '').toLowerCase())
    );

    // Group feedbacks by category
    const categoryGroups: Record<string, Array<Record<string, unknown>>> = {};
    for (const fb of feedbacks) {
      const cat = (fb.category as string) || 'diger';
      if (!categoryGroups[cat]) categoryGroups[cat] = [];
      categoryGroups[cat].push(fb);
    }

    const newPatterns: Array<{
      name: string;
      description: string;
      tags: string[];
      initialConfidence: number;
      successCount: number;
      failCount: number;
      avgProfit: number;
    }> = [];

    for (const [category, fbs] of Object.entries(categoryGroups)) {
      if (fbs.length < 2) continue; // Need at least 2 feedbacks in a category

      const profitFbs = fbs.filter(f => f.outcome === 'profit');
      const lossFbs = fbs.filter(f => f.outcome === 'loss');

      // Only create pattern if there's a clear trend
      if (profitFbs.length < 2 && lossFbs.length < 2) continue;

      const patternName = profitFbs.length >= lossFbs.length
        ? `${category}_basarili_trend`
        : `${category}_riskli_alan`;

      if (existingNames.has(patternName.toLowerCase())) continue;

      const totalProfit = profitFbs.reduce((s, f) => s + ((f.actual_profit as number) || 0), 0);
      const avgProfit = profitFbs.length > 0 ? totalProfit / profitFbs.length : 0;

      newPatterns.push({
        name: patternName,
        description: this.generatePatternDescription(category, undefined, profitFbs.length >= lossFbs.length ? 'profit' : 'loss', avgProfit),
        tags: [category.toLowerCase()],
        initialConfidence: Math.min(0.8, (Math.max(profitFbs.length, lossFbs.length) / fbs.length) * 0.6 + 0.2),
        successCount: profitFbs.length,
        failCount: lossFbs.length,
        avgProfit: Math.round(avgProfit * 100) / 100,
      });
    }

    return this.buildResult(true, {
      action: 'new_patterns_detected',
      patterns: newPatterns,
      totalDetected: newPatterns.length,
    }, startTime);
  }

  private generatePatternName(
    category?: string,
    source?: string,
    outcome?: string
  ): string {
    const parts: string[] = [];
    if (category) parts.push(category.toLowerCase().replace(/\s+/g, '_'));
    if (source) parts.push(source.toLowerCase().replace(/\s+/g, '_'));
    parts.push(outcome === 'profit' ? 'basarili' : outcome === 'loss' ? 'riskli' : 'notr');
    return parts.join('_');
  }

  private generatePatternDescription(
    category?: string,
    source?: string,
    outcome?: string,
    profit?: number
  ): string {
    const cat = category || 'genel';
    const src = source ? ` (${source})` : '';
    if (outcome === 'profit') {
      return `${cat}${src} kategorisinde başarılı fırsat trendi${profit ? `, ort. ₺${Math.round(profit)} kâr` : ''}`;
    } else if (outcome === 'loss') {
      return `${cat}${src} kategorisinde riskli fırsat sinyali${profit ? `, kayıp ₺${Math.round(Math.abs(profit))}` : ''}`;
    }
    return `${cat}${src} kategorisinde belirsiz sonuçlu fırsat`;
  }
}
