import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { nrs2002RiskLevel } from '@hospital-run/shared';
import { CreateHandoffDto } from '../../src/modules/inpatient/dto/inpatient.dto';
import { CreatePrescriptionWithContextDto } from '../../src/modules/prescription/dto/create-prescription.dto';
import { ReceiveInterfaceResultDto } from '../../src/modules/lab/dto/lab-result.dto';
import { CreateOrthopedicsExamDto } from '../../src/modules/orthopedics/dto/orthopedics.dto';
import { CreateDentalRecordDto } from '../../src/modules/dental/dto/dental.dto';
import { PayBillingDto } from '../../src/modules/billing/dto/pay-billing.dto';
import { CdssCheckDto, CheckOrderSetDto } from '../../src/modules/cdss/dto/cdss.dto';
import { CreateNutritionAssessmentDto } from '../../src/modules/nutrition/dto/nutrition-advanced.dto';
import {
  AiAutoRecordDto, AiExplainDto, AiPredictComplicationDto, AiTriageDto,
} from '../../src/modules/medical-ai/dto/medical-ai.dto';

/**
 * 🔴 전역 `whitelist: true` 는 DTO 에 없는 키를 **조용히 지운다** — 200 을 주고 값만 버린다.
 *    화면은 저장에 성공했다고 믿고, 원장에는 NULL 이 남는다. 이 저장소에서 반복된 함정이다.
 *
 * 이 가드는 **실제 전역 파이프와 같은 설정**으로 화면이 보내는 본문을 태워, 키가 살아남는지 본다.
 * (DTO 를 눈으로 읽는 것으로는 못 잡는다 — 지워지는 것은 조용하기 때문이다.)
 *
 * 재주입 시 실패: DTO 에서 해당 필드 선언을 지우면 그 키가 결과에서 사라져 곧바로 깨진다.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const run = <T>(metatype: new () => T, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype }) as Promise<Record<string, unknown>>;

const UUID = '11111111-1111-4111-8111-111111111111';

describe('화면이 보내는 본문이 whitelist 를 통과하는가', () => {
  describe('인수인계 I-PASS 5필드', () => {
    // `/inpatient/[admissionId]` 인계 폼이 실제로 보내는 본문(2026-08-19 실측)
    const body = {
      type: 'NURSING_SHIFT',
      patientId: UUID, fromDoctorId: UUID, toDoctorId: UUID, admissionId: UUID,
      summary: '[I] STABLE\n[P] 요약',
      illness: 'STABLE',
      patientSummary: '68세 남성 · 폐렴 3일째',
      actionList: [{ action: '08시 항생제 투여', status: 'PENDING' }],
      situationAwareness: '발열 재발 시 혈액배양',
      synthesis: '인수자 확인함',
    };

    it('🔴 다섯 필드가 전부 살아남는다 — 종전에는 DTO 에 없어 통째로 지워졌다(운영 API 생성 2건 전부 NULL)', async () => {
      const out = await run(CreateHandoffDto, body);
      expect(out.illness).toBe('STABLE');
      expect(out.patientSummary).toBe(body.patientSummary);
      expect(out.actionList).toHaveLength(1);
      expect((out.actionList as { action: string }[])[0].action).toBe('08시 항생제 투여');
      expect(out.situationAwareness).toBe(body.situationAwareness);
      expect(out.synthesis).toBe(body.synthesis);
    });

    it('중증도는 어휘를 벗어나면 거부한다(임의 문자열이 배지 색을 정하지 않게)', async () => {
      await expect(run(CreateHandoffDto, { ...body, illness: '조금 나쁨' })).rejects.toThrow();
    });

    it('조치 목록의 각 줄도 검증된다(action 없는 줄은 거부)', async () => {
      await expect(run(CreateHandoffDto, { ...body, actionList: [{ status: 'PENDING' }] })).rejects.toThrow();
    });
  });

  describe('처방 지시 경로(구두·전화)', () => {
    const body = {
      type: 'MEDICATION', medicationCodeId: UUID, dosage: '500mg', frequency: 'TID', duration: 3, quantity: 9,
      orderSource: 'TELEPHONE', readBackConfirmed: true, prescriberId: UUID,
    };

    it('🔴 orderSource·readBackConfirmed 가 살아남는다 — 종전에는 지워져 운영 1,769건이 전부 WRITTEN 이었다', async () => {
      const out = await run(CreatePrescriptionWithContextDto, body);
      expect(out.orderSource).toBe('TELEPHONE');
      expect(out.readBackConfirmed).toBe(true);
    });

    it('지시 경로 어휘를 벗어나면 거부한다', async () => {
      await expect(run(CreatePrescriptionWithContextDto, { ...body, orderSource: 'SMS' })).rejects.toThrow();
    });

    it('복창 미전송은 "확인함"이 되지 않는다 — 기본값을 참으로 두지 않는다', async () => {
      const { readBackConfirmed, ...noReadBack } = body; void readBackConfirmed;
      const out = await run(CreatePrescriptionWithContextDto, noReadBack);
      expect(out.readBackConfirmed).toBeUndefined();
    });
  });
});

/**
 * 🔴 LIS 장비 결과 수신 — **개통 이래 100% 실패**하던 자리(2026-08-26 실측).
 *
 * `rawData` 에 class-validator 데코레이터가 하나도 없어(`@ApiProperty` 는 Swagger 전용)
 * whitelist 가 지웠고, `raw_data` 는 DB 에서 **NOT NULL·기본값 없음**이라
 * Prisma 가 `Argument rawData is missing` 을 던져 500 이 됐다.
 * 화면은 그것을 `toast.error('파일 업로드 실패')` 로 삼켰다.
 *
 * `whitelist:true` 는 **초기 커밋부터** 켜져 있었다 — 한 번도 성공한 적이 없다.
 * 재주입 시 실패: `@IsObject()` 를 지우면 `rawData` 가 결과에서 사라진다.
 */
describe('LIS 장비 결과 수신', () => {
  const body = {
    instrumentId: 'INST-01',
    rawData: { raw: 'H|\\^&|||ANALYZER', lines: 3 },
    parsedItems: [{ testCode: 'GLU', value: '98' }],
    sampleBarcode: 'SB-0001',
    fileName: 'run-20260826.astm',
  };

  it('🔴 `rawData` 가 살아남는다 — 지워지면 DB NOT NULL 위반으로 500 이 된다', async () => {
    const out = await run(ReceiveInterfaceResultDto, body);
    expect(out.rawData, 'rawData 가 whitelist 에 지워졌다').toBeDefined();
    expect((out.rawData as { lines: number }).lines).toBe(3);
  });

  it('파싱 항목·바코드도 함께 살아남는다', async () => {
    const out = await run(ReceiveInterfaceResultDto, body);
    expect(out.parsedItems).toHaveLength(1);
    expect(out.sampleBarcode).toBe('SB-0001');
  });

  it('대조군 — DTO 에 없는 키는 그대로 지워진다(가드가 무조건 통과하지 않는다)', async () => {
    const out = await run(ReceiveInterfaceResultDto, { ...body, notADtoField: 'x' });
    expect(out.notADtoField).toBeUndefined();
  });
});


/* ══════════════════════════════════════════════════════════════════════════
 * 2026-08-26 · whitelist 저장 소실 봉합 레인 F2
 *
 * AST 스캔이 찾은 확정 결함 7종. 전부 **화면이 실제로 보내는 본문**을 그대로 태운다 —
 * DTO 를 눈으로 맞추면 갈라지고, 지워지는 것은 조용하다.
 * ══════════════════════════════════════════════════════════════════════════ */

const WEB_SRC = join(process.cwd(), '../web/src/app/(main)');
const readWeb = (rel: string) => readFileSync(join(WEB_SRC, rel), 'utf8');

/**
 * 🔴 정형외과 "소견" — `ortho_exams` 에는 `imaging_findings`(영상 소견)뿐이다.
 *    화면은 진찰 소견을 `findings` 로 보냈고 whitelist 가 지웠다("저장되었습니다" + 소실).
 *    정본 판단: **영상 소견 컬럼에 진찰 소견을 담지 않는다**(읽는 사람이 판독문으로 오독한다).
 *    → 소견은 SOAP objective(buildSoap)로 간다. 비뇨의학과에서 먼저 정한 규약과 같다.
 */
describe('정형외과 검사 기록', () => {
  const body = {
    patientId: UUID, encounterId: UUID,
    bodyPart: 'KNEE', side: 'LEFT',
    rom: [{ movement: '굴곡', measured: '110', normal: '135' }],
    mmt: [{ muscle: '대퇴사두근', grade: '4' }],
    specialTests: [{ name: 'McMurray', result: '+' }],
    painVas: 6,
  };

  it('화면이 보내는 본문이 통째로 살아남는다', async () => {
    const out = await run(CreateOrthopedicsExamDto, body);
    expect(out.bodyPart).toBe('KNEE');
    expect(out.rom).toHaveLength(1);
    expect(out.mmt).toHaveLength(1);
    expect(out.specialTests).toHaveLength(1);
    expect(out.painVas).toBe(6);
  });

  it('🔴 `findings` 는 DTO 에 없다 — 보내면 조용히 사라진다(그래서 화면이 보내지 않는다)', async () => {
    const out = await run(CreateOrthopedicsExamDto, { ...body, findings: '내측 관절선 압통' });
    expect(out.findings, 'findings 가 살아남았다면 컬럼이 생긴 것이다 — 이 가드와 화면을 함께 고쳐라').toBeUndefined();
  });

  it('영상 소견 칸은 그대로 있다(영상 판독을 담을 자리는 살아 있어야 한다)', async () => {
    const out = await run(CreateOrthopedicsExamDto, { ...body, imagingFindings: 'X-ray: 관절간격 협소' });
    expect(out.imagingFindings).toBe('X-ray: 관절간격 협소');
  });

  it('🔴 화면이 검사 저장 본문에 `findings` 를 다시 넣지 않는다(재주입 시 실패)', () => {
    const src = readWeb('patients/[id]/encounter/new/components/OrthopedicsEncounterLayout.tsx');
    const payload = src.slice(src.indexOf("post('/api/v1/orthopedics/exams'"));
    const block = payload.slice(0, payload.indexOf('}),'));
    expect(block.length, '검사 저장 호출부를 찾지 못했다 — 가드가 헛돌고 있다').toBeGreaterThan(0);
    expect(/\bfindings\s*,/.test(block), '소견이 다시 본문에 들어갔다 — 저장되지 않고 사라진다').toBe(false);
    // 소견이 어디로 가는지는 buildSoap 이 유일한 경로다. 그것마저 없으면 아무데도 안 남는다.
    expect(/objective:\s*findings/.test(src), '소견이 SOAP objective 로도 가지 않는다 — 입력값이 증발한다').toBe(true);
  });
});

/**
 * 🔴 치과 치료기록 — 두 겹이었다.
 *    ① `soap` 은 `dental_treatment_records` 에 컬럼이 없다(SOAP 은 진료기록 쪽 정본).
 *    ② 폼의 `xray` 와 DTO/컬럼 `xrayTaken` 이름이 달라 **방사선 촬영 여부가 한 번도 저장되지 않았다.**
 */
describe('치과 치료 기록', () => {
  const body = {
    patientId: UUID, encounterId: UUID,
    tooth: '16', procedure: '복합레진 충전',
    surfaces: ['O', 'M'], material: '복합레진', anesthesia: '침윤마취',
    xrayTaken: true,
    findings: '교합면 우식 C2',
  };

  it('🔴 `xrayTaken` 이 살아남는다 — 종전 폼은 `xray` 로 보내 항상 NULL 이었다', async () => {
    const out = await run(CreateDentalRecordDto, body);
    expect(out.xrayTaken).toBe(true);
    expect(out.findings).toBe('교합면 우식 C2');
    expect(out.surfaces).toEqual(['O', 'M']);
  });

  it('`xray`(옛 이름)·`soap` 은 담을 곳이 없어 지워진다 — 그래서 화면이 보내지 않는다', async () => {
    const out = await run(CreateDentalRecordDto, { ...body, xray: true, soap: { so: '시린 느낌', ap: '충전' } });
    expect(out.xray).toBeUndefined();
    expect(out.soap).toBeUndefined();
  });

  it('치식은 자유문자열을 거부한다(오발치 방지 — 기존 게이트가 살아 있는지)', async () => {
    await expect(run(CreateDentalRecordDto, { ...body, tooth: '왼쪽 어금니' })).rejects.toThrow();
  });

  it('🔴 화면이 `xrayTaken` 으로 보내고 `soap` 을 다시 끼워넣지 않는다(재주입 시 실패)', () => {
    const src = readWeb('patients/[id]/encounter/new/components/DentalEncounterLayout.tsx');
    const from = src.indexOf("post<{ data: TreatmentRecord }>('/api/v1/dental/records'");
    expect(from, '치료기록 저장 호출부를 찾지 못했다 — 가드가 헛돌고 있다').toBeGreaterThan(-1);
    const block = src.slice(from, src.indexOf('}),', from));
    expect(/xrayTaken:/.test(block), '방사선 촬영 여부가 서버 키로 가지 않는다').toBe(true);
    expect(/soap:/.test(block), 'soap 은 이 EP 에 담을 곳이 없다 — 지워질 뿐이다').toBe(false);
    expect(/\.\.\.record/.test(block), '스프레드로 보내면 폼 키가 섞여 조용히 지워진다').toBe(false);
  });
});

/**
 * 🔴 치료 오더가 만드는 처방 — `notes` 는 DTO 에도 없고 서비스도 읽지 않는다.
 *    치료 유형·반복·횟수가 원장에 한 줄도 남지 않았다. 정본은 `instructions`.
 */
describe('치료 오더의 처방 지시문', () => {
  // 🔴 `type` 은 `PrescriptionType` 어휘여야 한다 — 화면은 종전에 열거형에 없는 `PROCEDURE` 를
  //    보내 **요청 자체가 400** 이었다(그래서 notes 드롭은 드러날 기회조차 없었다).
  const body = { type: 'THERAPY', priority: 'ROUTINE', instructions: '물리치료 (MWF, 10회)' };

  it('🔴 `instructions` 가 살아남는다(서비스가 읽어 prescriptions.instructions 에 적는 그 키)', async () => {
    const out = await run(CreatePrescriptionWithContextDto, body);
    expect(out.instructions).toBe('물리치료 (MWF, 10회)');
  });

  it('`notes` 는 지워진다 — 성공 응답과 함께 내용만 사라진다', async () => {
    const out = await run(CreatePrescriptionWithContextDto, { ...body, notes: '물리치료 (MWF, 10회)' });
    expect(out.notes).toBeUndefined();
  });

  it('🔴 열거형에 없는 처방 유형은 거부된다(PROCEDURE 는 없는 값이다)', async () => {
    await expect(run(CreatePrescriptionWithContextDto, { ...body, type: 'PROCEDURE' })).rejects.toThrow();
  });

  it('🔴 치료 오더 화면이 옛 값·옛 키로 되돌아가지 않는다(재주입 시 실패)', () => {
    const src = readWeb('orders/page.tsx');
    const from = src.indexOf("/prescriptions`, {\n        type: 'THERAPY'");
    expect(from, '치료 오더 처방 호출부를 찾지 못했다 — 가드가 헛돌고 있다').toBeGreaterThan(-1);
    const block = src.slice(from, src.indexOf('});', from));
    expect(/type:\s*'THERAPY'/.test(block), '치료 처방 유형이 열거형 밖 값으로 되돌아갔다 — 요청이 400 이 된다').toBe(true);
    expect(/instructions:/.test(block)).toBe(true);
    expect(/\bnotes:/.test(block), 'notes 는 서버가 읽지 않는다 — 치료 내용이 원장에서 사라진다').toBe(false);
  });
});

/**
 * 🔴 수납 카드사·할부 — 화면이 select 로 받아 보내는데 DTO/컬럼이 없어 지워졌다.
 *    200 + "수납이 완료되었습니다" + 카드 정산 대사에 필요한 값만 소실.
 */
describe('수납(카드) 본문', () => {
  const body = {
    amount: 15000, paymentMethod: 'CARD',
    cardCompany: '신한', cardApprovalNo: '12345678', installment: 3,
  };

  it('🔴 카드사·할부개월이 살아남는다 — 종전에는 둘 다 조용히 지워졌다', async () => {
    const out = await run(PayBillingDto, body);
    expect(out.cardCompany, '카드사가 whitelist 에 지워졌다').toBe('신한');
    expect(out.installment, '할부개월이 whitelist 에 지워졌다').toBe(3);
    expect(out.cardApprovalNo).toBe('12345678');
  });

  it('일시불(0)도 값으로 살아남는다 — falsy 라고 사라지면 안 된다', async () => {
    const out = await run(PayBillingDto, { ...body, installment: 0 });
    expect(out.installment).toBe(0);
  });

  it('할부개월은 범위를 벗어나면 거부한다(임의 숫자가 정산에 들어가지 않게)', async () => {
    await expect(run(PayBillingDto, { ...body, installment: 99 })).rejects.toThrow();
    await expect(run(PayBillingDto, { ...body, installment: -1 })).rejects.toThrow();
  });

  it('대조군 — DTO 에 없는 키는 그대로 지워진다(가드가 무조건 통과하지 않는다)', async () => {
    const out = await run(PayBillingDto, { ...body, discountType: 'SENIOR' });
    expect(out.discountType).toBeUndefined();
  });

  it('🔴 수납 화면이 서버 키 이름 그대로 보낸다(재주입 시 실패)', () => {
    const src = readFileSync(join(process.cwd(), '../web/src/app/(main)/billing/[id]/page.tsx'), 'utf8');
    expect(/cardCompany:/.test(src)).toBe(true);
    expect(/installment:/.test(src)).toBe(true);
  });
});

/**
 * 🔴 처방세트 CDSS — 화면은 `{medications:[…]}`, `CdssCheckDto` 는 환자 1명+약물 1건에
 *    `patientId` 필수. 형태가 달라 **항상 400** 이었다(버튼 무발동).
 *    처방세트는 환자 없는 템플릿이므로 환자 비의존 검사 전용 입구로 옮겼다.
 */
describe('처방세트 CDSS 검증', () => {
  const body = {
    medications: [
      { medicationCodeId: UUID, name: '와파린정 5mg' },
      { name: '자유 입력 약품' },
    ],
  };

  it('🔴 `medications` 배열이 살아남는다(항목 안의 키까지)', async () => {
    const out = await run(CheckOrderSetDto, body);
    const meds = out.medications as { medicationCodeId?: string; name?: string }[];
    expect(meds).toHaveLength(2);
    expect(meds[0].medicationCodeId).toBe(UUID);
    expect(meds[0].name).toBe('와파린정 5mg');
    expect(meds[1].medicationCodeId).toBeUndefined();
    expect(meds[1].name).toBe('자유 입력 약품');
  });

  it('항목 안의 미지 키도 지워진다(중첩 whitelist 가 실제로 도는지)', async () => {
    const out = await run(CheckOrderSetDto, { medications: [{ name: 'x', dosage: '500mg' }] });
    expect((out.medications as Record<string, unknown>[])[0].dosage).toBeUndefined();
  });

  it('🔴 종전 본문은 옛 EP 에서 통과할 수 없었다 — 그것이 400 의 정체다', async () => {
    await expect(
      run(CdssCheckDto, { medications: [{ name: '와파린정 5mg' }] }),
    ).rejects.toThrow();
  });

  it('🔴 화면이 새 EP 를 부르고 스프레드로 보내지 않는다(재주입 시 실패)', () => {
    const src = readWeb('admin/order-sets/page.tsx');
    expect(/cdss\/check-order-set/.test(src), '처방세트 검증이 환자 필수 EP 로 되돌아갔다').toBe(true);
    const from = src.indexOf('const medications = items');
    expect(from, '검증 payload 생성부를 찾지 못했다 — 가드가 헛돌고 있다').toBeGreaterThan(-1);
    const block = src.slice(from, src.indexOf('check-order-set', from));
    expect(/medicationCodeId:\s*it\.medicationCodeId/.test(block), '약품 코드를 보내지 않으면 서버는 아무것도 판정할 수 없다').toBe(true);
  });
});

/**
 * 🔴 영양평가 위험등급 — 같은 사실에 정본이 둘이었다(P12).
 *    화면 `nrs>=3 HIGH` / 서버 `nrs>=5 HIGH·>=3 MODERATE`. 화면이 보낸 등급은 DTO 에 없어
 *    지워졌으므로 **원장에는 서버 판정이 남았다** — NRS 3~4 에서 배지와 원장이 다른 말을 했다.
 */
describe('영양평가 위험등급', () => {
  const body = {
    patientId: UUID, assessmentType: 'NRS_2002',
    height: 170, weight: 55, albumin: 3.1, nrsScore: 4,
    intakeStatus: '식사량 50%', notes: 'NRS-2002: 영양상태 2 + 질병중증도 2 = 4',
  };

  it('평가 본문이 살아남는다', async () => {
    const out = await run(CreateNutritionAssessmentDto, body);
    expect(out.nrsScore).toBe(4);
    expect(out.albumin).toBe(3.1);
    expect(out.intakeStatus).toBe('식사량 50%');
  });

  it('`riskLevel` 은 받지 않는다 — 등급의 정본은 서버 파생 하나다', async () => {
    const out = await run(CreateNutritionAssessmentDto, { ...body, riskLevel: 'HIGH' });
    expect(out.riskLevel, '화면 등급을 받기 시작하면 정본이 다시 둘이 된다').toBeUndefined();
  });

  it('🔴 shared 정본이 서버가 쓰던 임계값 그대로다', () => {
    expect(nrs2002RiskLevel(5)).toBe('HIGH');
    expect(nrs2002RiskLevel(4)).toBe('MODERATE');
    expect(nrs2002RiskLevel(3)).toBe('MODERATE'); // 종전 화면은 여기를 HIGH 라 말했다
    expect(nrs2002RiskLevel(2)).toBe('LOW');
  });

  it('🔴 점수를 모르면 등급도 모른다 — LOW(초록)로 접지 않는다', () => {
    expect(nrs2002RiskLevel(null)).toBeNull();
    expect(nrs2002RiskLevel(undefined)).toBeNull();
  });

  it('🔴 화면·서버가 각자 임계값을 다시 적지 않는다(재주입 시 실패)', () => {
    const fe = readWeb('nutrition/components/NutritionAdvanced.tsx');
    const be = readFileSync(join(process.cwd(), 'src/modules/nutrition/nutrition-advanced.service.ts'), 'utf8');
    expect(/function getRiskLevel/.test(fe), '화면이 등급 판정을 다시 정의했다 — 정본이 둘이 된다').toBe(false);
    expect(/nrs2002RiskLevel/.test(fe), '화면이 shared 정본을 쓰지 않는다').toBe(true);
    expect(/nrs2002RiskLevel/.test(be), '서버가 shared 정본을 쓰지 않는다').toBe(true);
    expect(/nrsScore\s*>=\s*\d/.test(be), '서버에 임계값 리터럴이 되살아났다').toBe(false);
  });
});

/**
 * 🔴 AI 자동 퇴원요약 — **두 겹으로** 성공할 수 없었다.
 *    ① 본문 `{text,type}` vs DTO 필수 `conversation` → 항상 400.
 *    ② auto-record 응답은 `{soap, icd_codes, prescriptions}` 라 화면이 읽던 `summary`/`result`
 *       가 애초에 없다. 즉 키를 맞춰도 채워지지 않는다.
 *    → 퇴원요약의 정본 경로는 `writing/craft`(style=medical_discharge) 다. 죽은 경로를 지웠다.
 */
describe('AI 자동 퇴원요약', () => {
  it('🔴 종전 본문은 통과할 수 없다 — 그것이 폴백에 가려져 있던 400 이다', async () => {
    await expect(
      run(AiAutoRecordDto, { text: '환자 입원 경과를 요약하여…', type: 'discharge_summary' }),
    ).rejects.toThrow();
  });

  it('auto-record 본래 용도(진료 대화)는 그대로 통과한다 — EP 를 망가뜨린 게 아니다', async () => {
    const out = await run(AiAutoRecordDto, { conversation: '어디가 불편하세요? …', specialty: 'IM' });
    expect(out.conversation).toContain('불편');
    expect(out.specialty).toBe('IM');
  });

  it('🔴 두 퇴원 화면이 auto-record 를 다시 부르지 않는다(재주입 시 실패)', () => {
    for (const rel of ['inpatient/[admissionId]/discharge-summary/page.tsx', 'workstation/discharge/page.tsx']) {
      const src = readWeb(rel);
      // 🔴 주석에 적힌 경로명까지 세면 가드가 자기 설명문에 걸린다 — **호출부만** 본다.
      expect(/post[^\n]*['"`][^'"`\n]*ai\/auto-record/.test(src), `${rel}: 성공한 적 없는 경로가 되살아났다`).toBe(false);
      expect(/ai\/writing\/craft/.test(src), `${rel}: 퇴원요약 정본 경로가 사라졌다`).toBe(true);
      // 🔴 실패를 폴백으로 덮지 않는다 — 실패했으면 화면이 그렇게 말해야 한다
      expect(/toast\.error/.test(src), `${rel}: 실패를 말하는 자리가 없다`).toBe(true);
    }
  });
});

/**
 * 🔴 응급 AI 3버튼 — 하나는 키가 달라 400, 하나는 값을 지어내고 있었다.
 */
describe('응급 화면 AI 본문', () => {
  it('🔴 합병증 예측: 종전 본문(diagnoses·surgeryType)은 통과할 수 없다', async () => {
    await expect(
      run(AiPredictComplicationDto, { age: 65, sex: 'M', diagnoses: ['흉통'], surgeryType: 'emergency' }),
    ).rejects.toThrow();
  });

  it('합병증 예측: 고친 본문은 통과한다', async () => {
    const out = await run(AiPredictComplicationDto, { age: 72, sex: 'F', diagnosis: '흉통' });
    expect(out.diagnosis).toBe('흉통');
    expect(out.sex).toBe('F');
    expect(out.age).toBe(72);
  });

  it('🔴 트리아지: `age`·`sex` 가 살아남는다 — 종전엔 DTO 에 키가 없어 AI 에 닿은 적이 없다', async () => {
    const out = await run(AiTriageDto, { symptom: '흉통', age: 6, sex: 'M' });
    expect(out.age, '나이가 지워지면 KTAS 소아·고령 가중이 걸리지 않는다').toBe(6);
    expect(out.sex).toBe('M');
  });

  it('나이를 모르면 보내지 않는다 — 선택 항목이라 통과한다(추정값을 강요하지 않는다)', async () => {
    const out = await run(AiTriageDto, { symptom: '흉통' });
    expect(out.age).toBeUndefined();
  });

  it('🔴 응급 화면이 나이·성별을 지어내지 않는다(재주입 시 실패)', () => {
    const src = readWeb('emergency/page.tsx');
    expect(/sex:\s*'M'\s*,/.test(src), "성별을 'M' 으로 고정했다 — 여성 환자가 남성으로 예측된다").toBe(false);
    expect(/\?\?\s*0\)\s*:\s*65/.test(src) || /:\s*65,/.test(src), '나이 기본값 65 가 되살아났다').toBe(false);
    expect(/diagnosis:\s*visit\.chiefComplaint/.test(src), '합병증 예측이 서버 필수 키를 보내지 않는다').toBe(true);
  });

  it('🔴 관리자 AI 챗: camelCase 여야 통과한다(snake_case 는 필수 필드 부재로 400)', async () => {
    await expect(
      run(AiExplainDto, { diagnosis: '고혈압', treatment_plan: '테스트', patient_level: 'professional' }),
    ).rejects.toThrow();
    const out = await run(AiExplainDto, { diagnosis: '고혈압', treatmentPlan: '테스트', patientLevel: 'professional' });
    expect(out.treatmentPlan).toBe('테스트');
    expect(out.patientLevel).toBe('professional');
  });

  it('🔴 관리자 화면이 snake_case 로 되돌아가지 않는다(재주입 시 실패)', () => {
    const src = readWeb('admin/ai-settings/page.tsx');
    expect(/treatment_plan:/.test(src)).toBe(false);
    expect(/treatmentPlan:/.test(src)).toBe(true);
  });
});
