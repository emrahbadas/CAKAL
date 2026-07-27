import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import artifacts from '../apps/desktop/electron/analysis-artifacts.cjs';

const {
  isAllowedArtifactPath,
  registerAnalysisArtifact,
  resolveAnalysisArtifact,
  clearAnalysisArtifacts,
  artifactCount,
  MAX_ARTIFACTS,
} = artifacts;

const IS_WINDOWS = process.platform === 'win32';
const created = [];

/** Uygulamanın ürettiği isim kalıbına uyan gerçek bir dosya oluşturur. */
function makeArtifact(symbol = 'TUREX', ext = '.html') {
  const file = path.join(os.tmpdir(), `cakal_${symbol}_${Date.now()}${Math.floor(Math.random() * 1000)}${ext}`);
  fs.writeFileSync(file, '<html>analiz</html>', 'utf-8');
  created.push(file);
  return file;
}

function makeNamedFile(name, content = 'x') {
  const file = path.join(os.tmpdir(), name);
  fs.writeFileSync(file, content, 'utf-8');
  created.push(file);
  return file;
}

beforeEach(() => clearAnalysisArtifacts());

afterAll(() => {
  for (const file of created) {
    try { fs.rmSync(file, { force: true }); } catch { /* yoksay */ }
  }
});

describe('isAllowedArtifactPath — kabul kuralları', () => {
  it('uygulamanın ürettiği .html dosyasını kabul eder', () => {
    expect(isAllowedArtifactPath(makeArtifact())).toBe(true);
  });

  it('isim kalıbına uymayan .html dosyasını reddeder', () => {
    expect(isAllowedArtifactPath(makeNamedFile('rastgele.html'))).toBe(false);
    expect(isAllowedArtifactPath(makeNamedFile('cakal_.html'))).toBe(false);
    expect(isAllowedArtifactPath(makeNamedFile('cakal_TUREX.html'))).toBe(false);
  });

  it('çalıştırılabilir ve yönlendirici uzantıları reddeder', () => {
    for (const ext of ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.lnk', '.url', '.hta', '.scf', '.reg', '.js']) {
      const file = makeNamedFile(`cakal_TUREX_${Date.now()}${ext}`);
      expect(isAllowedArtifactPath(file), `reddedilmeliydi: ${ext}`).toBe(false);
    }
  });

  it('var olmayan dosyayı reddeder', () => {
    expect(isAllowedArtifactPath(path.join(os.tmpdir(), 'cakal_YOK_123.html'))).toBe(false);
  });

  it('tmpdir dışındaki dosyayı reddeder', () => {
    const outside = path.resolve('cakal_DISARI_123.html');
    fs.writeFileSync(outside, 'x', 'utf-8');
    created.push(outside);
    expect(isAllowedArtifactPath(outside)).toBe(false);
  });

  it('dizini reddeder', () => {
    const dir = path.join(os.tmpdir(), `cakal_DIR_${Date.now()}.html`);
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
    expect(isAllowedArtifactPath(dir)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('boş / geçersiz girdiyi reddeder', () => {
    for (const value of ['', '   ', null, undefined, 42, {}]) {
      expect(isAllowedArtifactPath(value)).toBe(false);
    }
  });

  it('çalıştırılabilire işaret eden symlink reddedilir (uzantı gizleme)', () => {
    const target = makeNamedFile(`kotu_${Date.now()}.exe`, 'MZ');
    const link = path.join(os.tmpdir(), `cakal_SAHTE_${Date.now()}.html`);
    let made = false;
    try {
      fs.symlinkSync(target, link, IS_WINDOWS ? 'file' : undefined);
      made = true;
      created.push(link);
    } catch {
      made = false;
    }
    if (!made) {
      // Ortam symlink'e izin vermedi; durumu gizleme.
      expect(made).toBe(false);
      return;
    }
    expect(isAllowedArtifactPath(link)).toBe(false);
  });
});

describe('kayıt defteri', () => {
  it('geçerli dosyayı kaydeder ve id ile geri verir', () => {
    const file = makeArtifact();
    const id = registerAnalysisArtifact(file);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(resolveAnalysisArtifact(id)).toBe(fs.realpathSync.native(file));
  });

  it('geçersiz dosyayı kaydetmez', () => {
    expect(registerAnalysisArtifact(makeNamedFile('rastgele.html'))).toBeNull();
    expect(registerAnalysisArtifact('C:/Windows/System32/calc.exe')).toBeNull();
    expect(registerAnalysisArtifact('/bin/sh')).toBeNull();
  });

  it('bilinmeyen veya bozuk artifactId reddedilir', () => {
    for (const id of [
      'bilinmeyen',
      '',
      null,
      undefined,
      '../../../etc/passwd',
      'C:/Windows/System32/calc.exe',
      '00000000-0000-0000-0000-000000000000',
    ]) {
      expect(resolveAnalysisArtifact(id), `reddedilmeliydi: ${id}`).toBeNull();
    }
  });

  it('kayıt sonrası dosya silinirse id geçersizleşir (açma anında yeniden doğrulama)', () => {
    const file = makeArtifact();
    const id = registerAnalysisArtifact(file);
    expect(resolveAnalysisArtifact(id)).toBeTruthy();

    fs.rmSync(file, { force: true });
    expect(resolveAnalysisArtifact(id)).toBeNull();
  });

  it('kayıt defteri sınırsız büyümez', () => {
    for (let i = 0; i < MAX_ARTIFACTS + 25; i += 1) {
      registerAnalysisArtifact(makeArtifact('X'));
    }
    expect(artifactCount()).toBeLessThanOrEqual(MAX_ARTIFACTS);
  });

  it('en eski kayıt taşmada atılır, en yeni korunur', () => {
    const firstId = registerAnalysisArtifact(makeArtifact('ILK'));
    for (let i = 0; i < MAX_ARTIFACTS; i += 1) {
      registerAnalysisArtifact(makeArtifact('DOLGU'));
    }
    const lastId = registerAnalysisArtifact(makeArtifact('SON'));
    expect(resolveAnalysisArtifact(firstId)).toBeNull();
    expect(resolveAnalysisArtifact(lastId)).toBeTruthy();
  });
});
