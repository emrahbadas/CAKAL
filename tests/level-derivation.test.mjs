import { describe, it, expect } from 'vitest';

import guards from '../apps/desktop/electron/decision-guards.cjs';

const {
  evaluatePriceLevelProvenanceGate,
  collectMeasuredValues,
  parseLevelNumbers,
} = guards;

/**
 * SEVİYE TÜRETİMİ
 *
 * Kapı iki soruyu ayrı ayrı sormalı:
 *   1. Bu sembolde ölçüm YAPILDI MI?            (eskiden beri var)
 *   2. Cevaptaki bu RAKAM o ölçümden mi TÜREDİ?  (bu dosyanın konusu)
 *
 * CANLI HATA (11 Ağustos 2026): KCHOL cevabında 555 TL'ye "MA20 altı" dendi.
 * O turda MA20 hiç ölçülmemişti; ölçülen MA50 ≈ 553'tü. Ölçüm VARDI, rakam
 * ondan TÜREMEMİŞTİ ve kapı geçirdi. İkinci soru sorulmuyordu.
 *
 * Ayrıca sözleşme kapanmadan rakam çıkmamalı: hüküm kelimesi (AL/SAT) zaten
 * iniyordu ama rakam kaçabiliyordu. Kullanıcı açısından "AL demedim ama stop
 * 553 yaz" ile "AL" arasında pratik fark yoktur.
 */

const NOW = 1_760_000_000_000;

const measurementEvent = (symbol, values, classes = ['TECHNICAL_SIGNAL']) => ({
  type: 'tool_call',
  tool: 'analyze_finance_signal',
  entities: [symbol],
  evidenceClasses: classes,
  measurements: { [symbol]: values },
  timestamp: NOW - 60_000,
});

const answerWith = (symbol, line) => `## ${symbol}\nGörünüm nötr.\n${line}\n`;

describe('ölçüm değerlerinin toplanması', () => {
  it('sembolüne ait değerleri toplar', () => {
    const events = [measurementEvent('KCHOL', [553.2, 549.8])];
    expect(collectMeasuredValues(events, 'KCHOL')).toEqual([553.2, 549.8]);
  });

  it('başka sembolün ölçümünü sızdırmaz', () => {
    const events = [measurementEvent('THYAO', [312.5])];
    expect(collectMeasuredValues(events, 'KCHOL')).toEqual([]);
  });

  it('ölçüm taşımayan eski olaylar sorun çıkarmaz', () => {
    const events = [{ type: 'tool_call', tool: 'get_stock_price', entities: ['KCHOL'], timestamp: NOW }];
    expect(collectMeasuredValues(events, 'KCHOL')).toEqual([]);
  });
});

describe('seviye satırından sayı çıkarma', () => {
  it('TL ve ₺ biçimlerini okur', () => {
    expect(parseLevelNumbers('Stop ₺553,20 · giriş 549.80 TL')).toEqual([553.2, 549.8]);
  });

  it('yüzdeyi seviye saymaz', () => {
    // "%8 aşağıda" bir mesafedir, seviye değildir; 8'i çapa kontrolüne
    // sokmak her cevabı bloklardı.
    expect(parseLevelNumbers('Stop 553,20 TL (%8 aşağıda)')).toEqual([553.2]);
  });

  it('binlik ayıracını doğru çözer', () => {
    expect(parseLevelNumbers('Hedef ₺1.250,50')).toEqual([1250.5]);
  });
});

describe('KURAL B — rakam ölçümden türemeli', () => {
  it('ölçümle bağdaşan seviye geçer', () => {
    const events = [measurementEvent('KCHOL', [553.2])];
    const answer = answerWith('KCHOL', 'Stop 549,80 TL altında geçersizlik.');
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW)).toBeNull();
  });

  it('CANLI HATA REGRESYONU — ölçümle ilgisiz rakam bloklanır', () => {
    // Ölçüm var (553), stop 1 TL. Eski kapı bunu geçiriyordu çünkü yalnız
    // "ölçüm var mı" diye soruyordu.
    const events = [measurementEvent('KCHOL', [553.2])];
    const answer = answerWith('KCHOL', 'Stop 1,00 TL olarak belirlendi.');
    const lock = evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW);
    expect(lock).toBeTruthy();
    expect(lock.notDerivedSymbols).toEqual(['KCHOL']);
    expect(lock.reason).toContain('Türetilemeyen seviye');
    expect(lock.response).toContain('rakamın o ölçümden TÜREMESİ gerekir');
  });

  it('geniş band meşru hedefi bloklamaz', () => {
    // %60 yukarıdaki bir hedef meşrudur; dar band kapıyı gürültüye çevirirdi.
    const events = [measurementEvent('KCHOL', [500])];
    const answer = answerWith('KCHOL', 'Hedef 800,00 TL.');
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW)).toBeNull();
  });

  it('bir rakam çapasız olsa bile kapı ateşler', () => {
    const events = [measurementEvent('KCHOL', [553.2])];
    const answer = answerWith('KCHOL', 'Giriş 550,00 TL · stop 2,50 TL.');
    const lock = evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW);
    expect(lock.notDerivedSymbols).toEqual(['KCHOL']);
  });

  it('ölçüm değeri yoksa eski davranış korunur (yanlış pozitif yok)', () => {
    // Değer taşımayan eski olay: sınıf kanıtı yeterli sayılır.
    const events = [{
      type: 'tool_call',
      tool: 'analyze_finance_signal',
      entities: ['KCHOL'],
      evidenceClasses: ['TECHNICAL_SIGNAL'],
      timestamp: NOW - 60_000,
    }];
    const answer = answerWith('KCHOL', 'Stop 1,00 TL.');
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW)).toBeNull();
  });
});

describe('KURAL A — sözleşme kapanmadan seviye yok', () => {
  const events = [measurementEvent('KCHOL', [553.2])];
  const answer = answerWith('KCHOL', 'Stop 549,80 TL altında geçersizlik.');

  it('COMPLETE ise ölçümle bağdaşan seviye geçer', () => {
    const lock = evaluatePriceLevelProvenanceGate(
      'KCHOL alım', answer, events, NOW, { researchStatus: 'COMPLETE' },
    );
    expect(lock).toBeNull();
  });

  it('PARTIAL ise kanıt tam olsa bile rakam çıkamaz', () => {
    const lock = evaluatePriceLevelProvenanceGate(
      'KCHOL alım', answer, events, NOW, { researchStatus: 'PARTIAL' },
    );
    expect(lock).toBeTruthy();
    expect(lock.contractIncomplete).toBe(true);
    expect(lock.reason).toContain('PARTIAL');
    expect(lock.response).toContain('uygulanabilir');
  });

  it('BLOCKED ise de rakam çıkamaz', () => {
    const lock = evaluatePriceLevelProvenanceGate(
      'KCHOL alım', answer, events, NOW, { researchStatus: 'BLOCKED' },
    );
    expect(lock.contractIncomplete).toBe(true);
  });

  it('sözleşme yoksa (basit soru) kural A devreye girmez', () => {
    // researchStatus null: plan gerektirmeyen turlarda kapı eskisi gibi
    // yalnız provenance sorar. Aksi hâlde "THYAO kaç TL?" bile bloklanırdı.
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW, {})).toBeNull();
  });

  it('kapanmamış sözleşmede seviye YOKSA kapı susar', () => {
    const noLevels = '## KCHOL\nHaber akışı sakin, bilanço güçlü.\n';
    const lock = evaluatePriceLevelProvenanceGate(
      'KCHOL analiz', noLevels, events, NOW, { researchStatus: 'PARTIAL' },
    );
    expect(lock).toBeNull();
  });
});
