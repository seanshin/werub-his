/**
 * 환자 목록 P1(2026-10-20 · `patients-list-refinement-2026-10.plan.md` A5·A6·A7).
 *  - R14 정렬이 `familyName` 한 키 → 같은 성(김 105·배 104)이 쪽 경계에서 순서 미정
 *  - R11 진료 횟수가 작성 중(DRAFT)까지 셌다
 *  - 🔴 R8 품질 지표: 중복 의심 그룹 수를 환자 분모로 · 자비까지 "보험 미확인" · 등록 1년 미만을 "1년 이상 미내원"
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { PatientService } from '../../src/modules/patient/patient.service';

function make(opts: { groupBy?: unknown[]; dup?: { groups: bigint; patients: bigint } } = {}) {
  const prisma = {
    patient: { findMany: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]), count: vi.fn(async () => 10) },
    // 진료 횟수(by status) 와 최근 방문(_max) 두 번 부른다 — 횟수 질의에만 행을 준다
    encounter: { groupBy: vi.fn(async (a: { _max?: unknown }) => (a?._max ? [] : opts.groupBy ?? [])) },
    appointment: { findMany: vi.fn(async () => []) }, admission: { findMany: vi.fn(async () => []) }, emergencyVisit: { findMany: vi.fn(async () => []) }, allergy: { groupBy: vi.fn(async () => []) }, allergyAssessment: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => [opts.dup ?? { groups: 2n, patients: 5n }]),
  };
  const config = { getOrThrow: vi.fn(() => '0'.repeat(64)) } as unknown as ConfigService;
  return { svc: new PatientService(prisma as never, config), prisma };
}
const firstArg = (fn: { mock: { calls: unknown[][] } }, i = 0) => fn.mock.calls[i][0] as Record<string, unknown>;

describe('🔴 결정적 정렬 — 이름 → 등록번호 → id', () => {
  it('기본(성) 정렬은 이름·등록번호·id 로 끝까지 정한다', async () => {
    const { svc, prisma } = make();
    await svc.findAll({} as never);
    expect(firstArg(prisma.patient.findMany).orderBy).toEqual([{ familyName: 'asc' }, { givenName: 'asc' }, { mrn: 'asc' }, { id: 'asc' }]);
  });
  it('등록번호 정렬은 id 로만 마무리', async () => {
    const { svc, prisma } = make();
    await svc.findAll({ sort: 'mrn', order: 'desc' } as never);
    expect(firstArg(prisma.patient.findMany).orderBy).toEqual([{ mrn: 'desc' }, { id: 'asc' }]);
  });
});

describe('🔴 진료 횟수 — 서명된 진료와 작성 중을 따로', () => {
  it('SIGNED·AMENDED 는 서명 · DRAFT 는 작성 중 · 기록 없으면 0/0', async () => {
    const { svc } = make({
      groupBy: [
        { patientId: 'a', status: 'SIGNED', _count: { _all: 3 } },
        { patientId: 'a', status: 'AMENDED', _count: { _all: 1 } },
        { patientId: 'a', status: 'DRAFT', _count: { _all: 2 } },
      ],
    });
    const res = await svc.findAll({} as never);
    const a = res.data.find((d) => d.id === 'a') as unknown as { encounterCounts: unknown };
    const b = res.data.find((d) => d.id === 'b') as unknown as { encounterCounts: unknown };
    expect(a.encounterCounts).toEqual({ signed: 4, drafts: 2 });
    expect(b.encounterCounts).toEqual({ signed: 0, drafts: 0 });
  });
});

describe('🔴 품질 지표 — 분자·분모·단위를 함께', () => {
  it('중복 의심은 그룹 수와 환자 수를 따로 · 분모는 전체 환자', async () => {
    const { svc } = make({ dup: { groups: 86n, patients: 175n } });
    const q = await svc.getQualityDashboard();
    expect(q.duplicateSuspect).toEqual({ groups: 86, patients: 175, denominator: 10 });
  });

  it('보험 증번호 없음 — 건보·의료급여만 분자·분모(자비·산재·자보 제외)', async () => {
    const { svc, prisma } = make();
    await svc.getQualityDashboard();
    const wheres = prisma.patient.count.mock.calls.map((c) => JSON.stringify((c[0] as { where: unknown }).where));
    expect(wheres).toContain(JSON.stringify({ validTo: null, insuranceNumber: null, insuranceType: { in: ['NHI', 'MEDICAID'] } }));
    expect(wheres).toContain(JSON.stringify({ validTo: null, insuranceType: { in: ['NHI', 'MEDICAID'] } }));
    // 종전 조건(보험번호만)으로 세지 않는다
    expect(wheres).not.toContain(JSON.stringify({ validTo: null, insuranceNumber: null }));
  });

  it('1년 이상 미내원 — 등록 1년이 지난 환자만 분자·분모', async () => {
    const { svc, prisma } = make();
    await svc.getQualityDashboard();
    const wheres = prisma.patient.count.mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where);
    const dormant = wheres.find((w) => 'encounters' in w) as { createdAt?: { lte?: Date } };
    expect(dormant?.createdAt?.lte).toBeInstanceOf(Date);
    expect(wheres.some((w) => !('encounters' in w) && (w.createdAt as { lte?: Date } | undefined)?.lte)).toBe(true);
  });

  it('사진은 정책 미정 표식 · 드릴다운 필터가 지표와 같은 조건', async () => {
    const { svc, prisma } = make();
    const q = await svc.getQualityDashboard();
    expect(q.noPhoto.policy).toBe('UNDECIDED');
    await svc.findAll({ quality: 'noInsurance' } as never);
    await svc.findAll({ quality: 'dormant' } as never);
    const w1 = JSON.stringify(firstArg(prisma.patient.findMany, 0).where);
    const w2 = JSON.stringify(firstArg(prisma.patient.findMany, 1).where);
    expect(w1).toContain('"insuranceType":{"in":["NHI","MEDICAID"]}');
    expect(w2).toContain('"createdAt":{"lte"');
  });
});
