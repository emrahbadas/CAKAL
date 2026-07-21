import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Street Hunter — Sokak Avcısı
 *
 * İlan metinlerinde aciliyet sinyali arar: 'acil', 'nakit lazım', 'hemen'.
 * Pazarlık potansiyeli olan ilanlar için kısa mesaj taslağı önerir.
 * Fırsat penceresi dar olanları öne çıkarır.
 */
export class StreetHunterAgent extends BaseAgent {
  readonly name = 'street-hunter' as const;
  readonly description = 'İlan metinlerinde aciliyet sinyali arar, pazarlık taslağı önerir';

  // Aciliyet sinyal kelimeleri ve ağırlıkları
  private readonly urgencySignals: Array<{ pattern: RegExp; weight: number; label: string }> = [
    { pattern: /acil\s*(sat[ıi]l[ıi]k|sat[ıi]ş)/i, weight: 0.9, label: 'acil satılık' },
    { pattern: /nakit\s*(lazım|ihtiyac|gerek)/i, weight: 0.95, label: 'nakit ihtiyacı' },
    { pattern: /hemen\s*(teslim|al|sat)/i, weight: 0.8, label: 'hemen teslim' },
    { pattern: /bugün\s*(sat[ıi]l[ıi]r|verilir|gider)/i, weight: 0.85, label: 'bugün satılır' },
    { pattern: /fiyat\s*(düş|indirdim|kırdım)/i, weight: 0.7, label: 'fiyat indirimi' },
    { pattern: /taşın(ıyorum|ma|acağım)/i, weight: 0.75, label: 'taşınma' },
    { pattern: /yurt\s*dışı/i, weight: 0.7, label: 'yurt dışı çıkışı' },
    { pattern: /son\s*(fiyat|gün|hafta)/i, weight: 0.65, label: 'son teklif' },
    { pattern: /çok\s*(uygun|ucuz|hesaplı)/i, weight: 0.5, label: 'uygun fiyat' },
    { pattern: /değerinin\s*altında/i, weight: 0.85, label: 'değerinin altında' },
    { pattern: /adet\s*kald[ıi]/i, weight: 0.6, label: 'sınırlı stok' },
    { pattern: /pazarl[ıi]k\s*(yap[ıi]l[ıi]r|var|olur)/i, weight: 0.55, label: 'pazarlığa açık' },
    { pattern: /kelepir/i, weight: 0.9, label: 'kelepir' },
  ];

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const action = input.data?.action as string;

      switch (action) {
        case 'scan_urgency':
          return this.scanUrgency(input, startTime);
        case 'generate_bargain_message':
          return this.generateBargainMessage(input, context, startTime);
        case 'rank_street_deals':
          return this.rankStreetDeals(input, startTime);
        default:
          return this.buildResult(true, {
            action: 'info',
            message: 'Street Hunter hazır. Desteklenen aksiyonlar: scan_urgency, generate_bargain_message, rank_street_deals',
          }, startTime);
      }
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  /**
   * İlan metnini aciliyet sinyalleri için tarar
   */
  private scanUrgency(input: AgentInput, startTime: number): AgentRunResult {
    const listings = input.data?.listings as Array<Record<string, unknown>> | undefined;

    if (!listings || listings.length === 0) {
      return this.buildResult(true, {
        action: 'scanned',
        results: [],
        message: 'Taranacak ilan yok.',
      }, startTime);
    }

    const results = listings.map((listing) => {
      const title = (listing.title as string) || '';
      const description = (listing.description as string) || '';
      const fullText = `${title} ${description}`;

      const signals = this.detectSignals(fullText);
      const urgencyScore = this.calculateUrgencyScore(signals);
      const bargainPotential = this.estimateBargainPotential(signals, listing);

      return {
        listingId: listing.id,
        title,
        source: listing.source,
        price: listing.price,
        signals,
        urgencyScore,
        bargainPotential,
        recommendation: this.getRecommendation(urgencyScore, bargainPotential),
      };
    });

    // Yüksek aciliyetten düşüğe sırala
    const sorted = results.sort((a, b) => b.urgencyScore - a.urgencyScore);

    return this.buildResult(true, {
      action: 'scanned',
      totalScanned: listings.length,
      urgentCount: sorted.filter((r) => r.urgencyScore >= 0.7).length,
      bargainCount: sorted.filter((r) => r.bargainPotential >= 0.6).length,
      results: sorted,
    }, startTime);
  }

  /**
   * Pazarlık mesaj taslağı üretir
   */
  private generateBargainMessage(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const listing = input.data?.listing as Record<string, unknown>;
    const targetDiscount = input.data?.targetDiscount as number || 15;

    if (!listing) {
      return this.buildResult(false, null, startTime, 'İlan bilgisi gerekli');
    }

    const title = (listing.title as string) || 'ürün';
    const price = listing.price as number;
    const signals = this.detectSignals(`${listing.title || ''} ${listing.description || ''}`);

    // Kullanıcı pazarlık tarzını profil'den al
    const negotiationStyle = (context.userProfile as Record<string, unknown>)?.negotiationStyle as string || 'direct';

    const targetPrice = price ? Math.round(price * (1 - targetDiscount / 100)) : undefined;

    let message: string;
    if (negotiationStyle === 'direct') {
      message = this.buildDirectMessage(title, price, targetPrice, signals);
    } else {
      message = this.buildSoftMessage(title, price, targetPrice, signals);
    }

    return this.buildResult(true, {
      action: 'bargain_message',
      listing: { title, price },
      targetDiscount,
      targetPrice,
      message,
      negotiationTips: this.getNegotiationTips(signals),
    }, startTime);
  }

  /**
   * Sokak fırsatlarını sıralar
   */
  private rankStreetDeals(input: AgentInput, startTime: number): AgentRunResult {
    const deals = input.data?.deals as Array<Record<string, unknown>> | undefined;

    if (!deals || deals.length === 0) {
      return this.buildResult(true, {
        action: 'ranked',
        ranked: [],
        message: 'Sıralanacak fırsat yok.',
      }, startTime);
    }

    const scored = deals.map((deal) => {
      const fullText = `${deal.title || ''} ${deal.description || ''}`;
      const signals = this.detectSignals(fullText);
      const urgencyScore = this.calculateUrgencyScore(signals);
      const bargainPotential = this.estimateBargainPotential(signals, deal);

      // Bileşik skor: %60 aciliyet + %40 pazarlık potansiyeli
      const streetScore = Math.round((urgencyScore * 0.6 + bargainPotential * 0.4) * 100);

      return {
        ...deal,
        signals: signals.map((s) => s.label),
        urgencyScore,
        bargainPotential,
        streetScore,
      };
    });

    const ranked = scored.sort((a, b) => (b.streetScore as number) - (a.streetScore as number));

    return this.buildResult(true, {
      action: 'ranked',
      ranked,
      topPick: ranked[0],
      count: ranked.length,
    }, startTime);
  }

  // --- Yardımcı Fonksiyonlar ---

  private detectSignals(text: string): Array<{ label: string; weight: number }> {
    const found: Array<{ label: string; weight: number }> = [];
    for (const signal of this.urgencySignals) {
      if (signal.pattern.test(text)) {
        found.push({ label: signal.label, weight: signal.weight });
      }
    }
    return found;
  }

  private calculateUrgencyScore(signals: Array<{ weight: number }>): number {
    if (signals.length === 0) return 0;
    // En yüksek sinyali temel al, diğerlerinden bonus ekle
    const maxWeight = Math.max(...signals.map((s) => s.weight));
    const bonusFromOthers = signals
      .filter((s) => s.weight !== maxWeight)
      .reduce((sum, s) => sum + s.weight * 0.1, 0);
    return Math.min(1, maxWeight + bonusFromOthers);
  }

  private estimateBargainPotential(signals: Array<{ label: string; weight: number }>, listing: Record<string, unknown>): number {
    let potential = 0.3; // baz
    const hasUrgency = signals.some((s) => s.weight >= 0.8);
    const hasPriceFlexibility = signals.some((s) => s.label === 'pazarlığa açık' || s.label === 'fiyat indirimi');

    if (hasUrgency) potential += 0.3;
    if (hasPriceFlexibility) potential += 0.2;

    // Eski ilanlar daha fazla pazarlık payı
    const createdAt = listing.createdAt as string;
    if (createdAt) {
      const daysSinceCreated = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreated > 14) potential += 0.15;
      if (daysSinceCreated > 30) potential += 0.1;
    }

    return Math.min(1, potential);
  }

  private getRecommendation(urgencyScore: number, bargainPotential: number): string {
    if (urgencyScore >= 0.85 && bargainPotential >= 0.7) return 'HEMEN TEKLİF VER — altın fırsat';
    if (urgencyScore >= 0.7) return 'HIZLI HAREKET ET — pencere dar';
    if (bargainPotential >= 0.6) return 'PAZARLIK YAP — indirim potansiyeli yüksek';
    if (urgencyScore >= 0.5) return 'TAKİP ET — fiyat düşebilir';
    return 'İZLE — henüz acil değil';
  }

  private buildDirectMessage(title: string, price: number | undefined, targetPrice: number | undefined, signals: Array<{ label: string }>): string {
    const priceInfo = targetPrice ? `₺${targetPrice.toLocaleString('tr-TR')} teklif ediyorum.` : 'Fiyatınız uygunsa ilgileniyorum.';
    const reason = signals.length > 0 ? ` İlanınızda ${signals[0].label} ifadesini gördüm.` : '';
    return `Merhaba, ${title} ilanınız için ${priceInfo}${reason} Nakit ödeme yapabilirim, hemen alırım. Uygunsa haber verin.`;
  }

  private buildSoftMessage(title: string, price: number | undefined, targetPrice: number | undefined, signals: Array<{ label: string }>): string {
    const intro = `Merhaba, ${title} ilanınızı inceledim, çok güzel görünüyor.`;
    const priceAsk = targetPrice
      ? `Fiyatta biraz esneklik var mı? ₺${targetPrice.toLocaleString('tr-TR')} civarı düşünüyorum.`
      : 'Fiyatta biraz pazarlık payı var mı?';
    return `${intro} ${priceAsk} Ciddi alıcıyım.`;
  }

  private getNegotiationTips(signals: Array<{ label: string; weight: number }>): string[] {
    const tips: string[] = [];
    if (signals.some((s) => s.label === 'nakit ihtiyacı')) {
      tips.push('Nakit ödemeyi vurgula — satıcı acele ediyor');
    }
    if (signals.some((s) => s.label === 'taşınma' || s.label === 'yurt dışı çıkışı')) {
      tips.push('Hızlı teslim al — satıcı acil elden çıkarmak istiyor');
    }
    if (signals.some((s) => s.label === 'son teklif')) {
      tips.push('İlk teklifin son olmasın — düşünüyor numarası yap');
    }
    if (signals.some((s) => s.weight >= 0.85)) {
      tips.push('Çok agresif pazarlık yapma — kaçırma riski var');
    }
    if (tips.length === 0) {
      tips.push('%10-15 indirim iste, nakit ödeme avantajını kullan');
    }
    return tips;
  }
}
