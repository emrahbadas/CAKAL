import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Travel Hunter — Seyahat Avcısı
 *
 * Uçak bileti ve otel fiyatlarında zaman baskısı olan fırsatları bulur.
 * Kullanıcının seyahat tercihlerini profilden okur.
 * Son dakika fırsatları, kampanyaları ve fiyat anomalilerini tespit eder.
 */
export class TravelHunterAgent extends BaseAgent {
  readonly name = 'travel' as const;
  readonly description = 'Uçak bileti ve otel fırsatlarını takip eder, seyahat fırsatları sunar';

  // Popüler havaalanları
  private readonly turkishAirports: Record<string, string> = {
    IST: 'İstanbul',
    SAW: 'Sabiha Gökçen',
    ESB: 'Ankara Esenboğa',
    ADB: 'İzmir',
    AYT: 'Antalya',
    DLM: 'Dalaman',
    BJV: 'Bodrum',
    TZX: 'Trabzon',
    GZT: 'Gaziantep',
  };

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const action = input.data?.action as string;

      switch (action) {
        case 'analyze_flight_deal':
          return this.analyzeFlightDeal(input, context, startTime);
        case 'analyze_hotel_deal':
          return this.analyzeHotelDeal(input, startTime);
        case 'find_best_dates':
          return this.findBestDates(input, startTime);
        case 'trip_budget':
          return this.calculateTripBudget(input, startTime);
        default:
          return this.buildResult(true, {
            action: 'info',
            message: 'Travel Hunter hazır. Desteklenen aksiyonlar: analyze_flight_deal, analyze_hotel_deal, find_best_dates, trip_budget',
            airports: this.turkishAirports,
          }, startTime);
      }
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  /**
   * Uçak bileti fırsatını analiz eder
   */
  private analyzeFlightDeal(input: AgentInput, context: AgentContext, startTime: number): AgentRunResult {
    const from = input.data?.from as string;
    const to = input.data?.to as string;
    const price = input.data?.price as number;
    const averagePrice = input.data?.averagePrice as number;
    const airline = input.data?.airline as string;
    const departDate = input.data?.departDate as string;
    const returnDate = input.data?.returnDate as string;
    const isDirect = input.data?.isDirect as boolean;
    const baggageIncluded = input.data?.baggageIncluded as boolean;

    if (!from || !to || !price) {
      return this.buildResult(false, null, startTime, 'Kalkış, varış ve fiyat bilgisi gerekli');
    }

    // Fiyat analizi
    const discount = averagePrice ? ((averagePrice - price) / averagePrice) * 100 : undefined;
    const isGoodDeal = discount !== undefined ? discount >= 15 : undefined;

    // Tarih analizi
    const dateAnalysis = this.analyzeDates(departDate, returnDate);

    // Rota kalite skoru
    const routeScore = this.calculateRouteScore(isDirect, baggageIncluded, discount, dateAnalysis.isFlexible);

    // Seyahat tercihleri
    const budgetComfort = (context.userProfile as Record<string, unknown>)?.capitalComfort as number;
    const withinBudget = budgetComfort ? price <= budgetComfort * 0.3 : undefined;

    return this.buildResult(true, {
      action: 'flight_analysis',
      route: { from, to, fromCity: this.turkishAirports[from], toCity: this.turkishAirports[to] },
      price,
      averagePrice,
      discount: discount !== undefined ? Math.round(discount * 10) / 10 : undefined,
      isGoodDeal,
      airline,
      dates: dateAnalysis,
      features: { isDirect, baggageIncluded },
      routeScore,
      withinBudget,
      verdict: this.getFlightVerdict(discount, isDirect, dateAnalysis),
      tips: this.getFlightTips(from, to, departDate),
    }, startTime);
  }

  /**
   * Otel fırsatını analiz eder
   */
  private analyzeHotelDeal(input: AgentInput, startTime: number): AgentRunResult {
    const hotel = input.data?.hotel as string;
    const city = input.data?.city as string;
    const pricePerNight = input.data?.pricePerNight as number;
    const averagePrice = input.data?.averagePrice as number;
    const rating = input.data?.rating as number;
    const stars = input.data?.stars as number;
    const nights = input.data?.nights as number || 1;
    const hasBreakfast = input.data?.hasBreakfast as boolean;
    const hasFreeCancellation = input.data?.hasFreeCancellation as boolean;

    if (!city || !pricePerNight) {
      return this.buildResult(false, null, startTime, 'Şehir ve gecelik fiyat gerekli');
    }

    const totalPrice = pricePerNight * nights;
    const discount = averagePrice ? ((averagePrice - pricePerNight) / averagePrice) * 100 : undefined;

    // Değer skoru: fiyat vs kalite
    const valueScore = this.calculateHotelValueScore(pricePerNight, rating, stars, hasBreakfast, hasFreeCancellation);

    return this.buildResult(true, {
      action: 'hotel_analysis',
      hotel: hotel || 'Belirtilmemiş',
      city,
      pricePerNight,
      nights,
      totalPrice,
      averagePrice,
      discount: discount !== undefined ? Math.round(discount * 10) / 10 : undefined,
      rating,
      stars,
      features: { hasBreakfast, hasFreeCancellation },
      valueScore,
      verdict: this.getHotelVerdict(valueScore, discount),
      tips: this.getHotelTips(city, nights),
    }, startTime);
  }

  /**
   * En uygun seyahat tarihlerini önerir
   */
  private findBestDates(input: AgentInput, startTime: number): AgentRunResult {
    const destination = input.data?.destination as string;
    const month = input.data?.month as number;
    const flexibility = input.data?.flexibilityDays as number || 3;

    if (!destination) {
      return this.buildResult(false, null, startTime, 'Hedef destinasyon gerekli');
    }

    // Genel seyahat takvimi bilgisi
    const seasonInfo = this.getSeasonInfo(destination, month);
    const peakDays = this.getPeakDays(month);

    return this.buildResult(true, {
      action: 'best_dates',
      destination,
      month,
      flexibility,
      seasonInfo,
      peakDays,
      recommendations: [
        'Hafta ortası uçuşları genellikle %15-25 daha ucuz',
        `±${flexibility} gün esneklik ile en iyi fiyat yakalanır`,
        'Salı ve Çarşamba en ucuz uçuş günleri',
        'Dönüş biletinde Pazar yerine Pazartesi tercih et',
      ],
    }, startTime);
  }

  /**
   * Seyahat bütçesi hesaplar
   */
  private calculateTripBudget(input: AgentInput, startTime: number): AgentRunResult {
    const destination = input.data?.destination as string;
    const nights = input.data?.nights as number || 3;
    const travelers = input.data?.travelers as number || 1;
    const hotelBudgetPerNight = input.data?.hotelBudget as number;
    const flightBudget = input.data?.flightBudget as number;
    const style = input.data?.style as string || 'medium'; // budget, medium, luxury

    if (!destination) {
      return this.buildResult(false, null, startTime, 'Hedef destinasyon gerekli');
    }

    const dailyExpenses = this.estimateDailyExpenses(destination, style);

    const budget = {
      flights: flightBudget || dailyExpenses.estimatedFlight * travelers,
      hotel: (hotelBudgetPerNight || dailyExpenses.estimatedHotel) * nights,
      food: dailyExpenses.food * nights * travelers,
      transport: dailyExpenses.localTransport * nights * travelers,
      activities: dailyExpenses.activities * nights * travelers,
      misc: dailyExpenses.misc * nights * travelers,
    };

    const total = Object.values(budget).reduce((a, b) => a + b, 0);

    return this.buildResult(true, {
      action: 'trip_budget',
      destination,
      nights,
      travelers,
      style,
      breakdown: {
        flights: Math.round(budget.flights),
        hotel: Math.round(budget.hotel),
        food: Math.round(budget.food),
        transport: Math.round(budget.transport),
        activities: Math.round(budget.activities),
        misc: Math.round(budget.misc),
      },
      total: Math.round(total),
      perPerson: Math.round(total / travelers),
      perDay: Math.round(total / nights),
      savingTips: this.getBudgetSavingTips(style, destination),
    }, startTime);
  }

  // --- Yardımcı Fonksiyonlar ---

  private analyzeDates(depart?: string, returnDate?: string): { isFlexible: boolean; daysUntilDepart?: number; tripDuration?: number; isWeekend: boolean; note: string } {
    if (!depart) return { isFlexible: true, isWeekend: false, note: 'Tarih belirtilmemiş — esnek arama yapılabilir' };

    const departDate = new Date(depart);
    const now = new Date();
    const daysUntilDepart = Math.floor((departDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const dayOfWeek = departDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

    let tripDuration: number | undefined;
    if (returnDate) {
      tripDuration = Math.floor((new Date(returnDate).getTime() - departDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    let note = '';
    if (daysUntilDepart < 3) note = 'Son dakika fırsatı — fiyat oynak olabilir';
    else if (daysUntilDepart < 14) note = 'Kısa vadeli — iyi fiyat yakala';
    else if (daysUntilDepart > 60) note = 'Erken rezervasyon — fiyat düşebilir, takipte kal';
    else note = 'İdeal rezervasyon penceresi';

    return { isFlexible: false, daysUntilDepart, tripDuration, isWeekend, note };
  }

  private calculateRouteScore(isDirect?: boolean, baggage?: boolean, discount?: number, isFlexible?: boolean): number {
    let score = 50;
    if (isDirect) score += 15;
    if (baggage) score += 10;
    if (discount !== undefined && discount >= 20) score += 20;
    else if (discount !== undefined && discount >= 10) score += 10;
    if (isFlexible) score += 5;
    return Math.min(100, score);
  }

  private getFlightVerdict(discount?: number, isDirect?: boolean, dateAnalysis?: { note: string }): { label: string; emoji: string } {
    if (discount !== undefined && discount >= 25 && isDirect) return { label: 'KAÇIRMA', emoji: '🔥' };
    if (discount !== undefined && discount >= 15) return { label: 'İYİ FIRSAT', emoji: '✈️' };
    if (discount !== undefined && discount >= 5) return { label: 'MAKUL', emoji: '👍' };
    return { label: 'NORMAL FİYAT', emoji: '➡️' };
  }

  private calculateHotelValueScore(price: number, rating?: number, stars?: number, breakfast?: boolean, freeCancellation?: boolean): number {
    let score = 50;
    if (rating && rating >= 8.5) score += 20;
    else if (rating && rating >= 7) score += 10;
    if (stars && stars >= 4 && price < 1500) score += 15;
    if (breakfast) score += 10;
    if (freeCancellation) score += 10;
    if (price < 500) score += 10;
    return Math.min(100, score);
  }

  private getHotelVerdict(valueScore: number, discount?: number): { label: string; emoji: string } {
    if (valueScore >= 80 && discount !== undefined && discount >= 20) return { label: 'SÜPER FIRSAT', emoji: '🏆' };
    if (valueScore >= 70) return { label: 'İYİ DEĞER', emoji: '🏨' };
    if (valueScore >= 50) return { label: 'MAKUL', emoji: '👍' };
    return { label: 'PAHALIYA DEĞMEYEBİLİR', emoji: '⚠️' };
  }

  private getSeasonInfo(destination: string, month?: number): { season: string; crowdLevel: string; priceLevel: string } {
    const m = month || new Date().getMonth() + 1;

    // Türkiye iç turizm sezonu
    if (m >= 6 && m <= 8) return { season: 'yüksek', crowdLevel: 'çok kalabalık', priceLevel: 'en pahalı dönem' };
    if (m >= 4 && m <= 5 || m >= 9 && m <= 10) return { season: 'ara', crowdLevel: 'orta', priceLevel: 'makul fiyatlar' };
    return { season: 'düşük', crowdLevel: 'sakin', priceLevel: 'en uygun dönem' };
  }

  private getPeakDays(month?: number): string[] {
    const m = month || new Date().getMonth() + 1;
    const peaks = ['Bayram tatilleri', 'Yarıyıl tatili (Ocak sonu)'];
    if (m === 4) peaks.push('23 Nisan tatili');
    if (m === 5) peaks.push('19 Mayıs tatili');
    if (m === 8) peaks.push('30 Ağustos tatili');
    if (m === 10) peaks.push('29 Ekim tatili');
    if (m === 12) peaks.push('Yılbaşı dönemi');
    return peaks;
  }

  private getFlightTips(from?: string, to?: string, departDate?: string): string[] {
    const tips: string[] = [
      'Gizli sekme veya farklı tarayıcı kullan — çerez bazlı fiyat artışı yaygın',
      'Bilet fiyatları Salı-Çarşamba en düşük, Cuma-Pazar en yüksek',
    ];
    if (from && this.turkishAirports[from]) tips.push(`${this.turkishAirports[from]} yerine alternatif havaalanı kontrol et`);
    return tips;
  }

  private getHotelTips(city: string, nights: number): string[] {
    const tips: string[] = [];
    if (nights >= 3) tips.push('3+ gece konaklama için otelden direkt indirim iste');
    tips.push('Booking.com Genius indirimleri için ücretsiz üyelik aç');
    tips.push('Otel yerine Airbnb karşılaştır — uzun konaklamada genellikle daha ucuz');
    return tips;
  }

  private estimateDailyExpenses(destination: string, style: string): {
    estimatedFlight: number; estimatedHotel: number; food: number;
    localTransport: number; activities: number; misc: number;
  } {
    const multiplier = style === 'luxury' ? 2.5 : style === 'budget' ? 0.5 : 1;

    // Türkiye iç destinasyon varsayılan (TL)
    return {
      estimatedFlight: Math.round(1500 * multiplier),
      estimatedHotel: Math.round(800 * multiplier),
      food: Math.round(300 * multiplier),
      localTransport: Math.round(100 * multiplier),
      activities: Math.round(200 * multiplier),
      misc: Math.round(100 * multiplier),
    };
  }

  private getBudgetSavingTips(style: string, destination: string): string[] {
    if (style === 'budget') return [
      'Hostelleri değerlendir',
      'Sokak lezzetleri restoranlardan %60 daha ucuz',
      'Ücretsiz yürüyüş turlarına katıl',
    ];
    return [
      'Erken rezervasyon ile %10-20 tasarruf',
      'Paket tur yerine ayrı al — genellikle daha ucuz',
      'Yerel SIM kart al, roaming ücretinden kaçın',
    ];
  }
}
