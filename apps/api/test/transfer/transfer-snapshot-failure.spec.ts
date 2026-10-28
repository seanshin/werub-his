import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransferService } from '../../src/modules/transfer/transfer.service';

/**
 * 🔴 전원 스냅샷 조회 실패가 "없음"으로 전송되던 것에 대한 가드(2026-08-21).
 *
 * 종전 `Promise.all([...].catch(() => []))` 은 진단·투약·**알레르기** 조회 실패를 `[]` 로 만들어
 * `transfer_records` 에 저장하고 FHIR Bundle 로 수신 기관에 보냈다. 받는 쪽에서 빈 알레르기 목록은
 * "알레르기 없음"으로 읽힌다 — 실패했다는 사실은 어디에도 없었다.
 *
 * 재주입 역검증: `.catch(() => [])` 로 되돌리면 아래 두 it 이 실패한다(값이 `[]`·meta 표시 없음).
 */
describe('전원 스냅샷 — 조회 실패를 빈 목록으로 접지 않는다', () => {
  let service: TransferService;
  let mockPrisma: any;
  let created: any;

  const selfOrg = { id: 'self-org', name: '우리병원', code: 'WERUBYHOSP', isSelf: true };
  const patient = {
    id: 'p-1', mrn: 'MRN-1', familyName: '김', givenName: '환자', fhirId: null,
    gender: 'MALE', dateOfBirth: new Date('1990-01-01'), phone: null, nameEn: null,
  };

  beforeEach(() => {
    created = null;
    mockPrisma = {
      organization: { findFirst: vi.fn().mockResolvedValue(selfOrg) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      // 🔴 알레르기 조회만 죽는다(부분 실패)
      allergy: { findMany: vi.fn().mockRejectedValue(new Error('DB timeout')) },
      transferRecord: {
        create: vi.fn().mockImplementation((args: any) => {
          created = args.data;
          return Promise.resolve({
            id: 't-1', ...args.data, patient, fromOrg: selfOrg, toOrg: { id: 'o-2', name: '가상대병원', code: '11100001' },
          });
        }),
        findUnique: vi.fn().mockResolvedValue(null), // generateBundle 은 여기서 조기 반환
        update: vi.fn().mockResolvedValue({}),
      },
    };
    service = new TransferService(mockPrisma);
  });

  it('실패한 섹션은 `[]`(없음)이 아니라 `null`(미상) 로 저장된다', async () => {
    await service.create(
      { patientId: 'p-1', toOrgId: 'o-2', urgency: 'URGENT', reason: '전원', transferType: 'OUTGOING_REFERRAL' },
      'u-1',
    );
    expect(created.allergies).toBeNull();
    // 성공한 섹션은 그대로 살린다(부분 성공을 버리지 않는다)
    expect(created.diagnoses).toEqual([]);
    expect(created.medications).toEqual([]);
  });

  it('무엇이 실패했는지 metadata.snapshotFailed 로 남긴다', async () => {
    await service.create(
      { patientId: 'p-1', toOrgId: 'o-2', urgency: 'URGENT', reason: '전원', transferType: 'OUTGOING_REFERRAL' },
      'u-1',
    );
    expect(created.metadata?.snapshotFailed).toEqual(['allergies']);
  });

  it('전부 성공하면 실패 표시를 붙이지 않는다(거짓 경보 금지)', async () => {
    mockPrisma.allergy.findMany.mockResolvedValue([]);
    await service.create(
      { patientId: 'p-1', toOrgId: 'o-2', urgency: 'URGENT', reason: '전원', transferType: 'OUTGOING_REFERRAL' },
      'u-1',
    );
    expect(created.allergies).toEqual([]);
    expect(created.metadata).toBeUndefined();
  });
});

describe('전원 FHIR Bundle — 빈 알레르기 섹션이 왜 비었는지 밝힌다', () => {
  let service: TransferService;
  let mockPrisma: any;
  let saved: any;

  const record = {
    id: 't-1', patientId: 'p-1', reason: '전원 사유', clinicalSummary: null,
    urgency: 'URGENT', transferType: 'OUTGOING_REFERRAL',
    diagnoses: [], medications: [],
    patient: {
      id: 'p-1', mrn: 'MRN-1', familyName: '김', givenName: '환자', fhirId: null,
      gender: 'MALE', dateOfBirth: new Date('1990-01-01'), phone: null, nameEn: null,
    },
    fromOrg: { id: 'o-1', name: '우리병원', code: 'WERUBYHOSP' },
    toOrg: { id: 'o-2', name: '가상대병원', code: '11100001' },
  };

  beforeEach(() => {
    saved = null;
    mockPrisma = {
      transferRecord: {
        findUnique: vi.fn().mockResolvedValue(record),
        update: vi.fn().mockImplementation((args: any) => { saved = args.data.fhirBundle; return Promise.resolve({}); }),
      },
      allergy: { findMany: vi.fn().mockRejectedValue(new Error('DB timeout')) },
    };
    service = new TransferService(mockPrisma);
  });

  it('조회 실패 시 meta.unavailableSections 에 allergies 가 들어간다', async () => {
    const bundle: any = await service.generateBundle('t-1');
    expect(bundle.meta.unavailableSections).toContain('allergies');
    expect(saved.meta.unavailableSections).toContain('allergies');
  });

  it('사람이 읽는 Composition 에도 "없음으로 읽지 마십시오"가 적힌다', async () => {
    const bundle: any = await service.generateBundle('t-1');
    const comp = bundle.entry.find((e: any) => e.resource.resourceType === 'Composition');
    const text = comp.resource.section.map((s: any) => `${s.title} ${s.text.div}`).join('\n');
    expect(text).toContain('알레르기');
    expect(text).toContain('없음으로 읽지 마십시오');
  });

  it('조회에 성공하면 그 표시는 붙지 않는다', async () => {
    mockPrisma.allergy.findMany.mockResolvedValue([]);
    const bundle: any = await service.generateBundle('t-1');
    expect(bundle.meta.unavailableSections).toEqual([]);
    const comp = bundle.entry.find((e: any) => e.resource.resourceType === 'Composition');
    expect(comp.resource.section.map((s: any) => s.title)).not.toContain('조회 실패 섹션(미상)');
  });
});
