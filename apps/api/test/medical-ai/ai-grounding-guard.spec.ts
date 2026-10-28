/**
 * 🔴 AI 소견 근거(grounding) 가드 — **원자료가 없으면 AI 를 부르지 않는다.**
 *
 * 2026-08-18 적발된 5건(P15/P16 정면 위반)을 재주입하면 이 파일이 실패해야 한다.
 *   #1 영상 판독 3종: `visionAnalyze('', …)` — 영상 URL 자리에 **빈 문자열**
 *   #2 검사 해석:     `results: [{ testName: <주호소>, value: 'pending' }]`
 *   #3 추적 검진:     결과를 **조회조차 하지 않고** "비정상 소견이 발견되었습니다" 허위 전제
 *   #4 건강 점수:     진료·검사 **횟수**만으로 0~100 점을 만들어 **환자에게** 노출
 *   #5 재입원 위험:   `age: 65, sex: 'M', lengthOfStay: 5` **상수**
 *
 * 가드 설계 원칙(이 저장소에서 가드가 헛돈 사례 12건):
 *   · **"부르지 않았다"를 스파이로 단언한다** — 반환값만 보면 폴백과 구분되지 않는다.
 *   · **부를 때는 실제로 무엇을 보냈는지 인자를 검사한다** — 호출 성사만으로는 날조를 못 잡는다.
 *   · 부분 문자열 단언에 기대지 않는다(깨진 출력을 숨긴다). 인자 전문을 직렬화해 금칙어를 찾는다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ImagingService } from '../../src/modules/imaging/imaging.service';
import { LabService } from '../../src/modules/lab/lab.service';
import { CheckupService } from '../../src/modules/checkup/checkup.service';
import { PortalService } from '../../src/modules/portal/portal.service';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

const noop = () => undefined;

describe('#1 영상 AI 판독 — 영상이 없으면 부르지 않는다', () => {
  let medicalAi: any;
  let prisma: any;
  let service: ImagingService;

  beforeEach(() => {
    medicalAi = {
      visionAnalyze: vi.fn().mockResolvedValue({ finding: '우하폐야 경화 의심' }),
      visionStructuredReport: vi.fn().mockResolvedValue({ birads: 3 }),
      visionCompareReport: vi.fn().mockResolvedValue({ change: '악화' }),
    };
    prisma = {
      imagingResult: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'img-1', modality: 'CT', bodyPart: 'CHEST', finding: null, impression: null,
        }),
      },
    };
    service = new ImagingService(prisma, { emit: vi.fn() } as any, medicalAi, {} as any);
  });

  it('🔴 analyzeImagingAI 는 AI 를 호출하지 않는다 — 판독할 영상 참조가 없다', async () => {
    const r: any = await service.analyzeImagingAI('img-1');
    expect(medicalAi.visionAnalyze).not.toHaveBeenCalled();
    expect(r.analysis).toBeNull();
    // 'FALLBACK'(불렀으나 실패)이 아니라 'UNAVAILABLE'(부르지 않음)이어야 한다 — 다른 사실이다.
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reasonCode).toBe('SOURCE_UNREACHABLE');
    expect(r.reason).toBeTruthy();
  });

  it('🔴 generateStructuredReport 도 호출하지 않는다', async () => {
    const r: any = await service.generateStructuredReport('img-1');
    expect(medicalAi.visionStructuredReport).not.toHaveBeenCalled();
    expect(r.report).toBeNull();
    expect(r.source).toBe('UNAVAILABLE');
  });

  it('🔴 compareImagingAI 도 호출하지 않는다', async () => {
    const r: any = await service.compareImagingAI('img-1', 'img-0');
    expect(medicalAi.visionCompareReport).not.toHaveBeenCalled();
    expect(r.comparison).toBeNull();
    expect(r.source).toBe('UNAVAILABLE');
  });

  it('판독의가 쓴 사람 소견은 그대로 돌려준다 — 그건 AI 산출물이 아니라 기록된 사실이다', async () => {
    prisma.imagingResult.findUnique.mockResolvedValue({
      id: 'img-1', modality: 'CT', bodyPart: 'CHEST', finding: '이상 없음', impression: '정상',
    });
    const r: any = await service.analyzeImagingAI('img-1');
    expect(r.radiologistFinding).toBe('이상 없음');
    expect(r.radiologistImpression).toBe('정상');
  });
});

describe('#1-b 초크포인트 — 어떤 호출자도 가져갈 수 없는 URL 로 판독을 요청할 수 없다', () => {
  let service: MedicalAiService;
  let fetchSpy: any;

  beforeEach(() => {
    const config = { get: vi.fn((k: string, d?: any) => ({ MEDICAL_AI_URL: 'https://ai.example.com' } as any)[k] ?? d) };
    const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma = { systemConfig: { findMany: vi.fn().mockResolvedValue([]) } };
    service = new MedicalAiService(config as any, runtime as any, prisma as any);
    // 상류로 나가면 그 자체가 결함이므로, 나가는지 감시한다.
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({}) } as any);
  });

  it('🔴 빈 문자열 영상 URL 은 400 — 상류로 나가지 않는다(보지 않은 영상의 소견 차단)', async () => {
    await expect(service.visionAnalyze('', 'CT', 'CHEST')).rejects.toThrow(BadRequestException);
    await expect(service.visionStructuredReport('', 'CT', 'CHEST')).rejects.toThrow(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('🔴 비교 판독은 두 영상 모두 검사한다 — 한쪽만 있어도 비교가 아니다', async () => {
    await expect(service.visionCompareReport('https://cdn.example.com/a.jpg', '', 'CT', 'CHEST'))
      .rejects.toThrow(BadRequestException);
    await expect(service.visionCompareReport('', 'https://cdn.example.com/b.jpg', 'CT', 'CHEST'))
      .rejects.toThrow(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HIS 인증 경로도 막는다 — 외부 주체는 401 을 받는다', async () => {
    await expect(service.visionAnalyze('https://his.example.org/api/v1/pacs/wado?studyUID=1.2.3', 'CT', 'CHEST'))
      .rejects.toThrow(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('#2 검사 AI 해석 — 값 자리에 플레이스홀더를 넣지 않는다', () => {
  let medicalAi: any;
  let prisma: any;
  let service: LabService;

  const order = (items: any[] | null, status = 'COMPLETED') => ({
    id: 'ord-1',
    labResult: items === null ? null : { id: 'lr-1', patientId: 'pat-1', status, items },
    prescription: { encounter: { chiefComplaint: '흉통', patient: { id: 'pat-1', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' } } },
  });

  beforeEach(() => {
    medicalAi = {
      interpretLab: vi.fn().mockResolvedValue({ summary: 'ok' }),
      clinicalQa: vi.fn().mockResolvedValue({ answer: 'ok' }),
    };
    prisma = { order: { findUnique: vi.fn() } };
    service = new LabService(prisma, { emit: vi.fn() } as any, medicalAi, {} as any);
  });

  it('🔴 결과 항목이 0건이면 호출하지 않고 산출 불가', async () => {
    prisma.order.findUnique.mockResolvedValue(order([], 'COLLECTED'));
    const r: any = await service.interpretResultAI('ord-1');
    expect(medicalAi.interpretLab).not.toHaveBeenCalled();
    expect(r.interpretation).toBeNull();
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reasonCode).toBe('NO_SOURCE_DATA');
  });

  it('🔴 값이 빈 항목만 있어도 호출하지 않는다 — 빈 값을 문자열로 메우면 그건 검사값이 아니다', async () => {
    prisma.order.findUnique.mockResolvedValue(order([{ testName: 'K', value: '   ', unit: 'mEq/L', normalMin: null, normalMax: null, flag: null }]));
    const r: any = await service.interpretResultAI('ord-1');
    expect(medicalAi.interpretLab).not.toHaveBeenCalled();
    expect(r.source).toBe('UNAVAILABLE');
  });

  it('🔴 실제 항목이 있으면 **그 값**을 보낸다 — 인자 전문에 pending/주호소가 없어야 한다', async () => {
    prisma.order.findUnique.mockResolvedValue(order([
      { testName: 'K', value: '5.9', unit: 'mEq/L', normalMin: 3.5, normalMax: 5.1, flag: 'H' },
      { testName: 'Na', value: '138', unit: 'mEq/L', normalMin: 135, normalMax: 145, flag: 'N' },
    ]));
    const r: any = await service.interpretResultAI('ord-1');
    expect(medicalAi.interpretLab).toHaveBeenCalledTimes(1);
    const arg = medicalAi.interpretLab.mock.calls[0][0];
    expect(arg.results).toEqual([
      { testName: 'K', value: '5.9', unit: 'mEq/L', normalMin: 3.5, normalMax: 5.1 },
      { testName: 'Na', value: '138', unit: 'mEq/L', normalMin: 135, normalMax: 145 },
    ]);
    // 값 자리에 'pending' 이 다시 들어오면 여기서 죽는다.
    expect(JSON.stringify(arg.results)).not.toContain('pending');
    // 주호소는 검사명이 아니라 임상 맥락 자리에만 있어야 한다.
    expect(arg.results.map((x: any) => x.testName)).not.toContain('흉통');
    expect(arg.clinicalContext).toBe('흉통');
    expect(r.source).toBe('AI');
  });

  it('🔴 추가 검사 추천 — 이상 항목이 0건이면 "이상이 발견되었다"고 말하지 않는다', async () => {
    prisma.order.findUnique.mockResolvedValue(order([
      { testName: 'Na', value: '138', unit: 'mEq/L', normalMin: 135, normalMax: 145, flag: 'N' },
    ]));
    const r: any = await service.suggestFollowupTests('ord-1');
    const q = medicalAi.clinicalQa.mock.calls[0][0].question as string;
    expect(q).not.toContain('이상 수치가 발견되었습니다');
    expect(q).toContain('이상표시(flag)가 붙은 항목이 없습니다');
    expect(q).toContain('Na');   // 실제 검사명
    expect(q).toContain('138');  // 실제 값
    expect(r.abnormalCount).toBe(0);
  });

  it('추가 검사 추천 — 항목이 0건이면 호출하지 않는다', async () => {
    prisma.order.findUnique.mockResolvedValue(order([], 'COLLECTED'));
    const r: any = await service.suggestFollowupTests('ord-1');
    expect(medicalAi.clinicalQa).not.toHaveBeenCalled();
    expect(r.source).toBe('UNAVAILABLE');
  });
});

describe('#3 추적 검진 권고 — 결과를 읽지 않고 전제를 만들지 않는다', () => {
  let medicalAi: any;
  let prisma: any;
  let service: CheckupService;

  const visit = (items: any[], summary: any = null) => ({
    id: 'v-1', status: 'IN_PROGRESS', items, summary,
    patient: { dateOfBirth: new Date('1975-05-05'), gender: 'FEMALE' },
  });

  beforeEach(() => {
    medicalAi = {
      clinicalQa: vi.fn().mockResolvedValue({ answer: 'ok' }),
      getDisclaimer: vi.fn().mockResolvedValue('참고용'),
    };
    prisma = { checkupVisit: { findUnique: vi.fn() } };
    service = new CheckupService(prisma, {} as any, { emit: vi.fn() } as any, medicalAi);
  });

  it('🔴 visitId 로 DB 를 실제로 읽는다 — 종전엔 조회조차 하지 않았다', async () => {
    prisma.checkupVisit.findUnique.mockResolvedValue(visit([]));
    await service.suggestFollowupCheckup('v-1');
    expect(prisma.checkupVisit.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v-1' } }),
    );
  });

  it('🔴 결과가 없으면 호출하지 않는다 — 허위 전제로 권고를 만들지 않는다', async () => {
    prisma.checkupVisit.findUnique.mockResolvedValue(visit([]));
    const r: any = await service.suggestFollowupCheckup('v-1');
    expect(medicalAi.clinicalQa).not.toHaveBeenCalled();
    expect(r.recommendation).toBeNull();
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reasonCode).toBe('NO_SOURCE_DATA');
  });

  it('🔴 정상 결과만 있으면 "비정상 소견이 발견되었습니다"라고 말하지 않는다', async () => {
    prisma.checkupVisit.findUnique.mockResolvedValue(visit([
      { category: 'LAB', testName: '공복혈당', value: '92', unit: 'mg/dL', referenceRange: '70-99', finding: 'NORMAL', grade: 'A' },
    ]));
    const r: any = await service.suggestFollowupCheckup('v-1');
    const q = medicalAi.clinicalQa.mock.calls[0][0].question as string;
    expect(q).not.toContain('비정상 소견이 발견되었습니다');
    expect(q).toContain('비정상으로 판정된 항목은 없습니다');
    expect(q).toContain('공복혈당');
    expect(r.abnormalCount).toBe(0);
  });

  it('실제 비정상 항목이 있으면 그 항목만 근거로 보낸다', async () => {
    prisma.checkupVisit.findUnique.mockResolvedValue(visit([
      { category: 'LAB', testName: '공복혈당', value: '156', unit: 'mg/dL', referenceRange: '70-99', finding: 'ABNORMAL', grade: 'C1' },
      { category: 'LAB', testName: '총콜레스테롤', value: '180', unit: 'mg/dL', referenceRange: '0-200', finding: 'NORMAL', grade: 'A' },
    ]));
    const r: any = await service.suggestFollowupCheckup('v-1');
    const q = medicalAi.clinicalQa.mock.calls[0][0].question as string;
    expect(q).toContain('1개 항목이 비정상');
    expect(q).toContain('공복혈당');
    expect(q).toContain('156');
    expect(q).not.toContain('총콜레스테롤'); // 이상 항목만 근거로
    expect(r.abnormalCount).toBe(1);
  });

  it('종합 해석 — 결과도 종합소견도 없으면 호출하지 않는다(종전엔 "결과 미입력"을 보내고도 해석을 받았다)', async () => {
    prisma.checkupVisit.findUnique.mockResolvedValue(visit([]));
    const r: any = await service.interpretCheckupAI('v-1');
    expect(medicalAi.clinicalQa).not.toHaveBeenCalled();
    expect(r.interpretation).toBeNull();
    expect(r.source).toBe('UNAVAILABLE');
  });
});

describe('#4 포털 건강 점수 — 환자에게 지어낸 숫자를 보이지 않는다', () => {
  let medicalAi: any;
  let prisma: any;
  let service: PortalService;

  beforeEach(() => {
    medicalAi = { clinicalQa: vi.fn().mockResolvedValue({ answer: '건강 점수는 82점입니다.' }) };
    prisma = {
      encounter: { count: vi.fn().mockResolvedValue(12), findFirst: vi.fn().mockResolvedValue(null) },
      labResult: { count: vi.fn().mockResolvedValue(30) },
      problemList: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([]) },
    };
    // 🔴 위치 인자 — `as any` 라 순서가 밀려도 tsc 가 못 잡는다(2026-09-02 telehealth 주입 때 실제로 밀렸다).
    // 순서: prisma, config, configRuntime, clinicSchedule, waitingQueue, schedule, allergy, telehealth, medicalAi?
    service = new PortalService(
      prisma, { get: vi.fn() } as any, { get: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, medicalAi,
    );
  });

  it('🔴 AI 를 호출하지 않는다 — 진료·검사 횟수로 0~100 점을 만드는 것은 측정이 아니라 창작이다', async () => {
    const r: any = await service.getHealthScore('pat-1');
    expect(medicalAi.clinicalQa).not.toHaveBeenCalled();
    expect(r.score).toBeNull();
    expect(r.categories).toBeNull(); // 영양·운동·정신건강 배지 = 병원에 자료 없음
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reasonCode).toBe('NO_VALIDATED_INSTRUMENT');
  });

  it('점수 대신 셀 수 있는 사실만 돌려준다', async () => {
    const r: any = await service.getHealthScore('pat-1');
    expect(r.encounterCount).toBe(12);
    expect(r.labCount).toBe(30);
    expect(r.activeProblemCount).toBe(2);
  });

  it('🔴 재진 권고 — 진료도 문제도 없으면 호출하지 않는다', async () => {
    const r: any = await service.getFollowupRecommendation('pat-1');
    expect(medicalAi.clinicalQa).not.toHaveBeenCalled();
    expect(r.recommendation).toBeNull();
    expect(r.source).toBe('UNAVAILABLE');
  });

  it('실제 진료 기록이 있으면 그 기록을 근거로 보낸다', async () => {
    prisma.encounter.findFirst.mockResolvedValue({ createdAt: new Date('2026-07-01'), chiefComplaint: '어지럼', assessment: '기립성 저혈압' });
    const r: any = await service.getFollowupRecommendation('pat-1');
    const q = medicalAi.clinicalQa.mock.calls[0][0].question as string;
    expect(q).toContain('2026-07-01');
    expect(q).toContain('어지럼');
    expect(r.source).toBe('AI');
  });
});

const PID = '11111111-1111-4111-8111-111111111111';
const DR = { role: 'DOCTOR' };

describe('#5 /재입원 — 나이·성별·재원일수를 상수로 박지 않는다', () => {
  let service: MedicalAiService;
  let prisma: any;
  let predictSpy: any;

  beforeEach(() => {
    const config = { get: vi.fn((k: string, d?: any) => d) };
    const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    prisma = {
      systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findUnique: vi.fn() },
      admission: { findFirst: vi.fn() },
    };
    service = new MedicalAiService(config as any, runtime as any, prisma as any);
    predictSpy = vi.spyOn(service, 'predictReadmission').mockResolvedValue({ risk_level: 'HIGH' } as any);
  });

  it('🔴 환자 컨텍스트가 없으면 예측하지 않는다', async () => {
    const r: any = await service.processCommand('/재입원 심부전,만성신부전', null, DR);
    expect(predictSpy).not.toHaveBeenCalled();
    // 맥락이 없으면 AI 를 부르지 않고 이유 코드로 말한다(문장은 화면이 만든다)
    expect(r).toMatchObject({ type: 'notice', source: null, reason: 'PATIENT_REQUIRED' });
  });

  it('🔴 생년월일이 없으면 예측하지 않는다 — 65세로 메우지 않는다', async () => {
    prisma.patient.findUnique.mockResolvedValue({ id: PID, dateOfBirth: null, gender: 'MALE' });
    const r: any = await service.processCommand('/재입원 심부전', { patientId: PID }, DR);
    expect(predictSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ type: 'notice', source: null, reason: 'READMISSION_NO_DOB' });
  });

  it('🔴 성별 미상을 남성으로 접지 않는다', async () => {
    prisma.patient.findUnique.mockResolvedValue({ id: PID, dateOfBirth: new Date('1960-03-03'), gender: 'OTHER' });
    const r: any = await service.processCommand('/재입원 심부전', { patientId: PID }, DR);
    expect(predictSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ type: 'notice', source: null, reason: 'READMISSION_NO_SEX' });
  });

  it('🔴 입원 이력이 없으면 재원일수 5일을 만들어내지 않는다', async () => {
    prisma.patient.findUnique.mockResolvedValue({ id: PID, dateOfBirth: new Date('1960-03-03'), gender: 'FEMALE' });
    prisma.admission.findFirst.mockResolvedValue(null);
    const r: any = await service.processCommand('/재입원 심부전', { patientId: PID }, DR);
    expect(predictSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ type: 'notice', source: null, reason: 'READMISSION_NO_ADMISSION' });
  });

  it('🔴 실제 환자·실제 입원건이 있으면 **그 값**으로 예측한다(65/M/5 가 아니다)', async () => {
    prisma.patient.findUnique.mockResolvedValue({ id: PID, dateOfBirth: new Date('1960-03-03'), gender: 'FEMALE' });
    prisma.admission.findFirst.mockResolvedValue({
      id: 'adm-1', admitDate: new Date('2026-08-01T00:00:00Z'), dischargeDate: new Date('2026-08-12T00:00:00Z'),
    });
    const r: any = await service.processCommand('/재입원 심부전,만성신부전', { patientId: PID }, DR);
    expect(predictSpy).toHaveBeenCalledTimes(1);
    const arg = predictSpy.mock.calls[0][0];
    expect(arg.sex).toBe('F');
    expect(arg.age).not.toBe(65);
    expect(arg.age).toBeGreaterThan(60);
    expect(arg.lengthOfStay).toBe(11);
    expect(arg.diagnoses).toEqual(['심부전', '만성신부전']);
    expect(r.basis).toMatchObject({ patientId: PID, sex: 'F', lengthOfStay: 11, admissionId: 'adm-1' });
  });

  it('진단명이 없으면 예측하지 않는다', async () => {
    const r: any = await service.processCommand('/재입원 ', { patientId: PID }, DR);
    expect(predictSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ type: 'notice', source: null, reason: 'ARG_REQUIRED' });
  });
});

describe('정적 가드 — 적발된 리터럴이 다시 들어오면 잡는다', () => {
  // 🔴 주석을 지우고 본다. 안 그러면 **이 결함을 설명한 주석**에 스스로 걸려 빨간불이 상시 켜지고
  //    (실제로 첫 실행에서 그렇게 실패했다) 사람은 곧 이 가드를 무력화한다.
  //    가드가 코드가 아니라 문서를 보고 있으면 그건 가드가 아니다.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const readRaw = (abs: string) => require('fs').readFileSync(abs, 'utf-8') as string;
  const read = (rel: string) =>
    stripComments(readRaw(require('path').join(__dirname, '../../src/modules', rel)));

  it("🔴 lab.service.ts 에 value: 'pending' 이 없다", () => {
    expect(read('lab/lab.service.ts')).not.toMatch(/value:\s*['"]pending['"]/);
  });

  it('🔴 imaging.service.ts 는 vision* 를 부르지 않는다(영상 참조가 없다)', () => {
    const src = read('imaging/imaging.service.ts');
    expect(src).not.toMatch(/medicalAi\.vision(Analyze|StructuredReport|CompareReport)\s*\(/);
  });

  it('🔴 "발견되었습니다" 허위 전제 프롬프트가 없다', () => {
    for (const f of ['lab/lab.service.ts', 'checkup/checkup.service.ts']) {
      expect(read(f)).not.toMatch(/(이상 수치가|비정상 소견이) 발견되었습니다/);
    }
  });

  it('🔴 medical-ai.service.ts 에 예측 입력 상수가 없다', () => {
    const src = read('medical-ai/medical-ai.service.ts');
    expect(src).not.toMatch(/age:\s*65\s*,\s*sex:\s*['"]M['"]/);
    expect(src).not.toMatch(/lengthOfStay:\s*\d+\s*[,}]/);
  });

  it('🔴 portal getHealthScore 는 AI 를 부르지 않는다', () => {
    const src = read('portal/portal.service.ts');
    const body = src.slice(src.indexOf('async getHealthScore('), src.indexOf('async getFollowupRecommendation('));
    expect(body).not.toContain('medicalAi');
  });

  it('🔴 web 포털에 건강 점수 게이지가 남아 있지 않다', () => {
    const p = require('path').join(__dirname, '../../../web/src/app/portal/_health/HealthTab.tsx');
    const src = stripComments(readRaw(p));
    expect(src).not.toContain('AiHealthScoreGauge');
    // 점수 등급 색칠(양호/보통/주의)이 되살아나면 잡는다.
    expect(src).not.toMatch(/pct\s*>=\s*80\s*\?/);
  });
});

void noop;
