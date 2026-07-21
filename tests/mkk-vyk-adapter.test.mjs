import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MkkVykAdapter,
  MkkVykApiError,
  mkkMemberToSignal,
  normalizeMkkDate,
} from '../packages/sources/mkk-vyk/src/index.ts';

describe('MKK VYK adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls lastDisclosureIndex with Basic Auth', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ lastDisclosureIndex: '1598897' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MkkVykAdapter({
      baseUrl: 'https://example.test/api/vyk',
      apiKey: 'key-1',
      apiSecret: 'secret-1',
      minIntervalMs: 0,
    });

    await expect(adapter.fetchLastDisclosureIndex()).resolves.toBe('1598897');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/api/vyk/lastDisclosureIndex');
    expect(init.headers.Authorization).toBe(`Basic ${btoa('key-1:secret-1')}`);
  });

  it('uses Bearer auth only when key/secret are absent', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ lastDisclosureIndex: '1598898' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MkkVykAdapter({
      baseUrl: 'https://example.test/api/vyk',
      apiToken: 'mcp_test_token',
      minIntervalMs: 0,
    });

    await expect(adapter.fetchLastDisclosureIndex()).resolves.toBe('1598898');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer mcp_test_token');
  });

  it('prefers Basic auth when key/secret and token are both present', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ lastDisclosureIndex: '1598899' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MkkVykAdapter({
      baseUrl: 'https://example.test/api/vyk',
      apiKey: 'key-1',
      apiSecret: 'secret-1',
      apiToken: 'mcp_test_token',
      minIntervalMs: 0,
    });

    await expect(adapter.fetchLastDisclosureIndex()).resolves.toBe('1598899');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${btoa('key-1:secret-1')}`);
  });

  it('accepts token-only configuration without key/secret', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = MkkVykAdapter.fromEnv({
      MKK_VYK_BASE_URL: 'https://example.test/api/vyk',
      MKK_VYK_API_TOKEN: 'mcp_env_token',
    });

    await expect(adapter.fetchMembers()).resolves.toEqual([]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer mcp_env_token');
  });

  it('serializes disclosure query parameters', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { disclosureIndex: '11', disclosureType: 'FR', title: 'Finansal Rapor' },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MkkVykAdapter({
      baseUrl: 'https://example.test/api/vyk',
      apiKey: 'key',
      apiSecret: 'secret',
      minIntervalMs: 0,
    });

    const rows = await adapter.fetchDisclosures({
      disclosureIndex: 100,
      disclosureTypes: 'FR',
      disclosureClass: 'FR',
      companyId: ['1', '2'],
    });

    expect(rows).toHaveLength(1);
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('disclosureIndex')).toBe('100');
    expect(parsed.searchParams.get('disclosureTypes')).toBe('FR');
    expect(parsed.searchParams.getAll('companyId')).toEqual(['1', '2']);
  });

  it('converts MKK member rows to source signals', () => {
    const signal = mkkMemberToSignal({
      title: 'TURK HAVA YOLLARI A.O.',
      stockCode: 'THYAO',
      memberType: 'IGS',
      kfifUrl: 'https://www.kap.org.tr/tr/sirket-bilgileri/ozet/1',
    }, '2026-07-19T00:00:00.000Z');

    expect(signal).toMatchObject({
      sourceId: 'mkk-vyk-member-THYAO',
      sourceName: 'MKK KAP VYK API',
      title: 'THYAO - TURK HAVA YOLLARI A.O.',
      category: 'finance',
      fetchedAt: '2026-07-19T00:00:00.000Z',
    });
  });

  it('normalizes Turkish dates', () => {
    expect(normalizeMkkDate('19/07/2026 00:53:45')).toBe('2026-07-18T21:53:45.000Z');
  });

  it('throws a product access hint for unauthorized responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' })));
    const adapter = new MkkVykAdapter({
      baseUrl: 'https://example.test/api/vyk',
      apiKey: 'key',
      apiSecret: 'secret',
      minIntervalMs: 0,
    });

    await expect(adapter.fetchLastDisclosureIndex()).rejects.toThrow(MkkVykApiError);
    await expect(adapter.fetchLastDisclosureIndex()).rejects.toThrow(/API product/);
  });

  it('can be configured from environment variables', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ lastDisclosureIndex: '1598898' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = MkkVykAdapter.fromEnv({
      MKK_VYK_BASE_URL: 'https://example.test/api/vyk',
      MKK_VYK_API_KEY: 'env-key',
      MKK_VYK_API_SECRET: 'env-secret',
      MKK_VYK_MIN_INTERVAL_MS: '0',
    });

    await expect(adapter.fetchLastDisclosureIndex()).resolves.toBe('1598898');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${btoa('env-key:env-secret')}`);
  });
});
