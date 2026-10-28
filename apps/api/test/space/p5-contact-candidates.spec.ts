import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContactCandidatesService } from '../../src/modules/infection-control/contact-candidates.service';
import { patientIdFromQuery } from '../../src/modules/audit/audit-routes';

/**
 * P5 — 위치 겹침 감염 접촉자 후보.
 *   ① 설정 기본 OFF → 조회하지 않는다(DB 0회) · 기본값 등록이 false
 *   ② 추정 겹침은 설정 includeInferred 가 켜졌고 화면이 요청할 때만(둘 중 하나라도 아니면 SQL 에 false)
 *   ③ 정렬: 관측 등급 먼저 → 겹친 시간 · 기간 검증 400
 *   ④ 관리자 전용 · patientId 쿼리로 열람 감사 · 쓰기 없음
 * SQL 자체는 로컬 PG 트랜잭션 실측(관측 10분 겹침 1명 · 추정 켜면 +2 INFERRED · 열린 구간 1 제외 · 롤백).
 */
const PID = '00000000-0000-4000-8000-000000000001';

function svc(cfg: Record<string, unknown>, rows: any[] = []) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const prisma: any = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      calls.push({ sql, values });
      return /"openExcluded"/.test(sql) ? [{ observed: 2, inferred: 1, openExcluded: 0, floorExcluded: 0, otherExcluded: 0 }] : rows;
    }),
    infectionSurveillance: { findMany: vi.fn(async () => [{ patientId: 'c' }]) },
  };
  const config: any = { get: vi.fn(async (k: string) => cfg[k] ?? null) };
  return { s: new ContactCandidatesService(prisma, config), calls, prisma };
}
const ON = { 'infection.contactCandidates.enabled': true };

describe('① 기본 OFF', () => {
  it('꺼져 있으면 enabled:false · DB 조회 0회', async () => {
    const { s, prisma } = svc({});
    expect(await s.candidates(PID)).toEqual({ enabled: false });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('기본값 등록이 둘 다 false', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/config/config-runtime.service.ts'), 'utf8');
    expect(src).toMatch(/'infection\.contactCandidates\.enabled': \{ key: 'infection\.contactCandidates\.enabled', value: false/);
    expect(src).toMatch(/'infection\.contactCandidates\.includeInferred': \{ key: 'infection\.contactCandidates\.includeInferred', value: false/);
  });
});

describe('② 추정 겹침은 설정 + 요청 둘 다', () => {
  const inferredFlag = (calls: { sql: string; values: unknown[] }[]) => {
    const main = calls.find((c) => /WITH idx AS/.test(c.sql))!;
    return main.values.filter((v) => typeof v === 'boolean');
  };
  it('설정 꺼짐 + 요청 → false · 설정 켜짐 + 요청 없음 → false · 둘 다 → true', async () => {
    let r = svc(ON); let out: any = await r.s.candidates(PID, '14', true);
    expect(out).toMatchObject({ inferredAllowed: false, includeInferred: false });
    expect(inferredFlag(r.calls).every((v) => v === false)).toBe(true);
    r = svc({ ...ON, 'infection.contactCandidates.includeInferred': true }); out = await r.s.candidates(PID, '14', false);
    expect(out).toMatchObject({ inferredAllowed: true, includeInferred: false });
    expect(inferredFlag(r.calls).every((v) => v === false)).toBe(true);
    r = svc({ ...ON, 'infection.contactCandidates.includeInferred': true }); out = await r.s.candidates(PID, '14', true);
    expect(out.includeInferred).toBe(true);
    expect(inferredFlag(r.calls).length).toBeGreaterThan(0);
    expect(inferredFlag(r.calls).every((v) => v === true)).toBe(true);
  });
});

describe('③ 정렬 · 기간', () => {
  it('관측 등급 먼저 · 같은 등급은 겹친 시간 긴 순 · 지표 구간 수를 함께', async () => {
    const { s } = svc(ON, [
      { patientId: 'a', grade: 'INFERRED', overlapMinutes: 300, overlaps: 3, zones: [], firstAt: new Date() },
      { patientId: 'b', grade: 'OBSERVED', overlapMinutes: 5, overlaps: 1, zones: [], firstAt: new Date() },
      { patientId: 'c', grade: 'OBSERVED', overlapMinutes: 40, overlaps: 1, zones: [], firstAt: new Date() },
    ]);
    const out: any = await s.candidates(PID);
    expect(out.candidates.map((c: any) => c.patientId)).toEqual(['c', 'b', 'a']);
    // 이미 접촉자로 등록된(미해소) 후보는 표시 — 조건은 정본 접두사·미해소
    expect(out.candidates.map((c: any) => c.registered)).toEqual([true, false, false]);
    expect(out.indexIntervals).toMatchObject({ observed: 2, inferred: 1 });
    expect(out.windowDays).toBe(14);
  });
  it('기간 1~30 정수 외는 400', async () => {
    for (const d of ['0', '31', '2.5', 'x']) await expect(svc(ON).s.candidates(PID, d)).rejects.toMatchObject({ response: { code: 'CONTACT_DAYS_INVALID' } });
  });
});

describe('④ 권한·감사·쓰기 없음', () => {
  const ctl = readFileSync(join(__dirname, '../../src/modules/infection-control/infection-control.controller.ts'), 'utf8');
  it('관리자 전용 · patientId 는 UUID 파이프', () => {
    const block = /@Get\('contact-candidates'\)[\s\S]*?async contactCandidates/.exec(ctl)![0];
    expect(block).toMatch(/@Roles\(UserRole\.ADMIN\)\n/);
    expect(ctl).toMatch(/@Query\('patientId', new ParseUUIDPipe\(\)\) patientId/);
  });
  it('patientId 쿼리 → 환자 지목 열람 감사로 귀속된다', () => {
    expect(patientIdFromQuery({ patientId: PID })).toBe(PID);
  });
  it('후보 조회 서비스에 쓰기 호출이 없다(등록은 기존 접촉자 등록 EP 로만)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/infection-control/contact-candidates.service.ts'), 'utf8');
    expect(src).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(|\$executeRaw/);
  });
});
