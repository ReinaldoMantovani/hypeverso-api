// ESLint (flat config) para a API e pacotes. Regras focadas em bugs reais;
// estilo fica a cargo do Prettier (npm run format).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      
      '**/*.d.ts',
      '**/public/sw.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      eqeqeq: ['error', 'smart'],
      'preserve-caught-error': 'warn',
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.jest.test.mjs'],
    languageOptions: { globals: { ...globals.jest } },
  },
);
