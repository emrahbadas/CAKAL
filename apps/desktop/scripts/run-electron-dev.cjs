const { spawn } = require('child_process');
const waitOn = require('wait-on');

let electronChild = null;

function normalizeExitCode(code, signal) {
  // On Windows Electron sometimes returns -1 / 4294967295 even on user-close.
  if (signal) return 0;
  if (code === 0 || code === -1 || code === 4294967295) return 0;
  return typeof code === 'number' ? code : 1;
}

function startElectron() {
  const electronBin = require('electron');
  electronChild = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    windowsHide: false,
    shell: false,
  });

  electronChild.on('error', (err) => {
    console.error('[dev:electron] Failed to start Electron:', err.message);
    process.exit(1);
  });

  electronChild.on('exit', (code, signal) => {
    const normalized = normalizeExitCode(code, signal);
    if (normalized !== 0) {
      console.error('[dev:electron] Electron exited with error code:', code, 'signal:', signal || 'none');
    }
    process.exit(normalized);
  });
}

function shutdown(sig) {
  if (electronChild && !electronChild.killed) {
    try {
      electronChild.kill(sig);
    } catch {
      // ignore
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

waitOn(
  {
    resources: ['http://localhost:5173'],
    timeout: 120000,
    interval: 250,
    delay: 100,
    validateStatus: (status) => status >= 200 && status < 500,
  },
  (err) => {
    if (err) {
      console.error('[dev:electron] wait-on failed:', err.message);
      process.exit(1);
    }
    startElectron();
  }
);
