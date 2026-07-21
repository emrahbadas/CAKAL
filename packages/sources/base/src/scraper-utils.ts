/**
 * Shared Scraper Utilities
 *
 * User-Agent rotasyonu, rastgele gecikme, hata yönetimi.
 * Tüm Playwright tabanlı adaptörler bunu kullanır.
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Aciliyet sinyalleri — Türkçe ilan metinlerinde */
const URGENCY_KEYWORDS = [
  'acil', 'acil satılık', 'acil satıyorum',
  'nakit lazım', 'nakite ihtiyaç',
  'bugün teslim', 'hemen teslim',
  'çok ucuz', 'fiyat düştü',
  'son fiyat', 'pazarlık yok',
  'takas yok', 'yarın kalkacak',
  'stoklar tükeniyor', 'son 1 adet',
  'kampanya bitiyor', 'indirim son gün',
];

export function extractUrgencyHints(text: string): string[] {
  const lower = text.toLowerCase();
  return URGENCY_KEYWORDS.filter((kw) => lower.includes(kw));
}

/**
 * Managed browser — tek browser instance paylaşılır.
 * İlk çağrıda açılır, uygulama kapanınca kapatılır.
 */
let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
  }
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser && _browser.isConnected()) {
    await _browser.close();
    _browser = null;
  }
}

export async function createStealthPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    userAgent: randomUA(),
    viewport: { width: 1366, height: 768 },
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    javaScriptEnabled: true,
  });

  // Stealth: Override navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  return { context, page };
}

/**
 * Safe scrape wrapper — hata yönetimi + timeout + cleanup
 */
export async function safeScrape<T>(
  sourceId: string,
  fn: (page: Page) => Promise<T>,
  timeoutMs = 30000,
): Promise<{ data: T | null; error: string | null }> {
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    const result = await createStealthPage(browser);
    context = result.context;
    page = result.page;

    page.setDefaultTimeout(timeoutMs);

    const data = await fn(page);
    return { data, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${sourceId}] Scrape error:`, msg);
    return { data: null, error: msg };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}
