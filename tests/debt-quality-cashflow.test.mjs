import { describe, it, expect } from 'vitest';

import guards from '../apps/desktop/electron/decision-guards.cjs';
import aiService from '../apps/desktop/electron/ai-service.cjs';
import contract from '../apps/desktop/electron/research-contract.cjs';

const {
  evaluateDebtQualityGate,
  responseClaimsDebtQuality,
  TOOL_EVIDENCE_CLASSES,
  EVIDENCE_TTL_MS,
} = guards;
const { extractCashFlowItems, classifyDebtImprovementSource } = aiService;
const { PRODUCIBLE_EVIDENCE_CLASSES } = contract;

/**
 * NET BORÇ İYİLEŞMESİ TEK BAŞINA KALİTE DEĞİLDİR.
 *
 * GERÇEK VAKA (11 Ağustos 2026, MEYSU):
 *   "Net borç, 1,36 mlr TL'den 546,9 mn TL'ye inmiş görünüyor. Bu pozitif."
 * Muhasebe olarak doğru, hüküm olarak eksik: borcu kapatan nakit büyük ölçüde
 * halka arz sermayesiydi ve işletme nakit akışı NEGATİFTİ. Kasa doldu ama
 * makine kendi ürettiği nakitle doldurmadı.
 */

const MEYSU_CEVABI = [
  'MEYSU okuması:',
  "- Net borç, 2025/12 seviyesindeki 1,36 mlr TL'den 546,9 mn TL'ye inmiş görünüyor. Bu pozitif.",
  '- MEYSU: AL',
].join('\n');

const nakitOlay = (extra = {}) => ({
  type: 'tool_call',
  tool: 'get_cash_flow_breakdown',
  timestamp: Date.now(),
  success: true,
  entities: ['MEYSU'],
  ...extra,
});

describe('kanıt sınıfı kaydı', () => {
  it('CASH_FLOW_BREAKDOWN bir üreticiye bağlı', () => {
    expect(TOOL_EVIDENCE_CLASSES.get_cash_flow_breakdown).toContain('CASH_FLOW_BREAKDOWN');
  });

  it('TTL tanımlı — bilanço kadar yaşar', () => {
    expect(EVIDENCE_TTL_MS.CASH_FLOW_BREAKDOWN).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('sözleşme planlarında kullanılabilir sınıf olarak görünür', () => {
    // Üreticisi olmayan sınıf plana yazılamaz; yetenek boşluğu olarak kalırdı.
    expect(PRODUCIBLE_EVIDENCE_CLASSES).toContain('CASH_FLOW_BREAKDOWN');
  });
});

describe('borç kalite kapısı', () => {
  it('ASIL VAKA: kanıtsız "bu pozitif" hükmü bloklanır', () => {
    const lock = evaluateDebtQualityGate('MEYSU bilanço analizi', MEYSU_CEVABI, []);
    expect(lock).toBeTruthy();
    expect(lock.status).toBe('BLOCKED_UNSOURCED_DEBT_QUALITY');
  });

  it('hüküm de indirilir, bulgu silinmez', () => {
    const lock = evaluateDebtQualityGate('MEYSU bilanço analizi', MEYSU_CEVABI, []);
    expect(lock.response).toContain('MEYSU: İNCELE');
    // Rakam ve gözlem duruyor.
    expect(lock.response).toContain('546,9 mn');
  });

  it('nakit akışı kanıtı varsa kapı susar', () => {
    expect(evaluateDebtQualityGate('MEYSU bilanço analizi', MEYSU_CEVABI, [nakitOlay()])).toBeNull();
  });

  it('BLOKE dönen nakit akışı çağrısı kanıt sayılmaz (Adım 2 kuralı burada da geçerli)', () => {
    const lock = evaluateDebtQualityGate('MEYSU bilanço analizi', MEYSU_CEVABI, [nakitOlay({ status: 'NO_DATA' })]);
    expect(lock).toBeTruthy();
  });

  it('nötr borç cümlesi kapıyı açmaz', () => {
    const notr = 'Net borç 546,9 mn TL seviyesinde. Şirketin ölçeğine göre değerlendirilmeli.';
    expect(evaluateDebtQualityGate('MEYSU', notr, [])).toBeNull();
  });

  it('borçtan hiç söz etmeyen cevap etkilenmez', () => {
    expect(responseClaimsDebtQuality('Haber akışı kirli, volatilite yüksek.')).toBe(false);
  });

  it('Türkçe çekim eki kapıyı delmez ("inmiş" yakalanır)', () => {
    // JS regex'inde 'ş' kelime karakteri değildir; /inmiş\b/ bu cümleyi kaçırırdı.
    expect(responseClaimsDebtQuality("Net borç 1,36 mlr'den 546 mn'ye inmiş, bu olumlu.")).toBe(true);
  });
});

describe('nakit akışı ayrıştırması', () => {
  // FIXTURE TAŞINDI (13 Ağustos 2026). Buradaki satır adları UYDURULMUŞTU
  // ("İşletme Faaliyetlerinden Nakit Akışları"); İş Yatırım'ın gerçek
  // adları ölçüldü ve farklı çıktı:
  //   "İşletme Faaliyetlerinden Kaynaklanan Net Nakit"
  //   "Yatırım Faaliyetlerinden Kaynaklanan Nakit"
  //   "Finansman FaaliyetlerDEN Kaynaklanan Nakit"   ← "-inden" değil
  // Uydurma fixture, gevşek desenin yanlış satırı seçtiğini gizliyordu.
  // Test verisi kaynağı taklit etmiyorsa test, kodu değil kendini doğrular.
  const row = (code, desc, v1) => ({ itemCode: code, itemDescTr: desc, value1: v1, value2: null, value3: null, value4: null });

  it('MEYSU deseni: sermaye girişi kaynaklı iyileşme tespit edilir', () => {
    const items = extractCashFlowItems([
      row('1', 'İşletme Faaliyetlerinden Kaynaklanan Net Nakit', -36400000),
      row('2', 'Finansman Faaliyetlerden Kaynaklanan Nakit', 794900000),
      row('3', 'Pay İhracından Kaynaklanan Nakit Girişleri', 912500000),
    ]);
    expect(items).toHaveLength(3);

    const c = classifyDebtImprovementSource(items);
    expect(c.source).toBe('EQUITY_ISSUANCE');
    expect(c.reason).toContain('pay ihracından');
    expect(c.reason).toMatch(/OPERASYONEL kalite göstergesi olarak sunulamaz/);
  });

  it('operasyonel nakit üreten şirket OPERATIONS sayılır', () => {
    const items = extractCashFlowItems([
      row('1', 'İşletme Faaliyetlerinden Kaynaklanan Net Nakit', 1200000000),
      row('2', 'Finansman Faaliyetlerden Kaynaklanan Nakit', -300000000),
    ]);
    expect(classifyDebtImprovementSource(items).source).toBe('OPERATIONS');
  });

  it('finansman kaynaklı iyileşme ayrı sınıflanır', () => {
    const items = extractCashFlowItems([
      row('1', 'İşletme Faaliyetlerinden Kaynaklanan Net Nakit', -50000000),
      row('2', 'Finansman Faaliyetlerden Kaynaklanan Nakit', 600000000),
    ]);
    expect(classifyDebtImprovementSource(items).source).toBe('FINANCING');
  });

  it('kalem yoksa UNKNOWN — sessizce "operasyonel" DEMEZ', () => {
    expect(extractCashFlowItems([])).toEqual([]);
    expect(classifyDebtImprovementSource([]).source).toBe('UNKNOWN');
  });
});
