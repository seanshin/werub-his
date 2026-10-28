import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConciergeService, buildConciergeSystemPrompt } from '../../src/modules/concierge/concierge.service';

vi.mock('../../src/common/util/ai-egress-fetch', () => ({ aiEgressFetch: vi.fn() }));
import { aiEgressFetch } from '../../src/common/util/ai-egress-fetch';

/**
 * 🔴 AI 컨시어지의 병원 정체는 정본 system_configs `hospital.*` 의 **DB 행**에서 (2026-09-11).
 *
 * 원 결함: 상수 `SYSTEM_PROMPT` 에 이름·주소·전화·진료시간이 박혀 있었고, 진료시간 '평일 09:00~18:00' 은
 *   CMS 정본(평일 ~17:30)과 어긋난 채 환자에게 사실로 나갔다. 상담원 연결·키워드 폴백 문구도 같은 상수였다.
 *
 * 🔴 진료시간이 정본에 없으면 **말하지 않는다** — DEFAULTS 플레이스홀더('09:00~18:00')로도 메우지 않는다.
 *
 * 목은 정본의 실제 반환 모양: `prisma.systemConfig.findMany({ where: { key: { in } } })` → 행 배열.
 * 표본은 실병원 값과 **다른** 센티넬을 쓴다 — 실병원 값을 쓰면 하드코딩이 되살아나도 통과한다.
 */

const FULL = {
  'hospital.name': '센티넬병원',
  'hospital.address': '가상 센티넬로 1',
  'hospital.phone': '02-555-0100',
  'hospital.hours.weekday': '09:00~17:30',
  'hospital.hours.saturday': '09:00~12:30',
};
const FABRICATED = ['Hospital RUN', '02-1234-5678', '09:00~18:00', 'Teheran', '서울시 강남구'];
/** 종전 상수 — 설정값이 이것과 다를 때 이것이 나오면 하드코딩이 살아 있는 것이다 */
const OLD_CONSTANTS = ['위루비병원', '가상로 126', '02-000-0000'];

const S1 = 'ssssssss-ssss-4sss-8sss-ssssssssssss';
const P1 = 'pppppppp-pppp-4ppp-8ppp-pppppppppppp';

function mkPrisma(rows: Record<string, unknown>) {
  return {
    conciergeSession: {
      findFirst: vi.fn(async () => ({ id: S1, patientId: P1, status: 'ACTIVE', startedAt: new Date(), lastActiveAt: new Date(), messages: [] })),
      update: vi.fn(async () => ({})),
    },
    conciergeMessage: { create: vi.fn(async ({ data }: any) => ({ id: 'msg-1', ...data })) },
    patient: { findUnique: vi.fn(async () => ({ familyName: '김', givenName: '환자' })) },
    appointment: { findMany: vi.fn(async () => []) },
    systemConfig: {
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        Object.entries(rows).filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value }))),
    },
  };
}

// 🔴 접속 정본은 의료 AI 서비스 하나 — 컨시어지는 env 를 읽지 않는다. 이 스펙의 관심은 프롬프트 내용이라 정본만 스텁한다.
const AI_STUB = { resolveAiServerTarget: async () => ({ url: 'http://ai.test', headers: {}, enabled: true }) } as never;
const promptSent = () => JSON.parse(vi.mocked(aiEgressFetch).mock.calls[0][2]!.body as string).prompt as string;

describe('AI 컨시어지 — 병원 정체는 정본(hospital.* DB 행)', () => {
  beforeEach(() => {
    vi.mocked(aiEgressFetch).mockReset();
  });

  it('🔴 ① 시스템 프롬프트의 이름·주소·전화·진료시간이 설정값에서 온다(종전 상수가 아니다)', async () => {
    vi.mocked(aiEgressFetch).mockResolvedValue({ ok: true, json: async () => ({ response: '안내해 드릴게요. 더 궁금하시면 말씀해주세요.\n{"track":"A","dataNeeded":[],"actions":[]}' }) } as never);
    await new ConciergeService(mkPrisma(FULL) as never, AI_STUB).bookingChat('진료시간 알려주세요');
    const prompt = promptSent();
    expect(prompt).toContain('당신은 센티넬병원의 AI 컨시어지');
    for (const v of Object.values(FULL)) expect(prompt, `설정값 '${v}' 가 프롬프트에 없습니다`).toContain(v);
    for (const f of [...FABRICATED, ...OLD_CONSTANTS]) expect(prompt, `상수 '${f}' 가 프롬프트에 남았습니다`).not.toContain(f);
  });

  it('🔴 ② 진료시간이 정본에 없으면 프롬프트가 시간을 말하지 않는다 — 미설정이라고 밝히고 추측을 금한다', async () => {
    vi.mocked(aiEgressFetch).mockResolvedValue({ ok: true, json: async () => ({ response: '안내해 드릴게요. 더 궁금하시면 말씀해주세요.\n{"track":"A","dataNeeded":[],"actions":[]}' }) } as never);
    await new ConciergeService(mkPrisma({ 'hospital.name': '센티넬병원', 'hospital.phone': '02-555-0100' }) as never, AI_STUB).bookingChat('진료시간?');
    const prompt = promptSent();
    expect(prompt).not.toMatch(/\d{2}:\d{2}\s*~\s*\d{2}:\d{2}/);
    expect(prompt).toContain('확인되지 않은 항목');
    expect(prompt).toContain('평일 진료시간');
    expect(prompt).toContain('추측');
  });

  it('🔴 ③ 설정 행이 하나도 없으면 DEFAULTS 플레이스홀더로 메우지 않는다', () => {
    const empty = Object.fromEntries(['hospital.name', 'hospital.city', 'hospital.address', 'hospital.phone', 'hospital.hours.weekday', 'hospital.hours.saturday', 'hospital.hours.lunch', 'hospital.hours.closed', 'hospital.emergency'].map((k) => [k, null])) as never;
    const prompt = buildConciergeSystemPrompt(empty);
    expect(prompt).toContain('당신은 이 병원의 AI 컨시어지');
    for (const f of [...FABRICATED, ...OLD_CONSTANTS]) expect(prompt).not.toContain(f);
  });

  it('🔴 ④ 상담원 연결 안내의 대표전화·평일 진료시간이 설정값에서 온다', async () => {
    const r: any = await new ConciergeService(mkPrisma(FULL) as never, AI_STUB).sendMessage(S1, P1, '상담원 연결해 주세요');
    expect(r.content).toContain('대표전화: 02-555-0100 (평일 09:00~17:30)');
    expect(r.richData.actions).toEqual([{ type: 'CALL', label: '전화 연결 02-555-0100' }]);
    for (const f of [...FABRICATED, ...OLD_CONSTANTS]) expect(r.content).not.toContain(f);
  });

  it('🔴 ⑤ 대표전화·진료시간이 미설정이면 상담원 안내가 번호·시간을 지어내지 않는다', async () => {
    const r: any = await new ConciergeService(mkPrisma({}) as never, AI_STUB).sendMessage(S1, P1, '상담원 연결해 주세요');
    expect(r.content).toContain('대표전화: 확인되지 않음');
    expect(r.content).not.toMatch(/평일 \d/);
    expect(r.richData.actions).toEqual([]);
    for (const f of [...FABRICATED, '02-555-0100']) expect(r.content).not.toContain(f);
  });

  it('🔴 ⑥ LLM 이 모두 실패했을 때 규칙 병원 안내도 설정값으로 말한다(진료시간 상수 없음)', async () => {
    vi.mocked(aiEgressFetch).mockResolvedValue({ ok: false, status: 502, json: async () => ({}) } as never);
    const full = await new ConciergeService(mkPrisma(FULL) as never, AI_STUB).bookingChat('진료시간 알려주세요');
    expect(full.source).toBe('FALLBACK');
    expect(full.reply).toContain('🏥 센티넬병원 안내');
    expect(full.reply).toContain('평일: 09:00~17:30');
    expect(full.reply).toContain('가상 센티넬로 1');
    for (const f of [...FABRICATED, ...OLD_CONSTANTS]) expect(full.reply).not.toContain(f);

    vi.mocked(aiEgressFetch).mockClear();
    const empty = await new ConciergeService(mkPrisma({}) as never, AI_STUB).bookingChat('진료시간 알려주세요');
    expect(empty.reply).toContain('진료시간: 확인되지 않음');
    for (const f of [...FABRICATED, ...OLD_CONSTANTS]) expect(empty.reply).not.toContain(f);
  });
});
