// Hükümden KAÇINAN cevap hüküm sayılmamalı, benchmark kanıtsız kalmamalı,
// seans hesabı borsa saat dilimine bağlı olmalı.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import guards from '../apps/desktop/electron/decision-guards.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const { detectEquityVerdict, evaluateVerdictEvidenceLock, buildEvidenceLedger, hasFreshEvidence, neutralizeEquityVerdicts } = guards;
const { createResearchRun, submitPlan, evaluateContract, SUB_QUESTION_STATUS } = contract;

const ok = (data = {}) => ({ success: true, data, source: 'test' });

describe('Negatif hüküm — reddi hüküm sayma', () => {
  it('REGRESYON — "AL/SAT demiyorum" hüküm değildir', () => {
    // Canlı vakada bu cümle KARAR KİLİDİ'ni tetikledi ve tam bir onarım turu
    // başlattı; oysa cevap tam olarak istenen şeyi yapıyordu.
    const line = 'Kaptan, sözleşme onarımını uyguladım; AL/SAT demiyorum. Doğru hüküm kelimeleri: KCHOL = İNCELE';
    expect(detectEquityVerdict(line)).toBe(false);
  });

  it('diğer reddetme kalıpları da hüküm sayılmaz', () => {
    for (const s of [
      'Bu veri setiyle AL demek doğru olmaz',
      'Karar: AL hükmü vermiyorum, İNCELE diyorum',
      'AL/SAT yerine İZLE kullanıyorum',
      'Kanıt yetersiz; AL hükmü yok',
    ]) {
      expect(detectEquityVerdict(s), s).toBe(false);
    }
  });

  it('gerçek hüküm hâlâ yakalanır', () => {
    expect(detectEquityVerdict('Karar: AL')).toBe(true);
    expect(detectEquityVerdict('THYAO: SAT')).toBe(true);
    expect(detectEquityVerdict('Sonuç → AL')).toBe(true);
  });

  it('hüküm reddeden cevapta karar kilidi çalışmaz', () => {
    const response = 'Borsa değerlendirmesi: AL/SAT demiyorum. KCHOL = İNCELE, ASELS = İZLE.';
    expect(evaluateVerdictEvidenceLock('borsada hisse alım', response)).toBeNull();
  });
});

describe('Benchmark kanıtsız bırakılmaz', () => {
  it('benchmark bildirilirse BENCHMARK_PRICE_SERIES zorunlu olur', () => {
    const run = createResearchRun({ userQuestion: 'test' });
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'XU100 gore relatif guc', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
        entities: ['THYAO', 'XU100'], coverage: 'ALL',
      }],
    });
    expect(res.ok).toBe(true);
    const sq = res.contract.subQuestions[0];
    expect(sq.benchmarks).toEqual(['XU100']);
    expect(sq.requiredEvidence).toContain('BENCHMARK_PRICE_SERIES');
    run.set(res.contract);

    // Şirket kanıtı tam ama benchmark serisi yok → tamamlanmaz.
    run.record('get_stock_price', { symbols: 'THYAO' }, ok({ stocks: [{ symbol: 'THYAO' }] }));
    run.record('analyze_finance_signal', { asset: 'THYAO' }, ok({}));
    let out = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(out.subQuestions[0].missingEvidence).toContain('BENCHMARK_PRICE_SERIES');

    // Benchmark serisi gelince tamamlanır.
    run.record('analyze_earnings_pricing', { symbol: 'THYAO' }, ok({ symbol: 'THYAO' }));
    out = evaluateContract(run.get(), buildEvidenceLedger(run.events(), Date.now()), Date.now());
    expect(out.subQuestions[0].status).toBe(SUB_QUESTION_STATUS.COMPLETE);
  });

  it('benchmark yoksa BENCHMARK_PRICE_SERIES dayatılmaz', () => {
    const run = createResearchRun({ userQuestion: 'test' });
    const res = submitPlan(run.get(), {
      subQuestions: [{
        id: 's2', question: 'teknik', outputKind: 'current_leader',
        requiredEvidence: ['CURRENT_EQUITY_PRICE', 'TECHNICAL_SIGNAL'],
        entities: ['THYAO'],
      }],
    });
    expect(res.contract.subQuestions[0].requiredEvidence).not.toContain('BENCHMARK_PRICE_SERIES');
  });
});

describe('Seans hesabı borsa saat dilimine bağlı', () => {
  const src = fs.readFileSync('apps/desktop/electron/ai-service.cjs', 'utf8');
  const fn = new Function(`${src.match(/^function describeBistSession[\s\S]*?\n}/m)[0]}\nreturn describeBistSession;`)();

  it('Europe/Istanbul kullanır ve saat dilimini raporlar', () => {
    const s = fn(new Date('2026-08-09T12:00:00Z'));
    expect(s.exchangeTimeZone).toBe('Europe/Istanbul');
    expect(s.nowUtc).toBe('2026-08-09T12:00:00.000Z');
  });

  it('hafta sonu KAPALI', () => {
    expect(fn(new Date('2026-08-09T12:00:00Z')).marketSession).toBe('CLOSED'); // Pazar
  });

  it('REGRESYON — belirli gün adı vermez, tatil takvimi doğrulanmadığını bildirir', () => {
    const s = fn(new Date('2026-08-09T12:00:00Z'));
    expect(s.nextSession).toMatch(/bir sonraki açık/);
    expect(s.nextSession).not.toMatch(/Pazartesi/);
    expect(s.holidayCalendarChecked).toBe(false);
    expect(s.sessionNote).toMatch(/Resmî tatil takvimi DOĞRULANMADI/);
  });

  it('hafta içi seans saatinde AÇIK', () => {
    // Salı 12:00 Istanbul = 09:00Z
    expect(fn(new Date('2026-08-11T09:00:00Z')).marketSession).toBe('OPEN');
    expect(fn(new Date('2026-08-11T16:00:00Z')).marketSession).toBe('CLOSED'); // 19:00 Istanbul
  });
});

/**
 * CANLI HATA REGRESYONU — 12 Eylül 2026
 *
 * Karar kilidi ateşledi, footer'a "hüküm İNCELE seviyesine indirildi" yazdı —
 * ama cevapta "AL" DÖRT ayrı yerde ayakta kaldı. Kaptan'ın sorusu haklıydı:
 * "makine dairesi frene basmış ama LLM tarafı bunu dinlememiş mi ne?"
 *
 * Dinlemeyen LLM değildi. Nötrleştirici bağlam kelimesini AYNI satırda
 * arıyordu; markdown'da bağlam ise HİYERARŞİK taşınır:
 *   - tablo başlığındaki "Karar" sütunu veri satırlarına
 *   - bölüm başlığındaki "Öneri" altındaki maddelere
 * Tek yakalanan satır `## Karar: AL` oldu — ekranda İNCELE görülen tek yer.
 *
 * KURAL: tespit DAR kalır (yanlış pozitif bir onarım turu yakar), yazım GENİŞ
 * olur (kaçan satır bloke edilmiş hükmü ekrana sızdırır).
 */
describe('REGRESYON — bloke edilmiş hüküm cevapta sızmamalı', () => {
  const kalanAl = (text) =>
    (String(text).match(/(^|[^A-ZÇĞİÖŞÜa-zçğıöşü])AL($|[^A-ZÇĞİÖŞÜa-zçğıöşü])/g) || []).length;

  it('tablo veri satırı — "Karar" başlık satırındayken de yakalanır', () => {
    const tablo = [
      '| Hisse | Karar | Sebep |',
      '|---|---|---|',
      '| AKBNK | AL | Trend yukarı, hacim destekli |',
    ].join('\n');
    expect(kalanAl(neutralizeEquityVerdicts(tablo))).toBe(0);
  });

  it('başlıkta sembol varsa bağlam kelimesi aranmaz', () => {
    const baslik = '# 1) AKBNK neden AL diyebildiğim hisse?';
    expect(neutralizeEquityVerdicts(baslik)).toContain('İNCELE');
  });

  it('bağlam ÜST başlıktaysa alt maddeler devralır', () => {
    const bolum = ['### Aksiyon Önerisi', '- Bir sonraki açık seansta AL adayı'].join('\n');
    expect(kalanAl(neutralizeEquityVerdicts(bolum))).toBe(0);
  });

  it('alt başlık üst bölümün bağlamını devralır', () => {
    const ic = ['# AKBNK için karar', '## Detay', '- Plan: AL', ].join('\n');
    expect(kalanAl(neutralizeEquityVerdicts(ic))).toBe(0);
  });

  it('canlı cevabın tamamında hiç AL kalmıyor', () => {
    const canli = [
      '## Net karar tablosu',
      '| Hisse | Karar | Sebep |',
      '|---|---|---|',
      '| AKBNK | AL | Trend yukarı |',
      '# 1) AKBNK neden AL diyebildiğim hisse?',
      '### AKBNK = kanıtları en tam ve AL hükmüne uygun tek temiz aday',
      '### Aksiyon Önerisi',
      '- Bir sonraki açık seansta AL adayı',
      '## Karar: AL',
    ].join('\n');
    expect(kalanAl(neutralizeEquityVerdicts(canli))).toBe(0);
  });

  it('KAPSAM AŞMIYOR — hüküm sütunu olmayan tabloya dokunulmaz', () => {
    // Fiyat tablosunda sembol var ama hüküm kelimesi yok; yeniden yazım
    // burada içerik bozardı.
    const fiyat = ['| Sembol | Kapanış | Trend |', '|---|---|---|', '| AKBNK | 72,70 | YUKARI |'].join('\n');
    expect(neutralizeEquityVerdicts(fiyat)).toBe(fiyat);
  });

  it('KAPSAM AŞMIYOR — hüküm reddi hâlâ korunur', () => {
    // Reddi cezalandırmak doğru davranışı cezalandırmaktır.
    const red = 'Karar: AL demiyorum, kanıt eksik.';
    expect(neutralizeEquityVerdicts(red)).toBe(red);
  });

  it('KAPSAM AŞMIYOR — sembolsüz düz metinde AL sözcüğü korunur', () => {
    const duz = 'Kullanıcı listeden bir ürün AL tuşuna bastı.';
    expect(neutralizeEquityVerdicts(duz)).toBe(duz);
  });
});
