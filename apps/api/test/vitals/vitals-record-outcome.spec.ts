/**
 * 🔴 활력 기록 결과가 화면까지 간다 — 2026-08-20.
 *
 * 실측 배경: `record()` 는 `DUPLICATE`·`PENDING` 일 때 **저장된 행(null)만** 돌려줬다.
 * 컨트롤러는 그것을 `{ data: null }` 로 200 응답에 실었고, 화면은 **왜 저장이 안 됐는지**
 * 알 수 없었다. 그 사실은 서버 로그에만 있었고, 입력한 간호사는 아무것도 보지 못했다.
 * (`vitals.service.ts` 의 종전 주석: "지금은 서버 로그에만 남는다")
 *
 * 재주입: `record()` 가 `outcome(...)` 대신 `result.stored` 를 돌려주게 되돌리면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { VitalsService } from '../../src/modules/vitals/vitals.service';
import { VitalsIngestService } from '../../src/modules/vitals/vitals-ingest.service';

const T0 = '2026-08-20T01:00:00.000Z';

function build() {
  const prisma: any = {
    preVisitVitals: {
      create: vi.fn().mockResolvedValue({ id: 'v1', measuredAt: new Date(T0) }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    nurseTask: { updateMany: vi.fn() },
    nursePatientAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    admission: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const emitter: any = { emit: vi.fn() };
  // 실제 포트를 끼운다 — 목으로 대체하면 포트가 통과 대상에서 빠진다
  const svc = new VitalsService(prisma, new VitalsIngestService(prisma, emitter));
  return { svc, prisma };
}

describe('record() — 저장되지 않은 것을 null 하나로 말하지 않는다', () => {
  it('🔴 중복 재수신: vitals=null 이지만 사유(DUPLICATE)와 기존 행 id 를 함께 돌려준다', async () => {
    const { svc, prisma } = build();
    prisma.preVisitVitals.findFirst.mockResolvedValue({ id: 'pv-old' });
    const r = await svc.record({ patientId: 'p1', spo2: 97, measuredAt: T0 } as never, 'n1');
    expect(r.vitals).toBeNull();
    expect(r.ingest.status).toBe('DUPLICATE');
    expect(r.ingest.duplicateOfId).toBe('pv-old');
    // 저장하지 않았으므로 부가 로직도 돌지 않는다(저장한 척하지 않는다)
    expect(prisma.nurseTask.updateMany).not.toHaveBeenCalled();
  });

  it('저장된 경우 행과 STORED 판정을 함께 돌려준다', async () => {
    const { svc } = build();
    const r = await svc.record({ patientId: 'p1', spo2: 97, measuredAt: T0 } as never, 'n1');
    expect(r.vitals).toMatchObject({ id: 'v1' });
    expect(r.ingest.status).toBe('STORED');
    expect(r.ingest.dedupeChecked).toBe(true);
  });

  it('🔴 측정 시각을 모르면 dedupeChecked=false — "중복 없음"이 아니라 판정 불가로 전달된다', async () => {
    const { svc } = build();
    const r = await svc.record({ patientId: 'p1', spo2: 97 } as never, 'n1');
    expect(r.ingest.status).toBe('STORED');
    expect(r.ingest.dedupeChecked).toBe(false);
    expect(r.ingest.timeFlags).toContain('MEASURED_AT_UNKNOWN');
    // 🔴 모르는 시각을 수신 시각으로 채워 돌려주지 않는다
    expect(r.ingest.measuredAt).toBeNull();
  });
});
