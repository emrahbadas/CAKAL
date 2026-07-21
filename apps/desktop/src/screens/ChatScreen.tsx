import { useState, useEffect, useRef } from 'react';
import { Send, RefreshCw, Paperclip, X, ShieldAlert, Mic } from 'lucide-react';
import VoiceAssistant, { VoiceAssistantHandle } from '../components/VoiceAssistant';
import { useChatStore } from '../state/chatStore';
import OpportunityCard from '../components/OpportunityCard';
import AgentActivityMonitor from '../components/AgentActivityMonitor';
import ChartRenderer, { parseChartsFromContent, ChartConfig } from '../components/ChartRenderer';
import WidgetRenderer from '../components/WidgetRenderer';
import { parseWidgetsFromContent } from '../components/widget-parser';
import { isCommercePipelineIntent } from '../state/intentRouting';
import { subscribeAutoContinue } from '../state/autoContinue';

function toNum(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTRY(value: unknown) {
  const num = toNum(value);
  if (num === null) return '-';
  return `₺${Math.round(num).toLocaleString('tr-TR')}`;
}

function summarizeSourceBlock(value: unknown) {
  if (!value || typeof value !== 'object') return 'bilinmiyor';
  const block = value as Record<string, unknown>;

  if (typeof block.success === 'boolean') {
    const count = toNum(block.count ?? block.totalListings) ?? 0;
    return `${block.success ? 'ok' : 'hata'} (${count})`;
  }

  const entries = Object.values(block).filter(
    (item) => item && typeof item === 'object' && 'count' in (item as Record<string, unknown>),
  ) as Array<Record<string, unknown>>;

  if (entries.length === 0) return 'bilinmiyor';
  const total = entries.reduce((sum, item) => sum + (toNum(item.count) ?? 0), 0);
  const okCount = entries.filter((item) => item.success !== false).length;
  return `ok kaynak ${okCount}/${entries.length}, kayıt ${total}`;
}

function formatCommercePipelineMessage(payload: unknown) {
  const data = (payload || {}) as Record<string, unknown>;
  const strategy = (data.strategy || {}) as Record<string, unknown>;
  const diagnostics = (data.diagnostics || {}) as Record<string, unknown>;
  const topOpportunity = (strategy.topOpportunity || null) as Record<string, unknown> | null;
  const topEconomics = topOpportunity ? ((topOpportunity.unitEconomics || {}) as Record<string, unknown>) : null;
  const topPricing = topOpportunity ? ((topOpportunity.pricing || {}) as Record<string, unknown>) : null;
  const topCosts = topOpportunity ? ((topOpportunity.costTable || {}) as Record<string, unknown>) : null;

  const lines: string[] = [];
  lines.push('**Commerce Vision Pipeline tamamlandı**');
  lines.push(`Sorgu: ${String(data.query || '-')}`);
  lines.push(`Aday sayısı: ${toNum(diagnostics.candidateCount) ?? toNum((data.candidates as unknown[])?.length) ?? 0}`);
  lines.push(`Tarama: hedef ${toNum(diagnostics.targetListings) ?? 0} / Çin ${toNum(diagnostics.chinaListings) ?? 0}`);
  lines.push('');

  if (topOpportunity) {
    lines.push(`**Top fırsat:** ${String(topOpportunity.productName || 'Belirlenemedi')}`);
    lines.push(`Skor: ${toNum(topEconomics?.opportunityScore) ?? '-'} / 100`);
    lines.push(`Net marj: ${toNum(topEconomics?.netMarginPercent) ?? '-'}%`);
    lines.push(`Net kâr: ${formatTRY(topEconomics?.netProfitTRY)}`);
    lines.push(`Break-even satış: ${formatTRY(topPricing?.breakEvenSellPriceTRY)}`);
    lines.push(`Önerilen satış: ${formatTRY(topPricing?.recommendedSellPriceTRY)}`);
    lines.push(`Toplam maliyet: ${formatTRY(topCosts?.totalCostTRY)}`);
    lines.push('');
  }

  lines.push(`**Strateji kararı:** ${String(strategy.strategyVerdict || '-')}`);

  const recommendations = Array.isArray(strategy.recommendations)
    ? (strategy.recommendations as string[]).slice(0, 4)
    : [];
  if (recommendations.length > 0) {
    lines.push('Öneriler:');
    for (const recommendation of recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  const sources = (data.sources || {}) as Record<string, unknown>;
  lines.push('');
  lines.push('Kaynak özeti:');
  lines.push(`- hedef pazarlar: ${summarizeSourceBlock(sources.target)}`);
  lines.push(`- AliExpress: ${summarizeSourceBlock(sources.aliexpress)}`);
  lines.push(`- Alibaba: ${summarizeSourceBlock(sources.alibaba)}`);
  lines.push(`- 1688: ${summarizeSourceBlock(sources['1688'])}`);

  const chinaMethod = Array.isArray(data.chinaResearchMethod)
    ? (data.chinaResearchMethod as string[])
    : [];
  if (chinaMethod.length > 0) {
    lines.push('');
    lines.push('Çin pazar araştırma yöntemi:');
    for (const item of chinaMethod) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

// Uzun süren isteklerde kullanıcıyı bilgilendiren aşamalı yükleme durumu.
// Kısa isteklerde sade "Araştırıyorum..." kalır; süre uzadıkça mesaj derinleşir
// ve canlı ajan aktivitesi + geçen süre gösterilir.
const LOADING_STAGES: Array<{ afterSeconds: number; text: string }> = [
  { afterSeconds: 0, text: 'Araştırıyorum...' },
  { afterSeconds: 8, text: 'Derin analiz gerekiyor — veri kaynaklarını tarıyorum...' },
  { afterSeconds: 30, text: 'Bu cevap derin düşünme gerektiriyor, biraz zaman alabilir. Veriler toplanıyor...' },
  { afterSeconds: 120, text: 'Kapsamlı piyasa taraması sürüyor — geniş taramalar birkaç dakika alabilir. Arka planda çalışmaya devam ediyorum.' },
];

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}dk ${seconds}sn` : `${seconds}sn`;
}

function LoadingStatus() {
  const [elapsed, setElapsed] = useState(0);
  const [lastActivity, setLastActivity] = useState('');

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    const cleanup = window.cakalAPI.onAgentActivity?.((event) => {
      const text = String(event?.detail || event?.message || '');
      if (text) setLastActivity(text.length > 90 ? `${text.slice(0, 90)}…` : text);
    });

    return () => {
      clearInterval(timer);
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  const stage = [...LOADING_STAGES].reverse().find((s) => elapsed >= s.afterSeconds) || LOADING_STAGES[0];

  return (
    <div className="rounded-2xl border border-zinc-700/80 bg-zinc-900/85 px-4 py-3 text-sm text-zinc-400">
      <div className="flex items-center gap-2">
        <span className="animate-pulse">{stage.text}</span>
        {elapsed >= 8 && (
          <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-500">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
      {elapsed >= 8 && lastActivity && (
        <div className="mt-1.5 truncate text-[11px] text-zinc-600">⚡ {lastActivity}</div>
      )}
    </div>
  );
}

const IMG_MARKER_RE = /^__IMG__([\s\S]*?)__ENDIMG__/;

// **kalın** işaretlemesini XSS'e açık dangerouslySetInnerHTML yerine
// React element'leriyle işler; içerikteki HTML asla DOM'a enjekte edilmez.
function renderBoldSegments(line: string) {
  const segments = line.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((segment, i) =>
    segment.startsWith('**') && segment.endsWith('**') && segment.length > 4 ? (
      <strong key={i}>{segment.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{segment}</span>
    ),
  );
}

function formatMessage(content: string) {
  const imgMatch = content.match(IMG_MARKER_RE);
  const textPart = imgMatch ? content.slice(imgMatch[0].length).trimStart() : content;
  const parts = textPart.split('\n');
  return (
    <>
      {imgMatch && (
        <img
          src={imgMatch[1]}
          alt="ek görsel"
          className="mb-2 max-h-48 max-w-full rounded-lg object-contain"
        />
      )}
      {parts.map((line, i) => (
        <span key={i}>
          {renderBoldSegments(line)}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function MessageContent({ content }: { content: string }) {
  // First parse widgets (iframe-based HTML), then charts (Recharts JSON)
  const { text: afterWidgets, widgets } = parseWidgetsFromContent(content);
  const { text, charts } = parseChartsFromContent(afterWidgets);
  return (
    <>
      {text && <div className="whitespace-pre-wrap break-words">{formatMessage(text)}</div>}
      {widgets.map((w, i) => (
        <WidgetRenderer key={`widget-${i}`} html={w.html} title={w.title} />
      ))}
      {charts.map((chart, i) => (
        <ChartRenderer key={`chart-${i}`} config={chart} />
      ))}
    </>
  );
}

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [gaps, setGaps] = useState<Array<Record<string, unknown>>>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voiceRef = useRef<VoiceAssistantHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { messages, opportunities, addMessage, addOpportunity, setLoading, isLoading } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAttachedImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const saveMsg = (msg: { id: string; role: 'user' | 'assistant'; content: string; timestamp?: number }) => {
    window.cakalAPI.saveMessage(msg).catch((err: unknown) =>
      console.error('[Chat] DB save error:', err),
    );
  };

  const loadOpportunities = async () => {
    try {
      const result = await window.cakalAPI.getOpportunities();
      const items = (result?.data as any[]) || [];
      items.slice(0, 20).forEach((opp: any) => {
        const exists = opportunities.find((o) => o.id === opp.id);
        if (!exists) {
          addOpportunity({
            id: opp.id,
            title: opp.title,
            description: opp.description || '',
            category: opp.category || 'diger',
            score: opp.score || 50,
            expectedProfit: opp.expected_profit ? `₺${opp.expected_profit}` : '-',
            timeframe: opp.urgency || 'medium',
            source: opp.source || '',
            url: opp.source_url || undefined,
            createdAt: new Date(opp.created_at).getTime(),
          });
        }
      });
    } catch (err) {
      console.error('Failed to load opportunities:', err);
    }
  };

  const loadGaps = async () => {
    try {
      const result = await window.cakalAPI.checkCapabilityGaps();
      setGaps(((result?.data as Array<Record<string, unknown>>) || []).slice(0, 6));
    } catch {
      setGaps([]);
    }
  };

  useEffect(() => {
    loadOpportunities();
    loadGaps();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Ortak gönderim akışı — hem klavyeden hem sesli asistandan gelen mesajlar
  // buradan geçer. Sesli asistan açıksa cevap TTS ile okunur (yalnızca okuma;
  // yazılı mesajlar için STT hiç devreye girmez).
  const submitMessage = async (text: string, displayContent?: string) => {
    if (!text || isLoading) return;
    const userMsgId = crypto.randomUUID();
    const userTimestamp = Date.now();
    const content = displayContent ?? text;
    addMessage({ id: userMsgId, role: 'user', content, timestamp: userTimestamp });
    saveMsg({ id: userMsgId, role: 'user', content, timestamp: userTimestamp });
    setLoading(true);

    try {
      if (isCommercePipelineIntent(text) && window.cakalAPI.runCommerceAutoPipeline) {
        try {
          const pipelineResult = await window.cakalAPI.runCommerceAutoPipeline({ message: text });
          const pipeline = (pipelineResult || {}) as { status?: string; response?: unknown; error?: string };

          if (pipeline.status === 'ok' && pipeline.response) {
            const pipelineContent = formatCommercePipelineMessage(pipeline.response);
            const assistantMsg = { id: crypto.randomUUID(), role: 'assistant' as const, content: pipelineContent, timestamp: Date.now() };
            addMessage(assistantMsg);
            saveMsg(assistantMsg);
            voiceRef.current?.speak(pipelineContent);
            await loadOpportunities();
            return;
          }
        } catch (pipelineError) {
          // Auto-pipeline başarısız olsa bile sohbeti kesme; commander fallback ile devam et.
          console.warn('Commerce auto pipeline failed, falling back to commander:', pipelineError);
        }
      }

      const result = await window.cakalAPI.runAgent('commander', { message: text });
      const assistantContent = (result as { response?: string })?.response || 'Anlaşıldı, araştırıyorum...';
      const assistantMsg = { id: crypto.randomUUID(), role: 'assistant' as const, content: assistantContent, timestamp: Date.now() };
      addMessage(assistantMsg);
      saveMsg(assistantMsg);
      voiceRef.current?.speak(assistantContent);
      // Refresh opportunities — AI might have saved new ones
      await loadOpportunities();
      await loadGaps();
    } catch {
      const errMsg = { id: crypto.randomUUID(), role: 'assistant' as const, content: 'Bir hata oluştu. Tekrar deneyin.', timestamp: Date.now() };
      addMessage(errMsg);
      saveMsg(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // Otonom entegrasyon: secret girilince Layout'un kuyruğa koyduğu
  // [OTOMATİK DEVAM] mesajını normal gönderim akışından geçir.
  // submitRef her render'da tazelenir; listener stale closure görmez.
  const submitRef = useRef(submitMessage);
  useEffect(() => {
    submitRef.current = submitMessage;
  });

  useEffect(() => {
    return subscribeAutoContinue((payload) => {
      submitRef.current(payload.text, payload.display);
    });
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text && !attachedImage) return;
    if (isLoading) return;

    // Upload image to Supabase Storage first, fall back to base64 if unavailable
    let imageUrl = '';
    if (attachedImage) {
      try {
        const uploadResult = await window.cakalAPI.uploadChatImage(attachedImage);
        imageUrl = uploadResult.status === 'ok' && uploadResult.url ? uploadResult.url : attachedImage;
      } catch {
        imageUrl = attachedImage; // fallback to base64
      }
    }

    const imagePrefix = imageUrl ? `__IMG__${imageUrl}__ENDIMG__\n` : '';
    setInput('');
    setAttachedImage(null);
    await submitMessage(text, `${imagePrefix}${text}`);
  };

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.08),transparent_28%),linear-gradient(180deg,rgba(9,9,11,0.98),rgba(9,9,11,1))]">
      {/* Chat Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-zinc-800/80 bg-zinc-950/60 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-zinc-50">Çakal Çekirdeği</h1>
              <p className="text-sm text-zinc-500">Kişisel Fırsat Motoru</p>
            </div>
            <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
              Enter gönderir · Shift+Enter yeni satır
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 space-y-4 select-text">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center shadow-2xl shadow-black/20">
                <p className="text-2xl font-bold text-amber-400 mb-2">Hoş geldin, Çakal.</p>
                <p className="text-zinc-400 leading-7">
                  Fırsat aramak, pazar analizi yapmak veya strateji konuşmak için yaz.
                </p>
                <p className="mt-4 text-xs text-zinc-600">
                  Örnek: “flight_search eksikse teşhis et” ya da “ucuz laptop fırsatlarını tarat”.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[78%] rounded-2xl border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words select-text shadow-lg shadow-black/10 ${
                  msg.role === 'user'
                    ? 'border-amber-500/20 bg-amber-500/12 text-amber-50'
                    : 'border-zinc-700/80 bg-zinc-900/85 text-zinc-100'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  <span>{msg.role === 'user' ? 'Sen' : 'Çakal'}</span>
                  <span className="normal-case tracking-normal text-zinc-600">{formatTime(msg.timestamp)}</span>
                </div>
                {msg.role === 'assistant' ? <MessageContent content={msg.content} /> : <div className="whitespace-pre-wrap break-words">{msg.content}</div>}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <LoadingStatus />
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        <div className="border-t border-zinc-800/80 bg-zinc-950/60 px-6 py-4 backdrop-blur-sm">
          {attachedImage && (
            <div className="mb-3 flex items-start gap-2">
              <div className="relative">
                <img
                  src={attachedImage}
                  alt="ek"
                  className="h-16 w-16 rounded-lg object-cover border border-zinc-700"
                />
                <button
                  onClick={() => setAttachedImage(null)}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-600 text-zinc-200 hover:bg-zinc-500"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Resim ekle"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-400"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Fırsat ara, strateji sor..."
              rows={1}
              className="flex-1 max-h-40 min-h-11 resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-100 placeholder-zinc-500 outline-none overflow-y-auto focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/25 select-text whitespace-pre-wrap"
            />
            <button
              onClick={() => setVoiceOpen(true)}
              title="Sesli asistan"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                voiceOpen
                  ? 'border-fuchsia-500/70 bg-fuchsia-500/15 text-fuchsia-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-fuchsia-500/50 hover:text-fuchsia-300'
              }`}
            >
              <Mic className="h-4 w-4" />
            </button>
            <button
              onClick={handleSend}
              disabled={isLoading}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-600">
            Metin seçip kopyalayabilirsin. Uzun yanıtlar otomatik satır kırar.
          </p>
        </div>

        {/* Agent Activity Monitor */}
        <AgentActivityMonitor />
      </div>

      {/* Right Panel — Active Opportunities */}
      <div className="w-80 shrink-0 border-l border-zinc-800/80 overflow-y-auto overflow-x-hidden p-4 bg-zinc-950/40">
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              GAP Açıklaması
            </h2>
            <button
              onClick={loadGaps}
              className="text-zinc-500 hover:text-amber-400 transition-colors"
              title="Gap yenile"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {gaps.length === 0 ? (
            <p className="text-xs text-zinc-600">Açık teknik gap yok.</p>
          ) : (
            <div className="space-y-2 select-text">
              {gaps.map((gap) => (
                <div key={String(gap.id)} className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-3">
                  <p className="text-xs text-zinc-300">{String(gap.capability_name || 'unknown')}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {String(gap.gap_summary || gap.missing_reason || gap.context || 'Teşhis bekleniyor')}
                  </p>
                  <p className="mt-1 text-[10px] text-amber-400">tetik: {String(gap.trigger_count || 0)}x</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Aktif Fırsatlar
          </h2>
          <button
            onClick={loadOpportunities}
            className="text-zinc-500 hover:text-amber-400 transition-colors"
            title="Yenile"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {opportunities.length === 0 ? (
          <p className="text-sm text-zinc-600">Henüz fırsat yok. Sohbet ederek başla.</p>
        ) : (
          <div className="space-y-3 select-text">
            {opportunities.map((opp) => (
              <OpportunityCard key={opp.id} opportunity={opp} />
            ))}
          </div>
        )}
      </div>

      {/* Sesli Asistan Overlay — kapalıyken unmount: mic + STT/TTS tamamen durur */}
      {voiceOpen && (
        <VoiceAssistant
          ref={voiceRef}
          busy={isLoading}
          onClose={() => setVoiceOpen(false)}
          onTranscript={(text) => submitMessage(text)}
        />
      )}
    </div>
  );
}
