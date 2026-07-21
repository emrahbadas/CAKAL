import type { AgentName, AgentRunResult } from '@cakal/shared-types';
import {
  BaseAgent,
  CommanderAgent,
  OpportunityHunterAgent,
  FeedbackAgent,
  ProfileKeeperAgent,
  PatternExtractorAgent,
  ArbitrageAgent,
  StreetHunterAgent,
  FinanceWatcherAgent,
  TravelHunterAgent,
  OpportunityJudgeAgent,
  type AgentContext,
  type AgentInput,
} from '@cakal/agents';

/**
 * Agent Orchestrator
 *
 * Ajanları yönetir, sıralı veya paralel çalıştırır,
 * sonuçları birleştirir ve Commander'a geri gönderir.
 */
export class AgentOrchestrator {
  private agents: Map<AgentName, BaseAgent> = new Map();

  constructor() {
    this.registerAgent(new CommanderAgent());
    this.registerAgent(new OpportunityHunterAgent());
    this.registerAgent(new FeedbackAgent());
    this.registerAgent(new ProfileKeeperAgent());
    this.registerAgent(new PatternExtractorAgent());
    this.registerAgent(new ArbitrageAgent());
    this.registerAgent(new StreetHunterAgent());
    this.registerAgent(new FinanceWatcherAgent());
    this.registerAgent(new TravelHunterAgent());
    this.registerAgent(new OpportunityJudgeAgent());
  }

  private registerAgent(agent: BaseAgent) {
    this.agents.set(agent.name, agent);
  }

  async runAgent(
    name: AgentName,
    input: AgentInput,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const agent = this.agents.get(name);
    if (!agent) {
      return {
        agentName: name,
        success: false,
        error: `Agent "${name}" not found`,
        durationMs: 0,
      };
    }

    try {
      const result = await agent.run(input, context);

      // If commander returns agents to invoke, run them
      if (name === 'commander' && result.data) {
        const data = result.data as { agentsToInvoke?: string[] };
        if (data.agentsToInvoke && data.agentsToInvoke.length > 0) {
          const subResults = await this.runMultiple(
            data.agentsToInvoke as AgentName[],
            input,
            context
          );
          return {
            ...result,
            data: { ...data, subResults },
          };
        }
      }

      return result;
    } catch (error) {
      return {
        agentName: name,
        success: false,
        error: String(error),
        durationMs: 0,
      };
    }
  }

  async runMultiple(
    names: AgentName[],
    input: AgentInput,
    context: AgentContext
  ): Promise<AgentRunResult[]> {
    const promises = names
      .filter((name) => this.agents.has(name))
      .map((name) => this.runAgent(name, input, context));

    return Promise.all(promises);
  }

  getAgentStatus(name: AgentName): 'active' | 'disabled' | 'not-found' {
    if (!this.agents.has(name)) return 'not-found';
    return 'active';
  }

  listAgents(): Array<{ name: AgentName; description: string }> {
    return Array.from(this.agents.values()).map((a) => ({
      name: a.name,
      description: a.description,
    }));
  }
}
