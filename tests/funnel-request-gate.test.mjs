import { describe, it, expect } from 'vitest';

import funnel from '../apps/desktop/electron/candidate-funnel.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';
import guards from '../apps/desktop/electron/decision-guards.cjs';

const { buildFunnelRequestGate, FUNNEL_REQUEST_DECISIONS } = funnel;
const { requiresResearchContract, countDistinctTickers } = contract;
const { isCommanderFreshMarketScanRequest } = guards;

/**
 * YOL HARİTASI ADIM 5 — kademe 0 (REQUEST_GATE).
 *
 * Talimat açıktı: YENİ SINIFLANDIRICI YAZMA, mevcut `requiresResearchContract`
 * niyet skoruna bağla. İkinci bir niyet sınıflandırıcısı zamanla ayrışır ve
 * Adım 4'teki "iki hesap, zıt etiket" hatasını huni tarafında yeniden üretir.
 *
 * Huni yalnız PİYASA-GENELİ ADAY ARAMASI için açılır: kullanıcının adıyla
 * verdiği sembolleri karşılaştırmak aday seçimi değildir.
 */

// Gerçek çağrı yolunu taklit eder — kapı tek başına değil, bu üçlüyle çalışır.
function kapi(mesaj, priorEntities = []) {
  const complexity = requiresResearchContract(mesaj, { priorEntities });
  return buildFunnelRequestGate(complexity, {
    freshMarketScan: isCommanderFreshMarketScanRequest(mesaj),
    namedSymbolCount: countDistinctTickers(mesaj) || priorEntities.length,
  });
}

describe('huni açılan istekler', () => {
  const acilmali = [
    'bist en sağlam 3 hisseyi sırala',
    'hangi hisseler umut vadediyor',
    'piyasayı sıfırdan tara ve aday çıkar',
    'fırsat hisseleri neler',
    'borsada en güçlü 5 hisseyi sırala',
  ];

  for (const mesaj of acilmali) {
    it(`açılır: "${mesaj}"`, () => {
      const g = kapi(mesaj);
      expect(g.shouldOpen).toBe(true);
      expect(g.decision).toBe(FUNNEL_REQUEST_DECISIONS.OPEN);
    });
  }

  it('açık tarama talebi skor eşiği aranmadan açar', () => {
    // "piyasayı sıfırdan tara" mesajı genel finans SÖZLÜĞÜNE takılmıyordu;
    // tarama kalıbının kendisi piyasa bağlamı sayılır.
    expect(isCommanderFreshMarketScanRequest('piyasayı sıfırdan tara ve aday çıkar')).toBe(true);
  });
});

describe('huni açılmayan istekler', () => {
  it('kullanıcı sembolleri kendi verdiyse aday seçimi yoktur', () => {
    const g = kapi('BRSAN ve MEYSU hakkında son haberleri tara ve karşılaştır');
    expect(g.shouldOpen).toBe(false);
    expect(g.decision).toBe(FUNNEL_REQUEST_DECISIONS.SKIP_USER_SCOPED);
  });

  it('DEVRALINAN kapsam da kullanıcı kapsamıdır', () => {
    // Mesajda kod yok ama semboller önceki turda kullanıcıdan geldi.
    // Yalnız mesaja bakan bir kapı burada yanlışlıkla huni açardı.
    const g = kapi('bilanço + fiyatlama karşılaştırması da yap', ['BRSAN', 'MEYSU']);
    expect(g.shouldOpen).toBe(false);
    expect(g.decision).toBe(FUNNEL_REQUEST_DECISIONS.SKIP_USER_SCOPED);
  });

  it('tek sembollü işlem sorusu huni açmaz', () => {
    expect(kapi('THYAO bugün alınır mı').decision).toBe(FUNNEL_REQUEST_DECISIONS.SKIP_USER_SCOPED);
  });

  it('finans dışı mesaj huni açmaz', () => {
    expect(kapi('merhaba nasılsın').decision).toBe(FUNNEL_REQUEST_DECISIONS.SKIP_NOT_SCREENING);
  });

  it('pazaryeri mesajı huni açmaz', () => {
    expect(kapi('ikinci el telefon piyasası nasıl').shouldOpen).toBe(false);
  });
});

describe('kapı kendi niyet sınıflandırıcısını KURMAZ', () => {
  it('karar skorunu ve sinyallerini olduğu gibi taşır', () => {
    const complexity = requiresResearchContract('bist en sağlam 3 hisseyi sırala');
    const g = buildFunnelRequestGate(complexity, { freshMarketScan: true, namedSymbolCount: 0 });
    expect(g.score).toBe(complexity.score);
    expect(g.signals).toEqual(complexity.signals);
  });

  it('boş girdiyle çökmez ve muhafazakâr davranır', () => {
    const g = buildFunnelRequestGate();
    expect(g.shouldOpen).toBe(false);
    expect(g.decision).toBe(FUNNEL_REQUEST_DECISIONS.SKIP_NOT_SCREENING);
  });

  it('gerekçe her kararda dolu gelir (denetlenebilirlik)', () => {
    for (const mesaj of ['bist en iyi hisseler', 'merhaba', 'THYAO alınır mı']) {
      expect(kapi(mesaj).reason.length).toBeGreaterThan(10);
    }
  });
});
