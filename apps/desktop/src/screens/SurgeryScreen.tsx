import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, RefreshCw, GitMerge, FileDiff } from 'lucide-react';
import SurgeonChat from '../components/SurgeonChat';

// ─── Cerrahi Bakım — diff inceleme ve onaylı merge ───
// Kullanıcının "yanlış gideni göremiyorum" derdinin çözümü: cerrahın ürettiği
// değişiklik inmeden önce kapı sonucu + diff burada gösterilir.
// Merge kararı ÇAKAL'a veya cerraha ait değildir; bu ekrandan kullanıcı verir.

type Severity = 'BLOCK' | 'REVIEW' | 'INFO';
type Verdict = 'PASS' | 'REVIEW' | 'BLOCK' | 'ERROR';

interface Finding {
  severity: Severity;
  code: string;
  message: string;
  files?: string[];
  details?: string[];
}

interface Gate {
  verdict: Verdict;
  exitCode: number;
  stats: { filesChanged: number; insertions: number; deletions: number };
  checks: Record<string, string>;
  findings: Finding[];
  files: { status: string; file: string }[];
}

interface Branch {
  branch: string;
  subject: string;
}

interface ChangeRequest {
  changeRequestId: string;
  originalUserRequest: string;
  cakalInterpretation: string | null;
  createdAt: string;
}

interface SurgeryEvent {
  type: string;
  detail?: string;
  ts: number;
}

const api = () => (window as any).cakalAPI;

const VERDICT_STYLE: Record<Verdict, { cls: string; label: string; Icon: typeof ShieldCheck }> = {
  PASS: { cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', label: 'ONAYA HAZIR', Icon: ShieldCheck },
  REVIEW: { cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10', label: 'İNCELEME GEREKLİ', Icon: ShieldQuestion },
  BLOCK: { cls: 'text-red-400 border-red-500/30 bg-red-500/10', label: 'BLOKE', Icon: ShieldAlert },
  ERROR: { cls: 'text-red-400 border-red-500/30 bg-red-500/10', label: 'KAPI HATASI', Icon: ShieldAlert },
};

const SEVERITY_STYLE: Record<Severity, string> = {
  BLOCK: 'border-red-500/40 bg-red-500/5 text-red-300',
  REVIEW: 'border-amber-500/40 bg-amber-500/5 text-amber-300',
  INFO: 'border-zinc-700 bg-zinc-800/40 text-zinc-300',
};

function DiffView({ text }: { text: string }) {
  return (
    <pre className="max-h-[28rem] overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed">
      {text.split('\n').map((line, i) => {
        let cls = 'text-zinc-400';
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-zinc-500';
        else if (line.startsWith('+')) cls = 'text-emerald-400';
        else if (line.startsWith('-')) cls = 'text-red-400';
        else if (line.startsWith('@@')) cls = 'text-cyan-400';
        else if (line.startsWith('diff --git')) cls = 'text-amber-400 font-semibold';
        return <div key={i} className={cls}>{line || ' '}</div>;
      })}
    </pre>
  );
}

export default function SurgeryScreen() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [gate, setGate] = useState<Gate | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [diffNote, setDiffNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Varsayılan KAPALI: açıkken dala tıklamak npm test + typecheck tetikliyor
  // ve bu ~1 dakika sürüyor. Kullanıcı hızlı bakmak isteyebilmeli; ağır
  // doğrulama merge anında zaten zorunlu olarak koşuyor.
  const [verify, setVerify] = useState(false);

  // ── Cerrahi oturum durumu ──
  const [auth, setAuth] = useState<{ checked: boolean; authenticated: boolean; error?: string }>({ checked: false, authenticated: false });
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [sessionStatus, setSessionStatus] = useState<string>('IDLE');
  const [events, setEvents] = useState<SurgeryEvent[]>([]);
  const [loginCode, setLoginCode] = useState<{ code: string; url: string } | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState<string>('');
  // Sohbet oturumu bir talebe bağlanabilir; boşsa serbest oturum açılır.
  const [chatRequestId, setChatRequestId] = useState<string | null>(null);
  // loadBranches bu bileşende olay dinleyicisinden SONRA tanımlanıyor (TDZ).
  // Ref üzerinden çağırmak, tanım sırasını değiştirmeden erişim sağlar.
  const loadBranchesRef = useRef<(() => void) | null>(null);

  // Durum main process'te yaşar; bileşen açılışta ORADAN hidrasyon yapar.
  // Aksi halde sekme değiştirince state sıfırlanıyor ve kullanıcıya süreç
  // durmuş gibi görünüyordu (gerçekte main'de çalışmaya devam ediyordu).
  const loadSession = useCallback(async () => {
    const [reqRes, statusRes] = await Promise.all([
      api()?.surgeryListRequests(),
      api()?.surgerySessionStatus(),
    ]);
    setRequests(reqRes?.requests || []);
    setSessionStatus(statusRes?.status || 'IDLE');
    if (statusRes?.authenticated !== undefined) {
      setAuth({ checked: true, authenticated: Boolean(statusRes.authenticated) });
    }
    if (Array.isArray(statusRes?.events) && statusRes.events.length > 0) {
      setEvents(statusRes.events);
    }
  }, []);

  const loadModels = useCallback(async () => {
    const res = await api()?.surgeryListModels();
    if (res?.models?.length) {
      setModels(res.models);
      setModel((current) => current || res.defaultModel || res.models[0].id);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    setBusy('Copilot bağlantısı kontrol ediliyor...');
    try {
      const res = await api()?.surgeryAuthStatus();
      setAuth({ checked: true, authenticated: Boolean(res?.authenticated), error: res?.error });
    } finally {
      setBusy(null);
    }
  }, []);

  const startLogin = useCallback(async () => {
    setLoggingIn(true);
    setLoginCode(null);
    setMessage(null);
    try {
      const res = await api()?.surgeryLoginStart();
      if (res?.ok) {
        setMessage('GitHub girişi tamamlandı.');
        await checkAuth();
      } else {
        setMessage(`Giriş tamamlanmadı: ${res?.error || 'bilinmeyen'}`);
      }
    } finally {
      setLoggingIn(false);
      setLoginCode(null);
    }
  }, [checkAuth]);

  const cancelLogin = useCallback(async () => {
    await api()?.surgeryLoginCancel();
    setLoggingIn(false);
    setLoginCode(null);
  }, []);

  // Canlı cerrahi olayları
  useEffect(() => {
    const off = api()?.onSurgeryActivity?.((e: SurgeryEvent) => {
      setEvents((prev) => [...prev.slice(-60), e]);
      if (e.type === 'login_code' && (e as any).code) {
        setLoginCode({ code: (e as any).code, url: (e as any).url });
      }
      if (e.type === 'login_finished' || e.type === 'login_cancelled') setLoginCode(null);
      if ([
        'surgery_started', 'surgery_awaiting_review', 'surgery_failed', 'surgery_aborted',
        'request_registered', 'chat_started', 'chat_ended', 'chat_failed', 'chat_apply_merged',
      ].includes(e.type)) {
        loadSession();
        if (e.type === 'chat_apply_merged') loadBranchesRef.current?.();
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, [loadSession]);

  useEffect(() => { loadSession(); }, [loadSession]);
  useEffect(() => { if (auth.authenticated && models.length === 0) loadModels(); }, [auth.authenticated, models.length, loadModels]);

  const abortSurgery = useCallback(async () => {
    await api()?.surgeryAbort();
    await loadSession();
    setMessage('Cerrahi iptal edildi. Çalışma alanı inceleme için korundu.');
  }, [loadSession]);

  const loadBranches = useCallback(async () => {
    setBusy('Dallar yükleniyor...');
    try {
      const res = await api()?.surgeryListBranches();
      setBranches(res?.branches || []);
      if (!res?.success) setMessage(res?.error || 'Dallar okunamadı.');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { loadBranches(); }, [loadBranches]);
  useEffect(() => { loadBranchesRef.current = loadBranches; }, [loadBranches]);

  // loadBranches'ten SONRA tanımlanır: bağımlılık dizisi render anında
  // değerlendirildiği için, önce tanımlanırsa TDZ hatası verir.
  const startSurgery = useCallback(async (changeRequestId: string, summary: string) => {
    const ok = window.confirm(
      'CERRAHİ BAŞLATILACAK\n\n' +
      `Talep: ${summary}\n\n` +
      'Kodlama ajanı ayrı bir çalışma alanında (worktree) çalışacak.\n' +
      'Canlı uygulama dizinine dokunulmayacak.\n' +
      'İş bitince diff\'i burada onaylayacaksın.\n\nBaşlatılsın mı?'
    );
    if (!ok) return;

    setEvents([]);
    setBusy('Cerrahi çalışıyor — bu birkaç dakika sürebilir...');
    try {
      const res = await api()?.surgeryStart({ changeRequestId, model: model || undefined });
      if (res?.success) {
        setMessage(`Cerrahi tamamlandı: ${res.branch} — ${res.surgeonStatus} (${res.rejectedCount ?? 0} izin reddi). Aşağıdan incele.`);
        await loadBranches();
      } else {
        setMessage(`Cerrahi başarısız: ${res?.error || 'bilinmeyen hata'}`);
      }
      await loadSession();
    } finally {
      setBusy(null);
    }
  }, [loadSession, loadBranches, model]);

  const inspect = useCallback(async (branch: string) => {
    setSelected(branch);
    setGate(null);
    setDiff('');
    setDiffNote(null);
    setMessage(null);
    setBusy(verify ? 'Kapı çalışıyor (test + typecheck)...' : 'Kapı çalışıyor...');
    try {
      const [gateRes, diffRes] = await Promise.all([
        api()?.surgeryPreflight({ head: branch, verify }),
        api()?.surgeryDiff({ head: branch }),
      ]);
      if (gateRes?.success) setGate(gateRes.gate);
      else setMessage(gateRes?.error || 'Kapı çalıştırılamadı.');
      if (diffRes?.success) {
        setDiff(diffRes.diff || '');
        setDiffNote(diffRes.note || null);
      }
    } finally {
      setBusy(null);
    }
  }, [verify]);

  const merge = useCallback(async () => {
    if (!selected || !gate) return;
    const ok = window.confirm(
      `"${selected}" dalı main'e merge edilecek.\n\n` +
      `Kapı: ${gate.verdict}\nDosya: ${gate.stats.filesChanged}  +${gate.stats.insertions}/-${gate.stats.deletions}\n\n` +
      'Onaylıyor musun?'
    );
    if (!ok) return;

    setBusy('Merge ediliyor...');
    try {
      const res = await api()?.surgeryApproveMerge({ head: selected, approved: true, verify });
      const r = res?.result;
      if (r?.merged) {
        setMessage(`Merge tamamlandı. Geri dönüş: ${r.rollbackCommand}`);
        await inspect(selected);
      } else {
        setMessage(`Merge yapılmadı — ${r?.reason || 'bilinmeyen'}: ${r?.message || res?.error || ''}`);
      }
    } finally {
      setBusy(null);
    }
  }, [selected, gate, verify, inspect]);

  const style = gate ? VERDICT_STYLE[gate.verdict] : null;
  const canMerge = gate !== null && gate.verdict !== 'BLOCK' && gate.verdict !== 'ERROR';

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Cerrahi Bakım</h1>
          <p className="text-sm text-zinc-500">Kapı sonucu ve diff — merge kararı sende.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} className="accent-amber-500" />
            Test + typecheck çalıştır
          </label>
          <button
            onClick={loadBranches}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Yenile
          </button>
        </div>
      </header>

      {busy && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">{busy}</div>}
      {message && <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-sm text-zinc-300">{message}</div>}

      {/* ── Kodlama ajanı bağlantısı ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Kodlama Ajanı — GitHub Copilot</h2>
            <p className="text-xs text-zinc-500">
              {!auth.checked && 'Bağlantı durumu bilinmiyor.'}
              {auth.checked && auth.authenticated && 'Bağlı — oturum açık, cerrahi başlatılabilir.'}
              {auth.checked && !auth.authenticated && (auth.error || 'Oturum kapalı. "GitHub\'a Giriş Yap" ile bağlan.')}
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Kendi GitHub hesabınla bağlanırsın; kimlik bilgisi bu bilgisayarda, senin
              kullanıcı profilinde saklanır. Cerrahi için kendi Copilot aboneliğin gerekir.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              sessionStatus === 'RUNNING' ? 'bg-amber-500/15 text-amber-300'
                : sessionStatus === 'CHATTING' ? 'bg-emerald-500/15 text-emerald-300'
                : sessionStatus === 'AWAITING_REVIEW' ? 'bg-cyan-500/15 text-cyan-300'
                : sessionStatus === 'FAILED' ? 'bg-red-500/15 text-red-300'
                : 'bg-zinc-800 text-zinc-400'
            }`}>{sessionStatus}</span>
            {!auth.authenticated && !loggingIn && (
              <button
                onClick={startLogin}
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white"
              >
                GitHub'a Giriş Yap
              </button>
            )}
            {loggingIn && (
              <button onClick={cancelLogin} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
                Girişi İptal Et
              </button>
            )}
            {models.length > 0 && (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={sessionStatus === 'RUNNING' || sessionStatus === 'CHATTING'}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
                title="Cerrahın kullanacağı model — oturum sırasında değiştirilemez"
              >
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            <button onClick={checkAuth} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
              Bağlantıyı Kontrol Et
            </button>
            {sessionStatus === 'RUNNING' && (
              <button onClick={abortSurgery} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">
                İptal Et
              </button>
            )}
          </div>
        </div>

        {/* Cihaz kodu: ÇAKAL senin adına giriş YAPMAZ — kodu taşır, onayı sen verirsin */}
        {loginCode && (
          <div className="mt-4 rounded-lg border border-zinc-100/20 bg-zinc-950 p-4">
            <p className="text-xs text-zinc-400">
              GitHub'da şu adrese git ve aşağıdaki kodu gir. Onayı <strong>sen</strong> vereceksin;
              ÇAKAL senin adına giriş yapmaz ve token'ı hiç görmez.
            </p>
            <div className="mt-3 flex items-center gap-4">
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-mono text-2xl tracking-widest text-amber-300 select-all">
                {loginCode.code}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => api()?.surgeryOpenDevicePage()}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-amber-400"
                >
                  Tarayıcıda Aç
                </button>
                <span className="font-mono text-[10px] text-zinc-600 select-all">{loginCode.url}</span>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-zinc-500">Onayladıktan sonra bu pencere kendiliğinden güncellenir.</p>
          </div>
        )}
      </div>

      {/* ── Cerrahi sohbet: onaylı, adım adım kod akışı ── */}
      <SurgeonChat
        authenticated={auth.authenticated}
        model={model}
        changeRequestId={chatRequestId}
        onSessionChange={loadSession}
      />
      {chatRequestId && (
        <div className="flex items-center justify-between rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs text-cyan-300">
          <span>Sohbet şu talebe bağlanacak: <span className="font-mono">{chatRequestId}</span></span>
          <button onClick={() => setChatRequestId(null)} className="text-cyan-200 underline-offset-2 hover:underline">
            bağlantıyı kaldır
          </button>
        </div>
      )}

      {/* ── Bekleyen değişiklik talepleri ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Bekleyen Değişiklik Talepleri</h2>
        {requests.length === 0 ? (
          <p className="text-xs text-zinc-600">
            Bekleyen talep yok. Sohbette ÇAKAL'a yeni bir özellik iste; kaynak kod gerektiriyorsa talebi buraya düşürür.
          </p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.changeRequestId} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-mono text-amber-400/80">{r.changeRequestId}</div>
                  <div className="mt-0.5 text-sm text-zinc-200">{r.originalUserRequest}</div>
                  {r.cakalInterpretation && (
                    <div className="mt-1 text-[11px] text-zinc-500">🐺 {r.cakalInterpretation}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => setChatRequestId(r.changeRequestId)}
                    disabled={sessionStatus === 'RUNNING' || sessionStatus === 'CHATTING' || !auth.authenticated}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Bu talebi sohbet oturumuna bağla — adım adım onaylayarak ilerle"
                  >
                    Sohbete Bağla
                  </button>
                  <button
                    onClick={() => startSurgery(r.changeRequestId, r.originalUserRequest)}
                    disabled={sessionStatus === 'RUNNING' || sessionStatus === 'CHATTING' || !auth.authenticated}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                    title={!auth.authenticated ? 'Önce Copilot bağlantısını kontrol et' : 'Tek atımlı cerrahiyi başlat'}
                  >
                    Tek Atımda Başlat
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Canlı cerrahi akışı ── */}
      {events.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-2 text-sm font-semibold text-zinc-200">Canlı Akış</h2>
          <div className="max-h-48 space-y-1 overflow-auto font-mono text-[11px]">
            {events.map((e, i) => (
              <div key={i} className={e.type === 'surgery_permission' && e.detail?.startsWith('reject') ? 'text-red-400' : 'text-zinc-400'}>
                <span className="text-zinc-600">{new Date(e.ts).toLocaleTimeString('tr-TR')}</span>{' '}
                <span className="text-cyan-400">{e.type}</span>{' '}
                {e.detail}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[18rem_1fr] gap-4">
        <aside className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cerrahi Dallar</h2>
          {branches.length === 0 && <p className="text-sm text-zinc-600">Bekleyen cerrahi paket yok.</p>}
          {branches.map((b) => (
            <button
              key={b.branch}
              onClick={() => inspect(b.branch)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                selected === b.branch ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800'
              }`}
            >
              <div className="truncate text-xs font-medium text-zinc-200">{b.branch.replace('cakal/feature-', '')}</div>
              <div className="truncate text-[11px] text-zinc-500">{b.subject}</div>
            </button>
          ))}
        </aside>

        <section className="space-y-4">
          {!gate && !busy && <p className="text-sm text-zinc-600">İncelemek için soldan bir cerrahi paket seç.</p>}

          {gate && style && (
            <>
              <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${style.cls}`}>
                <div className="flex items-center gap-3">
                  <style.Icon className="h-5 w-5" />
                  <div>
                    <div className="text-sm font-semibold">{style.label}</div>
                    <div className="text-xs opacity-80">
                      {gate.stats.filesChanged} dosya · +{gate.stats.insertions} / -{gate.stats.deletions}
                    </div>
                  </div>
                </div>
                <button
                  onClick={merge}
                  disabled={!canMerge}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                    canMerge
                      ? 'bg-amber-500 text-zinc-900 hover:bg-amber-400'
                      : 'cursor-not-allowed bg-zinc-800 text-zinc-600'
                  }`}
                  title={canMerge ? 'main dalına merge et' : 'Kapı bloke ettiği için merge kapalı'}
                >
                  <GitMerge className="h-4 w-4" />
                  {canMerge ? 'Onayla ve Merge Et' : 'Merge Kapalı'}
                </button>
              </div>

              {Object.keys(gate.checks || {}).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(gate.checks).map(([name, state]) => (
                    <span
                      key={name}
                      className={`rounded-md border px-2 py-1 text-[11px] ${
                        state === 'PASS' ? 'border-emerald-500/30 text-emerald-400'
                        : state === 'FAIL' ? 'border-red-500/30 text-red-400'
                        : 'border-zinc-700 text-zinc-500'
                      }`}
                    >
                      {name}: {state}
                    </span>
                  ))}
                </div>
              )}

              {gate.findings.length > 0 && (
                <div className="space-y-2">
                  {gate.findings.map((f, i) => (
                    <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${SEVERITY_STYLE[f.severity]}`}>
                      <div className="font-semibold">[{f.code}] {f.message}</div>
                      {f.files?.slice(0, 8).map((file) => (
                        <div key={file} className="mt-1 font-mono text-[11px] opacity-80">— {file}</div>
                      ))}
                      {f.details?.slice(0, 8).map((d, j) => (
                        <div key={j} className="mt-1 font-mono text-[11px] opacity-80">| {d}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <FileDiff className="h-3.5 w-3.5" /> Değişiklikler
                  {diffNote && <span className="ml-2 font-normal normal-case text-amber-500/80">{diffNote}</span>}
                </div>
                {diff ? <DiffView text={diff} /> : <p className="text-sm text-zinc-600">Diff yok.</p>}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
