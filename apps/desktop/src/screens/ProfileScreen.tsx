import { useEffect, useState } from 'react';
import { RefreshCw, Brain, Zap, TrendingUp, AlertTriangle, ShieldAlert, Wrench, KeyRound, Sparkles } from 'lucide-react';

interface Profile {
  risk_tolerance: string;
  decision_speed: string;
  learning_score?: number;
  engagement_score: number;
  total_profit: number;
  total_loss: number;
  avg_margin: number;
  transaction_count: number;
  preferred_domains: string[];
  successful_patterns: string[];
  blocked_patterns: string[];
}

interface WeeklyReport {
  characterSummary: string;
  strengths: string[];
  improvements: string[];
  topCategory: string;
  riskAssessment: string;
  weeklyScore: number;
  recommendedActions: string[];
}

interface IndexEntry {
  id: string;
  entry_type: string;
  entry_key: string;
  entry_value: Record<string, unknown>;
  confidence: number;
  source: string;
  created_at: string;
}

interface CapabilityGap {
  id: string;
  capability_name: string;
  trigger_count: number;
  context: string | null;
  status: string;
  first_triggered_at: string;
  last_triggered_at: string;
}

interface ExpansionProposal {
  id: string;
  capability_name: string;
  title: string;
  description: string | null;
  suggestion: string | null;
  status: string;
  proposed_at: string;
  user_response?: string | null;
}

interface CapabilityDef {
  capability_name?: string;
  capabilityName?: string;
  description?: string;
  required_config?: Record<string, unknown>;
  requiredConfig?: Record<string, unknown>;
  status?: string;
  category?: string;
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [patterns, setPatterns] = useState<Array<Record<string, unknown>>>([]);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [indexEntries, setIndexEntries] = useState<IndexEntry[]>([]);
  const [capabilityGaps, setCapabilityGaps] = useState<CapabilityGap[]>([]);
  const [proposals, setProposals] = useState<ExpansionProposal[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [techLoading, setTechLoading] = useState(false);
  const [techAction, setTechAction] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const [profileRes, patternsRes, indexRes, eventsRes, gapsRes, proposalsRes, capsRes] = await Promise.all([
      window.cakalAPI.getProfile(),
      window.cakalAPI.getStrategyPatterns(),
      window.cakalAPI.getUserIndex({ limit: 20 }),
      window.cakalAPI.getProfileEvents({ event_type: 'weekly_report', limit: 1 }),
      window.cakalAPI.checkCapabilityGaps(),
      window.cakalAPI.getExpansionProposals({ status: 'pending', limit: 20 }),
      window.cakalAPI.getCapabilities(),
    ]);
    if (profileRes.data) setProfile(profileRes.data as Profile);
    if (patternsRes.data) setPatterns(patternsRes.data as Array<Record<string, unknown>>);
    if (indexRes.data) setIndexEntries((indexRes.data as IndexEntry[]) || []);
    if (gapsRes.data) setCapabilityGaps((gapsRes.data as CapabilityGap[]) || []);
    if (proposalsRes.data) setProposals((proposalsRes.data as ExpansionProposal[]) || []);
    if (capsRes.data) setCapabilities((capsRes.data as CapabilityDef[]) || []);
    // Load last weekly report from profile events
    const events = (eventsRes.data as Array<Record<string, unknown>>) || [];
    if (events.length > 0 && events[0].event_data) {
      setWeeklyReport(events[0].event_data as WeeklyReport);
    }
    setLoading(false);
  };

  const generateWeeklyReport = async () => {
    setReportLoading(true);
    const res = await window.cakalAPI.weeklyReport();
    if (res.data) setWeeklyReport(res.data as WeeklyReport);
    setReportLoading(false);
  };

  const refreshTechView = async () => {
    setTechLoading(true);
    const [gapsRes, proposalsRes, capsRes] = await Promise.all([
      window.cakalAPI.checkCapabilityGaps(),
      window.cakalAPI.getExpansionProposals({ status: 'pending', limit: 20 }),
      window.cakalAPI.getCapabilities(),
    ]);
    if (gapsRes.data) setCapabilityGaps((gapsRes.data as CapabilityGap[]) || []);
    if (proposalsRes.data) setProposals((proposalsRes.data as ExpansionProposal[]) || []);
    if (capsRes.data) setCapabilities((capsRes.data as CapabilityDef[]) || []);
    setTechLoading(false);
  };

  const createProposal = async (capabilityName: string) => {
    setTechAction(`proposal:${capabilityName}`);
    await window.cakalAPI.generateProposal(capabilityName);
    await refreshTechView();
    setTechAction(null);
  };

  const resolveProposal = async (proposalId: string, response: 'accepted' | 'rejected') => {
    setTechAction(`${response}:${proposalId}`);
    await window.cakalAPI.respondToProposal(proposalId, response, response === 'accepted' ? 'Onaylandı' : 'Reddedildi');
    await refreshTechView();
    setTechAction(null);
  };

  useEffect(() => { fetchData(); }, []);

  const riskValue = profile?.risk_tolerance === 'high' ? 80 : profile?.risk_tolerance === 'medium' ? 50 : 25;
  const speedValue = profile?.decision_speed === 'fast' ? 75 : 30;
  const learningValue = profile?.learning_score ?? profile?.engagement_score ?? 0;

  const activePatterns = patterns.filter(p => p.status === 'active');
  const onHoldPatterns = patterns.filter(p => p.status === 'on-hold');
  const weakPatterns = patterns.filter(p => p.status === 'weakened');

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Kullanıcı Profili</h1>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-amber-500/50 hover:text-amber-400"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Character Map */}
        <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Karakter Haritası
          </h2>
          <div className="space-y-4">
            <ProfileBar label="Öğrenme Skoru" value={learningValue} color="bg-fuchsia-500" detail={learningValue >= 70 ? 'Yüksek' : learningValue >= 40 ? 'Orta' : 'Başlangıç'} />
            <ProfileBar label="Risk Toleransı" value={riskValue} color="bg-amber-500" detail={profile?.risk_tolerance || '—'} />
            <ProfileBar label="Karar Hızı" value={speedValue} color="bg-blue-500" detail={profile?.decision_speed || '—'} />
            <ProfileBar label="Etkileşim Skoru" value={profile?.engagement_score || 0} color="bg-emerald-500" />
          </div>
          {profile?.preferred_domains && profile.preferred_domains.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-zinc-500 mb-2">İlgi Alanları:</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.preferred_domains.map((d) => (
                  <span key={d} className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-400">{d}</span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-zinc-600">
            Profile Keeper ajana yeterli veri topladıkça bu harita otomatik güncellenir.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Performans
          </h2>
          <div className="space-y-3 text-sm text-zinc-500">
            <p>İşlem sayısı: <span className="text-zinc-200">{profile?.transaction_count || 0}</span></p>
            <p>Toplam kâr: <span className="text-emerald-400">₺{(profile?.total_profit || 0).toLocaleString('tr-TR')}</span></p>
            <p>Toplam zarar: <span className="text-red-400">₺{(profile?.total_loss || 0).toLocaleString('tr-TR')}</span></p>
            <p>Ort. marj: <span className="text-zinc-200">%{profile?.avg_margin || 0}</span></p>
            <hr className="border-zinc-800" />
            <p>Net: <span className={
              (profile?.total_profit || 0) - (profile?.total_loss || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
            }>
              ₺{((profile?.total_profit || 0) - (profile?.total_loss || 0)).toLocaleString('tr-TR')}
            </span></p>
          </div>
        </div>
      </div>

      {/* Technical Readiness / Gap Diagnosis */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Teknik Hazırlık ve Gap Teşhisi
          </h2>
          <button
            onClick={refreshTechView}
            disabled={techLoading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${techLoading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>

        <p className="text-xs text-zinc-500 mb-4">
          Sistem bir yetenek eksikliği algıladığında bunu gap olarak işaretler, onaya göre tool/migration/API anahtarı önerisi üretir.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <Wrench className="h-4 w-4 text-amber-400" />
                Açık Gap’ler
              </h3>
              <span className="text-[10px] text-zinc-500">{capabilityGaps.length}</span>
            </div>
            {capabilityGaps.length > 0 ? (
              <div className="space-y-3">
                {capabilityGaps.slice(0, 6).map((gap) => {
                  const capDef = capabilities.find((cap) => (cap.capability_name || cap.capabilityName) === gap.capability_name);
                  const requiredConfig = capDef?.required_config || capDef?.requiredConfig;
                  return (
                    <div key={gap.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-zinc-200">{gap.capability_name}</p>
                          <p className="text-[11px] text-zinc-500">Tetiklenme: {gap.trigger_count} • Durum: {gap.status}</p>
                        </div>
                        <button
                          onClick={() => createProposal(gap.capability_name)}
                          disabled={techAction === `proposal:${gap.capability_name}`}
                          className="rounded-lg border border-cyan-500/30 px-3 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
                        >
                          {techAction === `proposal:${gap.capability_name}` ? 'Öneriliyor...' : 'Onaylı Öneri'}
                        </button>
                      </div>
                      {gap.context && <p className="mt-2 text-[11px] text-zinc-500">Bağlam: {gap.context}</p>}
                      {capDef?.description && <p className="mt-1 text-[11px] text-zinc-400">{capDef.description}</p>}
                      {requiredConfig && Object.keys(requiredConfig).length > 0 && (
                        <p className="mt-1 text-[11px] text-amber-300/80 flex items-center gap-1">
                          <KeyRound className="h-3 w-3" /> Gerekli: {Object.values(requiredConfig).map(String).join(' • ')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-zinc-600">Açık gap yok. Sistem şu an mevcut yeteneklerle çalışıyor.</p>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-fuchsia-400" />
                Bekleyen Öneriler
              </h3>
              <span className="text-[10px] text-zinc-500">{proposals.length}</span>
            </div>
            {proposals.length > 0 ? (
              <div className="space-y-3">
                {proposals.slice(0, 6).map((proposal) => (
                  <div key={proposal.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-zinc-200">{proposal.title}</p>
                        <p className="text-[11px] text-zinc-500">{proposal.capability_name} • {proposal.status}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => resolveProposal(proposal.id, 'accepted')}
                          disabled={techAction === `accepted:${proposal.id}`}
                          className="rounded-lg border border-emerald-500/30 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          Onayla
                        </button>
                        <button
                          onClick={() => resolveProposal(proposal.id, 'rejected')}
                          disabled={techAction === `rejected:${proposal.id}`}
                          className="rounded-lg border border-red-500/30 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Reddet
                        </button>
                      </div>
                    </div>
                    {proposal.description && <p className="mt-2 text-[11px] text-zinc-500">{proposal.description}</p>}
                    {proposal.suggestion && <p className="mt-1 text-[11px] text-zinc-400">{proposal.suggestion}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-600">Bekleyen teknik öneri yok. Gap oluştuğunda burada görünür.</p>
            )}
          </div>
        </div>
      </div>

      {/* Weekly Character Report */}
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Haftalık Karakter Raporu
          </h2>
          <button
            onClick={generateWeeklyReport}
            disabled={reportLoading}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
          >
            <Zap className={`h-3 w-3 ${reportLoading ? 'animate-pulse' : ''}`} />
            {reportLoading ? 'Analiz ediliyor...' : 'Rapor Üret'}
          </button>
        </div>

        {weeklyReport ? (
          <div className="space-y-4">
            {/* Score + Summary */}
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 flex flex-col items-center justify-center rounded-xl bg-zinc-800 p-3 min-w-[80px]">
                <span className={`text-2xl font-bold ${weeklyReport.weeklyScore >= 70 ? 'text-emerald-400' : weeklyReport.weeklyScore >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                  {weeklyReport.weeklyScore}
                </span>
                <span className="text-[10px] text-zinc-500 mt-0.5">/ 100</span>
              </div>
              <div>
                <p className="text-sm text-zinc-300 leading-relaxed">{weeklyReport.characterSummary}</p>
                {weeklyReport.topCategory && (
                  <p className="mt-1 text-xs text-zinc-500">En aktif kategori: <span className="text-amber-400">{weeklyReport.topCategory}</span></p>
                )}
              </div>
            </div>

            {/* Strengths + Improvements */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-emerald-400 mb-1.5 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Güçlü Yanlar</p>
                <ul className="space-y-1">
                  {weeklyReport.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-zinc-400">• {s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs text-amber-400 mb-1.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Geliştirilecek</p>
                <ul className="space-y-1">
                  {weeklyReport.improvements.map((s, i) => (
                    <li key={i} className="text-xs text-zinc-400">• {s}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Risk Assessment */}
            {weeklyReport.riskAssessment && (
              <p className="text-xs text-zinc-500 border-t border-zinc-800 pt-3">
                🎯 Risk: <span className="text-zinc-400">{weeklyReport.riskAssessment}</span>
              </p>
            )}

            {/* Recommended Actions */}
            {weeklyReport.recommendedActions && weeklyReport.recommendedActions.length > 0 && (
              <div className="border-t border-zinc-800 pt-3">
                <p className="text-xs text-zinc-500 mb-1">Önerilen Aksiyonlar:</p>
                <div className="flex flex-wrap gap-1.5">
                  {weeklyReport.recommendedActions.map((a, i) => (
                    <span key={i} className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs text-blue-400">{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-600">Henüz haftalık rapor üretilmedi. Rapor üretmek için butona tıklayın.</p>
        )}
      </div>

      {/* User Index Entries */}
      {indexEntries.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Kullanıcı İndeksi (Son Sinyaller)
          </h2>
          <div className="space-y-2">
            {indexEntries.slice(0, 10).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-xs border-b border-zinc-800/50 pb-1.5">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    entry.entry_type === 'success_signal' ? 'bg-emerald-500' :
                    entry.entry_type === 'risk_signal' ? 'bg-red-500' :
                    entry.entry_type === 'preference' ? 'bg-blue-500' :
                    entry.entry_type === 'interest' ? 'bg-amber-500' : 'bg-zinc-500'
                  }`} />
                  <span className="text-zinc-400">{entry.entry_key.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-600">{Math.round(entry.confidence * 100)}%</span>
                  <span className="text-zinc-700 text-[10px]">{new Date(entry.created_at).toLocaleDateString('tr-TR')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patterns */}
      <div className="mt-6 grid grid-cols-3 gap-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-emerald-400 uppercase tracking-wider">
            Başarılı Patternler
          </h2>
          {activePatterns.length > 0 ? (
            <div className="space-y-2">
              {activePatterns.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300 truncate mr-2" title={p.description as string}>{p.name as string}</span>
                  <span className="text-xs text-emerald-400 whitespace-nowrap">{Math.round((p.confidence as number) * 100)}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">Henüz pattern tespit edilmedi.</p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-amber-400 uppercase tracking-wider">
            Öğrenilen Patternler
          </h2>
          {onHoldPatterns.length > 0 ? (
            <div className="space-y-2">
              {onHoldPatterns.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300 truncate mr-2" title={p.description as string}>{p.name as string}</span>
                  <span className="text-xs text-amber-400 whitespace-nowrap">{Math.round((p.confidence as number) * 100)}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">Henüz öğrenilen pattern yok.</p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-red-400 uppercase tracking-wider">
            Engellenen Patternler
          </h2>
          {weakPatterns.length > 0 ? (
            <div className="space-y-2">
              {weakPatterns.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300 truncate mr-2" title={p.description as string}>{p.name as string}</span>
                  <span className="text-xs text-red-400">zayıflatıldı</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">Henüz engellenen pattern yok.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileBar({ label, value, color, detail }: { label: string; value: number; color: string; detail?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300">{detail || `${value}%`}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800">
        <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
