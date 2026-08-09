// ============================================================
// eslint.config.mjs — ESLint 9 düz (flat) yapılandırma
// ============================================================
// Bu proje iki ayrı dünyadan oluşuyor ve tek kural seti ikisine de uymuyor:
//   - apps/desktop/src        → React + TypeScript (tarayıcı/renderer)
//   - apps/desktop/electron,
//     packages, scripts, tests → Node (CommonJS .cjs / ESM .mjs)
// Bu yüzden kurallar dosya türüne göre ayrı bloklarda tanımlanır.
//
// AMAÇ: gerçek hataları yakalamak (kullanılmayan değişken, tanımsız isim,
// bozuk hook bağımlılığı). Biçimsel tercih dayatmak DEĞİL — mevcut kod
// tabanı zaten tutarlı ve binlerce biçim uyarısı lint'i kullanılamaz kılar.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/** Kullanılmayan değişken kuralı: `_` önekli olanlar bilinçli atılmış sayılır. */
const unusedVars = ['warn', {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrors: 'none',        // `catch (err)` bloklarını boş bırakmak yaygın kalıp
  ignoreRestSiblings: true,
}];

/** Her blokta geçerli olan ortak ayarlar. */
const sharedRules = {
  // `catch { /* yoksay */ }` bu kod tabanının bilinçli kalıbı; hata değil.
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Gereksiz regex kaçışı SEMANTİK DEĞİL biçimsel bir konu. Otomatik düzeltme
  // finans karar kapılarındaki regex'lere dokunurdu; geçmişte bir substring
  // çakışması tüm bilanço kapılarını atlatmıştı. Görünür kalsın, bloklamasın.
  'no-useless-escape': 'warn',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/.vite/**',
      'logs/**',
      '.cakal-sandbox/**',
      'supabase/**',
      '**/*.d.ts',
    ],
  },

  // ── React + TypeScript (renderer) ──
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...sharedRules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': unusedVars,
      // Electron köprüsü (window.cakalAPI) tip taşımıyor; `any` burada
      // kaçınılmaz. Hata değil, bilinçli sınır.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ── Diğer TypeScript (paketler, ortak tipler) ──
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    ignores: ['apps/desktop/src/**'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node } },
    rules: {
      ...sharedRules,
      '@typescript-eslint/no-unused-vars': unusedVars,
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ── Node tarafı: CommonJS (.cjs) ──
  {
    files: ['**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { ...sharedRules, 'no-unused-vars': unusedVars },
  },

  // ── Node tarafı: ESM (.mjs, testler ve scriptler) ──
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...sharedRules, 'no-unused-vars': unusedVars },
  },
);
