// ============================
// Bilanço Fiyatlanma Motoru (Earnings Pricing Assessment)
// Politika: bilanço kalitesi ile giriş zamanlaması ayrı eksenlerdir. Bu modül
// "bu bilanço piyasa tarafından önceden satın alındı mı?" sorusunu fiyat ve
// hacim kanıtıyla deterministik olarak sınıflandırır. Tek sayılık skor yerine
// kanıt temelli kategorik sınıflandırma kullanılır: sahte kesinlik üretmez.
// Beklenti sürprizi (konsensüs) AYRI bir eksendir; konsensüs verisi yoksa
// UNKNOWN kalır ve fiyatlanma kanıtıyla karıştırılmaz.
// ============================

// ADLANDIRMA KARARI (2026-08-09):
// Bu modülün ölçtüğü şey fiyatın ne kadar UZADIĞIDIR — girdileri yalnız
// 5/20/60 gün getiri, XU100 göreceli getiri, hacim genişlemesi ve MA50
// uzaklığıdır. Beklenti (konsensüs) verisi GİRDİ DEĞİLDİR.
//
// Eski adlar (LARGELY_PRICED, LOW_EVIDENCE_OF_PRICING) "bilanço fiyatlandı"
// diye okunuyordu; oysa konsensüs bilinmeden bir bilançonun fiyatlanıp
// fiyatlanmadığı söylenemez. Etiketler ölçülen şeye göre yeniden adlandırıldı:
// fiyat uzaması ≠ bilanço fiyatlanması.
//
// EARNINGS_PRICED_IN hükmü ayrı bir alandır (earningsPricedIn) ve YALNIZ
// açıklama tarihi + beklenti + gerçekleşen sonuç birlikte varsa üretilir.
const PRICING_CLASSIFICATIONS = Object.freeze([
  'NOT_ASSESSED',
  'INSUFFICIENT_DATA',
  'NOT_EXTENDED',
  'PARTIALLY_EXTENDED',
  'PRICE_EXTENDED',
  'PRICE_OVEREXTENDED',
]);

// Eski adları okuyan yerler için geriye dönük eşleme (log/kayıt okuması).
const LEGACY_PRICING_CLASSIFICATION_ALIASES = Object.freeze({
  LOW_EVIDENCE_OF_PRICING: 'NOT_EXTENDED',
  PARTIALLY_PRICED: 'PARTIALLY_EXTENDED',
  LARGELY_PRICED: 'PRICE_EXTENDED',
  OVEREXTENDED: 'PRICE_OVEREXTENDED',
});

const EXPECTATION_SURPRISE_VALUES = Object.freeze(['below', 'in_line', 'above']);

function toFinite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round1(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function round2(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function pctChange(current, base) {
  if (current === null || base === null || base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

function normalizeBars(bars) {
  if (!Array.isArray(bars)) return [];
  return bars
    .map((bar) => ({
      time: String(bar?.time || '').slice(0, 10),
      close: toFinite(bar?.close),
      volume: toFinite(bar?.volume),
    }))
    .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.time) && bar.close !== null)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

// Bilanço öncesi pencere açıklama gününden ÖNCEKİ son işlem gününde biter;
// açıklama günü ve sonrası "tepki" penceresidir.
function findAnchorIndex(bars, announcementDate) {
  if (!announcementDate) return bars.length - 1;
  let anchor = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].time < announcementDate) anchor = i;
    else break;
  }
  return anchor;
}

function lastCloseAtOrBefore(bars, date) {
  let found = null;
  for (const bar of bars) {
    if (bar.time <= date) found = bar.close;
    else break;
  }
  return found;
}

function averageVolume(bars, fromIdx, toIdx) {
  const values = [];
  for (let i = Math.max(0, fromIdx); i <= toIdx && i < bars.length; i++) {
    if (bars[i].volume !== null && bars[i].volume > 0) values.push(bars[i].volume);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function simpleMovingAverage(bars, endIdx, period) {
  if (endIdx + 1 < period) return null;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += bars[i].close;
  return sum / period;
}

function computeReturn(bars, anchorIdx, lookback) {
  const baseIdx = anchorIdx - lookback;
  if (baseIdx < 0) return { value: null, baseDate: null };
  return {
    value: pctChange(bars[anchorIdx].close, bars[baseIdx].close),
    baseDate: bars[baseIdx].time,
  };
}

function computeRelativeReturn(indexBars, anchorDate, baseDate, stockReturn) {
  if (stockReturn === null || !anchorDate || !baseDate || indexBars.length === 0) return null;
  const indexAnchor = lastCloseAtOrBefore(indexBars, anchorDate);
  const indexBase = lastCloseAtOrBefore(indexBars, baseDate);
  const indexReturn = pctChange(indexAnchor, indexBase);
  if (indexReturn === null) return null;
  return stockReturn - indexReturn;
}

function classifyFromScore(score) {
  if (score >= 8) return 'PRICE_OVEREXTENDED';
  if (score >= 5) return 'PRICE_EXTENDED';
  if (score >= 2) return 'PARTIALLY_EXTENDED';
  return 'NOT_EXTENDED';
}

function profitTakingRiskFor(classification) {
  switch (classification) {
    case 'PRICE_OVEREXTENDED': return 'high';
    case 'PRICE_EXTENDED': return 'high';
    case 'PARTIALLY_EXTENDED': return 'medium';
    case 'NOT_EXTENDED': return 'low';
    default: return 'unknown';
  }
}

function verdictPolicyFor(classification) {
  switch (classification) {
    case 'PRICE_OVEREXTENDED': return 'PROFIT_TAKING_RISK';
    case 'PRICE_EXTENDED': return 'DO_NOT_CHASE';
    case 'PARTIALLY_EXTENDED': return 'CONTROLLED_POSITIVE';
    case 'NOT_EXTENDED': return 'FRESH_CATALYST_POSSIBLE';
    default: return 'NO_TIMING_VERDICT';
  }
}

function normalizeConsensus(consensus) {
  if (!consensus || typeof consensus !== 'object') {
    return {
      surprise: 'UNKNOWN',
      source: null,
      note: 'Konsensüs/beklenti verisi sağlanmadı. Beklenti sürprizi BİLİNMİYOR; fiyatlanma kanıtı bunun yerine geçmez ve kesin zamanlama hükmü üretilmemeli.',
    };
  }
  const surprise = String(consensus.surprise || '').toLowerCase();
  if (!EXPECTATION_SURPRISE_VALUES.includes(surprise)) {
    return {
      surprise: 'UNKNOWN',
      source: null,
      note: 'Konsensüs alanı geçersiz formatta geldi; UNKNOWN kabul edildi.',
    };
  }
  return {
    surprise,
    source: consensus.source ? String(consensus.source) : 'belirtilmedi',
    note: null,
  };
}

// Ana giriş noktası. bars/indexBars kronolojik günlük OHLC(+volume) serileridir.
// announcementDate (YYYY-MM-DD) verilirse pencere bilanço açıklamasına
// çapalanır; verilmezse "güncel fiyatlama durumu" modu kullanılır.
function assessEarningsPricing(input = {}) {
  const symbol = String(input.symbol || '').toUpperCase();
  const bars = normalizeBars(input.bars);
  const indexBars = normalizeBars(input.indexBars);
  const announcementDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.announcementDate || ''))
    ? String(input.announcementDate)
    : null;
  const consensus = normalizeConsensus(input.consensus);
  const mode = announcementDate ? 'ANNOUNCEMENT_ANCHORED' : 'CURRENT_PRICING';

  const base = {
    symbol,
    mode,
    announcementDate,
    expectationSurprise: consensus.surprise,
    expectationSource: consensus.source,
    expectationNote: consensus.note,
    assessedAt: new Date().toISOString(),
  };

  const anchorIdx = findAnchorIndex(bars, announcementDate);
  const preBarCount = anchorIdx + 1;

  if (anchorIdx < 0 || preBarCount < 21) {
    return {
      ...base,
      classification: 'INSUFFICIENT_DATA',
      dataConfidence: 'low',
      profitTakingRisk: 'unknown',
      verdictPolicy: 'NO_TIMING_VERDICT',
      evidence: { preBarCount, reason: 'Bilanço öncesi en az 21 işlem günü kapanış verisi gerekli.' },
      evidenceLines: [`- Fiyat verisi yetersiz: ${preBarCount} işlem günü (< 21)`],
      constraints: buildConstraints('INSUFFICIENT_DATA', consensus.surprise),
    };
  }

  const anchorBar = bars[anchorIdx];
  const ret5 = computeReturn(bars, anchorIdx, 5);
  const ret20 = computeReturn(bars, anchorIdx, 20);
  const ret60 = computeReturn(bars, anchorIdx, 60);

  const relRet20 = computeRelativeReturn(indexBars, anchorBar.time, ret20.baseDate, ret20.value);
  const relRet60 = computeRelativeReturn(indexBars, anchorBar.time, ret60.baseDate, ret60.value);

  const recentAvgVolume = averageVolume(bars, anchorIdx - 19, anchorIdx);
  const baselineAvgVolume = averageVolume(bars, anchorIdx - 59, anchorIdx - 20);
  const volumeExpansion = recentAvgVolume !== null && baselineAvgVolume !== null && baselineAvgVolume > 0
    ? recentAvgVolume / baselineAvgVolume
    : null;

  const ma50 = simpleMovingAverage(bars, anchorIdx, 50);
  const distanceToMa50 = ma50 === null ? null : pctChange(anchorBar.close, ma50);

  // Bilanço sonrası ilk işlem günü tepkisi (sadece açıklama çapalı modda).
  let postReaction = { direction: 'not_observed', returnPct: null, volumeRatio: null };
  if (mode === 'ANNOUNCEMENT_ANCHORED' && anchorIdx < bars.length - 1) {
    const reactionBar = bars[anchorIdx + 1];
    const reactionReturn = pctChange(reactionBar.close, anchorBar.close);
    const reactionVolumeRatio = reactionBar.volume !== null && recentAvgVolume
      ? reactionBar.volume / recentAvgVolume
      : null;
    postReaction = {
      direction: reactionReturn === null ? 'not_observed' : reactionReturn <= -2 ? 'negative' : reactionReturn >= 2 ? 'positive' : 'neutral',
      returnPct: round1(reactionReturn),
      volumeRatio: round2(reactionVolumeRatio),
      date: reactionBar.time,
    };
  }

  // Kanıt puanlama — eşikler deterministik ve denetlenebilir.
  let score = 0;
  const scoreBreakdown = [];
  const addScore = (points, label) => {
    if (points > 0) {
      score += points;
      scoreBreakdown.push({ points, label });
    }
  };

  if (ret20.value !== null) {
    if (ret20.value >= 25) addScore(3, `20 günlük getiri +%${round1(ret20.value)} (≥25)`);
    else if (ret20.value >= 15) addScore(2, `20 günlük getiri +%${round1(ret20.value)} (≥15)`);
    else if (ret20.value >= 8) addScore(1, `20 günlük getiri +%${round1(ret20.value)} (≥8)`);
  }
  if (relRet20 !== null) {
    if (relRet20 >= 15) addScore(3, `XU100 göreceli 20g +%${round1(relRet20)} (≥15)`);
    else if (relRet20 >= 8) addScore(2, `XU100 göreceli 20g +%${round1(relRet20)} (≥8)`);
    else if (relRet20 >= 4) addScore(1, `XU100 göreceli 20g +%${round1(relRet20)} (≥4)`);
  }
  if (volumeExpansion !== null) {
    if (volumeExpansion >= 2.2) addScore(2, `Hacim genişlemesi ${round2(volumeExpansion)}x (≥2.2)`);
    else if (volumeExpansion >= 1.5) addScore(1, `Hacim genişlemesi ${round2(volumeExpansion)}x (≥1.5)`);
  }
  if (distanceToMa50 !== null) {
    if (distanceToMa50 >= 18) addScore(2, `Fiyat MA50'nin %${round1(distanceToMa50)} üzerinde (≥18)`);
    else if (distanceToMa50 >= 10) addScore(1, `Fiyat MA50'nin %${round1(distanceToMa50)} üzerinde (≥10)`);
  }
  if (ret60.value !== null && ret60.value >= 35) {
    addScore(1, `60 günlük getiri +%${round1(ret60.value)} (≥35)`);
  }
  if (postReaction.direction === 'negative' && postReaction.volumeRatio !== null && postReaction.volumeRatio >= 1.3) {
    addScore(1, `Bilanço sonrası ilk gün %${postReaction.returnPct} + yüksek hacim (kâr satışı işareti)`);
  }

  const classification = classifyFromScore(score);

  const relativeAvailable = relRet20 !== null;
  const volumeAvailable = volumeExpansion !== null;
  const dataConfidence = preBarCount >= 61 && relativeAvailable && volumeAvailable
    ? 'high'
    : preBarCount >= 40 && (relativeAvailable || volumeAvailable)
      ? 'medium'
      : 'low';

  const evidence = {
    referenceDate: anchorBar.time,
    referenceClose: anchorBar.close,
    preBarCount,
    return5d: round1(ret5.value),
    return20d: round1(ret20.value),
    return60d: round1(ret60.value),
    relativeReturn20d: round1(relRet20),
    relativeReturn60d: round1(relRet60),
    volumeExpansion: round2(volumeExpansion),
    distanceToMa50: round1(distanceToMa50),
    postReaction,
    pricingScore: score,
    scoreBreakdown,
  };

  const evidenceLines = buildEvidenceLines(evidence, mode);

  // "Bilanço fiyatlandı" hükmü, "fiyat uzamış" hükmünden FARKLIDIR ve ancak
  // beklenti ekseni bilindiğinde kurulabilir. Konsensüs yoksa bu alan
  // açıkça UNKNOWN kalır; classification onun yerine geçmez.
  const earningsPricedIn = consensus.surprise === 'UNKNOWN' || !announcementDate
    ? {
        verdict: 'UNKNOWN',
        reason: !announcementDate
          ? 'Bilanço açıklama tarihi verilmedi; ölçüm güncel fiyat uzaması modundadır, bilanço fiyatlanması hükmü kurulamaz.'
          : 'Beklenti/konsensüs verisi yok; fiyat uzaması ölçüsü bilanço fiyatlanmasının yerine geçmez.',
      }
    : {
        verdict: (classification === 'PRICE_EXTENDED' || classification === 'PRICE_OVEREXTENDED') && consensus.surprise !== 'below'
          ? 'LIKELY_PRICED_IN'
          : classification === 'NOT_EXTENDED'
            ? 'LIKELY_NOT_PRICED_IN'
            : 'PARTIALLY_PRICED_IN',
        reason: `Açıklama tarihi (${announcementDate}) + beklenti sürprizi (${consensus.surprise}) + fiyat uzaması (${classification}) birlikte değerlendirildi.`,
        expectationSource: consensus.source,
      };

  return {
    ...base,
    classification,
    // Etiketin NE ÖLÇTÜĞÜ cevaba taşınmalı; "PRICE_EXTENDED" görüp "bilanço
    // fiyatlandı" diye okumanın önüne bu satır geçer.
    classificationMeaning: 'Fiyatın son dönemde ne kadar uzadığını ölçer (getiri + XU100 göreceli getiri + hacim genişlemesi + MA50 uzaklığı). Beklenti/konsensüs GİRDİ DEĞİLDİR.',
    earningsPricedIn,
    dataConfidence,
    profitTakingRisk: profitTakingRiskFor(classification),
    verdictPolicy: verdictPolicyFor(classification),
    evidence,
    evidenceLines,
    constraints: buildConstraints(classification, consensus.surprise),
  };
}

function buildEvidenceLines(evidence, mode) {
  const lines = [];
  const prefix = mode === 'ANNOUNCEMENT_ANCHORED' ? 'Bilanço öncesi' : 'Son';
  const fmtPct = (v) => (v === null ? 'veri yok' : `${v >= 0 ? '+' : ''}%${v}`);
  lines.push(`- ${prefix} 5 gün: ${fmtPct(evidence.return5d)}`);
  lines.push(`- ${prefix} 20 gün: ${fmtPct(evidence.return20d)}`);
  lines.push(`- ${prefix} 60 gün: ${fmtPct(evidence.return60d)}`);
  lines.push(`- XU100 göreceli 20 gün: ${fmtPct(evidence.relativeReturn20d)}`);
  // ETİKET AYRIMI: bu MA50 uzaklığı REFERANS KAPANIŞA göredir.
  // analyze_finance_signal aynı adı CANLI FİYAT için kullanıyor; ikisi aynı
  // cevapta farklı sayı üretip (KCHOL %2,48 vs %6,7) çelişki gibi görünüyordu.
  lines.push(`- Hacim genişlemesi (20g/önceki 40g): ${evidence.volumeExpansion === null ? 'veri yok' : evidence.volumeExpansion + 'x'}`);
  lines.push(`- REFERANS KAPANIŞIN 50 günlük ortalamaya uzaklığı (${evidence.referenceDate || 'referans'}): ${fmtPct(evidence.distanceToMa50)} — bu, son CANLI fiyatın MA50 uzaklığı DEĞİLDİR`);
  if (evidence.postReaction.direction !== 'not_observed') {
    lines.push(`- Bilanço sonrası ilk gün tepkisi: ${fmtPct(evidence.postReaction.returnPct)} (hacim ${evidence.postReaction.volumeRatio ?? '?'}x)`);
  }
  return lines;
}

// Dil güvenliği + hüküm kısıtları: LLM'in çıktısında uyması gereken kurallar.
function buildConstraints(classification, expectationSurprise) {
  const constraints = {
    forbiddenPhrases: [],
    requiredWarnings: [],
    timingVerdictAllowed: true,
    notes: [],
  };

  if (classification === 'INSUFFICIENT_DATA' || classification === 'NOT_ASSESSED') {
    constraints.timingVerdictAllowed = false;
    constraints.notes.push('Fiyatlanma ölçülemedi: bilanço kalitesi yorumlanabilir, giriş zamanlaması hükmü üretilemez.');
  }

  if (classification === 'PRICE_EXTENDED' || classification === 'PRICE_OVEREXTENDED') {
    constraints.forbiddenPhrases.push('güçlü alım fırsatı', 'kaçırılmaz fırsat');
    constraints.requiredWarnings.push('kovalamama', 'kâr realizasyonu riski', 'sınırlı kalan getiri alanı');
    constraints.notes.push('Sonuçlar büyük ölçüde önceden fiyatlanmış görünüyor; yukarı yön sürebilir ama kalan getiri/risk oranı daralmıştır.');
  }

  if (expectationSurprise === 'UNKNOWN') {
    constraints.notes.push('Beklenti (konsensüs) verisi yok: bilançonun beklentiden iyi mi geldiği BİLİNMİYOR. Zamanlama hükmü verilecekse güven seviyesi düşürülerek ve bu belirsizlik açıkça yazılarak verilmeli.');
  }

  return constraints;
}

module.exports = {
  PRICING_CLASSIFICATIONS,
  LEGACY_PRICING_CLASSIFICATION_ALIASES,
  EXPECTATION_SURPRISE_VALUES,
  assessEarningsPricing,
};
