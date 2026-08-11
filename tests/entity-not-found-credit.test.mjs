import { describe, it, expect } from 'vitest';

import contract from '../apps/desktop/electron/research-contract.cjs';
import guards from '../apps/desktop/electron/decision-guards.cjs';
import aiService from '../apps/desktop/electron/ai-service.cjs';

const { extractEntities, createResearchRun } = contract;
const { buildEvidenceLedger, hasFreshEvidenceForEntity, entitiesWithEvidence } = guards;
const { buildToolResultPreview } = aiService;

/**
 * İSTENEN ≠ BULUNAN.
 *
 * ÖLÇÜLEN VAKA (11 Ağustos 2026, 3. tur):
 *   get_bist_board'a [BRSAN, MEYSU, XU100] istendi, pano 2 satır döndü ve
 *   `notFound: ['XU100']` bildirdi. Buna rağmen XU100, args.symbols'da geçtiği
 *   için dört kanıt sınıfı birden almış sayılıyordu.
 *
 * Bu, Adım 2'nin SINIF düzeyinde kapattığı hastalığın ENTITY düzeyi.
 */

const now = Date.now();

const boardResult = {
  success: true,
  source: 'mynet_finans_canli_borsa',
  data: {
    items: [{ symbol: 'BRSAN' }, { symbol: 'MEYSU' }],
    count: 2,
    notFound: ['XU100'],
  },
};

describe('kanıt kredisi — bulunamayan sembol kredi almaz', () => {
  it('notFound listesindeki sembol entity kümesinden düşer', () => {
    const entities = extractEntities({ symbols: 'BRSAN, MEYSU, XU100' }, boardResult);
    expect(entities).toContain('BRSAN');
    expect(entities).toContain('MEYSU');
    expect(entities).not.toContain('XU100');
  });

  it('bulunan semboller etkilenmez', () => {
    const entities = extractEntities({ symbols: 'BRSAN, MEYSU' }, {
      success: true,
      data: { items: [{ symbol: 'BRSAN' }, { symbol: 'MEYSU' }], count: 2 },
    });
    expect(entities.sort()).toEqual(['BRSAN', 'MEYSU']);
  });

  it('defterde XU100 için entity kanıtı OLUŞMAZ', () => {
    const run = createResearchRun({ userQuestion: 'BRSAN ve MEYSU karşılaştır' });
    run.record('get_bist_board', { symbols: 'BRSAN, MEYSU, XU100' }, boardResult);

    const ledger = buildEvidenceLedger(run.events(), now);
    expect(hasFreshEvidenceForEntity(ledger, 'LIQUIDITY', 'BRSAN', now)).toBe(true);
    expect(hasFreshEvidenceForEntity(ledger, 'LIQUIDITY', 'XU100', now)).toBe(false);
    expect(entitiesWithEvidence(ledger, 'INDEX_MEMBERSHIP')).not.toContain('XU100');
  });

  it('missingEntities alanı da aynı şekilde çalışır', () => {
    const entities = extractEntities({ symbols: 'THYAO, ASELS' }, {
      success: true,
      data: { items: [{ symbol: 'THYAO' }], missingEntities: ['ASELS'] },
    });
    expect(entities).toEqual(['THYAO']);
  });
});

describe('aktivite önizlemesi — eksik sembol görünür', () => {
  it('BULUNAMADI etiketi önizlemeye girer', () => {
    const preview = buildToolResultPreview(boardResult);
    expect(preview).toContain('count=2');
    expect(preview).toContain('BULUNAMADI=XU100');
  });

  it('eksik yoksa etiket eklenmez', () => {
    const preview = buildToolResultPreview({
      success: true,
      source: 'mynet_finans_canli_borsa',
      data: { items: [{ symbol: 'BRSAN' }], count: 1 },
    });
    expect(preview).not.toContain('BULUNAMADI');
  });
});
