import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HiraEdiService } from '../../src/modules/hira-edi/hira-edi.service';

/** 입원 EDI 청구 P2 — 명세서 생성 정합 재작성(codeType 분리·재원기간·실 진단·Billing 정본 금액·기관 config) */
describe('HiraEdiService.generateDocument(P2)', () => {
  let svc: HiraEdiService;
  let prisma: any;

  const item = (over: Record<string, unknown> = {}) => ({
    codeType: 'PROCEDURE', codeId: 'proc-1', codeName: '입원료 (5일)', quantity: 5, unitPrice: 60000, amount: 300000,
    insuranceCategory: 'COVERED', ...over,
  });

  const baseClaim = (over: Record<string, unknown> = {}) => ({
    id: 'clm-1',
    patient: { id: 'p-1', mrn: 'HR-1', familyName: '홍', givenName: '길동', insuranceType: 'NHI', insuranceNumber: 'INS-1' },
    billing: {
      id: 'bill-1', totalAmount: 300000, insuranceCovered: 240000, patientCopay: 60000,
      items: [item()],
      encounter: {
        id: 'enc-1', visitType: 'INPATIENT', admissionId: 'adm-1', createdAt: new Date('2026-07-20'),
        doctor: { id: 'doc-1', familyName: '김', givenName: '내과', department: '내과' },
      },
    },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      claim: { findUnique: vi.fn().mockResolvedValue(baseClaim()) },
      admission: { findUnique: vi.fn().mockResolvedValue({ admitDate: new Date('2026-07-18'), dischargeDate: new Date('2026-07-23') }) },
      encounter: { findMany: vi.fn().mockResolvedValue([{ id: 'enc-1' }, { id: 'enc-0' }]) },
      billing: {
        findMany: vi.fn().mockResolvedValue([
          { totalAmount: 300000, insuranceCovered: 240000, patientCopay: 60000, items: [item()] },
          { totalAmount: 50000, insuranceCovered: 35000, patientCopay: 15000, items: [item({ codeId: 'med-1', codeType: 'MEDICATION', codeName: '항생제', quantity: 3, unitPrice: 10000, amount: 30000 }), item({ codeId: 'proc-2', codeName: 'CRP', quantity: 1, amount: 20000, insuranceCategory: 'NON_COVERED' })] },
        ]),
      },
      procedureCode: { findMany: vi.fn().mockResolvedValue([{ id: 'proc-1', code: 'AB1A0100' }, { id: 'proc-2', code: 'E6502' }]) },
      medicationCode: { findMany: vi.fn().mockResolvedValue([{ id: 'med-1', code: 'MED01', insuranceCode: 'EDI-MED-01' }]) },
      encounterDiagnosis: {
        findMany: vi.fn().mockResolvedValue([
          { type: 'SECONDARY', rank: 1, diagnosisCode: { code: 'E11', nameKo: '2형 당뇨' } },
          { type: 'PRIMARY', rank: 1, diagnosisCode: { code: 'J18.9', nameKo: '폐렴' } },
          { type: 'PRIMARY', rank: 1, diagnosisCode: { code: 'J18.9', nameKo: '폐렴' } }, // 중복 — 제거돼야
        ]),
      },
      staff: { findUnique: vi.fn().mockResolvedValue({ licenseNumber: 'MD-12345' }) },
      // P2-6: 같은 입원의 기존 명세서 확인 — 기본은 없음
      hiraClaimDocument: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'doc-1', ...data })) },
      // 🔴 기관 식별은 정본 `system_configs hospital.*` **DB 행**만 읽는다(ConfigRuntimeService.get() 은
      //    행이 없으면 DEFAULTS 플레이스홀더 '12345678'·'Hospital RUN 병원' 으로 떨어진다 — 대외 제출물에 쓸 수 없다).
      //    목은 정본의 실제 반환 모양: findMany({where:{key:{in}},select:{key,value}}) → [{key, value}]
      systemConfig: {
        findMany: vi.fn(async ({ where }: any) =>
          [{ key: 'hospital.code', value: '99887766' }, { key: 'hospital.name', value: '위루비병원' }]
            .filter((r) => (where?.key?.in as string[] | undefined)?.includes(r.key)),
        ),
      },
    };
    svc = new HiraEdiService(prisma);
  });

  it('입원 — Admission 단위 합산: 재원기간·전 Billing 항목·금액=Billing 정본 합(하드코딩 0.7 제거)', async () => {
    const r: any = await svc.generateDocument('clm-1', 'u-1');
    expect(r.documentType).toBe('INPATIENT');
    expect(r.treatmentFrom).toEqual(new Date('2026-07-18')); // 재원기간
    expect(r.totalAmount).toBe(350000);       // 300k + 50k (Billing 합)
    expect(r.insuranceAmount).toBe(275000);   // eligibility 반영분 합(0.7 하드코딩 아님)
    expect(r.patientAmount).toBe(75000);
    const edi = r.ediData;
    expect(edi.treatment.stayDays).toBe(5);
    expect(edi.totals.nonCovered).toBe(20000); // NON_COVERED 라인 합
  });

  it('항목 분리 — codeType 기반(구버전 category 공집합 결함 해소)·EDI 코드 마스터 해석', async () => {
    const r: any = await svc.generateDocument('clm-1', 'u-1');
    const edi = r.ediData;
    expect(edi.procedures).toHaveLength(2); // 입원료 + CRP
    expect(edi.medications).toHaveLength(1);
    expect(edi.medications[0].ediCode).toBe('EDI-MED-01'); // 약가 insuranceCode 우선
    expect(edi.procedures[0].ediCode).toBe('AB1A0100');
  });

  it('진단 — EncounterDiagnosis 소스·PRIMARY 우선·중복 제거·KCD 코드', async () => {
    const r: any = await svc.generateDocument('clm-1', 'u-1');
    const dx = r.ediData.diagnoses;
    expect(dx).toHaveLength(2);
    expect(dx[0]).toEqual({ code: 'J18.9', name: '폐렴', type: 'PRIMARY' }); // 주상병 선두
  });

  it('기관정보 config·의사 면허(Staff 소관) 실값', async () => {
    const r: any = await svc.generateDocument('clm-1', 'u-1');
    expect(r.ediData.header).toEqual({ facilityCode: '99887766', facilityName: '위루비병원', claimType: 'INPATIENT' });
    expect(r.ediData.treatment.doctorLicense).toBe('MD-12345');
    expect(r.ediData.treatment.department).toBe('내과');
  });

  /**
   * 🔴 종전: `config.get(...).catch(() => null) ?? 'Hospital RUN'/'12345678'` — 조회 실패도 미설정도
   *    날조값으로 메워 **심평원에 나가는 명세서**에 존재하지 않는 요양기관을 실었다.
   */
  it('🔴 기관 식별이 미설정이면 명세서를 만들지 않는다(422) — 지어낸 요양기관기호·기관명을 싣지 않는다', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([]);
    const e: any = await svc.generateDocument('clm-1', 'u-1').catch((x) => x);
    expect(e?.status, `날조 폴백이 살아 있으면 문서가 만들어진다: ${JSON.stringify(e)}`).toBe(422);
    expect(e.getResponse()).toMatchObject({ code: 'HOSPITAL_IDENTITY_UNSET', missing: ['hospital.code', 'hospital.name'] });
    expect(prisma.hiraClaimDocument.create).not.toHaveBeenCalled();
  });

  it('🔴 설정 조회 실패는 "미설정"으로 번역하지 않는다 — 전파한다', async () => {
    prisma.systemConfig.findMany.mockRejectedValue(new Error('DB down'));
    await expect(svc.generateDocument('clm-1', 'u-1')).rejects.toThrow('DB down');
  });

  it('외래 — 해당 Billing 단독·당일 기간·admission 조회 없음', async () => {
    prisma.claim.findUnique.mockResolvedValue(baseClaim({
      billing: { ...baseClaim().billing, encounter: { ...baseClaim().billing.encounter, visitType: 'OUTPATIENT', admissionId: null } },
    }));
    const r: any = await svc.generateDocument('clm-1', 'u-1');
    expect(r.documentType).toBe('OUTPATIENT');
    expect(r.totalAmount).toBe(300000); // 단독 Billing
    expect(prisma.admission.findUnique).not.toHaveBeenCalled();
    expect(r.ediData.treatment.stayDays).toBeUndefined();
  });
});
