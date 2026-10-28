/** 시드 실행 모드 가드 — 구현·설명은 `seed-mode-guard.js` */
export type SeedKind = 'DEMO' | 'MASTER';
export function assertSeedAllowed(file: string, kind?: SeedKind, env?: NodeJS.ProcessEnv, rootEnvPath?: string): void;
export function currentSeedMode(env?: NodeJS.ProcessEnv, rootEnvPath?: string): { mode: 'DEV' | 'REHEARSAL' | 'REAL'; source: string };
