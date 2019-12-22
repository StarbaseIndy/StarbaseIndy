'use strict';

module.exports = {
  env: {
    node: true
  },
  parserOptions: {
      ecmaVersion: 11,
      sourceType: 'script',
  },
  extends: 'eslint:recommended',
  rules: {
    'no-unused-vars': ['error', { 'varsIgnorePattern': '^_' }],
    quotes: ['error', 'single', { 'avoidEscape': true }],
  },
};