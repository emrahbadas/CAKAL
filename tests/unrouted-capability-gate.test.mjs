import { describe, it, expect } from 'vitest';

import guards from '../apps/desktop/electron/decision-guards.cjs';

const {
  responseClaimsCapabilityWork,
  evaluateUnroutedCapabilityGate,
} = guards;

/**
 * GERÇEK VAKA REGRESYONU (canlı testte gözlendi)
 *
 * Kullanıcı: "kaynak kodunda README'ye bir bölüm ekle"
 * ÇAKAL:  submit_task_plan → read_project_file → write_project_file
 *         → "GÜVENLİK: README.md yolu korumalı" → pes etti
 *         → "istersen .cakal-sandbox/prompts/README-addition.md'ye yazayım"
 *
 * İki hata birden:
 *   1. propose_surgical_change HİÇ çağrılmadı (cerrahi hat elinin altındaydı)
 *   2. Çözüm diye ölü sandbox dosyası teklif edildi (o dosyaları hiçbir şey okumaz)
 */

const toolEvent = (tool) => ({ type: 'tool_call', tool });

const BLOCKED_RESPONSE = [
  'README’ye bölüm ekleme isteğini aldım ama bu depo politikası gereği README.md korumalı.',
  'Yani çekirdek dosyaya yazamam; sadece `.cakal-sandbox/*` altına yazabiliyorum.',
  '',
  'İstersen `.cakal-sandbox/prompts/README-addition.md` gibi güvenli bir sandbox dosyasına aynı bölümü ekleyeyim.',
].join('\n');

describe('yetenek işi tespiti', () => {
  it('çekirdek yazma duvarına çarpan cevabı tanır', () => {
    expect(responseClaimsCapabilityWork('GÜVENLİK: README.md yolu korumalı.')).toBe(true);
  });

  it('ölü sandbox dosyası teklifini tanır', () => {
    expect(responseClaimsCapabilityWork('.cakal-sandbox/prompts/README-addition.md ekleyeyim')).toBe(true);
    expect(responseClaimsCapabilityWork('.cakal-sandbox/tools/yeni.md yazayım')).toBe(true);
  });

  it('gerçek vaka metnini tanır', () => {
    expect(responseClaimsCapabilityWork(BLOCKED_RESPONSE)).toBe(true);
  });

  it('normal finans cevabını yetenek işi sanmaz', () => {
    expect(responseClaimsCapabilityWork('TUREX bugün %2.19 yükseldi, hacim ortalamanın üzerinde.')).toBe(false);
    expect(responseClaimsCapabilityWork('')).toBe(false);
  });
});

describe('UNROUTED_CAPABILITY kapısı', () => {
  it('gerçek vakayı bloklar (propose_surgical_change çağrılmadı)', () => {
    const result = evaluateUnroutedCapabilityGate(
      'kaynak kodunda README\'ye bir bölüm ekle',
      BLOCKED_RESPONSE,
      [toolEvent('submit_task_plan'), toolEvent('read_project_file'), toolEvent('write_project_file')],
    );
    expect(result).toBeTruthy();
    expect(result.status).toBe('BLOCKED_UNROUTED_CAPABILITY');
    expect(result.reason).toMatch(/sandbox dosyasına yönlendirildi/i);
    expect(result.response).toMatch(/cerrahi bakım gerektiriyor/i);
  });

  it('cerrahi hatta yönlendirildiyse geçirir', () => {
    const result = evaluateUnroutedCapabilityGate(
      'kaynak kodunda README\'ye bir bölüm ekle',
      'Talebi kaydettim: CR-20260803-52f767. Cerrahi Bakım ekranından başlat.',
      [toolEvent('propose_surgical_change')],
    );
    expect(result).toBeNull();
  });

  it('duvara çarpsa bile cerrahi hatta devredildiyse geçirir', () => {
    const result = evaluateUnroutedCapabilityGate(
      'README güncelle',
      BLOCKED_RESPONSE,
      [toolEvent('write_project_file'), toolEvent('propose_surgical_change')],
    );
    expect(result).toBeNull();
  });

  it('Kademe 1 (sandbox plugin) yolu da geçerli yönlendirmedir', () => {
    const result = evaluateUnroutedCapabilityGate(
      'şu API\'den veri çek',
      'Çekirdek dosyaya yazamam ama plugin kurdum.',
      [toolEvent('register_sandbox_plugin')],
    );
    expect(result).toBeNull();
  });

  it('hiç araç çalışmadan duvar iddiası da bloklanır', () => {
    const result = evaluateUnroutedCapabilityGate(
      'yeni tool ekle',
      'Kaynak koda yazamıyorum, sandbox dışına çıkamam.',
      [],
    );
    expect(result?.status).toBe('BLOCKED_UNROUTED_CAPABILITY');
    expect(result.reason).toMatch(/hiçbir yola yönlendirilmedi/i);
  });

  it('pazaryeri bağlamında devreye girmez', () => {
    const result = evaluateUnroutedCapabilityGate(
      'trendyol ürün ara',
      '.cakal-sandbox/tools/x.md',
      [],
    );
    expect(result).toBeNull();
  });

  it('yetenek işi olmayan cevapta devreye girmez', () => {
    expect(evaluateUnroutedCapabilityGate('bist nasıl', 'BIST bugün yatay kapandı.', [])).toBeNull();
  });
});
