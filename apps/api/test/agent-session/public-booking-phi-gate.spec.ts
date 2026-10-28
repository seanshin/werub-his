import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

/**
 * 공개 예약 챗의 PHI 게이트.
 *
 * 🔴 실측 결함(2026-08-19): `/api/v1/booking/*` 은 가드가 없는 공개 EP 인데, 이 서비스가
 *    **MRN 한 줄에 알레르기·활성 문제목록·최근 진료(의사·과)를 반환**하고 있었다.
 *    이름 검색은 최대 5명의 `이름(MRN) 생년 성별` 목록을 냈다(흔한 이름 하나로 남의 등록번호 수집).
 *    본인확인 절차가 전혀 없었고, 무인증이라 감사 인터셉터도 탈락해 조회 기록조차 남지 않았다.
 *
 * 재주입하면 실패한다:
 *   - `isPublicSession` 을 `false` 로 만들면 → '임상정보 미노출' 케이스가 깨진다
 *   - MRN 분기의 공개 게이트를 지우면 → '본인확인 없이는 아무것도' 케이스가 깨진다
 *   - 실패 응답을 사유별로 갈라 놓으면 → '오라클 금지' 케이스가 깨진다
 */
describe('공개 예약 챗 — 본인확인 전에는 PHI 를 내보내지 않는다', () => {
  let service: AgentSessionService;
  let prisma: any;

  const PATIENT = {
    id: 'p-1', mrn: 'P2026-0001', familyName: '김', givenName: '환자',
    dateOfBirth: new Date('1985-03-12T00:00:00.000Z'), gender: 'MALE',
  };

  /** 공개 세션 = operatorId 없음 */
  const publicSession = (state = 'IDLE', context: any = { patient: {}, reception: {}, recommendations: {} }) => ({
    id: '99999999-9999-4999-8999-999999999999', channel: 'WEB_BOOKING', operatorId: null,
    state, context, messages: [],
  });

  beforeEach(() => {
    prisma = {
      agentSession: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      patient: { findFirst: vi.fn().mockResolvedValue(PATIENT), findMany: vi.fn().mockResolvedValue([PATIENT]) },
      allergy: { findMany: vi.fn().mockResolvedValue([{ allergen: '페니실린', severity: 'SEVERE' }]) },
      problemList: { findMany: vi.fn().mockResolvedValue([{ description: '2형 당뇨', status: 'CHRONIC' }]) },
      encounter: { findFirst: vi.fn().mockResolvedValue(null) },
      waitingQueue: { count: vi.fn().mockResolvedValue(0) },
      // 병원 정체 정본(hospital.* DB 행) — 행 없음 = 미설정
      systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new AgentSessionService(
      prisma,
      { } as any, // medicalAi — 이 경로에서 호출되지 않는다
      { extractSymptoms: vi.fn().mockResolvedValue({ symptoms: [], keywords: [], matchedSpans: [] }) } as any,
      { } as any, // holiday
      { } as any, // questionnaire
    );
  });

  const send = async (session: any, message: string) => {
    prisma.agentSession.findUnique.mockResolvedValue(session);
    return service.processMessage(session.id, message);
  };

  it('🔴 MRN 한 줄로는 아무 환자 정보도 나오지 않는다 — 생년월일을 요구한다', async () => {
    const r = await send(publicSession(), 'P2026-0001');

    expect(r.response).toContain('본인확인');
    expect(r.response).toContain('생년월일');
    // 이름·알레르기·문제목록이 한 글자도 나가지 않는다
    expect(r.response).not.toContain('김환자');
    expect(r.response).not.toContain('페니실린');
    expect(r.response).not.toContain('당뇨');
    // 🔴 이 시점에 조회 자체를 하지 않는다(조회하면 존재 여부가 응답 타이밍/분기로 샌다)
    expect(prisma.allergy.findMany).not.toHaveBeenCalled();
    expect(prisma.problemList.findMany).not.toHaveBeenCalled();
  });

  it('🔴 등록번호+생년월일이 맞아도 임상정보는 나가지 않는다', async () => {
    const r = await send(publicSession(), 'P2026-0001 19850312');

    expect(r.response).toContain('김환자');            // 본인확인 통과 — 이름은 확인용으로 보여준다
    expect(r.response).not.toContain('페니실린');       // 그러나 임상정보는 아니다
    expect(r.response).not.toContain('당뇨');
    expect(r.response).not.toContain('마지막 진료');
    expect(r.state).toBe('COLLECTING_SYMPTOMS');
    // uiDirective payload 에도 임상정보가 없다
    const payload = (r.uiDirective as any)?.payload ?? {};
    expect(payload.allergies).toBeUndefined();
    expect(payload.problemList).toBeUndefined();
    expect(payload.lastEncounter).toBeUndefined();
  });

  it('🔴 생년월일이 틀린 것과 등록번호가 없는 것을 구분해 주지 않는다(열거 오라클 금지)', async () => {
    const wrongDob = await send(publicSession(), 'P2026-0001 19700101');
    prisma.patient.findFirst.mockResolvedValue(null);
    const noSuchMrn = await send(publicSession(), 'P2026-9999 19700101');

    expect(wrongDob.response).toBe(noSuchMrn.response);
    expect(wrongDob.response).not.toContain('없습니다\n');
  });

  it('🔴 등록번호+생년월일을 한 줄로 보내도 게이트를 지나간다 — 진입로가 둘이면 안 된다', async () => {
    // 실측 결함: 게이트가 `case IDLE` 안에만 있어, 한 줄로 보낸 메시지는 LLM 오케스트레이터가 먼저 답하고
    // 게이트도 접근 원장도 통째로 우회됐다(state 는 IDLE 그대로였다).
    const r = await send(publicSession(), 'P2026-0001 19850312');

    expect(r.state).toBe('COLLECTING_SYMPTOMS');   // 게이트를 지났다
    expect(r.response).toContain('김환자');
    expect(r.response).not.toContain('페니실린');   // 통과해도 임상정보는 나가지 않는다
  });

  it('🔴 틀린 생년월일을 한 줄로 보내도 같은 실패 응답이다', async () => {
    const r = await send(publicSession(), 'P2026-0001 19700101');
    expect(r.state).toBe('IDENTIFYING_PATIENT');
    expect(r.response).toContain('일치하지 않습니다');
  });

  it('🔴 이름으로 환자를 조회하지 않는다 — 목록이 나가면 남의 등록번호가 샌다', async () => {
    const r = await send(publicSession(), '김환자');

    expect(prisma.patient.findMany).not.toHaveBeenCalled();
    expect(r.response).not.toContain('P2026-0001');
    expect(r.response).toContain('등록번호');
  });

  it('본인확인 시도 상한을 넘으면 그 대화에서는 조회를 중단한다', async () => {
    prisma.patient.findFirst.mockResolvedValue(null);
    const ctx: any = { patient: {}, reception: {}, recommendations: {} };
    const session = publicSession('IDLE', ctx);

    let last: any;
    for (let i = 0; i < 6; i++) last = await send(session, 'P2026-0001 19700101');

    expect(last.response).toContain('시도가 많아');
    expect(ctx.verify.locked).toBe(true);
  });

  it('본인확인 성공·실패가 세션에 기록된다 — 무인증이라 AuditLog(User FK)에 담을 수 없다', async () => {
    const ctx: any = { patient: {}, reception: {}, recommendations: {} };
    const session = publicSession('IDLE', ctx);

    await send(session, 'P2026-0001 19850312');

    expect(ctx.verify.history.at(-1)).toMatchObject({ result: 'OK', patientId: 'p-1' });
    expect(ctx.verify.history.at(-1).at).toEqual(expect.any(String));
  });

  describe('세션 조회 — 공개 EP 가 context 를 그대로 돌려주지 않는다', () => {
    const withPhi = {
      ...publicSession(),
      context: {
        patient: { verified: true, id: 'p-1', mrn: 'P2026-0001', familyName: '김', givenName: '환자',
          allergies: ['페니실린'], problemList: ['2형 당뇨(CHRONIC)'], lastEncounter: { doctor: '이의사' } },
      },
      messages: [{ role: 'agent', content: '✅ 기존 환자 발견' }],
    };

    it('🔴 세션 ID 만 알면 알레르기·문제목록을 읽을 수 있던 것을 막는다', async () => {
      prisma.agentSession.findUnique.mockResolvedValue(withPhi);

      const r: any = await service.getSession(withPhi.id);

      expect(JSON.stringify(r)).not.toContain('페니실린');
      expect(JSON.stringify(r)).not.toContain('당뇨');
      expect(JSON.stringify(r)).not.toContain('P2026-0001');
      expect(r.context).toEqual({ patient: { verified: true } }); // 통과 사실만
      expect(r.state).toBeDefined();  // 대화에 필요한 것은 준다
      expect(r.messages).toBeDefined();
    });

    it('직원 세션은 종전대로 전체를 돌려준다', async () => {
      prisma.agentSession.findUnique.mockResolvedValue({ ...withPhi, operatorId: 'staff-1' });

      const r: any = await service.getSession(withPhi.id);

      expect(r.context.patient.allergies).toEqual(['페니실린']);
    });
  });

  it('직원 세션(operatorId 있음)은 종전대로 동작한다 — 이 게이트가 내부 업무를 막지 않는다', async () => {
    const staff = { ...publicSession(), operatorId: 'staff-1' };
    const r = await send(staff, 'P2026-0001');

    // 직원 경로는 MRN 만으로 환자 카드를 받는다(임상정보 포함)
    expect(r.response).toContain('김환자');
    expect(prisma.allergy.findMany).toHaveBeenCalled();
  });
});
