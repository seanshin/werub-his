/**
 * 문제 목록 ↔ 진료 진단(2026-10-03).
 *  🔴 문제 추가 EP 는 있었는데 부르는 화면이 없었다(탭 읽기 전용) — 진단에서 사람이 올리는 길을 열며 중복을 서버가 막는다
 *  🔴 자동 동기화(설정 clinical.diagnosisToProblem · 기본 OFF)의 중복 검사가 ACTIVE 만 봐서 만성(CHRONIC)으로 정리된 같은 진단을 한 번 더 만들었다
 * 재주입: 중복 검사 상태 집합·409 를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { ProblemListService, PROBLEM_CURRENT_STATUSES } from '../../src/modules/problem-list/problem-list.service';
import { DiagnosisProblemListener } from '../../src/modules/problem-list/diagnosis-problem.listener';

describe('문제 추가 — 같은 진단 중복 거부', () => {
  it('🔴 활성·만성으로 이미 있으면 409(상태는 값으로) · 대조군: 해결된 것만 있으면 다시 올릴 수 있다', async () => {
    const create = vi.fn(async (a: any) => ({ id: 'n', ...a.data }));
    const prisma: any = { problemList: { findFirst: vi.fn(async () => ({ id: 'p1', status: 'CHRONIC' })), create } };
    const svc = new ProblemListService(prisma);
    const err: any = await svc.create('pt', { diagnosisCodeId: 'dc', description: '당뇨' } as never, 'u').catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'PROBLEM_ALREADY_LISTED', details: { problemId: 'p1', status: 'CHRONIC' } });
    expect(create).not.toHaveBeenCalled();
    expect(prisma.problemList.findFirst.mock.calls[0][0].where).toEqual({ patientId: 'pt', diagnosisCodeId: 'dc', status: { in: ['ACTIVE', 'CHRONIC'] } });
    prisma.problemList.findFirst = vi.fn(async () => null);
    await svc.create('pt', { diagnosisCodeId: 'dc', description: '당뇨', status: 'ACTIVE', severity: 'MILD' } as never, 'u');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('자동 동기화(기본 OFF) — 만성 중복', () => {
  it('🔴 켜져 있을 때 같은 진단이 만성으로 있으면 만들지 않는다(종전 ACTIVE 만 봤다)', async () => {
    const prisma: any = {
      encounter: { findUnique: vi.fn(async () => ({ id: 'e', patientId: 'pt', doctorId: 'd', diagnoses: [{ diagnosisCodeId: 'dc', certainty: 'CONFIRMED', notes: null, onsetDate: null, diagnosisCode: { nameKo: '당뇨' } }] })) },
      problemList: { findFirst: vi.fn(async () => ({ id: 'p1' })), create: vi.fn() },
    };
    const l = new DiagnosisProblemListener(prisma, { get: vi.fn(async () => true) } as never);
    await l.onEncounterSigned({ encounterId: 'e', patientId: 'pt' });
    expect(prisma.problemList.findFirst.mock.calls[0][0].where.status).toEqual({ in: PROBLEM_CURRENT_STATUSES });
    expect(prisma.problemList.create).not.toHaveBeenCalled();
    expect(PROBLEM_CURRENT_STATUSES).toEqual(['ACTIVE', 'CHRONIC']);
  });
});
