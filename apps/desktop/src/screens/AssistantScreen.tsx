import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Brain,
  CheckCircle,
  Cpu,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  ShieldAlert,
} from 'lucide-react';

interface Profile {
  learning_score?: number;
  engagement_score?: number;
  preferred_domains?: string[];
  successful_patterns?: string[];
  blocked_patterns?: string[];
}

interface CapabilityGap {
  id: string;
  capability_name: string;
  trigger_count: number;
  context: string | null;
  status: string;
  first_triggered_at: string;
  last_triggered_at: string;
  capability_description?: string;
  capability_status?: string;
  capability_category?: string | null;
  required_config?: Record<string, unknown>;
  required_config_summary?: string;
  gap_summary?: string;
  missing_reason?: string;
  remediation_steps?: string[];
  approval_request?: string;
}

interface ExpansionProposal {
  id: string;
  capability_name: string;
  title: string;
  description: string | null;
  suggestion: string | null;
  status: string;
  proposed_at: string;
  user_response: string | null;
}

interface Capability {
  capability_name: string;
  description: string;
  status: string;
  category: string;
  required_config?: Record<string, unknown>;
}

function pct(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function labelForLearning(score: number) {
  if (score >= 80) return 'Usta asistan';
  if (score >= 60) return 'Güçlü öğrenen';
  if (score >= 40) return 'Gelişen';
  if (score >= 20) return 'Başlangıç';
  return 'Yeni';
}

export default function AssistantScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gaps, setGaps] = useState<CapabilityGap[]>([]);
  const [proposals, setProposals] = useState<ExpansionProposal[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedGapId, setSelectedGapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const [profileRes, gapsRes, proposalsRes, capsRes] = await Promise.all([
      window.cakalAPI.getProfile(),
      window.cakalAPI.checkCapabilityGaps(),
      window.cakalAPI.getExpansionProposals({ status: 'pending', limit: 20 }),
      window.cakalAPI.getCapabilities(),
    ]);

    if (profileRes.data) setProfile(profileRes.data as Profile);
    if (gapsRes.data) setGaps(gapsRes.data as CapabilityGap[]);
    if (proposalsRes.data) setProposals(proposalsRes.data as ExpansionProposal[]);
    if (capsRes.data) setCapabilities(capsRes.data as Capability[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const learningScore = profile?.learning_score ?? profile?.engagement_score ?? 0;

  const selectedGap = useMemo(() => {
    if (!gaps.length) return null;
    return gaps.find((gap) => gap.id === selectedGapId) || gaps[0];
  }, [gaps, selectedGapId]);

  useEffect(() => {
    if (!selectedGap && gaps.length > 0) {
      setSelectedGapId(gaps[0].id);
    }
  }, [gaps, selectedGap]);

  const refreshTech = async () => {
    setBusyAction('refresh');
    await fetchData();
    setBusyAction(null);
  };

  const generateProposal = async (capabilityName: string) => {
    setBusyAction(`generate:${capabilityName}`);
    await window.cakalAPI.generateProposal(capabilityName);
    await fetchData();
    setBusyAction(null);
  };

  const answerProposal = async (proposalId: string, response: 'accepted' | 'rejected') => {
    setBusyAction(`${response}:${proposalId}`);
    await window.cakalAPI.respondToProposal(proposalId, response, response === 'accepted' ? 'Asistan onayı verildi' : 'Asistan önerisi reddedildi');
    await fetchData();
    setBusyAction(null);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
            <Sparkles className="h-5 w-5 text-fuchsia-400" />
            Asistan Merkezi
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Sistem eksik yeteneği gördüğünde bunun ne olduğunu, neyin eksik olduğunu ve onay verildiğinde ne yapılacağını burada açıkça anlatır.
          </p>
        </div>
        <button
          onClick={refreshTech}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-fuchsia-500/50 hover:text-fuchsia-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Öğrenme Skoru</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="text-3xl font-bold text-fuchsia-400">{pct(learningScore)}</div>
            <Brain className="h-5 w-5 text-fuchsia-400" />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{labelForLearning(learningScore)}</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Açık Gap</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="text-3xl font-bold text-amber-400">{gaps.length}</div>
            <ShieldAlert className="h-5 w-5 text-amber-400" />
          </div>
          <p className="mt-2 text-xs text-zinc-500">Onay bekleyen eksik yetenekler</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Bekleyen Öneri</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="text-3xl font-bold text-cyan-400">{proposals.length}</div>
            <Cpu className="h-5 w-5 text-cyan-400" />
          </div>
          <p className="mt-2 text-xs text-zinc-500">Yorumlanabilir teknik aksiyonlar</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Aktif Kapsam</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="text-3xl font-bold text-emerald-400">{capabilities.length}</div>
            <Wrench className="h-5 w-5 text-emerald-400" />
          </div>
          <p className="mt-2 text-xs text-zinc-500">Sistemin bilinen yetenekleri</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              Gap Listesi
            </h2>
            <span className="text-[10px] text-zinc-500">{gaps.length}</span>
          </div>

          {gaps.length > 0 ? (
            <div className="space-y-2">
              {gaps.map((gap) => {
                const isActive = selectedGap?.id === gap.id;
                return (
                  <button
                    key={gap.id}
                    onClick={() => setSelectedGapId(gap.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      isActive
                        ? 'border-fuchsia-500/40 bg-fuchsia-500/10'
                        : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm text-zinc-100">{gap.capability_name}</div>
                        <div className="mt-1 text-[11px] text-zinc-500">{gap.gap_summary || gap.context || 'Bağlam bekleniyor'}</div>
                      </div>
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
                        {gap.trigger_count}x
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
              Açık gap yok. Sistem şimdilik eksik yetenek tespit etmedi.
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-fuchsia-400" />
                  Gap Açıklaması
                </h2>
                <p className="mt-1 text-sm text-zinc-500">Seçilen eksik yetenek için neyin eksik olduğunu ve onu kapatmak için ne gerektiğini gösterir.</p>
              </div>
              {selectedGap && (
                <button
                  onClick={() => generateProposal(selectedGap.capability_name)}
                  disabled={busyAction === `generate:${selectedGap.capability_name}`}
                  className="rounded-lg border border-cyan-500/30 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
                >
                  {busyAction === `generate:${selectedGap.capability_name}` ? 'Öneri üretiliyor...' : 'Öneri Üret'}
                </button>
              )}
            </div>

            {selectedGap ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-zinc-100">{selectedGap.capability_name}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {selectedGap.capability_status || 'open'} • {selectedGap.capability_category || 'genel'}
                      </div>
                    </div>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                      {selectedGap.trigger_count} tetik
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300">{selectedGap.capability_description || selectedGap.gap_summary || 'Açıklama yok.'}</p>
                  <p className="mt-3 text-sm text-zinc-500">{selectedGap.missing_reason || 'Eksik neden henüz tanımlı değil.'}</p>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                  <div className="mb-3 text-sm font-medium text-zinc-300 flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-amber-400" />
                    Ne gerekiyor?
                  </div>
                  <p className="text-sm text-zinc-400">{selectedGap.required_config_summary || 'Konfigürasyon bilgisi bekleniyor.'}</p>
                  <div className="mt-4 space-y-2">
                    {(selectedGap.remediation_steps || []).map((step) => (
                      <div key={step} className="flex items-start gap-2 text-sm text-zinc-300">
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-400" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                    {selectedGap.approval_request || 'Onay verilirse gerekli tool / API hazırlığı başlatılır.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
                Detay görmek için soldan bir gap seç.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  Bekleyen Öneriler
                </h2>
                <p className="mt-1 text-sm text-zinc-500">Onaylandıysa yeni entegrasyon veya araç inşa sürecini burada yönetebilirsin.</p>
              </div>
            </div>

            {proposals.length > 0 ? (
              <div className="space-y-3">
                {proposals.map((proposal) => (
                  <div key={proposal.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-base font-medium text-zinc-100">{proposal.title}</div>
                        <div className="mt-1 text-xs text-zinc-500">{proposal.capability_name} • {proposal.status}</div>
                        <p className="mt-2 text-sm text-zinc-300">{proposal.description || 'Açıklama yok.'}</p>
                        {proposal.suggestion && <p className="mt-2 text-sm text-zinc-500">{proposal.suggestion}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => answerProposal(proposal.id, 'accepted')}
                          disabled={busyAction === `accepted:${proposal.id}`}
                          className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          {busyAction === `accepted:${proposal.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />}
                          <span className="ml-1">Onayla</span>
                        </button>
                        <button
                          onClick={() => answerProposal(proposal.id, 'rejected')}
                          disabled={busyAction === `rejected:${proposal.id}`}
                          className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {busyAction === `rejected:${proposal.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsDown className="h-3.5 w-3.5" />}
                          <span className="ml-1">Reddet</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
                Bekleyen öneri yok. Gap yeterince tetiklenirse buraya düşer.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-fuchsia-400" />
              Sadece Okuma Özeti
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <p className="text-xs text-zinc-500">Kazanılan bağlam</p>
                <p className="mt-2 text-sm text-zinc-300">{profile?.preferred_domains?.length || 0} domain, {profile?.successful_patterns?.length || 0} aktif pattern</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <p className="text-xs text-zinc-500">Kısıtlar</p>
                <p className="mt-2 text-sm text-zinc-300">{profile?.blocked_patterns?.length || 0} bloklu pattern</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <p className="text-xs text-zinc-500">Asistan modu</p>
                <p className="mt-2 text-sm text-zinc-300">Eksik araçlar için açıklama, ihtiyaç listesi ve onaylı aksiyon akışı</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
