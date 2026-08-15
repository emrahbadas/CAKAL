// ═══════════════════════════════════════════════
// Telegram tarama kapsamı — saf modül (ağ/fs bağımsız)
//
// İki karar burada verilir:
//   1. HANGİ KANALLAR taranır  → kullanıcının Ayarlar'da seçtiği küme
//   2. HANGİ ZAMAN ARALIĞI     → varsayılan BUGÜN, genişletme açık istekle
//
// Neden saf: ikisi de "modelin dediği" değil "kullanıcının dediği" ile
// belirlenmeli. Ağdan ayrık tutulunca gerçek mesajlarla test edilebiliyor.
// ═══════════════════════════════════════════════

const TIME_WINDOWS = Object.freeze({
  today: { days: 1, label: 'bugün' },
  week: { days: 7, label: 'son 7 gün' },
  month: { days: 30, label: 'son 30 gün' },
  all: { days: null, label: 'tüm geçmiş' },
});

const DEFAULT_WINDOW = 'today';

/**
 * Kullanıcı AÇIKÇA daha geniş bir aralık istedi mi?
 *
 * Sıra geniş→dar: "son 1 ay" hem ay hem gün kalıbı içerebilir, en geniş
 * eşleşme kazanır. Kullanıcı iki aralık birden yazdıysa geniş olan alınır —
 * daraltmak kullanıcının istemediği veriyi gizlemek olurdu.
 *
 * TÜRKÇE TUZAĞI: JS regex'te `\b` Türkçe harflerde güvenilmez ve 'İ' (U+0130)
 * `i` ile eşleşmez. Bu yüzden sınır kontrolleri açık karakter sınıfıyla
 * yazıldı; metin tr-TR kurallarıyla küçültülür ("AY" → "ay").
 */
const WINDOW_PATTERNS = Object.freeze([
  ['all', [
    /tüm\s*geçmiş/,
    /tüm\s*mesaj/,
    /bütün\s*mesaj/,
    /arşiv/,
    /hepsini\s*(?:tara|oku|getir)/,
    /zaman\s*sınırı\s*(?:olmadan|yok)/,
  ]],
  ['month', [
    // "ay" sonrası harf gelirse başka kelimedir: ayrıca, ayarlar, ayna...
    /son\s*(?:bir|1)?\s*ay(?:lık|ın|ı)?(?![a-zçğıöşü])/,
    /geçen\s*ay(?![a-zçğıöşü])/,
    /(?:son\s*)?30\s*gün/,
    /(?:son\s*)?4\s*hafta/,
  ]],
  ['week', [
    /son\s*(?:bir|1)?\s*hafta/,
    /geçen\s*hafta/,
    /haftalık/,
    /(?:son\s*)?7\s*gün/,
  ]],
  ['today', [
    /bugün/,
    /son\s*24\s*saat/,
    /güncel\s*mesaj/,
  ]],
]);

/** tr-TR küçültme: "AY" → "ay", "İSTANBUL" → "istanbul". */
function normalize(text) {
  return String(text || '').toLocaleLowerCase('tr-TR');
}

/**
 * Kullanıcının mesajından istenen aralığı çıkarır.
 * @returns {'today'|'week'|'month'|'all'|null} açık istek yoksa null
 */
function detectRequestedWindow(userMessage) {
  const text = normalize(userMessage);
  if (!text) return null;
  for (const [window, patterns] of WINDOW_PATTERNS) {
    if (patterns.some((re) => re.test(text))) return window;
  }
  return null;
}

/**
 * Etkin aralığı belirler.
 *
 * KURAL: kullanıcı açıkça genişletmediyse BUGÜN. Modelin `time_window`
 * parametresi tek başına genişletme YETKİSİ DEĞİLDİR — aksi hâlde model
 * her turda "month" yazıp gürültüyü ve token maliyetini geri getirebilirdi.
 * Bu, "beyan kanıt değildir" kuralının kapsam tarafındaki karşılığı.
 *
 * Model DARALTMAK isterse serbesttir: bugünden dar bir şey yok, ama
 * kullanıcı "son 1 ay" derken model "today" derse kullanıcı kazanır.
 */
function resolveTimeWindow(modelValue, userMessage) {
  const asked = detectRequestedWindow(userMessage);
  const requested = TIME_WINDOWS[modelValue] ? modelValue : null;
  const window = asked || DEFAULT_WINDOW;

  return {
    window,
    label: TIME_WINDOWS[window].label,
    requestedByModel: requested,
    userAsked: asked,
    // Model daha geniş bir aralık istedi ama kullanıcı istemediği için kısıldı.
    clamped: requested !== null && requested !== window,
  };
}

/**
 * Aralığın başlangıç zamanı (ISO).
 *
 * "bugün" makinenin günü değil BORSANIN/KULLANICININ günü olmalı. Kaptan
 * denizde GMT+1'de olabiliyor; onun gece yarısı İstanbul'da ertesi gün.
 * Aynı varsayım daha önce "bugün alım" hükmünde yanlış güne düşmüştü.
 *
 * Türkiye 2016'dan beri kalıcı UTC+03:00 (yaz saati uygulaması yok).
 * Gün SINIRI Intl ile İstanbul takviminden alınır, ofset sabittir.
 */
function windowStartIso(window, now = new Date()) {
  const spec = TIME_WINDOWS[window];
  if (!spec || spec.days === null) return null; // 'all' → sınır yok

  if (window === 'today') {
    const istanbulDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return new Date(`${istanbulDate}T00:00:00+03:00`).toISOString();
  }

  // week/month: takvim değil, ŞU ANDAN geriye kayan pencere.
  // "son 1 hafta" 7 gün öncesinden bu yana demektir.
  return new Date(now.getTime() - spec.days * 24 * 60 * 60 * 1000).toISOString();
}

/** Mesaj listesini aralığa göre eler. `sinceIso` null ise hepsi geçer. */
function filterMessagesByWindow(messages, sinceIso) {
  const list = Array.isArray(messages) ? messages : [];
  if (!sinceIso) return list;
  const threshold = Date.parse(sinceIso);
  if (!Number.isFinite(threshold)) return list;

  return list.filter((m) => {
    const stamp = Date.parse(m?.date);
    // Tarihi okunamayan mesaj ELENİR: "belki aralıktadır" diye içeri almak
    // kapsam beyanını yalan yapar. Aralık dışı olmadığını kanıtlayamıyorsak
    // aralık içinde sayamayız.
    if (!Number.isFinite(stamp)) return false;
    return stamp >= threshold;
  });
}

/**
 * Kayıtlı (kullanıcının seçtiği) kanal kümesini kanal kimliklerine indirger.
 * Seçim yoksa boş dizi döner — çağıran "seçim yapılmamış" durumunu ayırt
 * edebilsin diye burada sessizce tüm kanallara GENİŞLETİLMEZ.
 */
function savedChannelIds(savedChannels) {
  return [...new Set(
    (Array.isArray(savedChannels) ? savedChannels : [])
      .map((c) => String(c?.id || '').trim())
      .filter(Boolean),
  )];
}

module.exports = {
  TIME_WINDOWS,
  DEFAULT_WINDOW,
  detectRequestedWindow,
  resolveTimeWindow,
  windowStartIso,
  filterMessagesByWindow,
  savedChannelIds,
};
