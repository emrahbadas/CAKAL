import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * CI KUSURU REGRESYONU
 *
 * CI'da Electron binary'si indirilmiyor (ELECTRON_SKIP_BINARY_DOWNLOAD=1):
 * job yalnız typecheck + vitest + audit koşuyor, tarayıcı açılmıyor.
 * `require('electron')` sadece bir yol dizesi döndürür ama binary yoksa
 * index.js "Electron failed to install correctly" diye PATLAR.
 *
 * Ölçülen iki kusur:
 *   1. scraper.cjs electron'u modül tepesinde require ediyordu. Yalnız saf
 *      fonksiyonları test eden marketplace-scrapers.test.mjs bile, import
 *      zinciri yüzünden binary'ye muhtaç kaldı ve komple çöktü.
 *   2. ai-service.cjs `require('electron')` ile `require('./scraper.cjs')`'i
 *      AYNI try bloğunda tutuyordu. Binary yoksa ilki patlıyor, catch
 *      scraper'ı da null bırakıyor ve determineOpportunitySources sessizce
 *      'akakce' kaynağını düşürüyordu. Yönlendirme davranışı, bir import'un
 *      kazara başarılı olmasına bağlanmıştı.
 *
 * Bu testler kaynak metni okur. Davranış testi değil YAPI testidir: amaç,
 * binary olmayan bir ortamda import zincirinin sağlam kalmasını korumak.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('scraper.cjs — electron tembel yüklenir', () => {
  const source = read('../apps/desktop/electron/scraper.cjs');

  it('modül tepesinde electron destructure etmez', () => {
    // Eski hâl: const { BrowserWindow, app, session } = require('electron');
    expect(source).not.toMatch(/^const\s*\{[^}]*\}\s*=\s*require\('electron'\)/m);
  });

  it('electron erişimi fonksiyon içinden yapılır', () => {
    expect(source).toContain('function electron()');
    expect(source).toMatch(/electron\(\)\.BrowserWindow/);
  });

  it('cookie yolu da tembel — app.getPath modül yüklenirken çağrılmaz', () => {
    expect(source).toContain('function cookieFile()');
    expect(source).not.toMatch(/^const\s+COOKIE_FILE\s*=/m);
  });
});

describe('ai-service.cjs — scraper electron binary\'sine bağlı değil', () => {
  const source = read('../apps/desktop/electron/ai-service.cjs');

  it('scraper require\'ı electron require\'ı ile aynı try bloğunda değil', () => {
    // İki require arasında bir catch olmalı: aynı blokta değiller.
    const scraperIdx = source.indexOf("scraper = require('./scraper.cjs')");
    const electronIdx = source.indexOf("const electron = require('electron')");
    expect(scraperIdx).toBeGreaterThan(-1);
    expect(electronIdx).toBeGreaterThan(-1);
    const between = source.slice(Math.min(scraperIdx, electronIdx), Math.max(scraperIdx, electronIdx));
    expect(between).toContain('catch');
  });

  it('scraper yüklenemezse sessiz kalınmaz', () => {
    expect(source).toContain('[AI] scraper.cjs yüklenemedi');
  });
});
