import type { AgentName, AgentRunResult } from '@cakal/shared-types';

export interface AgentContext {
  userId: string;
  userProfile?: unknown;
  recentPatterns?: unknown[];
  conversationHistory?: unknown[];
}

export interface AgentInput {
  message?: string;
  data?: Record<string, unknown>;
}

export abstract class BaseAgent {
  abstract readonly name: AgentName;
  abstract readonly description: string;

  abstract run(input: AgentInput, context: AgentContext): Promise<AgentRunResult>;

  protected buildResult(
    success: boolean,
    data: unknown,
    startTime: number,
    error?: string
  ): AgentRunResult {
    return {
      agentName: this.name,
      success,
      data,
      error,
      durationMs: Date.now() - startTime,
    };
  }
}
