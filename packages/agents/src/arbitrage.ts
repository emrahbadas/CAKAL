import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Arbitrage Agent — Arbitraj Ajanı
 *
 * Aynı veya benzer ürünlerin yerli-global fiyat farklarını analiz eder.
 * AliExpress → Trendyol, DHGate → Sahibinden gibi senaryoları işler.
 * Kargo, gümrük ve dönüşüm maliyetlerini hesaba katar.
 */
export class ArbitrageAgent extends BaseAgent {
  readonly name = 'arbitrage' as const;
  readonly description = 'Yerli-global fiyat farklarını analiz eder, arbitraj fırsatları bulur';

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const action = input.data?.action as string;

      switch (action) {
        case 'analyze_price_gap':
          return this.analyzePriceGap(input, startTime);
        case 'calculate_landed_cost':
          return this.calculateLandedCost(input, startTime);
        case 'rank_arbitrage_opportunities':
          return this.rankOpportunities(input, context, startTime);
        default:
          return this.buildResult(true, {
            action: 'info',
            message: 'Arbitrage Agent hazır. Desteklenen aksiyonlar: analyze_price_gap, calculate_landed_cost, rank_arbitrage_opportunities',
          }, startTime);
      }
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  /**
   * İki platform arasındaki fiyat farkını analiz eder
   */
  private analyzePriceGap(input: AgentInput, startTime: number): AgentRunResult {
    const product = input.data?.product as string;
    const sourcePlatform = input.data?.sourcePlatform as string;
    const targetPlatform = input.data?.targetPlatform as string;
    const sourcePrice = input.data?.sourcePrice as number;
    const targetPrice = input.data?.targetPrice as number;
    const currency = input.data?.currency as string || 'USD';
    const exchangeRate = input.data?.exchangeRate as number || 34.5; // USD/TRY default

    if (!product || !sourcePrice || !targetPrice) {
      return this.buildResult(false, null, startTime, 'Ürün adı, kaynak fiyatı ve hedef fiyat gerekli');
    }

    // Kaynak fiyatı TL'ye çevir
    const sourcePriceTRY = currency === 'TRY' ? sourcePrice : sourcePrice * exchangeRate;

    // Brüt fark
    const grossGap = targetPrice - sourcePriceTRY;
    const grossMarginPercent = (grossGap / sourcePriceTRY) * 100;

    // Tahmini maliyetler
    const estimatedCosts = this.estimateCosts(sourcePriceTRY, sourcePlatform || 'aliexpress');

    // Net kâr
    const netProfit = grossGap - estimatedCosts.total;
    const netMarginPercent = (netProfit / sourcePriceTRY) * 100;

    // Değerlendirme
    const verdict = this.getVerdict(netMarginPercent);

    return this.buildResult(true, {
      action: 'price_gap_analysis',
      product,
      sourcePlatform: sourcePlatform || 'bilinmiyor',
      targetPlatform: targetPlatform || 'bilinmiyor',
      sourcePrice: { original: sourcePrice, currency, tl: Math.round(sourcePriceTRY) },
      targetPrice: { tl: targetPrice },
      grossGap: Math.round(grossGap),
      grossMarginPercent: Math.round(grossMarginPercent * 10) / 10,
      estimatedCosts,
      netProfit: Math.round(netProfit),
      netMarginPercent: Math.round(netMarginPercent * 10) / 10,
      verdict,
    }, startTime);
  }

  /**
   * Toplam maliyet tahmini (kargo, gümrük, komisyon)
   */
  private calculateLandedCost(input: AgentInput, startTime: number): AgentRunResult {
    const productPriceTRY = input.data?.productPriceTRY as number;
    const sourcePlatform = input.data?.sourcePlatform as string || 'aliexpress';
    const weight = input.data?.weightKg as number || 0.5;
    const quantity = input.data?.quantity as number || 1;

    if (!productPriceTRY) {
      return this.buildResult(false, null, startTime, 'Ürün fiyatı (TL) gerekli');
    }

    const unitCost = productPriceTRY * quantity;

    // Kargo tahmini (ağırlık bazlı)
    const shippingPerKg = this.getShippingRatePerKg(sourcePlatform);
    const shippingCost = weight * quantity * shippingPerKg;

    // Gümrük vergisi (150€ üzeri sipariş için %20 KDV + %8 gümrük)
    const euroRate = 38; // EUR/TRY yaklaşık
    const thresholdTRY = 150 * euroRate; // ~5700 TL
    let customsDuty = 0;
    if (unitCost > thresholdTRY) {
      customsDuty = unitCost * 0.28; // %20 KDV + %8 gümrük
    }

    // Platform komisyonu (satış tarafı)
    const sellingCommission = unitCost * 0.12; // %12 ortalama e-ticaret komisyonu

    const totalLandedCost = unitCost + shippingCost + customsDuty + sellingCommission;

    return this.buildResult(true, {
      action: 'landed_cost',
      productPriceTRY: unitCost,
      quantity,
      weightKg: weight * quantity,
      shippingCost: Math.round(shippingCost),
      customsDuty: Math.round(customsDuty),
      customsApplied: unitCost > thresholdTRY,
      sellingCommission: Math.round(sellingCommission),
      totalLandedCost: Math.round(totalLandedCost),
      breakEvenSellingPrice: Math.round(totalLandedCost * 1.05), // %5 minimum marj
    }, startTime);
  }

  /**
   * Birden fazla arbitraj fırsatını sıralar
   */
  private rankOpportunities(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const opportunities = input.data?.opportunities as Array<Record<string, unknown>> | undefined;

    if (!opportunities || opportunities.length === 0) {
      return this.buildResult(true, {
        action: 'ranked',
        ranked: [],
        message: 'Sıralanacak fırsat yok.',
      }, startTime);
    }

    const riskTolerance = (context.userProfile as Record<string, unknown>)?.riskTolerance as string || 'medium';

    const scored = opportunities.map((opp) => {
      const margin = opp.netMarginPercent as number || 0;
      const volume = opp.estimatedVolume as number || 1;
      const competitionLevel = opp.competitionLevel as string || 'medium';

      // Skor: marj ağırlığı + hacim bonusu - rekabet cezası
      let score = margin * 2;
      if (volume > 10) score += 10;
      if (volume > 50) score += 20;
      if (competitionLevel === 'low') score += 15;
      if (competitionLevel === 'high') score -= 15;

      // Risk profili ayarlaması
      if (riskTolerance === 'low' && margin < 20) score -= 20;
      if (riskTolerance === 'high' && margin > 30) score += 10;

      return { ...opp, arbitrageScore: Math.round(score) };
    });

    const ranked = scored.sort((a, b) => (b.arbitrageScore as number) - (a.arbitrageScore as number));

    return this.buildResult(true, {
      action: 'ranked',
      ranked,
      topPick: ranked[0],
      count: ranked.length,
    }, startTime);
  }

  private estimateCosts(sourcePriceTRY: number, platform: string) {
    const shippingRate = this.getShippingRatePerKg(platform);
    const estWeight = 0.5; // varsayılan 0.5 kg
    const shipping = shippingRate * estWeight;

    const euroRate = 38;
    const thresholdTRY = 150 * euroRate;
    const customs = sourcePriceTRY > thresholdTRY ? sourcePriceTRY * 0.28 : 0;

    const commission = sourcePriceTRY * 0.12;

    return {
      shipping: Math.round(shipping),
      customs: Math.round(customs),
      commission: Math.round(commission),
      total: Math.round(shipping + customs + commission),
    };
  }

  private getShippingRatePerKg(platform: string): number {
    const rates: Record<string, number> = {
      aliexpress: 120,
      dhgate: 150,
      '1688': 180,
      amazon: 200,
      ebay: 180,
    };
    return rates[platform.toLowerCase()] || 160;
  }

  private getVerdict(netMarginPercent: number): { label: string; emoji: string; description: string } {
    if (netMarginPercent >= 40) {
      return { label: 'MÜKEMMEL', emoji: '🟢', description: 'Yüksek kâr marjı — hemen hareket et' };
    }
    if (netMarginPercent >= 25) {
      return { label: 'İYİ', emoji: '🟡', description: 'Sağlam arbitraj — hacimle skala et' };
    }
    if (netMarginPercent >= 10) {
      return { label: 'ORTA', emoji: '🟠', description: 'Makul marj — maliyetleri yakından izle' };
    }
    if (netMarginPercent >= 0) {
      return { label: 'DÜŞÜK', emoji: '🔴', description: 'Dar marj — beklenmedik maliyetler silecektir' };
    }
    return { label: 'ZARAR', emoji: '⛔', description: 'Bu senaryoda para kaybedersin' };
  }
}
