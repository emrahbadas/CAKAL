import { describe, it, expect } from 'vitest';

import aiService from '../apps/desktop/electron/ai-service.cjs';

const { detectTaskType, getModelForTask, MODEL_CONFIG } = aiService;

/**
 * ÖLÇÜLEN VAKA (11 Ağustos 2026, 3. tur):
 *   "BRSAN ve MEYSU için teknik sinyal karşılaştırMASI yap ve ... stop
 *    seviyelerinide ver"
 *   → görev 'chat', model gpt-5.4-mini.
 *
 * İki bağımsız sebep:
 *   1. /karşılaştır\b/ Türkçe çekim ekini kaçırıyordu — JS regex'inde `\b`
 *      ş/ı/ğ/ç/ö/ü harflerini kelime karakteri saymaz.
 *   2. İşlem seviyesi (giriş/stop/destek/direnç) talebinin router'da hiçbir
 *      özel ağırlığı yoktu; en riskli tur en zayıf modele düşebiliyordu.
 */

const modelOf = (m) => getModelForTask(detectTaskType(m));

describe('router — Türkçe çekim eki', () => {
  const cekimler = [
    'teknik sinyal karşılaştırması yap',
    'bunları karşılaştırır mısın',
    'hisseleri karşılaştıralım',
    'bu veriyi değerlendirmeni istiyorum',
    'detaylıca bakar mısın',
  ];

  for (const mesaj of cekimler) {
    it(`ek almış gövde yakalanır: "${mesaj}"`, () => {
      expect(detectTaskType(mesaj)).toBe('deep_analysis');
    });
  }
});

describe('router — işlem seviyesi asla zayıf modele düşmez', () => {
  it('ASIL VAKA: teknik karşılaştırma + stop talebi en güçlü modele gider', () => {
    const mesaj = 'BRSAN ve MEYSU için teknik sinyal karşılaştırması yap ve sonra '
      + 'BRSAN için güvenli giriş seviyesi direnç destek ve stop seviyelerinide ver';
    expect(detectTaskType(mesaj)).toBe('deep_analysis');
    expect(modelOf(mesaj)).toBe(MODEL_CONFIG.deep_analysis);
  });

  it('sembol + stop seviyesi talebi de güçlü modele gider', () => {
    expect(detectTaskType('BRSAN için stop seviyesi ver')).toBe('deep_analysis');
  });

  it('giriş/destek/direnç talepleri finans bağlamında güçlü modele gider', () => {
    for (const mesaj of [
      'THYAO hissesinde giriş seviyesi neresi',
      'bist hisselerinde destek seviyesi nasıl bulunur',
      'ASELS direnç bölgesi nerede',
    ]) {
      expect(detectTaskType(mesaj)).toBe('deep_analysis');
    }
  });

  it('finans bağlamı YOKSA "destek" sözcüğü pahalı modele düşürmez', () => {
    // Bağlam şartı olmasa "müşteri desteği" de deep_analysis olurdu.
    expect(detectTaskType('müşteri desteği ile ilgili bir sorunum var')).not.toBe('deep_analysis');
  });

  it('selamlaşma hâlâ en ucuz modelde', () => {
    expect(detectTaskType('merhaba nasılsın')).toBe('quick');
  });
});
