import { describe, it, expect } from 'vitest';
import { ValidationPipe, ArgumentMetadata } from '@nestjs/common';
import {
  UpdateSurgicalChecklistDto,
  UpsertPreAnesthesiaDto,
} from '../../src/modules/surgery/dto/surgery-advanced.dto';
import {
  UpdateVisitStatusDto,
  ReassessEmergencyDto,
  MakeDispositionDto,
  CreateEmergencyNursingAssessmentDto,
} from '../../src/modules/emergency/dto/emergency.dto';
import {
  ChemoDoseDto,
  CreateCompoundingOrderDto,
  PrepCompoundingDto,
  VerifyCompoundingDto,
} from '../../src/modules/compounding/dto/compounding.dto';
import { ReceiveBatchDto, AdjustBatchDto } from '../../src/modules/pharmacy/dto/inventory.dto';
import { UpsertPathologyReportDto, CreatePathologySpecimenDto } from '../../src/modules/pathology/dto/pathology.dto';
import { RecordTransfusionVitalsDto } from '../../src/modules/blood-bank/dto/blood-bank.dto';
import { ApprovePartnerRequestDto } from '../../src/modules/partner-request/dto/partner-request.dto';
import { CreatePrescriptionWithContextDto } from '../../src/modules/prescription/dto/create-prescription.dto';

/**
 * 인라인 @Body → DTO 승격 계약 가드 (2026-08-18)
 *
 * 🔴 이 축의 위험은 **양쪽**이다.
 *   ① 승격 전: 파이프가 스킵돼 음수 용량·범위 밖 점수·오타 상태값이 원장에 그대로 들어갔다.
 *   ② 승격 후: DTO 에 빠뜨린 키를 whitelist 가 **조용히 지운다** — 오늘 새 유실을 만든다.
 * 그래서 모든 DTO 를 **화면이 실제로 보내는 페이로드**로 한 번, **결함 값**으로 한 번 태운다.
 *
 * 파이프 옵션은 `main.ts` 와 동일해야 한다 — 갈라지면 이 가드는 아무것도 보증하지 못한다.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });

function meta(metatype: unknown): ArgumentMetadata {
  return { type: 'body', metatype: metatype as ArgumentMetadata['metatype'], data: '' };
}
async function through<T extends object>(metatype: unknown, payload: Record<string, unknown>): Promise<T> {
  return (await pipe.transform(payload, meta(metatype))) as T;
}
/** 값이 실제로 실린 키만 — 클래스 필드는 undefined 로 선언되므로 Object.keys 를 그대로 쓰면 안 된다. */
function definedKeys(out: Record<string, unknown>): string[] {
  return Object.entries(out).filter(([, v]) => v !== undefined).map(([k]) => k).sort();
}

const UUID = '11111111-1111-4111-8111-111111111111';

describe('WHO 수술안전 체크리스트 (UpdateSurgicalChecklistDto)', () => {
  it('화면은 누른 항목 하나만 보낸다 — 그 키가 살아남는다', async () => {
    for (const key of ['patientId', 'siteMarked', 'procedure', 'site', 'instrumentCount']) {
      const out = await through<Record<string, unknown>>(UpdateSurgicalChecklistDto, { [key]: true });
      expect(definedKeys(out), `${key} 가 whitelist 에 지워졌다`).toEqual([key]);
    }
  });

  it('🔴 계수 불일치를 소문자로 보내면 거부한다 — 게이트는 정확히 MISMATCH 만 본다', async () => {
    await expect(through(UpdateSurgicalChecklistDto, { countStatus: 'mismatch' })).rejects.toThrow();
    await expect(through(UpdateSurgicalChecklistDto, { countStatus: '불일치' })).rejects.toThrow();
    const ok = await through<{ countStatus?: string }>(UpdateSurgicalChecklistDto, { countStatus: 'MISMATCH' });
    expect(ok.countStatus).toBe('MISMATCH');
  });

  it('체크값은 boolean 이어야 한다(문자열 "false" 는 참으로 저장될 뻔했다)', async () => {
    await expect(through(UpdateSurgicalChecklistDto, { siteMarked: 'false' })).rejects.toThrow();
  });

  it('계수 품목은 음수가 될 수 없다', async () => {
    await expect(
      through(UpdateSurgicalChecklistDto, { countItems: [{ item: '거즈', initial: -1, final: 10 }] }),
    ).rejects.toThrow();
    const ok = await through<{ countItems?: unknown[] }>(UpdateSurgicalChecklistDto, {
      countItems: [{ item: '거즈', initial: 10, final: 10, status: 'MATCH' }],
    });
    expect(ok.countItems).toHaveLength(1);
  });
});

describe('마취전평가 (UpsertPreAnesthesiaDto)', () => {
  /** surgery-prep 화면의 form 전체 — 임시 저장은 빈 값으로도 눌린다 */
  const draft = { asaClass: '', airwayMallampati: '', plan: '', npoConfirmed: false, labsReviewed: false, anesthesiaConsent: false };

  it('임시 저장(빈 값) 6키가 하나도 버려지지 않는다', async () => {
    const out = await through<Record<string, unknown>>(UpsertPreAnesthesiaDto, draft);
    expect(definedKeys(out)).toEqual(Object.keys(draft).sort());
  });

  it('작성 완료 값이 통과한다', async () => {
    const out = await through<{ asaClass?: string }>(UpsertPreAnesthesiaDto, { ...draft, asaClass: '3E', airwayMallampati: 'III', plan: 'GENERAL', npoConfirmed: true });
    expect(out.asaClass).toBe('3E');
  });

  it('🔴 정의에 없는 ASA·기도등급·마취계획을 거부한다', async () => {
    await expect(through(UpsertPreAnesthesiaDto, { asaClass: '9' })).rejects.toThrow();
    await expect(through(UpsertPreAnesthesiaDto, { airwayMallampati: 'V' })).rejects.toThrow();
    await expect(through(UpsertPreAnesthesiaDto, { plan: 'DEEP_SLEEP' })).rejects.toThrow();
  });

  it('RCRI 는 0~6 이다(심장위험 점수)', async () => {
    await expect(through(UpsertPreAnesthesiaDto, { cardiacRiskRcri: 99 })).rejects.toThrow();
    await expect(through(UpsertPreAnesthesiaDto, { cardiacRiskRcri: -1 })).rejects.toThrow();
  });
});

describe('응급 — 상태·KTAS 재분류·처분', () => {
  it('ER 보드 8상태만 통과한다', async () => {
    for (const s of ['PENDING_TRIAGE', 'TRIAGED', 'PENDING_DOCTOR', 'IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION', 'COMPLETED']) {
      await expect(through(UpdateVisitStatusDto, { status: s })).resolves.toBeDefined();
    }
    await expect(through(UpdateVisitStatusDto, { status: 'IN_TREATMEMT' })).rejects.toThrow();
  });

  it('🔴 KTAS 등급은 5단계뿐 — 그 밖의 값은 재분류 기록만 남기고 실제 등급은 안 바뀌었다', async () => {
    const out = await through<{ newLevel?: string }>(ReassessEmergencyDto, { newLevel: 'LEVEL_2', reason: '흉통 악화' });
    expect(out.newLevel).toBe('LEVEL_2');
    await expect(through(ReassessEmergencyDto, { newLevel: 'KTAS2', reason: 'x' })).rejects.toThrow();
    await expect(through(ReassessEmergencyDto, { newLevel: 'LEVEL_2', reason: '' })).rejects.toThrow();
  });

  it('재분류 활력(JSON)은 키를 고정하지 않되 객체만 받는다', async () => {
    const out = await through<{ vitals?: Record<string, unknown> }>(ReassessEmergencyDto, {
      newLevel: 'LEVEL_3', reason: '재평가', vitals: { sbp: 90, hr: 120 },
    });
    expect(out.vitals).toEqual({ sbp: 90, hr: 120 });
    await expect(through(ReassessEmergencyDto, { newLevel: 'LEVEL_3', reason: 'r', vitals: 'BP 90/60' })).rejects.toThrow();
  });

  it('처분 7종(입원·전원·사망·자의퇴원·관찰·수술 포함)이 통과하고 오타는 거부된다', async () => {
    for (const d of ['DISCHARGE', 'ADMISSION', 'TRANSFER', 'DEATH', 'LEAVE_AMA', 'OBSERVATION', 'SURGERY']) {
      await expect(through(MakeDispositionDto, { disposition: d })).resolves.toBeDefined();
    }
    await expect(through(MakeDispositionDto, { disposition: 'HOME' })).rejects.toThrow();
  });

  it('화면이 보내는 처분 3키가 살아남는다', async () => {
    const payload = { disposition: 'DISCHARGE', dischargeInstructions: '3일 후 외래', followUpDate: '2026-08-25' };
    const out = await through<Record<string, unknown>>(MakeDispositionDto, payload);
    expect(definedKeys(out)).toEqual(Object.keys(payload).sort());
  });

  it('🔴 GCS 는 정의된 범위 밖 값이 존재하지 않는다(E1-4·V1-5·M1-6)', async () => {
    const base = { airway: 'PATENT', breathing: 'NORMAL', circulation: 'NORMAL' };
    await expect(through(CreateEmergencyNursingAssessmentDto, { ...base, gcsEye: 4, gcsVerbal: 5, gcsMotor: 6, painScale: 7 })).resolves.toBeDefined();
    await expect(through(CreateEmergencyNursingAssessmentDto, { ...base, gcsEye: 5 })).rejects.toThrow();
    await expect(through(CreateEmergencyNursingAssessmentDto, { ...base, gcsMotor: 0 })).rejects.toThrow();
    await expect(through(CreateEmergencyNursingAssessmentDto, { ...base, painScale: 11 })).rejects.toThrow();
  });
});

describe('무균조제 — 항암 용량 계산 (ChemoDoseDto)', () => {
  it('🔴 키·체중·mg/m² 가 없으면 0 이 아니라 거부다(종전에는 BSA 0·용량 null 을 돌려줬다)', async () => {
    await expect(through(ChemoDoseDto, {})).rejects.toThrow();
    await expect(through(ChemoDoseDto, { heightCm: 170, weightKg: 65 })).rejects.toThrow();
  });

  it('음수·비현실 값은 거부한다', async () => {
    await expect(through(ChemoDoseDto, { heightCm: -170, weightKg: 65, dosePerM2: 100 })).rejects.toThrow();
    await expect(through(ChemoDoseDto, { heightCm: 170, weightKg: 0, dosePerM2: 100 })).rejects.toThrow();
    await expect(through(ChemoDoseDto, { heightCm: 170, weightKg: 65, dosePerM2: -1 })).rejects.toThrow();
  });

  it('화면이 보내는 5키가 살아남는다', async () => {
    const payload = { heightCm: 170, weightKg: 65, dosePerM2: 100, bandMg: 5, capMg: 200 };
    const out = await through<Record<string, unknown>>(ChemoDoseDto, payload);
    expect(definedKeys(out)).toEqual(Object.keys(payload).sort());
  });

  it('조제지시 생성 — 환자 ID 는 UUID 여야 한다(종전 Prisma 500)', async () => {
    await expect(through(CreateCompoundingOrderDto, { sourceType: 'TPN', patientId: 'not-a-uuid' })).rejects.toThrow();
    const out = await through<Record<string, unknown>>(CreateCompoundingOrderDto, {
      sourceType: 'TPN', patientId: UUID, components: [{ role: 'BASE_FLUID', name: '5%DW 1000mL' }],
    });
    expect(definedKeys(out)).toEqual(['components', 'patientId', 'sourceType']);
  });

  it('후드 유형·BUD 시간 범위', async () => {
    await expect(through(PrepCompoundingDto, { hoodType: 'BSC_II' })).resolves.toBeDefined();
    await expect(through(PrepCompoundingDto, { hoodType: '아무거나' })).rejects.toThrow();
    await expect(through(VerifyCompoundingDto, { budHours: 24 })).resolves.toBeDefined();
    await expect(through(VerifyCompoundingDto, { budHours: 100000 })).rejects.toThrow();
  });
});

describe('약품 재고 (ReceiveBatchDto·AdjustBatchDto)', () => {
  const receiveForm = {
    medicationCodeId: UUID, lotNumber: 'LOT-2026-01', expirationDate: '2027-01-31',
    quantity: 100, manufacturer: '한국제약', storageCondition: 'ROOM', isControlled: false,
  };

  it('입고 화면의 7키가 하나도 버려지지 않는다', async () => {
    const out = await through<Record<string, unknown>>(ReceiveBatchDto, receiveForm);
    expect(definedKeys(out)).toEqual(Object.keys(receiveForm).sort());
  });

  it('🔴 유효기간을 비운 채 누르면 400 이다(종전에는 Invalid Date 로 500 이 났다)', async () => {
    await expect(through(ReceiveBatchDto, { ...receiveForm, expirationDate: '' })).rejects.toThrow();
  });

  it('수량은 1 이상 정수 — 음수 재고는 존재하지 않는다', async () => {
    await expect(through(ReceiveBatchDto, { ...receiveForm, quantity: -5 })).rejects.toThrow();
    await expect(through(ReceiveBatchDto, { ...receiveForm, quantity: 1.5 })).rejects.toThrow();
    await expect(through(AdjustBatchDto, { quantity: -1, reason: '파손' })).rejects.toThrow();
    await expect(through(AdjustBatchDto, { quantity: 0, reason: '' })).rejects.toThrow();
    await expect(through(AdjustBatchDto, { quantity: 0, reason: '전량 폐기' })).resolves.toBeDefined();
  });
});

describe('병리 — 보고서·검체 (별칭 키 포함)', () => {
  /** pathology 화면이 실제로 보내는 보고서 페이로드 12키 */
  const reportPayload = {
    specimenId: UUID,
    grossDescription: '3.2cm 종괴',
    microDescription: '침윤성 관암종',
    diagnosis: 'Invasive ductal carcinoma',
    diagnosisCode: 'C50.9',
    ihcResults: [{ marker: 'ER', result: 'positive' }],
    molecularResults: [{ marker: 'HER2', result: 'amplified' }],
    tnmT: 'pT2', tnmN: 'pN1', tnmM: 'pM0', tnmStage: 'IIB',
    tumorGrade: 'G2', marginStatus: 'CLEAR',
  };

  it('🔴 화면이 보내는 14키가 하나도 버려지지 않는다 — 하나만 빠져도 암 진단이 조용히 사라진다', async () => {
    const out = await through<Record<string, unknown>>(UpsertPathologyReportDto, reportPayload);
    expect(definedKeys(out)).toEqual(Object.keys(reportPayload).sort());
  });

  it('서비스가 읽는 별칭 키(microscopicDescription·icdCode·ihc·molecularTest·pathologistId)도 살아남는다', async () => {
    const aliases = {
      microscopicDescription: '별칭 소견', icdCode: 'C50.9',
      ihc: [{ marker: 'PR', result: 'negative' }], molecularTest: [{ marker: 'BRCA', result: 'wt' }],
      pathologistId: UUID,
    };
    const out = await through<Record<string, unknown>>(UpsertPathologyReportDto, aliases);
    expect(definedKeys(out)).toEqual(Object.keys(aliases).sort());
  });

  it('검체 ID 가 UUID 가 아니면 400(종전 Prisma 500)·절제연은 정의된 값만', async () => {
    await expect(through(UpsertPathologyReportDto, { specimenId: 'abc' })).rejects.toThrow();
    await expect(through(UpsertPathologyReportDto, { marginStatus: '깨끗함' })).rejects.toThrow();
  });

  it('검체 접수 화면의 6키가 살아남고, 검체 유형은 정의된 5종만', async () => {
    const payload = { patientId: UUID, specimenType: 'BIOPSY', collectionSite: '우측 유방', fixative: '10% formalin', priority: 'ROUTINE', clinicalInfo: '유방 종괴' };
    const out = await through<Record<string, unknown>>(CreatePathologySpecimenDto, payload);
    expect(definedKeys(out)).toEqual(Object.keys(payload).sort());
    await expect(through(CreatePathologySpecimenDto, { patientId: UUID, specimenType: 'UNKNOWN' })).rejects.toThrow();
  });
});

describe('수혈 중 활력 (RecordTransfusionVitalsDto)', () => {
  it('생리적으로 불가능한 값을 원장 JSON 에 넣지 않는다', async () => {
    await expect(through(RecordTransfusionVitalsDto, { temperature: 999 })).rejects.toThrow();
    await expect(through(RecordTransfusionVitalsDto, { spO2: 150 })).rejects.toThrow();
    await expect(through(RecordTransfusionVitalsDto, { systolicBP: '높음' })).rejects.toThrow();
  });

  it('정상 관찰 기록은 그대로 통과한다', async () => {
    const payload = { timing: '15MIN', systolicBP: 118, diastolicBP: 74, heartRate: 88, respiratoryRate: 18, temperature: 36.8, spO2: 98, note: '이상 없음' };
    const out = await through<Record<string, unknown>>(RecordTransfusionVitalsDto, payload);
    expect(definedKeys(out)).toEqual(Object.keys(payload).sort());
  });
});

describe('파트너 승인 — 버려지던 심사 메모', () => {
  it('🔴 승인 메모가 DTO 를 통과한다(종전에는 @Body 자체가 없어 통째로 버려졌다)', async () => {
    const out = await through<{ reviewNote?: string }>(ApprovePartnerRequestDto, { reviewNote: '자격 확인 완료' });
    expect(out.reviewNote).toBe('자격 확인 완료');
  });
});

describe('처방 생성 (CreatePrescriptionWithContextDto) — 교차 타입으로 죽어 있던 검증', () => {
  /** orders 화면이 보내는 약 처방 페이로드(위임 승인 시 prescriberId 동봉) */
  const medPayload = {
    type: 'MEDICATION', priority: 'ROUTINE', dispensingType: 'INTERNAL',
    diagnosisCodeId: UUID, medicationCodeId: UUID,
    dosage: '500mg', frequency: '1일 3회', duration: 5, quantity: 15, route: '경구',
    prescriberId: UUID,
  };

  it('화면이 보내는 11키가 하나도 버려지지 않는다', async () => {
    const out = await through<Record<string, unknown>>(CreatePrescriptionWithContextDto, medPayload);
    expect(definedKeys(out)).toEqual(Object.keys(medPayload).sort());
  });

  it('처방 유형 7종(오더 탭과 동일)이 통과한다', async () => {
    for (const t of ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING']) {
      await expect(through(CreatePrescriptionWithContextDto, { type: t, priority: 'ROUTINE' })).resolves.toBeDefined();
    }
  });

  it('🔴 이 검증들은 종전 교차 타입에서 한 번도 실행되지 않았다 — 이제 실행된다', async () => {
    await expect(through(CreatePrescriptionWithContextDto, { type: 'DRUG' })).rejects.toThrow();
    await expect(through(CreatePrescriptionWithContextDto, { type: 'MEDICATION', medicationCodeId: 'abc' })).rejects.toThrow();
    await expect(through(CreatePrescriptionWithContextDto, { type: 'MEDICATION', duration: 0 })).rejects.toThrow();
    await expect(through(CreatePrescriptionWithContextDto, { type: 'MEDICATION', quantity: -3 })).rejects.toThrow();
    await expect(through(CreatePrescriptionWithContextDto, { type: 'MEDICATION', prescriberId: 'me' })).rejects.toThrow();
  });

  it('강제 처방(DUR override) 재전송 키가 살아남는다', async () => {
    const out = await through<Record<string, unknown>>(CreatePrescriptionWithContextDto, {
      ...medPayload, overrideDur: true, overrideReason: '주치의 판단 — 대체 불가',
    });
    expect(out.overrideDur).toBe(true);
    expect(out.overrideReason).toBe('주치의 판단 — 대체 불가');
  });

  it('세트·워크스테이션 경로(instructions 만 있는 검사·간호 오더)도 통과한다', async () => {
    const out = await through<Record<string, unknown>>(CreatePrescriptionWithContextDto, {
      type: 'LAB', instructions: '워크인 검사', priority: 'ROUTINE',
    });
    expect(definedKeys(out)).toEqual(['instructions', 'priority', 'type']);
  });
});
