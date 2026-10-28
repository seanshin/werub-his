import { describe, it, expect } from 'vitest';
import {
  careContextOf,
  buildCareContext,
  isIcuWard,
  isNightHour,
  isNightHandled,
  kstHour,
  CARE_CONTEXT_LABEL,
  DEFAULT_ICU_WARD_PATTERNS,
} from '../../src/modules/order/care-context';

describe('진료 맥락 판정', () => {
  it('입원 연결이 없으면 외래', () => {
    expect(careContextOf({})).toBe('OUTPATIENT');
  });

  it('입원 연결이 있으면 입원', () => {
    expect(careContextOf({ admissionId: 'a1', wardName: '5층 내과병동' })).toBe('INPATIENT');
  });

  it('중환자 병동이면 입원보다 중환자로 본다', () => {
    expect(careContextOf({ admissionId: 'a1', wardName: '내과계 중환자실' })).toBe('ICU');
    expect(careContextOf({ admissionId: 'a1', wardName: 'MICU 3F' })).toBe('ICU');
  });

  it('병동 이름이 없으면 중환자로 오인하지 않는다', () => {
    expect(careContextOf({ admissionId: 'a1', wardName: null })).toBe('INPATIENT');
  });

  it('진행 중 응급 방문이면 응급', () => {
    expect(careContextOf({ erStatus: 'IN_TREATMENT' })).toBe('ER');
    expect(careContextOf({ erStatus: 'PENDING_TRIAGE' })).toBe('ER');
  });

  it('🔴 종결된 응급 방문은 더 이상 응급이 아니다 — 지난 방문으로 화면이 오염된다', () => {
    expect(careContextOf({ erStatus: 'COMPLETED' })).toBe('OUTPATIENT');
  });

  it('응급 협진 방문유형도 응급으로 본다', () => {
    expect(careContextOf({ visitType: 'ER_CONSULT' })).toBe('ER');
  });

  it('🔴 응급실 경유 후 중환자실로 올라가면 중환자 — 현재 위치가 처리 방식을 정한다', () => {
    expect(careContextOf({ admissionId: 'a1', wardName: 'SICU', erStatus: 'IN_TREATMENT' })).toBe('ICU');
  });

  it('병동 이름 패턴을 운영값으로 덮어쓸 수 있다', () => {
    expect(isIcuWard('집중치료실', DEFAULT_ICU_WARD_PATTERNS)).toBe(false);
    expect(isIcuWard('집중치료실', ['집중치료'])).toBe(true);
  });

  it('모든 맥락에 한글 라벨이 있다', () => {
    for (const c of ['OUTPATIENT', 'INPATIENT', 'ICU', 'ER'] as const) {
      expect(CARE_CONTEXT_LABEL[c]).toBeTruthy();
    }
  });
});

describe('야간 시간대(KST)', () => {
  // 컨테이너는 UTC 로 돈다 — KST 환산을 빼먹으면 9시간 어긋난다
  it('KST 환산이 맞다', () => {
    expect(kstHour(new Date('2026-07-31T14:00:00Z'))).toBe(23);
    expect(kstHour(new Date('2026-07-31T00:00:00Z'))).toBe(9);
  });

  it('22시~06시가 야간', () => {
    expect(isNightHour(new Date('2026-07-31T13:30:00Z'))).toBe(true);  // 22:30 KST
    expect(isNightHour(new Date('2026-07-31T19:00:00Z'))).toBe(true);  // 04:00 KST
    expect(isNightHour(new Date('2026-07-31T21:30:00Z'))).toBe(false); // 06:30 KST
    expect(isNightHour(new Date('2026-07-31T04:00:00Z'))).toBe(false); // 13:00 KST
  });

  it('자정을 넘는 구간이 끊기지 않는다', () => {
    expect(isNightHour(new Date('2026-07-31T14:59:59Z'))).toBe(true); // 23:59 KST
    expect(isNightHour(new Date('2026-07-31T15:00:00Z'))).toBe(true); // 00:00 KST
  });
});

describe('야간 처리 대상', () => {
  it('입원·응급·중환자는 시간대와 무관하게 상시 처리 대상', () => {
    expect(isNightHandled('INPATIENT')).toBe(true);
    expect(isNightHandled('ER')).toBe(true);
    expect(isNightHandled('ICU')).toBe(true);
  });

  it('🔴 외래 루틴은 야간 대상이 아니다 — 당직 목록이 외래로 덮이면 쓸모가 없다', () => {
    expect(isNightHandled('OUTPATIENT', 'ROUTINE')).toBe(false);
    expect(isNightHandled('OUTPATIENT')).toBe(false);
  });

  it('외래라도 STAT·긴급은 즉시 처리 대상', () => {
    expect(isNightHandled('OUTPATIENT', 'STAT')).toBe(true);
    expect(isNightHandled('OUTPATIENT', 'URGENT')).toBe(true);
  });
});

describe('종합 판정', () => {
  it('"야간에 발행"과 "야간에 처리"는 다른 값이다', () => {
    // 낮에 발행된 입원 오더 — 처리 대상이지만 야간 발행은 아니다
    const day = buildCareContext({ admissionId: 'a1', priority: 'ROUTINE', createdAt: new Date('2026-07-31T04:00:00Z') });
    expect(day.nightHandled).toBe(true);
    expect(day.issuedAtNight).toBe(false);

    // 야간에 발행된 외래 루틴 — 발행은 야간이지만 당직 처리 대상은 아니다
    const night = buildCareContext({ priority: 'ROUTINE', createdAt: new Date('2026-07-31T14:00:00Z') });
    expect(night.nightHandled).toBe(false);
    expect(night.issuedAtNight).toBe(true);
  });

  it('발행 시각이 없으면 야간 발행으로 단정하지 않는다', () => {
    expect(buildCareContext({ admissionId: 'a1' }).issuedAtNight).toBe(false);
  });
});

/**
 * 🔴 컨트롤러 파라미터 순서 계약 — `@Query` 는 **위치 인자**다.
 * 신규 필터를 page/limit 앞에 끼웠더니 위치로 호출하는 쪽의 인자가 통째로 밀려
 * page=2 가 careContext='2' 로 들어갔다(실측 실패 2건). 신규는 항상 맨 뒤.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('오더 목록 컨트롤러 파라미터 순서', () => {
  const src = readFileSync(join(process.cwd(), 'src/modules/order/order.controller.ts'), 'utf-8');
  const sig = src.slice(src.indexOf('async findAll('), src.indexOf('  ) {', src.indexOf('async findAll(')));
  const order = [...sig.matchAll(/@Query\('(\w+)'\)/g)].map((m) => m[1]);

  it('실제로 파싱됐다', () => {
    expect(order.length).toBeGreaterThanOrEqual(9);
  });

  it('page·limit 이 신규 필터보다 앞에 온다', () => {
    expect(order.indexOf('page')).toBeLessThan(order.indexOf('careContext'));
    expect(order.indexOf('limit')).toBeLessThan(order.indexOf('nightOnly'));
  });

  it('종전 파라미터 순서가 유지된다(위치 호출 호환)', () => {
    expect(order.slice(0, 9)).toEqual([
      'department', 'status', 'doctorId', 'type', 'from', 'to', 'priority', 'page', 'limit',
    ]);
  });
});

/** 환자 필터도 위치 인자 뒤에 붙어야 한다(같은 함정 재발 방지) */
describe('오더 목록 — 환자 필터', () => {
  const src = readFileSync(join(process.cwd(), 'src/modules/order/order.controller.ts'), 'utf-8');
  const sig = src.slice(src.indexOf('async findAll('), src.indexOf('  ) {', src.indexOf('async findAll(')));
  const order = [...sig.matchAll(/@Query\('(\w+)'\)/g)].map((m) => m[1]);

  it('patientId 파라미터가 있다', () => {
    expect(order).toContain('patientId');
  });

  it('page·limit 보다 뒤에 온다', () => {
    expect(order.indexOf('page')).toBeLessThan(order.indexOf('patientId'));
  });

  it('환자 필터가 처방→진료 경로로 적용된다', () => {
    const svc = readFileSync(join(process.cwd(), 'src/modules/order/order.service.ts'), 'utf-8');
    expect(svc).toMatch(/patientId\s*\?\s*\{\s*patientId:\s*filters\.patientId\s*\}/);
  });
});
