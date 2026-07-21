import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent } from './base';
import type { AgentContext, AgentInput } from './base';

/**
 * System Conscience Agent — Sprint 7
 *
 * Sistemin eksik yeteneklerini izler, tekrarlanan ihtiyaçları tespit eder
 * ve kullanıcıya yapılandırılmış genişleme önerileri sunar.
 *
 * Aksiyonlar:
 *  - check_gaps: Açık durumdaki yetenek boşluklarını listeler
 *  - generate_proposal: Eşik aşan boşluk için genişleme önerisi üretir
 *  - get_proposals: Bekleyen önerileri listeler
 *  - respond_proposal: Kullanıcı cevabını kaydeder (accept/reject)
 */
export class SystemConscienceAgent extends BaseAgent {
  readonly name = 'system-conscience' as const;
  readonly description =
    'Eksik yetenek tespiti, tetiklenme sayacı ve kullanıcıya genişleme önerisi sunma';

  /** Bir yetenek kaç kez tetiklenince öneri üretilsin */
  static readonly TRIGGER_THRESHOLD = 3;

  /** Haftalık maksimum öneri sayısı */
  static readonly WEEKLY_MAX_PROPOSALS = 1;

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const start = Date.now();
    const action = input.data?.action as string | undefined;
    const supabase = context.userProfile as unknown as { from: (...args: unknown[]) => unknown } | null;

    try {
      switch (action) {
        case 'check_gaps':
          return this.checkGaps(start, input, supabase);
        case 'generate_proposal':
          return this.generateProposal(start, input, supabase);
        case 'get_proposals':
          return this.getProposals(start, input, supabase);
        case 'respond_proposal':
          return this.respondProposal(start, input, supabase);
        default:
          return this.buildResult(true, {
            action: 'info',
            message:
              'System Conscience hazır. Aksiyonlar: check_gaps, generate_proposal, get_proposals, respond_proposal',
          }, start);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return this.buildResult(false, null, start, message);
    }
  }

  private async checkGaps(
    start: number,
    _input: AgentInput,
    _supabase: unknown,
  ): Promise<AgentRunResult> {
    // Main logic lives in main.cjs IPC handler — agent provides structure only
    return this.buildResult(true, {
      action: 'check_gaps',
      message: 'IPC handler üzerinden çalıştır: conscience:check-gaps',
    }, start);
  }

  private async generateProposal(
    start: number,
    input: AgentInput,
    _supabase: unknown,
  ): Promise<AgentRunResult> {
    const capabilityName = input.data?.capabilityName as string;
    if (!capabilityName) {
      return this.buildResult(false, null, start, 'capabilityName gerekli');
    }
    return this.buildResult(true, {
      action: 'generate_proposal',
      capabilityName,
      message: 'IPC handler üzerinden çalıştır: conscience:generate-proposal',
    }, start);
  }

  private async getProposals(
    start: number,
    _input: AgentInput,
    _supabase: unknown,
  ): Promise<AgentRunResult> {
    return this.buildResult(true, {
      action: 'get_proposals',
      message: 'IPC handler üzerinden çalıştır: conscience:get-proposals',
    }, start);
  }

  private async respondProposal(
    start: number,
    input: AgentInput,
    _supabase: unknown,
  ): Promise<AgentRunResult> {
    const proposalId = input.data?.proposalId as string;
    const response = input.data?.response as string;
    if (!proposalId || !response) {
      return this.buildResult(false, null, start, 'proposalId ve response gerekli');
    }
    return this.buildResult(true, {
      action: 'respond_proposal',
      proposalId,
      response,
      message: 'IPC handler üzerinden çalıştır: conscience:respond-proposal',
    }, start);
  }
}
