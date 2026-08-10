import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(
  path.join(here, '..', 'apps', 'desktop', 'electron', 'main.cjs'),
  'utf8',
);

// main.cjs Electron bağımlıdır; STT koruma fonksiyonları saf olduğu için
// kaynaktan izole edip değerlendiriyoruz (mynet-live-board.test.mjs yöntemi).
// Korumalar main.cjs'te bitişik bir blokta durur (NON_LATIN_SCRIPT_RE'den
// callOpenAiTranscription'a kadar). Bloğu bir bütün olarak alıyoruz: tek tek
// regex'le parça toplamak sabit ve kırılgan olurdu.
function loadGuards() {
  const start = mainSource.indexOf('const NON_LATIN_SCRIPT_RE');
  const end = mainSource.indexOf('async function callOpenAiTranscription');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('main.cjs içindeki STT koruma bloğu bulunamadı — test kaynakla senkron değil.');
  }
  const block = mainSource.slice(start, end);
  for (const name of ['isPromptHallucination', 'isForeignLanguageDrift', 'normalizeSttText']) {
    if (!block.includes(`function ${name}(`)) throw new Error(`Koruma bloğunda eksik: ${name}`);
  }
  return new Function(
    `${block}\nreturn { isPromptHallucination, isForeignLanguageDrift, STT_LANGUAGE_PROMPT };`,
  )();
}

const { isPromptHallucination, isForeignLanguageDrift, STT_LANGUAGE_PROMPT } = loadGuards();

describe('STT prompt yankısı filtresi', () => {
  // GEÇMİŞ HATA: sessizlikte model, dil kilidi prompt'unun kendisini transkript
  // diye döndürüyordu. Metin chat'e düşüp commander'ı tetikliyor, kullanıcı aynı
  // anda konuşmuşsa iki cevap üretilip iki TTS üst üste okunuyordu.
  it('prompt birebir geri dönerse atılır', () => {
    expect(isPromptHallucination(STT_LANGUAGE_PROMPT)).toBe(true);
  });

  it('prompt kısmen geri dönerse de atılır', () => {
    expect(isPromptHallucination('Türkçe finans sohbeti BIST hisse bilanço')).toBe(true);
  });

  it('bilinen whisper uydurmaları noktalamadan bağımsız yakalanır', () => {
    expect(isPromptHallucination('Altyazı M.K.')).toBe(true);
    expect(isPromptHallucination('altyazı mk')).toBe(true);
    expect(isPromptHallucination('Abone olmayı unutmayın!')).toBe(true);
  });

  it('gerçek komutlar prompt kelimeleri içerse bile geçer', () => {
    expect(isPromptHallucination('THYAO hissesinin bilançosunu analiz et')).toBe(false);
    expect(isPromptHallucination('portföyümü tara ve fırsat bul')).toBe(false);
    expect(isPromptHallucination('sepetime ASELS ekle')).toBe(false);
    expect(isPromptHallucination('BIST 100 endeksinde bugün ne oldu')).toBe(false);
  });

  it('kısa transkriptleri elemez — onlar istemcideki kısa-söz kuralına ait', () => {
    expect(isPromptHallucination('bilanço')).toBe(false);
    expect(isPromptHallucination('evet')).toBe(false);
  });
});

describe('STT yabancı dil kayması filtresi', () => {
  // GEÇMİŞ HATA: "Hangi hisseler en iyisi olur?" Almancaya çevrilip
  // "Welche Aktien wären die besten?" olarak chat'e düştü. Latin alfabesi
  // olduğu için o günkü Latin-dışı filtresi görmedi.
  it('Almancaya kayan transkript yakalanır', () => {
    expect(isForeignLanguageDrift('Welche Aktien wären die besten?')).toBe(true);
  });

  it('İngilizce ve Fransızca kaymalar da yakalanır', () => {
    expect(isForeignLanguageDrift('What are the best stocks today?')).toBe(true);
    expect(isForeignLanguageDrift('Quelles sont les meilleures actions')).toBe(true);
  });

  it('Türkçe komutlar yanlış pozitif üretmez', () => {
    expect(isForeignLanguageDrift('Hangi hisseler en iyisi olur')).toBe(false);
    expect(isForeignLanguageDrift('THYAO bilançosunu analiz et')).toBe(false);
    expect(isForeignLanguageDrift('sepetime ASELS ekle ve portföyü göster')).toBe(false);
  });

  it('Türkçede sık geçen "son" ve "para" kelimeleri kaymaya sayılmaz', () => {
    expect(isForeignLanguageDrift('BIST 100 son fiyat durumu ne')).toBe(false);
    expect(isForeignLanguageDrift('para birimi son kur nedir')).toBe(false);
  });

  it('tek yabancı kelime kaymaya sayılmaz (kod adı/marka olabilir)', () => {
    expect(isForeignLanguageDrift('the hisselerini tara bakalım')).toBe(false);
  });
});
