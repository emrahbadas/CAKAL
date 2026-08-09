import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, ShieldAlert, Check, X, FileCode2, TerminalSquare, Globe, Puzzle,
  Play, Square, Loader2, GitMerge, Ban,
} from 'lucide-react';

// ─── Cerrahi Sohbet — VS Code Copilot tarzı onaylı kod akışı ───
//
// İKİ AYRI ONAY DÜZLEMİ VAR, ARAYÜZ BUNLARI KARIŞTIRMAMALI:
//   1. İzin kartı  → "bu dosyayı yazayım mı?"  — tur içinde, cerrah BEKLER
//   2. Uygulama    → "iş canlı koda insin mi?" — oturum bitince, kapıdan geçer
//
// Cerrahın kendi kendine reddedilen istekleri (secret, korunan dosya, çalışma
// alanı dışı) buraya KART olarak gelmez — onlar kullanıcıya sorulmaz, çünkü
// sorulan her şey er ya da geç onaylanır. Onlar "otomatik red" satırı olarak
// görünür: kullanıcı ne engellendiğini görsün ama oylayamasın.

type PermissionKind = 'write' | 'shell' | 'url' | string;

interface PermissionPayload {
  permissionId: string;
  kind: PermissionKind;
  /** Cerrahın kendi gerekçesi (SDK: PermissionRequest.intention) */
  intention: string | null;
  target: string | null;
  file: string | null;
  diff: string | null;
  command: string | null;
  url: string | null;
  toolName: string | null;
  paths: string[] | null;
  createdAt: number;
  expiresAt: number;
}

type PermissionState = 'pending' | 'approved' | 'rejected' | 'timeout' | 'cancelled';

type Item =
  | { type: 'user'; id: string; text: string; ts: number }
  | { type: 'assistant'; id: string; text: string; ts: number }
  | { type: 'system'; id: string; text: string; tone: 'info' | 'error' | 'ok'; ts: number }
  | { type: 'auto-deny'; id: string; reason: string; target: string; ts: number }
  | { type: 'permission'; id: string; payload: PermissionPayload; state: PermissionState; ts: number };

interface SurgeryEvent {
  type: string;
  detail?: string;
  ts: number;
  permissionId?: string;
  payload?: PermissionPayload;
  decision?: string;
  branch?: string;
}

interface Props {
  authenticated: boolean;
  model: string;
  /** Bekleyen bir talebe bağlanmak için (boşsa serbest oturum açılır) */
  changeRequestId?: string | null;
  onSessionChange?: () => void;
}

const api = () => (window as any).cakalAPI;

const KIND_META: Record<string, { label: string; Icon: typeof FileCode2 }> = {
  write: { label: 'Dosya yazma', Icon: FileCode2 },
  shell: { label: 'Komut çalıştırma', Icon: TerminalSquare },
  url: { label: 'Ağ erişimi', Icon: Globe },
};

function kindMeta(kind: string) {
  return KIND_META[kind] || { label: `Araç: ${kind}`, Icon: Puzzle };
}

let seq = 0;
const nextId = () => `i${(seq += 1)}`;

function DiffLines({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-zinc-950 p-2.5 text-[11px] leading-relaxed">
      {text.split('\n').map((line, i) => {
        let cls = 'text-zinc-400';
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-zinc-500';
        else if (line.startsWith('+')) cls = 'text-emerald-400';
        else if (line.startsWith('-')) cls = 'text-red-400';
        else if (line.startsWith('@@')) cls = 'text-cyan-400';
        return <div key={i} className={cls}>{line || ' '}</div>;
      })}
    </pre>
  );
}

function PermissionCard({
  payload, state, onRespond,
}: {
  payload: PermissionPayload;
  state: PermissionState;
  onRespond: (approved: boolean) => void;
}) {
  const { label, Icon } = kindMeta(payload.kind);
  const settled = state !== 'pending';

  const STATE_BADGE: Record<PermissionState, { text: string; cls: string } | null> = {
    pending: null,
    approved: { text: 'ONAYLANDI', cls: 'bg-emerald-500/15 text-emerald-300' },
    rejected: { text: 'REDDEDİLDİ', cls: 'bg-red-500/15 text-red-300' },
    timeout: { text: 'SÜRE DOLDU — REDDEDİLDİ', cls: 'bg-amber-500/15 text-amber-300' },
    cancelled: { text: 'DÜŞTÜ', cls: 'bg-zinc-700 text-zinc-400' },
  };
  const badge = STATE_BADGE[state];

  return (
    <div className={`rounded-xl border p-3 transition-colors ${
      state === 'pending' ? 'border-amber-500/50 bg-amber-500/[0.07]' : 'border-zinc-800 bg-zinc-900/40'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${state === 'pending' ? 'text-amber-400' : 'text-zinc-500'}`} />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-200">{label}</div>
            <div className="truncate font-mono text-[11px] text-zinc-500" title={payload.target || ''}>
              {payload.file || payload.command || payload.url || payload.toolName || payload.target || '—'}
            </div>
          </div>
        </div>
        {badge && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
            {badge.text}
          </span>
        )}
      </div>

      {payload.intention && (
        <p className="mt-2 border-l-2 border-zinc-700 pl-2 text-[11px] italic text-zinc-400">
          {payload.intention}
        </p>
      )}

      {payload.kind === 'write' && payload.diff && (
        <div className="mt-2"><DiffLines text={payload.diff} /></div>
      )}

      {payload.kind === 'shell' && (
        <pre className="mt-2 overflow-auto rounded-md bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-300">
          $ {payload.command}
        </pre>
      )}

      {payload.paths && payload.paths.length > 0 && (
        <div className="mt-1.5 text-[10px] text-zinc-600">
          Dokunduğu yollar: {payload.paths.slice(0, 6).join(', ')}
          {payload.paths.length > 6 ? ` (+${payload.paths.length - 6})` : ''}
        </div>
      )}

      {state === 'pending' && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => onRespond(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-emerald-400"
          >
            <Check className="h-3.5 w-3.5" /> Onayla
          </button>
          <button
            onClick={() => onRespond(false)}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10"
          >
            <X className="h-3.5 w-3.5" /> Reddet
          </button>
          <span className="text-[10px] text-zinc-600">Cerrah cevabını bekliyor.</span>
        </div>
      )}
    </div>
  );
}

export default function SurgeonChat({ authenticated, model, changeRequestId, onSessionChange }: Props) {
  const [live, setLive] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);      // cerrah tur içinde mi
  const [working, setWorking] = useState<string | null>(null); // başlat/bitir gibi geçişler
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const push = useCallback((item: Item) => setItems((prev) => [...prev, item]), []);

  const sys = useCallback((text: string, tone: 'info' | 'error' | 'ok' = 'info') => {
    push({ type: 'system', id: nextId(), text, tone, ts: Date.now() });
  }, [push]);

  // Yeni içerik geldikçe en alta kaydır.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const setPermissionState = useCallback((permissionId: string, state: PermissionState) => {
    setItems((prev) => prev.map((it) => (
      it.type === 'permission' && it.payload.permissionId === permissionId ? { ...it, state } : it
    )));
  }, []);

  // Canlı olay köprüsü. Sohbet ve cerrahi aynı kanaldan akar; burada yalnız
  // sohbete ait olanlar ayıklanır.
  useEffect(() => {
    const off = api()?.onSurgeryActivity?.((e: SurgeryEvent) => {
      switch (e.type) {
        case 'permission_request':
          if (e.payload) {
            push({ type: 'permission', id: nextId(), payload: e.payload, state: 'pending', ts: e.ts });
          }
          break;
        case 'permission_timeout':
          if (e.permissionId) setPermissionState(e.permissionId, 'timeout');
          break;
        case 'permission_cancelled':
          if (e.permissionId) setPermissionState(e.permissionId, 'cancelled');
          break;
        case 'surgeon_permission': {
          // "reject:secret-write — .env" biçiminde gelir. Yalnız OTOMATİK
          // redler gösterilir; kullanıcı kaynaklı red ile zaman aşımı zaten
          // kartın kendi rozetinde görünüyor — burada tekrarlanmamalı.
          const detail = e.detail || '';
          if (!detail.startsWith('reject:')) break;
          if (/user-rejected|ask-timeout|ask-failed/.test(detail)) break;
          const [head, target] = detail.slice('reject:'.length).split(' — ');
          push({ type: 'auto-deny', id: nextId(), reason: head, target: target || '', ts: e.ts });
          break;
        }
        case 'chat_apply_started':
          sys('Değişiklikler uygulanıyor: commit → kapı (test + typecheck) → merge…');
          break;
        case 'chat_apply_merged':
          sys(`Canlı koda indi. ${e.detail || ''}`, 'ok');
          break;
        case 'chat_apply_blocked':
          sys(`Uygulanmadı — ${e.detail || 'kapı izin vermedi'}. Dal incelemede kaldı.`, 'error');
          break;
        case 'chat_apply_skipped':
          sys(e.detail || 'Uygulanacak değişiklik yok.');
          break;
        case 'chat_failed':
        case 'chat_turn_failed':
          sys(e.detail || 'Hata.', 'error');
          break;
        default:
          break;
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, [push, setPermissionState, sys]);

  const start = useCallback(async () => {
    setWorking('Sohbet oturumu açılıyor — izole çalışma alanı hazırlanıyor…');
    setItems([]);
    try {
      const res = await api()?.surgeryChatStart({ changeRequestId: changeRequestId || undefined, model });
      if (res?.success) {
        setLive(true);
        setBranch(res.branch);
        sys(`Oturum açık. Dal: ${res.branch} · Model: ${res.model}. Cerrah izole bir worktree'de çalışıyor; canlı dizine dokunmuyor.`, 'ok');
      } else {
        sys(res?.error || 'Oturum açılamadı.', 'error');
      }
    } finally {
      setWorking(null);
      onSessionChange?.();
    }
  }, [changeRequestId, model, sys, onSessionChange]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !live) return;
    setInput('');
    push({ type: 'user', id: nextId(), text, ts: Date.now() });
    setBusy(true);
    try {
      const res = await api()?.surgeryChatSend({ message: text });
      if (res?.success) {
        push({ type: 'assistant', id: nextId(), text: res.reply || '(cevap metni gelmedi)', ts: Date.now() });
      } else {
        sys(res?.error || 'Tur başarısız.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }, [input, busy, live, push, sys]);

  const respond = useCallback(async (permissionId: string, approved: boolean) => {
    // İyimser güncelleme: kullanıcı tıkladığı an kart kapanır, cerrah çözülür.
    setPermissionState(permissionId, approved ? 'approved' : 'rejected');
    const res = await api()?.surgeryRespondPermission({ permissionId, approved });
    if (!res?.success) sys(res?.error || 'Karar iletilemedi.', 'error');
  }, [setPermissionState, sys]);

  const finish = useCallback(async (apply: boolean) => {
    setWorking(apply ? 'Oturum kapatılıyor ve iş uygulanıyor…' : 'Oturum kapatılıyor…');
    try {
      const res = apply
        ? await api()?.surgeryChatEnd({ apply: true })
        : await api()?.surgeryChatAbort();
      if (!res?.success) sys(res?.error || 'Oturum kapatılamadı.', 'error');
      else if (!apply) sys('Oturum uygulanmadan kapatıldı. Dal Cerrahi Bakım ekranında duruyor.', 'info');
      setLive(false);
      setBranch(null);
    } finally {
      setWorking(null);
      onSessionChange?.();
    }
  }, [sys, onSessionChange]);

  const pendingCount = items.filter((i) => i.type === 'permission' && i.state === 'pending').length;

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Cerrahi Sohbet</h2>
          <p className="text-xs text-zinc-500">
            {live
              ? <>Oturum açık · <span className="font-mono text-amber-400/80">{branch}</span></>
              : 'Cerrahla konuş; her dosya yazma ve komut onayına sunulur.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              {pendingCount} onay bekliyor
            </span>
          )}
          {!live ? (
            <button
              onClick={start}
              disabled={!authenticated || working !== null}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              title={!authenticated ? 'Önce GitHub Copilot bağlantısını kur' : 'Sohbet oturumu başlat'}
            >
              <Play className="h-3.5 w-3.5" /> Oturumu Başlat
            </button>
          ) : (
            <>
              <button
                onClick={() => finish(true)}
                disabled={working !== null || busy}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-emerald-400 disabled:opacity-40"
                title="Commit → kapı → merge. Kapı BLOCK derse inmez."
              >
                <GitMerge className="h-3.5 w-3.5" /> Bitir ve Uygula
              </button>
              <button
                onClick={() => finish(false)}
                disabled={working !== null}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                title="Uygulamadan kapat; dal incelemede kalır"
              >
                <Square className="h-3.5 w-3.5" /> Uygulamadan Kapat
              </button>
            </>
          )}
        </div>
      </div>

      {working && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {working}
        </div>
      )}

      <div ref={scrollRef} className="max-h-[32rem] min-h-[14rem] space-y-3 overflow-auto p-4">
        {items.length === 0 && !live && (
          <p className="text-sm text-zinc-600">
            Oturum kapalı. "Oturumu Başlat" dedikten sonra cerrah ayrı bir çalışma alanında açılır;
            yazdığı her dosya için burada <span className="text-emerald-400">Onayla</span> /
            <span className="text-red-400"> Reddet</span> kartı çıkar.
          </p>
        )}

        {items.map((item) => {
          if (item.type === 'user') {
            return (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-amber-500/15 px-3 py-2 text-sm text-amber-50">
                  {item.text}
                </div>
              </div>
            );
          }
          if (item.type === 'assistant') {
            return (
              <div key={item.id} className="flex justify-start">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-bl-sm border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200">
                  {item.text}
                </div>
              </div>
            );
          }
          if (item.type === 'system') {
            const tone = item.tone === 'error' ? 'border-red-500/30 text-red-300'
              : item.tone === 'ok' ? 'border-emerald-500/30 text-emerald-300'
              : 'border-zinc-700 text-zinc-400';
            return (
              <div key={item.id} className={`rounded-lg border px-3 py-1.5 text-xs ${tone}`}>{item.text}</div>
            );
          }
          if (item.type === 'auto-deny') {
            return (
              <div key={item.id} className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-300/90">
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Otomatik red ({item.reason}):</strong> {item.target}
                  <span className="ml-1 text-red-300/60">— bu sınır onaya sunulmaz.</span>
                </span>
              </div>
            );
          }
          return (
            <PermissionCard
              key={item.id}
              payload={item.payload}
              state={item.state}
              onRespond={(approved) => respond(item.payload.permissionId, approved)}
            />
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cerrah çalışıyor…
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 p-3">
        {!authenticated && !live && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-amber-400/80">
            <ShieldAlert className="h-3.5 w-3.5" /> Sohbet için önce GitHub Copilot bağlantısı gerekiyor.
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            disabled={!live || busy}
            rows={2}
            placeholder={live ? 'Cerraha ne yapmasını istediğini yaz… (Enter gönderir, Shift+Enter satır atlar)' : 'Önce oturumu başlat.'}
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!live || busy || !input.trim()}
            className="flex h-[42px] items-center gap-1.5 rounded-lg bg-amber-500 px-4 text-xs font-semibold text-zinc-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" /> Gönder
          </button>
        </div>
      </div>
    </div>
  );
}
