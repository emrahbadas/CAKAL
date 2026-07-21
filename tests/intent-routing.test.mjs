import { describe, expect, it } from 'vitest';
import { isCommercePipelineIntent, normalizeIntentText } from '../apps/desktop/src/state/intentRouting.ts';

describe('intent routing', () => {
  it('does not route finance questions containing Turkish "icin" to commerce pipeline', () => {
    expect(isCommercePipelineIntent('hisseler icin ne dersin')).toBe(false);
    expect(isCommercePipelineIntent('hisseler için ne dersin')).toBe(false);
    expect(
      isCommercePipelineIntent(
        'Aciklanan son ceyrek bilancolara gore en umut vadeden hafif bebek hisse sinifina giren orta riskli olabilecek ama iyi para kazandirabilecek hisseler icin ne dersin',
      ),
    ).toBe(false);
  });

  it('still routes explicit commerce and China sourcing requests', () => {
    expect(isCommercePipelineIntent('Alibaba tedarikci ara')).toBe(true);
    expect(isCommercePipelineIntent('1688 uzerinden urun bak')).toBe(true);
    expect(isCommercePipelineIntent('Cin pazari icin urun al sat firsati bul')).toBe(true);
    expect(isCommercePipelineIntent('dropshipping icin ozel label urun oner')).toBe(true);
  });

  it('normalizes Turkish characters for intent checks', () => {
    expect(normalizeIntentText('Çin pazarı için ürün tedarikçi')).toBe('cin pazari icin urun tedarikci');
  });
});