import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordTimelineService } from '../../src/modules/record-timeline/record-timeline.service';

/**
 * 임상 기록 통합 시계열 — 트랙 확장(2026-07-30) 계약.
 * 핵심 규약: 최신순 정렬 · at 필드는 "의료진이 알게 된 시점" 우선 · 입퇴원은 2 point ·
 *           외래 간호(UniversalNursingNote) 포함 · 절단은 truncatedTracks 로 보고.
 */
describe('RecordTimelineService.getPatientTimeline', () => {
  let svc: RecordTimelineService;
  let prisma: any;
  const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });

  beforeEach(() => {
    prisma = {
      encounter: { findMany: vi.fn().mockResolvedValue([
        { id: 'e1', createdAt: new Date('2026-03-01'), signedAt: new Date('2026-03-02'), status: 'SIGNED', visitType: 'OUTPATIENT', chiefComplaint: '두통', subjective: 's', objective: null, assessment: null, plan: 'p', doctor: { familyName: '김', givenName: '의' }, diagnoses: [{ type: 'PRIMARY', diagnosisCode: { code: 'E11', nameKo: '당뇨' } }], _count: { prescriptions: 2 } },
      ]) },
      admission: { findFirst: vi.fn().mockResolvedValue({ id: 'a1', admitDate: new Date('2026-02-01'), dischargeDate: new Date('2026-02-10') }), findMany: vi.fn().mockResolvedValue([{ id: 'a1', admitDate: new Date('2026-02-01'), dischargeDate: new Date('2026-02-10'), status: 'DISCHARGED', admitReason: '담낭염', admittingDoctor: { familyName: '정', givenName: '입원' }, attendingDoctor: { familyName: '김', givenName: '주치' } }]) },
      nursingNote: { findMany: vi.fn().mockResolvedValue([
        { id: 'n1', recordedAt: new Date('2026-03-03'), status: 'SIGNED', noteType: 'DAR', shiftType: 'DAY', focus: '통증', priority: 'NORMAL', data: 'd', action: 'a', response: 'r', education: null, subjective: null, objective: null, assessment: null, plan: null, content: null, nurse: { familyName: '박', givenName: '간' } },
      ]) },
      universalNursingNote: { findMany: vi.fn().mockResolvedValue([
        // contextType 은 UniversalNursingNote 의 필수 칸이다 — 목이 비워두면 화면 판정(외래/응급)이 헛돈다
        { id: 'u1', recordedAt: new Date('2026-03-04'), contextType: 'OUTPATIENT', noteType: 'OBSERVATION', situation: null, background: null, assessment: null, recommendation: null, content: '외래 간호', nurse: { familyName: '최', givenName: '간' } },
      ]) },
      labResult: { findMany: vi.fn().mockResolvedValue([
        { id: 'l1', createdAt: new Date('2026-03-05'), collectedAt: new Date('2026-03-05'), completedAt: new Date('2026-03-06'), verifiedAt: new Date('2026-03-07'), verifiedBy: 'u-ver', status: 'COMPLETED', technician: { familyName: '이', givenName: '검사' }, items: [{ testName: 'WBC', value: '12.1', unit: '10^3/uL', flag: 'H', normalMin: 4, normalMax: 10 }, { testName: 'Hb', value: '13', unit: 'g/dL', flag: 'N', normalMin: 13, normalMax: 17 }] },
      ]) },
      imagingResult: { findMany: vi.fn().mockResolvedValue([
        { id: 'i1', createdAt: new Date('2026-03-08'), acquiredAt: new Date('2026-03-08'), reportedAt: new Date('2026-03-09'), status: 'REPORTED', modality: 'XR', bodyPart: '흉부', finding: '우하엽 침윤', impression: '폐렴 의심', radiologistId: 'u-rad' },
      ]) },
      prescription: { findMany: vi.fn().mockResolvedValue([
        { id: 'p1', createdAt: new Date('2026-03-10'), status: 'ACTIVE', type: 'MEDICATION', dosage: '500mg', frequency: 'bid', duration: 3, instructions: null, route: 'PO', prescriberId: 'u-doc', createdBy: 'u-doc', medicationCode: { nameKo: '아목시실린', code: 'A1' } },
      ]) },
      preVisitVitals: { findMany: vi.fn().mockResolvedValue([
        { id: 'v1', measuredAt: new Date('2026-03-11'), isAbnormal: true, systolicBp: 130, diastolicBp: 85, heartRate: 88, temperature: 38.2, spo2: 97, respiratoryRate: 18, painScore: 2, weight: 70, bmi: 22.9, nurseId: 'u-nur' },
      ]) },
      surgery: { findMany: vi.fn().mockResolvedValue([
        { id: 's1', scheduledAt: new Date('2026-03-12'), startedAt: new Date('2026-03-13'), endedAt: null, status: 'COMPLETED', procedureName: '충수절제술', bodySite: '복부', preOpDiagnosis: '충수염', postOpDiagnosis: '충수염', findings: 'f', surgeonId: 'u-sur' },
      ]) },
      progressNote: { findMany: vi.fn().mockResolvedValue([
        { id: 'pn1', createdAt: new Date('2026-02-05'), content: '경과 양호', admissionId: 'a1', doctor: { familyName: '김', givenName: '의' } },
      ]) },
      medicationAdministration: { findMany: vi.fn().mockResolvedValue([
        { id: 'm1', scheduledAt: new Date('2026-02-06T09:00:00Z'), administeredAt: new Date('2026-02-06T09:10:00Z'), status: 'ADMINISTERED', dose: '500mg', route: 'PO', holdReason: null, nurseId: 'u-nur', prescription: { medicationCode: { nameKo: '아목시실린', code: 'A1' } } },
        { id: 'm2', scheduledAt: new Date('2026-02-07T09:00:00Z'), administeredAt: null, status: 'HELD', dose: '500mg', route: 'PO', holdReason: '금식 중', nurseId: 'u-nur', prescription: { medicationCode: { nameKo: '아목시실린', code: 'A1' } } },
      ]) },
      dischargeSummary: { findMany: vi.fn().mockResolvedValue([
        { id: 'ds1', createdAt: new Date('2026-02-10'), status: 'SIGNED', admitDiagnosis: '담낭염', dischargeDiagnosis: '담낭염(수술 후)', hospitalCourse: '경과 양호', followUpPlan: '2주 후 외래', admissionId: 'a1', doctor: { familyName: '김', givenName: '의' } },
      ]) },
      /**
       * AI 제안 — 🔴 목은 **정본이 실제로 돌려주는 모양**이다. 서비스는 `select` 로 부르므로
       * 본문(contentEnc)은 애초에 오지 않고, `transitions` 는 배열(최근 1건)로 온다.
       * 세 행은 `at` 규약의 세 갈래(결정됨 / 노출만 됨 / 생성만 됨)를 각각 겨눈다.
       * 시각은 다른 트랙보다 앞(1월)에 둔다 — 기존 최신순 계약을 흔들지 않기 위해서다.
       */
      aiProposal: { findMany: vi.fn().mockResolvedValue([
        { id: 'ap-decided', kind: 'SOAP_DRAFT', status: 'EDITED', source: 'AI', reasonCode: null,
          targetType: 'Encounter', targetId: 'e1', targetKey: null, modelRef: 'qwen2.5:14b', promptVersion: 'v3',
          version: 1, supersedesId: null, editDistance: 12, rejectReason: null,
          createdAt: new Date('2026-01-10T00:00:00Z'), presentedAt: new Date('2026-01-10T00:01:00Z'),
          decidedAt: new Date('2026-01-10T00:05:00Z'), decidedBy: 'u-doc',
          transitions: [{ fromStatus: 'PRESENTED', toStatus: 'EDITED', at: new Date('2026-01-10T00:05:00Z'), actorId: 'u-doc', reason: null }] },
        { id: 'ap-presented', kind: 'NURSING_DRAFT', status: 'PRESENTED', source: 'FALLBACK', reasonCode: 'TIMEOUT',
          targetType: 'NursingNote', targetId: 'n1', targetKey: null, modelRef: null, promptVersion: null,
          version: 1, supersedesId: null, editDistance: null, rejectReason: null,
          createdAt: new Date('2026-01-09T00:00:00Z'), presentedAt: new Date('2026-01-09T00:02:00Z'),
          decidedAt: null, decidedBy: null,
          transitions: [{ fromStatus: 'GENERATED', toStatus: 'PRESENTED', at: new Date('2026-01-09T00:02:00Z'), actorId: null, reason: null }] },
        { id: 'ap-generated', kind: 'REFERRAL_DRAFT', status: 'GENERATED', source: 'AI', reasonCode: null,
          targetType: 'ReferralLetter', targetId: 'r1', targetKey: null, modelRef: 'qwen2.5:14b', promptVersion: 'v1',
          version: 1, supersedesId: null, editDistance: null, rejectReason: null,
          createdAt: new Date('2026-01-08T00:00:00Z'), presentedAt: null, decidedAt: null, decidedBy: null,
          transitions: [] },
      ]) },
      /**
       * 대화(스크라이브) 세션 — 🔴 목은 **정본이 실제로 돌려주는 모양**이다. 서비스가 `select` 로 부르므로
       * 대화 원문(`VoiceUtterance.text`)은 애초에 오지 않고 `transcript`(세그먼트 Json)·`draftSnapshot` 만 온다.
       * 두 행은 경로 두 갈래를 겨눈다: AMBIENT(발화 단위 저장·반영됨) / RECORDING(발화 수라는 축이 없다).
       */
      scribeSession: { findMany: vi.fn().mockResolvedValue([
        { id: 'sc-ambient', encounterId: 'e1', doctorId: 'u-doc', status: 'APPLIED', source: 'AMBIENT',
          sttTier: 'GPU_CHUNK', resolverKind: 'EMBEDDING', aiModel: 'qwen2.5:14b', aiPromptVersion: 'v3',
          transcript: [{ speaker: 'DOCTOR', start: 0, end: 2, text: '어디가 불편하세요' }], audioPath: null, audioDeletedAt: null,
          legalHold: false, draftSnapshot: { appliedFields: { subjective: '두통 3일', plan: '경과 관찰' } },
          createdAt: new Date('2026-01-05T00:00:00Z'), updatedAt: new Date('2026-01-05T00:30:00Z') },
        { id: 'sc-recording', encounterId: 'e1', doctorId: 'u-doc', status: 'TRANSCRIBED', source: 'RECORDING',
          sttTier: null, resolverKind: null, aiModel: null, aiPromptVersion: null,
          transcript: null, audioPath: null, audioDeletedAt: new Date('2026-01-06T00:00:00Z'),
          legalHold: false, draftSnapshot: null,
          createdAt: new Date('2026-01-04T00:00:00Z'), updatedAt: new Date('2026-01-04T00:10:00Z') },
      ]) },
      voiceUtterance: {
        // 🔴 정본은 groupBy 2쿼리로 묻는다(세션마다 묻지 않는다). `_sum` 이 전부 null 이면 Prisma 는 null 을 돌려준다
        groupBy: vi.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where?.deleted
            ? [{ sessionId: 'sc-ambient', _count: { _all: 1 } }]
            : [{ sessionId: 'sc-ambient', _count: { _all: 4 }, _sum: { droppedSec: 1.5 } }])),
      },
      user: { findMany: vi.fn().mockResolvedValue([
        { id: 'u-ver', familyName: '한', givenName: '확정' },
        { id: 'u-rad', familyName: '오', givenName: '판독' },
        { id: 'u-doc', familyName: '김', givenName: '의사' },
        { id: 'u-nur', familyName: '박', givenName: '간호' },
        { id: 'u-sur', familyName: '최', givenName: '집도' },
      ]) },
    };
    svc = new RecordTimelineService(prisma);
  });

  it('전 트랙 병합 — 최신순 정렬(FE 재정렬 불요)', async () => {
    const r = await svc.getPatientTimeline('p1', {});
    const times = r.items.map((i: any) => new Date(i.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(r.items[0].type).toBe('SURGERY'); // 03-13 startedAt 이 최신
  });

  it('트랙별 counts + 등재 트랙 목록 반환', async () => {
    const r = await svc.getPatientTimeline('p1', {});
    expect(r.counts).toMatchObject({ encounter: 1, nursing: 2, lab: 1, imaging: 1, prescription: 1, vitals: 1, surgery: 1, admission: 2 });
    expect(r.tracks.map((t) => t.type)).toContain('LAB');
  });

  it('at 규약 — 검사는 verifiedAt, 영상은 reportedAt, 수술은 startedAt 우선', async () => {
    const r = await svc.getPatientTimeline('p1', {});
    const at = (t: string) => new Date((r.items.find((i: any) => i.type === t) as any).at).toISOString().slice(0, 10);
    expect(at('LAB')).toBe('2026-03-07');      // collectedAt/completedAt 아님
    expect(at('IMAGING')).toBe('2026-03-09');  // acquiredAt 아님
    expect(at('SURGERY')).toBe('2026-03-13');  // scheduledAt 아님
    expect(at('ENCOUNTER')).toBe('2026-03-02'); // signedAt
  });

  it('입원/퇴원은 각각 별 항목(한 Admission → 2 point)', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['ADMISSION'] });
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i: any) => i.subType)).toEqual(['DISCHARGE', 'ADMIT']); // 최신순
    expect((r.items[0] as any).admissionId).toBe('a1');
  });

  it('🔴 외래 간호기록(UniversalNursingNote) 포함 — 종전 누락 봉합', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['NURSING'] });
    const opd = r.items.find((i: any) => i.outpatient);
    expect(opd).toBeDefined();
    expect((opd as any).content).toBe('외래 간호');
  });

  /**
   * 🔴 종전 계약은 "admissionId 지정 시 universal 을 조회하지 않는다" 였다. 그 결과
   *    정본 경계를 우회해 새어나간 기록(contextType='INPATIENT' 등)이 **입원 화면에서 영구히 안 보였다**.
   *    지금 계약: 조회하되 범위를 (컨텍스트 직결 OR 재원 기간) 으로 좁힌다 — ENCOUNTER 트랙과 같은 규칙.
   */
  it('입원 지정 시에도 범용 간호기록을 읽되 범위를 좁힌다(컨텍스트 직결 OR 재원 기간)', async () => {
    await svc.getPatientTimeline('p1', { types: ['NURSING'], admissionId: 'a1' });
    expect(prisma.universalNursingNote.findMany).toHaveBeenCalled();
    const where = prisma.universalNursingNote.findMany.mock.calls[0][0].where;
    expect(where.patientId).toBe('p1');
    expect(where.OR).toEqual([
      { contextId: 'a1' },
      { recordedAt: { gte: new Date('2026-02-01'), lte: new Date('2026-02-10') } },
    ]);
  });

  it('검사 이상치 개수 산출(flag N 은 제외)', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['LAB'] });
    expect((r.items[0] as any).abnormalCount).toBe(1);
  });

  it('활력은 혈압을 수축/이완 문자열로 조립', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['VITALS'] });
    expect((r.items[0] as any).vitals).toMatchObject({ bp: '130/85', temp: 38.2 });
  });

  it('types 필터 — 미선택 트랙은 쿼리조차 하지 않음', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['ENCOUNTER'] });
    expect(prisma.labResult.findMany).not.toHaveBeenCalled();
    expect(prisma.imagingResult.findMany).not.toHaveBeenCalled();
    expect(r.items.every((i: any) => i.type === 'ENCOUNTER')).toBe(true);
  });

  it('limit 적용 + hasMore/total 보고(무제한 로드 방지)', async () => {
    const r = await svc.getPatientTimeline('p1', { limit: 3 });
    expect(r.items).toHaveLength(3);
    expect(r.total).toBeGreaterThan(3);
    expect(r.hasMore).toBe(true);
  });

  it('입원 없으면 입원 간호 0건(에러 없이)', async () => {
    prisma.admission.findMany.mockResolvedValue([]);
    const r = await svc.getPatientTimeline('p1', { types: ['NURSING'] });
    expect(prisma.nursingNote.findMany).not.toHaveBeenCalled();
    expect(r.items.every((i: any) => i.outpatient)).toBe(true); // 외래분만 남음
  });

  it('트랙 상한 도달 시 truncatedTracks 로 보고(조용한 절단 금지)', async () => {
    const many = Array.from({ length: 400 }, (_, k) => ({
      id: `x${k}`, createdAt: new Date('2026-01-01'), signedAt: null, status: 'SIGNED', visitType: 'OUTPATIENT',
      chiefComplaint: null, subjective: null, objective: null, assessment: null, plan: null,
      doctor: null, diagnoses: [], _count: { prescriptions: 0 },
    }));
    prisma.encounter.findMany.mockResolvedValue(many);
    const r = await svc.getPatientTimeline('p1', { types: ['ENCOUNTER'] });
    expect(r.truncatedTracks).toContain('ENCOUNTER');
  });

  it('빈 환자 — 전 트랙 0건에도 정상 응답', async () => {
    Object.assign(prisma, {
      encounter: empty(), admission: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }, nursingNote: empty(), universalNursingNote: empty(),
      labResult: empty(), imagingResult: empty(), prescription: empty(), preVisitVitals: empty(), surgery: empty(),
      progressNote: empty(), medicationAdministration: empty(), dischargeSummary: empty(), aiProposal: empty(),
      scribeSession: empty(),
    });
    const r = await svc.getPatientTimeline('p1', {});
    expect(r.items).toHaveLength(0);
    expect(r.hasMore).toBe(false);
    expect(r.truncatedTracks).toEqual([]);
  });

  describe('노이즈 제거(2026-07-30 실측 반영)', () => {
    it('내용 없는 임시저장(DRAFT)은 시간축에서 제외 — 진료 시작만 한 껍데기', async () => {
      prisma.encounter.findMany.mockResolvedValue([
        { id: 'draft', createdAt: new Date('2026-07-30'), signedAt: null, status: 'DRAFT', visitType: 'OUTPATIENT', chiefComplaint: null, subjective: null, objective: null, assessment: null, plan: null, doctor: null, diagnoses: [], _count: { prescriptions: 0 } },
      ]);
      const r = await svc.getPatientTimeline('p1', { types: ['ENCOUNTER'] });
      expect(r.items).toHaveLength(0);
    });

    it('내용이 있는 DRAFT 는 유지(작성 중 기록도 경과의 일부)', async () => {
      prisma.encounter.findMany.mockResolvedValue([
        { id: 'draft2', createdAt: new Date('2026-07-30'), signedAt: null, status: 'DRAFT', visitType: 'OUTPATIENT', chiefComplaint: '기침', subjective: null, objective: null, assessment: null, plan: null, doctor: null, diagnoses: [], _count: { prescriptions: 0 } },
      ]);
      const r = await svc.getPatientTimeline('p1', { types: ['ENCOUNTER'] });
      expect(r.items).toHaveLength(1);
    });

    it('처방 트랙은 LAB/IMAGING 오더 캐리어를 제외(검사·영상 트랙과 이중 표시 금지)', async () => {
      await svc.getPatientTimeline('p1', { types: ['PRESCRIPTION'] });
      const where = prisma.prescription.findMany.mock.calls[0][0].where;
      expect(where.type).toEqual({ notIn: ['LAB', 'IMAGING'] });
    });
  });

  describe('작성자·상세 자료(2026-07-30)', () => {
    it('트랙별 수행 주체를 역할과 함께 노출 — 관계 없는 스칼라 FK 도 배치 조회', async () => {
      const r = await svc.getPatientTimeline('p1', {});
      const by = (t: string) => r.items.find((i: any) => i.type === t) as any;
      expect(by('LAB')).toMatchObject({ author: '이검사', authorRole: '검사', verifier: '한확정' });
      expect(by('IMAGING')).toMatchObject({ author: '오판독', authorRole: '판독' });
      expect(by('PRESCRIPTION')).toMatchObject({ author: '김의사', authorRole: '처방' });
      expect(by('VITALS')).toMatchObject({ author: '박간호', authorRole: '측정' });
      expect(by('SURGERY')).toMatchObject({ author: '최집도', authorRole: '집도' });
      expect(by('ADMISSION')).toMatchObject({ author: '김주치', authorRole: '주치의' });
      expect(by('ENCOUNTER').author).toBe('김의');
    });

    it('사용자 이름 조회는 1쿼리(N+1 금지)', async () => {
      await svc.getPatientTimeline('p1', {});
      // 이름 조회가 필요한 트랙 8개(검사·영상·처방·활력·수술·투약실행·AI제안·대화)가 각 1회 —
      // **항목 수와 무관**하게 상수(AI 제안은 결정자+전이 주체를 한 번에, 대화는 세션 주체를 한 번에 모아 부른다)
      expect(prisma.user.findMany).toHaveBeenCalledTimes(8);
      for (const call of prisma.user.findMany.mock.calls) {
        expect(Array.isArray(call[0].where.id.in)).toBe(true);
      }
    });

    it('상세 자료 링크가 실존 라우트를 가리킨다', async () => {
      const r = await svc.getPatientTimeline('p1', {});
      const link = (t: string) => (r.items.find((i: any) => i.type === t) as any).link as string;
      expect(link('SURGERY')).toBe('/surgery/s1');           // (main)/surgery/[id]
      expect(link('ADMISSION')).toBe('/inpatient/a1');       // (main)/inpatient/[admissionId]
      expect(link('LAB')).toBe('/patients/p1?tab=labresults'); // 차트 탭 딥링크
      expect(link('IMAGING')).toBe('/patients/p1?tab=imaging');
      expect(link('PRESCRIPTION')).toBe('/patients/p1?tab=medications');
    });

    it('검사 항목에 참고범위를 동봉(상세 펼침용)', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['LAB'] });
      expect((r.items[0] as any).results[0]).toMatchObject({ name: 'WBC', refLow: 4, refHigh: 10, flag: 'H' });
    });

    it('활력 상세에 체중·BMI 포함', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['VITALS'] });
      expect((r.items[0] as any).vitals).toMatchObject({ weight: 70, bmi: 22.9 });
    });
  });

  describe('단건 상세(getRecordDetail) — 그 기록만', () => {
    it('진료 상세는 처방 목록까지 동봉(차트 전체 목록을 열 필요 없게)', async () => {
      prisma.encounter.findFirst = vi.fn().mockResolvedValue({
        id: 'e1', createdAt: new Date('2026-03-01'), signedAt: new Date('2026-03-02'), status: 'SIGNED',
        visitType: 'OUTPATIENT', chiefComplaint: '두통', subjective: 's', objective: null, assessment: null, plan: 'p',
        doctor: { familyName: '김', givenName: '의' },
        diagnoses: [{ type: 'PRIMARY', diagnosisCode: { code: 'E11', nameKo: '당뇨' } }],
        prescriptions: [{ id: 'p1', type: 'MEDICATION', dosage: '500mg', frequency: 'bid', duration: 3, status: 'ACTIVE', medicationCode: { nameKo: '아목시실린', code: 'A1' } }],
      });
      const r: any = await svc.getRecordDetail('p1', 'ENCOUNTER', 'e1');
      expect(r).toMatchObject({ type: 'ENCOUNTER', author: '김의', authorRole: '진료' });
      expect(r.orders[0]).toMatchObject({ name: '아목시실린', dosage: '500mg' });
      // 소유 검증이 where 에 포함(타 환자 기록 열람 차단)
      expect(prisma.encounter.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'e1', patientId: 'p1' });
    });

    it('입퇴원 상세는 id 접미(:in/:out)로 입원/퇴원을 구분하고 재원일수·병상을 계산', async () => {
      prisma.admission.findFirst = vi.fn().mockResolvedValue({
        id: 'a1', admitDate: new Date('2026-02-01'), dischargeDate: new Date('2026-02-10'), status: 'DISCHARGED',
        admitReason: '담낭염', admittingDoctor: { familyName: '정', givenName: '입원' }, attendingDoctor: { familyName: '김', givenName: '주치' },
        bed: { roomNumber: '501', bedNumber: 'A', ward: { name: '5병동' } },
      });
      const out: any = await svc.getRecordDetail('p1', 'ADMISSION', 'a1:out');
      expect(out).toMatchObject({ subType: 'DISCHARGE', stayDays: 9, bed: '5병동 501-A', author: '김주치' });
      const inn: any = await svc.getRecordDetail('p1', 'ADMISSION', 'a1:in');
      expect(inn.subType).toBe('ADMIT');
    });

    it('없는 기록은 404', async () => {
      prisma.labResult.findFirst = vi.fn().mockResolvedValue(null);
      await expect(svc.getRecordDetail('p1', 'LAB', 'nope')).rejects.toMatchObject({ status: 404 });
    });

    it('지원하지 않는 유형은 400', async () => {
      await expect(svc.getRecordDetail('p1', 'BOGUS', 'x')).rejects.toMatchObject({ status: 400 });
    });

    it('간호 상세는 입원 노트 → 외래 노트 순으로 조회(모델 이원화 흡수)', async () => {
      prisma.nursingNote.findFirst = vi.fn().mockResolvedValue(null);
      prisma.universalNursingNote.findFirst = vi.fn().mockResolvedValue({
        id: 'u1', recordedAt: new Date('2026-03-04'), noteType: 'OPD', content: '외래 간호', nurse: { familyName: '최', givenName: '간' },
      });
      const r: any = await svc.getRecordDetail('p1', 'NURSING', 'u1');
      expect(r).toMatchObject({ outpatient: true, content: '외래 간호' });
    });
  });

  describe('신규 트랙·커서(2026-07-30)', () => {
    it('경과기록·투약실행·퇴원요약이 트랙으로 등재된다', async () => {
      const r = await svc.getPatientTimeline('p1', {});
      expect(r.tracks.map((t) => t.type)).toEqual(expect.arrayContaining(['PROGRESS_NOTE', 'MAR', 'DISCHARGE_SUMMARY']));
      expect(r.counts).toMatchObject({ progress_note: 1, mar: 2, discharge_summary: 1 });
    });

    /* ───────── 12번째 트랙: AI 제안(2026-09-09 · 기획 §2.3) ───────── */

    it('AI_PROPOSAL 이 트랙으로 등재되고 환자별로 집계된다', async () => {
      const r = await svc.getPatientTimeline('p1', {});
      expect(r.tracks.map((t) => t.type)).toContain('AI_PROPOSAL');
      expect(r.counts).toMatchObject({ ai_proposal: 3 });
    });

    /**
     * 🔴 `at` = **알게 된 시점** 규약: decidedAt → presentedAt → createdAt.
     *    생성만 된 제안(사람이 본 적 없는 것)을 결정 시각처럼 그리면 검토 이력을 지어내게 된다.
     *    그래서 어느 시각을 썼는지(`atBasis`)를 함께 낸다.
     */
    it('🔴 AI 제안의 at 은 decidedAt → presentedAt → createdAt 이고, 근거를 밝힌다', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['AI_PROPOSAL'] });
      const by = (id: string) => r.items.find((i: any) => i.id === id) as any;

      expect(new Date(by('ap-decided').at).toISOString()).toBe('2026-01-10T00:05:00.000Z');
      expect(by('ap-decided').atBasis).toBe('DECIDED');

      // 결정 전이면 노출 시각 — 생성 시각(00:00)이 아니다
      expect(new Date(by('ap-presented').at).toISOString()).toBe('2026-01-09T00:02:00.000Z');
      expect(by('ap-presented').atBasis).toBe('PRESENTED');

      // 노출조차 안 된 제안은 생성 시각이고, 그 사실을 감추지 않는다
      expect(new Date(by('ap-generated').at).toISOString()).toBe('2026-01-08T00:00:00.000Z');
      expect(by('ap-generated').atBasis).toBe('CREATED');
      expect(by('ap-generated').presentedAt, '사람이 본 적 없다').toBeNull();
    });

    /**
     * 🔴 본문(초안 내용)의 정본은 `AiProposal` 하나다. 시계열이 사본을 들면 정본이 둘이 된다 —
     *    그래서 조회 자체가 본문 칸을 **select 하지 않는지**까지 본다(응답만 봐서는
     *    "목이 안 줬을 뿐"과 구분되지 않는다).
     */
    it('🔴 AI 제안 항목에 초안 본문이 없다 — select 단계에서 본문을 부르지 않는다', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['AI_PROPOSAL'] });
      const sel = prisma.aiProposal.findMany.mock.calls.at(-1)[0].select;
      expect(sel.contentEnc, '암호문을 부르지 않는다').toBeUndefined();
      expect(sel.contentHash, '본문 해시도 시계열의 일이 아니다').toBeUndefined();
      const dumped = JSON.stringify(r.items);
      expect(dumped).not.toContain('contentEnc');
      expect(dumped).not.toContain('content"');
    });

    it('요약만 싣는다 — 편집거리·모델·결정자·거부사유와 정본 참조', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['AI_PROPOSAL'] });
      const decided = r.items.find((i: any) => i.id === 'ap-decided') as any;
      expect(decided.title).toBe('진료기록(SOAP) 초안 · 수정 후 수용'); // shared 라벨 정본
      expect(decided.editDistance).toBe(12);
      expect(decided.modelRef).toBe('qwen2.5:14b');
      expect(decided.author).toBe('김의사');            // decidedBy 이름 해석
      expect(decided.targetType).toBe('Encounter');
      expect(decided.targetId).toBe('e1');
      expect(decided.lastTransition).toMatchObject({ from: 'PRESENTED', to: 'EDITED', actor: '김의사' });
    });

    /** 🔴 재지 않은 수정량은 `null` 이다 — 0 으로 접으면 "안 고치고 수용했다"는 다른 사실이 된다 */
    it('🔴 수정량을 재지 않은 건은 0 이 아니라 null 이다', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['AI_PROPOSAL'] });
      const pres = r.items.find((i: any) => i.id === 'ap-presented') as any;
      expect(pres.editDistance).toBeNull();
      expect(pres.editDistance).not.toBe(0);
      // 규칙이 대신 답한 것을 AI 라 부르지 않는다(3상태를 그대로 나른다)
      expect(pres.source).toBe('FALLBACK');
      expect(pres.reasonCode).toBe('TIMEOUT');
    });

    /** 🔴 제안 원장 화면이 아직 없다 — 없는 화면으로 보내는 링크를 그리지 않는다 */
    it('🔴 제안 항목의 링크는 비어 있다(없는 화면을 가리키지 않는다)', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['AI_PROPOSAL'] });
      for (const it of r.items) expect((it as any).link).toBeNull();
    });

    it('투약실행 시각은 실제 투여시각 우선(예정만 있으면 예정시각)', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['MAR'] });
      const done = r.items.find((i: any) => i.id === 'm1') as any;
      const held = r.items.find((i: any) => i.id === 'm2') as any;
      expect(new Date(done.at).toISOString()).toBe('2026-02-06T09:10:00.000Z'); // administeredAt
      expect(new Date(held.at).toISOString()).toBe('2026-02-07T09:00:00.000Z'); // scheduledAt
    });

    it('보류 사유는 그대로 노출(임상적으로 중요한 정보를 숨기지 않음)', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['MAR'] });
      const held = r.items.find((i: any) => i.id === 'm2') as any;
      expect(held.instructions).toBe('금식 중');
      expect(held.status).toBe('HELD');
    });

    it('퇴원요약은 입원/퇴원 진단·경과·추적계획을 담는다', async () => {
      const r = await svc.getPatientTimeline('p1', { types: ['DISCHARGE_SUMMARY'] });
      expect(r.items[0]).toMatchObject({ dischargeDiagnosis: '담낭염(수술 후)', followUpPlan: '2주 후 외래' });
      expect((r.items[0] as any).link).toBe('/inpatient/a1/discharge-summary');
    });

    it('경과기록·퇴원요약은 입원 문맥이라 admissionId 지정 시 그 입원만', async () => {
      await svc.getPatientTimeline('p1', { types: ['PROGRESS_NOTE'], admissionId: 'a1' });
      expect(prisma.progressNote.findMany.mock.calls[0][0].where.admissionId).toEqual({ in: ['a1'] });
    });

    it('커서(before)는 트랙 시간 필드에 **lte** 로 적용된다(동일 시각 유실 방지 — 경계는 병합 후 판정)', async () => {
      const before = '2026-03-05T00:00:00.000Z|zzz';
      await svc.getPatientTimeline('p1', { types: ['ENCOUNTER'], before });
      const where = prisma.encounter.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toMatchObject({ lte: new Date('2026-03-05T00:00:00.000Z') });
    });

    it('nextCursor 는 마지막 표시 항목의 위치(시각+id) — 동일 시각 다수 항목을 구분한다', async () => {
      const r = await svc.getPatientTimeline('p1', { limit: 2 });
      expect(r.hasMore).toBe(true);
      const last = r.items[1] as any;
      expect(r.nextCursor).toBe(`${new Date(last.at).toISOString()}|${last.id}`);
    });

    it('커서로 순회하면 전량이 정확히 한 번씩 나온다(유실·중복 0)', async () => {
      const all = await svc.getPatientTimeline('p1', {});
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 60; guard++) {
        const p = await svc.getPatientTimeline('p1', { limit: 3, before: cursor });
        if (!p.items.length) break;
        seen.push(...p.items.map((i: any) => `${i.type}:${i.id}`));
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      expect(new Set(seen).size).toBe(seen.length);        // 중복 0
      expect(seen.length).toBe(all.items.length);          // 유실 0
    });

    it('마지막 페이지면 nextCursor 는 null', async () => {
      const r = await svc.getPatientTimeline('p1', { limit: 1000 });
      expect(r.hasMore).toBe(false);
      expect(r.nextCursor).toBeNull();
    });
  });

  describe('입원 범위 창(admWindow) — FK 없는 트랙(2026-07-30 검토 보완)', () => {
    it('🔴 검사·활력·투약은 입원 FK 가 없어 재원 기간으로 걸러야 한다(종전 42건 혼입 실측)', async () => {
      await svc.getPatientTimeline('p1', { admissionId: 'a1', types: ['VITALS'] });
      const where = prisma.preVisitVitals.findMany.mock.calls[0][0].where;
      expect(where.measuredAt).toMatchObject({ gte: new Date('2026-02-01'), lte: new Date('2026-02-10') });
    });

    it('재원 중(퇴원일 없음)이면 상한 없이 입원일 이후 전부', async () => {
      prisma.admission.findFirst.mockResolvedValue({ id: 'a1', admitDate: new Date('2026-02-01'), dischargeDate: null });
      await svc.getPatientTimeline('p1', { admissionId: 'a1', types: ['VITALS'] });
      const where = prisma.preVisitVitals.findMany.mock.calls[0][0].where;
      expect(where.measuredAt.gte).toEqual(new Date('2026-02-01'));
      expect(where.measuredAt.lte).toBeUndefined();
    });

    it('검사는 확정/생성 두 시각 필드 모두에 창이 걸린다', async () => {
      await svc.getPatientTimeline('p1', { admissionId: 'a1', types: ['LAB'] });
      const where = prisma.labResult.findMany.mock.calls[0][0].where;
      expect(where.OR[0].verifiedAt).toMatchObject({ gte: new Date('2026-02-01') });
      expect(where.OR[1].createdAt).toMatchObject({ gte: new Date('2026-02-01') });
    });

    it('요청 기간과 재원 기간은 교집합(창을 넓히지 못한다)', async () => {
      await svc.getPatientTimeline('p1', { admissionId: 'a1', types: ['VITALS'], from: new Date('2026-01-01'), to: new Date('2026-02-05') });
      const where = prisma.preVisitVitals.findMany.mock.calls[0][0].where;
      expect(where.measuredAt).toMatchObject({ gte: new Date('2026-02-01'), lte: new Date('2026-02-05') });
    });

    it('타 환자의 입원 id 는 404(소유 검증 — where 에 patientId 동봉)', async () => {
      prisma.admission.findFirst.mockResolvedValue(null);
      await expect(svc.getPatientTimeline('p1', { admissionId: 'a-other' })).rejects.toThrow(/입원 기록/);
      expect(prisma.admission.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'a-other', patientId: 'p1' });
    });


    it('진료·수술 FK(null) 연결 누락은 재원 기간 폴백으로 살린다 — 프로드 실측(입원 진료가 null)', async () => {
      await svc.getPatientTimeline('p1', { admissionId: 'a1', types: ['ENCOUNTER'] });
      const where = prisma.encounter.findMany.mock.calls[0][0].where;
      expect(where.OR[0]).toEqual({ admissionId: 'a1' });
      expect(where.OR[1]).toMatchObject({ admissionId: null, createdAt: { gte: new Date('2026-02-01'), lte: new Date('2026-02-10') } });
    });

    it('FK 있는 트랙(경과기록·퇴원요약)에는 창을 걸지 않는다 — 퇴원 후 작성분이 잘리면 안 됨', async () => {
      await svc.getPatientTimeline('p1', { admissionId: 'a1', types: ['DISCHARGE_SUMMARY'] });
      const where = prisma.dischargeSummary.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toBeUndefined();
      expect(where.admissionId).toEqual({ in: ['a1'] });
    });
  });
});

/**
 * D3 — 대화(스크라이브) 트랙 (2026-09-27 · 기획서 §13.4 D3)
 *
 * 🔴 요약이 **출처를 알되 원문은 들지 않는다**(AI_PROPOSAL 트랙과 같은 규약). 전사 정본은 세션 하나이고
 *    시계열이 사본을 들면 같은 사실에 정본이 둘이 된다.
 * 🔴 발화 수 `null`(RECORDING) 과 `0` 은 다른 사실이다 — '0 발화'라 그리면 "말이 없었다"가 된다.
 * 🔴 누락초 `null` = 재지 않았다 · `0` = 놓친 구간이 없었다.
 */
describe('CONVERSATION 트랙 — 원문 없이 사실만', () => {
  let svc: RecordTimelineService;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      encounter: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]) },
      nursingNote: { findMany: vi.fn().mockResolvedValue([]) },
      universalNursingNote: { findMany: vi.fn().mockResolvedValue([]) },
      labResult: { findMany: vi.fn().mockResolvedValue([]) },
      imagingResult: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      preVisitVitals: { findMany: vi.fn().mockResolvedValue([]) },
      surgery: { findMany: vi.fn().mockResolvedValue([]) },
      progressNote: { findMany: vi.fn().mockResolvedValue([]) },
      medicationAdministration: { findMany: vi.fn().mockResolvedValue([]) },
      dischargeSummary: { findMany: vi.fn().mockResolvedValue([]) },
      aiProposal: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u-doc', familyName: '김', givenName: '의사' }]) },
      scribeSession: { findMany: vi.fn().mockResolvedValue([
        { id: 'sc-ambient', encounterId: 'e1', doctorId: 'u-doc', status: 'APPLIED', source: 'AMBIENT',
          sttTier: 'GPU_CHUNK', resolverKind: 'EMBEDDING', aiModel: 'qwen2.5:14b', aiPromptVersion: 'v3',
          transcript: [{ speaker: 'DOCTOR', start: 0, end: 2, text: '어디가 불편하세요' }], audioPath: null, audioDeletedAt: null,
          legalHold: true, draftSnapshot: { appliedFields: { subjective: '두통 3일', plan: '경과 관찰' } },
          createdAt: new Date('2026-01-05T00:00:00Z'), updatedAt: new Date('2026-01-05T00:30:00Z') },
        { id: 'sc-recording', encounterId: 'e1', doctorId: 'u-doc', status: 'TRANSCRIBED', source: 'RECORDING',
          sttTier: null, resolverKind: null, aiModel: null, aiPromptVersion: null,
          transcript: null, audioPath: null, audioDeletedAt: null,
          legalHold: false, draftSnapshot: null,
          createdAt: new Date('2026-01-04T00:00:00Z'), updatedAt: new Date('2026-01-04T00:10:00Z') },
      ]) },
      voiceUtterance: {
        groupBy: vi.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where?.deleted
            ? [{ sessionId: 'sc-ambient', _count: { _all: 1 } }]
            : [{ sessionId: 'sc-ambient', _count: { _all: 4 }, _sum: { droppedSec: null } }])),
      },
    };
    svc = new RecordTimelineService(prisma);
  });

  it('🔴 대화 원문·초안 본문이 응답에 실리지 않는다(정본 둘 금지)', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['CONVERSATION'] });
    const json = JSON.stringify(r.items);
    expect(json).not.toContain('어디가 불편하세요'); // 전사 원문
    expect(json).not.toContain('두통 3일');          // 반영된 초안 본문
    expect(json).not.toContain('경과 관찰');
    // 필드 이름(키)은 사실이므로 싣는다 — 무엇이 들어갔는지가 아니라 어디에 들어갔는지다
    expect((r.items.find((i: any) => i.id === 'sc-ambient') as any).appliedFields).toEqual(['subjective', 'plan']);
  });

  it('🔴 발화 수 — 녹음 사후는 0 이 아니라 null(그 축이 없다)', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['CONVERSATION'] });
    const amb = r.items.find((i: any) => i.id === 'sc-ambient') as any;
    const rec = r.items.find((i: any) => i.id === 'sc-recording') as any;
    expect(amb.utterances).toBe(4);
    expect(amb.deletedUtterances).toBe(1);
    expect(rec.utterances, '발화 단위로 저장하지 않는 경로에 0 을 만들었다').toBeNull();
    expect(rec.deletedUtterances).toBeNull();
    // 🔴 세션 수와 무관하게 상수 2쿼리이고, RECORDING 세션 id 는 조회 조건에 들어가지 않는다
    expect(prisma.voiceUtterance.groupBy).toHaveBeenCalledTimes(2);
    for (const call of prisma.voiceUtterance.groupBy.mock.calls) {
      expect(call[0].where.sessionId.in).toEqual(['sc-ambient']);
    }
  });

  it('🔴 누락초 — 잰 적이 없으면 null(0 이 아니다)', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['CONVERSATION'] });
    expect((r.items.find((i: any) => i.id === 'sc-ambient') as any).droppedSec).toBeNull();
  });

  it('대조군 — 실제로 잰 값은 그대로 싣는다(측정을 미측정으로 말하지 않는다)', async () => {
    prisma.voiceUtterance.groupBy = vi.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(where?.deleted ? [] : [{ sessionId: 'sc-ambient', _count: { _all: 4 }, _sum: { droppedSec: 2.25 } }]));
    const r = await svc.getPatientTimeline('p1', { types: ['CONVERSATION'] });
    expect((r.items.find((i: any) => i.id === 'sc-ambient') as any).droppedSec).toBe(2.25);
  });

  it('반영 기록이 없으면 빈 배열이 아니라 null — "0 필드 반영"이 아니다', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['CONVERSATION'] });
    expect((r.items.find((i: any) => i.id === 'sc-recording') as any).appliedFields).toBeNull();
    expect((r.items.find((i: any) => i.id === 'sc-recording') as any).appliedAt).toBeNull();
  });

  it('at = 세션 시작 시각 · 반영 시각은 따로 말한다(둘을 뒤바꾸지 않는다)', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['CONVERSATION'] });
    const amb = r.items.find((i: any) => i.id === 'sc-ambient') as any;
    expect(new Date(amb.at).toISOString()).toBe('2026-01-05T00:00:00.000Z');
    expect(new Date(amb.appliedAt).toISOString()).toBe('2026-01-05T00:30:00.000Z');
    expect(amb.atBasis).toBe('CREATED');
  });

  it('보존명령·전사 보관 상태를 그 자리에서 말한다(파기 축과 같은 사실)', async () => {
    const r = await svc.getPatientTimeline('p1', { types: ['CONVERSATION'] });
    const amb = r.items.find((i: any) => i.id === 'sc-ambient') as any;
    const rec = r.items.find((i: any) => i.id === 'sc-recording') as any;
    expect(amb.legalHold).toBe(true);
    expect(amb.transcriptPresent).toBe(true);
    expect(rec.transcriptPresent, '전사가 없는 세션을 남아 있다고 말했다').toBe(false);
  });

  it('트랙이 등재 목록·counts 에 나온다(FE 필터 칩 정본)', async () => {
    const r = await svc.getPatientTimeline('p1', {});
    expect(r.tracks.map((t) => t.type)).toContain('CONVERSATION');
    expect(r.counts.conversation).toBe(2);
  });
});
