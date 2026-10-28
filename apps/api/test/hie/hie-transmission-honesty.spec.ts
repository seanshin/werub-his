import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HieService } from '../../src/modules/hie/hie.service';
import { HIE_STATUS } from '../../src/modules/hie/hie-transmission';

/**
 * H1 (화면 실사용 점검 W8 잔여배치) — 진료정보교류가 **한 번도 전송하지 않는데** 전건
 * '전송 완료'로 원장에 남던 것.
 *
 * 🔴 종전: `transmitToHie()` 가 `Would transmit CDA …` 로그만 찍고
 *    `status:'SENT'` · `sentAt:new Date()` 를 적은 뒤
 *    `{ success:true, message:'교류 문서 전송 완료 (게이트웨이 연동 대기)' }` 를 반환.
 *    CDA 는 법정 진료기록 반출이라(의료법 §21조의2) 반출 대장 전체가 거짓이었다.
 */
describe('HIE 전송 정직화 — 나가지 않았으면 나가지 않았다고 적는다', () => {
  let service: HieService;
  let prisma: any;
  let cda: any;

  const patient = () => ({
    id: 'p-1', mrn: '12345', fhirId: 'fhir-p-1', familyName: '김', givenName: '철수',
    gender: 'MALE', dateOfBirth: new Date('1990-01-01'), encounters: [], allergiesRel: [],
  });

  beforeEach(() => {
    prisma = {
      patient: { findUnique: vi.fn().mockResolvedValue(patient()), findFirst: vi.fn() },
      organization: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn() },
      hieExchange: {
        create: vi.fn().mockResolvedValue({ id: 'ex-1' }),
        update: vi.fn().mockResolvedValue({ id: 'ex-1' }),
        findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn(),
      },
    };
    cda = { fhirToCda: vi.fn().mockReturnValue('<ClinicalDocument/>'), cdaToFhir: vi.fn(), parseCdaHeader: vi.fn() };
    service = new HieService(prisma, cda);
  });

  it('🔴 전송 코드가 없으므로 상태는 LOCAL_RECORDED — SENT 가 아니다', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '협력병원' });

    const r = await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-1' });

    expect(r.status).toBe(HIE_STATUS.LOCAL_RECORDED);
    expect(r.transmitted).toBe(false);
    expect(r.transmissionState).toBe('LOCAL_ONLY');
    expect(r.sendResult.outcome).toBe('NOT_TRANSMITTED');
  });

  it('🔴 sentAt 에 모르는 시각을 박지 않는다 — DB 쓰기에도 sentAt 이 없다', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '협력병원', fhirEndpoint: 'https://x' });

    const r = await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-1' });

    expect(r.sentAt).toBeNull();
    const update = prisma.hieExchange.update.mock.calls.at(-1)![0];
    expect(update.data.status).toBe(HIE_STATUS.LOCAL_RECORDED);
    expect(update.data).not.toHaveProperty('sentAt');
  });

  it('미전송 사유와 사람이 할 조치를 기록에 남긴다', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '협력병원' });

    await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-1' });

    const note = prisma.hieExchange.update.mock.calls.at(-1)![0].data.errorMessage as string;
    expect(note).toMatch(/^\[미전송\]/);
    expect(note).toMatch(/연동 미구축/);
    expect(note).toMatch(/조치:/);
  });

  it('endpoint 가 등록돼 있어도 전송 코드가 없으면 미전송이다', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '협력병원', fhirEndpoint: 'https://gw.example/hie' });

    const r = await service.sendPatientSummary('p-1', { documentType: 'DSCH', targetOrgId: 'org-1' });

    expect(r.transmitted).toBe(false);
    expect(r.sendResult.reason).toMatch(/전송 코드가 없음/);
  });

  it('🔴 미전송 건은 다시 보낼 수 있다고 응답이 말한다', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '협력병원' });

    const r = await service.sendPatientSummary('p-1', { documentType: 'TRSF', targetOrgId: 'org-1' });

    expect(r.retransmittable).toBe(true);
    expect(r.transmissionNote).toMatch(/전송되지 않았습니다/);
  });

  it('교류 이력 목록은 저장값을 바꾸지 않고 전송 판정을 덧붙인다', async () => {
    prisma.hieExchange.findMany.mockResolvedValue([
      { id: 'ex-old', direction: 'SEND', status: 'SENT', sentAt: new Date('2026-01-01') },
      { id: 'ex-new', direction: 'SEND', status: HIE_STATUS.LOCAL_RECORDED, sentAt: null },
      { id: 'ex-rx', direction: 'RECEIVE', status: HIE_STATUS.RECEIVED, sentAt: null },
    ]);
    prisma.hieExchange.count.mockResolvedValue(3);

    const { logs } = await service.getExchangeLog();

    // 저장값 그대로
    expect(logs[0].status).toBe('SENT');
    // 🔴 읽는 쪽 판정: 게이트웨이가 존재한 적이 없으므로 근거 없음
    expect(logs[0].transmission.state).toBe('UNVERIFIED');
    expect(logs[0].transmission.transmitted).toBe(false);
    expect(logs[1].transmission.state).toBe('LOCAL_ONLY');
    expect(logs[2].transmission.state).toBe('RECEIVED');
  });

  it('통계는 실제 전송 근거로 센다 — 게이트웨이 미가동을 함께 알린다', async () => {
    prisma.hieExchange.count.mockResolvedValue(0);
    prisma.hieExchange.groupBy
      .mockResolvedValueOnce([{ direction: 'SEND', _count: 4 }])
      .mockResolvedValueOnce([{ documentType: 'TRSF', _count: 4 }])
      .mockResolvedValueOnce([
        { status: 'SENT', _count: 3 },
        { status: HIE_STATUS.LOCAL_RECORDED, _count: 1 },
      ]);

    const stats = await service.getStats();

    expect(stats.byStatus).toEqual({ SENT: 3, LOCAL_RECORDED: 1 });
    expect(stats.byTransmissionState).toEqual({ UNVERIFIED: 3, LOCAL_ONLY: 1 });
    expect(stats.byTransmissionState.SENT).toBeUndefined(); // 실제 전송 0건
    expect(stats.gatewayImplemented).toBe(false);
  });
});
