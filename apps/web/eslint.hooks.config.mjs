// React Hooks 규칙 전용 ESLint(flat) — CI 가드.
// 기존 lint 노이즈 없이 #300(조건부 hook / early-return 뒤 hook)만 error로 차단.
// 공통 플러그인을 등록(룰은 모두 off)해 소스의 eslint-disable 주석이 참조하는 룰명이 "정의 없음" 에러를 내지 않게 함.
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import nextPlugin from '@next/eslint-plugin-next';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: {
      'react-hooks': reactHooks,
      react,
      '@next/next': nextPlugin,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error', // 유일 활성 — #300 방지
    },
  },
];
