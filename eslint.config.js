// @ts-check
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Flat-config layering:
//  1. Global ignores (generated trees, lockfile, local SQLite).
//  2. Untyped JS baseline + JSON-aware globals.
//  3. Type-checked rules limited to TS/TSX *source* (excluding *.config.ts so we don't need to
//     wire those into a tsconfig).
//  4. Loose overrides for tests and config files.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/target/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
      '**/.vite/**',
      'pnpm-lock.yaml',
      'local-data/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // Type-checked rules: TS/TSX source under src/ and test/ only.
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: ['**/src/**/*.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
  })),
  {
    files: ['**/src/**/*.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: ['*/tsconfig.json', '*/*/tsconfig.json'] },
        node: true,
      },
    },
  },
  {
    // Tests: relax a few rules for fixture-style code.
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Config files: parse but don't run typed rules; many of them aren't in any tsconfig.
    files: ['**/*.config.{js,cjs,mjs,ts,mts}', '**/vitest.workspace.ts'],
    rules: {
      'import/order': 'off',
    },
  },
);
