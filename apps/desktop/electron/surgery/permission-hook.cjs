// ============================================================
// permission-hook.cjs — cerrah ajanı için canlı izin kapısı
// ============================================================
// Copilot SDK'nın onPermissionRequest kancasına takılır. Her tool çağrısı
// ÇALIŞMADAN ÖNCE buradan geçer; karar deterministiktir, LLM'e sorulmaz.
//
// Spike ile doğrulanan gerçek şekiller (dokümandan değil, paketten):
//   write -> { kind:"write", fileName, diff, requestSandboxBypass? }
//   read  -> { kind:"read",  path,  requestSandboxBypass? }
//   shell -> { kind:"shell", fullCommandText, possiblePaths[], requestSandboxBypass? }
//   url/mcp/memory/custom-tool/hook/extension...
// Karar: { kind:"reject", feedback } | { kind:"approve-once" }
//
// Bu kanca üç savunma katmanının ORTASIDIR:
//   1. CLI'ın kendi sandbox'ı (vendor)
//   2. BU kanca (oturum anında)
//   3. preflight merge kapısı (ajanın erişemediği yerde)
// Bu katman düşse bile 3. katman ayakta kalır.
//
// ── ETKİLEŞİMLİ MOD (askUser) ───────────────────────────────────────────
// `askUser` verildiğinde kanca ikiye ayrılır:
//
//   SERT RED KATMANI (asla sorulmaz, asla aşılamaz):
//     sandbox bypass · secret oku/yaz · korunan çekirdek dosyaya yazma ·
//     çalışma alanı dışı · yasak komut · eklenti yönetimi
//   Bu kararlar deterministiktir. Kullanıcıya SORULMAZ, çünkü sorulan her
//   şey er ya da geç onaylanır; güvenlik sınırı pazarlık konusu değildir.
//
//   ONAY KATMANI (kullanıcıya sorulur):
//     sert katmanı geçen write · shell · url · bilinmeyen tür
//   Bunlar etkileşimsiz modda sessizce ONAYLANIYORDU. Etkileşimli modda
//   VS Code Copilot davranışı uygulanır: kullanıcı diff'i/komutu görür,
//   Onayla veya Reddet der.
//
//   OKUMA hiçbir modda sorulmaz: cerrahın kodu görmesi işin ön koşulu ve
//   her okuma için onay istemek arayüzü kullanılamaz hâle getirir. Secret
//   okuma zaten sert katmanda reddedilir.
//
// DÖNÜŞ TÜRÜ: askUser YOKSA handler senkron nesne döndürür (mevcut davranış
// birebir korunur). askUser VARSA onay katmanına düşen istekler Promise
// döndürür; sert red kararları o modda da senkron döner.

const {
  isProtectedPath,
  isSecretPath,
  isForbiddenCommand,
  toRepoRelative,
} = require('./protected-paths.cjs');

// isAllowedReadEscape aşağıda isSecretPath'i kullanır; import sırası önemli.

const reject = (feedback) => ({ kind: 'reject', feedback });
const approve = () => ({ kind: 'approve-once' });

// ── Çalışma alanı dışı OKUMA istisnaları ────────────────────────────────
// Git worktree'nin yapısal gerçeği: `.git` bir DOSYADIR ve ana repodaki
// `.git/worktrees/<id>` dizinini gösterir. Yani her git işlemi worktree
// DIŞINI okumak zorundadır. Bunu topyekûn reddetmek cerrahı commit
// yapamaz hâle getirir — canlı testte 4 kez "out-of-workspace" reddi
// alınmasının sebebi buydu.
//
// Bu yüzden dar bir OKUMA istisnası tanımlanır. Yazma istisnası YOKTUR:
// worktree dışına yazma her koşulda reddedilir.
//
// .env ve secret dosyaları bu listeye girmez; onlar ayrıca ve her zaman
// reddedilir (isSecretPath).
const READ_ESCAPE_ALLOWLIST = [
  /(^|[/\\])\.git([/\\]|$)/i,        // git plumbing (objects, refs, worktrees)
  /(^|[/\\])node_modules([/\\]|$)/i, // bağımlılıklar (araç çalıştırma)
];

/**
 * MUTLAK yol için secret kontrolü.
 *
 * DİKKAT: isSecretPath repo-GÖRELİ yollar için yazılmıştır; `.env` deseni
 * `^` ile başa sabitlidir. Mutlak yol verildiğinde (`/repo/node_modules/.env`)
 * eşleşmez ve secret sızabilir — bu açığı kendi testimiz yakaladı.
 * Bu yüzden yolun her son-ek kombinasyonu ayrıca denenir.
 */
function looksSecretAbsolute(absolutePath) {
  const p = String(absolutePath || '').replace(/\\/g, '/');
  if (!p) return false;
  if (isSecretPath(p)) return true;
  const parts = p.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    if (isSecretPath(parts.slice(i).join('/'))) return true;
  }
  return false;
}

function isAllowedReadEscape(absolutePath) {
  const p = String(absolutePath || '').replace(/\\/g, '/');
  if (!p) return false;
  // Güvenlik: istisna listesi secret kontrolünü ASLA geçersiz kılmaz.
  if (looksSecretAbsolute(p)) return false;
  return READ_ESCAPE_ALLOWLIST.some((pattern) => pattern.test(p));
}

/** askUser yanıtı gelmezse bekleyen istek sonsuza kadar asılı kalmasın. */
const DEFAULT_ASK_TIMEOUT_MS = 20 * 60 * 1000;

/** UI'a taşınan diff sınırı; dev diff'ler arayüzü boğmasın. */
const MAX_ASK_DIFF_CHARS = 20000;

function clip(text, max = MAX_ASK_DIFF_CHARS) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} karakter kırpıldı)` : s;
}

/**
 * askUser sözünü zaman aşımına bağlar. Zaman aşımı REDDE düşer, onaya değil:
 * cevapsızlık onay sayılamaz.
 */
function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ASK_TIMEOUT')), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * @param {object} options
 * @param {string} options.worktreeRoot Cerrahın çalışma alanı (mutlak yol)
 * @param {(decision:object)=>void} [options.onDecision] Denetim kaydı callback'i
 * @param {(ask:object)=>Promise<{approved:boolean, feedback?:string}>} [options.askUser]
 *        Verilirse etkileşimli mod açılır: onay katmanı kullanıcıya sorulur.
 * @param {number} [options.askTimeoutMs] Yanıtsız kalan istek için üst sınır (varsayılan 20 dk)
 * @returns {(request:object, invocation?:object)=>object|Promise<object>} onPermissionRequest handler
 */
function buildPermissionHandler(options = {}) {
  const worktreeRoot = options.worktreeRoot;
  const onDecision = typeof options.onDecision === 'function' ? options.onDecision : () => {};
  const askUser = typeof options.askUser === 'function' ? options.askUser : null;
  const askTimeoutMs = options.askTimeoutMs === undefined ? DEFAULT_ASK_TIMEOUT_MS : options.askTimeoutMs;

  const decide = (request, verdict, reason, target) => {
    onDecision({
      kind: request?.kind,
      decision: verdict.kind,
      reason,
      // Hedef HER ZAMAN kaydedilir: "reject" görüp neyin reddedildiğini
      // bilememek teşhisi imkânsız kılıyordu.
      target: target || request?.fileName || request?.path || request?.fullCommandText || request?.toolName || null,
      ts: Date.now(),
    });
    return verdict;
  };

  /**
   * Sert katmanı geçmiş bir isteği kullanıcıya sorar.
   * askUser yoksa mevcut (sessiz onay) davranış aynen sürer.
   * @returns {object|Promise<object>}
   */
  const gate = (request, reason, target, summary) => {
    if (!askUser) return decide(request, approve(), reason, target);

    const ask = {
      kind: request?.kind || 'unknown',
      reason,                       // hangi deterministik kontrolleri geçtiği
      target: target ?? null,
      // SDK her izin isteğine "neden" metni koyar (PermissionRequest.intention).
      // Onay kartında en değerli alan bu: kullanıcı diff'i okumadan niyeti görür.
      intention: request?.intention ? clip(String(request.intention), 500) : null,
      ...summary,
    };

    return withTimeout(askUser(ask), askTimeoutMs).then(
      (answer) => {
        if (answer && answer.approved === true) {
          return decide(request, approve(), `user-approved:${reason}`, target);
        }
        const feedback = (answer && typeof answer.feedback === 'string' && answer.feedback.trim())
          ? answer.feedback.trim()
          : 'Kullanıcı bu işlemi reddetti. Kapsamı daralt veya farklı bir yol öner.';
        return decide(request, reject(feedback), `user-rejected:${reason}`, target);
      },
      (err) => {
        // Zaman aşımı ve kanal hatası REDDE düşer. Cevapsızlık onay değildir.
        const timedOut = err?.message === 'ASK_TIMEOUT';
        return decide(
          request,
          reject(timedOut
            ? 'Kullanıcı süresi içinde yanıt vermedi; işlem reddedildi.'
            : 'Onay kanalı kapalı; işlem reddedildi.'),
          timedOut ? 'ask-timeout' : 'ask-failed',
          target,
        );
      },
    );
  };

  return function onPermissionRequest(request) {
    const kind = request?.kind;

    // Sandbox bypass talebi HER TÜR için kesin red: CLI'ın kendi kumunu
    // (1. katman) devre dışı bırakmaya asla izin verilmez.
    if (request && request.requestSandboxBypass === true) {
      return decide(request, reject('Sandbox bypass reddedildi — CLI izolasyonu korunur.'), 'sandbox-bypass');
    }

    switch (kind) {
      case 'write': {
        const rel = toRepoRelative(worktreeRoot, request.fileName);
        if (rel === null) {
          return decide(request, reject('Çalışma alanı dışına yazma reddedildi.'), 'out-of-workspace');
        }
        if (isSecretPath(rel)) {
          return decide(request, reject('Secret/kimlik dosyasına yazma reddedildi.'), 'secret-write');
        }
        if (isProtectedPath(rel)) {
          return decide(request, reject('Korunan çekirdek dosyaya yazma mimari inceleme gerektirir.'), 'protected-write');
        }
        // Sert katman temiz: karar kullanıcınındır.
        return gate(request, 'ok', rel, { file: rel, diff: clip(request.diff) });
      }

      case 'read': {
        const rel = toRepoRelative(worktreeRoot, request.path);
        if (rel === null) {
          // Worktree dışı okuma: yalnız git plumbing ve node_modules serbest.
          if (isAllowedReadEscape(request.path)) {
            return decide(request, approve(), 'read-escape-allowed', request.path);
          }
          return decide(request, reject('Çalışma alanı dışından okuma reddedildi.'), 'out-of-workspace', request.path);
        }
        if (isSecretPath(rel)) {
          return decide(request, reject('Secret/kimlik dosyası okunamaz.'), 'secret-read', rel);
        }
        // Korunan dosyaların OKUNMASI serbest (cerrahın uyum için görmesi gerekir);
        // yazma zaten yukarıda engelli. Yalnız secret okuma kapalı.
        return decide(request, approve(), 'ok');
      }

      case 'shell': {
        if (isForbiddenCommand(request.fullCommandText)) {
          return decide(request, reject('Uzak depoya yazma/yayınlama/indir-çalıştır komutları yasak.'), 'forbidden-command');
        }
        const paths = Array.isArray(request.possiblePaths) ? request.possiblePaths : [];
        for (const p of paths) {
          const rel = toRepoRelative(worktreeRoot, p);
          if (rel === null) {
            // git worktree'de `.git` ana repoyu gösterir; komutlar zorunlu
            // olarak dışarı bakar. Dar istisna olmadan cerrah commit atamaz.
            if (isAllowedReadEscape(p)) continue;
            return decide(request, reject(`Komut çalışma alanı dışına dokunuyor: ${p}`), 'shell-out-of-workspace', p);
          }
          if (isSecretPath(rel)) {
            return decide(request, reject('Komut secret dosyasına dokunuyor.'), 'shell-secret', rel);
          }
          if (isProtectedPath(rel)) {
            return decide(request, reject('Komut korunan çekirdek dosyaya dokunuyor.'), 'shell-protected', rel);
          }
        }
        return gate(request, 'ok', request.fullCommandText, {
          command: clip(request.fullCommandText, 4000),
          paths: paths.slice(0, 20),
        });
      }

      case 'url': {
        // Ağ erişimi cerrahi sırasında istisnadır. Etkileşimsiz modda izinli
        // (kaydedilir); etkileşimli modda kullanıcıya sorulur.
        const url = request.url || request.uri || request.host || null;
        return gate(request, 'url-allowed', url, { url });
      }

      case 'extension-management':
      case 'extension-permission-access':
        // Eklenti kurma/izin yükseltme cerrahi kapsamı dışıdır.
        return decide(request, reject('Eklenti yönetimi cerrahi oturumda reddedilir.'), 'extension-blocked');

      default:
        // mcp / memory / custom-tool / hook / bilinmeyen: kaydet ve izin ver.
        // Bilinmeyen türde fail-open DEĞİL fail-observed: kararı denetime yaz.
        // Etkileşimli modda bir adım ileri gidilir — bilinmeyen tür kullanıcıya
        // sorulur (fail-asked): tanımadığımız bir yeteneği sessizce açmayalım.
        return gate(request, `default-allow:${kind || 'unknown'}`, request?.toolName || null, {
          toolName: request?.toolName || null,
        });
    }
  };
}

module.exports = {
  buildPermissionHandler,
  DEFAULT_ASK_TIMEOUT_MS,
  MAX_ASK_DIFF_CHARS,
};
