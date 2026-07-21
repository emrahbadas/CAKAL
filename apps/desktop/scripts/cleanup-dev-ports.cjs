const { execSync } = require('child_process');

const PORTS = [5173, 5174, 5175];

function getListeningPidsOnWindows(ports) {
  const output = execSync('netstat -ano -p tcp', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const pids = new Set();
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    if (!line.includes('LISTENING')) continue;

    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const localAddress = parts[1];
    const pid = parts[4];
    const match = localAddress.match(/:(\d+)$/);
    if (!match) continue;

    const port = Number(match[1]);
    if (ports.includes(port)) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function getListeningPidsOnUnix(ports) {
  const pids = new Set();

  for (const port of ports) {
    try {
      const out = execSync(`lsof -ti tcp:${port}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      if (!out) continue;

      for (const pid of out.split(/\r?\n/)) {
        if (pid) pids.add(pid);
      }
    } catch {
      // Ignore when no process is bound to this port.
    }
  }

  return [...pids];
}

function killPid(pid) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /F`, {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch {
      // Process may already be gone.
    }
    return;
  }

  try {
    process.kill(Number(pid), 'SIGKILL');
  } catch {
    // Process may already be gone.
  }
}

function main() {
  try {
    const pids = process.platform === 'win32'
      ? getListeningPidsOnWindows(PORTS)
      : getListeningPidsOnUnix(PORTS);

    if (pids.length === 0) {
      console.log('[dev] No conflicting ports found');
      return;
    }

    for (const pid of pids) {
      killPid(pid);
    }

    console.log(`[dev] Freed ports ${PORTS.join(', ')} by stopping ${pids.length} process(es)`);
  } catch (err) {
    console.warn('[dev] Port cleanup skipped:', err.message);
  }
}

main();
