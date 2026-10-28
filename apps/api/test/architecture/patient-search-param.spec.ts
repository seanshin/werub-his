import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PatientQueryDto } from '../../src/modules/patient/dto/patient-query.dto';

/**
 * 🔴 화면이 `/api/v1/patients` 에 **DTO 에 없는 이름**으로 검색어를 보내면,
 *    전역 `whitelist:true` 가 그것을 **조용히 지우고** 서버는 필터 없이 첫 N명을 돌려준다.
 *    오류도 경고도 없다 — 화면은 "신현묵"을 쳐도 전혀 다른 환자를 보여준다(2026-08-26 사람 신고).
 *
 * 🔴 이 저장소 **최다 결함 유형**이다. 같은 실수가 다시 들어오지 못하게 이름을 못박는다.
 */
const WEB = join(process.cwd(), '../web/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** DTO 가 실제로 받는 키 — 손으로 적지 않고 클래스에서 뽑는다 */
function dtoKeys(): string[] {
  const src = readFileSync(
    join(process.cwd(), 'src/modules/patient/dto/patient-query.dto.ts'),
    'utf8',
  );
  return [...src.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

describe('환자 목록 검색 파라미터', () => {
  const files = walk(WEB);
  const keys = dtoKeys();

  it('스캔이 실제로 찾았다 — 0을 통과로 읽지 않는다', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(keys).toContain('q');
    // DTO 인스턴스도 만들어 본다(파일만 읽고 끝내면 클래스가 사라져도 통과한다)
    expect(new PatientQueryDto()).toBeInstanceOf(PatientQueryDto);
  });

  it('🔴 `/api/v1/patients` 호출이 DTO 에 없는 키를 보내지 않는다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // 🔴 **조회(GET)만** 본다. 첫 스캔이 환자 **등록(POST)** 을 목록 조회로 세어 오탐 4건을 냈다.
      //    🔴 그리고 두 번째 시도는 `.get<{ data: … }[]>` 의 **중첩 제네릭** 때문에 정규식이 일찍
      //    끊겨 **재주입해도 통과**했다(가드가 헛돈 사례). 이제 URL 을 먼저 찾고 **뒤로 거슬러
      //    가장 가까운 메서드**를 읽는다 — 제네릭 모양에 기대지 않는다.
      for (const m of src.matchAll(/['"`]\/api\/v1\/patients['"`]\s*,\s*\{([^}]*)\}/g)) {
        const before = src.slice(Math.max(0, m.index! - 400), m.index!);
        const lastCall = [...before.matchAll(/\.(get|post|put|patch|del|delete)\b/g)].pop();
        if (lastCall?.[1] !== 'get') continue;
        for (const k of m[1].matchAll(/(\w+)\s*:/g)) {
          if (!keys.includes(k[1])) {
            offenders.push(`${f.replace(WEB, '')}  → '${k[1]}' 는 PatientQueryDto 에 없다`);
          }
        }
      }
    }
    expect(
      offenders,
      `whitelist 가 조용히 지운다 — 필터가 걸리지 않고 첫 N명이 나온다:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('🔴 좁힌 뒤에도 대상이 0이 아니다 — 실제 조회 호출을 세고 있다', () => {
    let calls = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/['"`]\/api\/v1\/patients['"`]\s*,\s*\{/g)) {
        const before = src.slice(Math.max(0, m.index! - 400), m.index!);
        if ([...before.matchAll(/\.(get|post|put|patch|del|delete)\b/g)].pop()?.[1] === 'get') calls++;
      }
    }
    expect(calls, '좁힌 조준이 아무것도 세지 않으면 가드가 아니다').toBeGreaterThanOrEqual(5);
  });

  it('대조군 — DTO 에 있는 키는 걸리지 않는다(무조건 실패하는 가드가 아니다)', () => {
    expect(keys).toContain('mrn');
    expect(keys).toContain('limit');
    expect(keys).not.toContain('search');
  });
});

/**
 * 🔴 리터럴 유니온 타입은 런타임 검증이 아니다 — `order?: 'asc'|'desc'` 에 @IsIn 이 없으면
 *    `?order=bogus` 가 Prisma orderBy 로 직행해 PrismaClientValidationError → 500(운영 실측).
 *    실제 ValidationPipe 변환을 돌려 행동으로 검증한다(소스 문자열 검사가 아니라).
 */
describe('order 파라미터 런타임 검증(@IsIn)', () => {
  it('?order=bogus 는 검증 오류(400 경로) — Prisma 까지 가지 않는다', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const bad = plainToInstance(PatientQueryDto, { order: 'bogus' });
    const errs = await validate(bad);
    expect(errs.some((e) => e.property === 'order')).toBe(true);
  });
  it('asc/desc/생략은 통과(대조군)', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    for (const v of [{ order: 'asc' }, { order: 'desc' }, {}]) {
      const errs = await validate(plainToInstance(PatientQueryDto, v));
      expect(errs.some((e) => e.property === 'order')).toBe(false);
    }
  });
});
