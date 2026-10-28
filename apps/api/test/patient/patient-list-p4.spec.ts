/**
 * 환자 목록 P4(2026-10-20 · `patients-list-refinement-2026-10.plan.md` B6·B9).
 *  - B6 오래된 작성 중 기록: 의사는 🔴 본인이 작성한 것만 · 관리자는 작성자 무관 수 · 다른 역할은 칸이 없다(0 이 아니다)
 *  - B9 선택 행 반출: 고른 id 만 · 다른 조건(유효 레코드)과 AND · id 형식·개수 검증 · 감사에 고른 id
 */
import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ConfigService } from '@nestjs/config';
import { listRowExtras, STALE_DRAFT_DAYS } from '../../src/modules/patient/patient-list-enrich';
import { resolveListAccess } from '../../src/modules/patient/patient-list-access';
import { PatientService } from '../../src/modules/patient/patient.service';
import { PatientQueryDto } from '../../src/modules/patient/dto/patient-query.dto';

const d = (s: string) => new Date(s);
const NOW = d('2026-10-20T00:00:00Z');

function fakeDb() {
  const groupBy = vi.fn(async (a: { where: { status?: unknown }; _count?: unknown }) =>
    a.where.status === 'DRAFT' ? [{ patientId: 'a', _count: { _all: 2 }, _min: { createdAt: d('2026-10-01T00:00:00Z') } }] : []);
  return {
    encounter: { groupBy },
    appointment: { findMany: vi.fn(async () => []) },
    admission: { findMany: vi.fn(async () => []) },
    emergencyVisit: { findMany: vi.fn(async () => []) },
    allergy: { groupBy: vi.fn(async () => []) },
    allergyAssessment: { findMany: vi.fn(async () => []) },
  };
}
const draftCall = (db: ReturnType<typeof fakeDb>) =>
  (db.encounter.groupBy.mock.calls as unknown as [{ where: Record<string, unknown> }][]).map((c) => c[0].where).find((w) => w.status === 'DRAFT');

describe('B6 오래된 작성 중 기록', () => {
  it(`🔴 의사 — 본인이 작성한 ${STALE_DRAFT_DAYS}일 넘은 작성 중만 · 수와 가장 오래된 시각 · 없으면 0/null`, async () => {
    const db = fakeDb();
    const m = await listRowExtras(db as never, ['a', 'z'], { allergy: false, staleDrafts: { mode: 'MINE', userId: 'doc-1' }, now: NOW });
    const w = draftCall(db)!;
    expect(w.doctorId).toBe('doc-1');
    expect((w.createdAt as { lt: Date }).lt.getTime()).toBe(NOW.getTime() - STALE_DRAFT_DAYS * 86_400_000);
    expect(m.get('a')!.staleDrafts).toEqual({ count: 2, oldestAt: '2026-10-01T00:00:00.000Z' });
    expect(m.get('z')!.staleDrafts).toEqual({ count: 0, oldestAt: null });
  });

  it('관리자 — 작성자 무관(doctorId 조건 없음)', async () => {
    const db = fakeDb();
    await listRowExtras(db as never, ['a'], { allergy: false, staleDrafts: { mode: 'ALL' }, now: NOW });
    expect('doctorId' in draftCall(db)!).toBe(false);
  });

  it('🔴 권한 밖이면 칸이 없고 조회도 하지 않는다(0 으로 그리지 않게)', async () => {
    const db = fakeDb();
    const m = await listRowExtras(db as never, ['a'], { allergy: false, now: NOW });
    expect('staleDrafts' in m.get('a')!).toBe(false);
    expect(draftCall(db)).toBeUndefined();
  });

  it('능력표 — 의사 MINE · 관리자 ALL · 나머지 null · 기준 일수를 함께 준다', () => {
    const rbac = { contact: true, identity: false, create: false, import: false, merge: false, export: false };
    for (const role of Object.values(UserRole)) {
      const a = resolveListAccess(rbac, role, null);
      expect(a.staleDrafts, role).toBe(role === 'DOCTOR' ? 'MINE' : role === 'ADMIN' ? 'ALL' : null);
      expect(a.staleDraftDays).toBe(STALE_DRAFT_DAYS);
    }
  });

  it('🔴 목록 서비스 — 의사인데 열람자를 모르면 칸을 내지 않는다(남의 기록을 "내 것"으로 세지 않는다)', async () => {
    const prisma = { patient: { findMany: vi.fn(async () => [{ id: 'a' }]), count: vi.fn(async () => 1) }, ...fakeDb() };
    const s = new PatientService(prisma as never, { getOrThrow: vi.fn(() => '0'.repeat(64)) } as unknown as ConfigService);
    const res = await s.findAll({} as never, { staleDrafts: 'MINE' });
    expect('staleDrafts' in (res.data[0] as object)).toBe(false);
    const res2 = await s.findAll({} as never, { staleDrafts: 'MINE', userId: 'doc-1' });
    expect((res2.data[0] as { staleDrafts?: unknown }).staleDrafts).toEqual({ count: 2, oldestAt: '2026-10-01T00:00:00.000Z' });
  });
});

describe('B9 선택 행 반출', () => {
  const ID1 = '11111111-1111-4111-8111-111111111111';
  const ID2 = '22222222-2222-4222-8222-222222222222';
  it('고른 id 만 · 유효 레코드 조건과 함께', async () => {
    const prisma = { patient: { findMany: vi.fn(async () => []) } };
    const s = new PatientService(prisma as never, { getOrThrow: vi.fn(() => '0'.repeat(64)) } as unknown as ConfigService);
    await s.exportList({ ids: `${ID1},${ID2}` } as never);
    const where = JSON.stringify((prisma.patient.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where);
    expect(where).toContain(`"id":{"in":["${ID1}","${ID2}"]}`);
    expect(where).toContain('"validTo":null');
  });

  it('id 형식·최대 100 검증(목록 밖 값을 넘기지 않는다)', () => {
    const ok = (ids: string) => validateSync(plainToInstance(PatientQueryDto, { ids })).length === 0;
    expect(ok(`${ID1},${ID2}`)).toBe(true);
    expect(ok('abc')).toBe(false);
    expect(ok(`${ID1}; DROP`)).toBe(false);
    expect(ok(Array(100).fill(ID1).join(','))).toBe(true);
    expect(ok(Array(101).fill(ID1).join(','))).toBe(false);
  });
});
