// ============================================================
// Çakal Scraper — BrowserWindow-based data extraction
// Sprint 10+15: Real Data Pipeline + Cookie Persistence
// ============================================================

const fs = require('fs');
const path = require('path');

/**
 * Electron TEMBEL yükleniyor: modülün YÜKLENMESİ binary'ye bağlı olmamalı.
 * `require('electron')` yalnız bir yol dizesi döndürür ama index.js binary
 * yoksa "Electron failed to install correctly" diye PATLAR. Bu modülden
 * yalnız saf fonksiyonları test eden bir dosya bile, sırf import zinciri
 * yüzünden binary'ye muhtaç kalıyordu (CI'da ölçüldü: 65 dosya geçti,
 * marketplace-scrapers.test.mjs bu yüzden düştü). Tarayıcı gerçekten
 * açılana kadar electron'a dokunmuyoruz.
 */
let electronModule = null;
function electron() {
  if (!electronModule) electronModule = require('electron');
  return electronModule;
}

// ── Scraper Pool ──
let scraperWindow = null;
let isScraperBusy = false;
const SCRAPER_TIMEOUT = 25000; // 25 saniye max

// ── Cookie Persistence ──
// Yol da tembel: app.getPath ancak Electron ayaktayken anlamlı.
let scraperUserDataDir = null;
function cookieFile() {
  if (!scraperUserDataDir) {
    let fromApp = null;
    try {
      const { app } = electron();
      if (app && typeof app.getPath === 'function') fromApp = app.getPath('userData');
    } catch (_) { /* Electron yoksa sandbox altına düşülür */ }
    scraperUserDataDir = fromApp || path.resolve(process.cwd(), '.cakal-sandbox', 'runtime');
  }
  return path.join(scraperUserDataDir, 'scraper-cookies.json');
}

/**
 * Load saved cookies into the scraper session.
 * Cookies are stored per-domain so CF tokens persist.
 */
async function loadCookies(win) {
  try {
    if (!fs.existsSync(cookieFile())) return 0;
    const raw = fs.readFileSync(cookieFile(), 'utf-8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return 0;
    const ses = win.webContents.session;
    let loaded = 0;
    for (const c of cookies) {
      try {
        // Electron cookie API requires url
        const protocol = c.secure ? 'https' : 'http';
        const url = `${protocol}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
        await ses.cookies.set({
          url,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure || false,
          httpOnly: c.httpOnly || false,
          sameSite: c.sameSite || 'unspecified',
          expirationDate: c.expirationDate || undefined,
        });
        loaded++;
      } catch { /* skip invalid cookies */ }
    }
    console.log(`[Scraper:Cookies] Loaded ${loaded}/${cookies.length} cookies from disk`);
    return loaded;
  } catch (e) {
    console.warn('[Scraper:Cookies] Load error:', e.message);
    return 0;
  }
}

/**
 * Save current session cookies for a specific domain to disk.
 * Called after successful CF bypass or page load.
 */
async function saveCookies(win, domain) {
  try {
    const ses = win.webContents.session;
    const allCookies = await ses.cookies.get({});
    // Existing saved cookies (other domains)
    let existing = [];
    try {
      if (fs.existsSync(cookieFile())) {
        existing = JSON.parse(fs.readFileSync(cookieFile(), 'utf-8'));
        if (!Array.isArray(existing)) existing = [];
      }
    } catch { existing = []; }
    // Filter out old cookies for this domain, keep others
    const domainRoot = domain.replace(/^www\./, '');
    const otherDomains = existing.filter(c => !c.domain.includes(domainRoot));
    // Add fresh cookies for this domain
    const domainCookies = allCookies.filter(c => c.domain.includes(domainRoot));
    const merged = [...otherDomains, ...domainCookies];
    fs.writeFileSync(cookieFile(), JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`[Scraper:Cookies] Saved ${domainCookies.length} cookies for ${domainRoot} (total: ${merged.length})`);
    return domainCookies.length;
  } catch (e) {
    console.warn('[Scraper:Cookies] Save error:', e.message);
    return 0;
  }
}

/**
 * Check if we have saved cookies for a domain.
 */
function hasSavedCookies(domain) {
  try {
    if (!fs.existsSync(cookieFile())) return false;
    const raw = fs.readFileSync(cookieFile(), 'utf-8');
    const cookies = JSON.parse(raw);
    const domainRoot = domain.replace(/^www\./, '');
    return cookies.some(c => c.domain.includes(domainRoot));
  } catch { return false; }
}

/**
 * Get or create the hidden scraper BrowserWindow.
 * Reuses window across calls for performance.
 * Returns { win, isNew } — isNew=true means cookies need to be loaded.
 */
function getScraperWindow() {
  if (scraperWindow && !scraperWindow.isDestroyed()) {
    return { win: scraperWindow, isNew: false };
  }

  scraperWindow = new (electron().BrowserWindow)({
    width: 1280,
    height: 800,
    show: false, // Gizli pencere
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Cloudflare JS challenge sandbox'ta çözülmez
      images: true,
      webgl: false,
      offscreen: false,
      // JavaScript tam çalışmalı — Cloudflare challenge resolver için
      javascript: true,
    },
  });

  // Anti-detection: gerçek tarayıcı gibi davran
  scraperWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  // Window kapatılırsa referansı temizle
  scraperWindow.on('closed', () => {
    scraperWindow = null;
  });

  return { win: scraperWindow, isNew: true };
}

/**
 * Load a URL in the scraper window and wait for it to settle.
 * Returns the BrowserWindow's webContents for JS execution.
 */
async function loadPage(url, waitForSelector, timeout = SCRAPER_TIMEOUT) {
  if (isScraperBusy) {
    console.log('[Scraper] Waiting for busy window...');
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (!isScraperBusy) {
          clearInterval(check);
          resolve();
        }
      }, 500);
      setTimeout(() => { clearInterval(check); resolve(); }, timeout);
    });
  }

  isScraperBusy = true;
  const { win, isNew } = getScraperWindow();

  // Load persisted cookies on fresh window
  if (isNew) {
    await loadCookies(win);
  }

  try {
    // Extract domain for cookie persistence
    const urlDomain = (() => { try { return new URL(url).hostname; } catch { return ''; } })();

    console.log(`[Scraper] Navigating to: ${url}`);
    await win.loadURL(url);

    // İlk yükleme sonrası kısa bekleme — Cloudflare challenge redirect olabilir
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Cloudflare challenge kontrolü (EN + TR)
    const cfCheck = await win.webContents.executeJavaScript(`
      (function() {
        const title = document.title || '';
        const body = document.body ? document.body.innerText.substring(0, 500) : '';
        const hasCF = title.includes('Just a moment') || title.includes('Attention Required')
          || title.includes('Bir dakika') || title.includes('lütfen')
          || body.includes('Checking your browser') || body.includes('cf-browser-verification')
          || body.includes('Güvenlik doğrulaması') || body.includes('kötü amaçlı botlara')
          || !!document.getElementById('cf-spinner-please-wait')
          || !!document.getElementById('challenge-running')
          || window.location.href.includes('/cs/checkLoading');
        return { title, hasCF, url: window.location.href, bodyLen: (document.body ? document.body.innerHTML.length : 0) };
      })();
    `);
    console.log(`[Scraper] Page loaded — title: "${cfCheck.title}", hasCF: ${cfCheck.hasCF}, url: ${cfCheck.url}, bodyLen: ${cfCheck.bodyLen}`);

    // Cloudflare challenge detected — wait longer for auto-resolve
    if (cfCheck.hasCF) {
      console.log('[Scraper] Cloudflare challenge detected — waiting for auto-resolve (5s)...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 2nd check
      // Retry loop — max 2 checks with shorter waits (cookie persistence should help)
      const cfWaits = [0, 4000]; // already waited 5s, then +4s = 9s total
      let cfResolved = false;
      for (let attempt = 0; attempt < cfWaits.length; attempt++) {
        if (cfWaits[attempt] > 0) {
          console.log(`[Scraper] CF retry #${attempt + 1} — waiting ${cfWaits[attempt] / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, cfWaits[attempt]));
        }
        const cfRetry = await win.webContents.executeJavaScript(`
          (function() {
            const title = document.title || '';
            const hasCF = title.includes('Just a moment') || title.includes('Attention Required')
              || title.includes('Bir dakika') || title.includes('lütfen')
              || !!document.getElementById('challenge-running') || !!document.getElementById('cf-spinner-please-wait')
              || window.location.href.includes('/cs/checkLoading');
            return { title, hasCF, url: window.location.href, bodyLen: (document.body ? document.body.innerHTML.length : 0) };
          })();
        `);
        console.log(`[Scraper] CF check #${attempt + 1} — title: "${cfRetry.title}", hasCF: ${cfRetry.hasCF}, bodyLen: ${cfRetry.bodyLen}`);
        if (!cfRetry.hasCF) {
          cfResolved = true;
          // CF çözüldü — cookie'leri kaydet!
          await saveCookies(win, urlDomain);
          break;
        }
      }
      if (!cfResolved) {
        console.warn('[Scraper] Cloudflare challenge NOT resolved after 2 retries — site might block scraping');
      }
    } else {
      // CF yok — yine de cookie'leri kaydet (session freshness)
      await saveCookies(win, urlDomain);
    }

    // Wait for target selector
    if (waitForSelector) {
      const selectors = waitForSelector.split(',').map(s => s.trim()).filter(Boolean);
      const selectorJS = selectors.map(s => `document.querySelector('${s}')`).join(' || ');

      const waitResult = await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const timeout = setTimeout(() => resolve('timeout'), ${timeout - 5000});
          const check = () => {
            if (${selectorJS}) {
              clearTimeout(timeout);
              resolve('found');
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        });
      `);
      console.log(`[Scraper] waitForSelector result: ${waitResult} (selectors: ${waitForSelector})`);

      if (waitResult === 'timeout') {
        // Debug: dump what we actually see
        const debugInfo = await win.webContents.executeJavaScript(`
          (function() {
            const el = document.body || document.documentElement;
            const text = el ? el.innerText.substring(0, 800) : 'NO BODY';
            const html = el ? el.innerHTML.substring(0, 500) : 'NO HTML';
            return { title: document.title, url: window.location.href, text, html };
          })();
        `);
        console.warn(`[Scraper] Selector timeout — page content dump:`);
        console.warn(`  Title: ${debugInfo.title}`);
        console.warn(`  URL: ${debugInfo.url}`);
        console.warn(`  Text: ${debugInfo.text.substring(0, 300)}`);
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    return win.webContents;
  } catch (err) {
    console.error('[Scraper] loadPage error:', err.message);
    throw err;
  } finally {
    isScraperBusy = false;
  }
}

// ════════════════════════════════════════
// Trendyol Scraper
// ════════════════════════════════════════

async function scrapeTrendyol(query, options = {}) {
  try {
    const encodedQuery = encodeURIComponent(query);
    let url = `https://www.trendyol.com/sr?q=${encodedQuery}&qt=${encodedQuery}&st=${encodedQuery}&os=1&pi=1`;
    if (options.minPrice) url += `&fltr=2-${options.minPrice}`;
    if (options.maxPrice) url += `-${options.maxPrice || ''}`;

    console.log(`[Scraper:Trendyol] Loading: ${url}`);
    const webContents = await loadPage(url, '.p-card-wrppr, [data-testid="product-card"], [class*="productCard"], [class*="srchProduct"], a[href*="/p-"]');

    // Extract product data from rendered DOM
    const products = await webContents.executeJavaScript(`
      (function() {
        const items = [];
        const maxItems = ${options.maxResults || 10};

        // Strategy 1: Classic Trendyol selectors
        let cards = document.querySelectorAll('.p-card-wrppr, [class*="p-card"], [data-testid="product-card"]');

        // Strategy 2: Search result product containers (broader match)
        if (cards.length === 0) {
          cards = document.querySelectorAll('[class*="productCard"], [class*="product-card"], [class*="ProductCard"], [class*="srchProduct"]');
        }

        // Strategy 3: Find product cards via product links
        if (cards.length === 0) {
          const productLinks = document.querySelectorAll('a[href*="/p-"]');
          const cardSet = new Set();
          productLinks.forEach(link => {
            // Walk up to find the card container (typically 2-3 levels up)
            let el = link.parentElement;
            for (let i = 0; i < 4 && el; i++) {
              if (el.children && el.children.length > 1) {
                cardSet.add(el);
                break;
              }
              el = el.parentElement;
            }
          });
          cards = [...cardSet];
        }

        cards.forEach((card, i) => {
          if (i >= maxItems) return;

          // Find price — look for TL amounts
          const allTexts = card.innerText || '';
          const priceMatch = allTexts.match(/([\\d.]+,\\d{2})\\s*TL/);
          const origPriceMatch = allTexts.match(/([\\d.]+,\\d{2})\\s*TL[\\s\\S]*?([\\d.]+,\\d{2})\\s*TL/);

          // Find title
          const titleEl = card.querySelector('.prdct-desc-cntnr-name, [data-testid="product-name"], [class*="product-name"], [class*="productName"], [class*="prdct-desc"]')
            || card.querySelector('span[class*="Name"], span[class*="name"], span[class*="title"]');
          const brandEl = card.querySelector('.prdct-desc-cntnr-ttl, [data-testid="brand-name"], [class*="brand"]');
          const priceEl = card.querySelector('.prc-box-dscntd, .prc-box-sllng, [class*="price"], [data-testid="price"]');
          const origPriceEl = card.querySelector('.prc-box-orgnl, [class*="originalPrice"], [class*="oldPrice"]');
          const linkEl = card.querySelector('a[href*="/p-"]') || card.querySelector('a[href]');
          const imgEl = card.querySelector('img[src], img[data-src]');
          const ratingEl = card.querySelector('.rating-score, .ratingScore, [class*="rating"]');
          const reviewEl = card.querySelector('.ratingCount, .review-count, [class*="ratingCount"]');

          let price = 0, origPrice = 0;
          if (priceEl) {
            const t = priceEl.textContent.replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.');
            price = parseFloat(t) || 0;
          } else if (priceMatch) {
            price = parseFloat(priceMatch[1].replace(/\\./g, '').replace(',', '.')) || 0;
          }
          if (origPriceEl) {
            const t = origPriceEl.textContent.replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.');
            origPrice = parseFloat(t) || 0;
          }

          // Fallback title from link text or first meaningful text
          let title = titleEl ? titleEl.textContent.trim() : '';
          if (!title && linkEl) title = linkEl.textContent.trim().split('\\n')[0];
          if (!title) {
            const spans = card.querySelectorAll('span');
            for (const s of spans) {
              const t = s.textContent.trim();
              if (t.length > 10 && !/TL|\\d+,\\d{2}|Sepete/.test(t)) { title = t; break; }
            }
          }

          if (title || price > 0) {
            items.push({
              source: 'trendyol',
              title: title.substring(0, 200),
              brand: brandEl ? brandEl.textContent.trim() : '',
              price: price,
              originalPrice: origPrice > price ? origPrice : null,
              discount: origPrice > price ? '%' + Math.round(((origPrice - price) / origPrice) * 100) : null,
              currency: 'TRY',
              url: linkEl ? (linkEl.getAttribute('href') || '').startsWith('http') ? linkEl.getAttribute('href') : 'https://www.trendyol.com' + (linkEl.getAttribute('href') || '') : '',
              imageUrl: imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : null,
              rating: ratingEl ? parseFloat(ratingEl.textContent) || null : null,
              reviewCount: reviewEl ? parseInt(reviewEl.textContent.replace(/[^\\d]/g, '')) || 0 : 0,
            });
          }
        });

        return items;
      })();
    `);

    console.log(`[Scraper:Trendyol] Extracted ${products.length} products for "${query}"`);

    // Debug: eğer 0 sonuç varsa sayfada ne var?
    if (products.length === 0) {
      const debugDom = await webContents.executeJavaScript(`
        (function() {
          const el = document.body || document.documentElement;
          // Find all unique class names containing "product", "card", "item", "listing"
          const allEls = document.querySelectorAll('*');
          const classSet = new Set();
          allEls.forEach(e => {
            const cls = e.className;
            if (typeof cls === 'string' && /product|card|item|listing|prdct|srch/i.test(cls)) {
              cls.split(/\\s+/).filter(c => /product|card|item|listing|prdct|srch/i.test(c)).forEach(c => classSet.add(c));
            }
          });
          // Also find link elements with product-like hrefs
          const productLinks = document.querySelectorAll('a[href*="/p-"], a[href*="/brand/"]');
          return {
            title: document.title,
            url: window.location.href,
            text: el ? el.innerText.substring(0, 600) : 'NO BODY',
            cardCount: document.querySelectorAll('.p-card-wrppr, [class*="p-card"]').length,
            allDivs: document.querySelectorAll('div').length,
            productClasses: [...classSet].slice(0, 30),
            productLinkCount: productLinks.length,
            sampleLink: productLinks.length > 0 ? productLinks[0].outerHTML.substring(0, 300) : 'none',
          };
        })();
      `);
      console.warn(`[Scraper:Trendyol] 0 products — debug dump:`);
      console.warn(`  Title: ${debugDom.title}`);
      console.warn(`  URL: ${debugDom.url}`);
      console.warn(`  Card selectors found: ${debugDom.cardCount}`);
      console.warn(`  Total divs: ${debugDom.allDivs}`);
      console.warn(`  Product classes: ${JSON.stringify(debugDom.productClasses)}`);
      console.warn(`  Product links: ${debugDom.productLinkCount}`);
      console.warn(`  Sample link: ${debugDom.sampleLink}`);
      console.warn(`  Page text: ${debugDom.text.substring(0, 300)}`);
    }

    return {
      success: products.length > 0,
      source: 'trendyol',
      count: products.length,
      listings: products,
      method: 'browser-scrape',
    };
  } catch (err) {
    console.error('[Scraper:Trendyol] Error:', err.message);
    return { success: false, source: 'trendyol', message: err.message, listings: [] };
  }
}

// ════════════════════════════════════════
// Sahibinden Scraper
// ════════════════════════════════════════

async function scrapeSahibinden(query, options = {}) {
  try {
    const params = new URLSearchParams({
      query_text: query,
      pagingOffset: '0',
      pagingSize: String(options.maxResults || 10),
    });
    if (options.minPrice) params.set('price_min', String(options.minPrice));
    if (options.maxPrice) params.set('price_max', String(options.maxPrice));

    const url = `https://www.sahibinden.com/arama?${params.toString()}`;
    console.log(`[Scraper:Sahibinden] Loading: ${url}`);

    const webContents = await loadPage(url, '.searchResultsItem, .listing-item, #searchResultsTable');

    const listings = await webContents.executeJavaScript(`
      (function() {
        const items = [];
        // Sahibinden search result rows
        const rows = document.querySelectorAll('.searchResultsItem, tr[class*="searchResult"]');

        rows.forEach((row, i) => {
          if (i >= ${options.maxResults || 10}) return;

          const titleEl = row.querySelector('.classifiedTitle, a.classified-title');
          const priceEl = row.querySelector('.searchResultsPriceValue span, td.searchResultsPriceValue');
          const locationEl = row.querySelector('.searchResultsLocationValue, td.searchResultsLocationValue');
          const dateEl = row.querySelector('.searchResultsDateValue, td.searchResultsDateValue');
          const imgEl = row.querySelector('img[src], img[data-src]');
          const linkEl = titleEl || row.querySelector('a[href*="/ilan/"]');

          const priceText = priceEl ? priceEl.textContent.replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.') : '0';

          if (titleEl || priceEl) {
            items.push({
              source: 'sahibinden',
              title: titleEl ? titleEl.textContent.trim().substring(0, 200) : '',
              price: parseFloat(priceText) || 0,
              currency: 'TRY',
              url: linkEl ? 'https://www.sahibinden.com' + (linkEl.getAttribute('href') || '') : '',
              location: locationEl ? locationEl.textContent.replace(/\\s+/g, ' ').trim() : '',
              date: dateEl ? dateEl.textContent.replace(/\\s+/g, ' ').trim() : '',
              imageUrl: imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : null,
            });
          }
        });

        return items;
      })();
    `);

    console.log(`[Scraper:Sahibinden] Extracted ${listings.length} listings for "${query}"`);

    // Debug: eğer 0 sonuç varsa sayfada ne var?
    if (listings.length === 0) {
      const debugDom = await webContents.executeJavaScript(`
        (function() {
          const el = document.body || document.documentElement;
          return {
            title: document.title,
            url: window.location.href,
            text: el ? el.innerText.substring(0, 600) : 'NO BODY',
            resultRows: document.querySelectorAll('.searchResultsItem, tr[class*="searchResult"]').length,
            allDivs: document.querySelectorAll('div').length,
          };
        })();
      `);
      console.warn(`[Scraper:Sahibinden] 0 listings — debug dump:`);
      console.warn(`  Title: ${debugDom.title}`);
      console.warn(`  URL: ${debugDom.url}`);
      console.warn(`  Result rows found: ${debugDom.resultRows}`);
      console.warn(`  Total divs: ${debugDom.allDivs}`);
      console.warn(`  Page text: ${debugDom.text.substring(0, 300)}`);
    }

    return {
      success: listings.length > 0,
      source: 'sahibinden',
      count: listings.length,
      listings,
      method: 'browser-scrape',
    };
  } catch (err) {
    console.error('[Scraper:Sahibinden] Error:', err.message);
    return { success: false, source: 'sahibinden', message: err.message, listings: [] };
  }
}

// ════════════════════════════════════════
// Letgo / Dolap ikinci el scraper
// ════════════════════════════════════════

function buildSecondHandSearchUrl(query, source = 'letgo') {
  const encodedQuery = encodeURIComponent(query);
  if (source === 'dolap') return `https://www.dolap.com/arama?q=${encodedQuery}`;
  return `https://www.letgo.com/tr-tr/s?q=${encodedQuery}`;
}

async function scrapeSecondHand(query, options = {}) {
  const preferredSource = String(options.source || 'letgo').toLowerCase() === 'dolap' ? 'dolap' : 'letgo';
  const sources = preferredSource === 'dolap' ? ['dolap', 'letgo'] : ['letgo', 'dolap'];
  const failures = [];

  for (const source of sources) {
    try {
      const url = buildSecondHandSearchUrl(query, source);
      console.log(`[Scraper:${source}] Loading: ${url}`);
      const webContents = await loadPage(
        url,
        'a[href], [class*="card"], [class*="listing"], [class*="product"], [class*="item"]',
        options.timeout || 16000,
      );

      const listings = await webContents.executeJavaScript(`
        (function() {
          const items = [];
          const maxItems = ${options.maxResults || 10};
          const source = ${JSON.stringify(source)};
          const baseUrl = source === 'dolap' ? 'https://www.dolap.com' : 'https://www.letgo.com';

          function parsePrice(text) {
            const match = String(text || '').match(/(?:₺|TL)?\s*([0-9][0-9.,\s]{1,14})(?:\s*(?:TL|₺))?/i);
            if (!match) return 0;
            let value = match[1].replace(/\s+/g, '');
            const hasDot = value.includes('.');
            const hasComma = value.includes(',');
            if (hasDot && hasComma) {
              value = value.lastIndexOf(',') > value.lastIndexOf('.')
                ? value.replace(/\./g, '').replace(',', '.')
                : value.replace(/,/g, '');
            } else if (hasComma) {
              const parts = value.split(',');
              value = parts.length === 2 && parts[1].length <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
            } else if (hasDot) {
              const parts = value.split('.');
              if (!(parts.length === 2 && parts[1].length <= 2)) value = value.replace(/\./g, '');
            }
            const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
            return Number.isFinite(parsed) ? parsed : 0;
          }

          function absoluteUrl(href) {
            if (!href) return '';
            if (/^https?:\/\//i.test(href)) return href;
            return baseUrl + (href.startsWith('/') ? href : '/' + href);
          }

          function pickTitle(card, link) {
            const selectors = [
              '[class*="title"]', '[class*="name"]', '[class*="Title"]', '[class*="Name"]',
              'h2', 'h3', 'h4', 'img[alt]', 'a[title]'
            ];
            for (const selector of selectors) {
              const element = card.querySelector(selector);
              const value = element ? (element.getAttribute('alt') || element.getAttribute('title') || element.textContent || '').trim() : '';
              if (value.length >= 3 && !/^(TL|₺|sat|al)$/i.test(value)) return value;
            }
            const text = (link ? link.textContent : card.textContent || '').replace(/\s+/g, ' ').trim();
            const parts = text.split(/₺|TL|\n/).map((part) => part.trim()).filter((part) => part.length >= 3);
            return (parts[0] || text || 'İkinci el ilan').substring(0, 180);
          }

          let cards = document.querySelectorAll('[class*="card"], [class*="listing"], [class*="product"], [class*="item"]');
          if (cards.length === 0) {
            const linkCards = new Set();
            document.querySelectorAll('a[href]').forEach((link) => {
              const href = link.getAttribute('href') || '';
              const text = link.textContent || '';
              if (!/(dolap|letgo|\/ilan|\/item|\/urun|\/p\/|product|listing)/i.test(href + ' ' + text)) return;
              let el = link.parentElement;
              for (let i = 0; i < 5 && el; i++) {
                if ((el.innerText || '').length > 20) { linkCards.add(el); break; }
                el = el.parentElement;
              }
            });
            cards = [...linkCards];
          }

          const seen = new Set();
          for (const card of cards) {
            if (items.length >= maxItems) break;
            const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
            const price = parsePrice(text);
            const link = card.querySelector('a[href]') || (card.matches && card.matches('a[href]') ? card : null);
            const url = absoluteUrl(link ? link.getAttribute('href') : '');
            const title = pickTitle(card, link);
            const image = card.querySelector('img[src], img[data-src]');
            const imageUrl = image ? (image.getAttribute('src') || image.getAttribute('data-src') || '') : null;
            const key = (url || title).toLowerCase();
            if (!title || seen.has(key)) continue;
            if (price <= 0 && !/₺|TL|fiyat/i.test(text)) continue;
            seen.add(key);
            items.push({
              source,
              title: title.substring(0, 180),
              price,
              currency: 'TRY',
              url,
              imageUrl,
              condition: 'second_hand',
              snippet: text.substring(0, 240),
            });
          }
          return items;
        })();
      `);

      console.log(`[Scraper:${source}] Extracted ${listings.length} listings for "${query}"`);
      if (listings.length > 0) {
        return {
          success: true,
          source,
          count: listings.length,
          listings,
          method: 'browser-scrape',
        };
      }
      failures.push(`${source}: sonuç yok`);
    } catch (err) {
      console.error(`[Scraper:${source}] Error:`, err.message);
      failures.push(`${source}: ${err.message}`);
    }
  }

  return {
    success: false,
    source: preferredSource,
    message: failures.join(' | ') || 'İkinci el sonuç bulunamadı.',
    listings: [],
    method: 'browser-scrape',
  };
}

// ════════════════════════════════════════
// Hepsiemlak Scraper
// ════════════════════════════════════════

/**
 * Turkish chars → URL slug: İstanbul → istanbul, Eskişehir → eskisehir
 */
function turkishSlug(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function scrapeHepsiemlak(query, options = {}) {
  try {
    const listingType = options.listingType || 'satilik';
    const propertyType = options.propertyType || 'daire';

    // Hepsiemlak slug-based URL: /bursa-satilik-daire, /bursa-nilufer-satilik-1-1-daire
    const citySlug = turkishSlug(options.city || query);
    const districtSlug = turkishSlug(options.district);

    // Room filter goes into the slug path: 1+1 → "1-1", 2+1 → "2-1"
    const roomSlug = options.rooms ? options.rooms.replace(/\+/g, '-') : '';

    const pathParts = [citySlug, districtSlug, listingType, roomSlug, propertyType].filter(Boolean);
    const basePath = pathParts.join('-');

    const params = new URLSearchParams();
    if (options.minPrice) params.set('fiyatMin', String(options.minPrice));
    if (options.maxPrice) params.set('fiyatMax', String(options.maxPrice));

    const qs = params.toString();
    const url = `https://www.hepsiemlak.com/${basePath}${qs ? '?' + qs : ''}`;
    console.log(`[Scraper:Hepsiemlak] Loading: ${url}`);

    const webContents = await loadPage(url, '[class*="listing-card"], [class*="list-view-content"], .listing-item');

    const listings = await webContents.executeJavaScript(`
      (function() {
        const items = [];

        // Try __NEXT_DATA__ first (Next.js SSR data)
        try {
          const nextDataEl = document.getElementById('__NEXT_DATA__');
          if (nextDataEl) {
            const nextData = JSON.parse(nextDataEl.textContent);
            const pp = nextData?.props?.pageProps || {};
            const searchResults = pp?.searchResult?.listings
              || pp?.listings
              || pp?.searchData?.listings
              || pp?.listingSearchResult?.listings
              || pp?.result?.listings
              || [];

            if (searchResults.length === 0) {
              // Deep scan: walk pageProps to find any 'listings' array
              const findListings = (obj, depth) => {
                if (!obj || depth > 3) return [];
                if (Array.isArray(obj.listings) && obj.listings.length > 0) return obj.listings;
                for (const key of Object.keys(obj)) {
                  if (typeof obj[key] === 'object' && obj[key] !== null) {
                    const found = findListings(obj[key], depth + 1);
                    if (found.length > 0) return found;
                  }
                }
                return [];
              };
              const deepFound = findListings(pp, 0);
              if (deepFound.length > 0) searchResults.push(...deepFound);
            }

            searchResults.slice(0, ${options.maxResults || 15}).forEach(item => {
              items.push({
                source: 'hepsiemlak',
                title: item.title || item.listingTitle || item.name || '',
                price: item.price || item.listingPrice || item.priceFormatted || 0,
                currency: 'TRY',
                url: item.url ? (item.url.startsWith('http') ? item.url : 'https://www.hepsiemlak.com' + item.url) : '',
                location: [item.city || item.cityName, item.county || item.countyName, item.district || item.districtName].filter(Boolean).join(', '),
                rooms: item.roomCount || item.room || item.roomAndLivingRoom || '',
                area_m2: item.grossM2 || item.netM2 || item.grossSquareMeter || item.netSquareMeter || null,
                floor: item.floor || item.floorNumber || null,
                buildingAge: item.buildingAge || item.ageOfBuilding || null,
                listingType: '${listingType}',
                imageUrl: item.image || item.coverPhoto || item.imageUrl || null,
              });
            });
          }
        } catch(e) {}

        // Fallback: DOM extraction
        if (items.length === 0) {
          const cards = document.querySelectorAll(
            '[class*="listing-card"], [class*="list-view-content"] a, .listing-item, '
            + '[class*="listingCard"], [class*="search-result"], [class*="classified-card"], '
            + 'a[class*="card"][href*="/ilan/"], a[href*="-ilan-"]'
          );

          cards.forEach((card, i) => {
            if (i >= ${options.maxResults || 15}) return;

            const titleEl = card.querySelector('[class*="card-title"], [class*="listing-title"], [class*="listingTitle"], h3, h2');
            const priceEl = card.querySelector('[class*="card-price"], [class*="listing-price"], [class*="listingPrice"], [class*="price"]');
            const locationEl = card.querySelector('[class*="card-location"], [class*="listing-location"], [class*="listingLocation"], [class*="location"]');
            const roomEl = card.querySelector('[class*="room"], [class*="oda"]');
            const areaEl = card.querySelector('[class*="area"], [class*="m2"], [class*="squareMeter"]');
            const linkEl = card.closest('a') || card.querySelector('a[href]');
            const imgEl = card.querySelector('img[src], img[data-src]');

            const priceText = priceEl ? priceEl.textContent.replace(/[^\\d]/g, '') : '0';

            if (titleEl || priceEl) {
              items.push({
                source: 'hepsiemlak',
                title: titleEl ? titleEl.textContent.trim().substring(0, 200) : '',
                price: parseInt(priceText) || 0,
                currency: 'TRY',
                url: linkEl ? linkEl.href || '' : '',
                location: locationEl ? locationEl.textContent.trim() : '',
                rooms: roomEl ? roomEl.textContent.trim() : '',
                area_m2: areaEl ? parseInt(areaEl.textContent.replace(/[^\\d]/g, '')) || null : null,
                listingType: '${listingType}',
                imageUrl: imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : null,
              });
            }
          });
        }

        return items;
      })();
    `);

    console.log(`[Scraper:Hepsiemlak] Extracted ${listings.length} ${listingType} listings for "${query}" (URL: ${url})`);

    // Debug: __NEXT_DATA__ yapısını ve ilan sayısını her zaman logla
    const debugInfo = await webContents.executeJavaScript(`
      (function() {
        const info = { title: document.title, url: window.location.href, domCards: 0 };
        // Count DOM cards
        info.domCards = document.querySelectorAll(
          '[class*="listing-card"], [class*="list-view-content"] a, .listing-item, '
          + '[class*="listingCard"], a[class*="card"][href*="/ilan/"], a[href*="-ilan-"]'
        ).length;
        try {
          const nd = document.getElementById('__NEXT_DATA__');
          if (nd) {
            const data = JSON.parse(nd.textContent);
            const pp = data?.props?.pageProps || {};
            info.pagePropsKeys = Object.keys(pp);
            for (const key of Object.keys(pp)) {
              if (Array.isArray(pp[key])) info['arr_' + key] = pp[key].length;
              if (typeof pp[key] === 'object' && pp[key] !== null && !Array.isArray(pp[key])) {
                const subKeys = Object.keys(pp[key]).slice(0, 8);
                info['obj_' + key] = subKeys;
                // Check for nested listings arrays
                for (const sk of subKeys) {
                  if (Array.isArray(pp[key][sk])) info['arr_' + key + '.' + sk] = pp[key][sk].length;
                }
              }
            }
          } else {
            info.nextData = 'NOT_FOUND';
          }
        } catch(e) { info.err = e.message; }
        return info;
      })();
    `);
    console.log(`[Scraper:Hepsiemlak] Debug:`, JSON.stringify(debugInfo));    return {
      success: listings.length > 0,
      source: 'hepsiemlak',
      count: listings.length,
      listings,
      listingType,
      method: 'browser-scrape',
    };
  } catch (err) {
    console.error('[Scraper:Hepsiemlak] Error:', err.message);
    return { success: false, source: 'hepsiemlak', message: err.message, listings: [] };
  }
}

// ════════════════════════════════════════
// Kira Getirisi Analizi
// ════════════════════════════════════════

async function scrapeRentalYield(city, district, rooms, options = {}) {
  try {
    const [satilikData, kiralikData] = await Promise.all([
      scrapeHepsiemlak(`${district || ''} ${city}`.trim(), {
        ...options,
        listingType: 'satilik',
        city,
        district,
        rooms,
        maxResults: 20,
      }),
      scrapeHepsiemlak(`${district || ''} ${city}`.trim(), {
        ...options,
        listingType: 'kiralik',
        city,
        district,
        rooms,
        maxResults: 20,
      }),
    ]);

    const satilikPrices = (satilikData.listings || []).map(l => l.price).filter(p => p > 0);
    const kiralikPrices = (kiralikData.listings || []).map(l => l.price).filter(p => p > 0);

    if (satilikPrices.length === 0 || kiralikPrices.length === 0) {
      return {
        success: true,
        source: 'hepsiemlak',
        analysis: {
          city,
          district,
          rooms,
          warning: 'Yeterli ilan bulunamadı — veri yetersiz.',
          satilik_count: satilikPrices.length,
          kiralik_count: kiralikPrices.length,
        },
        satilik: satilikData.listings || [],
        kiralik: kiralikData.listings || [],
      };
    }

    const median = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const avgSatilik = Math.round(satilikPrices.reduce((a, b) => a + b, 0) / satilikPrices.length);
    const medianSatilik = Math.round(median(satilikPrices));
    const avgKiralik = Math.round(kiralikPrices.reduce((a, b) => a + b, 0) / kiralikPrices.length);
    const medianKiralik = Math.round(median(kiralikPrices));

    const yillikKira = medianKiralik * 12;
    const brutGetiri = ((yillikKira / medianSatilik) * 100).toFixed(2);
    const geriDonus = (medianSatilik / yillikKira).toFixed(1);

    return {
      success: true,
      source: 'hepsiemlak',
      analysis: {
        city,
        district: district || 'tüm ilçeler',
        rooms: rooms || 'tümü',
        satilik: {
          count: satilikPrices.length,
          avg: avgSatilik,
          median: medianSatilik,
          min: Math.min(...satilikPrices),
          max: Math.max(...satilikPrices),
        },
        kiralik: {
          count: kiralikPrices.length,
          avg: avgKiralik,
          median: medianKiralik,
          min: Math.min(...kiralikPrices),
          max: Math.max(...kiralikPrices),
        },
        kira_getirisi: {
          brut_yillik: `%${brutGetiri}`,
          geri_donus_yil: `${geriDonus} yıl`,
          yillik_kira_geliri: yillikKira,
        },
        verdict: parseFloat(brutGetiri) >= 8 ? 'İYİ — ALINIR' : parseFloat(brutGetiri) >= 6 ? 'ORTA — İZLENİR' : 'ZAYIF — DİKKAT',
      },
      satilik: satilikData.listings.slice(0, 5),
      kiralik: kiralikData.listings.slice(0, 5),
    };
  } catch (err) {
    console.error('[Scraper:RentalYield] Error:', err.message);
    return { success: false, message: err.message };
  }
}

// ════════════════════════════════════════
// Akakçe Fiyat Karşılaştırma Scraper
// Sprint 16: Gerçek fiyat geçmişi ve mağaza karşılaştırma
// ════════════════════════════════════════

async function scrapeAkakce(query, options = {}) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.akakce.com/arama/?q=${encodedQuery}`;

    console.log(`[Scraper:Akakce] Loading: ${url}`);
    const webContents = await loadPage(url, '.p_w, .prc_w, .wrapper_list, [class*="product"]', 15000);

    const products = await webContents.executeJavaScript(`
      (function() {
        const items = [];
        const maxItems = ${options.maxResults || 8};

        // Akakçe product cards — ürün kartları
        let cards = document.querySelectorAll('.p_w, .prc_w, [class*="product-box"], [class*="prd_"]');

        // Fallback: ana ürün listesi
        if (cards.length === 0) {
          cards = document.querySelectorAll('.wrapper_list li, .result_list li, [class*="search-result"] li');
        }

        cards.forEach((card, i) => {
          if (i >= maxItems) return;

          // Ürün adı
          const nameEl = card.querySelector('.p_n, .prc_n, [class*="product-name"], h2, h3, a[title]');
          const name = nameEl ? (nameEl.title || nameEl.textContent || '').trim() : '';
          if (!name) return;

          // En düşük fiyat
          const priceEl = card.querySelector('.p_p, .prc_p, [class*="price"], .fiyat, [class*="min-price"]');
          let minPrice = 0;
          if (priceEl) {
            const t = priceEl.textContent.replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.');
            minPrice = parseFloat(t) || 0;
          }

          // Mağaza sayısı
          const storeEl = card.querySelector('.p_s, .prc_s, [class*="store-count"], [class*="seller"]');
          let storeCount = 0;
          if (storeEl) {
            const sm = storeEl.textContent.match(/(\\d+)/);
            storeCount = sm ? parseInt(sm[1]) : 0;
          }

          // Ürün linki
          const linkEl = card.querySelector('a[href*="/"]');
          const link = linkEl ? 'https://www.akakce.com' + (linkEl.getAttribute('href') || '') : '';

          // Fiyat değişimi (varsa)
          const changeEl = card.querySelector('[class*="change"], [class*="trend"], .p_ch');
          const priceChange = changeEl ? changeEl.textContent.trim() : null;

          items.push({
            name: name.substring(0, 120),
            min_price: minPrice,
            store_count: storeCount,
            price_change: priceChange,
            link,
            source: 'akakce',
          });
        });

        return items;
      })();
    `);

    console.log(`[Scraper:Akakce] Found ${products.length} products`);

    return {
      success: products.length > 0,
      source: 'akakce',
      query,
      count: products.length,
      listings: products,
      message: products.length > 0
        ? `Akakçe'de ${products.length} ürün bulundu (fiyat karşılaştırmalı)`
        : 'Akakçe sonuç bulunamadı',
    };
  } catch (err) {
    console.error('[Scraper:Akakce] Error:', err.message);
    return { success: false, source: 'akakce', message: err.message, listings: [] };
  }
}

// ════════════════════════════════════════
// Cimri Fiyat Karşılaştırma Scraper
// Sprint 16: Ürün fiyat karşılaştırma ve en ucuz mağaza
// ════════════════════════════════════════

async function scrapeCimri(query, options = {}) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.cimri.com/arama?q=${encodedQuery}`;

    console.log(`[Scraper:Cimri] Loading: ${url}`);
    const webContents = await loadPage(url, '[class*="ProductCard"], [class*="product-card"], [class*="s-item"], .product-list', 15000);

    const products = await webContents.executeJavaScript(`
      (function() {
        const items = [];
        const maxItems = ${options.maxResults || 8};

        // Cimri ürün kartları
        let cards = document.querySelectorAll('[class*="ProductCard"], [class*="product-card"], [class*="s-item"]');

        // Fallback
        if (cards.length === 0) {
          cards = document.querySelectorAll('.product-list > div, .product-list > li, [data-testid*="product"]');
        }

        cards.forEach((card, i) => {
          if (i >= maxItems) return;

          // Ürün adı
          const nameEl = card.querySelector('[class*="ProductName"], [class*="product-name"], h2, h3, a[title], [class*="title"]');
          const name = nameEl ? (nameEl.title || nameEl.textContent || '').trim() : '';
          if (!name) return;

          // En düşük fiyat
          const priceEl = card.querySelector('[class*="Price"], [class*="price"], [class*="fiyat"]');
          let minPrice = 0;
          if (priceEl) {
            const t = priceEl.textContent.replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.');
            minPrice = parseFloat(t) || 0;
          }

          // Mağaza sayısı
          const storeEl = card.querySelector('[class*="merchant"], [class*="store"], [class*="seller"], [class*="offer"]');
          let storeCount = 0;
          if (storeEl) {
            const sm = storeEl.textContent.match(/(\\d+)/);
            storeCount = sm ? parseInt(sm[1]) : 0;
          }

          // Link
          const linkEl = card.querySelector('a[href]');
          const rawHref = linkEl ? linkEl.getAttribute('href') : '';
          const link = rawHref.startsWith('http') ? rawHref : rawHref ? 'https://www.cimri.com' + rawHref : '';

          items.push({
            name: name.substring(0, 120),
            min_price: minPrice,
            store_count: storeCount,
            link,
            source: 'cimri',
          });
        });

        return items;
      })();
    `);

    console.log(`[Scraper:Cimri] Found ${products.length} products`);

    return {
      success: products.length > 0,
      source: 'cimri',
      query,
      count: products.length,
      listings: products,
      message: products.length > 0
        ? `Cimri'de ${products.length} ürün bulundu (fiyat karşılaştırmalı)`
        : 'Cimri sonuç bulunamadı',
    };
  } catch (err) {
    console.error('[Scraper:Cimri] Error:', err.message);
    return { success: false, source: 'cimri', message: err.message, listings: [] };
  }
}

// ════════════════════════════════════════
// Hepsiburada Scraper
// Sprint 16: E-ticaret ürün ve fiyat tarama
// ════════════════════════════════════════

async function scrapeHepsiburada(query, options = {}) {
  try {
    const encodedQuery = encodeURIComponent(query);
    let url = `https://www.hepsiburada.com/ara?q=${encodedQuery}`;
    if (options.minPrice) url += `&filtreler=fiyat:${options.minPrice}`;
    if (options.maxPrice) url += `-${options.maxPrice || ''}`;

    console.log(`[Scraper:Hepsiburada] Loading: ${url}`);
    const webContents = await loadPage(url, '[data-test-id="product-card-item"], .product-card, [class*="productCard"], [class*="search-item"]', 20000);

    const products = await webContents.executeJavaScript(`
      (function() {
        const items = [];
        const maxItems = ${options.maxResults || 10};

        // Hepsiburada product cards
        let cards = document.querySelectorAll('[data-test-id="product-card-item"], .product-card, [class*="productCard"]');

        // Fallback: search result items
        if (cards.length === 0) {
          cards = document.querySelectorAll('[class*="search-item"], [class*="product-list"] li, [class*="listing-item"]');
        }

        // Fallback 2: any product link containers
        if (cards.length === 0) {
          const productLinks = document.querySelectorAll('a[href*="/p-"]');
          const cardSet = new Set();
          productLinks.forEach(link => {
            let el = link.parentElement;
            for (let i = 0; i < 4 && el; i++) {
              if (el.children && el.children.length > 1) { cardSet.add(el); break; }
              el = el.parentElement;
            }
          });
          cards = [...cardSet];
        }

        cards.forEach((card, i) => {
          if (i >= maxItems) return;

          // Ürün adı
          const nameEl = card.querySelector('[data-test-id="product-card-name"], [class*="product-title"], [class*="productName"], h3, [class*="hb-product"]');
          let title = nameEl ? nameEl.textContent.trim() : '';
          if (!title) {
            const linkEl = card.querySelector('a[title]');
            title = linkEl ? linkEl.title.trim() : '';
          }
          if (!title) return;

          // Fiyat
          const priceEl = card.querySelector('[data-test-id="price-current-price"], [class*="price-value"], [class*="product-price"], [class*="hb-price"]');
          let price = 0;
          if (priceEl) {
            const t = priceEl.textContent.replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.');
            price = parseFloat(t) || 0;
          }

          // Orijinal fiyat (indirimli ise)
          const origPriceEl = card.querySelector('[data-test-id="price-old-price"], [class*="price-old"], [class*="oldPrice"]');
          let originalPrice = 0;
          if (origPriceEl) {
            const t = origPriceEl.textContent.replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.');
            originalPrice = parseFloat(t) || 0;
          }

          // İndirim yüzdesi
          let discount = null;
          if (originalPrice > 0 && price > 0 && originalPrice > price) {
            discount = Math.round(((originalPrice - price) / originalPrice) * 100);
          }
          const discountEl = card.querySelector('[class*="discount"], [class*="badge"]');
          if (!discount && discountEl) {
            const dm = discountEl.textContent.match(/(\\d+)/);
            if (dm) discount = parseInt(dm[1]);
          }

          // Rating
          const ratingEl = card.querySelector('[class*="rating"], [class*="star"]');
          let rating = null;
          if (ratingEl) {
            const rm = ratingEl.textContent.match(/([\\d.,]+)/);
            rating = rm ? parseFloat(rm[1].replace(',', '.')) : null;
          }

          // Link
          const linkEl = card.querySelector('a[href*="/p-"]') || card.querySelector('a[href]');
          const rawHref = linkEl ? linkEl.getAttribute('href') : '';
          const link = rawHref.startsWith('http') ? rawHref : rawHref ? 'https://www.hepsiburada.com' + rawHref : '';

          items.push({
            title: title.substring(0, 150),
            price,
            original_price: originalPrice || undefined,
            discount: discount ? discount + '%' : undefined,
            rating,
            url: link,
            source: 'hepsiburada',
          });
        });

        return items;
      })();
    `);

    console.log(`[Scraper:Hepsiburada] Found ${products.length} products`);

    return {
      success: products.length > 0,
      source: 'hepsiburada',
      query,
      count: products.length,
      listings: products,
      message: products.length > 0
        ? `Hepsiburada'da ${products.length} ürün bulundu`
        : 'Hepsiburada sonuç bulunamadı',
    };
  } catch (err) {
    console.error('[Scraper:Hepsiburada] Error:', err.message);
    return { success: false, source: 'hepsiburada', message: err.message, listings: [] };
  }
}

/**
 * Scraper'ı kapat — app quit'te çağır
 */
function destroyScraper() {
  if (scraperWindow && !scraperWindow.isDestroyed()) {
    scraperWindow.close();
    scraperWindow = null;
  }
}

module.exports = {
  scrapeTrendyol,
  scrapeSahibinden,
  scrapeSecondHand,
  scrapeHepsiemlak,
  scrapeRentalYield,
  scrapeAkakce,
  scrapeCimri,
  scrapeHepsiburada,
  destroyScraper,
  hasSavedCookies,
  saveCookies,
  loadCookies,
};
