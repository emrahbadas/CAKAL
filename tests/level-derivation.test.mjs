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

// KURAL D (4 Ekim 2026) seviyenin DAYANAĞINI da istiyor: MA20/MA50, dönem
// dibi/tepesi, destek/direnç, ATR... Bu yardımcı artık MEŞRU bir cevap
// üretir — dayanağı yazılmış. Dayanaksız hâli ayrı yardımcıda, çünkü
// Kural D'nin kendi testleri onu kullanacak.
const answerWith = (symbol, line) => `## ${symbol}\nMA20 553,2 seviyesinde; destek buradan geçiyor.\n${line}\n`;
const answerWithoutBasis = (symbol, line) => `## ${symbol}\nGörünüm nötr.\n${line}\n`;

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

/**
 * KURAL C / D / E — SEVİYE TÜRETİM KANITI (4 Ekim 2026)
 *
 * Kural A (sözleşme kapanmadan rakam yok) ve Kural B (rakam ölçümle aynı
 * mertebede olmalı) gerçek koruma sağlıyordu ama yetmiyordu:
 *
 * Canlı MEYSU turunda seviyeler YALNIZ MARKET_SESSION_STATUS eksik olduğu
 * için engellendi. Oysa seans durumu bir ZAMAN ETİKETİDİR (canlı mı,
 * gecikmeli mi), seviyenin türetim kanıtı değildir. Seans verisi geldiği an
 * kapı açılırdı ve model yine ölçümsüz seviye üretebilirdi — koruma doğru
 * sonucu YANLIŞ GEREKÇEYLE veriyordu (docs §3.2).
 *
 * Kural B'nin bandı da bilerek geniş: 553'lük bir ölçüm 276–1106 arasını
 * meşru sayar. O aralıkta keyfî sayı seçmek hâlâ mümkündü.
 */
describe('KURAL C — fiyat tek başına seviye dayanağı değildir', () => {
  const fiyatOlayi = (symbol) => ({
    type: 'tool_call', tool: 'get_stock_price', entities: [symbol],
    evidenceClasses: ['CURRENT_EQUITY_PRICE'],
    measurements: { [symbol]: [553.2] },
    timestamp: NOW - 60_000,
  });

  it('yalnız fiyat kanıtıyla stop verilemez', () => {
    const answer = answerWith('KCHOL', 'Stop 549,80 TL altında geçersizlik.');
    const lock = evaluatePriceLevelProvenanceGate('KCHOL alım', answer, [fiyatOlayi('KCHOL')], NOW);
    expect(lock).toBeTruthy();
    expect(lock.priceOnlySymbols).toEqual(['KCHOL']);
    expect(lock.response).toContain('desteğin/direncin nerede olduğunu SÖYLEMEZ');
  });

  it('teknik ölçüm varsa geçer', () => {
    const answer = answerWith('KCHOL', 'Stop 549,80 TL altında geçersizlik.');
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, [measurementEvent('KCHOL', [553.2])], NOW)).toBeNull();
  });
});

describe('KURAL D — seviyenin dayanağı beyan edilmeli', () => {
  const events = [measurementEvent('KCHOL', [553.2])];

  it('dayanaksız seviye bloklanır', () => {
    const answer = answerWithoutBasis('KCHOL', 'Stop 549,80 TL altında geçersizlik.');
    const lock = evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW);
    expect(lock).toBeTruthy();
    expect(lock.noBasisSymbols).toEqual(['KCHOL']);
    expect(lock.reason).toContain('Dayanaksız seviye');
  });

  it('dayanak çeşitleri kabul edilir', () => {
    for (const dayanak of [
      'MA50 548 seviyesinde.',
      'Dönem dibi 545 bölgesi.',
      '20 günlük ortalama 551.',
      'ATR tamponu 12 TL.',
      'Direnç 560 civarı.',
      'Kırılım seviyesi izleniyor.',
    ]) {
      const answer = `## KCHOL\n${dayanak}\nStop 549,80 TL altında geçersizlik.\n`;
      expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW), dayanak).toBeNull();
    }
  });

  it('dayanak ÜST satırda olsa da sayılır (bölüm bazlı)', () => {
    // Dayanak çoğu zaman seviyenin yazıldığı satırda değil, bir üstteki
    // cümlede durur. Satır bazlı bakan bir kural meşru cevabı bloklardı.
    const answer = [
      '## KCHOL',
      'MA20 553,2; destek bu bölgede.',
      '',
      'Plan:',
      '- Stop 549,80 TL',
    ].join('\n');
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW)).toBeNull();
  });
});

describe('KURAL E — stop ve hedef birlikteyse risk/getiri şart', () => {
  const events = [measurementEvent('KCHOL', [553.2])];

  it('stop + hedef var ama risk/getiri yoksa bloklanır', () => {
    const answer = '## KCHOL\nMA20 553,2 destek.\n- Giriş 550 TL · stop 540 TL\n- Hedef 600 TL\n';
    const lock = evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW);
    expect(lock).toBeTruthy();
    expect(lock.noRiskRewardSymbols).toEqual(['KCHOL']);
  });

  it('risk/getiri yazılmışsa geçer', () => {
    const answer = '## KCHOL\nMA20 553,2 destek.\n- Giriş 550 TL · stop 540 TL\n- Hedef 600 TL\n- Risk/getiri: 1:5\n';
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW)).toBeNull();
  });

  it('KAPSAM AŞMIYOR — yalnız stop varsa risk/getiri aranmaz', () => {
    // Geçersizlik seviyesi tek başına verildiğinde R/G tanımsızdır;
    // aramak meşru "şu seviyenin altı tezi bozar" cümlesini bloklardı.
    const answer = '## KCHOL\nMA20 553,2 destek.\n- Stop 540 TL altı tezi bozar.\n';
    expect(evaluatePriceLevelProvenanceGate('KCHOL alım', answer, events, NOW)).toBeNull();
  });
});

describe('levels_must_remain_blocked_when_only_session_is_missing_but_derivation_evidence_is_absent', () => {
  it('ADLANDIRILMIŞ REGRESYON (docs §3.2)', () => {
    // Senaryo: seans durumu GELDİ (sözleşme COMPLETE), fiyat ölçümü de var.
    // Eski kapı burada AÇILIRDI. Oysa türetim kanıtı yok: ne teknik ölçüm
    // var, ne de seviyenin dayanağı yazılmış.
    const seansGeldi = { researchStatus: 'COMPLETE' };
    const sadeceFiyat = [{
      type: 'tool_call', tool: 'get_stock_price', entities: ['MEYSU'],
      evidenceClasses: ['CURRENT_EQUITY_PRICE', 'MARKET_SESSION_STATUS'],
      measurements: { MEYSU: [28.4] },
      timestamp: NOW - 60_000,
    }];
    const answer = answerWithoutBasis('MEYSU', 'Giriş 27,50 TL · stop 25,00 TL.');

    const lock = evaluatePriceLevelProvenanceGate('MEYSU alım', answer, sadeceFiyat, NOW, seansGeldi);
    expect(lock, 'seans geldi diye kapı açılmamalı').toBeTruthy();
    expect(lock.contractIncomplete).toBe(false);
    expect(lock.priceOnlySymbols).toContain('MEYSU');
  });
});
