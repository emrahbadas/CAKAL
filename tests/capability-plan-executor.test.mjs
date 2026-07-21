import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import aiService from '../apps/desktop/electron/ai-service.cjs';

const { applyCapabilityPlan, buildDefaultCapabilityPlanFiles, findCapabilityPlanGovernanceRecord } = aiService;
const sandboxFile = path.resolve('.cakal-sandbox/tools/unit-capability-plan.md');
const sandboxBackup = `${sandboxFile}.cakal-backup`;

// supabase-js query builder taklidi: select/eq/in/limit zincirlenebilir thenable,
// insert ise catch'siz thenable döner (supabase builder'da .catch yoktur).
function createSupabaseMock({ gaps = [], proposals = [] } = {}) {
  const inserts = [];
  const client = {
    inserts,
    from(table) {
      const rows = table === 'capability_gaps' ? gaps : table === 'expansion_proposals' ? proposals : [];
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        limit(count) {
          builder._limit = count;
          return builder;
        },
        insert(payload) {
          inserts.push({ table, payload });
          return {
            then(resolve) {
              resolve({ error: null });
            },
          };
        },
        then(resolve) {
          resolve({ data: rows.slice(0, builder._limit || rows.length), error: null });
        },
      };
      return builder;
    },
  };
  return client;
}

afterEach(() => {
  for (const file of [sandboxFile, sandboxBackup]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

describe('capability plan executor', () => {
  it('builds default sandbox artifacts for an accepted proposal', () => {
    const files = buildDefaultCapabilityPlanFiles({
      capability_name: 'reddit_rss_ingestion',
      title: 'Reddit RSS teknik çözüm önerisi',
      suggestion: 'RSS feed okuyucu ve sinyal skoru üret.',
    });

    expect(files.map((file) => file.file_path)).toEqual([
      '.cakal-sandbox/workflows/reddit_rss_ingestion.md',
      '.cakal-sandbox/tools/reddit_rss_ingestion.md',
      '.cakal-sandbox/prompts/reddit_rss_ingestion.md',
    ]);
  });

  it('writes approved plan files only under sandbox roots', async () => {
    const supabaseClient = createSupabaseMock({
      gaps: [{ id: 'gap-1', status: 'resolved' }],
    });

    const result = await applyCapabilityPlan({
      capability_name: 'unit_capability_plan',
      summary: 'Unit test sandbox write.',
      files: [
        {
          file_path: '.cakal-sandbox/tools/unit-capability-plan.md',
          mode: 'overwrite',
          content: '# Unit Capability Plan\n\nSandbox write is active.\n',
        },
      ],
    }, { supabaseClient });

    expect(result.success).toBe(true);
    expect(result.files_written).toHaveLength(1);
    expect(result.governance.gap_id).toBe('gap-1');
    expect(fs.readFileSync(sandboxFile, 'utf-8')).toContain('Sandbox write is active');
  });

  it('rejects capability plan writes outside sandbox roots', async () => {
    const result = await applyCapabilityPlan({
      capability_name: 'unsafe_plan',
      summary: 'Should be blocked.',
      files: [
        {
          file_path: 'packages/sources/unsafe/src/index.ts',
          content: 'export {};',
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('GÜVENLİK');
  });

  it('blocks plan application when no gap or proposal record exists', async () => {
    const supabaseClient = createSupabaseMock({ gaps: [], proposals: [] });

    const result = await applyCapabilityPlan({
      capability_name: 'weather_api_integration',
      summary: 'LLM planı, governance kaydı yok.',
      files: [
        {
          file_path: '.cakal-sandbox/tools/unit-capability-plan.md',
          mode: 'overwrite',
          content: '# Should never be written\n',
        },
      ],
    }, { supabaseClient });

    expect(result.success).toBe(false);
    expect(result.error_code).toBe('GOVERNANCE_REQUIRED');
    expect(result.message).toContain('propose_capability_fix');
    expect(fs.existsSync(sandboxFile)).toBe(false);
  });

  it('blocks plan application without a database connection (fail closed)', async () => {
    const result = await applyCapabilityPlan({
      capability_name: 'unit_capability_plan',
      summary: 'No supabase client available.',
      files: [
        {
          file_path: '.cakal-sandbox/tools/unit-capability-plan.md',
          mode: 'overwrite',
          content: '# Should never be written\n',
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error_code).toBe('GOVERNANCE_REQUIRED');
    expect(fs.existsSync(sandboxFile)).toBe(false);
  });

  it('authorizes via pending or accepted proposal when no gap row exists', async () => {
    const supabaseClient = createSupabaseMock({
      proposals: [{ id: 'prop-7', status: 'pending' }],
    });

    const governance = await findCapabilityPlanGovernanceRecord('unit_capability_plan', supabaseClient);
    expect(governance.authorized).toBe(true);
    expect(governance.proposal.id).toBe('prop-7');
  });

  it('does not crash when Supabase insert returns a thenable without catch', async () => {
    const supabaseClient = createSupabaseMock({
      gaps: [{ id: 'gap-2', status: 'proposed' }],
    });

    const result = await applyCapabilityPlan({
      capability_name: 'unit_capability_plan',
      summary: 'Unit test sandbox write with Supabase logging.',
      files: [
        {
          file_path: '.cakal-sandbox/tools/unit-capability-plan.md',
          mode: 'overwrite',
          content: '# Unit Capability Plan\n\nSandbox write is active.\n',
        },
      ],
    }, { supabaseClient });

    expect(result.success).toBe(true);
    expect(supabaseClient.inserts).toHaveLength(1);
    expect(supabaseClient.inserts[0].table).toBe('evolution_log');
  });
});
