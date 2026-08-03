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

const {
  isProtectedPath,
  isSecretPath,
  isForbiddenCommand,
  toRepoRelative,
} = require('./protected-paths.cjs');

const reject = (feedback) => ({ kind: 'reject', feedback });
const approve = () => ({ kind: 'approve-once' });

/**
 * @param {object} options
 * @param {string} options.worktreeRoot Cerrahın çalışma alanı (mutlak yol)
 * @param {(decision:object)=>void} [options.onDecision] Denetim kaydı callback'i
 * @returns {(request:object, invocation?:object)=>object} onPermissionRequest handler
 */
function buildPermissionHandler(options = {}) {
  const worktreeRoot = options.worktreeRoot;
  const onDecision = typeof options.onDecision === 'function' ? options.onDecision : () => {};

  const decide = (request, verdict, reason) => {
    onDecision({
      kind: request?.kind,
      decision: verdict.kind,
      reason,
      target: request?.fileName || request?.path || request?.fullCommandText || request?.toolName || null,
      ts: Date.now(),
    });
    return verdict;
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
        return decide(request, approve(), 'ok');
      }

      case 'read': {
        const rel = toRepoRelative(worktreeRoot, request.path);
        if (rel === null) {
          return decide(request, reject('Çalışma alanı dışından okuma reddedildi.'), 'out-of-workspace');
        }
        if (isSecretPath(rel)) {
          return decide(request, reject('Secret/kimlik dosyası okunamaz.'), 'secret-read');
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
            return decide(request, reject('Komut çalışma alanı dışına dokunuyor.'), 'shell-out-of-workspace');
          }
          if (isSecretPath(rel)) {
            return decide(request, reject('Komut secret dosyasına dokunuyor.'), 'shell-secret');
          }
          if (isProtectedPath(rel)) {
            return decide(request, reject('Komut korunan çekirdek dosyaya dokunuyor.'), 'shell-protected');
          }
        }
        return decide(request, approve(), 'ok');
      }

      case 'url':
        // Ağ erişimi cerrahi sırasında istisnadır; şimdilik izinli ama kaydedilir
        // (ileride allowlist ile daraltılabilir).
        return decide(request, approve(), 'url-allowed');

      case 'extension-management':
      case 'extension-permission-access':
        // Eklenti kurma/izin yükseltme cerrahi kapsamı dışıdır.
        return decide(request, reject('Eklenti yönetimi cerrahi oturumda reddedilir.'), 'extension-blocked');

      default:
        // mcp / memory / custom-tool / hook / bilinmeyen: kaydet ve izin ver.
        // Bilinmeyen türde fail-open DEĞİL fail-observed: kararı denetime yaz.
        return decide(request, approve(), `default-allow:${kind || 'unknown'}`);
    }
  };
}

module.exports = { buildPermissionHandler };
