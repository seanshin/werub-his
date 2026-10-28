import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { TransferService } from '../../src/modules/transfer/transfer.service';
import { ConsultationService } from '../../src/modules/consultation/consultation.service';
import { HospiceService } from '../../src/modules/hospice/hospice.service';
import { ReferralLetterService } from '../../src/modules/referral-letter/referral-letter.service';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import { PathologyService } from '../../src/modules/pathology/pathology.service';
import { CssdPackageService } from '../../src/modules/cssd/cssd-package.service';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { AutoMapperService } from '../../src/modules/code-master/auto-mapper.service';

/**
 * 🔴 상태 전이 — **읽지 않고 쓴다**가 이 저장소에서 반복된 기전이다(2026-09-15 D1 전수).
 *
 * 실측으로 이미 드러난 같은 기전: 취소된 치료 오더가 COMPLETED 로 뒤집혀 취소한 치료가 청구됐고(P3),
 * 거절된 당직 교대가 다시 승인돼 두 사람 근무가 원복됐으며(N3), 확정된 코드 매핑이 REJECTED 로 뒤집혔다(B10).
 * 여기서 잠그는 것은 그 다음 묶음이다 — 각 항목에 **정상 전이가 통과하는 대조군**을 함께 둔다
 * (막는 가드만 만들면 "어디서도 되지 않는 상태"를 통과시킨다).
 */
describe('전원(Transfer) — 거절·완료된 전원을 되살리지 않는다', () => {
  let prisma: any;
  let service: TransferService;
  const record = (status: string) => ({ id: 't-1', status, fhirBundle: { resourceType: 'Bundle' }, toOrg: { name: '외부병원', fhirEndpoint: null }, fromOrg: {}, patient: {} });

  beforeEach(() => {
    prisma = {
      transferRecord: {
        findUnique: vi.fn().mockResolvedValue(record('REQUESTED')),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(record('IN_TRANSIT')),
      },
    };
    service = new TransferService(prisma as never);
  });

  it('대조군 — REQUESTED 전원은 수락된다(조건부 갱신으로 쓴다)', async () => {
    await service.accept('t-1', 'u-1');
    expect(prisma.transferRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't-1', status: 'REQUESTED' },
      data: expect.objectContaining({ status: 'ACCEPTED', acceptedBy: 'u-1' }),
    }));
  });

  it('🔴 거절된 전원을 다시 수락할 수 없다', async () => {
    prisma.transferRecord.findUnique.mockResolvedValue(record('REJECTED'));
    await expect(service.accept('t-1', 'u-1')).rejects.toThrow(BadRequestException);
    expect(prisma.transferRecord.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 완료된 전원을 거절로 뒤집을 수 없다', async () => {
    prisma.transferRecord.findUnique.mockResolvedValue(record('COMPLETED'));
    await expect(service.reject('t-1', '사유')).rejects.toThrow(BadRequestException);
    expect(prisma.transferRecord.updateMany).not.toHaveBeenCalled();
  });

  it('같은 상태로 다시 부르면 쓰지 않는다(수락 시각을 덮어쓰지 않는다)', async () => {
    prisma.transferRecord.findUnique.mockResolvedValue(record('ACCEPTED'));
    await service.accept('t-1', 'u-2');
    expect(prisma.transferRecord.updateMany).not.toHaveBeenCalled();
  });

  it('읽은 뒤 상태가 바뀌었으면(동시 처리) 409', async () => {
    prisma.transferRecord.findUnique.mockResolvedValue(record('ACCEPTED'));
    prisma.transferRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.complete('t-1')).rejects.toThrow(ConflictException);
  });

  it('🔴 거절된 전원의 임상 Bundle 은 다시 나가지 않는다(대외 발신은 되돌릴 수 없다)', async () => {
    prisma.transferRecord.findUnique.mockResolvedValue(record('REJECTED'));
    await expect(service.sendBundle('t-1')).rejects.toThrow(BadRequestException);
    expect(prisma.transferRecord.update).not.toHaveBeenCalled();
  });

  it('대조군 — 엔드포인트 없는 수락 전원은 IN_TRANSIT 으로 기록된다', async () => {
    prisma.transferRecord.findUnique.mockResolvedValue(record('ACCEPTED'));
    await service.sendBundle('t-1');
    expect(prisma.transferRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'IN_TRANSIT' }),
    }));
  });
});

describe('협진(Consultation) — 종결된 협진에 회신이 덮어쓰지 않는다', () => {
  let prisma: any;
  let service: ConsultationService;
  const consult = (status: string) => ({ id: 'c-1', status, toDoctorId: 'doc-2', toDepartment: '외과', requestingDoctorId: 'doc-1', encounter: { patient: { familyName: '홍', givenName: '길동' } } });

  beforeEach(() => {
    prisma = {
      consultation: { findUnique: vi.fn().mockResolvedValue(consult('ACCEPTED')), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      user: { findUnique: vi.fn().mockResolvedValue({ department: '외과' }) },
    };
    service = new ConsultationService(prisma as never, { create: vi.fn().mockResolvedValue({ id: 'n-1' }), pushNotification: vi.fn() } as never);
  });

  it('대조군 — 접수된 협진에는 회신할 수 있다', async () => {
    await service.reply('c-1', { replyDoctorId: 'doc-2', replyContent: '소견' });
    expect(prisma.consultation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c-1', status: 'ACCEPTED' },
      data: expect.objectContaining({ status: 'REPLIED' }),
    }));
  });

  it('🔴 종결(CLOSED)된 협진에는 회신할 수 없다', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consult('CLOSED'));
    await expect(service.reply('c-1', { replyDoctorId: 'doc-2', replyContent: '덮어쓰기' })).rejects.toThrow(BadRequestException);
    expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 이미 회신된 협진을 다시 회신해 앞선 회신을 지우지 않는다', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consult('REPLIED'));
    await expect(service.reply('c-1', { replyDoctorId: 'doc-2', replyContent: '재회신' })).rejects.toThrow(BadRequestException);
  });

  it('이미 종결된 협진을 다시 종결하지 않는다(멱등)', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consult('CLOSED'));
    await service.close('c-1');
    expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
  });

  it('대조군 — 회신 전 종결은 막지 않는다(막으면 방치된다)', async () => {
    prisma.consultation.findUnique.mockResolvedValue(consult('REQUESTED'));
    await service.close('c-1');
    expect(prisma.consultation.updateMany).toHaveBeenCalled();
  });
});

describe('호스피스 — 사망 등록은 되돌아가지 않는다', () => {
  let prisma: any;
  let service: HospiceService;

  beforeEach(() => {
    prisma = {
      hospiceRegistration: { findUnique: vi.fn().mockResolvedValue({ id: 'h-1', status: 'ACTIVE' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      advanceDirective: { findUnique: vi.fn().mockResolvedValue({ id: 'ad-1', status: 'ACTIVE' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new HospiceService(prisma as never);
  });

  // 🔴 (2026-10-10) 사망·퇴원 시각은 일어난 시각 — 호출자가 밝힌다(종전엔 누른 시각을 박았다)
  const AT = '2026-10-01T03:00:00Z';
  it('대조군 — ACTIVE 등록은 사망 처리된다(밝힌 사망 시각 그대로)', async () => {
    await service.updateStatus('h-1', 'DECEASED', AT);
    expect(prisma.hospiceRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DECEASED', deceasedAt: new Date(AT) }),
    }));
  });
  it('🔴 사망 시각을 밝히지 않으면 400 — 지금으로 채우지 않는다', async () => {
    await expect(service.updateStatus('h-1', 'DECEASED')).rejects.toMatchObject({ response: { code: 'HOSPICE_OCCURRED_AT_REQUIRED' } });
    expect(prisma.hospiceRegistration.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 사망(DECEASED) 등록을 ACTIVE 로 되돌릴 수 없다', async () => {
    prisma.hospiceRegistration.findUnique.mockResolvedValue({ id: 'h-1', status: 'DECEASED' });
    await expect(service.updateStatus('h-1', 'ACTIVE')).rejects.toThrow(BadRequestException);
    expect(prisma.hospiceRegistration.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 같은 상태를 다시 보내도 사망·퇴원 시각을 오늘로 덮어쓰지 않는다', async () => {
    prisma.hospiceRegistration.findUnique.mockResolvedValue({ id: 'h-1', status: 'DECEASED' });
    await service.updateStatus('h-1', 'DECEASED');
    expect(prisma.hospiceRegistration.updateMany).not.toHaveBeenCalled();
  });

  it('퇴원 후 사망은 기록할 수 있다(일어나는 일이다)', async () => {
    prisma.hospiceRegistration.findUnique.mockResolvedValue({ id: 'h-1', status: 'DISCHARGED' });
    await service.updateStatus('h-1', 'DECEASED', AT);
    expect(prisma.hospiceRegistration.updateMany).toHaveBeenCalled();
  });

  it('이미 철회된 사전의료의향서를 다시 철회하지 않는다(철회 시각 보존)', async () => {
    prisma.advanceDirective.findUnique.mockResolvedValue({ id: 'ad-1', status: 'REVOKED' });
    await service.revokeDirective('ad-1', '환자 본인 철회', 'u-1');
    expect(prisma.advanceDirective.updateMany).not.toHaveBeenCalled();
  });
});

describe('의뢰서 — 전송된 의뢰서를 발신자가 지우지 못한다', () => {
  let prisma: any;
  let service: ReferralLetterService;
  const letter = (status: string, fromDoctorId = 'doc-1') => ({ id: 'l-1', status, fromDoctorId, toDoctorId: 'doc-2', toDepartment: '외과', patientId: 'p-1', patient: { familyName: '홍', givenName: '길동' } });

  beforeEach(() => {
    prisma = {
      referralLetter: {
        findUnique: vi.fn().mockResolvedValue(letter('DRAFT')),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR' }) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      aiProposal: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    service = new ReferralLetterService(prisma as never, {} as never, {} as never, { decide: vi.fn() } as never);
  });

  it('대조군 — 작성자가 자기 초안을 폐기할 수 있다', async () => {
    await service.voidLetter('l-1', 'doc-1', '중복 작성');
    expect(prisma.referralLetter.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'l-1', status: 'DRAFT' },
      data: expect.objectContaining({ status: 'VOIDED' }),
    }));
  });

  it('🔴 이미 전송(SENT)된 의뢰서는 폐기할 수 없다(수신 과가 보고 있다)', async () => {
    prisma.referralLetter.findUnique.mockResolvedValue(letter('SENT'));
    await expect(service.voidLetter('l-1', 'doc-1', '')).rejects.toThrow(BadRequestException);
    expect(prisma.referralLetter.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 남의 의뢰서를 폐기할 수 없다(작성자 또는 관리자만)', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
    await expect(service.voidLetter('l-1', 'doc-9', '')).rejects.toMatchObject({ status: 403 });
    expect(prisma.referralLetter.updateMany).not.toHaveBeenCalled();
  });

  it('대조군 — 관리자는 폐기할 수 있다', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await service.voidLetter('l-1', 'admin-1', '');
    expect(prisma.referralLetter.updateMany).toHaveBeenCalled();
  });

  it('거절 알림 — 사유가 없으면 "undefined" 를 찍지 않는다', async () => {
    prisma.referralLetter.findUnique.mockResolvedValue(letter('SENT'));
    await service.reject('l-1', 'doc-2', '');
    const msg = prisma.notification.create.mock.calls[0][0].data.message as string;
    expect(msg).not.toContain('undefined');
    expect(msg.endsWith('거절했습니다')).toBe(true);
  });
});

describe('대체조제 — 의사 판정은 뒤집히지 않는다', () => {
  let prisma: any;
  let service: PharmacyService;

  beforeEach(() => {
    prisma = {
      genericSubstitution: { findUnique: vi.fn().mockResolvedValue({ id: 'g-1', status: 'REQUESTED' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new PharmacyService(prisma as never, {} as never, {} as never);
  });

  it('대조군 — 요청된 대체조제는 승인된다', async () => {
    await service.approveSubstitution('g-1', 'doc-1');
    expect(prisma.genericSubstitution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'g-1', status: 'REQUESTED' },
      data: expect.objectContaining({ status: 'APPROVED', doctorApproved: true }),
    }));
  });

  it('🔴 이미 승인된 대체조제를 거부로 뒤집을 수 없다(약사는 승인만 보고 조제한다)', async () => {
    prisma.genericSubstitution.findUnique.mockResolvedValue({ id: 'g-1', status: 'APPROVED' });
    // 사유를 준다 — 사유 누락 400(2026-09-30)이 전이 400 을 대신해 통과하지 않게(다른 이유로 통과 금지)
    await expect(service.rejectSubstitution('g-1', 'doc-1', '재고 있음')).rejects.toThrow('이미 판정된 대체조제입니다');
    expect(prisma.genericSubstitution.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 거부된 대체조제를 승인으로 뒤집을 수 없다', async () => {
    prisma.genericSubstitution.findUnique.mockResolvedValue({ id: 'g-1', status: 'REJECTED' });
    await expect(service.approveSubstitution('g-1', 'doc-1')).rejects.toThrow(BadRequestException);
  });
});

describe('병리 — 서명·검체 상태를 되돌려 쓰지 않는다', () => {
  let prisma: any;
  let service: PathologyService;

  beforeEach(() => {
    prisma = {
      pathologyReport: { findUnique: vi.fn().mockResolvedValue({ id: 'r-1', signedAt: null, specimenId: 's-1', specimen: { patientId: 'p-1' }, diagnosisCode: '' }), update: vi.fn().mockResolvedValue({ id: 'r-1' }) },
      pathologySpecimen: { findUnique: vi.fn().mockResolvedValue({ id: 's-1', status: 'RECEIVED' }), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    service = new PathologyService(prisma as never);
  });

  it('🔴 이미 서명된 병리 보고서를 다시 서명해 서명자·시각을 덮어쓰지 않는다', async () => {
    prisma.pathologyReport.findUnique.mockResolvedValue({ id: 'r-1', signedAt: new Date('2026-09-01'), signedBy: 'doc-1', specimenId: 's-1', specimen: { patientId: 'p-1' } });
    await expect(service.signReport('r-1', 'doc-2')).rejects.toMatchObject({ response: { code: 'PATHOLOGY_REPORT_ALREADY_SIGNED' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('대조군 — 미서명 보고서는 서명된다', async () => {
    await service.signReport('r-1', 'doc-2');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('🔴 서명된 검체를 PROCESSING 으로 되돌리지 않는다(접수 시각도 덮어쓰지 않는다)', async () => {
    prisma.pathologySpecimen.findUnique.mockResolvedValue({ id: 's-1', status: 'SIGNED' });
    await expect(service.receiveSpecimen('s-1')).rejects.toThrow(BadRequestException);
    expect(prisma.pathologySpecimen.updateMany).not.toHaveBeenCalled();
  });
});

describe('멸균 패키지 — 리콜은 반납으로 지워지지 않는다', () => {
  let prisma: any;
  let service: CssdPackageService;

  beforeEach(() => {
    prisma = {
      sterilePackage: { findUnique: vi.fn().mockResolvedValue({ id: 'pk-1', status: 'IN_USE' }), update: vi.fn().mockResolvedValue({ id: 'pk-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cssdEvent: { create: vi.fn().mockResolvedValue({}) },
      packageEvent: { create: vi.fn().mockResolvedValue({}) },
      // 🔴 (I2) 정본이 상태와 원장(packageEvent)을 한 트랜잭션에서 쓴다 — 목도 같은 호출 모양을 준다
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    service = new CssdPackageService(prisma as never, {} as never, {} as never, {} as never);
  });

  it('대조군 — 사용한 패키지는 반납된다', async () => {
    await service.returnPackage('pk-1', 'u-1');
    expect(prisma.sterilePackage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pk-1', status: 'IN_USE' }, data: { status: 'RETURNED' },
    }));
  });

  it('🔴 리콜(RECALLED)된 패키지를 반납으로 바꿔 리콜 목록에서 지우지 않는다', async () => {
    prisma.sterilePackage.findUnique.mockResolvedValue({ id: 'pk-1', status: 'RECALLED' });
    await expect(service.returnPackage('pk-1', 'u-1')).rejects.toThrow(BadRequestException);
    expect(prisma.sterilePackage.updateMany).not.toHaveBeenCalled();
  });

  it('리콜은 어느 상태에서나 할 수 있다(안전측으로 접는 방향은 막지 않는다)', async () => {
    prisma.sterilePackage.findUnique.mockResolvedValue({ id: 'pk-1', status: 'EXPIRED' });
    await service.recallPackage('pk-1', 'u-1');
    expect(prisma.sterilePackage.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'RECALLED' } }));
  });
});

describe('재고 부서청구 — 불출된 청구를 다시 승인하지 않는다', () => {
  let prisma: any;
  let service: InventoryService;

  beforeEach(() => {
    prisma = {
      inventoryRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'ir-1', status: 'REQUESTED' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inventoryRequestItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    service = new InventoryService(prisma as never, {} as never);
  });

  it('대조군 — 요청 상태 청구는 승인된다', async () => {
    await service.approveRequest('ir-1', 'u-1');
    expect(prisma.inventoryRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ir-1', status: 'REQUESTED' },
    }));
  });

  it('🔴 이미 불출(ISSUED)된 청구를 다시 승인할 수 없다(재고가 두 번 빠진다)', async () => {
    prisma.inventoryRequest.findUnique.mockResolvedValue({ id: 'ir-1', status: 'ISSUED' });
    await expect(service.approveRequest('ir-1', 'u-1')).rejects.toMatchObject({ response: { code: 'INVENTORY_REQUEST_NOT_REQUESTED' } });
    expect(prisma.inventoryRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe('코드 매핑 임상 검토 — 조용한 무동작(200+null)을 남기지 않는다', () => {
  let prisma: any;
  let service: AutoMapperService;

  beforeEach(() => {
    prisma = {
      pendingMapping: {
        findUnique: vi.fn().mockResolvedValue({ id: 'pm-1', clinicalStatus: 'AWAITING' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new AutoMapperService(prisma as never, { reference: vi.fn() } as never);
  });

  it('대조군 — 대기 중인 항목은 승인된다', async () => {
    await service.clinicalApprove('pm-1', 'u-1', 'DOCTOR', '확인');
    expect(prisma.pendingMapping.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pm-1', clinicalStatus: 'AWAITING' },
      data: expect.objectContaining({ clinicalStatus: 'APPROVED' }),
    }));
  });

  it('🔴 이미 검토된 항목은 409 — null 을 돌려 화면이 "승인됨"으로 그리게 두지 않는다', async () => {
    prisma.pendingMapping.findUnique.mockResolvedValue({ id: 'pm-1', clinicalStatus: 'APPROVED' });
    await expect(service.clinicalReject('pm-1', 'u-2', 'DOCTOR')).rejects.toMatchObject({
      response: { code: 'CLINICAL_REVIEW_NOT_AWAITING' },
    });
    expect(prisma.pendingMapping.updateMany).not.toHaveBeenCalled();
  });

  it('없는 항목은 404 (없는 것과 이미 처리된 것은 다른 사실)', async () => {
    prisma.pendingMapping.findUnique.mockResolvedValue(null);
    await expect(service.clinicalApprove('pm-1', 'u-1', 'DOCTOR')).rejects.toMatchObject({
      response: { code: 'PENDING_MAPPING_NOT_FOUND' },
    });
  });
});
