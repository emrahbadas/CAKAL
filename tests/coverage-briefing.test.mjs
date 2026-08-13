import { describe, it, expect } from 'vitest';

import contractLib from '../apps/desktop/electron/research-contract.cjs';

const { buildCoverageBriefing } = contractLib;

/**
 * KAPSAM BRİFİNGİ — kapsam cevaptan ÖNCE
 *
 * ÖLÇÜLEN KUSUR: kapsam yalnız cevap üretildikten SONRA hesaplanıyordu. Model
 * bloke alt soru hakkında rahatça hüküm kuruyor, deterministik kapı sonra o
 * hükmü indiriyordu. Aynı cevapta "sosyal kanıtı kapattım" ile "sosyal kanıt
 * BLOCKED" yan yana durabiliyordu — sözleşme kapı değil, cevaptan sonra
 * tutanak tutan zabit gibi çalışıyordu.
 *
 * SINIR: brifing bir KAPI DEĞİLDİR, bilgilendirmedir. Modelin uymasını umar,
 * garanti etmez. Deterministik indirme yerinde kalır — bu testin işi brifingin
 * doğru BİLGİYİ taşıdığını doğrulamak, modelin uyduğunu değil.
 */

const coverage = (over = {}) => ({
  status: 'PARTIAL',
  subQuestions: [
    { id: 's1', question: 'BRSAN bilanço', outputKind: 'single_fact', status: 'COMPLETE', missingEvidence: [] },
    { id: 's2', question: 'BRSAN değerleme', outputKind: 'investable_candidate', status: 'PARTIAL', missingEvidence: ['VALUATION'] },
    { id: 's3', question: 'Uzman görüşü', outputKind: 'thesis', status: 'BLOCKED', missingEvidence: ['RESEARCH_EVIDENCE'] },
  ],
  answerableIds: ['s1'],
  partialIds: ['s2'],
  blockedIds: ['s3'],
  unresolvedIds: ['s2', 's3'],
  repairPlan: [],
  ...over,
});

describe('brifing içeriği', () => {
  const text = buildCoverageBriefing(coverage());

  it('kapanış durumunu bildiriyor', () => {
    expect(text).toContain('PARTIAL');
  });

  it('üç kategoriyi AYRI gösteriyor', () => {
    // Tek liste yeterli değil: modelin hangi alt soruda ne yapabileceğini
    // bilmesi gerekiyor. "Kısmi" ile "bloke" farklı davranış gerektirir.
    expect(text).toContain('KANITI TAM');
    expect(text).toContain('KANITI KISMİ');
    expect(text).toContain('KANITI BLOKE');
  });

  it('her alt soruyu id ve durumuyla listeliyor', () => {
    expect(text).toContain('[s1]');
    expect(text).toContain('[s2]');
    expect(text).toContain('[s3]');
  });

  it('eksik kanıt sınıfını adıyla söylüyor', () => {
    expect(text).toContain('VALUATION');
    expect(text).toContain('RESEARCH_EVIDENCE');
  });

  it('kapsamın modelin beyanı olmadığını açıkça yazıyor', () => {
    expect(text).toContain('kanıt defterinden');
    expect(text).toContain('senin beyanın değil');
  });
});

describe('brifing kuralları', () => {
  const text = buildCoverageBriefing(coverage());

  it('eksik kanıtta kesin hüküm yasağı var', () => {
    expect(text).toMatch(/kesin AL\/SAT hükmü kurma/i);
  });

  it('eksik kanıtta RAKAM yasağı da var', () => {
    // Seviye kapısıyla aynı mantık: hüküm kelimesi kullanılmasa bile somut
    // stop rakamı uygulanabilir bir işlem talimatıdır.
    expect(text).toMatch(/somut giriş\/stop\/hedef RAKAMI verme/i);
    expect(text).toContain('uygulanabilir bir işlem talimatıdır');
  });

  it('tam kapanan bulguların korunmasını söylüyor', () => {
    // Kısmi bozma ilkesi: eksik katman tüm araştırmayı çöpe atmaz.
    expect(text).toContain('OLDUĞU GİBİ koru');
    expect(text).toMatch(/çöpe atma/i);
  });

  it('eksikliğin saklanmamasını istiyor', () => {
    expect(text).toMatch(/açıkça söyle/i);
  });

  it('yeni araç çağrılmamasını söylüyor', () => {
    // Brifing turu yeniden yazımdır. Araç açılsaydı kapsam brifingden sonra
    // değişir ve brifingin kendisi yalan olurdu.
    expect(text).toMatch(/Yeni araç çağırma/i);
  });
});

describe('sınır durumlar', () => {
  it('hiç tam alt soru yoksa bunu açıkça yazıyor', () => {
    const text = buildCoverageBriefing(coverage({
      status: 'BLOCKED',
      subQuestions: [
        { id: 's1', question: 'x', outputKind: 'thesis', status: 'BLOCKED', missingEvidence: ['FUNDAMENTALS'] },
      ],
      answerableIds: [],
      partialIds: [],
      blockedIds: ['s1'],
    }));
    expect(text).toContain('KANITI TAM alt soru YOK');
  });

  it('boş kategori başlığı basmıyor', () => {
    const text = buildCoverageBriefing(coverage({
      subQuestions: [
        { id: 's1', question: 'x', outputKind: 'single_fact', status: 'COMPLETE', missingEvidence: [] },
      ],
      partialIds: [],
      blockedIds: [],
    }));
    expect(text).not.toContain('KANITI KISMİ');
    expect(text).not.toContain('KANITI BLOKE');
  });

  it('eksik alan taşıyan sözleşmede çökmüyor', () => {
    expect(() => buildCoverageBriefing({ status: 'PARTIAL' })).not.toThrow();
  });
});
