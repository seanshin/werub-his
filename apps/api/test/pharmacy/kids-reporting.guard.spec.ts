import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import {
  ADR_STATUS, KIDS_CHANNEL, classifyKidsTransmission, localKidsRef,
} from '../../src/modules/pharmacy/kids-reporting';

/**
 * 🔴 가드 — **전송하지 않은 건에 보고완료 마킹을 찍지 않는다**(W8, 2026-08-14).
 *
 * 종전: KIDS 전송 코드가 없는데도 `kidsReported:true`·`status:'SUBMITTED'`·`KIDS-STUB-…` 를 적고,
 *       함수 첫 줄 `if (r.kidsReported) return r;` 가 그 마킹을 멱등 가드로 삼았다
 *       → 실제 연동이 붙어도 그 건은 **영구히 다시 보고되지 않는다**(법정보고 영구 미이행).
 * 운영 ADR 0건인 지금 고쳐야 무손실이다.
 */
describe('KIDS 법정보고 — 전송하지 않은 건에 보고완료 마킹 금지', () => {
  let service: PharmacyService;
  let prisma: any;

  const adr = (over: Record<string, unknown> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    patientId: 'p1', reportType: 'INITIAL', reactionDescription: '발진', onsetDate: new Date('2026-08-01'),
    outcome: 'RECOVERED', suspectedDrugName: 'amoxicillin', suspectedDrugCode: 'A1', actionTaken: 'WITHDRAWN',
    isSerious: false, seriousDeath: false, seriousLifeThreat: false, seriousHospital: false,
    seriousDisability: false, seriousCongenital: false, causalityAssessment: 'PROBABLE', naranjoScore: 6,
    status: 'REPORTED', kidsReported: false, kidsReportDate: null, kidsReportNumber: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      adverseReactionReport: {
        findUnique: vi.fn().mockResolvedValue(adr()),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ ...adr(), id: where.id, ...data })),
      },
    };
    service = new PharmacyService(prisma, { emit: vi.fn() } as any, { enqueue: vi.fn() } as any, { get: vi.fn() } as any);
  });

  it('채널 미구현이면 kidsReported 를 세우지 않고 SUBMITTED 로도 닫지 않는다', async () => {
    // 이 가드는 연동 미구축 전제 — 붙는 날 implemented=true 로 바뀌면 이 단언부터 갱신한다
    expect(KIDS_CHANNEL.implemented).toBe(false);

    await service.submitAdrToKids(adr().id);

    const data = prisma.adverseReactionReport.update.mock.calls[0][0].data;
    expect(data.kidsReported).toBe(false);
    expect(data.kidsReportDate).toBeNull();               // 모르는 시각을 원장에 박지 않는다
    expect(data.status).toBe(ADR_STATUS.LOCAL_RECORDED);
    expect(data.kidsPayload).toBeTruthy();                // E2B 페이로드는 남긴다(수기 보고 재료)
  });

  it('기관 접수번호를 위조하지 않는다 — KIDS-STUB- 금지 · LOCAL- 접두어만', async () => {
    await service.submitAdrToKids(adr().id);
    const ref: string = prisma.adverseReactionReport.update.mock.calls[0][0].data.kidsReportNumber;
    expect(ref.startsWith('LOCAL-')).toBe(true);
    expect(ref).not.toMatch(/^KIDS-STUB-/);
  });

  it('🔴 미전송 건은 **다시 보고할 수 있다** — 멱등 마킹이 재보고를 영구 차단하지 않는다', async () => {
    // 1차 시도 후의 저장 상태를 그대로 되읽힌다
    const first = await service.submitAdrToKids(adr().id);
    prisma.adverseReactionReport.findUnique.mockResolvedValue(first);
    prisma.adverseReactionReport.update.mockClear();

    await service.submitAdrToKids(adr().id);
    expect(prisma.adverseReactionReport.update).toHaveBeenCalledTimes(1); // 재시도가 실제로 일어났다
  });

  it('🔴 과거 스텁이 찍어 둔 kidsReported=true 행도 재보고를 막지 않는다(저장값은 변조하지 않고 읽는 쪽에서 판정)', async () => {
    const legacy = adr({ kidsReported: true, status: 'SUBMITTED', kidsReportNumber: 'KIDS-STUB-11111111' });
    prisma.adverseReactionReport.findUnique.mockResolvedValue(legacy);

    const info = classifyKidsTransmission(legacy);
    expect(info.transmitted).toBe(false);
    expect(info.state).toBe('UNVERIFIED');   // '보고완료'가 아니다

    await service.submitAdrToKids(legacy.id);
    expect(prisma.adverseReactionReport.update).toHaveBeenCalled(); // 재시도 허용
  });

  it('목록은 저장 플래그가 아니라 전송 근거로 판정한 kidsTransmission 을 함께 낸다', async () => {
    prisma.adverseReactionReport.findMany.mockResolvedValue([
      adr({ kidsReported: true, status: 'SUBMITTED', kidsReportNumber: 'KIDS-STUB-1' }),
      adr({ id: 'x2', status: ADR_STATUS.LOCAL_RECORDED, kidsReportNumber: localKidsRef() }),
      adr({ id: 'x3' }),
    ]);
    const rows: any[] = await service.getAdrReports();
    expect(rows.map((r) => r.kidsTransmission.state)).toEqual(['UNVERIFIED', 'LOCAL_ONLY', 'NOT_SUBMITTED']);
    expect(rows.every((r) => r.kidsTransmission.transmitted === false)).toBe(true);
  });

  it('classify — 실제 전송 근거가 있을 때만 transmitted=true 로 올라간다', () => {
    // 채널 미구현인 동안에는 어떤 저장값 조합도 SENT 로 읽히지 않는다
    expect(classifyKidsTransmission({ kidsReported: true, kidsReportNumber: 'KD-2026-0001', status: 'SUBMITTED' }).transmitted)
      .toBe(KIDS_CHANNEL.implemented);
    expect(classifyKidsTransmission({ status: ADR_STATUS.SEND_FAILED }).state).toBe('SEND_FAILED');
  });
});
