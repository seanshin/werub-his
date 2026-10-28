import { defineConfig } from 'vitest/config';

/**
 * packages/shared 러너 정본 — 2026-08-18 신설.
 *
 * 🔴 종전에는 shared 에 vitest 설정도 `test` 스크립트도 없었다. 스펙 11개는 사람이 손으로
 *    `npx vitest run` 해야만 돌았고, "무엇을 테스트로 세는가"의 출처가 계측 스크립트의
 *    임시 글롭이었다. 러너 설정이 곧 정본이다 — apps/api·apps/web 과 같은 규약으로 맞춘다.
 */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
  },
});
