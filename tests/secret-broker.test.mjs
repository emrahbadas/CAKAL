import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import secretBroker from '../apps/desktop/electron/secret-broker.cjs';

const {
  createSecretResolver,
  getSecretValue,
  hasSecret,
  listSecretRefs,
  normalizeSecretName,
  storeSecret,
  requestSecretInputs,
  listSecretRequests,
  fulfillSecretRequest,
  clearSecretRequest,
  bindSecretToHosts,
  getSecretHostBindings,
  ensureSecretHostAllowed,
} = secretBroker;

let tempDir;
let storePath;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-secret-broker-'));
  storePath = path.join(tempDir, 'secrets.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('secret broker', () => {
  it('normalizes provider names into stable secret ids', () => {
    expect(normalizeSecretName(' OpenWeather API ')).toBe('openweather_api');
  });

  it('stores secret metadata without exposing the raw value in status/list results', () => {
    const result = storeSecret('openweather', 'raw-secret-value', { storePath });
    const refs = listSecretRefs({ storePath });

    expect(result).toMatchObject({ success: true, ref: 'secret:openweather', stored: true });
    expect(hasSecret('openweather', { storePath })).toBe(true);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'openweather', ref: 'secret:openweather' });
    expect(JSON.stringify(result)).not.toContain('raw-secret-value');
    expect(JSON.stringify(refs)).not.toContain('raw-secret-value');
  });

  it('resolves raw values only through the runtime resolver path', () => {
    storeSecret('openweather', 'runtime-secret-value', { storePath });
    const resolver = createSecretResolver({ storePath });

    expect(getSecretValue('openweather', { storePath })).toBe('runtime-secret-value');
    expect(resolver('openweather')).toBe('runtime-secret-value');
    expect(resolver('missing')).toBeNull();
  });
});

describe('secret input requests (autonomous integration flow)', () => {
  it('creates pending request fields without any secret value', () => {
    const { requests } = requestSecretInputs([
      {
        name: 'openweather',
        capability_name: 'weather_api_integration',
        reason: 'Hava durumu API erişimi',
        test_input: { city: 'Istanbul' },
      },
    ], { storePath });

    expect(requests[0]).toMatchObject({
      name: 'openweather',
      ref: 'secret:openweather',
      status: 'pending',
      capabilityName: 'weather_api_integration',
    });

    const listed = listSecretRequests({ storePath });
    expect(listed).toHaveLength(1);
    expect(listed[0].stored).toBe(false);
  });

  it('marks the request fulfilled after the secret is stored and returns continuation info once', () => {
    requestSecretInputs([
      { name: 'openweather', capability_name: 'weather_api_integration', test_input: { city: 'Istanbul' } },
    ], { storePath });
    storeSecret('openweather', 'raw-secret-value', { storePath });

    const fulfilled = fulfillSecretRequest('openweather', { storePath });
    expect(fulfilled).toMatchObject({ name: 'openweather', capabilityName: 'weather_api_integration', status: 'fulfilled' });
    expect(fulfilled.testInput).toEqual({ city: 'Istanbul' });
    expect(JSON.stringify(fulfilled)).not.toContain('raw-secret-value');

    // Aynı istek ikinci kez tetikleme üretmez (idempotent otomatik devam)
    expect(fulfillSecretRequest('openweather', { storePath })).toBeNull();
  });

  it('treats requests for already-stored secrets as fulfilled immediately', () => {
    storeSecret('openweather', 'existing-value', { storePath });
    const { requests } = requestSecretInputs([{ name: 'openweather' }], { storePath });
    expect(requests[0].status).toBe('fulfilled');
  });

  it('clears a request on demand', () => {
    requestSecretInputs([{ name: 'openweather' }], { storePath });
    expect(clearSecretRequest('openweather', { storePath })).toEqual({ success: true });
    expect(listSecretRequests({ storePath })).toHaveLength(0);
  });
});

describe('secret-domain binding (trust-on-first-use)', () => {
  it('pins an unbound secret to the first host and allows it', () => {
    const verdict = ensureSecretHostAllowed('openweather', 'api.openweathermap.org', { storePath });
    expect(verdict).toEqual({ allowed: true, pinned: true, hosts: ['api.openweathermap.org'] });
    expect(getSecretHostBindings('openweather', { storePath })).toEqual(['api.openweathermap.org']);
  });

  it('blocks a pinned secret from being sent to a different host', () => {
    ensureSecretHostAllowed('openweather', 'api.openweathermap.org', { storePath });
    const verdict = ensureSecretHostAllowed('openweather', 'evil.example.com', { storePath });
    expect(verdict.allowed).toBe(false);
    expect(verdict.hosts).toEqual(['api.openweathermap.org']);
    // bağlama değişmemiş olmalı
    expect(getSecretHostBindings('openweather', { storePath })).toEqual(['api.openweathermap.org']);
  });

  it('supports explicit multi-host bindings and hostname normalization', () => {
    bindSecretToHosts('openweather', ['API.OpenWeatherMap.org', 'pro.openweathermap.org.'], { storePath });
    expect(getSecretHostBindings('openweather', { storePath })).toEqual(['api.openweathermap.org', 'pro.openweathermap.org']);
    expect(ensureSecretHostAllowed('openweather', 'pro.openweathermap.org', { storePath }).allowed).toBe(true);
    expect(ensureSecretHostAllowed('openweather', 'openweathermap.org.evil.com', { storePath }).allowed).toBe(false);
  });
});