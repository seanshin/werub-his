/**
 * 🔴 입원 흐름의 의무기록·이력 누락을 세는가 — 계획서 §3 #4.
 *
 * 2026-08-21 운영 실측:
 *   · 퇴원 28건 중 **퇴원요약 없음 22건**
 *   · 재원 5명 중 **병상 배정 이력 없음 4명**(`admissions.bedId` 는 있는데 `bed_assignments` 가 없다)
 *   · 퇴원했는데 **진행 중 프로토콜 1건**
 * 그런데 셋 다 **세는 곳이 없었다.**
 *
 * 퇴원 게이트(`inpatient.dischargeGate`)는 **앞으로의 퇴원**을 막는다 — 이미 쌓인 누락과
 * 게이트를 타지 않는 경로(시드·직접 INSERT)는 보지 않는다. 수술 흐름과 같은 처방이다.
 *
 * 🔴 프로토콜은 **자동으로 끊지 않는다**(퇴원 후 외래로 이어질 수 있어 임상 판단이다). 드러내기만 한다.
 *
 * 재주입: 지표를 레지스트리에서 빼면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { ADMISSION_METRICS } from '../../src/modules/data-quality/quality-registry';

const byKey = (k: string) => ADMISSION_METRICS.find((m) => m.key === k)!;

describe('입원 의무기록·이력 지표', () => {
  it('🔴 세 지표가 등재되어 있다', () => {
    for (const k of ['admission.dischargeSummaryMissing', 'admission.bedAssignmentMissing', 'admission.staleProtocol']) {
      expect(byKey(k), `${k} 지표가 없다`).toBeTruthy();
    }
  });

  it('🔴 퇴원 4건 중 요약 1건이면 누락 3 · 분모 4', async () => {
    const p: any = {
      admission: {
        count: vi.fn().mockResolvedValue(4),
        findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]),
      },
      dischargeSummary: { findMany: vi.fn().mockResolvedValue([{ admissionId: 'a' }]) },
    };
    const r = await byKey('admission.dischargeSummaryMissing').compute(p);
    expect(r.value).toBe(3);
    expect(r.total).toBe(4);
  });

  it('🔴 재원 3명 중 배정 이력 1명이면 누락 2 · 분모 3 — 해제된 이력은 세지 않는다', async () => {
    const p: any = {
      admission: { findMany: vi.fn().mockResolvedValue([{ id: 'x' }, { id: 'y' }, { id: 'z' }]) },
      bedAssignment: { findMany: vi.fn().mockResolvedValue([{ admissionId: 'x' }]) },
    };
    const r = await byKey('admission.bedAssignmentMissing').compute(p);
    expect(r.value).toBe(2);
    expect(r.total).toBe(3);
    expect(p.bedAssignment.findMany.mock.calls[0][0].where.releasedAt).toBeNull();
  });

  it('🔴 퇴원 환자의 진행 중 프로토콜만 센다 — 재원 환자 것은 정상이다', async () => {
    const p: any = {
      protocolInstance: { findMany: vi.fn().mockResolvedValue([{ admissionId: 'open' }, { admissionId: 'closed' }]) },
      admission: { findMany: vi.fn().mockResolvedValue([{ id: 'open' }]) },
    };
    const r = await byKey('admission.staleProtocol').compute(p);
    expect(r.value).toBe(1);
    expect(r.total).toBe(2);
  });

  it('🔴 분모가 0이면 값도 0 — "누락 없음"이 아니라 표본 부재다', async () => {
    const p: any = {
      protocolInstance: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const r = await byKey('admission.staleProtocol').compute(p);
    expect(r).toEqual({ value: 0, total: 0 });
  });

  it('전건 기록되어 있으면 0 — 거짓 경보를 만들지 않는다', async () => {
    const p: any = {
      admission: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) },
      dischargeSummary: { findMany: vi.fn().mockResolvedValue([{ admissionId: 'a' }, { admissionId: 'b' }]) },
    };
    const r = await byKey('admission.dischargeSummaryMissing').compute(p);
    expect(r.value).toBe(0);
    expect(r.total).toBe(2);
  });

  it('퇴원요약 누락은 CRITICAL — 의무기록이다', () => {
    expect(byKey('admission.dischargeSummaryMissing').severityWhenOver).toBe('CRITICAL');
  });
});
