import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'client/public/**', 'blender/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['client/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['server/**/*.ts', 'tools/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Sim code must stay deterministic: use the seeded RNG from shared/rng.ts.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG (shared/src/rng.ts).' },
      ],
    },
  },
);
