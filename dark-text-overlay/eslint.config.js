import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
  {
    // overlay-utils.js uses a typeof-module guard for Node/Jest CJS interop
    files: ['src/lib/overlay-utils.js'],
    languageOptions: {
      globals: { module: 'writable' },
    },
  },
];
