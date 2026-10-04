// ═══════════════════════════════════════════════
// Nakit köprüsü mutabakatı — saf modül (ağ/fs bağımsız)
//
// SORUN (docs §3.2): nakit akış SATIRLARI düzeltildi ama köprünün KAPANDIĞI
// hiç doğrulanmıyordu. Ölçülen vaka: BRSAN turunda ÇAKAL doğru sonuca vardı
// ama köprüyü kapatamadan vardı — eksikliği fark etti, yine de hüküm kurdu.
// Sonuç doğruydu; YÖNTEM değildi.
//
// Köprü şudur:
//   işletme + yatırım + finansman + kur etkisi + diğer = net nakit değişimi
//
// Kapanmıyorsa elimizdeki satırların şirketin gerçek nakit hikâyesini
// tarif ettiğini SÖYLEYEMEYİZ. Bir kalem eksik okunmuş, bir satır yanlış
// eşleşmiş ya da tablo bizim beklediğimiz yapıda değil demektir. O durumda
// "nakit işletmeden geldi" veya "finansmanla makyaj yok" cümleleri kanıtsız
// kalır.
//
// ÖLÇÜLEN GERÇEK VERİ (BRSAN 2026/6, İş Yatırım XI_29, 4 Ekim 2026):
//   İşletme     +7.695.330.000
//   Yatırım     -3.554.310.000
//   Finansman     -194.124.000
//   Kur etkisi     -13.853.000
//   ──────────────────────────
//   Toplam      +3.933.043.000
//   Bildirilen  +3.933.043.000   → fark 0, köprü TAM kapanıyor
//   Çapraz kontrol: dönem sonu 9.393.170.000 − dönem başı 5.460.127.000
//                   = 3.933.043.000 ✓
// ═══════════════════════════════════════════════

/** Köprüyü oluşturan bileşenler. Hepsi net nakit AKIŞIDIR (stok değil). */
const BRIDGE_COMPONENTS = Object.freeze([
  'isletmeNakitAkisi',
  'yatirimNakitAkisi',
  'finansmanNakitAkisi',
  'kurCevrimEtkisi',
  'digerNakitHareketi',
]);

/** Kur etkisi ve "diğer" sıfır olabilir ve çoğu tabloda hiç bulunmaz. */
const OPTIONAL_COMPONENTS = Object.freeze(['kurCevrimEtkisi', 'digerNakitHareketi']);

// Tolerans: tablolar yuvarlanabilir. Mutlak taban + bileşenlere oranlı pay.
// Sıfıra yakın bir net değişimde yalnız oransal tolerans kullanmak her
// köprüyü "kapanmadı" yapardı.
const ABSOLUTE_TOLERANCE = 1000;
const RELATIVE_TOLERANCE = 0.005;

function firstValue(items, key) {
  const hit = (Array.isArray(items) ? items : []).find((i) => i && i.key === key);
  const v = hit?.values?.[0];
  return Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null;
}

/**
 * Nakit köprüsü kapanıyor mu?
 *
 * @returns {{
 *   reconciled: boolean,
 *   reason: string,
 *   components: Record<string, number|null>,
 *   computed: number|null,
 *   reported: number|null,
 *   difference: number|null,
 *   tolerance: number|null,
 *   missing: string[],
 *   crossCheck: {opening: number|null, closing: number|null, delta: number|null, agrees: boolean|null},
 * }}
 *
 * `reconciled` YALNIZCA hesaplanan toplam ile bildirilen net değişim
 * tolerans içinde eşleşirse true olur. Veri eksikse false döner — "bilmiyoruz"
 * ile "kapanıyor" aynı şey değildir ve karışması tam da bu maddenin sebebi.
 */
function reconcileCashBridge(cashFlowItems = []) {
  const components = {};
  const missing = [];
  for (const key of BRIDGE_COMPONENTS) {
    const value = firstValue(cashFlowItems, key);
    components[key] = value;
    if (value === null && !OPTIONAL_COMPONENTS.includes(key)) missing.push(key);
  }

  const reported = firstValue(cashFlowItems, 'netNakitDegisimi');

  const opening = firstValue(cashFlowItems, 'donemBasiNakit');
  const closing = firstValue(cashFlowItems, 'donemSonuNakit');
  const crossDelta = opening !== null && closing !== null ? closing - opening : null;

  const bos = {
    reconciled: false,
    components,
    computed: null,
    reported,
    difference: null,
    tolerance: null,
    missing,
    crossCheck: { opening, closing, delta: crossDelta, agrees: null },
  };

  if (missing.length > 0) {
    return { ...bos, reason: `Köprü bileşenleri eksik: ${missing.join(', ')}. Kapanış doğrulanamaz.` };
  }
  if (reported === null) {
    return { ...bos, reason: 'Net nakit değişimi satırı bulunamadı; köprünün kapandığı doğrulanamaz.' };
  }

  // Opsiyonel bileşenler yoksa 0 sayılır — tabloda yoksa etkisi de yoktur.
  const computed = BRIDGE_COMPONENTS.reduce((sum, key) => sum + (components[key] ?? 0), 0);
  const difference = computed - reported;
  const olcek = Math.max(
    Math.abs(reported),
    ...BRIDGE_COMPONENTS.map((k) => Math.abs(components[k] ?? 0)),
  );
  const tolerance = Math.max(ABSOLUTE_TOLERANCE, olcek * RELATIVE_TOLERANCE);
  const reconciled = Math.abs(difference) <= tolerance;

  const agrees = crossDelta === null ? null : Math.abs(crossDelta - reported) <= tolerance;

  return {
    reconciled,
    reason: reconciled
      ? 'Nakit köprüsü kapanıyor: bileşenlerin toplamı bildirilen net değişime eşit.'
      : `Nakit köprüsü KAPANMIYOR: hesaplanan ${computed} ≠ bildirilen ${reported} (fark ${difference}, tolerans ${Math.round(tolerance)}).`,
    components,
    computed,
    reported,
    difference,
    tolerance,
    missing,
    crossCheck: { opening, closing, delta: crossDelta, agrees },
  };
}

/**
 * Köprü kapanmadan kaynak hükmü kurulabilir mi?
 *
 * Kapanmayan köprüde "nakit işletmeden geldi" demek, elimizdeki satırların
 * şirketin nakit hikâyesini tarif ettiğini varsaymaktır. Varsayım kanıt
 * değildir; sınıflandırma UNRECONCILED'a indirilir.
 */
function attributionAllowed(reconciliation) {
  return Boolean(reconciliation && reconciliation.reconciled === true);
}

module.exports = {
  BRIDGE_COMPONENTS,
  OPTIONAL_COMPONENTS,
  reconcileCashBridge,
  attributionAllowed,
};
