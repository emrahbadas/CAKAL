import type { AgentRunResult } from '@cakal/shared-types';
import {
  buildResearchPlan,
  createUniverseSnapshot,
  detectResearchMode,
  evaluateResearchWorkflow,
  type ResearchMode,
  type ResearchState,
} from '@cakal/core/investment-research';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Finance Watcher — Finans Gözlemcisi
 *
 * Altın, döviz, kripto ve emtia tarafında kısa vadeli izleme sinyalleri üretir.
 * Kesin yatırım tavsiyesi vermez; yön, momentum ve risk özetler.
 * Kullanıcının risk profiline göre sinyalleri filtreler.
 */
export class FinanceWatcherAgent extends BaseAgent {
  readonly name = 'finance' as const;
  readonly description = 'Döviz, altın, kripto trendlerini izler ve sinyal üretir';

  // İzlenecek varlık kategorileri
  private readonly assetCategories: Record<string, string[]> = {
    doviz: ['USD/TRY', 'EUR/TRY', 'GBP/TRY'],
    altin: ['gram-altin', 'ceyrek-altin', 'ons-altin'],
    kripto: ['bitcoin', 'ethereum', 'solana'],
    emtia: ['brent-petrol', 'gumus', 'bakir'],
  };

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const action = input.data?.action as string;

      switch (action) {
        case 'analyze_signal':
          return this.analyzeSignal(input, startTime);
        case 'generate_watchlist_signals':
          return this.generateWatchlistSignals(input, context, startTime);
        case 'compare_assets':
          return this.compareAssets(input, startTime);
        case 'risk_assessment':
          return this.riskAssessment(input, context, startTime);
        case 'evaluate_research_workflow':
          return this.evaluateResearchWorkflow(input, startTime);
        default:
          return this.buildResult(true, {
            action: 'info',
            message: 'Finance Watcher hazır. Desteklenen aksiyonlar: analyze_signal, generate_watchlist_signals, compare_assets, risk_assessment, evaluate_research_workflow',
            categories: Object.keys(this.assetCategories),
          }, startTime);
      }
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  /**
   * Tek bir varlık için sinyal analizi yapar
   */
  private analyzeSignal(input: AgentInput, startTime: number): AgentRunResult {
    const asset = input.data?.asset as string;
    const currentPrice = input.data?.currentPrice as number;
    const previousPrice = input.data?.previousPrice as number;
    const weeklyHigh = input.data?.weeklyHigh as number;
    const weeklyLow = input.data?.weeklyLow as number;
    const volume = input.data?.volume as number;
    const avgVolume = input.data?.avgVolume as number;

    if (!asset) {
      return this.buildResult(false, null, startTime, 'Varlık adı gerekli');
    }

    // Fiyat değişim hesaplama
    const priceChange = currentPrice && previousPrice
      ? ((currentPrice - previousPrice) / previousPrice) * 100
      : undefined;

    // Momentum sinyali
    const momentum = this.calculateMomentum(currentPrice, previousPrice, weeklyHigh, weeklyLow);

    // Hacim anomalisi
    const volumeSignal = volume && avgVolume
      ? this.analyzeVolume(volume, avgVolume)
      : { signal: 'veri_yok', description: 'Hacim verisi eksik' };

    // Destek/Direnç yakınlığı
    const srLevel = this.checkSupportResistance(currentPrice, weeklyHigh, weeklyLow);

    // Genel yön
    const direction = this.determineDirection(priceChange, momentum, volumeSignal.signal);

    return this.buildResult(true, {
      action: 'signal',
      asset,
      currentPrice,
      priceChange: priceChange !== undefined ? Math.round(priceChange * 100) / 100 : undefined,
      momentum,
      volumeSignal,
      supportResistance: srLevel,
      direction,
      disclaimer: 'Bu bir yatırım tavsiyesi değildir. Sadece piyasa analiz özetidir.',
    }, startTime);
  }

  /**
   * Kullanıcının watchlist'indeki varlıklar için toplu sinyal üretir
   */
  private generateWatchlistSignals(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const watchlist = input.data?.watchlist as Array<Record<string, unknown>> | undefined;

    if (!watchlist || watchlist.length === 0) {
      return this.buildResult(true, {
        action: 'watchlist_signals',
        signals: [],
        message: 'İzleme listesinde varlık yok.',
      }, startTime);
    }

    const riskTolerance = (context.userProfile as Record<string, unknown>)?.riskTolerance as string || 'medium';

    const signals = watchlist.map((item) => {
      const asset = item.asset as string;
      const current = item.currentPrice as number;
      const previous = item.previousPrice as number;
      const threshold = item.alertThreshold as number || 3; // %3 varsayılan eşik

      const change = current && previous ? ((current - previous) / previous) * 100 : 0;
      const absChange = Math.abs(change);
      const triggered = absChange >= threshold;

      let action: string;
      if (!triggered) {
        action = 'bekle';
      } else if (change > 0 && riskTolerance !== 'low') {
        action = 'yukarı_kırılım';
      } else if (change < 0) {
        action = 'aşağı_kırılım';
      } else {
        action = 'izle';
      }

      return {
        asset,
        currentPrice: current,
        change: Math.round(change * 100) / 100,
        threshold,
        triggered,
        action,
        emoji: this.getChangeEmoji(change),
      };
    });

    const triggeredSignals = signals.filter((s) => s.triggered);

    return this.buildResult(true, {
      action: 'watchlist_signals',
      total: signals.length,
      triggeredCount: triggeredSignals.length,
      signals,
      alerts: triggeredSignals,
      summary: triggeredSignals.length > 0
        ? `${triggeredSignals.length} varlıkta eşik aşıldı!`
        : 'Tüm varlıklar normal seyirde.',
    }, startTime);
  }

  /**
   * İki veya daha fazla varlığı karşılaştırır
   */
  private compareAssets(input: AgentInput, startTime: number): AgentRunResult {
    const assets = input.data?.assets as Array<Record<string, unknown>> | undefined;

    if (!assets || assets.length < 2) {
      return this.buildResult(false, null, startTime, 'En az 2 varlık gerekli');
    }

    const comparison = assets.map((a) => {
      const name = a.name as string;
      const dailyChange = a.dailyChange as number || 0;
      const weeklyChange = a.weeklyChange as number || 0;
      const monthlyChange = a.monthlyChange as number || 0;
      const volatility = a.volatility as number || 0;

      // Performans skoru: %30 günlük + %40 haftalık + %30 aylık
      const performanceScore = dailyChange * 0.3 + weeklyChange * 0.4 + monthlyChange * 0.3;

      return {
        name,
        dailyChange: Math.round(dailyChange * 100) / 100,
        weeklyChange: Math.round(weeklyChange * 100) / 100,
        monthlyChange: Math.round(monthlyChange * 100) / 100,
        volatility: Math.round(volatility * 100) / 100,
        performanceScore: Math.round(performanceScore * 100) / 100,
        riskLevel: volatility > 10 ? 'yüksek' : volatility > 5 ? 'orta' : 'düşük',
      };
    });

    const sorted = [...comparison].sort((a, b) => b.performanceScore - a.performanceScore);

    return this.buildResult(true, {
      action: 'comparison',
      assets: sorted,
      bestPerformer: sorted[0],
      worstPerformer: sorted[sorted.length - 1],
      disclaimer: 'Geçmiş performans gelecek getiriyi garanti etmez.',
    }, startTime);
  }

  /**
   * Risk değerlendirmesi yapar
   */
  private riskAssessment(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const asset = input.data?.asset as string;
    const investmentAmount = input.data?.amount as number;
    const volatility = input.data?.volatility as number || 5;
    const volatilityDecimal = volatility / 100;
    const holdingPeriod = input.data?.holdingDays as number || 30;

    if (!asset || !investmentAmount) {
      return this.buildResult(false, null, startTime, 'Varlık adı ve yatırım tutarı gerekli');
    }

    const riskTolerance = (context.userProfile as Record<string, unknown>)?.riskTolerance as string || 'medium';

    // Basitleştirilmiş VaR hesaplama (Value at Risk)
    const dailyVol = volatilityDecimal / Math.sqrt(252); // yıllık yüzde → günlük ondalık
    const periodVol = dailyVol * Math.sqrt(holdingPeriod);
    const var95 = investmentAmount * periodVol * 1.645; // %95 güven aralığı
    const var99 = investmentAmount * periodVol * 2.326; // %99 güven aralığı

    // Pozisyon boyutu önerisi
    const maxPosition = this.suggestPositionSize(investmentAmount, volatility, riskTolerance);

    // Risk:ödül oranı
    const expectedReturn = investmentAmount * (periodVol * 0.5); // basit tahmin
    const riskRewardRatio = var95 > 0 ? expectedReturn / var95 : 0;

    return this.buildResult(true, {
      action: 'risk_assessment',
      asset,
      investmentAmount,
      holdingPeriod,
      volatility,
      valueAtRisk: {
        var95: Math.round(var95),
        var99: Math.round(var99),
        description: `%95 güven aralığında ${holdingPeriod} günde maksimum ₺${Math.round(var95).toLocaleString('tr-TR')} kayıp beklenebilir.`,
      },
      suggestedPosition: maxPosition,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
      suitability: this.checkSuitability(volatility, riskTolerance),
      disclaimer: 'Bu hesaplama basitleştirilmiş bir modeldir. Kesin yatırım tavsiyesi değildir.',
    }, startTime);
  }

  private evaluateResearchWorkflow(input: AgentInput, startTime: number): AgentRunResult {
    const message = String(input.message ?? input.data?.message ?? '');
    const mode = (input.data?.mode as ResearchMode | undefined) ?? detectResearchMode(message);
    const completedStates = Array.isArray(input.data?.completedStates)
      ? input.data.completedStates as ResearchState[]
      : [];

    const universeInput = input.data?.universe as Record<string, unknown> | undefined;
    const universe = universeInput
      ? createUniverseSnapshot({
        market: String(universeInput.market ?? 'BIST'),
        assetType: (universeInput.assetType as 'EQUITY') ?? 'EQUITY',
        rulesVersion: String(universeInput.rulesVersion ?? '1.0.0'),
        securityCount: typeof universeInput.securityCount === 'number' ? universeInput.securityCount : undefined,
        filters: (universeInput.filters as Record<string, unknown> | undefined) ?? {},
        excludedReasons: Array.isArray(universeInput.excludedReasons) ? universeInput.excludedReasons as string[] : [],
      })
      : undefined;

    const result = evaluateResearchWorkflow({
      mode,
      completedStates,
      usedShortcuts: Array.isArray(input.data?.usedShortcuts) ? input.data.usedShortcuts as string[] : [],
      memoryCandidatesUsed: Boolean(input.data?.memoryCandidatesUsed),
      watchlistSeedUsed: Boolean(input.data?.watchlistSeedUsed),
      previousRecommendationEvidenceUsed: Boolean(input.data?.previousRecommendationEvidenceUsed),
      mandate: input.data?.mandate as Parameters<typeof evaluateResearchWorkflow>[0]['mandate'],
      universe,
    });

    return this.buildResult(true, {
      action: 'research_workflow_policy',
      mode,
      requiredPlan: buildResearchPlan(mode),
      validation: result,
      message: result.passed
        ? 'Yatirim arastirma workflow gate kontrolden gecti.'
        : 'Yatirim arastirma workflow gate eksikleri nedeniyle nihai karar uretilemez.',
    }, startTime);
  }

  // --- Yardımcı Fonksiyonlar ---

  private calculateMomentum(
    current?: number,
    previous?: number,
    weeklyHigh?: number,
    weeklyLow?: number,
  ): { label: string; strength: number; description: string } {
    if (!current || !previous) {
      return { label: 'belirsiz', strength: 0, description: 'Yeterli veri yok' };
    }

    const change = ((current - previous) / previous) * 100;

    if (weeklyHigh && weeklyLow) {
      const range = weeklyHigh - weeklyLow;
      const position = range > 0 ? (current - weeklyLow) / range : 0.5;

      if (change > 2 && position > 0.8) {
        return { label: 'güçlü_yükseliş', strength: 0.9, description: 'Güçlü yükseliş trendi, haftalık zirve yakınında' };
      }
      if (change > 0.5 && position > 0.5) {
        return { label: 'yükseliş', strength: 0.6, description: 'Hafif yükseliş eğilimi' };
      }
      if (change < -2 && position < 0.2) {
        return { label: 'güçlü_düşüş', strength: -0.9, description: 'Güçlü düşüş trendi, haftalık dip yakınında' };
      }
      if (change < -0.5 && position < 0.5) {
        return { label: 'düşüş', strength: -0.6, description: 'Hafif düşüş eğilimi' };
      }
    }

    if (Math.abs(change) < 0.5) {
      return { label: 'yatay', strength: 0, description: 'Yatay seyir, belirgin bir yön yok' };
    }
    return { label: change > 0 ? 'yükseliş' : 'düşüş', strength: change > 0 ? 0.5 : -0.5, description: `%${Math.abs(change).toFixed(1)} ${change > 0 ? 'artış' : 'düşüş'}` };
  }

  private analyzeVolume(volume: number, avgVolume: number): { signal: string; ratio: number; description: string } {
    const ratio = volume / avgVolume;
    if (ratio > 2) return { signal: 'çok_yüksek', ratio: Math.round(ratio * 10) / 10, description: 'Anormal hacim artışı — kırılım olabilir' };
    if (ratio > 1.5) return { signal: 'yüksek', ratio: Math.round(ratio * 10) / 10, description: 'Ortalamanın üstünde hacim' };
    if (ratio < 0.5) return { signal: 'düşük', ratio: Math.round(ratio * 10) / 10, description: 'Düşük hacim — ilgi azalmış' };
    return { signal: 'normal', ratio: Math.round(ratio * 10) / 10, description: 'Normal hacim seyrinde' };
  }

  private checkSupportResistance(
    current: number | undefined,
    high: number | undefined,
    low: number | undefined,
  ): { nearSupport: boolean; nearResistance: boolean; note: string } {
    if (!current || !high || !low) return { nearSupport: false, nearResistance: false, note: 'Veri yetersiz' };
    const range = high - low;
    if (range === 0) return { nearSupport: false, nearResistance: false, note: 'Dar bant' };

    const nearSupport = (current - low) / range < 0.1;
    const nearResistance = (high - current) / range < 0.1;

    let note = 'Orta bölgede';
    if (nearSupport) note = 'Destek seviyesi yakınında — dönüş olabilir';
    if (nearResistance) note = 'Direnç seviyesi yakınında — satış baskısı gelebilir';

    return { nearSupport, nearResistance, note };
  }

  private determineDirection(
    priceChange: number | undefined,
    momentum: { label: string; strength: number },
    volumeSignal: string,
  ): { label: string; confidence: number; emoji: string } {
    let score = 0;
    if (priceChange !== undefined) score += priceChange > 0 ? 1 : -1;
    score += momentum.strength;
    if (volumeSignal === 'çok_yüksek') score += momentum.strength > 0 ? 0.5 : -0.5;

    if (score > 1) return { label: 'YUKARI', confidence: Math.min(0.9, score / 3), emoji: '📈' };
    if (score < -1) return { label: 'AŞAĞI', confidence: Math.min(0.9, Math.abs(score) / 3), emoji: '📉' };
    return { label: 'YATAY', confidence: 0.3, emoji: '➡️' };
  }

  private getChangeEmoji(change: number): string {
    if (change > 3) return '🚀';
    if (change > 1) return '📈';
    if (change > 0) return '↗️';
    if (change > -1) return '↘️';
    if (change > -3) return '📉';
    return '💥';
  }

  private suggestPositionSize(amount: number, volatility: number, riskTolerance: string): { amount: number; percent: number; reason: string } {
    const maxRiskPercent = riskTolerance === 'high' ? 0.1 : riskTolerance === 'medium' ? 0.05 : 0.02;
    const volAdjust = Math.max(0.3, 1 - volatility / 20);
    const suggested = Math.round(amount * maxRiskPercent * volAdjust);
    const percent = Math.round((suggested / amount) * 100);
    return {
      amount: suggested,
      percent,
      reason: `Risk toleransın (${riskTolerance}) ve volatiliteye (${volatility}%) göre toplam bakiyenin %${percent}'i`,
    };
  }

  private checkSuitability(volatility: number, riskTolerance: string): { suitable: boolean; reason: string } {
    if (riskTolerance === 'low' && volatility > 10) {
      return { suitable: false, reason: 'Düşük risk toleransın için bu varlık çok dalgalı' };
    }
    if (riskTolerance === 'medium' && volatility > 20) {
      return { suitable: false, reason: 'Orta risk toleransın için volatilite çok yüksek' };
    }
    return { suitable: true, reason: 'Risk profiline uygun' };
  }
}
