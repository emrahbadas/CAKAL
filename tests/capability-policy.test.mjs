import { describe, it, expect } from 'vitest';

import policy from '../apps/desktop/electron/surgery/capability-policy.cjs';
import identity from '../apps/desktop/electron/cakal-identity.cjs';

const { validateManifest, evaluateManifest, collectEvidence, evaluateChange } = policy;

/**
 * ÜRÜN ANAYASASI — kapsam kapısı.
 *
 * Kullanıcının verdiği iki referans örnek:
 *   İZİNLİ  : "hava durumu / fiyat araştırması tool'u ekle"
 *   REDDEDİL: "sosyal medya hesabımda video paylaşan orchestrator ekle"
 *
 * Kritik ilke: BEYAN KANIT DEĞİLDİR. Manifest zararsız beyan etse bile
 * diff'te dış yazma izi varsa kanıt kazanır.
 */

const WEATHER_MANIFEST = {
  name: 'weather_lookup',
  capability: 'external_read',
  side_effect: 'none',
  auth_scope: 'read_only',
  reversible: true,
  user_identity_representation: false,
};

const SOCIAL_MANIFEST = {
  name: 'publish_social_video',
  capability: 'external_write',
  side_effect: 'public_publish',
  auth_scope: 'write',
  reversible: false,
  user_identity_representation: true,
};

describe('manifest şeması', () => {
  it('geçerli manifesti kabul eder', () => {
    expect(validateManifest(WEATHER_MANIFEST).ok).toBe(true);
  });

  it('bilinmeyen alan değerlerini reddeder', () => {
    const result = validateManifest({ ...WEATHER_MANIFEST, capability: 'sihirli' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/capability/);
  });

  it('isimsiz manifesti reddeder', () => {
    expect(validateManifest({ ...WEATHER_MANIFEST, name: '' }).ok).toBe(false);
  });
});

describe('beyan değerlendirmesi', () => {
  it('hava durumu tool\'u geçer (inceleme ile)', () => {
    const result = evaluateManifest(WEATHER_MANIFEST);
    expect(result.verdict).toBe('REVIEW');
    expect(result.reasons.join(' ')).toMatch(/dış veri kaynağı/i);
  });

  it('sosyal medya paylaşımını bloklar', () => {
    const result = evaluateManifest(SOCIAL_MANIFEST);
    expect(result.verdict).toBe('BLOCK');
    const text = result.reasons.join(' ');
    expect(text).toMatch(/kimliğini temsil/i);
    expect(text).toMatch(/public_publish|kapsam dışı/i);
  });

  it('finansal işlem yan etkisini bloklar', () => {
    const result = evaluateManifest({ ...WEATHER_MANIFEST, side_effect: 'financial_transaction' });
    expect(result.verdict).toBe('BLOCK');
  });

  it('yazma yetkili kimlik kapsamını bloklar', () => {
    expect(evaluateManifest({ ...WEATHER_MANIFEST, auth_scope: 'write' }).verdict).toBe('BLOCK');
  });

  it('iç işlem serbesttir (watchlist, alarm, taslak)', () => {
    const result = evaluateManifest({
      name: 'save_watchlist', capability: 'internal', side_effect: 'internal_state',
      auth_scope: 'none', reversible: true, user_identity_representation: false,
    });
    expect(result.verdict).toBe('ALLOW');
  });
});

describe('diff kanıtı', () => {
  it('dış yazma izini yakalar', () => {
    expect(collectEvidence(["method: 'POST'"]).externalWrite).toBe(true);
    expect(collectEvidence(['await axios.post(url, body)']).externalWrite).toBe(true);
    expect(collectEvidence(['const fd = new FormData()']).externalWrite).toBe(true);
    expect(collectEvidence(['await upload(file)']).externalWrite).toBe(true);
  });

  it('tanımlayıcı ADI tek başına kanıt sayılmaz (yanlış pozitif koruması)', () => {
    // `publish` önekini yakalasaydık haber API'lerindeki `publishedAt` alanı
    // eşleşir ve meşru bir haber kaynağı bloklanırdı. Gerçek yazma izi
    // POST/scope/FormData'dır; isim değil.
    expect(collectEvidence(['function publishVideo() {}']).externalWrite).toBe(false);
    expect(collectEvidence(['const t = item.publishedAt;']).externalWrite).toBe(false);
    expect(collectEvidence(['const posts = data.posts;']).externalWrite).toBe(false);
  });

  it('ödeme/broker izini yakalar', () => {
    expect(collectEvidence(['const s = require("stripe")']).financialAction).toBe(true);
    expect(collectEvidence(['await placeOrder(symbol, qty)']).financialAction).toBe(true);
  });

  it('yazma yetkili kimlik kapsamını yakalar', () => {
    expect(collectEvidence(["scope: 'tweet.write users.read'"]).writeScope).toBe(true);
  });

  it('zamanlanmış iş izini yakalar', () => {
    expect(collectEvidence(["cron.schedule('0 * * * *', fn)"]).scheduler).toBe(true);
    expect(collectEvidence(['setInterval(tick, 1000)']).scheduler).toBe(true);
  });

  it('salt okuma kodunu işaretlemez', () => {
    const e = collectEvidence(['const res = await fetch(url)', 'const json = await res.json()']);
    expect(e.externalWrite).toBe(false);
    expect(e.financialAction).toBe(false);
    expect(e.writeScope).toBe(false);
  });
});

describe('kapsam kararı — uçtan uca', () => {
  it('İZİNLİ ÖRNEK: hava durumu tool\'u', () => {
    const result = evaluateChange({
      manifest: WEATHER_MANIFEST,
      addedLines: ["const res = await fetch('https://api.openweathermap.org/data/2.5/weather')"],
    });
    expect(result.verdict).toBe('REVIEW');   // yeni veri kaynağı — insan bakar
    expect(result.verdict).not.toBe('BLOCK');
  });

  it('REDDEDİLEN ÖRNEK: sosyal medyaya video paylaşımı', () => {
    const result = evaluateChange({
      manifest: SOCIAL_MANIFEST,
      addedLines: ["await api.post('/2/tweets', { media })", "scope: 'tweet.write'"],
    });
    expect(result.verdict).toBe('BLOCK');
  });

  it('BEYAN–GERÇEK ÇELİŞKİSİ: zararsız beyan + dış yazma izi → BLOK', () => {
    // Cerrah sosyal medya tool'unu "external_read" diye etiketlemeye çalışıyor.
    const result = evaluateChange({
      manifest: WEATHER_MANIFEST,                       // zararsız beyan
      addedLines: ["await api.post('/2/tweets', body)"], // ama gerçek yazma
    });
    expect(result.verdict).toBe('BLOCK');
    expect(result.reasons.join(' ')).toMatch(/BEYAN–GERÇEK ÇELİŞKİSİ/);
  });

  it('manifest olmasa da kanıt tek başına bloklar', () => {
    const result = evaluateChange({ addedLines: ["await stripe.charges.create({})"] });
    expect(result.verdict).toBe('BLOCK');
  });

  it('zamanlanmış iş insan incelemesi ister, bloklamaz', () => {
    const result = evaluateChange({ addedLines: ["cron.schedule('0 9 * * *', scan)"] });
    expect(result.verdict).toBe('REVIEW');
  });

  it('sıradan kod serbest geçer', () => {
    const result = evaluateChange({ addedLines: ['function topla(a, b) { return a + b; }'] });
    expect(result.verdict).toBe('ALLOW');
    expect(result.reasons).toHaveLength(0);
  });
});

describe('kimlik ve anayasa modülü', () => {
  it('ana rol tanımlı', () => {
    expect(identity.CORE_ROLE).toMatch(/finans/i);
  });

  it('anayasa metni cerraha bağlayıcı kısıtları içerir', () => {
    const contract = identity.buildSurgeonContract();
    expect(contract).toMatch(/kimliğini veya ana ürün rolünü değiştirme/i);
    expect(contract).toMatch(/gerçek para|transfer|ödeme/i);
    expect(contract).toMatch(/Kapsam dışı bir talep verilirse KOD ÜRETME/i);
  });

  it('ÇAKAL promptu kapsam dışı istekleri devretmemeyi söyler', () => {
    const section = identity.buildCharterPromptSection();
    expect(section).toMatch(/propose_surgical_change çağırma/i);
    expect(section).toMatch(/Sosyal medya içerik yayınlama/i);
  });

  it('ürün ilkesi mutlak değil, sonuç niteliğine bakar', () => {
    // "hiç iş yapmaz" değil; geri dönüşü zor/kamusal/finansal/hukuki olanı yapmaz.
    expect(identity.PRODUCT_PRINCIPLE).toMatch(/geri dönüşü zor|kamusal|finansal|hukuki/i);
  });
});
