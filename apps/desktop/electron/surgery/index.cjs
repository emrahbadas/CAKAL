// ============================================================
// surgery/index.cjs — cerrahi bakım hattı giriş noktası
// ============================================================
// SurgicalAgentProvider sözleşmesi (tek somut adaptör: Copilot).
// İkinci sağlayıcı gerçekten gerektiğinde arayüz buradan soyutlanır;
// şimdilik erken soyutlama yapılmaz.
//
// SÖZLEŞME (JSDoc typedef — çalışma zamanı zorlaması yok, belge amaçlı):
//
// @typedef {object} SurgicalAgentProvider
// @property {() => Promise<{authenticated:boolean}>} connect
// @property {(params:object) => Promise<object>} runSurgery
// @property {() => Promise<void>} abort
// @property {() => Promise<void>} disconnect

const { CopilotSurgeon } = require('./copilot-surgeon.cjs');
const handoff = require('./handoff.cjs');
const protectedPaths = require('./protected-paths.cjs');
const { buildPermissionHandler } = require('./permission-hook.cjs');

/**
 * Varsayılan cerrah sağlayıcısını üretir. clientFactory verilmezse üretimde
 * @github/copilot-sdk lazy require edilir.
 */
function createSurgeon(opts = {}) {
  return new CopilotSurgeon(opts);
}

module.exports = {
  createSurgeon,
  CopilotSurgeon,
  handoff,
  buildPermissionHandler,
  protectedPaths,
};
