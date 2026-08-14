const { execSync } = require('child_process');

const PORTS = [5173, 5174, 5175];

/**
 * netstat çıktısından dinlenen portların PID'lerini çıkarır.
 *
 * Saf fonksiyon: `execSync`'ten ayrı tutuldu ki gerçek netstat çıktısıyla
 * test edilebilsin. Ayrışmanın sebebi tam olarak buydu — ayrıştırma doğruydu,
 * BESLENEN VERİ eksikti.
 *
 * ÖLÇÜLEN CANLI HATA (14 Ağustos 2026): script `netstat -ano -p tcp`
 * çalıştırıyordu. Windows'ta `-p tcp` YALNIZ IPv4'ü listeler; IPv6 için
 * protokol adı ayrıdır (`tcpv6`). Vite `[::1]:5173` yani IPv6 loopback'e
 * bağlandığı için süreç çıktıda HİÇ görünmüyordu ve script gururla
 * "No conflicting ports found" diyip port doluyken devam ediyordu.
 * Deneyle doğrulandı: aynı anda `-p tcp` boş, filtresiz netstat satırı buldu.
 */
function parseListeningPids(netstatOutput, ports) {
  const pids = new Set();

  for (const line of String(netstatOutput || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // Windows sütunları: PROTO | Yerel | Uzak | Durum | PID
    // UDP satırlarında Durum sütunu yoktur (4 sütun) — bu yüzden hem uzunluk
    // hem protokol hem durum kontrol edilir, yoksa UDP'nin PID'i "durum"
    // sanılabilir.
    if (parts.length < 5) continue;
    if (parts[0].toUpperCase() !== 'TCP') continue;
    if (parts[3].toUpperCase() !== 'LISTENING') continue;

    // Hem `127.0.0.1:5173` hem `[::1]:5173` biçimini karşılar.
    const match = parts[1].match(/:(\d+)$/);
    if (!match) continue;

    if (ports.includes(Number(match[1]))) pids.add(parts[4]);
  }

  return [...pids];
}

function getListeningPidsOnWindows(ports) {
  // DİKKAT: `-p tcp` EKLEME. IPv6 dinleyicileri kaybolur (yukarıdaki nota bak).
  const output = execSync('netstat -ano', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return parseListeningPids(output, ports);
}

/** PID hangi programa ait? Yabancı bir süreci sessizce öldürmemek için. */
function imageNameForPid(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = out.match(/^"([^"]+)"/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Bu script yalnız KENDİ geliştirme sunucumuzu toparlamak için var. Portu
// başka bir program tutuyorsa onu öldürmek değil, kullanıcıya söylemek doğru.
const OWNED_IMAGES = new Set(['node.exe', 'electron.exe']);

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

    let stopped = 0;
    for (const pid of pids) {
      if (String(pid) === String(process.pid)) continue;
      if (process.platform === 'win32') {
        const image = imageNameForPid(pid);
        // Bilinmeyen program: öldürme, SÖYLE. Sessizce kapatmak, portu tutanın
        // kullanıcının başka bir işi olduğu durumda geri alınamaz zarar verir.
        if (image && !OWNED_IMAGES.has(image)) {
          console.warn(`[dev] Port ${PORTS.join('/')} "${image}" (PID ${pid}) tarafından tutuluyor — bu bize ait değil, dokunulmadı.`);
          continue;
        }
      }
      killPid(pid);
      stopped += 1;
    }

    if (stopped === 0) {
      console.warn('[dev] Portu tutan süreç(ler) bulundu ama hiçbiri durdurulmadı.');
      return;
    }
    console.log(`[dev] Freed ports ${PORTS.join(', ')} by stopping ${stopped} process(es)`);
  } catch (err) {
    console.warn('[dev] Port cleanup skipped:', err.message);
  }
}

if (require.main === module) main();

module.exports = { parseListeningPids, PORTS };
