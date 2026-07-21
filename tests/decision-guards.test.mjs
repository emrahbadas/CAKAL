import { describe, expect, it } from 'vitest';
import guardsModule from '../apps/desktop/electron/decision-guards.cjs';

const {
  classifyAssetClass,
  evaluateCommanderDecisionGate,
  evaluateRiskGate,
  evaluateVerdictEvidenceLock,
  detectEquityVerdict,
  neutralizeEquityVerdicts,
} = guardsModule;

describe('decision-guards', () => {
  describe('classifyAssetClass', () => {
    it('classifies common asset families', () => {
      expect(classifyAssetClass('BTCUSDT')).toBe('crypto');
      expect(classifyAssetClass('USDTRY')).toBe('fx');
      expect(classifyAssetClass('XAUUSD')).toBe('commodity');
      expect(classifyAssetClass('SISE')).toBe('equity');
    });
  });

  describe('evaluateCommanderDecisionGate', () => {
    it('returns veri_yetersiz when actionable finance request has no market data tools', () => {
      const result = evaluateCommanderDecisionGate('Bugün trade edilecek 3 hisse ver', 'AL: SISE');
      expect(result).not.toBeNull();
      expect(result.status).toBe('veri_yetersiz');
      expect(result.response).toContain('VERI_YETERSIZ');
    });

    it('returns no_signal when market data exists but decision confirmation is missing', () => {
      const result = evaluateCommanderDecisionGate(
        'Bugün trade edilecek 3 hisse ver',
        'AL: SISE',
        [{ type: 'tool_call', tool: 'get_stock_price', timestamp: Date.now() }],
      );
      expect(result).not.toBeNull();
      expect(result.status).toBe('no_signal');
      expect(result.response).toContain('NO_SIGNAL');
    });

    it('does not gate informational request even if only get_stock_price is used', () => {
      const result = evaluateCommanderDecisionGate(
        'Borsada durum nedir, bugünün en çok artan hisselerini konuşalım',
        'Bugün XU100 tarafında güçlü hareket var.',
        [{ type: 'tool_call', tool: 'get_stock_price', timestamp: Date.now() }],
      );
      expect(result).toBeNull();
    });

    it('passes when both market data and decision tools are present', () => {
      const result = evaluateCommanderDecisionGate(
        'Bugün trade edilecek 3 hisse ver',
        'NO_SIGNAL',
        [
          { type: 'tool_call', tool: 'get_stock_price', timestamp: Date.now() },
          { type: 'tool_call', tool: 'judge_opportunity', timestamp: Date.now() },
        ],
      );
      expect(result).toBeNull();
    });

    it('blocks fresh market scan based only on recent gainers', () => {
      const result = evaluateCommanderDecisionGate(
        'BIST icin sifirdan sepet cikar, hangi hisseler AL olur?',
        'AL: SISE, THYAO',
        [
          { type: 'tool_call', tool: 'get_bist_gainers', timestamp: Date.now() },
          { type: 'tool_call', tool: 'judge_opportunity', timestamp: Date.now() },
        ],
      );
      expect(result).not.toBeNull();
      expect(result.status).toBe('veri_yetersiz');
      expect(result.response).toContain('Fresh market scan');
      expect(result.response).toContain('en cok artanlar');
    });

    it('passes fresh market scan gate when evidence tools are used too', () => {
      const result = evaluateCommanderDecisionGate(
        'BIST icin sifirdan sepet cikar, hangi hisseler AL olur?',
        'NO_SIGNAL',
        [
          { type: 'tool_call', tool: 'get_bist_gainers', timestamp: Date.now() },
          { type: 'tool_call', tool: 'web_search', timestamp: Date.now() },
          { type: 'tool_call', tool: 'verify_claim', timestamp: Date.now() },
          { type: 'tool_call', tool: 'judge_opportunity', timestamp: Date.now() },
        ],
      );
      expect(result).toBeNull();
    });

    it('does not gate informational finance requests even if response includes BEKLE', () => {
      const result = evaluateCommanderDecisionGate(
        'Bugün borsada genel durum nasıl, kısa bir özet tablo yap',
        'Genel görünüm nötr-pozitif. BEKLE yaklaşımı uygun olabilir.',
        [],
      );
      expect(result).toBeNull();
    });

    it('does not gate product marketplace buy-sell opportunity queries', () => {
      const result = evaluateCommanderDecisionGate(
        'İş anlamında ürün al sat fırsatları var mı, sahibinden ve trendyol bak',
        'Bulunan ilanlar arasında 3 fırsat adayı var.',
        [{ type: 'tool_call', tool: 'search_opportunities', timestamp: Date.now() }],
      );
      expect(result).toBeNull();
    });
  });

  describe('evaluateRiskGate', () => {
    it('blocks low-risk equity when volatility exceeds threshold', () => {
      const result = evaluateRiskGate({
        asset: 'SISE',
        riskTolerance: 'low',
        volatility: 6.2,
        sampleSize: 30,
        sourceReliability: 85,
        confidence: 80,
        patternAgeDays: 1,
        contradictorySources: 0,
        signalRiskLevel: 'medium',
      });

      expect(result.passed).toBe(false);
      expect(result.status).toBe('no_signal');
      expect(result.reasons.some((reason) => reason.includes('Volatilite'))).toBe(true);
    });

    it('returns veri_yetersiz when required metrics are missing', () => {
      const result = evaluateRiskGate({
        asset: 'BTCUSDT',
        riskTolerance: 'medium',
        volatility: 8,
      });

      expect(result.passed).toBe(false);
      expect(result.status).toBe('veri_yetersiz');
    });

    it('passes when metrics satisfy the thresholds', () => {
      const result = evaluateRiskGate({
        asset: 'XU100',
        riskTolerance: 'medium',
        volatility: 4.1,
        sampleSize: 30,
        sourceReliability: 82,
        confidence: 74,
        patternAgeDays: 1,
        contradictorySources: 0,
        signalRiskLevel: 'low',
      });

      expect(result.passed).toBe(true);
      expect(result.status).toBe('pass');
    });
  });

  describe('profile setup context', () => {
    it('does not gate a profile-onboarding answer even when it mentions "al sat"', () => {
      const message = [
        'Risk toleransı: orta ama fırsat durumuna göre yükseğe yaklaşabilir.',
        'Yatırım vade: 6 ay',
        'Maksimum kayıp: %25',
        'Deprem riski yüksek emlak bölgeleri mülk edinme için değil Al sat için düşünülebilir.',
      ].join('\n');
      const response = 'Profilini kaydettim. Yatırım hedeflerin: sermaye büyütme. Sektörler: bankacılık, savunma. Kısa özet hazır.';

      const result = evaluateCommanderDecisionGate(message, response, [
        { type: 'tool_call', tool: 'remember_user_fact', timestamp: Date.now() },
        { type: 'tool_call', tool: 'update_user_profile', timestamp: Date.now() },
      ]);
      expect(result).toBeNull();
    });

    it('still gates when a profile-setup response sneaks in an explicit verdict', () => {
      const message = 'Risk toleransım orta, yatırım vadem 6 ay. Bu arada hangi hisse alınır?';
      const response = 'Profilini kaydettim. KARAR: AL — SISE hemen alınmalı.';

      const result = evaluateCommanderDecisionGate(message, response, [
        { type: 'tool_call', tool: 'remember_user_fact', timestamp: Date.now() },
      ]);
      expect(result).not.toBeNull();
      expect(result.status).toBe('veri_yetersiz');
    });
  });

  describe('evaluateVerdictEvidenceLock', () => {
    const FULL_EVIDENCE_RESPONSE = [
      'KRDMA analizi:',
      'Değerleme: F/K 8.4, PD/DD 1.1 — sektör medyanına yakın.',
      'Dönemsel: 2026/03 hasılatı 2025/03 dönemine göre %18 arttı.',
      'Kaynak: İş Yatırım MaliTablo (KAP raporlarının sayısal karşılığı), KAP bildirimi 12.06.2026.',
      'Veri zamanı: 21.07.2026 14:10, fiyatlar 15dk gecikmeli.',
      'Risk: orta — stop 28.40 altı, geçersizlik koşulu haftalık kapanışla bozulma.',
      'KARAR: AL (geri çekilmede kademeli).',
    ].join('\n');

    it('locks an AL verdict lacking valuation and period comparison', () => {
      const response = [
        'KRDMA güçlü görünüyor, hacim artıyor.',
        'Kaynak: İş Yatırım verisi, saat 14:13 itibarıyla 15dk gecikmeli.',
        'Risk: orta, stop 28.40.',
        'KRDMA → AL',
      ].join('\n');

      const result = evaluateVerdictEvidenceLock('KRDMA hissesi al sat analizi yap', response);
      expect(result).not.toBeNull();
      expect(result.status).toBe('verdict_locked');
      expect(result.missing.join(' ')).toContain('Değerleme');
      expect(result.missing.join(' ')).toContain('Dönemsel');
      expect(result.response).toContain('KARAR KİLİDİ');
      expect(result.response).toContain('→ İNCELE');
      expect(result.response).not.toMatch(/→\s*AL\b/);
    });

    it('does not lock when the full evidence stack is present', () => {
      const result = evaluateVerdictEvidenceLock('KRDMA hissesi alınır mı', FULL_EVIDENCE_RESPONSE);
      expect(result).toBeNull();
    });

    it('ignores responses without an explicit AL/SAT verdict', () => {
      const response = 'Borsada bugün sanayi hisseleri öne çıktı; al-sat önerisi vermiyorum, İNCELE seviyesinde takip.';
      expect(evaluateVerdictEvidenceLock('borsa durumu nedir', response)).toBeNull();
      expect(detectEquityVerdict(response)).toBe(false);
    });

    it('does not treat lowercase Turkish verbs or ALTIN-like words as verdicts', () => {
      const response = 'Altın tarafında ALTIN.S1 kontratı yatay; karar vermeden önce salı gününü bekle, alım fırsatı olabilir.';
      expect(detectEquityVerdict(response)).toBe(false);
    });

    it('does not apply to product marketplace messages', () => {
      const result = evaluateVerdictEvidenceLock(
        'sahibinden ürün fırsatı bul, alınır mı',
        'Bu ilan ucuz: KARAR: AL',
      );
      expect(result).toBeNull();
    });

    it('neutralizes SAT verdicts to RİSKLİ on locked lines', () => {
      const neutralized = neutralizeEquityVerdicts('SONUÇ: SAT — düşüş sürebilir.');
      expect(neutralized).toContain('SONUÇ: RİSKLİ');
      expect(neutralized).not.toMatch(/\bSAT\b/);
    });
  });
});
