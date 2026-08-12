'use strict';

/**
 * SUPABASE REALTIME TRANSPORT ÇÖZÜMLEYİCİSİ
 *
 * Sorun: Electron 31.3.1 = Node 20. Global `WebSocket` Node 22'de geldi, 20'de
 * yok. `@supabase/realtime-js` transport verilmezse bağlanamaz ve konsola
 * "Ensure you are running Node.js 22+..." yazar. REST (postgrest) etkilenmez,
 * bu yüzden arıza sessizdir: sorgular çalışmaya devam eder, yalnız realtime
 * ölür ve kimse fark etmez.
 *
 * Çözüm `ws` paketini transport olarak enjekte etmek. Ama düzeltmenin KENDİSİ
 * kırılgandı: `ws` hiçbir package.json'da bildirilmemişti, yalnız `openai@6`
 * üzerinden transitive geliyordu ve çağrı `try { } catch (_) { }` ile sessizce
 * yutuluyordu. Yani "düzelttik" beyanı vardı, düzeltmenin varlığı garanti
 * değildi — openai bir gün `ws`'i bıraksa hiçbir sinyal çıkmadan realtime
 * kapanırdı.
 *
 * Bu modül iki şeyi ayırır: transport'u ÇÖZMEK ve çözümü RAPORLAMAK.
 * Yutulan hata yerine durum kodu döner; çağıran taraf sessiz kalamaz.
 */

/** Çözümleme durumları. `OK` dışındaki her durumda realtime çalışmaz. */
const TRANSPORT_STATUS = Object.freeze({
  OK: 'OK',
  MISSING: 'MISSING',
  INVALID: 'INVALID',
});

/**
 * `ws` paketini yükler ve sonucu durum koduyla raporlar.
 *
 * @param {{ load?: (name: string) => unknown }} [options]
 *   `load` yalnız test içindir; üretimde modülün kendi `require`'ı kullanılır.
 * @returns {{ status: string, transport: Function|null, detail: string|null }}
 */
function resolveRealtimeTransport(options = {}) {
  const load = options.load || ((name) => require(name));
  let loaded;
  try {
    loaded = load('ws');
  } catch (error) {
    return {
      status: TRANSPORT_STATUS.MISSING,
      transport: null,
      detail: (error && error.message) || 'ws yüklenemedi',
    };
  }
  // `ws` WebSocket sınıfını (constructor) döndürür. Şekli değişirse realtime-js
  // çağrı anında patlar; burada yakalamak, bağlantı anında patlamaktan iyidir.
  if (typeof loaded !== 'function') {
    return {
      status: TRANSPORT_STATUS.INVALID,
      transport: null,
      detail: `ws beklenen constructor yerine ${typeof loaded} döndürdü`,
    };
  }
  return { status: TRANSPORT_STATUS.OK, transport: loaded, detail: null };
}

/**
 * Çözümlemeyi `createClient` seçeneklerine çevirir.
 * Transport yoksa BOŞ nesne döner — supabase-js'e `transport: null` geçmek
 * kendi varsayılanını da bozar.
 *
 * @param {{ status: string, transport: Function|null }|null|undefined} resolution
 * @returns {{ realtime?: { transport: Function } }}
 */
function buildRealtimeClientOptions(resolution) {
  if (!resolution || resolution.status !== TRANSPORT_STATUS.OK || !resolution.transport) return {};
  return { realtime: { transport: resolution.transport } };
}

/**
 * Log satırı üretir. `OK` durumunda null döner (gürültü yok); diğer her
 * durumda çağıran tarafın yazması gereken uyarı metnini verir.
 *
 * @param {{ status: string, detail: string|null }|null|undefined} resolution
 * @returns {string|null}
 */
function describeRealtimeTransport(resolution) {
  if (!resolution || resolution.status === TRANSPORT_STATUS.OK) return null;
  const detail = resolution.detail ? ` (${resolution.detail})` : '';
  return `[DB] Realtime transport yok${detail} — Node 20'de global WebSocket bulunmadığı için `
    + 'realtime abonelikleri çalışmayacak. REST sorguları etkilenmez.';
}

module.exports = {
  TRANSPORT_STATUS,
  resolveRealtimeTransport,
  buildRealtimeClientOptions,
  describeRealtimeTransport,
};
