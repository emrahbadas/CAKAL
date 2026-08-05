// ============================================================
// capability-policy.cjs — yetenek beyanı ve kapsam politikası
// ============================================================
// Yeni bir tool/yetenek eklenirken ne yaptığını YAPISAL olarak beyan eder:
//
//   { name, capability, side_effect, auth_scope, reversible,
//     user_identity_representation }
//
// Policy motoru bu alanlara bakar. Diff'te "POST" kelimesi aramaktan çok daha
// sağlamdır: metin değişir, anlam değişmez.
//
// KRİTİK — BEYAN KANIT DEĞİLDİR:
// Manifest'i yazan taraf (cerrah) yanlış beyanda bulunabilir; sosyal medya
// tool'unu `external_read` diye etiketleyip kapıdan geçirmeye çalışabilir.
// Bu yüzden beyan, diff'ten toplanan MEKANİK KANITLA karşılaştırılır.
// Çelişki varsa beyan değil, kanıt kazanır ve değişiklik bloklanır.
// (Aynı ilke: write_project_file'ın SUCCESS dönmesi işin bittiğini kanıtlamaz.)

const CAPABILITIES = Object.freeze(['internal', 'external_read', 'external_write']);
const SIDE_EFFECTS = Object.freeze(['none', 'internal_state', 'notify_owner', 'public_publish', 'financial_transaction', 'third_party_write']);
const AUTH_SCOPES = Object.freeze(['none', 'read_only', 'write']);

/** Hiçbir koşulda otomatik geçmeyen beyanlar. */
const FORBIDDEN_SIDE_EFFECTS = new Set(['public_publish', 'financial_transaction', 'third_party_write']);

// Diff'te bu izler görülürse dış dünyaya YAZMA şüphesi doğar.
const WRITE_EVIDENCE_PATTERNS = [
  /\bmethod\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/i,
  /\.(post|put|patch|delete)\s*\(/,
  /\bFormData\b|\bmultipart\/form-data\b/i,
  /\b(upload|publish|tweet|post_message|sendMessage|send_email|createOrder|placeOrder)\b/i,
];

// Ödeme / broker / transfer alanları — kesin blok.
const FINANCIAL_ACTION_PATTERNS = [
  /\b(binance|coinbase|kraken|ibkr|interactivebrokers|alpaca)\b.*\b(order|trade|withdraw)\b/i,
  /\b(stripe|paypal|iyzico|payten|papara)\b/i,
  /\b(createOrder|placeOrder|submitOrder|transferFunds|withdraw)\b/i,
];

// Otonom çalışan yeni iş — inceleme gerektirir.
const SCHEDULER_PATTERNS = [
  /\bcron\.schedule\s*\(/,
  /\bsetInterval\s*\(/,
  /\bnew\s+Worker\s*\(/,
];

// Yazma yetkili kimlik kapsamı — kesin blok.
const WRITE_SCOPE_PATTERNS = [
  /\bscope\s*[:=]\s*['"][^'"]*\b(write|publish|manage|admin|offline_access)\b/i,
  /\b(tweet\.write|users\.write|repo:write|publish_video|pages_manage)\b/i,
];

function normalizeManifest(raw = {}) {
  return {
    name: String(raw.name || '').trim(),
    capability: String(raw.capability || '').trim(),
    side_effect: String(raw.side_effect || '').trim(),
    auth_scope: String(raw.auth_scope || '').trim(),
    reversible: raw.reversible !== false,
    user_identity_representation: raw.user_identity_representation === true,
  };
}

/** Manifest'in şema olarak geçerli olup olmadığı. */
function validateManifest(raw = {}) {
  const manifest = normalizeManifest(raw);
  const errors = [];
  if (!manifest.name) errors.push('name zorunlu');
  if (!CAPABILITIES.includes(manifest.capability)) errors.push(`capability geçersiz (${CAPABILITIES.join('|')})`);
  if (!SIDE_EFFECTS.includes(manifest.side_effect)) errors.push(`side_effect geçersiz (${SIDE_EFFECTS.join('|')})`);
  if (!AUTH_SCOPES.includes(manifest.auth_scope)) errors.push(`auth_scope geçersiz (${AUTH_SCOPES.join('|')})`);
  return { ok: errors.length === 0, manifest, errors };
}

/**
 * Beyana göre kapsam kararı (kanıt henüz devrede değil).
 * @returns {{ verdict:'ALLOW'|'REVIEW'|'BLOCK', reasons:string[] }}
 */
function evaluateManifest(raw = {}) {
  const { ok, manifest, errors } = validateManifest(raw);
  if (!ok) return { verdict: 'BLOCK', reasons: [`Manifest geçersiz: ${errors.join(', ')}`] };

  const reasons = [];

  if (manifest.user_identity_representation) {
    reasons.push('Kullanıcının kimliğini temsil eden dış eylem — anayasa dışı.');
  }
  if (FORBIDDEN_SIDE_EFFECTS.has(manifest.side_effect)) {
    reasons.push(`Yan etki kapsam dışı: ${manifest.side_effect}.`);
  }
  if (manifest.auth_scope === 'write') {
    reasons.push('Yazma yetkili kimlik kapsamı — ayrı mimari inceleme gerekir.');
  }
  if (manifest.capability === 'external_write') {
    reasons.push('Dış servise yazan yetenek — ürün anayasası varsayılan olarak reddeder.');
  }
  if (reasons.length > 0) return { verdict: 'BLOCK', reasons };

  if (!manifest.reversible) {
    return { verdict: 'REVIEW', reasons: ['Geri alınamaz işlem — insan incelemesi gerekli.'] };
  }
  if (manifest.capability === 'external_read') {
    return { verdict: 'REVIEW', reasons: ['Yeni dış veri kaynağı — hangi domain, neden?'] };
  }
  return { verdict: 'ALLOW', reasons: [] };
}

/** Diff'ten mekanik kanıt toplar. Beyanın doğrulanmasında kullanılır. */
function collectEvidence(addedLines = []) {
  const lines = Array.isArray(addedLines) ? addedLines : [];
  const hit = (patterns) => lines.some((line) => patterns.some((p) => p.test(String(line))));
  return {
    externalWrite: hit(WRITE_EVIDENCE_PATTERNS),
    financialAction: hit(FINANCIAL_ACTION_PATTERNS),
    scheduler: hit(SCHEDULER_PATTERNS),
    writeScope: hit(WRITE_SCOPE_PATTERNS),
  };
}

/**
 * Beyan ile kanıtı karşılaştırır. Çelişkide KANIT kazanır.
 * Manifest verilmemişse yalnız kanıt üzerinden karar verilir.
 */
function evaluateChange({ manifest = null, addedLines = [] } = {}) {
  const evidence = collectEvidence(addedLines);
  const reasons = [];
  let verdict = 'ALLOW';

  const raise = (level, reason) => {
    reasons.push(reason);
    if (level === 'BLOCK') verdict = 'BLOCK';
    else if (level === 'REVIEW' && verdict !== 'BLOCK') verdict = 'REVIEW';
  };

  // 1) Kanıt tabanlı sert kurallar — beyandan bağımsız.
  if (evidence.financialAction) {
    raise('BLOCK', 'Ödeme/broker/transfer izi bulundu; gerçek varlık üzerinde işlem anayasa dışı.');
  }
  if (evidence.writeScope) {
    raise('BLOCK', 'Yazma yetkili kimlik kapsamı (OAuth write) izi bulundu.');
  }
  if (evidence.externalWrite) {
    raise('BLOCK', 'Dış servise yazma izi bulundu (POST/PUT/upload/publish).');
  }
  if (evidence.scheduler) {
    raise('REVIEW', 'Yeni zamanlanmış/arka plan iş izi bulundu; otonom davranış incelenmeli.');
  }

  // 2) Beyan varsa onu da değerlendir.
  if (manifest) {
    const declared = evaluateManifest(manifest);
    for (const reason of declared.reasons) raise(declared.verdict === 'BLOCK' ? 'BLOCK' : 'REVIEW', `Beyan: ${reason}`);

    // 3) BEYAN–KANIT ÇELİŞKİSİ — en kritik kontrol.
    const normalized = normalizeManifest(manifest);
    const declaredHarmless = normalized.capability !== 'external_write'
      && normalized.auth_scope !== 'write'
      && !FORBIDDEN_SIDE_EFFECTS.has(normalized.side_effect);

    if (declaredHarmless && (evidence.externalWrite || evidence.writeScope || evidence.financialAction)) {
      raise('BLOCK', 'BEYAN–GERÇEK ÇELİŞKİSİ: manifest zararsız beyan ediyor ama diff dış yazma/ödeme izi taşıyor. Beyan değil kanıt esastır.');
    }
  }

  return { verdict, reasons, evidence };
}

module.exports = {
  CAPABILITIES,
  SIDE_EFFECTS,
  AUTH_SCOPES,
  normalizeManifest,
  validateManifest,
  evaluateManifest,
  collectEvidence,
  evaluateChange,
};
