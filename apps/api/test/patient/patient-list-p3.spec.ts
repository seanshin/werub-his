/**
 * 환자 목록 P3(2026-10-20 · `patients-list-refinement-2026-10.plan.md` B1·B2·B4·B5).
 *  - 알레르기 확인 상태: 단건 조회와 같은 규칙(순수 함수 하나) · 조회 권한 역할만 · 권한 밖이면 칸이 없다
 *  - 최근 방문(서명된 진료만)·다음 예약·머무는 곳(재원·응급) — 한 쪽 묶음 조회
 *  - "내 환자" 범위 — 기본 범위가 아니라 필터 · 의사에게 묶인 원장(진료·담당 입원·오늘 예약)
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserRole } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { ALLERGY_STATUS_ROLES } from '@hospital-run/shared';
import { deriveAllergyStatus } from '../../src/modules/allergy/allergy-status-derive';
import { listRowExtras } from '../../src/modules/patient/patient-list-enrich';
import { resolveListAccess } from '../../src/modules/patient/patient-list-access';
import { PatientService } from '../../src/modules/patient/patient.service';

const d = (s: string) => new Date(s);

describe('알레르기 확인 상태 — 단건과 목록이 같은 규칙', () => {
  it('활성 있으면 있음 · 문진 결과 · 문진 없음/낡음은 미확인', () => {
    expect(deriveAllergyStatus({ activeCount: 1, latest: null, lastAllergyChangeAt: null })).toBe('HAS_ALLERGIES');
    expect(deriveAllergyStatus({ activeCount: 0, latest: null, lastAllergyChangeAt: null })).toBe('NOT_ASSESSED');
    expect(deriveAllergyStatus({ activeCount: 0, latest: { result: 'NO_KNOWN_ALLERGIES', assessedAt: d('2026-10-01') }, lastAllergyChangeAt: null })).toBe('NO_KNOWN_ALLERGIES');
    expect(deriveAllergyStatus({ activeCount: 0, latest: { result: 'UNABLE_TO_ASSESS', assessedAt: d('2026-10-01') }, lastAllergyChangeAt: null })).toBe('UNABLE_TO_ASSESS');
    // 🔴 문진 뒤에 알레르기가 바뀌었으면 옛 NKA 를 다시 내지 않는다
    expect(deriveAllergyStatus({ activeCount: 0, latest: { result: 'NO_KNOWN_ALLERGIES', assessedAt: d('2026-10-01') }, lastAllergyChangeAt: d('2026-10-05') })).toBe('NOT_ASSESSED');
  });

  it('🔴 구조 가드 — 단건 조회(AllergyService.getStatus)가 같은 함수를 쓴다(규칙 둘 금지)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/allergy/allergy.service.ts'), 'utf8');
    const body = src.slice(src.indexOf('async getStatus('), src.indexOf('async checkDrugAllergy('));
    expect(body).toMatch(/deriveAllergyStatus\(/);
    expect(body).not.toMatch(/status = 'NO_KNOWN_ALLERGIES'/);
  });
});

function fakeDb(over: Partial<Record<string, unknown>> = {}) {
  return {
    encounter: { groupBy: vi.fn(async () => [{ patientId: 'a', _max: { createdAt: d('2026-10-10T01:00:00Z') } }]) },
    appointment: { findMany: vi.fn(async () => [{ patientId: 'a', scheduledAt: d('2026-10-25T00:00:00Z'), departmentName: '내과' }, { patientId: 'a', scheduledAt: d('2026-11-25T00:00:00Z'), departmentName: '외과' }]) },
    admission: { findMany: vi.fn(async () => [{ patientId: 'b', bed: { roomNumber: '501', bedNumber: 'A', ward: { name: '5병동' } } }]) },
    emergencyVisit: { findMany: vi.fn(async () => [{ patientId: 'c', status: 'IN_TREATMENT' }]) },
    allergy: { groupBy: vi.fn(async (a: { _count?: unknown }) => (a._count ? [{ patientId: 'a', _count: { _all: 2 } }] : [])) },
    allergyAssessment: { findMany: vi.fn(async () => [{ patientId: 'b', result: 'NO_KNOWN_ALLERGIES', assessedAt: d('2026-10-01') }]) },
    ...over,
  };
}

describe('listRowExtras — 한 쪽 묶음 조회', () => {
  it('최근 방문은 서명된 진료만 · 다음 예약은 가장 이른 것 · 재원은 병동/호실 · 응급 진행 · 없으면 null', async () => {
    const db = fakeDb();
    const m = await listRowExtras(db as never, ['a', 'b', 'c', 'z'], { allergy: false, now: d('2026-10-20T00:00:00Z') });
    expect((db.encounter.groupBy.mock.calls[0] as unknown as [{ where: { status: unknown } }])[0].where.status).toEqual({ in: ['SIGNED', 'AMENDED'] });
    expect(m.get('a')).toMatchObject({ lastVisitAt: '2026-10-10T01:00:00.000Z', nextAppointment: { department: '내과' }, stay: null });
    expect(m.get('b')!.stay).toEqual({ kind: 'ADMITTED', ward: '5병동', room: '501', bed: 'A' });
    expect(m.get('c')!.stay).toEqual({ kind: 'ER', status: 'IN_TREATMENT' });
    expect(m.get('z')).toEqual({ lastVisitAt: null, nextAppointment: null, stay: null });
  });

  it('🔴 권한 밖이면 알레르기 칸이 없고 조회도 하지 않는다', async () => {
    const db = fakeDb();
    const m = await listRowExtras(db as never, ['a'], { allergy: false });
    expect('allergyStatus' in m.get('a')!).toBe(false);
    expect(db.allergy.groupBy).not.toHaveBeenCalled();
    expect(db.allergyAssessment.findMany).not.toHaveBeenCalled();
  });

  it('권한이면 4상태 — 활성 있음 · 문진 없음 = 미확인(없음이 아님) · NKA 는 문진 근거', async () => {
    const m = await listRowExtras(fakeDb() as never, ['a', 'b', 'z'], { allergy: true });
    expect(m.get('a')!.allergyStatus).toBe('HAS_ALLERGIES');
    expect(m.get('b')!.allergyStatus).toBe('NO_KNOWN_ALLERGIES');
    expect(m.get('z')!.allergyStatus).toBe('NOT_ASSESSED');
  });

  it('빈 쪽은 조회 없이 빈 결과', async () => {
    const db = fakeDb();
    expect((await listRowExtras(db as never, [], { allergy: true })).size).toBe(0);
    expect(db.encounter.groupBy).not.toHaveBeenCalled();
  });
});

describe('능력표 — 알레르기 칸·내 환자 필터', () => {
  const rbac = { contact: true, identity: false, create: false, import: false, merge: false, export: false };
  it('알레르기 칸 = ALLERGY_STATUS_ROLES(단건 조회와 같은 역할) · 내 환자 = 의사만', () => {
    for (const role of Object.values(UserRole)) {
      const a = resolveListAccess(rbac, role, null);
      expect(a.allergyStatus, role).toBe((ALLERGY_STATUS_ROLES as readonly string[]).includes(role));
      expect(a.myScope, role).toBe(role === 'DOCTOR');
    }
  });
});

describe('"내 환자" 범위 — 의사에게 묶인 원장', () => {
  const svc = () => {
    const prisma = {
      patient: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      encounter: { groupBy: vi.fn(async () => []) },
    };
    return { s: new PatientService(prisma as never, { getOrThrow: vi.fn(() => '0'.repeat(64)) } as unknown as ConfigService), prisma };
  };
  it('최근 30일 내 진료 · 내 담당 입원 · 오늘 내 예약', async () => {
    const { s, prisma } = svc();
    await s.findAll({ scope: 'mine' } as never, { userId: 'doc-1' });
    const where = JSON.stringify((prisma.patient.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where);
    expect(where).toContain('"doctorId":"doc-1"');
    expect(where).toContain('"admittingDoctorId":"doc-1"');
    expect(where).toContain('"appointments"');
  });
  it('🔴 열람자를 모르면 빈 결과(전체를 내지 않는다)', async () => {
    const { s, prisma } = svc();
    await s.findAll({ scope: 'mine' } as never, {});
    expect(JSON.stringify((prisma.patient.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where)).toContain('"id":{"in":[]}');
  });
});
