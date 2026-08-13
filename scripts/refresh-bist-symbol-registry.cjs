#!/usr/bin/env node
/**
 * BIST sembol sicilini Mynet canlı panosundan tazeler.
 *
 * NEDEN GEREKLİ: sicil bir ALLOWLIST'tir ve otoritedir — sicilde olmayan
 * büyük harfli dizi hisse SAYILMAZ. Yeni halka arz edilen şirket, bu script
 * çalıştırılana kadar görülmez. Bu bilinçli bir tercih (bkz. modül başlığı):
 * eksik tetikleme, her Türkçe cümlede sahte şirket saymaktan iyidir.
 *
 * Kullanım:  node scripts/refresh-bist-symbol-registry.cjs
 */
const fs = require('fs');
const path = require('path');

const SERVICE = path.join(__dirname, '..', 'apps', 'desktop', 'electron', 'ai-service.cjs');
const TARGET = path.join(__dirname, '..', 'apps', 'desktop', 'electron', 'bist-symbol-registry.cjs');

async function main() {
  const src = fs.readFileSync(SERVICE, 'utf8');
  const res = await fetch('https://finans.mynet.com/borsa/canliborsa/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Mynet panosu alınamadı: HTTP ${res.status}`);
  const html = await res.text();

  // Parser'ı üretimden ödünç al — ikinci bir kopya tutmak sapma üretir.
  const consts = [...src.matchAll(/^const MYNET_[A-Z_]+ = [\s\S]*?;$/gm)].map((m) => m[0]).join('\n');
  const start = src.indexOf('function parseMynetNumber');
  const end = src.indexOf('async function fetchMynetLiveBoard');
  if (start < 0 || end < 0) throw new Error('Mynet parser bulunamadı — kaynak yapısı değişmiş olabilir.');
  // eslint-disable-next-line no-new-func
  const parse = new Function(`${consts}\n${src.slice(start, end)}; return parseMynetLiveBoardHtml;`)();

  const parsed = parse(html);
  const items = parsed.items || parsed;
  const symbols = [...new Set(items.map((i) => i.symbol).filter((s) => /^[A-Z]{3,6}$/.test(s)))].sort();

  if (symbols.length < 400) {
    throw new Error(`Sicil şüpheli küçük (${symbols.length}). Yazılmadı — pano eksik dönmüş olabilir.`);
  }

  const prev = fs.existsSync(TARGET) ? require(TARGET) : null;
  const today = new Date().toISOString().slice(0, 10);
  const head = fs.readFileSync(TARGET, 'utf8').split('const BIST_SYMBOLS')[0]
    .replace(/Kaynak: Mynet canlı borsa panosu, \d+ sembol, \d{4}-\d{2}-\d{2}\./,
      `Kaynak: Mynet canlı borsa panosu, ${symbols.length} sembol, ${today}.`);

  const lines = [];
  for (let i = 0; i < symbols.length; i += 8) {
    lines.push(`  ${symbols.slice(i, i + 8).map((s) => JSON.stringify(s)).join(', ')},`);
  }

  const body = `const BIST_SYMBOLS = Object.freeze(new Set([\n${lines.join('\n')}\n]));\n\n`
    + '/** Sicilde kayıtlı mı? Sembol büyük harfe çevrilir, .IS soneki atılır. */\n'
    + 'function isKnownBistSymbol(token) {\n'
    + "  const s = String(token || '').trim().toUpperCase().replace(/\.IS$/i, '');\n"
    + '  return BIST_SYMBOLS.has(s);\n'
    + '}\n\n'
    + `module.exports = { BIST_SYMBOLS, isKnownBistSymbol, REGISTRY_SIZE: BIST_SYMBOLS.size, REGISTRY_SOURCE: 'mynet_canli_borsa', REGISTRY_DATE: '${today}' };\n`;

  fs.writeFileSync(TARGET, head + body);
  const added = prev ? symbols.filter((s) => !prev.BIST_SYMBOLS.has(s)) : [];
  const removed = prev ? [...prev.BIST_SYMBOLS].filter((s) => !symbols.includes(s)) : [];
  console.log(`Sicil güncellendi: ${symbols.length} sembol (${today})`);
  if (added.length) console.log(`  eklenen (${added.length}): ${added.join(', ')}`);
  if (removed.length) console.log(`  düşen (${removed.length}): ${removed.join(', ')}`);
}

main().catch((err) => { console.error('HATA:', err.message); process.exit(1); });
