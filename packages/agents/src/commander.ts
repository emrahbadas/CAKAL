import type { AgentRunResult } from '@cakal/shared-types';
import { BaseAgent, type AgentContext, type AgentInput } from './base';

/**
 * Commander — Konuşma Yöneticisi
 *
 * Kullanıcıyla sohbet eder, ihtiyacı anlar, hangi ajanların devreye gireceğine
 * karar verir, sonuçları toparlayıp sunar.
 */
export class CommanderAgent extends BaseAgent {
  readonly name = 'commander' as const;
  readonly description = 'Konuşma yöneticisi — kullanıcı ihtiyacını anlar ve ajanları yönlendirir';

  private readonly systemPrompt = `Sen "Çakal Çekirdeği" adlı kişisel fırsat motorunun komutanısın.
Görevin:
1. Kullanıcının ihtiyacını anlamak
2. Uygun ajanları devreye almak (fırsat avcısı, arbitraj, finans vb.)
3. Sonuçları sade ve aksiyon odaklı şekilde sunmak

Kurallar:
- Her öneride NEDEN önerdiğini açıkla
- Az ama güçlü öneriler sun (3-5 arası ideal)
- Belirsiz durumlarda risk seviyesini belirt
- Kâr odaklı düşün, salt doğruluk yerine net fayda hesapla
- Türkçe konuş, samimi ama profesyonel ol`;

  async run(input: AgentInput, context: AgentContext): Promise<AgentRunResult> {
    const startTime = Date.now();

    try {
      // Build system prompt with user profile context
      const fullSystemPrompt = this.buildContextualPrompt(context);

      // Determine which agents to invoke based on user message
      const agentsToInvoke = this.routeToAgents(input.message || '');

      return this.buildResult(true, {
        response: `Mesajını aldım. ${agentsToInvoke.length > 0 ? `${agentsToInvoke.join(', ')} ajanlarını devreye alıyorum.` : 'Nasıl yardımcı olabilirim?'}`,
        agentsToInvoke,
        systemPrompt: fullSystemPrompt,
      }, startTime);
    } catch (error) {
      return this.buildResult(false, null, startTime, String(error));
    }
  }

  private buildContextualPrompt(context: AgentContext): string {
    let prompt = this.systemPrompt;

    if (context.userProfile) {
      prompt += `\n\nKullanıcı Profil Özeti:\n${JSON.stringify(context.userProfile, null, 2)}`;
    }

    if (context.recentPatterns && context.recentPatterns.length > 0) {
      prompt += `\n\nSon Başarılı Patternler:\n${JSON.stringify(context.recentPatterns.slice(0, 5))}`;
    }

    return prompt;
  }

  private routeToAgents(message: string): string[] {
    const agents: string[] = [];
    const lower = message.toLowerCase();

    if (/fırsat|fiyat|ucuz|indirim|kampanya|ilan/.test(lower)) {
      agents.push('hunter');
    }
    if (/arbitraj|dışardan|aliexpress|amazon|al.sat/.test(lower)) {
      agents.push('arbitrage');
    }
    if (/finans|döviz|altın|borsa|hisse|kripto/.test(lower)) {
      agents.push('finance');
    }
    if (/acil|nakit|hemen|ucuz.sat/.test(lower)) {
      agents.push('street-hunter');
    }

    return agents;
  }
}
