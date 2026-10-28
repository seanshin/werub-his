/**
 * 환자 여정 P0 구조 가드(2026-10-01 · `docs/01-plan/features/patient-journey-model.plan.md` §6 P0).
 *  · P0-5 방문 단위 귀속 — 아래 유형은 발행 지점마다 refType·refId 를 싣는다(종전 응급 10종 중 9종·입원 퇴원/취소·수술 시작·진료 서명/정정·수납이 없었다)
 *  · P0-6 단일 발행 경로 — `patientJourneyEvent.create` 는 정본 발행기(journey.service)에서만(데모 시나리오 예외는 이름으로 고정)
 *  · P0-9 감시자 76(어휘 밖 저장값)의 목록이 shared 어휘와 같다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JOURNEY_EVENT_TYPES } from '@hospital-run/shared';

const SRC = join(__dirname, '..', '..', 'src');
const REPO = join(__dirname, '..', '..', '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 방문 단위·원 기록 귀속이 필수인 유형(정본 카탈로그 §5.9 에서 "없음"이던 것 + 원래 있던 방문 트랙) */
const REF_REQUIRED = [
  'ER_ARRIVAL', 'ER_TRIAGE', 'ER_TREATMENT_START', 'ER_DISPOSITION', 'ER_CHECKOUT', 'ER_BILLING_FAILED',
  'ER_BED_ASSIGNED', 'ER_BED_MOVED', 'ER_BED_RELEASED',
  'ADMISSION', 'ADMISSION_CANCELLED', 'BED_TRANSFER', 'DISCHARGE',
  'SURGERY_START', 'SURGERY_COMPLETE', 'PACU_ADMISSION', 'PACU_DISCHARGE',
  'ENCOUNTER_START', 'ENCOUNTER_SIGNED', 'ENCOUNTER_AMENDED',
  'BILLING_PAID', 'CONSENT_REQUESTED', 'CONSENT_SIGNED', 'CONSENT_COMPLETED', 'CONSENT_REVOKED',
  'NEWBORN_CRITICAL',
] as const;
/** 데모 시나리오(REAL 모드 차단 · `patient-auth.controller.ts` assertSeedAllowed) — 실제 사건이 아니므로 귀속·경로 규칙 밖 */
const DEMO_FILES = ['modules/patient-auth/patient-auth.service.ts'];

/** 발행 객체 리터럴 구간 — `eventType: 'X'` 를 포함하는 `emit({ … })` 의 중괄호 블록 */
function emitBlocks(code: string): { type: string; block: string; line: number }[] {
  const out: { type: string; block: string; line: number }[] = [];
  const re = /eventType:\s*'([A-Za-z_.]+)'/g;
  for (const m of code.matchAll(re)) {
    let i = m.index!;
    let depth = 0;
    while (i > 0) { const c = code[i]; if (c === '}') depth++; if (c === '{') { if (depth === 0) break; depth--; } i--; }
    let j = m.index!; depth = 0;
    while (j < code.length) { const c = code[j]; if (c === '{') depth++; if (c === '}') { if (depth === 0) break; depth--; } j++; }
    out.push({ type: m[1], block: code.slice(i, j + 1), line: code.slice(0, m.index!).split('\n').length });
  }
  return out;
}

describe('여정 P0 구조 가드', () => {
  const files = walk(SRC).map((f) => ({ rel: relative(SRC, f), code: strip(readFileSync(f, 'utf8')) }));

  it('🔴 P0-6 원장 직접 쓰기는 정본 발행기에서만(데모 예외 제외)', () => {
    const hits = files
      .filter((f) => /patientJourneyEvent\.(create|createMany|upsert)\(/.test(f.code))
      .map((f) => f.rel)
      .filter((r) => r !== 'modules/journey/journey.service.ts' && !DEMO_FILES.includes(r));
    expect(hits).toEqual([]);
  });

  it('🔴 P0-5 방문·원 기록 귀속 필수 유형은 발행 지점마다 refType·refId 를 싣는다', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const f of files) {
      if (DEMO_FILES.includes(f.rel)) continue;
      for (const b of emitBlocks(f.code)) {
        if (!(REF_REQUIRED as readonly string[]).includes(b.type)) continue;
        checked++;
        if (!/refType:/.test(b.block) || !/refId:/.test(b.block)) missing.push(`${f.rel}:${b.line} ${b.type}`);
      }
    }
    expect(missing).toEqual([]);
    // 대조군 — 검사기가 실제로 발행 지점을 본다(응급·입원·진료·동의서 등 30곳 이상)
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it('검사기 대조군 — refId 없는 발행 블록을 잡는다', () => {
    const code = "this.journey?.emit({ patientId: p, eventType: 'ER_CHECKOUT', title: 't' });";
    const [b] = emitBlocks(code);
    expect(b.type).toBe('ER_CHECKOUT');
    expect(/refId:/.test(b.block)).toBe(false);
  });

  it('P0-9 감시자 76 의 어휘 목록 = shared JOURNEY_EVENT_TYPES', () => {
    const sql = readFileSync(join(REPO, 'infra/scripts/data-integrity-scan.sql'), 'utf8');
    const seg = sql.slice(sql.indexOf("'76 여정 원장"), sql.indexOf(']::text[]', sql.indexOf("'76 여정 원장")));
    const listed = [...seg.matchAll(/'([A-Za-z_.]+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...JOURNEY_EVENT_TYPES].sort());
  });
});
