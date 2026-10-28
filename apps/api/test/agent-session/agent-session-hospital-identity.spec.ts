import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

/**
 * 🔴 예약 챗(agent-session)의 병원 정체는 정본 system_configs `hospital.*` 의 **DB 행**에서 (2026-09-11).
 *
 * 원 결함: 병원 안내 규칙 응답이 'Hospital RUN'·'서울시 강남구 · 강남역 3번 출구'·'02-1234-5678'·
 *   '평일 09:00 ~ 18:00' 을 말했다(실병원은 가상 가상시 · CMS 진료시간 ~17:30). 상담원 연결·일반 질문 프롬프트는
 *   실병원 값이지만 **상수 사본**이었다(정본이 둘 — P12). 도구 결과 '병원안내' 는 설정 행이 없거나 조회가
 *   실패하면 날조 기관 정보를 모델에 넘겼다.
 *
 * 목은 정본의 실제 반환 모양(`systemConfig.findMany` → 행 배열). 표본은 실병원 값과 **다른** 센티넬.
 */

const FULL = {
  'hospital.name': '센티넬병원',
  'hospital.address': '가상 센티넬로 1',
  'hospital.phone': '02-555-0100',
  'hospital.hours.weekday': '09:00~17:30',
  'hospital.hours.saturday': '09:00~12:30',
};
const FABRICATED = ['Hospital RUN', '02-1234-5678', '09:00~18:00', '09:00 ~ 18:00', '강남역', '서울시 강남구'];
const OLD_CONSTANTS = ['위루비병원', '가상로 126', '02-000-0000'];
const noneOf = (text: string, list: string[]) => { for (const f of list) expect(text, `상수 '${f}' 가 남았습니다`).not.toContain(f); };

function mkPrisma(rows: Record<string, unknown>) {
  return {
    agentSession: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    patient: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    hospitalInfoContent: { findMany: vi.fn().mockResolvedValue([]) }, // CMS 에 해당 안내 없음 → 규칙 응답 경로
    user: { findMany: vi.fn().mockResolvedValue([]) },
    clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    encounter: { findFirst: vi.fn().mockResolvedValue(null) },
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        Object.entries(rows).filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value }))),
    },
  };
}

let medicalAi: any;
const mkSvc = (rows: Record<string, unknown>) => {
  const prisma = mkPrisma(rows);
  medicalAi = {
    enhancedChat: vi.fn().mockResolvedValue({ answer: '안내해 드릴게요. 이 정보는 AI 참고용이며 전문의 상담을 권장합니다.' }),
    orchestrate: vi.fn(),
    generateNaturalResponse: vi.fn(),
  };
  const triage = { extractSymptoms: vi.fn().mockResolvedValue({ symptoms: [], symptomIds: [], matchedTerms: [], matchedSpans: [], normalizedText: '' }), evaluate: vi.fn() };
  return { svc: new AgentSessionService(prisma as never, medicalAi, triage as never, {} as never, {} as never), prisma };
};
const nonSymptom = (svc: AgentSessionService, input: string) =>
  (svc as any).handleNonSymptomInput(input, { patient: {}, reception: {}, recommendations: {} }, { id: 's-1' }, []);

describe('예약 챗 — 병원 안내 규칙 응답은 정본(hospital.* DB 행)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('🔴 ① 진료시간 안내가 설정값을 말한다 — 미설정이면 시간을 지어내지 않는다', async () => {
    const full = await nonSymptom(mkSvc(FULL).svc, '진료시간 알려줘');
    expect(full.response).toContain('평일: 09:00~17:30');
    expect(full.response).toContain('02-555-0100');
    noneOf(full.response, [...FABRICATED, ...OLD_CONSTANTS]);

    const empty = await nonSymptom(mkSvc({}).svc, '진료시간 알려줘');
    expect(empty.response).toContain('등록돼 있지 않아');
    expect(empty.response).not.toMatch(/\d{2}:\d{2}/);
  });

  it('🔴 ② 오시는 길 — 주소·기관명·전화가 설정값이고 서울 지하철 안내가 되살아나지 않는다', async () => {
    const full = await nonSymptom(mkSvc(FULL).svc, '오시는 길 알려줘');
    expect(full.response).toContain('가상 센티넬로 1 (센티넬병원)');
    expect(full.response).toContain('전화: 02-555-0100');
    noneOf(full.response, [...FABRICATED, ...OLD_CONSTANTS]);

    const empty = await nonSymptom(mkSvc({}).svc, '오시는 길 알려줘');
    expect(empty.response).toContain('주소 확인되지 않음');
    noneOf(empty.response, [...FABRICATED, ...OLD_CONSTANTS]);
  });

  it('🔴 ③ 포괄 병원 안내·진료과 안내·응급실 안내·기타 서비스 문의가 날조 기관 정보를 말하지 않는다', async () => {
    const { svc } = mkSvc(FULL);
    const general = await nonSymptom(svc, '병원 안내해줘');
    expect(general.response).toContain('🏥 센티넬병원 안내');
    expect(general.response).toContain('평일: 09:00~17:30');
    expect(general.response).toContain('📍 위치: 가상 센티넬로 1');
    expect(general.response).toContain('📞 대표전화: 02-555-0100');
    noneOf(general.response, [...FABRICATED, ...OLD_CONSTANTS]);

    const dept = await nonSymptom(svc, '무슨 과 있어요?');
    expect(dept.response).toContain('🏥 센티넬병원 진료과 안내');

    const er = await nonSymptom(svc, '응급실 어디야');
    expect(er.response).toContain('대표전화: 02-555-0100');
    noneOf(er.response, FABRICATED);

    const other = await nonSymptom(svc, '링거 맞을 수 있나요');
    expect(other.response).toContain('대표전화(02-555-0100)');
    noneOf(other.response, FABRICATED);

    const parking = await nonSymptom(svc, '주차 어디에 해요');
    noneOf(parking.response, ['02-1234-5678', '내선 9']);
  });

  it('🔴 ④ 상담원 연결 — 대표전화·평일 진료시간이 설정값, 미설정이면 번호·시간 없이', async () => {
    const session = (ctx: any = { patient: {}, reception: {}, recommendations: {} }) => ({ id: 's-1', state: 'IDLE', channel: 'WEB_BOOKING', operatorId: 'op-1', context: ctx, messages: [] });
    const a = mkSvc(FULL);
    a.prisma.agentSession.findUnique.mockResolvedValue(session());
    const full = await a.svc.processMessage('s-1', '상담원 연결해줘');
    expect(full.response).toContain('대표전화: 02-555-0100 (평일 09:00~17:30)');
    expect((full.uiDirective as any).payload[0].label).toBe('전화 02-555-0100');
    noneOf(full.response, [...FABRICATED, ...OLD_CONSTANTS]);

    const b = mkSvc({});
    b.prisma.agentSession.findUnique.mockResolvedValue(session());
    const empty = await b.svc.processMessage('s-1', '상담원 연결해줘');
    expect(empty.response).toContain('대표전화: 확인되지 않음');
    expect(empty.response).not.toMatch(/평일 \d/);
    expect((empty.uiDirective as any).payload[0].label).toBe('전화 문의');
    noneOf(empty.response, [...FABRICATED, '02-555-0100']);
  });

  it('🔴 ⑤ 일반 질문 LLM 프롬프트의 병원 정체·진료시간이 설정값에서 온다(상수 사본 없음)', async () => {
    const { svc } = mkSvc(FULL);
    await (svc as any).handleGeneralQuestion('허리가 아픈데 어느 과로 가요?', { patient: {} }, []);
    const prompt = medicalAi.enhancedChat.mock.calls[0][0] as string;
    expect(prompt).toContain('당신은 센티넬병원의 온라인 상담 예약 AI');
    for (const v of Object.values(FULL)) expect(prompt).toContain(v);
    noneOf(prompt, [...FABRICATED, ...OLD_CONSTANTS]);

    const e = mkSvc({});
    await (e.svc as any).handleGeneralQuestion('허리가 아픈데 어느 과로 가요?', { patient: {} }, []);
    const p2 = medicalAi.enhancedChat.mock.calls[0][0] as string;
    expect(p2).toContain('확인되지 않은 항목');
    expect(p2, '진료시간 미설정인데 프롬프트가 시간을 말합니다').not.toMatch(/\d{2}:\d{2}\s*~\s*\d{2}:\d{2}/);
    noneOf(p2, [...FABRICATED, ...OLD_CONSTANTS]);
  });

  it('🔴 ⑥ 일상 응답 폴백·정체 소개가 설정값을 쓴다', async () => {
    const { svc } = mkSvc(FULL);
    const fallback = await (svc as any).generateCasualResponse('그렇구나', '');
    expect(fallback).toContain('전화 문의: 02-555-0100 (평일 09:00~17:30)');
    noneOf(fallback, [...FABRICATED, ...OLD_CONSTANTS]);
    expect(await (svc as any).generateCasualResponse('너 누구야', '')).toContain('저는 센티넬병원의');

    const e = mkSvc({});
    const f2 = await (e.svc as any).generateCasualResponse('그렇구나', '');
    expect(f2).not.toContain('전화 문의');
    noneOf(f2, [...FABRICATED, '02-555-0100']);
  });

  it('🔴 ⑦ 공개 채널 본인확인 실패·잠금 안내의 접수 창구 번호가 설정값이다(오라클 금지는 유지)', async () => {
    const pub = (ctx: any) => ({ id: 's-9', state: 'IDLE', channel: 'WEB_BOOKING', operatorId: null, context: ctx, messages: [] });
    const a = mkSvc(FULL);
    const ctx: any = { patient: {}, reception: {}, recommendations: {} };
    a.prisma.agentSession.findUnique.mockResolvedValue(pub(ctx));
    const fail = await a.svc.processMessage('s-9', 'P2026-0001 19700101');
    expect(fail.response).toContain('접수 창구(02-555-0100)');
    noneOf(fail.response, OLD_CONSTANTS);
    let last: any;
    for (let i = 0; i < 6; i++) last = await a.svc.processMessage('s-9', 'P2026-0001 19700101');
    expect(last.response).toContain('시도가 많아');
    expect(last.response).toContain('접수 창구(02-555-0100)');

    const b = mkSvc({});
    b.prisma.agentSession.findUnique.mockResolvedValue(pub({ patient: {}, reception: {}, recommendations: {} }));
    const f2 = await b.svc.processMessage('s-9', 'P2026-0001 19700101');
    expect(f2.response).toContain('접수 창구로 문의');
    noneOf(f2.response, ['02-555-0100', '02-1234-5678']);
  });

  it('🔴 ⑧ 도구 결과 "병원안내" — 설정 행이 없어도 날조 기관 정보를 모델에 넘기지 않는다', async () => {
    const { svc, prisma } = mkSvc({ 'hospital.name': '센티넬병원' });
    prisma.agentSession.findUnique.mockResolvedValue({
      id: 's-1', state: 'COLLECTING_SYMPTOMS', channel: 'WEB_BOOKING', operatorId: 'op-1',
      context: { patient: {}, reception: {}, recommendations: {} }, messages: [],
    });
    // LLM-First·세션 챗이 답하지 않아야 오케스트레이터(도구 경로)까지 내려간다
    medicalAi.enhancedChat.mockResolvedValue({ answer: '' });
    medicalAi.chatWithSession = vi.fn().mockResolvedValue({ answer: '' });
    medicalAi.orchestrate
      .mockResolvedValueOnce({ response: '', toolCalls: ['HOSPITAL_INFO_NEEDED'] })
      .mockResolvedValueOnce({ response: '센티넬병원 안내를 도와드릴게요. 더 궁금하신 점 있으세요?' });
    await svc.processMessage('s-1', '그래서요');
    const second = medicalAi.orchestrate.mock.calls.find((c: any[]) => c[1]?.toolResults);
    // 도구 경로에 도달하지 못하면 이 가드는 아무것도 보증하지 않는다 — 도달부터 단언한다
    expect(second, '오케스트레이터 도구 경로(HOSPITAL_INFO_NEEDED)에 도달하지 못했습니다').toBeDefined();
    const info = String(second![1].toolResults['병원안내']);
    expect(info).toContain('센티넬병원');
    expect(info).toContain('확인되지 않은 항목');
    noneOf(info, [...FABRICATED, ...OLD_CONSTANTS, '주소: 서울시']);
  });
});
