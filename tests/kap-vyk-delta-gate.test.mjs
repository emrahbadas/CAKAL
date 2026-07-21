import { describe, expect, it } from 'vitest';
import workerModule from '../scripts/kap-sync-worker.cjs';
import clientModule from '../scripts/mkk-vyk-client.cjs';

const {
  evaluateVykDeltaGate,
  canSkipViaVykGate,
  calculateNextCheckAt,
  isInExpectedReportWindow,
  VYK_GLOBAL_SYMBOL,
} = workerModule;
const { createMkkVykClient, buildVykMemberSymbolMap } = clientModule;

function createFakeSupabase(globalRow) {
  const upserts = [];
  return {
    upserts,
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: table === 'kap_sync_state' ? globalRow : null, error: null }),
        upsert: async (row) => {
          upserts.push({ table, row });
          return { error: null };
        },
      };
    },
  };
}

const NOW = new Date('2026-07-19T18:00:00.000Z');

describe('MKK VYK delta gate', () => {
  it('marker yoksa initialize eder ve skip aktiflesmez', async () => {
    const supabase = createFakeSupabase(null);
    const vyk = {
      authMode: 'BASIC',
      fetchLastDisclosureIndex: async () => '1231017',
      fetchDisclosuresSince: async () => { throw new Error('cagirilmamali'); },
      fetchMembers: async () => [],
    };
    const gate = await evaluateVykDeltaGate({ supabase, vyk, now: NOW });
    expect(gate.active).toBe(false);
    expect(gate.reason).toBe('marker_initialized');
    const companyUpsert = supabase.upserts.find((entry) => entry.table === 'kap_companies');
    expect(companyUpsert.row.symbol).toBe(VYK_GLOBAL_SYMBOL);
    expect(companyUpsert.row.is_active).toBe(false);
    const stateUpsert = supabase.upserts.find((entry) => entry.table === 'kap_sync_state');
    expect(stateUpsert.row.symbol).toBe(VYK_GLOBAL_SYMBOL);
    expect(stateUpsert.row.last_disclosure_id).toBe('1231017');
  });

  it('deltada FR yoksa gate aktif olur ve senkron sembol atlanabilir', async () => {
    const supabase = createFakeSupabase({
      symbol: VYK_GLOBAL_SYMBOL,
      data_type: 'DISCLOSURE',
      last_disclosure_id: '1230990',
      last_checked_at: '2026-07-19T17:30:00.000Z',
      consecutive_no_change: 1,
    });
    const vyk = {
      authMode: 'BASIC',
      fetchLastDisclosureIndex: async () => '1231020',
      fetchDisclosuresSince: async () => [
        { disclosureIndex: '1231018', disclosureClass: 'ODA', companyId: '1684', title: 'ISBIR' },
        { disclosureIndex: '1231019', disclosureClass: 'DG', companyId: '99', title: 'X' },
      ],
      fetchMembers: async () => { throw new Error('FR yokken cagirilmamali'); },
    };
    const gate = await evaluateVykDeltaGate({ supabase, vyk, now: NOW });
    expect(gate.active).toBe(true);
    expect(gate.reason).toBe('no_fr_disclosures_in_delta');
    expect(gate.frCount).toBe(0);

    const skip = canSkipViaVykGate({
      vykGate: gate,
      symbol: 'THYAO',
      currentReport: { report_id: 'r1', disclosure_id: 'd1' },
      syncState: { last_checked_at: '2026-07-19T17:45:00.000Z' },
    });
    expect(skip).toBe(true);

    // Marker guncellemesinden once kontrol edilmis sembol atlanamaz.
    const staleSkip = canSkipViaVykGate({
      vykGate: gate,
      symbol: 'THYAO',
      currentReport: { report_id: 'r1' },
      syncState: { last_checked_at: '2026-07-19T10:00:00.000Z' },
    });
    expect(staleSkip).toBe(false);

    // Hic senkron edilmemis sembol atlanamaz.
    const neverSynced = canSkipViaVykGate({
      vykGate: gate,
      symbol: 'YENI',
      currentReport: null,
      syncState: null,
    });
    expect(neverSynced).toBe(false);
  });

  it('FR deltasinda etkilenen sembol atlanmaz, digerleri atlanir', async () => {
    const supabase = createFakeSupabase({
      symbol: VYK_GLOBAL_SYMBOL,
      data_type: 'DISCLOSURE',
      last_disclosure_id: '1230990',
      last_checked_at: '2026-07-19T17:30:00.000Z',
    });
    const vyk = {
      authMode: 'BASIC',
      fetchDisclosuresSince: async () => [
        { disclosureIndex: '1231018', disclosureClass: 'FR', companyId: '1684', title: 'THY' },
      ],
      fetchMembers: async () => [
        { memberId: '1684', stockCode: 'THYAO' },
        { memberId: '2', stockCode: 'SISE' },
      ],
    };
    const gate = await evaluateVykDeltaGate({ supabase, vyk, now: NOW });
    expect(gate.active).toBe(true);
    expect(gate.reason).toBe('fr_delta_mapped');
    expect(gate.affectedSymbols.has('THYAO')).toBe(true);

    const syncedState = { last_checked_at: '2026-07-19T17:45:00.000Z' };
    expect(canSkipViaVykGate({ vykGate: gate, symbol: 'THYAO', currentReport: { report_id: 'r' }, syncState: syncedState })).toBe(false);
    expect(canSkipViaVykGate({ vykGate: gate, symbol: 'SISE', currentReport: { report_id: 'r' }, syncState: syncedState })).toBe(true);
  });

  it('FR bildirimi sembole eslenemezse gate guvenli tarafta pasif kalir', async () => {
    const supabase = createFakeSupabase({
      symbol: VYK_GLOBAL_SYMBOL,
      data_type: 'DISCLOSURE',
      last_disclosure_id: '1230990',
      last_checked_at: '2026-07-19T17:30:00.000Z',
    });
    const vyk = {
      authMode: 'BASIC',
      fetchDisclosuresSince: async () => [
        { disclosureIndex: '1231018', disclosureClass: 'FR', companyId: 'bilinmeyen-id' },
      ],
      fetchMembers: async () => [{ memberId: '1684', stockCode: 'THYAO' }],
    };
    const gate = await evaluateVykDeltaGate({ supabase, vyk, now: NOW });
    expect(gate.active).toBe(false);
    expect(gate.reason).toBe('fr_symbol_mapping_unavailable');
  });

  it('VYK hatasi gate i pasiflestirir, sync i durdurmaz', async () => {
    const supabase = createFakeSupabase({
      symbol: VYK_GLOBAL_SYMBOL,
      data_type: 'DISCLOSURE',
      last_disclosure_id: '1230990',
      last_checked_at: '2026-07-19T17:30:00.000Z',
    });
    const vyk = {
      authMode: 'BASIC',
      fetchDisclosuresSince: async () => { throw new Error('HTTP 500'); },
    };
    const gate = await evaluateVykDeltaGate({ supabase, vyk, now: NOW });
    expect(gate.active).toBe(false);
    expect(gate.reason).toContain('vyk_error');
  });

  it('cok buyuk delta gate i pasiflestirir ama marker ilerler', async () => {
    const supabase = createFakeSupabase({
      symbol: VYK_GLOBAL_SYMBOL,
      data_type: 'DISCLOSURE',
      last_disclosure_id: '1230000',
      last_checked_at: '2026-07-19T17:30:00.000Z',
    });
    const rows = Array.from({ length: 250 }, (_, index) => ({
      disclosureIndex: String(1230001 + index),
      disclosureClass: 'ODA',
      companyId: String(index),
    }));
    const vyk = { authMode: 'BASIC', fetchDisclosuresSince: async () => rows };
    const gate = await evaluateVykDeltaGate({ supabase, vyk, now: NOW });
    expect(gate.active).toBe(false);
    expect(gate.reason).toBe('delta_too_large');
    const markerUpsert = supabase.upserts.find((entry) => entry.row.symbol === VYK_GLOBAL_SYMBOL);
    expect(markerUpsert.row.last_disclosure_id).toBe('1230250');
  });
});

describe('bilanco donemi (expected report window) cache politikasi', () => {
  it('son rapordan 75+ gun sonra kontrol sikligi rapor-sezonu moduna iner', () => {
    const now = new Date('2026-07-19T12:00:00.000Z');
    // ~80 gun once yayinlanan Q1 raporu: Q2 penceresi acik -> 6 saat.
    const inWindow = { published_at: '2026-04-30T12:00:00.000Z' };
    expect(isInExpectedReportWindow(now, inWindow)).toBe(true);
    const next = new Date(calculateNextCheckAt({ now, currentReport: inWindow, consecutiveNoChange: 5 }));
    expect(next.getTime() - now.getTime()).toBe(6 * 3600 * 1000);

    // 30 gun once yayinlanan rapor: pencere kapali -> adaptif 24-72 saat.
    const recent = { published_at: '2026-06-19T12:00:00.000Z' };
    expect(isInExpectedReportWindow(now, recent)).toBe(false);
    const nextRecent = new Date(calculateNextCheckAt({ now, currentReport: recent, consecutiveNoChange: 0 }));
    expect(nextRecent.getTime() - now.getTime()).toBe(24 * 3600 * 1000);
  });

  it('yeni rapor sonrasi ilk 24 saatte duzeltme kontrolu 2 saattir', () => {
    const now = new Date('2026-07-19T12:00:00.000Z');
    const justPublished = { published_at: '2026-07-19T06:00:00.000Z' };
    const next = new Date(calculateNextCheckAt({ now, currentReport: justPublished, consecutiveNoChange: 0 }));
    expect(next.getTime() - now.getTime()).toBe(2 * 3600 * 1000);
  });
});

describe('VYK skip sigortasi (72 saat tam kontrol tavani)', () => {
  const activeGate = {
    active: true,
    reason: 'no_fr_disclosures_in_delta',
    affectedSymbols: new Set(),
    prevCheckedAt: '2026-07-19T11:00:00.000Z',
  };
  const now = new Date('2026-07-19T12:00:00.000Z');

  it('son gercek KAP kontrolu 72 saatten eskiyse skip reddedilir', () => {
    const blocked = canSkipViaVykGate({
      vykGate: activeGate,
      symbol: 'THYAO',
      currentReport: { report_id: 'r1' },
      syncState: {
        last_checked_at: '2026-07-19T11:30:00.000Z',
        raw: { note: 'vyk_delta_skip', last_full_check_at: '2026-07-15T10:00:00.000Z' },
      },
      now,
    });
    expect(blocked).toBe(false);
  });

  it('son gercek kontrol 72 saat icindeyse skip serbesttir', () => {
    const allowed = canSkipViaVykGate({
      vykGate: activeGate,
      symbol: 'THYAO',
      currentReport: { report_id: 'r1' },
      syncState: {
        last_checked_at: '2026-07-19T11:30:00.000Z',
        raw: { note: 'vyk_delta_skip', last_full_check_at: '2026-07-18T10:00:00.000Z' },
      },
      now,
    });
    expect(allowed).toBe(true);
  });
});

describe('MKK VYK CJS istemcisi', () => {
  it('key/secret varken Basic auth kullanir (canli dogrulanan davranis)', async () => {
    const calls = [];
    const client = createMkkVykClient({
      env: {
        MKK_VYK_BASE_URL: 'https://example.test/api/vyk',
        MKK_VYK_API_KEY: 'key-1',
        MKK_VYK_API_SECRET: 'secret-1',
        MKK_VYK_API_TOKEN: 'mcp_token',
      },
      minIntervalMs: 0,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ lastDisclosureIndex: '5' }), { status: 200 });
      },
    });
    expect(client.authMode).toBe('BASIC');
    await expect(client.fetchLastDisclosureIndex()).resolves.toBe('5');
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('key-1:secret-1').toString('base64')}`);
  });

  it('konfigurasyon yoksa null doner', () => {
    expect(createMkkVykClient({ env: {} })).toBeNull();
  });

  it('uye eslemesi virgullu hisse kodlarini ayirir', () => {
    const map = buildVykMemberSymbolMap([
      { memberId: '1', stockCode: 'ISATR,ISBTR' },
      { memberId: '2', stockCode: 'THYAO' },
      { memberId: '3', stockCode: '' },
    ]);
    expect(map.get('1')).toEqual(['ISATR', 'ISBTR']);
    expect(map.get('2')).toEqual(['THYAO']);
    expect(map.has('3')).toBe(false);
  });
});
