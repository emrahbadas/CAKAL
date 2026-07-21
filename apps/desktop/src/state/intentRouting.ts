const DIRECT_COMMERCE_PATTERNS = [
  /(^|[^a-z0-9])drop\s*shipping(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])dropshipping(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])e\s*-?\s*ticaret(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])eticaret(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])urun\s+al\s+sat(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])aliexpress(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])alibaba(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])1688(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])ithalat(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])tedarikci(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])ozel\s+label(?=$|[^a-z0-9])/,
  /(^|[^a-z0-9])private\s+label(?=$|[^a-z0-9])/,
];

const CHINA_COMMERCE_CONTEXT_TOKENS = new Set([
  'pazar',
  'pazari',
  'tedarik',
  'tedarikci',
  'urun',
  'urunler',
  'ithalat',
  'aliexpress',
  'alibaba',
  '1688',
  'dropshipping',
]);

export function normalizeIntentText(text: string) {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenizeIntent(text: string) {
  return normalizeIntentText(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isCommercePipelineIntent(text: string) {
  const normalized = normalizeIntentText(text);
  if (DIRECT_COMMERCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const tokens = new Set(tokenizeIntent(text));
  if (!tokens.has('cin')) {
    return false;
  }

  for (const token of tokens) {
    if (token !== 'cin' && CHINA_COMMERCE_CONTEXT_TOKENS.has(token)) {
      return true;
    }
  }
  return false;
}