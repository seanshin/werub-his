import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErFlowDisplayService, maskPublicName } from '../../src/modules/emergency/er-flow-display.service';

/**
 * ER 흐름 TV 보드 — 공개 표면 계약(D1·public-display-masking 선례).
 * 이 스펙이 깨지면 대기실 TV 에 PHI 가 새는 것이다 — 완화 금지.
 */

const VISIT = {
  id: 'v1', patientId: 'p1', arrivalAt: new Date('2026-08-05T00:00:00Z'), triagedAt: new Date(), doctorId: 'd1',
  treatmentStartedAt: null, status: 'PENDING_RESULT', disposition: null, dispositionAt: null,
  admissionId: null, bedId: 'b1',
  patient: { familyName: '홍', givenName: '길동' },
};

function makePrisma(visits: unknown[] = [VISIT]) {
  return {
    emergencyVisit: { findMany: vi.fn().mockResolvedValue(visits) },
    bed: { findMany: vi.fn().mockResolvedValue([{ id: 'b1', roomNumber: 'ACUTE', bedNumber: '1' }]) },
    order: { findMany: vi.fn().mockResolvedValue([
      { status: 'COMPLETED', createdAt: new Date('2026-08-05T01:00:00Z'), prescription: { encounter: { patientId: 'p1' } } },
      { status: 'IN_PROGRESS', createdAt: new Date('2026-08-05T02:00:00Z'), prescription: { encounter: { patientId: 'p1' } } },
    ]) },
  };
}

describe('ErFlowDisplayService (공개 TV)', () => {
  let svc: ErFlowDisplayService;
  beforeEach(() => { svc = new ErFlowDisplayService(makePrisma() as never); });

  it('마스킹 규약 = 외래 전광판 동일(홍○동·2자 홍○)', () => {
    expect(maskPublicName('홍', '길동')).toBe('홍○동');
    expect(maskPublicName('김', '수')).toBe('김○');
  });

  it('공개 행 화이트리스트 — 중증도(KTAS)·주호소·진단·실명·mrn 이 절대 없다', async () => {
    const board = await svc.getFlowBoard();
    const row = board.rows[0] as Record<string, unknown>;
    expect(row.name).toBe('홍○동');
    for (const banned of ['triageLevel', 'ktas', 'chiefComplaint', 'diagnosis', 'mrn', 'patient', 'familyName', 'doctorName']) {
      expect(row).not.toHaveProperty(banned);
    }
    expect(Object.keys(row).sort()).toEqual(
      ['arrivalAt', 'bed', 'careLabel', 'completed', 'completedAt', 'currentStage', 'dispositionLabel', 'id', 'name', 'tests'].sort(),
    );
  });

  it('단계 파생(D2) — PENDING_RESULT=진료·검사(3)·라벨 검사·결과 대기, 베드 라벨 ACUTE-1', async () => {
    const board = await svc.getFlowBoard();
    expect(board.rows[0].currentStage).toBe(3);
    expect(board.rows[0].careLabel).toBe('검사·결과 대기');
    expect(board.rows[0].bed).toBe('ACUTE-1');
    expect(board.rows[0].tests).toEqual({ total: 2, done: 1 }); // 검사 오더 실집계(P1)
  });

  it('종결 파생 — COMPLETED+admissionId=입원 라벨·stage 5', async () => {
    svc = new ErFlowDisplayService(makePrisma([
      { ...VISIT, status: 'COMPLETED', disposition: 'ADMISSION', admissionId: 'a1', dispositionAt: new Date() },
    ]) as never);
    const board = await svc.getFlowBoard();
    expect(board.rows[0].currentStage).toBe(5);
    expect(board.rows[0].completed).toBe(true);
    expect(board.rows[0].dispositionLabel).toBe('입원');
  });

  it('사망(DEATH)은 공용 화면에서 제외 — 가족 통지는 사람의 일', async () => {
    svc = new ErFlowDisplayService(makePrisma([
      { ...VISIT, disposition: 'DEATH', status: 'COMPLETED', dispositionAt: new Date() },
    ]) as never);
    const board = await svc.getFlowBoard();
    expect(board.rows).toHaveLength(0);
  });
});
