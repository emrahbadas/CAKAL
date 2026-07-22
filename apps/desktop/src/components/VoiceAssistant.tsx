import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Mic, MicOff, Hand, X, GripHorizontal } from 'lucide-react';

/**
 * Sesli Asistan Overlay — Mark-XLIX (BİNNAZ) görsel diline benzeyen
 * canvas visualizer + konuşarak chat'e yazma.
 *
 * Token ekonomisi kuralları (kritik):
 * - STT yalnızca mikrofon AÇIK ve gerçek konuşma segmenti yakalandığında çağrılır
 *   (yerel VAD; sürekli stream YOK).
 * - Kullanıcı chatbox'a elle yazarsa STT devreye girmez; sadece cevap TTS ile okunur.
 * - Overlay kapatılınca her şey (mic, ses, bekleyen istekler) tamamen durur —
 *   sıfır token.
 */

export interface VoiceAssistantHandle {
  /** Asistan cevabını sesli oku (overlay açıksa). */
  speak: (text: string) => void;
}

interface VoiceAssistantProps {
  busy: boolean; // commander düşünüyor (isLoading)
  onClose: () => void;
  onTranscript: (text: string) => void; // konuşma → chat'e gönder
}

type VoiceState = 'standby' | 'listening' | 'transcribing' | 'speaking';

// Mark-XLIX paleti
const COLORS = {
  pri: '#ff2ed2',
  priDim: 'rgba(255,46,210,0.35)',
  acc: '#ff9d2e',
  green: '#2eff9d',
  cyan: '#7de8ff',
  coreBlue: '#0a3a5c',
  bg: 'rgba(13,2,16,0.96)',
};

// Daha hassas eşikler: cümle sonundaki kısık heceler sessizlik sayılıp kaydın
// erken kesilmesine yol açıyordu ("Gördün mü?" -> "Görmek." gibi).
const VAD_START_RMS = 0.012;
const VAD_STOP_RMS = 0.007;
const VAD_SILENCE_MS = 1400;
const VAD_MIN_UTTERANCE_MS = 400;
const VAD_MAX_UTTERANCE_MS = 30000;

// Yankı önleme: TTS bittikten sonra odadaki ses kuyruğu (tail) mikrofona
// dönebilir; bu süre boyunca VAD tetiklenmez. Ek olarak TTS penceresine denk
// gelen transkriptler son okunan cevapla karşılaştırılır — kelime örtüşmesi
// eşiği aşarsa transkript asistanın kendi sesi sayılıp atılır.
const ECHO_TAIL_COOLDOWN_MS = 600;
const ECHO_TEXT_WINDOW_MS = 1500;
const ECHO_OVERLAP_THRESHOLD = 0.7;

function normalizeEchoWords(text: string): string[] {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[.,!?;:'"()[\]*_`~-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Transkript kelimelerinin ne kadarı son TTS metninde geçiyor (0..1). */
function echoOverlapRatio(transcript: string, spoken: string): number {
  const words = normalizeEchoWords(transcript);
  if (words.length === 0) return 0;
  const spokenSet = new Set(normalizeEchoWords(spoken));
  const hits = words.filter((word) => spokenSet.has(word)).length;
  return hits / words.length;
}

// Tek kelimelik transkriptlerde chat'e otomatik gönderim yapılmaz (yanlış
// duyma → pahalı tarama riskine karşı). Bu kısa onay/kontrol kelimeleri istisna.
const SHORT_UTTERANCE_WHITELIST = new Set([
  'evet', 'hayır', 'hayir', 'tamam', 'olur', 'dur', 'iptal', 'devam', 'başla', 'basla', 'onayla', 'reddet',
]);
const BAR_COUNT = 28;
const CANVAS_SIZE = 280;

const VoiceAssistant = forwardRef<VoiceAssistantHandle, VoiceAssistantProps>(
  function VoiceAssistant({ busy, onClose, onTranscript }, ref) {
    const [micOn, setMicOn] = useState(true);
    const [voiceState, setVoiceState] = useState<VoiceState>('standby');
    const [lastHeard, setLastHeard] = useState('');
    const [errorText, setErrorText] = useState('');

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const playbackRef = useRef<HTMLAudioElement | null>(null);
    // Uzun cevaplar TTS'ten parça parça gelir; sırada bekleyen blob URL'leri.
    const ttsQueueRef = useRef<string[]>([]);
    const closedRef = useRef(false);
    const vadRef = useRef({ speaking: false, silenceStart: 0, utteranceStart: 0 });

    // Yankı önleme durumu: asistan konuşurken zorla durdurulan kayıtlar çözümlenmez;
    // TTS bitiş zamanı ve son okunan metin echo filtresinde kullanılır.
    const discardRecordingRef = useRef(false);
    const ttsEndAtRef = useRef(0);
    const lastTtsTextRef = useRef('');

    // Durum ref'leri — VAD döngüsü ve speak() closure'ları güncel değeri görsün.
    const voiceStateRef = useRef<VoiceState>('standby');
    const micOnRef = useRef(true);
    const busyRef = useRef(busy);
    useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
    useEffect(() => { micOnRef.current = micOn; }, [micOn]);
    useEffect(() => { busyRef.current = busy; }, [busy]);

    const setState = useCallback((s: VoiceState) => {
      voiceStateRef.current = s;
      setVoiceState(s);
    }, []);

    // ── Konuşma segmentini API'ye gönder ──
    const finalizeUtterance = useCallback(async (blob: Blob, durationMs: number) => {
      if (closedRef.current || durationMs < VAD_MIN_UTTERANCE_MS) {
        // 'speaking' durumunu asla ezme: TTS çalarken listening'e dönmek
        // mikrofonun asistanın kendi sesini kaydetmesine (yankı) yol açar.
        if (micOnRef.current && voiceStateRef.current !== 'speaking') setState('listening');
        return;
      }
      setState('transcribing');
      try {
        const buf = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const result = await window.cakalAPI.voiceTranscribe(btoa(binary), blob.type || 'audio/webm');
        if (closedRef.current) return;
        const text = (result?.text || '').trim();

        // Yankı filtresi: kayıt TTS penceresine denk geldiyse ve transkript
        // son okunan cevapla yüksek oranda örtüşüyorsa bu asistanın kendi sesidir.
        const startedNearTts = vadRef.current.utteranceStart - ttsEndAtRef.current < ECHO_TEXT_WINDOW_MS;
        const isSelfEcho =
          !!text &&
          !!lastTtsTextRef.current &&
          (voiceStateRef.current === 'speaking' || startedNearTts) &&
          echoOverlapRatio(text, lastTtsTextRef.current) >= ECHO_OVERLAP_THRESHOLD;

        if (isSelfEcho) {
          setLastHeard(text);
          setErrorText('Yankı algılandı — kendi cevabımı duydum, chat\'e yazmadım.');
        } else if (result?.success && text.length >= 2) {
          const words = text.split(/\s+/).filter(Boolean);
          const isShortAmbiguous =
            words.length === 1 && !SHORT_UTTERANCE_WHITELIST.has(words[0].toLocaleLowerCase('tr-TR').replace(/[.,!?]/g, ''));
          if (isShortAmbiguous) {
            // Tek belirsiz kelime → gönderme; kullanıcıya duyduğunu göster.
            setLastHeard(text);
            setErrorText(`"${text}" — tek kelime, göndermedim. Tam cümle söyle ya da yaz.`);
          } else {
            setErrorText('');
            setLastHeard(text);
            onTranscript(text);
            // busy=true olacak; görsel THINKING'e geçer. Mic, cevap okunana kadar bekler.
          }
        } else if (result?.success && !text) {
          setErrorText('Anlaşılmadı — biraz daha yüksek sesle ve net söyler misin?');
        } else if (!result?.success) {
          setErrorText(result?.error || 'Ses çözümlenemedi');
        }
      } catch (err) {
        setErrorText(err instanceof Error ? err.message : 'STT hatası');
      }
      if (!closedRef.current && micOnRef.current && voiceStateRef.current !== 'speaking') setState('listening');
    }, [onTranscript, setState]);

    // ── Mikrofon + VAD ──
    useEffect(() => {
      closedRef.current = false;
      if (!micOn) {
        setState('standby');
        return;
      }
      let cancelled = false;
      let vadTimer: ReturnType<typeof setInterval> | null = null;

      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = stream;

          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          analyserRef.current = analyser;
          setState('listening');

          const timeData = new Float32Array(analyser.fftSize);
          vadTimer = setInterval(() => {
            if (closedRef.current || !micOnRef.current) return;
            // Asistan konuşurken / düşünürken / çözümlerken kayıt alma (echo + gereksiz STT önlemi)
            const st = voiceStateRef.current;
            if (st === 'speaking' || st === 'transcribing' || busyRef.current) {
              if (recorderRef.current?.state === 'recording') {
                vadRef.current.speaking = false;
                // Bu kayıt asistanın konuşma/işleme penceresine denk geldi:
                // çözümlenirse yankı olarak chat'e düşer — onstop'ta atılacak.
                discardRecordingRef.current = true;
                recorderRef.current.stop();
              }
              return;
            }

            analyser.getFloatTimeDomainData(timeData);
            let sum = 0;
            for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
            const rms = Math.sqrt(sum / timeData.length);
            const now = Date.now();
            const vad = vadRef.current;

            if (!vad.speaking && rms > VAD_START_RMS) {
              // TTS bittikten hemen sonraki oda yankısı kuyruğunda kayda başlama.
              if (now - ttsEndAtRef.current < ECHO_TAIL_COOLDOWN_MS) return;
              vad.speaking = true;
              vad.utteranceStart = now;
              vad.silenceStart = 0;
              chunksRef.current = [];
              discardRecordingRef.current = false;
              const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
              recorderRef.current = rec;
              rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
              rec.onstop = () => {
                if (discardRecordingRef.current) {
                  // Asistan konuşurken zorla durdurulan kayıt: yankı, çözümleme.
                  discardRecordingRef.current = false;
                  chunksRef.current = [];
                  return;
                }
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const dur = Date.now() - vad.utteranceStart;
                finalizeUtterance(blob, dur);
              };
              rec.start();
            } else if (vad.speaking) {
              const tooLong = now - vad.utteranceStart > VAD_MAX_UTTERANCE_MS;
              if (rms < VAD_STOP_RMS) {
                if (!vad.silenceStart) vad.silenceStart = now;
                if (now - vad.silenceStart > VAD_SILENCE_MS || tooLong) {
                  vad.speaking = false;
                  if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
                }
              } else {
                vad.silenceStart = 0;
                if (tooLong) {
                  vad.speaking = false;
                  if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
                }
              }
            }
          }, 60);
        } catch (err) {
          setErrorText('Mikrofon açılamadı: ' + (err instanceof Error ? err.message : ''));
          setState('standby');
        }
      })();

      return () => {
        cancelled = true;
        if (vadTimer) clearInterval(vadTimer);
        if (recorderRef.current?.state === 'recording') { try { recorderRef.current.stop(); } catch { /* noop */ } }
        recorderRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        analyserRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
      };
    }, [micOn, finalizeUtterance, setState]);

    // ── TTS okuma ──
    const stopSpeaking = useCallback(() => {
      // Sıradaki parçaları da iptal et — KES tek parçayı değil tüm cevabı keser.
      ttsQueueRef.current.forEach((url) => URL.revokeObjectURL(url));
      ttsQueueRef.current = [];
      if (playbackRef.current) {
        playbackRef.current.pause();
        playbackRef.current = null;
      }
      ttsEndAtRef.current = Date.now();
      if (!closedRef.current) setState(micOnRef.current ? 'listening' : 'standby');
    }, [setState]);

    useImperativeHandle(ref, () => ({
      speak: (text: string) => {
        if (closedRef.current || !text) return;
        setState('speaking');
        // Echo filtresi bu metinle karşılaştırır; TTS fetch'i sürerken de armed olsun.
        lastTtsTextRef.current = text;
        window.cakalAPI.voiceTts(text).then((result) => {
          if (closedRef.current) return;
          // Uzun cevaplar birden çok ses parçası olarak gelir; sırayla çalınır.
          const base64Chunks: string[] =
            result?.success && Array.isArray(result.audioChunks) && result.audioChunks.length
              ? result.audioChunks
              : result?.success && result.audioBase64
                ? [result.audioBase64]
                : [];
          if (!base64Chunks.length) {
            setErrorText(result?.error || 'TTS başarısız');
            setState(micOnRef.current ? 'listening' : 'standby');
            return;
          }
          // data: URI yerine blob URL — büyük base64 URI'ler ve CSP ile daha uyumlu.
          const urls = base64Chunks.map((b64) => {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            return URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'audio/mpeg' }));
          });
          ttsQueueRef.current = urls;
          const playNext = () => {
            const nextUrl = ttsQueueRef.current.shift();
            if (!nextUrl || closedRef.current) {
              ttsQueueRef.current.forEach((url) => URL.revokeObjectURL(url));
              ttsQueueRef.current = [];
              playbackRef.current = null;
              ttsEndAtRef.current = Date.now();
              if (!closedRef.current) setState(micOnRef.current ? 'listening' : 'standby');
              return;
            }
            const audio = new Audio(nextUrl);
            playbackRef.current = audio;
            const finishChunk = () => {
              URL.revokeObjectURL(nextUrl);
              playNext();
            };
            audio.onended = finishChunk;
            audio.onerror = () => { setErrorText('Ses çalınamadı (audio error)'); finishChunk(); };
            audio.play().catch((err) => { setErrorText('Ses çalınamadı: ' + (err?.message || '')); finishChunk(); });
          };
          playNext();
        }).catch(() => {
          if (!closedRef.current) setState(micOnRef.current ? 'listening' : 'standby');
        });
      },
    }), [setState]);

    // ── Kapatma: tam teardown, sıfır token ──
    const handleClose = useCallback(() => {
      closedRef.current = true;
      stopSpeaking();
      onClose();
    }, [onClose, stopSpeaking]);

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [handleClose]);

    // ── Taşınabilir panel — başlık çubuğundan sürüklenir ──
    const [pos, setPos] = useState(() => ({
      x: Math.max(16, window.innerWidth - 380),
      y: 72,
    }));
    const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
    const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
      dragOffsetRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const off = dragOffsetRef.current;
      if (!off) return;
      setPos({
        x: Math.min(Math.max(e.clientX - off.dx, -260), window.innerWidth - 80),
        y: Math.min(Math.max(e.clientY - off.dy, 0), window.innerHeight - 48),
      });
    };
    const onDragEnd = () => { dragOffsetRef.current = null; };

    // ── Canvas visualizer (Mark-XLIX HudCanvas'ın React/canvas yorumu) ──
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const size = CANVAS_SIZE;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.scale(dpr, dpr);
      const cx = size / 2;
      const cy = size / 2 - 8;

      const rings = [0, 120, 240];
      let scan = 0;
      let scan2 = 180;
      const pulses: Array<{ r: number; alpha: number }> = [];
      let bars = new Array(BAR_COUNT).fill(2);
      let lastBarUpdate = 0;
      let raf = 0;

      const draw = (t: number) => {
        const state = voiceStateRef.current;
        const displayBusy = busyRef.current && state !== 'speaking';
        const active = state === 'speaking' || state === 'transcribing' || displayBusy;

        ctx.clearRect(0, 0, size, size);

        // Çekirdek — mavi radial glow
        const coreR = size * 0.28;
        const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, coreR);
        grad.addColorStop(0, '#06121f');
        grad.addColorStop(0.55, COLORS.coreBlue);
        grad.addColorStop(1, 'rgba(10,58,92,0.05)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fill();

        // Merkez isim
        ctx.font = '600 13px "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.pri;
        ctx.shadowColor = COLORS.pri;
        ctx.shadowBlur = 10;
        ctx.fillText('ÇAKAL', cx, cy + 5);
        ctx.shadowBlur = 0;

        // Nabız halkaları
        if (pulses.length < 3 && Math.random() < (active ? 0.07 : 0.025)) {
          pulses.push({ r: coreR + 4, alpha: 0.55 });
        }
        const pulseSpeed = active ? 1.6 : 0.8;
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.r += pulseSpeed;
          p.alpha -= 0.008;
          if (p.alpha <= 0 || p.r > size / 2) { pulses.splice(i, 1); continue; }
          ctx.strokeStyle = `rgba(255,46,210,${p.alpha.toFixed(3)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(cx, cy, p.r, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Dönen yay halkaları (3 halka, segmentli)
        const ringSpecs = [
          { frac: 0.62, width: 2.2, arc: 70, gap: 50 },
          { frac: 0.74, width: 1.4, arc: 40, gap: 80 },
          { frac: 0.86, width: 2.8, arc: 100, gap: 30 },
        ];
        const speeds = active ? [1.3, -0.9, 2.0] : [0.55, -0.35, 0.9];
        ringSpecs.forEach((spec, i) => {
          rings[i] = (rings[i] + speeds[i]) % 360;
          const r = (size / 2) * spec.frac * 0.92;
          ctx.strokeStyle = i === 1 ? COLORS.priDim : COLORS.pri;
          ctx.lineWidth = spec.width;
          let angle = rings[i];
          while (angle < rings[i] + 360) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, (angle * Math.PI) / 180, ((angle + spec.arc) * Math.PI) / 180);
            ctx.stroke();
            angle += spec.arc + spec.gap;
          }
        });

        // Tarama yayları
        const scanR = (size / 2) * 0.95 * 0.92;
        const extent = active ? 75 : 44;
        scan = (scan + (active ? 3.0 : 1.3)) % 360;
        scan2 = (scan2 - (active ? 2.0 : 0.75) + 360) % 360;
        ctx.lineWidth = 3;
        ctx.strokeStyle = state === 'speaking' ? COLORS.acc : COLORS.pri;
        ctx.beginPath();
        ctx.arc(cx, cy, scanR, (scan * Math.PI) / 180, ((scan + extent) * Math.PI) / 180);
        ctx.stroke();
        ctx.strokeStyle = COLORS.priDim;
        ctx.beginPath();
        ctx.arc(cx, cy, scanR, (scan2 * Math.PI) / 180, ((scan2 + extent) * Math.PI) / 180);
        ctx.stroke();

        // Kadran çentikleri
        ctx.strokeStyle = 'rgba(255,46,210,0.4)';
        ctx.lineWidth = 1;
        for (let deg = 0; deg < 360; deg += 12) {
          const rad = (deg * Math.PI) / 180;
          const r1 = (size / 2) * 0.98 * 0.92;
          const r2 = r1 - (deg % 60 === 0 ? 9 : 4);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
          ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2);
          ctx.stroke();
        }

        // Ses barları — dinlerken gerçek mic seviyesi, konuşurken canlı rastgele,
        // düşünürken dalga animasyonu: görsel HER durumda hareketli.
        const barUpdateMs = state === 'speaking' ? 90 : state === 'listening' ? 60 : 140;
        if (t - lastBarUpdate > barUpdateMs) {
          lastBarUpdate = t;
          if (state === 'listening' && analyserRef.current) {
            const freq = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(freq);
            bars = bars.map((_, i) => {
              const v = freq[Math.floor((i / BAR_COUNT) * freq.length * 0.6)] || 0;
              return 2 + (v / 255) * 26;
            });
          } else if (state === 'speaking') {
            bars = bars.map(() => 3 + Math.random() * 26);
          } else if (displayBusy || state === 'transcribing') {
            bars = bars.map((_, i) => 4 + 12 * Math.abs(Math.sin(t / 300 + i * 0.4)));
          } else {
            bars = bars.map(() => 2 + Math.random() * 3);
          }
        }
        const barW = 5;
        const totalW = BAR_COUNT * (barW + 2);
        const barY = size - 18;
        bars.forEach((h, i) => {
          ctx.fillStyle = state === 'speaking' ? COLORS.acc : COLORS.pri;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(cx - totalW / 2 + i * (barW + 2), barY - Math.min(h, 22), barW, Math.min(h, 22));
        });
        ctx.globalAlpha = 1;

        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }, []);

    // Durum etiketi
    const displayBusy = busy && voiceState !== 'speaking';
    let statusText = '● STANDBY';
    let statusColor = '#8a7090';
    if (voiceState === 'speaking') { statusText = '● SPEAKING'; statusColor = COLORS.acc; }
    else if (voiceState === 'transcribing') { statusText = '◐ ÇÖZÜMLENİYOR'; statusColor = COLORS.cyan; }
    else if (displayBusy) { statusText = '◐ THINKING'; statusColor = COLORS.cyan; }
    else if (voiceState === 'listening') { statusText = '● LISTENING'; statusColor = COLORS.green; }

    return (
      <div
        className="fixed z-50 w-[340px] select-none overflow-hidden rounded-2xl border shadow-2xl shadow-black/60"
        style={{ left: pos.x, top: pos.y, background: COLORS.bg, borderColor: 'rgba(255,46,210,0.35)' }}
      >
        {/* Başlık çubuğu — buradan sürükle */}
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          className="flex cursor-grab items-center justify-between border-b px-3 py-2 active:cursor-grabbing"
          style={{ borderColor: 'rgba(255,46,210,0.25)' }}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal size={14} className="text-zinc-600" />
            <span className="font-mono text-xs font-bold tracking-[0.25em]" style={{ color: COLORS.pri, textShadow: `0 0 10px ${COLORS.pri}` }}>
              ÇAKAL · SESLİ ASİSTAN
            </span>
          </div>
          <button onClick={handleClose} title="Kapat [ESC]" className="text-zinc-500 transition-colors hover:text-rose-400">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2 px-4 pb-3 pt-1">
          <canvas ref={canvasRef} style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }} />

          <div className="font-mono text-xs font-bold tracking-[0.3em] animate-pulse" style={{ color: statusColor }}>
            {statusText}
          </div>

          {lastHeard && (
            <div className="max-w-full truncate text-[11px] text-zinc-500">🎙 “{lastHeard}”</div>
          )}
          {errorText && (
            <div className="max-w-full truncate text-[11px] text-rose-400" title={errorText}>{errorText}</div>
          )}

          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => setMicOn((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[10px] tracking-wider ${
                micOn
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
              }`}
            >
              {micOn ? <Mic size={12} /> : <MicOff size={12} />}
              {micOn ? 'MİK AÇIK' : 'MİK KAPALI'}
            </button>
            <button
              onClick={stopSpeaking}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 font-mono text-[10px] tracking-wider text-rose-300"
            >
              <Hand size={12} /> KES
            </button>
          </div>

          <div className="text-center text-[9px] leading-4 text-zinc-600">
            Konuşman chat'e yazılır · elle yazarsan sadece cevap okunur<br />kapatınca ses işleme tamamen durur
          </div>
        </div>
      </div>
    );
  },
);

export default VoiceAssistant;
