// Sektör tespiti: satırın VARLIĞI değil ÖNEMLİLİĞİ belirler.
// Canlı regresyon turunda ÇAKAL kendi kusurunu bildirdi:
// "tool, THYAO'yu yanlış sektör etiketlemiş (REIT / GYO)".
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const src = fs.readFileSync('apps/desktop/electron/ai-service.cjs', 'utf8');
const detectFinancialSector = new Function(
  `${src.match(/^function detectFinancialSector[\s\S]*?\n}/m)[0]}\nreturn detectFinancialSector;`,
)();

const row = (itemDescTr, value1) => ({ itemDescTr, value1 });

describe('detectFinancialSector — önemlilik tabanlı', () => {
  it('REGRESYON — THYAO GYO değildir; standart TFRS satırı sektör yapmaz', () => {
    // "Yatırım Amaçlı Gayrimenkuller" her büyük şirkette bulunabilir.
    // Eski kod düz metin araması yapıp havayolunu GYO sanıyordu.
    const thyao = [
      row('Toplam Varlıklar', 2158000),
      row('Yatırım Amaçlı Gayrimenkuller', 1200),      // %0,06
      row('Özkaynak Yöntemiyle Değerlenen Yatırımlar', 8000), // %0,37
      row('Hasılat', 257961),
    ];
    const r = detectFinancialSector(thyao, 'XI_29', 'THYAO');
    expect(r.sector).toBe('INDUSTRIAL');
  });

  it('gerçek GYO yakalanır — kalem toplam varlıkların büyük kısmı', () => {
    const r = detectFinancialSector([
      row('Toplam Varlıklar', 50000),
      row('Yatırım Amaçlı Gayrimenkuller', 42000), // %84
    ], 'XI_29', 'ISGYO');
    expect(r.sector).toBe('REIT');
    expect(r.confidence).toBe('high');
    expect(r.basis).toMatch(/%84/);
  });

  it('sembol eki tek başına yeterli ama güven düşer', () => {
    const r = detectFinancialSector([row('Toplam Varlıklar', 1000)], 'XI_29', 'ISGYO');
    expect(r.sector).toBe('REIT');
    expect(r.confidence).toBe('medium');
    expect(r.basis).toMatch(/sembol eki/);
  });

  it('holding için de önemlilik aranır', () => {
    const material = detectFinancialSector([
      row('Toplam Varlıklar', 100000),
      row('Özkaynak Yöntemiyle Değerlenen Yatırımlar', 65000), // %65
    ], 'XI_29', 'KCHOL');
    expect(material.sector).toBe('HOLDING');
    expect(material.confidence).toBe('high');

    // Küçük iştirak kalemi holding yapmaz (sembol eki de yoksa).
    const immaterial = detectFinancialSector([
      row('Toplam Varlıklar', 100000),
      row('Özkaynak Yöntemiyle Değerlenen Yatırımlar', 500), // %0,5
    ], 'XI_29', 'FROTO');
    expect(immaterial.sector).toBe('INDUSTRIAL');
  });

  it('banka ve sigorta kalem tabanlı tespitle bozulmadı', () => {
    expect(detectFinancialSector([
      row('Toplam Varlıklar', 900000), row('Net Faiz Geliri', 50000), row('Mevduat', 600000),
    ], 'XI_29', 'AKBNK').sector).toBe('BANK');

    expect(detectFinancialSector([
      row('Toplam Varlıklar', 30000), row('Kazanılmış Primler', 12000), row('Teknik Bölüm Dengesi', 900),
    ], 'XI_29', 'ANSGR').sector).toBe('INSURANCE');
  });

  it('toplam varlık yoksa önemlilik hesaplanamaz, metin tek başına sektör kurmaz', () => {
    const r = detectFinancialSector([row('Yatırım Amaçlı Gayrimenkuller', 999)], 'XI_29', 'THYAO');
    expect(r.sector).toBe('INDUSTRIAL');
  });
});
