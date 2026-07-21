const fs = require('fs');
const path = require('path');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '../../..');
const PLUGIN_ROOT = '.cakal-sandbox/plugins';
const REGISTRY_PATH = `${PLUGIN_ROOT}/registry.json`;
const MAX_PLUGIN_RESPONSE_BYTES = 512 * 1024;

function normalizeRepoPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function pluginManifestPath(pluginId) {
  return `${PLUGIN_ROOT}/${pluginId}.plugin.json`;
}

function resolveInsideProject(projectRoot, repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  const fullPath = path.resolve(projectRoot, normalized);
  if (!fullPath.startsWith(projectRoot)) {
    throw new Error(`GUVENLIK: Proje disina erisim engellendi: ${repoPath}`);
  }
  return fullPath;
}

function readRegistry(projectRoot = DEFAULT_PROJECT_ROOT) {
  const fullPath = resolveInsideProject(projectRoot, REGISTRY_PATH);
  if (!fs.existsSync(fullPath)) {
    return { version: 1, plugins: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  return {
    version: parsed.version || 1,
    plugins: parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {},
  };
}

function writeRegistry(registry, projectRoot = DEFAULT_PROJECT_ROOT) {
  const fullPath = resolveInsideProject(projectRoot, REGISTRY_PATH);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeManifest(rawManifest = {}) {
  return {
    id: String(rawManifest.id || '').trim(),
    name: String(rawManifest.name || rawManifest.id || '').trim(),
    description: String(rawManifest.description || '').trim(),
    type: rawManifest.type || 'http_request',
    method: String(rawManifest.method || 'GET').toUpperCase(),
    urlTemplate: String(rawManifest.urlTemplate || rawManifest.url_template || '').trim(),
    inputs: normalizeStringArray(rawManifest.inputs || rawManifest.requiredInputs || rawManifest.required_inputs),
    requiredSecrets: normalizeStringArray(rawManifest.requiredSecrets || rawManifest.required_secrets),
    outputMap: rawManifest.outputMap && typeof rawManifest.outputMap === 'object' ? rawManifest.outputMap : {},
    timeoutMs: Math.min(Number(rawManifest.timeoutMs || rawManifest.timeout_ms || 10000), 20000),
  };
}

function assertSafePluginId(id) {
  if (!/^[a-z0-9][a-z0-9_-]{2,64}$/.test(id)) {
    throw new Error('Plugin id 3-65 karakter olmali ve sadece kucuk harf, rakam, _ veya - icermeli.');
  }
}

function blockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local');
}

function urlForValidation(urlTemplate) {
  return urlTemplate
    .replace(/\{\{\s*input\.[a-zA-Z0-9_-]+\s*\}\}/g, 'sample')
    .replace(/\{\{\s*secret\.[a-zA-Z0-9_-]+\s*\}\}/g, 'redacted');
}

function validateSandboxPluginManifest(rawManifest = {}) {
  const manifest = normalizeManifest(rawManifest);
  assertSafePluginId(manifest.id);

  if (manifest.type !== 'http_request') {
    throw new Error('Ilk surumde sadece http_request plugin tipi desteklenir. Serbest kod calistirma yok.');
  }
  if (manifest.method !== 'GET') {
    throw new Error('Ilk surumde sadece GET HTTP pluginleri desteklenir.');
  }
  if (!manifest.urlTemplate) {
    throw new Error('urlTemplate gerekli.');
  }

  const parsedUrl = new URL(urlForValidation(manifest.urlTemplate));
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Plugin URL sadece https olabilir.');
  }
  if (blockedHost(parsedUrl.hostname)) {
    throw new Error(`GUVENLIK: Local/private host yasak: ${parsedUrl.hostname}`);
  }

  const placeholders = [...manifest.urlTemplate.matchAll(/\{\{\s*(input|secret)\.([a-zA-Z0-9_-]+)\s*\}\}/g)];
  const inputRefs = placeholders.filter((match) => match[1] === 'input').map((match) => match[2]);
  const secretRefs = placeholders.filter((match) => match[1] === 'secret').map((match) => match[2]);

  const missingInputs = inputRefs.filter((name) => !manifest.inputs.includes(name));
  const missingSecrets = secretRefs.filter((name) => !manifest.requiredSecrets.includes(name));
  if (missingInputs.length > 0) {
    throw new Error(`Manifest input listesinde eksik alanlar var: ${[...new Set(missingInputs)].join(', ')}`);
  }
  if (missingSecrets.length > 0) {
    throw new Error(`Manifest requiredSecrets listesinde eksik alanlar var: ${[...new Set(missingSecrets)].join(', ')}`);
  }

  return { valid: true, manifest };
}

function registerSandboxPlugin(rawManifest, options = {}) {
  const projectRoot = options.projectRoot || DEFAULT_PROJECT_ROOT;
  const { manifest } = validateSandboxPluginManifest(rawManifest);
  const manifestRepoPath = pluginManifestPath(manifest.id);
  const manifestFullPath = resolveInsideProject(projectRoot, manifestRepoPath);

  fs.mkdirSync(path.dirname(manifestFullPath), { recursive: true });
  fs.writeFileSync(manifestFullPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  const registry = readRegistry(projectRoot);
  registry.plugins[manifest.id] = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    type: manifest.type,
    manifestPath: manifestRepoPath,
    requiredSecrets: manifest.requiredSecrets.map((name) => `secret:${name}`),
    status: 'registered',
    registeredAt: new Date().toISOString(),
  };
  writeRegistry(registry, projectRoot);

  return {
    success: true,
    status: 'registered',
    plugin: registry.plugins[manifest.id],
    registry_path: REGISTRY_PATH,
  };
}

function listSandboxPlugins(options = {}) {
  const registry = readRegistry(options.projectRoot || DEFAULT_PROJECT_ROOT);
  return { success: true, plugins: Object.values(registry.plugins) };
}

function defaultSecretResolver(secretName) {
  const envName = `CAKAL_SECRET_${String(secretName || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return process.env[envName] || null;
}

function fillUrlTemplate(urlTemplate, input, secrets) {
  return urlTemplate
    .replace(/\{\{\s*input\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => encodeURIComponent(String(input[key] ?? '')))
    .replace(/\{\{\s*secret\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => encodeURIComponent(String(secrets[key] ?? '')));
}

function readJsonPath(data, selector) {
  const pathText = String(selector || '').trim();
  if (!pathText.startsWith('$.')) return undefined;
  const parts = pathText.slice(2).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current = data;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function mapOutput(payload, outputMap) {
  const entries = Object.entries(outputMap || {});
  if (entries.length === 0) return payload;
  const mapped = {};
  for (const [key, selector] of entries) {
    mapped[key] = readJsonPath(payload, selector);
  }
  return mapped;
}

async function runSandboxPlugin(args = {}, options = {}) {
  const projectRoot = options.projectRoot || DEFAULT_PROJECT_ROOT;
  const states = ['IDLE'];
  const pluginId = String(args.plugin_id || args.pluginId || '').trim();
  const input = args.input && typeof args.input === 'object' ? args.input : {};
  if (!pluginId) return { success: false, status: 'plugin_required', states, message: 'plugin_id gerekli.' };

  states.push('REGISTRY_LOOKUP');
  const registry = readRegistry(projectRoot);
  const entry = registry.plugins[pluginId];
  if (!entry) return { success: false, status: 'not_found', states, message: `Plugin bulunamadi: ${pluginId}` };

  states.push('MANIFEST_LOAD');
  const manifestFullPath = resolveInsideProject(projectRoot, entry.manifestPath);
  const { manifest } = validateSandboxPluginManifest(JSON.parse(fs.readFileSync(manifestFullPath, 'utf-8')));

  states.push('INPUT_VALIDATION');
  const missingInputs = manifest.inputs.filter((name) => input[name] === undefined || input[name] === null || input[name] === '');
  if (missingInputs.length > 0) {
    return { success: false, status: 'input_required', states, missing_inputs: missingInputs };
  }

  states.push('SECRET_CHECK');
  const secretResolver = options.secretResolver || defaultSecretResolver;
  const secrets = {};
  const missingSecrets = [];
  for (const secretName of manifest.requiredSecrets) {
    const value = secretResolver(secretName);
    if (!value) missingSecrets.push(secretName);
    else secrets[secretName] = value;
  }
  if (missingSecrets.length > 0) {
    return {
      success: false,
      status: 'secret_required',
      states,
      required_secrets: missingSecrets.map((name) => `secret:${name}`),
      message: 'Secret Broker gerekli key referanslarini bulamadi. Ham secret LLM contextine verilmez.',
    };
  }

  // Secret-domain kapısı: her secret yalnız bağlandığı host'a gönderilebilir.
  // Bağlama kararı broker tarafındadır (TOFU: ilk kullanımda sabitlenir);
  // FSM yalnız kararı uygular. Kötü/hatalı bir manifest mevcut secret'ı
  // başka bir domaine sızdıramaz.
  const requestUrl = fillUrlTemplate(manifest.urlTemplate, input, secrets);
  const requestHost = new URL(requestUrl).hostname;
  if (typeof options.secretHostGuard === 'function') {
    states.push('SECRET_DOMAIN_CHECK');
    for (const secretName of Object.keys(secrets)) {
      const verdict = options.secretHostGuard(secretName, requestHost) || {};
      if (verdict.allowed === false) {
        return {
          success: false,
          status: 'secret_domain_blocked',
          states,
          message: `GUVENLIK: secret:${secretName} yalnizca ${(verdict.hosts || []).join(', ') || 'bagli hostlara'} gonderilebilir; ${requestHost} engellendi.`,
        };
      }
    }
  }

  states.push('HTTP_EXECUTION');
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), manifest.timeoutMs);
  try {
    const response = await fetchImpl(requestUrl, {
      method: manifest.method,
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain;q=0.8' },
      // Redirect takip edilmez: secret içeren istek yönlendirmeyle başka
      // bir hosta taşınamaz (secret sızıntısı vektörü).
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        success: false,
        status: 'redirect_blocked',
        states,
        http_status: response.status,
        message: 'GUVENLIK: Redirect takip edilmedi; secret iceren istek baska bir adrese yonlendirilemez.',
      };
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf-8') > MAX_PLUGIN_RESPONSE_BYTES) {
      return { success: false, status: 'response_too_large', states, http_status: response.status };
    }
    const payload = text.trim().startsWith('{') || text.trim().startsWith('[') ? JSON.parse(text) : { text };
    states.push('OUTPUT_MAPPING');
    return {
      success: response.ok,
      status: response.ok ? 'completed' : 'http_error',
      states,
      plugin_id: pluginId,
      http_status: response.status,
      data: mapOutput(payload, manifest.outputMap),
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  PLUGIN_ROOT,
  REGISTRY_PATH,
  validateSandboxPluginManifest,
  registerSandboxPlugin,
  listSandboxPlugins,
  runSandboxPlugin,
};