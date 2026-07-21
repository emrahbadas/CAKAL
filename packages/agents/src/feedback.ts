import type { AgentRunResult, FeedbackOutcome } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Feedback Agent — Geri Bildirim Ajanı
 *
 * Her öneride sonucu öğrenmek zorundadır. Kullanıcıyı yormadan sorar:
 * kullandım mı, ne oldu, tekrar ister misin?
 */
export class FeedbackAgent extends BaseAgent {
  readonly name = 'feedback' as const;
  readonly description = 'Öneri sonuçlarını takip eder, geri bildirim toplar';

  async run(input: AgentInput, _context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      const opportunityId = input.data?.opportunityId as string;
      const outcome = input.data?.outcome as FeedbackOutcome | undefined;

      if (outcome && opportunityId) {
        // Record feedback
        return this.buildResult(true, {
          action: 'feedback_recorded',
          opportunityId,
          outcome,
          message: this.generateFollowUp(outcome),
        }, startTime);
      }

      // Generate feedback request
      return this.buildResult(true, {
        action: 'feedback_requested',
        message: 'Son önerimle ilgili ne oldu? Aldın mı, kâr ettin mi?',
        options: ['profit', 'loss', 'neutral', 'skipped'],
      }, startTime);
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  private generateFollowUp(outcome: FeedbackOutcome): string {
    switch (outcome) {
      case 'profit':
        return 'Harika! Bu pattern\'i güçlendiriyorum. Benzeri gelirse haber veririm.';
      case 'loss':
        return 'Anlaşıldı, bu stratejiyi zayıflatıyorum. Ne ters gitti detay verirsen daha iyi öğrenirim.';
      case 'neutral':
        return 'Not aldım. Bu tür fırsatları izlemeye devam edelim mi?';
      case 'skipped':
        return 'Tamam, geçtin. Sebebini bilmem gelecek öneriler için faydalı olur.';
      default:
        return 'Geri bildirim kaydedildi.';
    }
  }
}
