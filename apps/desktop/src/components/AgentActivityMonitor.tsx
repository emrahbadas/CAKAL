import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Trash2, Activity } from 'lucide-react';

interface ActivityEvent {
  type: string;
  agent?: string;
  message?: string;
  detail?: string;
  tool?: string;
  tools?: string[];
  args?: Record<string, unknown>;
  resultPreview?: string;
  count?: number;
  iteration?: number;
  contentLength?: number;
  indexCount?: number;
  patternCount?: number;
  timestamp: number;
}

const EVENT_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  intent_received: { icon: '📩', color: 'text-blue-400', label: 'Mesaj Alındı' },
  agent_start: { icon: '🚀', color: 'text-amber-400', label: 'Ajan Başlatıldı' },
  profile_loaded: { icon: '👤', color: 'text-cyan-400', label: 'Profil Yüklendi' },
  db_fetch: { icon: '🗄️', color: 'text-zinc-400', label: 'DB Sorgu' },
  db_fetch_done: { icon: '✅', color: 'text-green-400', label: 'DB Sonuç' },
  agent_thinking: { icon: '🧠', color: 'text-purple-400', label: 'Düşünüyor' },
  decision_gate: { icon: '🛑', color: 'text-rose-400', label: 'Karar Kapısı' },
  tool_calls_detected: { icon: '🔧', color: 'text-orange-400', label: 'Tool Tespiti' },
  tool_calling: { icon: '⚡', color: 'text-yellow-400', label: 'Tool Çağrısı' },
  tool_result: { icon: '📋', color: 'text-green-400', label: 'Tool Sonucu' },
  response_ready: { icon: '✨', color: 'text-emerald-400', label: 'Cevap Hazır' },
  error: { icon: '❌', color: 'text-red-400', label: 'Hata' },
  // Events from ai-service.cjs
  llm_start: { icon: '🧠', color: 'text-purple-400', label: 'LLM Başladı' },
  llm_continue: { icon: '🔄', color: 'text-purple-300', label: 'LLM Devam' },
  tool_calls: { icon: '🔧', color: 'text-orange-400', label: 'Tool Çağrıları' },
  tool_call: { icon: '⚡', color: 'text-yellow-400', label: 'Tool Çağrısı' },
  // Sprint 13: Self-evaluation event
  self_evaluation: { icon: '📊', color: 'text-cyan-400', label: 'Strateji Analizi' },
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getEventDescription(ev: ActivityEvent): string {
  switch (ev.type) {
    case 'intent_received':
      return `"${(ev.message || '').substring(0, 60)}${(ev.message || '').length > 60 ? '...' : ''}"`;
    case 'agent_start':
      return `${ev.agent?.toUpperCase()} ajanı devreye girdi`;
    case 'profile_loaded':
      return ev.detail || `Profil: ✓, Index: ${ev.indexCount || 0}, Pattern: ${ev.patternCount || 0}`;
    case 'db_fetch':
    case 'db_fetch_done':
      return ev.detail || '';
    case 'agent_thinking':
      return ev.detail || `${ev.agent} analiz ediyor...`;
    case 'decision_gate':
      return ev.detail || 'Karar kapısı devreye girdi';
    case 'tool_calls_detected':
      return `${ev.count} tool tespit edildi: ${(ev.tools || []).join(', ')}`;
    case 'tool_calling':
      return `${ev.tool}(${ev.args ? Object.keys(ev.args).join(', ') : ''})`;
    case 'tool_result':
      return `${ev.tool} → ${(ev.resultPreview || '').substring(0, 100)}${(ev.resultPreview || '').length > 100 ? '...' : ''}`;
    case 'response_ready':
      return `${ev.agent?.toUpperCase()} cevap üretti (${ev.contentLength || 0} karakter)`;
    case 'error':
      return ev.detail || 'Bilinmeyen hata';
    default:
      return ev.detail || ev.message || '';
  }
}

export default function AgentActivityMonitor() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Clean up any previous listener before registering a new one
    cleanupRef.current?.();

    const unsubscribe = window.cakalAPI.onAgentActivity((ev: unknown) => {
      setEvents((prev) => [...prev.slice(-200), ev as ActivityEvent]);
    });

    cleanupRef.current = typeof unsubscribe === 'function' ? unsubscribe : null;

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, isOpen]);

  const clearEvents = () => setEvents([]);

  return (
    <div className="border-t border-zinc-700 bg-zinc-900/95 backdrop-blur">
      {/* Toggle Bar */}
      <div className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-zinc-400 transition-colors">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-1 items-center gap-2 text-left hover:text-zinc-200 transition-colors"
          aria-expanded={isOpen}
        >
          <Activity className="h-3.5 w-3.5 text-amber-500" />
          <span>Ajan Aktivite Monitörü</span>
          {events.length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">
              {events.length}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <button
              onClick={clearEvents}
              className="text-zinc-500 hover:text-red-400 transition-colors"
              title="Temizle"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label={isOpen ? 'Aktivite monitorunu kapat' : 'Aktivite monitorunu ac'}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Event List */}
      {isOpen && (
        <div className="max-h-56 overflow-y-auto px-4 pb-3 space-y-1">
          {events.length === 0 ? (
            <p className="text-[11px] text-zinc-600 py-2 text-center">
              Henüz aktivite yok. Bir mesaj gönderin.
            </p>
          ) : (
            events.map((ev, i) => {
              const config = EVENT_CONFIG[ev.type] || { icon: '📎', color: 'text-zinc-400', label: ev.type };
              return (
                <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed animate-in fade-in">
                  <span className="shrink-0 w-5 text-center">{config.icon}</span>
                  <span className="shrink-0 text-zinc-600 font-mono w-16">{formatTime(ev.timestamp)}</span>
                  <span className={`shrink-0 font-semibold ${config.color} w-24`}>{config.label}</span>
                  <span className="text-zinc-300 break-all">{getEventDescription(ev)}</span>
                </div>
              );
            })
          )}
          <div ref={scrollRef} />
        </div>
      )}
    </div>
  );
}
