import { useState, useEffect } from 'react';
import { Save, CheckCircle, AlertCircle, Loader2, Send, Bell, Brain, ThumbsUp, ThumbsDown, Eye, Radio, KeyRound, ShieldCheck } from 'lucide-react';

interface CapabilityGap {
  id: string;
  capability_name: string;
  trigger_count: number;
  first_triggered_at: string;
  last_triggered_at: string;
  context: string | null;
  status: string;
}

interface ExpansionProposal {
  id: string;
  capability_name: string;
  title: string;
  description: string | null;
  suggestion: string | null;
  status: string;
  user_response: string | null;
  proposed_at: string;
  resolved_at: string | null;
}

interface SecretRef {
  name: string;
  ref: string;
  updatedAt: string | null;
  encrypted: boolean;
}

interface SecretRequest {
  name: string;
  ref: string;
  capabilityName: string | null;
  reason: string | null;
  status: 'pending' | 'fulfilled';
  stored: boolean;
}

export default function SettingsScreen() {
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configStatus, setConfigStatus] = useState<Record<string, unknown>>({});
  const [capabilities, setCapabilities] = useState<Array<Record<string, string>>>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [notifLog, setNotifLog] = useState<Array<Record<string, unknown>>>([]);
  const [gaps, setGaps] = useState<CapabilityGap[]>([]);
  const [proposals, setProposals] = useState<ExpansionProposal[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [secretName, setSecretName] = useState('openweather');
  const [secretValue, setSecretValue] = useState('');
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [secretSaving, setSecretSaving] = useState(false);
  const [secretMessage, setSecretMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [secretRequests, setSecretRequests] = useState<SecretRequest[]>([]);
  const [requestValues, setRequestValues] = useState<Record<string, string>>({});
  const [requestSavingName, setRequestSavingName] = useState<string | null>(null);

  // Telegram Reader (MTProto) state
  const [tgApiId, setTgApiId] = useState('');
  const [tgApiHash, setTgApiHash] = useState('');
  const [tgPhone, setTgPhone] = useState('');
  const [tgCode, setTgCode] = useState('');
  const [tg2FA, setTg2FA] = useState('');
  const [tgAuthStep, setTgAuthStep] = useState<'config' | 'phone' | 'code' | '2fa' | 'done'>('config');
  const [tgLoading, setTgLoading] = useState(false);
  const [tgMessage, setTgMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tgPhoneCodeHash, setTgPhoneCodeHash] = useState('');
  const [tgReaderAuthenticated, setTgReaderAuthenticated] = useState(false);
  const [tgAuthReason, setTgAuthReason] = useState('');
  const [tgAuthMessage, setTgAuthMessage] = useState('');

  useEffect(() => {
    // Load saved config
    window.cakalAPI.getAllConfig().then((res) => {
      if (res.data) {
        const d = res.data as Record<string, string>;
        setTelegramToken(d.TELEGRAM_BOT_TOKEN || '');
        setTelegramChatId(d.TELEGRAM_CHAT_ID || '');
        setConfigStatus(res.data as Record<string, unknown>);
        // Telegram Reader
        setTgApiId(d.TELEGRAM_API_ID || '');
        setTgApiHash(d.TELEGRAM_API_HASH || '');
        setTgAuthReason(d.telegramReaderAuthReason || '');
        setTgAuthMessage(d.telegramReaderAuthMessage || '');
        if ((res.data as Record<string, boolean>).hasTelegramReader) {
          setTgAuthStep('done');
          setTgReaderAuthenticated(true);
        } else if (d.TELEGRAM_API_ID && d.TELEGRAM_API_HASH) {
          // İptal edilmiş oturum da buraya düşer: API bilgileri duruyor,
          // eksik olan yalnızca geçerli yetki. Doğrudan telefon adımına geç.
          setTgAuthStep('phone');
        }
      }
    });
    // Load capabilities
    window.cakalAPI.getCapabilities().then((res) => {
      if (res.data) setCapabilities(res.data as Array<Record<string, string>>);
    });
    // Load notification log
    window.cakalAPI.getNotificationLog({ limit: 10 }).then((res) => {
      if (res.data) setNotifLog(res.data as Array<Record<string, unknown>>);
    });
    // Sprint 7: Load capability gaps & proposals
    window.cakalAPI.checkCapabilityGaps().then((res) => {
      if (res.data) setGaps(res.data as CapabilityGap[]);
    });
    window.cakalAPI.getExpansionProposals().then((res) => {
      if (res.data) setProposals(res.data as ExpansionProposal[]);
    });
    window.cakalAPI.listSecrets().then((res) => {
      if (res.data) setSecrets(res.data as SecretRef[]);
    });
    window.cakalAPI.listSecretRequests?.().then((res) => {
      if (res.data) setSecretRequests(res.data as SecretRequest[]);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await window.cakalAPI.saveConfig({
      TELEGRAM_BOT_TOKEN: telegramToken,
      TELEGRAM_CHAT_ID: telegramChatId,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  // ── Telegram Reader Auth handlers ──

  const handleTgSaveApi = async () => {
    setTgLoading(true);
    setTgMessage(null);
    try {
      const res = await window.cakalAPI.telegramReaderConfigure(tgApiId, tgApiHash);
      if (res.status === 'ok') {
        setTgAuthStep('phone');
        setTgMessage({ ok: true, text: 'API bilgileri kaydedildi' });
      } else {
        setTgMessage({ ok: false, text: res.error || 'Hata' });
      }
    } catch (e: unknown) { setTgMessage({ ok: false, text: (e as Error).message }); }
    setTgLoading(false);
  };

  const handleTgSendCode = async () => {
    setTgLoading(true);
    setTgMessage(null);
    try {
      const res = await window.cakalAPI.telegramReaderSendCode(tgPhone);
      if (res.status === 'ok') {
        setTgPhoneCodeHash(res.phoneCodeHash || '');
        setTgAuthStep('code');
        setTgMessage({ ok: true, text: 'Doğrulama kodu gönderildi' });
      } else {
        setTgMessage({ ok: false, text: res.error || 'Kod gönderilemedi' });
      }
    } catch (e: unknown) { setTgMessage({ ok: false, text: (e as Error).message }); }
    setTgLoading(false);
  };

  const handleTgVerifyCode = async () => {
    setTgLoading(true);
    setTgMessage(null);
    try {
      const res = await window.cakalAPI.telegramReaderVerifyCode(tgPhone, tgCode, tgPhoneCodeHash);
      if (res.status === 'ok') {
        setTgAuthStep('done');
        setTgReaderAuthenticated(true);
        setTgMessage({ ok: true, text: 'Giriş başarılı!' });
      } else if (res.status === 'need_2fa') {
        setTgAuthStep('2fa');
        setTgMessage({ ok: true, text: '2FA şifre gerekli' });
      } else {
        setTgMessage({ ok: false, text: res.error || 'Doğrulama başarısız' });
      }
    } catch (e: unknown) { setTgMessage({ ok: false, text: (e as Error).message }); }
    setTgLoading(false);
  };

  const handleTg2FA = async () => {
    setTgLoading(true);
    setTgMessage(null);
    try {
      const res = await window.cakalAPI.telegramReaderVerify2FA(tg2FA);
      if (res.status === 'ok') {
        setTgAuthStep('done');
        setTgReaderAuthenticated(true);
        setTgMessage({ ok: true, text: '2FA doğrulama başarılı!' });
      } else {
        setTgMessage({ ok: false, text: res.error || '2FA başarısız' });
      }
    } catch (e: unknown) { setTgMessage({ ok: false, text: (e as Error).message }); }
    setTgLoading(false);
  };

  // Hesabı değiştirmek ya da iptal edilmiş oturumu tazelemek için tek yol.
  // Bu düğme olmadan "bağlı" görünen bir oturumdan çıkış yapılamıyordu.
  const handleTgRelogin = async () => {
    setTgLoading(true);
    setTgMessage(null);
    try {
      const res = await window.cakalAPI.telegramReaderReset();
      if (res.status === 'ok') {
        setTgReaderAuthenticated(false);
        setTgAuthReason('no_session');
        setTgAuthMessage('');
        setTgCode('');
        setTg2FA('');
        setTgPhoneCodeHash('');
        setTgAuthStep(tgApiId && tgApiHash ? 'phone' : 'config');
        setTgMessage({ ok: true, text: 'Yerel oturum temizlendi — telefon numaranla yeniden giriş yap' });
      } else {
        setTgMessage({ ok: false, text: res.error || 'Oturum temizlenemedi' });
      }
    } catch (e: unknown) { setTgMessage({ ok: false, text: (e as Error).message }); }
    setTgLoading(false);
  };

  const handleTelegramTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await window.cakalAPI.telegramTest();
    setTesting(false);
    setTestResult({
      ok: res.status === 'ok',
      msg: res.status === 'ok' ? (res as unknown as Record<string, string>).message || 'Gönderildi!' : res.error || 'Hata',
    });
    setTimeout(() => setTestResult(null), 5000);
  };

  // Çakal'ın istediği hazır alan: kullanıcı sadece value yapıştırır.
  // Kaydetme sonrası main process bekleyen isteği fulfilled işaretler ve
  // entegrasyon testi sohbette otomatik devam eder.
  const handleRequestValueSave = async (requestName: string) => {
    const value = (requestValues[requestName] || '').trim();
    if (!value) return;
    setRequestSavingName(requestName);
    setSecretMessage(null);
    try {
      const res = await window.cakalAPI.storeSecret(requestName, value);
      if (res.status === 'ok') {
        setRequestValues((prev) => ({ ...prev, [requestName]: '' }));
        const [listRes, reqRes] = await Promise.all([
          window.cakalAPI.listSecrets(),
          window.cakalAPI.listSecretRequests(),
        ]);
        if (listRes.data) setSecrets(listRes.data as SecretRef[]);
        if (reqRes.data) setSecretRequests(reqRes.data as SecretRequest[]);
        setSecretMessage({ ok: true, text: `secret:${requestName} kaydedildi — entegrasyon testi sohbette otomatik başlıyor` });
      } else {
        setSecretMessage({ ok: false, text: res.error || 'Secret kaydedilemedi' });
      }
    } catch (e) {
      setSecretMessage({ ok: false, text: (e as Error).message });
    }
    setRequestSavingName(null);
    setTimeout(() => setSecretMessage(null), 6000);
  };

  const handleSecretSave = async () => {
    setSecretSaving(true);
    setSecretMessage(null);
    try {
      const res = await window.cakalAPI.storeSecret(secretName, secretValue);
      if (res.status === 'ok') {
        setSecretValue('');
        const listRes = await window.cakalAPI.listSecrets();
        if (listRes.data) setSecrets(listRes.data as SecretRef[]);
        const ref = ((res.data as Record<string, string>)?.ref || `secret:${secretName}`).toString();
        setSecretMessage({ ok: true, text: `${ref} kaydedildi` });
      } else {
        setSecretMessage({ ok: false, text: res.error || 'Secret kaydedilemedi' });
      }
    } catch (e: unknown) {
      setSecretMessage({ ok: false, text: (e as Error).message });
    }
    setSecretSaving(false);
    setTimeout(() => setSecretMessage(null), 5000);
  };

  const handleProposalResponse = async (proposalId: string, response: 'accepted' | 'rejected') => {
    setRespondingId(proposalId);
    await window.cakalAPI.respondToProposal(proposalId, response);
    // Refresh proposals
    const res = await window.cakalAPI.getExpansionProposals();
    if (res.data) setProposals(res.data as ExpansionProposal[]);
    setRespondingId(null);
  };

  const handleGenerateProposals = async () => {
    // Eşik aşan her gap için öneri üretmeyi dene
    for (const gap of gaps.filter(g => g.trigger_count >= 3)) {
      await window.cakalAPI.generateProposal(gap.capability_name);
    }
    // Refresh
    const [gapRes, propRes] = await Promise.all([
      window.cakalAPI.checkCapabilityGaps(),
      window.cakalAPI.getExpansionProposals(),
    ]);
    if (gapRes.data) setGaps(gapRes.data as CapabilityGap[]);
    if (propRes.data) setProposals(propRes.data as ExpansionProposal[]);
  };

  const statusBadge = (active: boolean, label: string) => (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
      }`}
    >
      {label}
    </span>
  );

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="mb-6 text-xl font-bold text-zinc-100">Ayarlar</h1>

      <div className="max-w-xl space-y-6">
        {/* Connection Status */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Bağlantı Durumu
          </h2>
          <div className="space-y-2 text-sm">
            <StatusRow label="OpenAI GPT-4o" connected={!!(configStatus as Record<string, boolean>).hasOpenAI} />
            <StatusRow label="Perplexity API" connected={!!(configStatus as Record<string, boolean>).hasPerplexity} />
            <StatusRow label="YouTube Data API" connected={!!(configStatus as Record<string, boolean>).hasYouTube} />
            <StatusRow label="Supabase DB" connected={!!(configStatus as Record<string, boolean>).hasSupabase} />
            <StatusRow label="Telegram" connected={!!(configStatus as Record<string, boolean>).hasTelegram} />
            <StatusRow label="Telegram Kanal Okuyucu" connected={tgReaderAuthenticated} />
          </div>
        </div>

        {/* Secret Broker */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            <KeyRound className="h-4 w-4" /> Secret Broker
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            API key burada saklanır; Çakal ham değeri görmez, plugin runner sadece runtime sırasında secret referansını çözer.
          </p>

          {/* Çakal'ın beklediği anahtarlar — key hazır, value yapıştırılır */}
          {secretRequests.filter((request) => request.status === 'pending' && !request.stored).length > 0 && (
            <div className="mb-4 space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" /> Çakal şu anahtarları bekliyor — değeri yapıştır, gerisi otomatik:
              </p>
              {secretRequests
                .filter((request) => request.status === 'pending' && !request.stored)
                .map((request) => (
                  <div key={request.ref} className="space-y-2 rounded-lg bg-zinc-900/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium text-zinc-200">{request.ref}</span>
                      {request.capabilityName && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
                          {request.capabilityName}
                        </span>
                      )}
                    </div>
                    {request.reason && <p className="text-[11px] text-zinc-500">{request.reason}</p>}
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={requestValues[request.name] || ''}
                        onChange={(e) => setRequestValues((prev) => ({ ...prev, [request.name]: e.target.value }))}
                        placeholder="Değeri buraya yapıştır"
                        className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500/50"
                      />
                      <button
                        onClick={() => handleRequestValueSave(request.name)}
                        disabled={requestSavingName === request.name || !(requestValues[request.name] || '').trim()}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
                      >
                        {requestSavingName === request.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        Kaydet
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-3">
            <input
              type="text"
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              placeholder="Secret adı (örn: openweather)"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500/50"
            />
            <input
              type="password"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="API key / token"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={handleSecretSave}
              disabled={secretSaving || !secretName.trim() || !secretValue.trim()}
              className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {secretSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {secretSaving ? 'Kaydediliyor...' : 'Secret Kaydet'}
            </button>
            {secretMessage && (
              <p className={`flex items-center gap-1 text-xs ${secretMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {secretMessage.ok ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                {secretMessage.text}
              </p>
            )}
            <div className="space-y-2 border-t border-zinc-800 pt-3">
              {secrets.length === 0 ? (
                <p className="text-xs text-zinc-600">Kayıtlı secret yok</p>
              ) : (
                secrets.map((secret) => (
                  <div key={secret.ref} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-800/60 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className="block font-medium text-zinc-300">{secret.ref}</span>
                      <span className="block truncate text-zinc-600">
                        {secret.updatedAt ? new Date(secret.updatedAt).toLocaleString('tr-TR') : 'tarih yok'}
                      </span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 ${secret.encrypted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                      {secret.encrypted ? 'encrypted' : 'dev-store'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Agent Controls */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Ajan Durumları
          </h2>
          <div className="space-y-3">
            {[
              { name: 'Commander', active: true },
              { name: 'Opportunity Hunter', active: true },
              { name: 'Feedback Agent', active: true },
              { name: 'Profile Keeper', active: true },
              { name: 'Arbitrage Agent', active: true },
              { name: 'Street Hunter', active: true },
              { name: 'Finance Watcher', active: true },
              { name: 'Pattern Extractor', active: true },
              { name: 'Travel Hunter', active: true },
              { name: 'Opportunity Judge', active: true },
              { name: 'System Conscience', active: true },
              { name: 'Evolution Engine', active: true },
            ].map(({ name, active }) => (
              <div key={name} className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">{name}</span>
                {statusBadge(active, active ? 'Aktif' : 'Faz 2')}
              </div>
            ))}
          </div>
        </div>

        {/* Telegram Config */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Telegram Bildirimi
          </h2>
          <div className="space-y-3">
            <input
              type="password"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder="Bot Token"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500/50"
            />
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="Chat ID"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500/50"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
            <button
              onClick={handleTelegramTest}
              disabled={testing || !telegramToken || !telegramChatId}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {testing ? 'Test ediliyor...' : 'Test Gönder'}
            </button>
            {saved && (
              <p className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle className="h-3 w-3" /> Ayarlar kaydedildi
              </p>
            )}
            {testResult && (
              <p className={`flex items-center gap-1 text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {testResult.ok ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                {testResult.msg}
              </p>
            )}
          </div>
        </div>

        {/* Telegram Channel Reader (MTProto) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            <Radio className="h-4 w-4" /> Telegram Kanal Okuyucu
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            Katıldığın Telegram kanallarındaki mesajları okumak için hesabınla giriş yap.
          </p>

          {tgAuthStep === 'done' ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle className="h-4 w-4" /> Telegram hesabı bağlı — kanallar okunabilir
              </p>
              <button
                onClick={handleTgRelogin}
                disabled={tgLoading}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                {tgLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
                Yeniden giriş yap / hesabı değiştir
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Oturum iptal edilmişse sebebini söyle: kullanıcı "neden tekrar
                  giriş istiyor" diye sormasın. */}
              {tgAuthReason === 'revoked' && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {tgAuthMessage || 'Önceki Telegram oturumu iptal edilmiş.'}
                    {' '}Bu genelde Telegram &gt; Cihazlar ekranından oturum sonlandırıldığında olur.
                  </span>
                </p>
              )}
              {tgAuthReason === 'unreachable' && (
                <p className="flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{tgAuthMessage || 'Telegram\'a ulaşılamadı.'} Bağlantını kontrol edip ekranı yenile.</span>
                </p>
              )}

              {/* API ID & Hash */}
              {tgAuthStep === 'config' && (
                <>
                  <input
                    type="text"
                    value={tgApiId}
                    onChange={(e) => setTgApiId(e.target.value)}
                    placeholder="API ID (rakam)"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500/50"
                  />
                  <input
                    type="password"
                    value={tgApiHash}
                    onChange={(e) => setTgApiHash(e.target.value)}
                    placeholder="API Hash"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500/50"
                  />
                  <button
                    onClick={handleTgSaveApi}
                    disabled={tgLoading || !tgApiId || !tgApiHash}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                  >
                    {tgLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    API Kaydet
                  </button>
                </>
              )}

              {/* Phone */}
              {tgAuthStep === 'phone' && (
                <>
                  <p className="text-xs text-zinc-400">Telegram'a kayıtlı telefon numaranı gir (+90...)</p>
                  <input
                    type="tel"
                    value={tgPhone}
                    onChange={(e) => setTgPhone(e.target.value)}
                    placeholder="+905xxxxxxxxx"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500/50"
                  />
                  <button
                    onClick={handleTgSendCode}
                    disabled={tgLoading || !tgPhone}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                  >
                    {tgLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Kod Gönder
                  </button>
                </>
              )}

              {/* Code verification */}
              {tgAuthStep === 'code' && (
                <>
                  <p className="text-xs text-zinc-400">Telegram'dan gelen doğrulama kodunu gir</p>
                  <input
                    type="text"
                    value={tgCode}
                    onChange={(e) => setTgCode(e.target.value)}
                    placeholder="12345"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500/50"
                  />
                  <button
                    onClick={handleTgVerifyCode}
                    disabled={tgLoading || !tgCode}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                  >
                    {tgLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Doğrula
                  </button>
                </>
              )}

              {/* 2FA */}
              {tgAuthStep === '2fa' && (
                <>
                  <p className="text-xs text-zinc-400">İki adımlı doğrulama şifreni gir</p>
                  <input
                    type="password"
                    value={tg2FA}
                    onChange={(e) => setTg2FA(e.target.value)}
                    placeholder="2FA Şifre"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500/50"
                  />
                  <button
                    onClick={handleTg2FA}
                    disabled={tgLoading || !tg2FA}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                  >
                    {tgLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Doğrula
                  </button>
                </>
              )}

              {tgMessage && (
                <p className={`flex items-center gap-1 text-xs ${tgMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tgMessage.ok ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {tgMessage.text}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Notification Log */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            <Bell className="h-4 w-4" /> Son Bildirimler
          </h2>
          {notifLog.length === 0 ? (
            <p className="text-sm text-zinc-600">Henüz bildirim yok</p>
          ) : (
            <div className="space-y-2">
              {notifLog.map((n, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 truncate max-w-[200px]">{String(n.title)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-600">
                      {new Date(String(n.sent_at)).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 ${n.delivered ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                      {n.delivered ? '✓' : '✗'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System Capabilities */}
        {capabilities.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Sistem Yetenekleri
            </h2>
            <div className="space-y-2">
              {capabilities.map((cap) => (
                <div key={cap.capability_name} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-zinc-300">{cap.description}</span>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      cap.status === 'active'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : cap.status === 'planned'
                        ? 'bg-blue-500/15 text-blue-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    {cap.status === 'active' ? 'Aktif' : cap.status === 'planned' ? 'Planlandı' : 'Eksik'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sprint 7: Capability Gaps (Eksik Yetenek Talepleri) */}
        {gaps.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              <Eye className="h-4 w-4" /> Eksik Yetenek Talepleri
            </h2>
            <div className="space-y-2">
              {gaps.map((gap) => (
                <div key={gap.id} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-zinc-300 block truncate">{gap.capability_name}</span>
                    {gap.context && (
                      <span className="text-xs text-zinc-600 block truncate">{gap.context}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${
                      gap.trigger_count >= 3
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {gap.trigger_count}×
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {gaps.some(g => g.trigger_count >= 3) && (
              <button
                onClick={handleGenerateProposals}
                className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20"
              >
                <Brain className="h-3.5 w-3.5" /> Öneri Üret
              </button>
            )}
          </div>
        )}

        {/* Sprint 7: Expansion Proposals (Genişleme Önerileri) */}
        {proposals.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              <Brain className="h-4 w-4" /> Genişleme Önerileri
            </h2>
            <div className="space-y-3">
              {proposals.map((prop) => (
                <div key={prop.id} className="rounded-lg border border-zinc-800 bg-zinc-800/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-zinc-200 block">{prop.title}</span>
                      {prop.description && (
                        <span className="text-xs text-zinc-500 block mt-0.5">{prop.description}</span>
                      )}
                      {prop.suggestion && (
                        <span className="text-xs text-amber-400/80 block mt-1">💡 {prop.suggestion}</span>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      prop.status === 'pending'
                        ? 'bg-amber-500/15 text-amber-400'
                        : prop.status === 'accepted'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : prop.status === 'rejected'
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-zinc-700 text-zinc-500'
                    }`}>
                      {prop.status === 'pending' ? 'Bekliyor' : prop.status === 'accepted' ? 'Kabul' : prop.status === 'rejected' ? 'Reddedildi' : 'Süresi Doldu'}
                    </span>
                  </div>
                  {prop.status === 'pending' && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleProposalResponse(prop.id, 'accepted')}
                        disabled={respondingId === prop.id}
                        className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {respondingId === prop.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                        Kabul Et
                      </button>
                      <button
                        onClick={() => handleProposalResponse(prop.id, 'rejected')}
                        disabled={respondingId === prop.id}
                        className="flex items-center gap-1 rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {respondingId === prop.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}
                        Reddet
                      </button>
                    </div>
                  )}
                  <div className="text-xs text-zinc-600 mt-1.5">
                    {new Date(prop.proposed_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusRow({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-300">{label}</span>
      <div className="flex items-center gap-1.5">
        {connected ? (
          <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-zinc-600" />
        )}
        <span className={connected ? 'text-emerald-400' : 'text-zinc-600'}>
          {connected ? 'Bağlı' : 'Bağlı değil'}
        </span>
      </div>
    </div>
  );
}
