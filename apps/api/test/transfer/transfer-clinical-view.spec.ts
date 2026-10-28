import { describe, it, expect, vi } from 'vitest';
import { TransferService } from '../../src/modules/transfer/transfer.service';
import { toTransferClinicalView } from '../../src/modules/transfer/transfer-clinical-view';

/**
 * 🔴 전원 임상 섹션 계약(P11) — 2026-09-15.
 *
 * 쓰는 곳(송신 스냅샷 = Prisma 행 · 수신 FHIR = `{code,system,text}`/`{text,dosage,status}`/`{name,severity}`)과
 * 읽는 곳(전원 상세·FHIR 번들 = `{code, name}` 가정)이 어긋나 송신 건 진단 이름·약 이름이 화면·번들 어디에도 없었다.
 *
 * 🔴 목은 **실제 저장 모양**을 쓴다 — Prisma 행을 JSONB 로 한 번 왕복시킨 값(Date → ISO 문자열)이다.
 *    `{code, name}` 같은 가정 모양으로 테스트하면 결함이 있던 코드도 통과한다(그렇게 해서 이 결함이 살아 있었다).
 */
const jsonb = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** create() 가 저장하는 송신 스냅샷 행 — EncounterDiagnosis + include diagnosisCode */
const outboundDiagnosisRow = {
  id: 'ed-1', encounterId: 'enc-1', diagnosisCodeId: 'dc-1', type: 'PRIMARY', rank: 1, certainty: 'CONFIRMED',
  onsetDate: new Date('2026-09-01'), notes: null,
  diagnosisCode: {
    id: 'dc-1', codeSystem: 'KCD-8', code: 'I21.9', nameKo: '급성 심근경색증', nameEn: 'Acute myocardial infarction',
    category: null, notPrimary: false, sexRestriction: null, ageMin: null, ageMax: null, chapter: 'IX', parentCode: 'I21',
  },
};
/** create() 가 저장하는 송신 스냅샷 행 — Prescription + include medicationCode */
const outboundMedicationRow = {
  id: 'rx-1', encounterId: 'enc-1', type: 'MEDICATION', medicationCodeId: 'mc-1', procedureCodeId: null,
  dosage: '100mg', frequency: 'QD', duration: 7, quantity: 7, route: 'PO', status: 'ACTIVE',
  createdAt: new Date('2026-09-01T09:00:00Z'), createdBy: 'u-1',
  medicationCode: { id: 'mc-1', code: '645100010', nameKo: '아스피린장용정100mg', nameEn: null, ingredient: 'aspirin' },
};
const outboundLabOrderRow = { ...outboundMedicationRow, id: 'rx-2', type: 'LAB', medicationCodeId: null, medicationCode: null, dosage: null };
const outboundAllergyRow = {
  id: 'al-1', patientId: 'p-1', type: 'DRUG', allergen: '페니실린', allergenCode: null, reaction: '두드러기',
  severity: 'SEVERE', verificationStatus: 'CONFIRMED', isActive: true,
};

describe('읽기 정본 — 알려진 저장 모양을 모두 읽는다', () => {
  it('송신 스냅샷(Prisma 행) → 진단명·약품명이 나온다', () => {
    const v = toTransferClinicalView(jsonb({
      diagnoses: [outboundDiagnosisRow],
      medications: [outboundMedicationRow],
      allergies: [outboundAllergyRow],
    }));
    expect(v.diagnoses).toEqual([{ code: 'I21.9', system: 'KCD-8', nameKo: '급성 심근경색증', nameEn: 'Acute myocardial infarction' }]);
    expect(v.medications?.[0]).toMatchObject({ code: '645100010', nameKo: '아스피린장용정100mg', ingredient: 'aspirin', dosage: '100mg', frequency: 'QD' });
    expect(v.allergies).toEqual([{ name: '페니실린', severity: 'SEVERE' }]);
  });

  it('수신 FHIR 보존 모양(importClinicalData) → 이름이 나온다', () => {
    const v = toTransferClinicalView({
      diagnoses: [{ code: 'I10', system: 'http://hl7.org/fhir/sid/icd-10', text: '본태성 고혈압' }],
      medications: [{ text: 'Amlodipine 5mg', dosage: '1T QD', status: 'active' }],
      allergies: [{ name: 'Peanut', severity: 'high', category: 'food', criticality: 'high' }],
    });
    expect(v.diagnoses?.[0]).toEqual({ code: 'I10', system: 'http://hl7.org/fhir/sid/icd-10', nameKo: '본태성 고혈압', nameEn: null });
    expect(v.medications?.[0]).toMatchObject({ nameKo: 'Amlodipine 5mg', dosage: '1T QD', status: 'active' });
    expect(v.allergies?.[0]).toEqual({ name: 'Peanut', severity: 'high' });
  });

  it('대조군 — 과거 `{code, name}` 모양도 읽는다', () => {
    const v = toTransferClinicalView({ diagnoses: [{ code: 'J18.9', name: '폐렴' }], medications: [{ name: '세프트리악손', dosage: '1g' }], allergies: [] });
    expect(v.diagnoses?.[0]).toMatchObject({ code: 'J18.9', nameKo: '폐렴' });
    expect(v.medications?.[0]).toMatchObject({ nameKo: '세프트리악손', dosage: '1g' });
  });

  it('어느 모양에도 이름이 없으면 null — 코드를 이름 자리에 넣지 않는다(지어내지 않음)', () => {
    const v = toTransferClinicalView({
      diagnoses: [{ code: 'Z99' }, { diagnosisCode: { code: 'R69', nameKo: '  ' } }],
      medications: [{ dosage: '1T' }],
      allergies: [{ severity: 'MILD' }],
    });
    expect(v.diagnoses?.map((d) => d.nameKo)).toEqual([null, null]);
    expect(v.diagnoses?.map((d) => d.code)).toEqual(['Z99', 'R69']);
    expect(v.medications?.[0].nameKo).toBeNull();
    expect(v.allergies?.[0].name).toBeNull();
  });

  it('섹션 null(미상)과 [](없음)을 접지 않는다', () => {
    const v = toTransferClinicalView({ diagnoses: null, medications: [], allergies: undefined });
    expect(v.diagnoses).toBeNull();
    expect(v.medications).toEqual([]);
    expect(v.allergies).toBeNull();
  });

  it('송신 스냅샷의 비투약 처방(LAB 등)은 투약으로 그리지 않는다', () => {
    const v = toTransferClinicalView(jsonb({ medications: [outboundMedicationRow, outboundLabOrderRow] }));
    expect(v.medications).toHaveLength(1);
    expect(v.medications?.[0].nameKo).toBe('아스피린장용정100mg');
  });
});

describe('서비스 — 스냅샷 쓰기·상세 응답·FHIR 번들이 같은 정본을 지난다', () => {
  const selfOrg = { id: 'self-org', name: '우리병원', code: 'WERUBYHOSP', isSelf: true };
  const toOrg = { id: 'o-2', name: '가상대병원', code: '11100001' };
  const patient = {
    id: 'p-1', mrn: 'MRN-1', familyName: '김', givenName: '환자', fhirId: null,
    gender: 'MALE', dateOfBirth: new Date('1990-01-01'), phone: null, nameEn: null,
  };

  function setup() {
    let stored: any = null;
    let bundle: any = null;
    const prisma: any = {
      organization: { findFirst: vi.fn().mockResolvedValue(selfOrg) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([outboundDiagnosisRow]) },
      prescription: { findMany: vi.fn().mockResolvedValue([outboundMedicationRow, outboundLabOrderRow]) },
      allergy: { findMany: vi.fn().mockResolvedValue([outboundAllergyRow]) },
      transferRecord: {
        create: vi.fn().mockImplementation((args: any) => {
          // JSONB 컬럼은 저장 시 직렬화된다 — 읽을 때 돌아오는 것은 이 모양이다
          stored = { id: 't-1', ...args.data, diagnoses: jsonb(args.data.diagnoses), medications: jsonb(args.data.medications), allergies: jsonb(args.data.allergies), patient, fromOrg: selfOrg, toOrg };
          return Promise.resolve(stored);
        }),
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(stored)),
        update: vi.fn().mockImplementation((args: any) => { bundle = args.data.fhirBundle; return Promise.resolve({}); }),
      },
    };
    return { service: new TransferService(prisma), prisma, getBundle: () => bundle };
  }

  const dto = { patientId: 'p-1', toOrgId: 'o-2', urgency: 'URGENT', reason: '전원', transferType: 'OUTGOING_REFERRAL' };

  it('송신 스냅샷은 약품 코드 행을 곁들인다(약 이름이 저장되지 않던 결함)', async () => {
    const { service, prisma } = setup();
    await service.create(dto, 'u-1');
    expect(prisma.prescription.findMany.mock.calls[0][0].include).toEqual({ medicationCode: true });
  });

  it('FHIR 번들 Condition·MedicationRequest 에 진단명·약품명이 실린다', async () => {
    const { service, getBundle } = setup();
    await service.create(dto, 'u-1');
    const res = getBundle().entry.map((e: any) => e.resource);
    const cond = res.filter((r: any) => r.resourceType === 'Condition');
    const meds = res.filter((r: any) => r.resourceType === 'MedicationRequest');
    expect(cond).toHaveLength(1);
    expect(cond[0].code.text).toBe('급성 심근경색증');
    expect(cond[0].code.coding[0]).toMatchObject({ code: 'I21.9', display: '급성 심근경색증' });
    // LAB 오더는 MedicationRequest 로 나가지 않는다
    expect(meds).toHaveLength(1);
    expect(meds[0].medicationCodeableConcept.text).toBe('아스피린장용정100mg');
    expect(meds[0].dosageInstruction[0].text).toBe('100mg QD');
  });

  it('이름이 원문에 없으면 번들 text 는 빈 문자열이 아니라 "원문 없음"', async () => {
    const { service, prisma, getBundle } = setup();
    prisma.encounterDiagnosis.findMany.mockResolvedValue([{ ...outboundDiagnosisRow, diagnosisCode: null }]);
    prisma.prescription.findMany.mockResolvedValue([{ ...outboundMedicationRow, medicationCode: null }]);
    await service.create(dto, 'u-1');
    const res = getBundle().entry.map((e: any) => e.resource);
    expect(res.find((r: any) => r.resourceType === 'Condition').code).toEqual({ coding: [], text: '원문 없음' });
    expect(res.find((r: any) => r.resourceType === 'MedicationRequest').medicationCodeableConcept.text).toBe('원문 없음');
  });

  it('상세 응답(findOne)은 원본 필드를 그대로 두고 clinical 읽기 모양을 곁들인다', async () => {
    const { service } = setup();
    await service.create(dto, 'u-1');
    const detail: any = await service.findOne('t-1');
    expect(detail.diagnoses[0].diagnosisCode.code).toBe('I21.9'); // 저장 모양 불변
    expect(detail.clinical.diagnoses[0].nameKo).toBe('급성 심근경색증');
    expect(detail.clinical.medications.map((m: any) => m.nameKo)).toEqual(['아스피린장용정100mg']);
    expect(detail.clinical.allergies).toEqual([{ name: '페니실린', severity: 'SEVERE' }]);
  });
});
