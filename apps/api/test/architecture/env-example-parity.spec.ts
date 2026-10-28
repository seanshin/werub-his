import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// 코드 추출 정본은 스크립트 하나 — 세는 규칙을 가드마다 두면 갈라진다.
import { scanEnvKeys, exampleKeys, keysIn } from '../../../../scripts/env-keys-scan.mjs';

/**
 * 🔴 `.env.example` ↔ 코드가 읽는 환경변수 — 기계 대조(2026-09-13 · 상용 릴리즈 T4-4).
 *
 * 종전: 루트 `.env.example` 8키 ↔ 코드 92키. 설치하는 사람이 무엇을 넣어야 하는지 알 길이 없었고,
 * 비어 있으면 **저장소에 적힌 개발 비밀로 조용히 떨어지는** 키(PDF 토큰 등)가 섞여 있었다.
 *
 * 지키는 것
 *   ① 코드가 읽는 키는 전부 예시에 선언돼 있다(새 키를 코드에 넣고 예시를 안 고치면 실패)
 *   ② 예시에만 있고 코드가 안 읽는 키는 없다(죽은 설정이 설치 문서를 속인다) — 인프라 전용은 사유와 함께 이름을 댄다
 *   ③ 대조군 — 추출기가 세 경로(process.env · ConfigService.get · zod envSchema)를 실제로 읽는다
 */
const ROOT = resolve(__dirname, '../../../..');
const EXAMPLE = readFileSync(resolve(ROOT, '.env.example'), 'utf8');

/** 코드가 읽지 않지만 예시에 두는 키 — 사유 필수 */
const INFRA_ONLY: Record<string, string> = {
  DB_PASSWORD: 'infra/docker compose 의 postgres 서비스가 쓴다(애플리케이션 코드는 DATABASE_URL 만 읽는다)',
};

describe('🔴 .env.example ↔ 코드 환경변수 대조', () => {
  const scan = scanEnvKeys(ROOT) as { api: Map<string, Set<string>>; web: Map<string, Set<string>> };
  const codeKeys = new Set<string>([...scan.api.keys(), ...scan.web.keys()]);
  const declared = exampleKeys(EXAMPLE) as Set<string>;

  it('③ 대조군 — 추출기가 세 경로를 실제로 읽는다(0 이 되면 대조가 무의미하다)', () => {
    expect(scan.api.size).toBeGreaterThan(60);
    expect(scan.web.size).toBeGreaterThan(5);
    expect(scan.api.has('PDF_SERVICE_TOKEN')).toBe(true); // ① process.env
    expect(scan.api.has('JITSI_JWT_SECRET')).toBe(true); // ② ConfigService.get
    expect(scan.api.has('DATABASE_URL')).toBe(true); // ③ zod envSchema
    expect(scan.web.has('NEXT_PUBLIC_API_URL')).toBe(true);
    // 주석 속 `process.env.X` 는 세지 않는다
    expect([...keysIn('// process.env.GHOST_KEY\nconst a = process.env.REAL_KEY;')]).toEqual(['REAL_KEY']);
    expect(declared.size).toBeGreaterThan(60);
  });

  it('① 코드가 읽는 키는 전부 .env.example 에 선언돼 있다', () => {
    const missing = [...codeKeys].filter((k) => !declared.has(k)).sort();
    const where = missing.map((k) => `${k} ← ${[...(scan.api.get(k) ?? scan.web.get(k) ?? [])].slice(0, 2).join(', ')}`);
    expect(missing, `.env.example 에 없는 키 ${missing.length}건 — 필수/선택·비밀 여부와 함께 선언하세요:\n${where.join('\n')}`).toEqual([]);
  });

  it('② 예시에만 있고 코드가 읽지 않는 키는 없다(인프라 전용은 사유와 함께)', () => {
    const stale = [...declared].filter((k) => !codeKeys.has(k) && !(k in INFRA_ONLY)).sort();
    expect(stale, `코드가 읽지 않는 키 — 지우거나 INFRA_ONLY 에 사유를 적으세요:\n${stale.join('\n')}`).toEqual([]);
    for (const k of Object.keys(INFRA_ONLY)) expect(declared.has(k), `INFRA_ONLY ${k} 가 예시에 없다 — 죽은 예외다`).toBe(true);
  });

  it('🔴 판매본 필수 비밀은 예시가 그 사실을 말한다', () => {
    for (const k of ['PDF_SERVICE_TOKEN', 'PDF_RENDER_SECRET', 'HIS_MODE', 'ENCRYPTION_KEY']) {
      const line = EXAMPLE.split('\n').findIndex((l) => new RegExp(`^\\s*#?\\s*${k}=`).test(l));
      const context = EXAMPLE.split('\n').slice(Math.max(0, line - 4), line).join('\n');
      expect(context, `${k} 앞 설명에 판매본/REAL 요구가 없다`).toMatch(/판매본|REAL/);
    }
  });
});
