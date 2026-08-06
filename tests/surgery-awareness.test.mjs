import { describe, it, expect } from 'vitest';

import aiService from '../apps/desktop/electron/ai-service.cjs';

const { buildDynamicSystemPrompt } = aiService;

/**
 * CANLI VAKA REGRESYONU
 *
 * Kullanıcı: "README.md sonunda 'hello çakal' yazıyor mu?"
 * ÇAKAL:  dosyayı okudu → "Hayır, yazmıyor."
 *
 * Cevap TEKNİK OLARAK DOĞRUYDU (değişiklik merge edilmemiş bir daldaydı,
 * diskteki dosyada yoktu) ama TABLO EKSİKTİ: kullanıcı ekranda "Cerrahi
 * tamamlandı" görüyor, ÇAKAL "yok" diyor. İkisi de doğru, birlikte kafa
 * karıştırıcı.
 *
 * Düzeltme: bekleyen cerrahi dallar ÇAKAL'a bildirilir; "yok" derken
 * bekleyen işi de söylemek zorunda.
 */

describe('cerrahi farkındalığı — sistem promptu', () => {
  const withSurgery = (surgery) => buildDynamicSystemPrompt({ surgery });

  it('merge bekleyen dalları listeler', () => {
    const prompt = withSurgery({
      status: 'AWAITING_REVIEW',
      pendingCount: 0,
      authenticated: true,
      awaitingMerge: [
        { branch: 'cakal/feature-CR-1', subject: "README sonuna 'hello çakal' eklendi" },
        { branch: 'cakal/feature-CR-2', subject: 'bug fix' },
      ],
    });

    expect(prompt).toMatch(/MERGE BEKLEYEN CERRAHİ DALLAR \(2\)/);
    expect(prompt).toContain('cakal/feature-CR-1');
    expect(prompt).toContain("README sonuna 'hello çakal' eklendi");
  });

  it('eksik tablo vermemeyi açıkça söyler', () => {
    const prompt = withSurgery({
      status: 'AWAITING_REVIEW',
      authenticated: true,
      awaitingMerge: [{ branch: 'cakal/feature-CR-1', subject: 'x' }],
    });

    expect(prompt).toMatch(/henüz ana koda İNMEDİ/i);
    expect(prompt).toMatch(/"Yok" deyip susma/i);
    expect(prompt).toMatch(/Cerrahi Bakım/i);
  });

  it('bekleyen dal yoksa bölüm hiç çıkmaz', () => {
    const prompt = withSurgery({ status: 'IDLE', pendingCount: 0, authenticated: true, awaitingMerge: [] });
    expect(prompt).not.toMatch(/MERGE BEKLEYEN/);
  });

  it('bağlantı durumunu bildirir', () => {
    expect(withSurgery({ status: 'IDLE', authenticated: true })).toMatch(/GitHub Copilot\): BAĞLI/);
    expect(withSurgery({ status: 'IDLE', authenticated: false })).toMatch(/BAĞLI DEĞİL/);
  });

  it('bağlantı yokken talebi yine de kaydetmeyi söyler', () => {
    const prompt = withSurgery({ status: 'IDLE', authenticated: false });
    expect(prompt).toMatch(/yine de propose_surgical_change ile KAYDET/i);
  });

  it('cerrahi çalışırken ikinci başlatma vaadini engeller', () => {
    const prompt = withSurgery({ status: 'RUNNING', authenticated: true });
    expect(prompt).toMatch(/başlatılamayacağını söyle/i);
  });

  it('cerrahi bağlamı yoksa hiçbir bölüm eklenmez', () => {
    const prompt = buildDynamicSystemPrompt({});
    expect(prompt).not.toMatch(/CERRAHİ HAT DURUMU/);
  });
});
