const fs = require('fs');
const path = require('path');

let electronSafeStorage = null;
let electronApp = null;
try {
  const electron = require('electron');
  electronSafeStorage = electron.safeStorage || null;
  electronApp = electron.app || null;
} catch {
  // Tests and non-Electron scripts use the explicit storePath fallback.
}

function normalizeSecretName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function assertSecretName(name) {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(name)) {
    throw new Error('Secret adı 2-64 karakter olmalı ve sadece küçük harf, rakam, _ veya - içermeli.');
  }
}

function defaultStorePath() {
  if (electronApp?.isReady?.()) {
    return path.join(electronApp.getPath('userData'), 'cakal-secrets.json');
  }
  return path.resolve(__dirname, '../../../.cakal-sandbox/secrets/dev-secrets.json');
}

function readStore(storePath = defaultStorePath()) {
  if (!fs.existsSync(storePath)) return { version: 1, secrets: {}, requests: {}, bindings: {} };
  const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  return {
    version: parsed.version || 1,
    secrets: parsed.secrets && typeof parsed.secrets === 'object' ? parsed.secrets : {},
    requests: parsed.requests && typeof parsed.requests === 'object' ? parsed.requests : {},
    bindings: parsed.bindings && typeof parsed.bindings === 'object' ? parsed.bindings : {},
  };
}

function writeStore(store, storePath = defaultStorePath()) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function canUseSafeStorage() {
  return !!electronSafeStorage?.isEncryptionAvailable?.();
}

function encryptSecret(rawValue) {
  const value = String(rawValue || '');
  if (!value) throw new Error('Secret değeri boş olamaz.');
  if (canUseSafeStorage()) {
    return {
      encoding: 'electron-safeStorage',
      value: electronSafeStorage.encryptString(value).toString('base64'),
    };
  }
  return {
    encoding: 'dev-base64',
    value: Buffer.from(value, 'utf-8').toString('base64'),
  };
}

function decryptSecret(entry) {
  if (!entry) return null;
  if (entry.encoding === 'electron-safeStorage') {
    if (!canUseSafeStorage()) throw new Error('safeStorage kullanılamıyor; secret çözülemedi.');
    return electronSafeStorage.decryptString(Buffer.from(entry.value, 'base64'));
  }
  if (entry.encoding === 'dev-base64') {
    return Buffer.from(entry.value, 'base64').toString('utf-8');
  }
  throw new Error(`Bilinmeyen secret encoding: ${entry.encoding}`);
}

function storeSecret(name, rawValue, options = {}) {
  const normalized = normalizeSecretName(name);
  assertSecretName(normalized);
  const storePath = options.storePath || defaultStorePath();
  const store = readStore(storePath);
  const encrypted = encryptSecret(rawValue);
  store.secrets[normalized] = {
    ...encrypted,
    ref: `secret:${normalized}`,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store, storePath);
  return { success: true, ref: `secret:${normalized}`, name: normalized, stored: true };
}

function hasSecret(name, options = {}) {
  const normalized = normalizeSecretName(name);
  if (!normalized) return false;
  const store = readStore(options.storePath || defaultStorePath());
  return !!store.secrets[normalized];
}

function getSecretValue(name, options = {}) {
  const normalized = normalizeSecretName(name);
  assertSecretName(normalized);
  const store = readStore(options.storePath || defaultStorePath());
  return decryptSecret(store.secrets[normalized]);
}

function listSecretRefs(options = {}) {
  const store = readStore(options.storePath || defaultStorePath());
  return Object.entries(store.secrets).map(([name, entry]) => ({
    name,
    ref: `secret:${name}`,
    updatedAt: entry.updatedAt || null,
    encrypted: entry.encoding === 'electron-safeStorage',
  }));
}

function createSecretResolver(options = {}) {
  return (name) => {
    const normalized = normalizeSecretName(name);
    if (!normalized || !hasSecret(normalized, options)) return null;
    return getSecretValue(normalized, options);
  };
}

// ── Secret istekleri (VS Code tarzı: key önceden oluşturulur, kullanıcı sadece value yapıştırır) ──
// LLM yalnızca secret ADI ister; ham değer hiçbir zaman LLM contextine girmez.

function requestSecretInputs(requests = [], options = {}) {
  const storePath = options.storePath || defaultStorePath();
  const store = readStore(storePath);
  const created = [];

  for (const request of requests) {
    const normalized = normalizeSecretName(request?.name);
    assertSecretName(normalized);
    const alreadyStored = !!store.secrets[normalized];
    store.requests[normalized] = {
      name: normalized,
      ref: `secret:${normalized}`,
      capabilityName: String(request.capability_name || request.capabilityName || '').trim() || null,
      reason: String(request.reason || '').substring(0, 500) || null,
      testInput: request.test_input && typeof request.test_input === 'object' ? request.test_input : null,
      status: alreadyStored ? 'fulfilled' : 'pending',
      requestedAt: new Date().toISOString(),
      fulfilledAt: alreadyStored ? new Date().toISOString() : null,
    };
    created.push(store.requests[normalized]);
  }

  writeStore(store, storePath);
  return { success: true, requests: created };
}

function listSecretRequests(options = {}) {
  const store = readStore(options.storePath || defaultStorePath());
  return Object.values(store.requests).map((request) => ({
    ...request,
    stored: !!store.secrets[request.name],
  }));
}

// storeSecret sonrası çağrılır: bekleyen istek varsa fulfilled işaretler ve
// otomatik devam (test) tetiklemesi için istek kaydını döner.
function fulfillSecretRequest(name, options = {}) {
  const normalized = normalizeSecretName(name);
  if (!normalized) return null;
  const storePath = options.storePath || defaultStorePath();
  const store = readStore(storePath);
  const request = store.requests[normalized];
  if (!request || request.status === 'fulfilled') return null;

  request.status = 'fulfilled';
  request.fulfilledAt = new Date().toISOString();
  writeStore(store, storePath);
  return { ...request };
}

function clearSecretRequest(name, options = {}) {
  const normalized = normalizeSecretName(name);
  if (!normalized) return { success: false };
  const storePath = options.storePath || defaultStorePath();
  const store = readStore(storePath);
  if (!store.requests[normalized]) return { success: false };
  delete store.requests[normalized];
  writeStore(store, storePath);
  return { success: true };
}

// ── Secret-domain bağlama ──
// Bir secret yalnız bağlandığı host'lara gönderilebilir (örn: secret:openweather
// → api.openweathermap.org). Bağlama yoksa ilk kullanımda host'a sabitlenir
// (trust-on-first-use): sonradan yazılan kötü niyetli/hatalı bir manifest,
// mevcut secret'ı başka bir domaine sızdıramaz.

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
}

function bindSecretToHosts(name, hosts, options = {}) {
  const normalized = normalizeSecretName(name);
  assertSecretName(normalized);
  const storePath = options.storePath || defaultStorePath();
  const store = readStore(storePath);
  const merged = new Set([...(store.bindings[normalized] || []), ...(hosts || []).map(normalizeHostname).filter(Boolean)]);
  store.bindings[normalized] = [...merged];
  writeStore(store, storePath);
  return { success: true, name: normalized, hosts: store.bindings[normalized] };
}

function getSecretHostBindings(name, options = {}) {
  const normalized = normalizeSecretName(name);
  if (!normalized) return null;
  const store = readStore(options.storePath || defaultStorePath());
  const bound = store.bindings[normalized];
  return Array.isArray(bound) && bound.length > 0 ? [...bound] : null;
}

/**
 * Secret'ın bu host'a gönderilip gönderilemeyeceğine karar verir.
 * Bağlama yoksa host'a sabitler (TOFU) ve izin verir.
 * @returns {{ allowed: boolean, pinned: boolean, hosts: string[] }}
 */
function ensureSecretHostAllowed(name, hostname, options = {}) {
  const normalized = normalizeSecretName(name);
  const host = normalizeHostname(hostname);
  if (!normalized || !host) return { allowed: false, pinned: false, hosts: [] };

  const storePath = options.storePath || defaultStorePath();
  const store = readStore(storePath);
  const bound = store.bindings[normalized];

  if (!Array.isArray(bound) || bound.length === 0) {
    store.bindings[normalized] = [host];
    writeStore(store, storePath);
    return { allowed: true, pinned: true, hosts: [host] };
  }

  return { allowed: bound.includes(host), pinned: false, hosts: [...bound] };
}

module.exports = {
  normalizeSecretName,
  storeSecret,
  hasSecret,
  getSecretValue,
  listSecretRefs,
  createSecretResolver,
  requestSecretInputs,
  listSecretRequests,
  fulfillSecretRequest,
  clearSecretRequest,
  bindSecretToHosts,
  getSecretHostBindings,
  ensureSecretHostAllowed,
};