import { describe, expect, it } from 'vitest';
import aiService from '../apps/desktop/electron/ai-service.cjs';

const { proposeCapabilityFix, buildSandboxPluginPromptSection } = aiService;

// supabase-js builder taklidi: zincirlenebilir thenable, tablo içerikleri canlı tutulur.
// Filtreler (eq/neq) uygulanmaz; testler tek capability ile çalıştığı için gerek yok.
function createGovernanceDbMock(initial = {}) {
  const tables = {
    capability_gaps: [...(initial.capability_gaps || [])],
    system_capabilities: [...(initial.system_capabilities || [])],
    expansion_proposals: [...(initial.expansion_proposals || [])],
  };
  const inserts = [];

  function makeBuilder(table) {
    tables[table] = tables[table] || [];
    const state = { single: false, insertedRows: null };
    const builder = {
      select() { return builder; },
      order() { return builder; },
      eq() { return builder; },
      neq() { return builder; },
      in() { return builder; },
      limit() { return builder; },
      single() { state.single = true; return builder; },
      insert(payload) {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
          id: `${table}-${tables[table].length + 1}`,
          ...row,
        }));
        tables[table].push(...rows);
        for (const row of rows) inserts.push({ table, payload: row });
        state.insertedRows = rows;
        return builder;
      },
      update(patch) {
        for (const row of tables[table]) Object.assign(row, patch);
        return builder;
      },
      then(resolve) {
        const rows = state.insertedRows || tables[table];
        resolve({ data: state.single ? (rows[0] ?? null) : rows, error: null });
      },
    };
    return builder;
  }

  return { tables, inserts, from: (table) => makeBuilder(table) };
}

const noPlugins = () => ({ plugins: [] });

describe('capability governance flow', () => {
  it('creates a gap record when none exists and produces a proposal', async () => {
    const db = createGovernanceDbMock();

    const result = await proposeCapabilityFix(db, 'openweather_integration', {
      requestContext: 'Kullanıcı OpenWeather entegrasyonu istedi',
      listPlugins: noPlugins,
    });

    expect(result.success).toBe(true);
    expect(result.proposal.capability_name).toBe('openweather_integration');
    expect(result.proposal.status).toBe('pending');

    const gapInsert = db.inserts.find((entry) => entry.table === 'capability_gaps');
    expect(gapInsert).toBeDefined();
    expect(gapInsert.payload.capability_name).toBe('openweather_integration');
    expect(gapInsert.payload.context).toContain('OpenWeather');
  });

  it('short-circuits when the capability is already a registered sandbox plugin', async () => {
    const db = createGovernanceDbMock();

    const result = await proposeCapabilityFix(db, 'weather_api_integration', {
      listPlugins: () => ({
        plugins: [{ id: 'weather_api_integration', description: 'OpenWeather plugini' }],
      }),
    });

    expect(result.success).toBe(true);
    expect(result.already_available).toBe(true);
    expect(result.message).toContain('run_sandbox_plugin');
    expect(db.inserts).toHaveLength(0);
  });

  it('short-circuits when the capability is already active in the registry', async () => {
    const db = createGovernanceDbMock({
      system_capabilities: [{ capability_name: 'flight_search', status: 'active' }],
    });

    const result = await proposeCapabilityFix(db, 'flight_search', { listPlugins: noPlugins });

    expect(result.success).toBe(true);
    expect(result.already_active).toBe(true);
    expect(db.inserts).toHaveLength(0);
  });

  it('reuses an existing pending proposal instead of duplicating it', async () => {
    const db = createGovernanceDbMock({
      capability_gaps: [{ id: 'gap-1', capability_name: 'openweather_integration', status: 'open', trigger_count: 1 }],
      expansion_proposals: [{ id: 'prop-1', capability_name: 'openweather_integration', status: 'pending' }],
    });

    const result = await proposeCapabilityFix(db, 'openweather_integration', { listPlugins: noPlugins });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.proposal.id).toBe('prop-1');
    expect(db.inserts).toHaveLength(0);
  });
});

describe('sandbox plugin prompt section', () => {
  it('lists registered plugins with run_sandbox_plugin guidance', () => {
    const section = buildSandboxPluginPromptSection([
      { id: 'weather_api_integration', description: 'OpenWeather tabanlı şehir hava durumu sorgulama plugini' },
    ]);

    expect(section).toContain('KAYITLI SANDBOX PLUGINLERİ');
    expect(section).toContain('weather_api_integration');
    expect(section).toContain('run_sandbox_plugin');
  });

  it('returns an empty string when no plugins are registered', () => {
    expect(buildSandboxPluginPromptSection([])).toBe('');
    expect(buildSandboxPluginPromptSection(undefined)).toBe('');
  });
});
