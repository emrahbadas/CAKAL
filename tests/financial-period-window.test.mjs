import { describe, it, expect } from 'vitest';

import aiService from '../apps/desktop/electron/ai-service.cjs';

const { lastReportedQuarters, sameQuarterAcrossYears } = aiService;

/**
 * DÖNEM PENCERESİ.
 *
 * ÖLÇÜLEN VAKA (11 Ağustos 2026):
 *   Pencere "dönem kapanışı + 45 gün" varsayıyordu. 30 Haziran + 45 = 14
 *   Ağustos; BRSAN 2Ç26'yı 7 Ağustos'ta yayımladı. Sistem yeni bilançoyu
 *   YAPISAL OLARAK göremedi ve düzeltme yalnız GERİYE kayıyordu.
 *   Aynı turda haber taraması "2Ç26 açıklandı" diyordu — cevap kendi içinde
 *   çelişkiliydi ve bunu fark etmedi.
 *
 * İkinci kusur: pencere 4 ARDIŞIK çeyrek olduğu için yıl öncesi aynı çeyrek
 * (-4) hiçbir zaman içeride değildi → YoY karşılaştırma imkânsızdı.
 */

const pencere = (tarih, n = 4) =>
  lastReportedQuarters(6, new Date(tarih).getTime()).slice(0, n).map((q) => `${q.year}/${q.period}`);

describe('en güncel KAPANMIŞ çeyrekten başlar', () => {
  it('ASIL VAKA: 11 Ağustos 2026 penceresi 2026/6 ile başlar', () => {
    // Eski davranış 2026/3 ile başlıyordu ve 2026/6'yı hiç istemiyordu.
    expect(pencere('2026-08-11')[0]).toBe('2026/6');
  });

  it('çeyrek kapanışının hemen ertesinde bir önceki kapanmış çeyrek gelir', () => {
    // 5 Mayıs: Haziran çeyreği daha KAPANMADI, en güncel kapanmış 2026/3.
    expect(pencere('2026-05-05')[0]).toBe('2026/3');
  });

  it('yıl başında önceki yılın 4. çeyreği seçilir', () => {
    expect(pencere('2026-02-15')[0]).toBe('2025/12');
  });

  it('pencere 4 ardışık çeyrektir', () => {
    expect(pencere('2026-11-20')).toEqual(['2026/9', '2026/6', '2026/3', '2025/12']);
  });

  it('geriye prob için yedek çeyrekler üretilir', () => {
    // fetchCompanyFinancials iki kez geri kayabilmeli → en az 6 çeyrek.
    expect(lastReportedQuarters(6, new Date('2026-08-11').getTime())).toHaveLength(6);
  });
});

describe('yıl öncesi aynı çeyrek — ayrı istek', () => {
  it('aynı dönem, geriye doğru yıllar', () => {
    const latest = { year: 2026, period: 6 };
    expect(sameQuarterAcrossYears(latest, 4).map((q) => `${q.year}/${q.period}`))
      .toEqual(['2026/6', '2025/6', '2024/6', '2023/6']);
  });

  it('1. çeyrek için de doğru çalışır (ardışık pencerenin kaçırdığı vaka)', () => {
    // Ardışık pencere 2026/3, 2025/12, 2025/9, 2025/6 — 2025/3 YOK.
    const ardisik = pencere('2026-05-05');
    expect(ardisik).not.toContain('2025/3');

    // YoY isteği tam da onu getirir.
    expect(sameQuarterAcrossYears({ year: 2026, period: 3 }, 2).map((q) => `${q.year}/${q.period}`))
      .toEqual(['2026/3', '2025/3']);
  });

  it('boş girdi çökmez', () => {
    expect(sameQuarterAcrossYears(null)).toEqual([]);
    expect(sameQuarterAcrossYears(undefined, 4)).toEqual([]);
  });
});
