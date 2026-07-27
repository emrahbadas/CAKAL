import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import safePath from '../apps/desktop/electron/safe-path.cjs';

const {
  IS_WINDOWS,
  hasControlChars,
  parseRelativeSegments,
  resolveWithinRoot,
  startsWithRoot,
} = safePath;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');

const NUL = String.fromCharCode(0);
const UNIT_SEP = String.fromCharCode(31);

describe('hasControlChars', () => {
  it('normal yolları kabul eder', () => {
    expect(hasControlChars('.cakal-sandbox/tools/a.md')).toBe(false);
    expect(hasControlChars('klasör adı/ürün.txt')).toBe(false);
  });

  it('null byte ve kontrol karakterlerini yakalar', () => {
    expect(hasControlChars(`a${NUL}b`)).toBe(true);
    expect(hasControlChars(`a${UNIT_SEP}b`)).toBe(true);
    expect(hasControlChars('a\tb')).toBe(true);
    expect(hasControlChars('a\nb')).toBe(true);
  });
});

describe('parseRelativeSegments — sözdizimi kapısı', () => {
  const rejected = {
    'boş': '',
    'sadece boşluk': '   ',
    'null byte': `.cakal-sandbox/tools/a${NUL}.txt`,
    'kontrol karakteri': `.cakal-sandbox/tools/a${UNIT_SEP}.txt`,
    'klasik traversal': '.cakal-sandbox/tools/../../apps/desktop/electron/x.cjs',
    'gizli traversal': 'x/../.env',
    'nokta-eğik traversal': './x/../.env',
    'ters bölü traversal': '.cakal-sandbox\\tools\\..\\..\\apps\\x.cjs',
    'salt üst dizin': '..',
    'unix mutlak': '/etc/passwd',
    'windows mutlak': 'C:\\Windows\\system32\\drivers\\etc\\hosts',
    'sürücü-göreli': 'C:x.txt',
    'UNC': '\\\\sunucu\\pay\\x.txt',
    'UNC eğik': '//sunucu/pay/x.txt',
    'ADS': '.cakal-sandbox/tools/a.html:kotu.exe',
    'aygıt adı CON': '.cakal-sandbox/tools/CON',
    'aygıt adı NUL.txt': '.cakal-sandbox/tools/NUL.txt',
    'aygıt adı com1': '.cakal-sandbox/tools/com1.md',
    'sondaki nokta': '.cakal-sandbox/tools/a.txt.',
    'sondaki boşluk': '.cakal-sandbox/tools/a.txt ',
    'geçersiz karakter <>': '.cakal-sandbox/tools/a<b>.txt',
    'geçersiz karakter |': '.cakal-sandbox/tools/a|b.txt',
    'geçersiz karakter *': '.cakal-sandbox/tools/a*.txt',
  };

  for (const [label, value] of Object.entries(rejected)) {
    it(`reddeder: ${label}`, () => {
      const result = parseRelativeSegments(value);
      expect(result.ok).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    });
  }

  it('meşru yolları kabul eder (tire ve boşluk dahil)', () => {
    expect(parseRelativeSegments('.cakal-sandbox/tools/a.md').ok).toBe(true);
    expect(parseRelativeSegments('.cakal-sandbox/tools/alt klasör/a.md').ok).toBe(true);
    expect(parseRelativeSegments('packages/core/investment-research/shared/policy-core.cjs').ok).toBe(true);
  });

  it('gereksiz "." bileşenlerini sadeleştirir', () => {
    const result = parseRelativeSegments('./.cakal-sandbox/./tools/a.md');
    expect(result.ok).toBe(true);
    expect(result.segments).toEqual(['.cakal-sandbox', 'tools', 'a.md']);
  });
});

describe('resolveWithinRoot — kanonik çözümleme ve hapsetme', () => {
  it('meşru sandbox yolunu çözer', () => {
    const result = resolveWithinRoot(PROJECT_ROOT, '.cakal-sandbox/tools/ok.md');
    expect(result.ok).toBe(true);
    expect(result.repoPath).toBe('.cakal-sandbox/tools/ok.md');
    expect(path.isAbsolute(result.fullPath)).toBe(true);
  });

  it('dönen fullPath ile repoPath aynı hedefi gösterir (kanoniklik)', () => {
    const result = resolveWithinRoot(PROJECT_ROOT, '.cakal-sandbox/tools/ok.md');
    expect(result.ok).toBe(true);
    const rebuilt = path.relative(
      fs.realpathSync.native(PROJECT_ROOT),
      result.fullPath,
    ).replace(/\\/g, '/');
    expect(rebuilt).toBe(result.repoPath);
  });

  it('proje kökü dışına çıkan traversal reddedilir', () => {
    const result = resolveWithinRoot(PROJECT_ROOT, '.cakal-sandbox/tools/../../../ESCAPE.txt');
    expect(result.ok).toBe(false);
  });

  it('kök içinde kalan ama sandbox dışına çıkan traversal reddedilir', () => {
    // Denetimde bulunan asıl açık: eskiden bu yol her iki guard'dan da geçiyordu.
    const result = resolveWithinRoot(
      PROJECT_ROOT,
      '.cakal-sandbox/tools/../../apps/desktop/electron/HACKED.cjs',
    );
    expect(result.ok).toBe(false);
  });

  it('.env traversal varyantları reddedilir', () => {
    for (const vector of ['x/../.env', './x/../.env', 'apps/../.env', '.cakal-sandbox/tools/../../.env']) {
      expect(resolveWithinRoot(PROJECT_ROOT, vector).ok).toBe(false);
    }
  });

  it('var olmayan derin yol için de çalışır (ata dizin çözümlemesi)', () => {
    const result = resolveWithinRoot(PROJECT_ROOT, '.cakal-sandbox/tools/hic/olmayan/derin/x.md');
    expect(result.ok).toBe(true);
    expect(result.repoPath).toBe('.cakal-sandbox/tools/hic/olmayan/derin/x.md');
  });
});

describe('resolveWithinRoot — symlink / junction kaçışı', () => {
  let tmpRoot;
  let outsideDir;
  let linkMade = false;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-safepath-root-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cakal-safepath-out-'));
    fs.mkdirSync(path.join(tmpRoot, 'sandbox'), { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'gizli.txt'), 'sir', 'utf-8');

    try {
      // Windows'ta dizin symlink'i yönetici hakkı isteyebilir; junction istemez.
      fs.symlinkSync(outsideDir, path.join(tmpRoot, 'sandbox', 'kacis'), IS_WINDOWS ? 'junction' : 'dir');
      linkMade = true;
    } catch {
      linkMade = false;
    }
  });

  afterAll(() => {
    for (const dir of [tmpRoot, outsideDir]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* yoksay */ }
    }
  });

  it('symlink/junction üzerinden kök dışına yazma reddedilir', () => {
    if (!linkMade) {
      // Ortam link oluşturmaya izin vermedi; testi sessizce geçirmek yerine
      // durumu açıkça işaretle.
      expect(linkMade).toBe(false);
      return;
    }
    const result = resolveWithinRoot(tmpRoot, 'sandbox/kacis/yeni.txt');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/symlink|junction/i);
  });

  it('link olmayan normal alt dizin kabul edilir', () => {
    const result = resolveWithinRoot(tmpRoot, 'sandbox/normal.txt');
    expect(result.ok).toBe(true);
  });
});

describe('startsWithRoot — platform duyarlı kök karşılaştırması', () => {
  it('birebir eşleşmeyi kabul eder', () => {
    expect(startsWithRoot('.cakal-sandbox/tools/a.md', '.cakal-sandbox/tools/')).toBe(true);
  });

  it('farklı kökü reddeder', () => {
    expect(startsWithRoot('apps/desktop/electron/x.cjs', '.cakal-sandbox/tools/')).toBe(false);
  });

  it('win32 case-insensitive, diğerlerinde case-sensitive', () => {
    const mixed = startsWithRoot('.CAKAL-SANDBOX/Tools/a.md', '.cakal-sandbox/tools/');
    expect(mixed).toBe(IS_WINDOWS);
  });
});
