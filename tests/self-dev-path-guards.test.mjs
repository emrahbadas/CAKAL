import { describe, it, expect } from 'vitest';

import aiService from '../apps/desktop/electron/ai-service.cjs';

const {
  isSandboxRepoPath,
  isReadProtectedRepoPath,
  isWriteProtectedRepoPath,
  resolveSelfDevReadTarget,
  resolveSelfDevWriteTarget,
} = aiService;

// Denetimde bulunan asıl açık: guard'lar ham yol üzerinde, dosya işlemi
// çözülmüş yol üzerinde çalışıyordu. Bu testler o sınıfın kapalı kaldığını
// ve meşru kullanımın bozulmadığını sabitler.

describe('yazma kapısı — sandbox hapsi', () => {
  it('meşru sandbox yollarını kabul eder', () => {
    for (const p of [
      '.cakal-sandbox/tools/x.md',
      '.cakal-sandbox/skills/y.md',
      '.cakal-sandbox/workflows/z/derin/a.md',
      '.cakal-sandbox/prompts/p.md',
      '.cakal-sandbox/plugins/q.plugin.json',
    ]) {
      const result = resolveSelfDevWriteTarget(p);
      expect(result.ok, `kabul edilmeliydi: ${p}`).toBe(true);
      expect(isSandboxRepoPath(p)).toBe(true);
    }
  });

  it('traversal ile çekirdek dizinlere yazmayı reddeder', () => {
    for (const p of [
      '.cakal-sandbox/tools/../../apps/desktop/electron/HACKED.cjs',
      '.cakal-sandbox/tools/../../apps/desktop/src/App.tsx',
      '.cakal-sandbox/tools/../../packages/core/investment-research/shared/policy-core.cjs',
      '.cakal-sandbox/tools/../../scripts/evil.cjs',
      '.cakal-sandbox/tools/../../.vscode/settings.json',
      '.cakal-sandbox/tools/..\\..\\apps\\desktop\\electron\\HACKED.cjs',
    ]) {
      const result = resolveSelfDevWriteTarget(p);
      expect(result.ok, `reddedilmeliydi: ${p}`).toBe(false);
      expect(result.reason).toMatch(/GÜVENLİK/);
      expect(isSandboxRepoPath(p), `sandbox sayılmamalıydı: ${p}`).toBe(false);
    }
  });

  it('doğrudan çekirdek yollarını reddeder', () => {
    for (const p of [
      'apps/desktop/electron/ai-service.cjs',
      'packages/db/src/index.ts',
      'scripts/run-backtest.cjs',
      '.env',
    ]) {
      expect(resolveSelfDevWriteTarget(p).ok, `reddedilmeliydi: ${p}`).toBe(false);
    }
  });

  it('sandbox dışı ama proje içi yolları reddeder', () => {
    for (const p of ['README.md', 'package.json', '.cakal-sandbox/secrets/dev-secrets.json']) {
      expect(resolveSelfDevWriteTarget(p).ok, `reddedilmeliydi: ${p}`).toBe(false);
    }
  });

  it('kanonik repoPath döner ve traversal ile aynı hedefe iki isim üretilemez', () => {
    const direct = resolveSelfDevWriteTarget('.cakal-sandbox/tools/a.md');
    expect(direct.ok).toBe(true);
    expect(direct.repoPath).toBe('.cakal-sandbox/tools/a.md');
    // Aynı hedefe traversal'lı ikinci bir yol üretilemez.
    expect(resolveSelfDevWriteTarget('.cakal-sandbox/skills/../tools/a.md').ok).toBe(false);
  });

  it('isWriteProtectedRepoPath çözümlenemeyen yolu korumalı sayar (fail-closed)', () => {
    expect(isWriteProtectedRepoPath('../../../etc/passwd')).toBe(true);
    expect(isWriteProtectedRepoPath('C:\\Windows\\system32\\x')).toBe(true);
  });
});

describe('okuma kapısı — secret ve kimlik dosyaları', () => {
  it('.env ve varyantlarını reddeder', () => {
    for (const p of ['.env', '.env.local', '.env.production']) {
      expect(resolveSelfDevReadTarget(p).ok, `reddedilmeliydi: ${p}`).toBe(false);
      expect(isReadProtectedRepoPath(p)).toBe(true);
    }
  });

  it('traversal ile .env okumayı reddeder (denetimde bulunan açık)', () => {
    for (const p of [
      'x/../.env',
      './x/../.env',
      'apps/../.env',
      '.cakal-sandbox/tools/../../.env',
      'apps/desktop/../../.env',
    ]) {
      const result = resolveSelfDevReadTarget(p);
      expect(result.ok, `reddedilmeliydi: ${p}`).toBe(false);
      expect(isReadProtectedRepoPath(p), `korumalı sayılmalıydı: ${p}`).toBe(true);
    }
  });

  it('secret store ve dev fallback dosyalarını reddeder', () => {
    for (const p of [
      '.cakal-sandbox/secrets/dev-secrets.json',
      '.cakal-sandbox/secrets/baska.json',
      'cakal-secrets.json',
      'apps/desktop/secrets.json',
    ]) {
      expect(resolveSelfDevReadTarget(p).ok, `reddedilmeliydi: ${p}`).toBe(false);
    }
  });

  it('anahtar materyali ve kimlik dosyalarını reddeder', () => {
    for (const p of [
      'certs/server.pem',
      'certs/server.key',
      'certs/bundle.p12',
      'certs/bundle.pfx',
      '.ssh/id_rsa',
      'id_ed25519',
      'credentials.json',
      'config/credentials',
      'gcp-service-account.json',
      'config/my-service_account-prod.json',
      '.npmrc',
      '.netrc',
      'mcp-config.json',
      '.vscode/mcp.json',
    ]) {
      expect(resolveSelfDevReadTarget(p).ok, `reddedilmeliydi: ${p}`).toBe(false);
    }
  });

  it('çekirdek dosya yedeklerini reddeder', () => {
    expect(resolveSelfDevReadTarget('apps/desktop/electron/ai-service.cjs.cakal-backup').ok).toBe(false);
  });

  it('node_modules, .git ve supabase/.temp reddedilir (traversal dahil)', () => {
    for (const p of [
      'node_modules/openai/package.json',
      'apps/../node_modules/openai/package.json',
      '.git/config',
      'apps/../.git/config',
      'supabase/.temp/x',
    ]) {
      expect(resolveSelfDevReadTarget(p).ok, `reddedilmeliydi: ${p}`).toBe(false);
    }
  });

  it('meşru kaynak dosyaları okunabilir kalır (regresyon)', () => {
    for (const p of [
      'README.md',
      'package.json',
      'apps/desktop/electron/ai-service.cjs',
      'packages/core/investment-research/shared/policy-core.cjs',
    ]) {
      const result = resolveSelfDevReadTarget(p);
      expect(result.ok, `okunabilmeliydi: ${p}`).toBe(true);
      expect(result.repoPath).toBe(p);
    }
  });

  it('proje dışına çıkan okuma reddedilir', () => {
    for (const p of ['../../../etc/passwd', '../gizli.txt', '/etc/passwd']) {
      expect(resolveSelfDevReadTarget(p).ok, `reddedilmeliydi: ${p}`).toBe(false);
    }
  });
});
