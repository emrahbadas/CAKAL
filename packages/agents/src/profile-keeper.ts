import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Profile Keeper — Kullanıcı Profil Koruyucusu
 *
 * Kullanıcının tüm geçmişini, kararlarını ve sonuçlarını izler.
 * Dinamik kullanıcı indexini otomatik günceller.
 * Haftalık karakter raporu üretir (GPT-4o ile).
 */
export class ProfileKeeperAgent extends BaseAgent {
  readonly name = 'profile-keeper' as const;
  readonly description = 'Kullanıcı davranışlarını analiz eder ve profili dinamik günceller';

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const eventType = input.data?.eventType as string;

      switch (eventType) {
        case 'feedback_received':
          return this.processFeedback(input, context, startTime);
        case 'opportunity_viewed':
          return this.processOpportunityView(input, startTime);
        case 'conversation_ended':
          return this.processConversation(input, startTime);
        case 'weekly_analysis':
          return this.generateWeeklyAnalysis(input, startTime);
        default:
          return this.processGenericEvent(input, startTime);
      }
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  private async processFeedback(
    input: AgentInput,
    _context: AgentContext,
    startTime: number
  ): Promise<AgentRunResult> {
    const outcome = input.data?.outcome as string;
    const profit = input.data?.profit as number | undefined;
    const category = input.data?.category as string | undefined;
    const wantSimilar = input.data?.wantSimilar as boolean | undefined;

    const profileUpdates: Record<string, unknown> = {};
    const indexEntries: Array<Record<string, unknown>> = [];

    if (outcome === 'profit' && profit) {
      profileUpdates.engagement_score_delta = 5;
      indexEntries.push({
        entry_type: 'success_signal',
        entry_key: `profit_${category || 'general'}`,
        entry_value: { profit, category, outcome },
        confidence: 0.8,
        source: 'feedback',
      });
    } else if (outcome === 'loss') {
      profileUpdates.engagement_score_delta = 2;
      indexEntries.push({
        entry_type: 'risk_signal',
        entry_key: `loss_${category || 'general'}`,
        entry_value: { profit, category, outcome },
        confidence: 0.7,
        source: 'feedback',
      });
    }

    if (wantSimilar && category) {
      indexEntries.push({
        entry_type: 'preference',
        entry_key: `wants_more_${category}`,
        entry_value: { wantSimilar: true, category },
        confidence: 0.9,
        source: 'feedback',
      });
    }

    return this.buildResult(true, {
      action: 'feedback_processed',
      profileUpdates,
      indexEntries,
      message: `Geri bildirim işlendi: ${outcome}. ${indexEntries.length} index kaydı üretildi.`,
    }, startTime);
  }

  private async processOpportunityView(
    input: AgentInput,
    startTime: number
  ): Promise<AgentRunResult> {
    const category = input.data?.category as string | undefined;
    const source = input.data?.source as string | undefined;

    const indexEntries: Array<Record<string, unknown>> = [];

    if (category) {
      indexEntries.push({
        entry_type: 'interest',
        entry_key: `viewed_${category}`,
        entry_value: { category, source, action: 'view' },
        confidence: 0.4,
        source: 'auto',
      });
    }

    return this.buildResult(true, {
      action: 'view_logged',
      indexEntries,
      message: 'Görüntüleme kaydedildi.',
    }, startTime);
  }

  private async processConversation(
    input: AgentInput,
    startTime: number
  ): Promise<AgentRunResult> {
    const topics = input.data?.topics as string[] | undefined;
    const sentiment = input.data?.sentiment as string | undefined;

    const indexEntries: Array<Record<string, unknown>> = [];

    if (topics) {
      for (const topic of topics) {
        indexEntries.push({
          entry_type: 'interest',
          entry_key: `topic_${topic.toLowerCase().replace(/\s+/g, '_')}`,
          entry_value: { topic, source: 'conversation', sentiment },
          confidence: 0.6,
          source: 'conversation',
        });
      }
    }

    return this.buildResult(true, {
      action: 'conversation_analyzed',
      indexEntries,
      detectedTopics: topics || [],
      message: `Sohbet analiz edildi, ${indexEntries.length} ilgi alanı tespit edildi.`,
    }, startTime);
  }

  /**
   * Haftalık analiz — GPT-4o'nun yapacağı analiz için veri paketi hazırlar.
   * Asıl GPT çağrısı main.cjs'deki IPC handler'da yapılır.
   */
  private async generateWeeklyAnalysis(
    input: AgentInput,
    startTime: number
  ): Promise<AgentRunResult> {
    // input.data should have: feedbacks, opportunities, profile, indexEntries, conversations
    const feedbacks = (input.data?.feedbacks as Array<Record<string, unknown>>) || [];
    const opportunities = (input.data?.opportunities as Array<Record<string, unknown>>) || [];
    const profile = input.data?.profile as Record<string, unknown> | undefined;
    const indexEntries = (input.data?.indexEntries as Array<Record<string, unknown>>) || [];

    // Aggregate stats
    const profitFeedbacks = feedbacks.filter(f => f.outcome === 'profit');
    const lossFeedbacks = feedbacks.filter(f => f.outcome === 'loss');
    const totalProfit = profitFeedbacks.reduce((s, f) => s + ((f.actual_profit as number) || 0), 0);
    const totalLoss = lossFeedbacks.reduce((s, f) => s + Math.abs((f.actual_profit as number) || 0), 0);

    // Category distribution
    const categoryMap: Record<string, number> = {};
    for (const opp of opportunities) {
      const cat = (opp.category as string) || 'diger';
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    }

    // Interest signals from index
    const interests = indexEntries
      .filter(e => e.entry_type === 'interest' || e.entry_type === 'preference')
      .map(e => e.entry_key);

    const analysisData = {
      period: '7_days',
      feedbackSummary: {
        total: feedbacks.length,
        profits: profitFeedbacks.length,
        losses: lossFeedbacks.length,
        totalProfit,
        totalLoss,
        netProfit: totalProfit - totalLoss,
      },
      opportunitySummary: {
        total: opportunities.length,
        categoryDistribution: categoryMap,
        avgScore: opportunities.length > 0
          ? Math.round(opportunities.reduce((s, o) => s + ((o.score as number) || 0), 0) / opportunities.length)
          : 0,
      },
      currentProfile: profile,
      detectedInterests: [...new Set(interests)],
    };

    return this.buildResult(true, {
      action: 'weekly_analysis_data',
      analysisData,
      message: 'Haftalık analiz verisi hazırlandı. GPT-4o ile karakter raporu üretilecek.',
    }, startTime);
  }

  private async processGenericEvent(
    _input: AgentInput,
    startTime: number
  ): Promise<AgentRunResult> {
    return this.buildResult(true, {
      action: 'event_logged',
      message: 'Olay kaydedildi.',
    }, startTime);
  }
}
