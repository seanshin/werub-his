/**
 * 🔴 수술 의무기록 누락을 세는가 — 수술 흐름 검토(계획서 §3 #3).
 *
 * 2026-08-21 운영 실측: 완료 수술 46건 중
 *   · **수술기록지(Op Note) 없음 10건**
 *   · 그중 **8건은 안전 체크리스트(IPSG.4)도 없음**
 * 그런데 **이를 세는 지표가 어디에도 없었다.**
 * 안전 게이트 관제(2408)는 체크리스트를 **최근 30일 추세**로 본다(정당) —
 * 그 범위 밖의 누적 누락과 **수술기록지 자체의 부재**는 아무도 보지 않았다.
 *
 * 🔴 수술기록은 의무기록 보존 대상이다. 없으면 그 사실이 화면에 떠야 한다.
 *
 * 재주입: 두 지표 중 하나를 레지스트리에서 빼면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { SURGERY_METRICS } from '../../src/modules/data-quality/quality-registry';

const byKey = (k: string) => SURGERY_METRICS.find((m) => m.key === k)!;

describe('수술 의무기록 지표', () => {
  it('🔴 두 지표가 등재되어 있다 — 없으면 누락이 드러나지 않는다', () => {
    expect(byKey('surgery.opNoteMissing'), '수술기록지 누락 지표가 없다').toBeTruthy();
    expect(byKey('surgery.checklistMissing'), '체크리스트 누락 지표가 없다').toBeTruthy();
  });

  it('🔴 완료 5건 중 기록지 2건이면 누락 3 · 분모 5', async () => {
    const p: any = {
      surgery: {
        count: vi.fn().mockResolvedValue(5),
        findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]),
      },
      surgeryOpNote: { findMany: vi.fn().mockResolvedValue([{ surgeryId: 'a' }, { surgeryId: 'b' }]) },
    };
    const r = await byKey('surgery.opNoteMissing').compute(p);
    expect(r.value).toBe(3);
    expect(r.total).toBe(5);
  });

  it('🔴 분모를 반드시 낸다 — 분모 0이면 "누락 0"은 성과가 아니라 표본 부재다', async () => {
    const p: any = {
      surgery: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      surgeryOpNote: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const r = await byKey('surgery.opNoteMissing').compute(p);
    expect(r.value).toBe(0);
    expect(r.total).toBe(0); // 이 값이 없으면 화면이 "누락 0 = 안전"으로 읽는다
  });

  it('체크리스트 지표는 수술방을 거친 것만 모집단으로 한다 — 예정 수술은 아직 대상이 아니다', async () => {
    const p: any = {
      surgery: { findMany: vi.fn().mockResolvedValue([{ id: 'x' }, { id: 'y' }]) },
      surgicalChecklist: { findMany: vi.fn().mockResolvedValue([{ surgeryId: 'x' }]) },
    };
    const r = await byKey('surgery.checklistMissing').compute(p);
    expect(r.value).toBe(1);
    expect(r.total).toBe(2);
    const where = p.surgery.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['IN_PROGRESS', 'COMPLETED']);
    expect(where.status.in).not.toContain('SCHEDULED');
  });

  it('전건 기록되어 있으면 0 — 거짓 경보를 만들지 않는다', async () => {
    const p: any = {
      surgery: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) },
      surgeryOpNote: { findMany: vi.fn().mockResolvedValue([{ surgeryId: 'a' }, { surgeryId: 'b' }]) },
    };
    const r = await byKey('surgery.opNoteMissing').compute(p);
    expect(r.value).toBe(0);
    expect(r.total).toBe(2);
  });

  it('심각도는 CRITICAL — 의무기록 누락은 경고가 아니다', () => {
    expect(byKey('surgery.opNoteMissing').severityWhenOver).toBe('CRITICAL');
    expect(byKey('surgery.checklistMissing').severityWhenOver).toBe('CRITICAL');
  });
});
