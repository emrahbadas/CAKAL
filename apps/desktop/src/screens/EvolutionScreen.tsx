import { useState, useEffect } from 'react';
import {
  Database,
  Code2,
  RotateCcw,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Cpu,
  Shield,
  Table2,
  Terminal,
  FolderTree,
  Activity,
  Clock,
  Zap,
} from 'lucide-react';

interface DDLLogEntry {
  id: string;
  ddl_sql: string;
  ddl_type: string;
  target_table: string | null;
  reason: string;
  rollback_sql: string | null;
  status: string;
  approved_by: string;
  executed_at: string;
}

interface EvolutionLogEntry {
  id: string;
  evolution_type: string;
  target_path: string | null;
  title: string;
  description: string | null;
  diff_content: string | null;
  generated_code: string | null;
  test_result: string | null;
  status: string;
  model_used: string | null;
  git_branch: string | null;
  git_commit?: string | null;
  proposed_at: string;
  applied_at: string | null;
}

interface ModelConfig {
  [task: string]: string;
}

interface AgentRunEntry {
  id: string;
  agent_name: string;
  run_type: string;
  status: string;
  duration_ms: number | null;
  items_found: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  started_at: string;
}

type TabKey = 'overview' | 'agent-runs' | 'ddl' | 'code-evolution';

const DDL_TYPE_LABELS: Record<string, string> = {
  CREATE_TABLE: 'Tablo Oluştur',
  ALTER_TABLE: 'Tablo Güncelle',
  DROP_TABLE: 'Tablo Sil',
  CREATE_INDEX: 'İndeks',
  OTHER: 'Diğer',
};

const EVOLUTION_TYPE_LABELS: Record<string, string> = {
  new_module: 'Yeni Modül',
  modify_module: 'Modül Güncelle',
  new_tool: 'Yeni Tool',
  prompt_update: 'Prompt Güncelle',
  config_change: 'Konfig Değişikliği',
};

const STATUS_STYLES: Record<string, string> = {
  executed: 'bg-emerald-500/15 text-emerald-400',
  rolled_back: 'bg-red-500/15 text-red-400',
  failed: 'bg-red-500/15 text-red-400',
  pending: 'bg-amber-500/15 text-amber-400',
  proposed: 'bg-amber-500/15 text-amber-400',
  approved: 'bg-blue-500/15 text-blue-400',
  applied: 'bg-emerald-500/15 text-emerald-400',
  rejected: 'bg-red-500/15 text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  executed: 'Çalıştırıldı',
  rolled_back: 'Geri Alındı',
  failed: 'Hatalı',
  pending: 'Bekliyor',
  proposed: 'Önerildi',
  approved: 'Onaylandı',
  applied: 'Uygulandı',
  rejected: 'Reddedildi',
};

export default function EvolutionScreen() {
  const [ddlLog, setDdlLog] = useState<DDLLogEntry[]>([]);
  const [evolutionLog, setEvolutionLog] = useState<EvolutionLogEntry[]>([]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({});
  const [agentRuns, setAgentRuns] = useState<AgentRunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [expandedDDL, setExpandedDDL] = useState<string | null>(null);
  const [expandedEvo, setExpandedEvo] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const fetchAll = async () => {
    setLoading(true);
    const [ddlRes, evoRes, modelRes, runsRes] = await Promise.all([
      window.cakalAPI.getEvolutionDDLLog(),
      window.cakalAPI.getEvolutionLog(),
      window.cakalAPI.getModelConfig(),
      window.cakalAPI.getAgentRuns?.({ limit: 30 }) ?? Promise.resolve({ data: [] }),
    ]);
    if (ddlRes.data) setDdlLog(ddlRes.data as DDLLogEntry[]);
    if (evoRes.data) setEvolutionLog(evoRes.data as EvolutionLogEntry[]);
    if (modelRes.data) setModelConfig(modelRes.data as ModelConfig);
    if (runsRes?.data) setAgentRuns(runsRes.data as AgentRunEntry[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleRollback = async (id: string) => {
    setRollingBack(id);
    setFeedback(null);
    const res = await window.cakalAPI.rollbackDDL(id);
    setRollingBack(null);
    if (res.status === 'ok') {
      setFeedback({ ok: true, msg: 'DDL geri alındı' });
      fetchAll();
    } else {
      setFeedback({ ok: false, msg: res.error || 'Rollback hatası' });
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleEvolutionResponse = async (id: string, response: 'approved' | 'rejected') => {
    setRespondingId(id);
    await window.cakalAPI.respondCode(id, response);
    await fetchAll();
    setRespondingId(null);
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

  const fmtDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'overview', label: 'Genel', icon: <Cpu className="h-3.5 w-3.5" /> },
    { key: 'agent-runs', label: 'Ajan Logları', icon: <Activity className="h-3.5 w-3.5" />, count: agentRuns.length },
    { key: 'ddl', label: 'DDL Geçmişi', icon: <Shield className="h-3.5 w-3.5" />, count: ddlLog.length },
    { key: 'code-evolution', label: 'Kod Evrimi', icon: <Code2 className="h-3.5 w-3.5" />, count: evolutionLog.length },
  ];

  // İstatistikler
  const stats = {
    totalRuns: agentRuns.length,
    successRuns: agentRuns.filter(r => r.status === 'success').length,
    errorRuns: agentRuns.filter(r => r.status === 'error').length,
    avgDuration: agentRuns.filter(r => r.duration_ms).reduce((s, r) => s + (r.duration_ms || 0), 0) / (agentRuns.filter(r => r.duration_ms).length || 1),
    selfDevActions: evolutionLog.filter(e => ['new_module', 'modify_module', 'new_tool', 'terminal_exec'].includes(e.evolution_type)).length,
    appliedEvolutions: evolutionLog.filter(e => e.status === 'applied').length,
    proposedEvolutions: evolutionLog.filter(e => e.status === 'proposed').length,
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <Database className="h-5 w-5 text-amber-500" />
          Evrim Motoru
        </h1>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-amber-500/50 hover:text-amber-400"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      {feedback && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
          feedback.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {feedback.ok ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {feedback.msg}
        </div>
      )}

      {/* ====== Tab Bar ====== */}
      <div className="flex gap-1 mb-5 border-b border-zinc-800 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-zinc-800 text-amber-400 border-b-2 border-amber-500'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="max-w-5xl">

        {/* ====== TAB: Overview ====== */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* İstatistikler */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
                <Activity className="h-5 w-5 text-blue-400 mx-auto mb-1" />
                <div className="text-2xl font-bold text-zinc-200">{stats.totalRuns}</div>
                <div className="text-xs text-zinc-500">Toplam Ajan Çalışma</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
                <CheckCircle className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                <div className="text-2xl font-bold text-emerald-400">{stats.successRuns}</div>
                <div className="text-xs text-zinc-500">Başarılı</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
                <Zap className="h-5 w-5 text-amber-400 mx-auto mb-1" />
                <div className="text-2xl font-bold text-zinc-200">{stats.appliedEvolutions}</div>
                <div className="text-xs text-zinc-500">Uygulanan Evrim</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
                <Clock className="h-5 w-5 text-purple-400 mx-auto mb-1" />
                <div className="text-2xl font-bold text-zinc-200">{fmtDuration(stats.avgDuration)}</div>
                <div className="text-xs text-zinc-500">Ort. Süre</div>
              </div>
            </div>

            {/* Bekleyen Onaylar */}
            {stats.proposedEvolutions > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-400 mb-3">
                  <AlertCircle className="h-4 w-4" /> {stats.proposedEvolutions} Bekleyen Onay
                </h3>
                <div className="space-y-2">
                  {evolutionLog.filter(e => e.status === 'proposed').map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                      <div>
                        <span className="text-sm text-zinc-200">{entry.title}</span>
                        <span className="text-xs text-zinc-500 block">{entry.target_path}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEvolutionResponse(entry.id, 'approved')}
                          disabled={respondingId === entry.id}
                          className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          <ThumbsUp className="h-3 w-3" /> Onayla
                        </button>
                        <button
                          onClick={() => handleEvolutionResponse(entry.id, 'rejected')}
                          disabled={respondingId === entry.id}
                          className="flex items-center gap-1 rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          <ThumbsDown className="h-3 w-3" /> Reddet
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Model Router Config */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                <Cpu className="h-4 w-4" /> Model Yönlendirici
              </h2>
              {Object.keys(modelConfig).length === 0 ? (
                <p className="text-sm text-zinc-600">Model konfigürasyonu yüklenemedi</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(modelConfig).map(([task, model]) => (
                    <div key={task} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/50 px-3 py-2">
                      <span className="text-sm text-zinc-300 capitalize">{task.replace(/_/g, ' ')}</span>
                      <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400 font-mono">
                        {model}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Son Self-Dev Aksiyonları */}
            {stats.selfDevActions > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                  <Terminal className="h-4 w-4" /> Son Self-Dev Aksiyonları
                </h2>
                <div className="space-y-2">
                  {evolutionLog
                    .filter(e => ['new_module', 'modify_module', 'new_tool', 'terminal_exec'].includes(e.evolution_type))
                    .slice(0, 5)
                    .map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/30 p-2.5">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${
                          entry.status === 'applied' ? 'bg-emerald-400' : entry.status === 'rejected' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-zinc-300 block truncate">{entry.title}</span>
                          <span className="text-xs text-zinc-600">{entry.target_path}</span>
                        </div>
                        <span className="text-xs text-zinc-600 shrink-0">{fmtDate(entry.proposed_at)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====== TAB: Agent Runs ====== */}
        {activeTab === 'agent-runs' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              <Activity className="h-4 w-4" /> Ajan Çalışma Logları
              <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500 font-mono normal-case">
                {agentRuns.length} kayıt
              </span>
            </h2>

            {agentRuns.length === 0 ? (
              <p className="text-sm text-zinc-600">Henüz ajan çalışma logu yok. Cron veya sohbetten ajan tetiklendiğinde burada görünecek.</p>
            ) : (
              <div className="space-y-2">
                {agentRuns.map((run) => (
                  <div key={run.id} className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                          run.status === 'success' ? 'bg-emerald-400' : run.status === 'error' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'
                        }`} />
                        <div className="min-w-0">
                          <span className="text-sm text-zinc-200 block">
                            <span className="font-medium text-amber-400/80">{run.agent_name}</span>
                            <span className="text-zinc-600 mx-1">·</span>
                            <span className="text-zinc-400">{run.run_type}</span>
                          </span>
                          {run.error_message && (
                            <span className="text-xs text-red-400/80 block truncate">{run.error_message}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {run.items_found !== null && (
                          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400 font-mono">
                            {run.items_found} bulgu
                          </span>
                        )}
                        <span className="text-xs text-zinc-600 font-mono">{fmtDuration(run.duration_ms)}</span>
                        <span className="text-xs text-zinc-600">{fmtDate(run.started_at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ====== TAB: DDL Log ====== */}
        {activeTab === 'ddl' && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            <Shield className="h-4 w-4" /> DDL Geçmişi
            <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500 font-mono normal-case">
              {ddlLog.length} kayıt
            </span>
          </h2>

          {ddlLog.length === 0 ? (
            <p className="text-sm text-zinc-600">Henüz DDL işlemi yok. Çakal sohbette schema değişikliği yapınca burada görünecek.</p>
          ) : (
            <div className="space-y-2">
              {ddlLog.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Table2 className="h-4 w-4 text-zinc-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm text-zinc-200 block truncate">
                          {DDL_TYPE_LABELS[entry.ddl_type] || entry.ddl_type}
                          {entry.target_table && (
                            <span className="text-zinc-500 ml-1">→ {entry.target_table}</span>
                          )}
                        </span>
                        <span className="text-xs text-zinc-600 block truncate">{entry.reason}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-zinc-600">{fmtDate(entry.executed_at)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[entry.status] || 'bg-zinc-800 text-zinc-500'}`}>
                        {STATUS_LABELS[entry.status] || entry.status}
                      </span>
                    </div>
                  </div>

                  {/* Expand/Collapse SQL */}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => setExpandedDDL(expandedDDL === entry.id ? null : entry.id)}
                      className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
                    >
                      {expandedDDL === entry.id ? '▾ SQL Gizle' : '▸ SQL Göster'}
                    </button>
                    {entry.status === 'executed' && entry.rollback_sql && (
                      <button
                        onClick={() => handleRollback(entry.id)}
                        disabled={rollingBack === entry.id}
                        className="flex items-center gap-1 rounded-md bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {rollingBack === entry.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Geri Al
                      </button>
                    )}
                  </div>

                  {expandedDDL === entry.id && (
                    <div className="mt-2 space-y-2">
                      <pre className="rounded-md bg-zinc-950 p-2 text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap">
                        {entry.ddl_sql}
                      </pre>
                      {entry.rollback_sql && (
                        <>
                          <p className="text-xs text-zinc-600">Rollback SQL:</p>
                          <pre className="rounded-md bg-zinc-950 p-2 text-xs text-red-400/80 font-mono overflow-x-auto whitespace-pre-wrap">
                            {entry.rollback_sql}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* ====== TAB: Code Evolution ====== */}
        {activeTab === 'code-evolution' && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            <Code2 className="h-4 w-4" /> Kod Evrim Geçmişi
            <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500 font-mono normal-case">
              {evolutionLog.length} kayıt
            </span>
          </h2>

          {evolutionLog.length === 0 ? (
            <p className="text-sm text-zinc-600">Henüz kod evrimi yok. Çakal'dan modül/tool oluşturmasını isteyince burada görünecek.</p>
          ) : (
            <div className="space-y-2">
              {evolutionLog.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-zinc-200 block">{entry.title}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                          {EVOLUTION_TYPE_LABELS[entry.evolution_type] || entry.evolution_type}
                        </span>
                        {entry.model_used && (
                          <span className="text-xs text-zinc-600 font-mono">{entry.model_used}</span>
                        )}
                        {entry.target_path && (
                          <span className="text-xs text-zinc-600 truncate max-w-[200px]">{entry.target_path}</span>
                        )}
                      </div>
                      {entry.description && (
                        <span className="text-xs text-zinc-500 block mt-1">{entry.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-zinc-600">{fmtDate(entry.proposed_at)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[entry.status] || 'bg-zinc-800 text-zinc-500'}`}>
                        {STATUS_LABELS[entry.status] || entry.status}
                      </span>
                    </div>
                  </div>

                  {/* Expand code/diff */}
                  {(entry.generated_code || entry.diff_content) && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedEvo(expandedEvo === entry.id ? null : entry.id)}
                        className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
                      >
                        {expandedEvo === entry.id ? '▾ Kod Gizle' : '▸ Kodu Göster'}
                      </button>

                      {expandedEvo === entry.id && (
                        <div className="mt-2 space-y-2">
                          {entry.diff_content && (
                            <pre className="rounded-md bg-zinc-950 p-2 text-xs text-amber-400/80 font-mono overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
                              {entry.diff_content}
                            </pre>
                          )}
                          {entry.generated_code && (
                            <pre className="rounded-md bg-zinc-950 p-2 text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
                              {entry.generated_code}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Test result badge */}
                  {entry.test_result && (
                    <span className={`inline-block mt-1.5 rounded-full px-2 py-0.5 text-xs ${
                      entry.test_result === 'passed' ? 'bg-emerald-500/15 text-emerald-400'
                        : entry.test_result === 'failed' ? 'bg-red-500/15 text-red-400'
                        : 'bg-zinc-700 text-zinc-500'
                    }`}>
                      Test: {entry.test_result === 'passed' ? 'Geçti ✓' : entry.test_result === 'failed' ? 'Başarısız ✗' : 'Atlandı'}
                    </span>
                  )}

                  {/* Approve/Reject for proposed items */}
                  {entry.status === 'proposed' && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleEvolutionResponse(entry.id, 'approved')}
                        disabled={respondingId === entry.id}
                        className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {respondingId === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                        Onayla
                      </button>
                      <button
                        onClick={() => handleEvolutionResponse(entry.id, 'rejected')}
                        disabled={respondingId === entry.id}
                        className="flex items-center gap-1 rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {respondingId === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}
                        Reddet
                      </button>
                    </div>
                  )}

                  {/* Git info */}
                  {(entry.git_branch || entry.git_commit) && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-600">
                      {entry.git_branch && <span>🌿 {entry.git_branch}</span>}
                      {entry.git_commit && <span className="font-mono">{entry.git_commit.slice(0, 8)}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

      </div>
    </div>
  );
}
