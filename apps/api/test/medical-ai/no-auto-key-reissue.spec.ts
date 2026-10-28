/**
 * 🔴 P0-C R6 — **AI 키를 시스템이 몰래 재발급하지 않는다.**
 *
 * 원 결함(2026-09-09 실측): `refreshApiKeyIfNeeded()` 가 상류 401 을 보면 하드코딩한 조직정보
 * (`'Hospital RUN HIS'` · `admin@hospitalrun.example` — 이 병원은 `위루비병원`이다)로
 * `POST /api/medical/tenant/register` 를 불러 **새 테넌트 키를 발급받아 메모리에 넣었다.** 감사도 승인도 없었다.
 * (호출부는 0곳이었다 — 정의만 있고 아무도 부르지 않던 코드다.)
 *
 * 계약: 자동 재발급 경로가 존재하지 않는다 + 401/403 은 `UNAVAILABLE`/`UPSTREAM_AUTH` 로 **말한다**
 *       (재시도로 풀리는 "서버 오류"와 다른 사실이다 — 사람이 키를 교체해야 한다).
 *
 * 재주입 역검증(수동 확인함): `upstreamFailedSkill` 을 `failedSkill(..., 'UPSTREAM_ERROR')` 로 되돌리면 ①이 실패하고,
 *   서비스 소스에 `tenant/register` 호출을 되살리면 ③이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

const PID = 'pat-1';
const mk = () => {
  const config = { get: vi.fn((_k: string, d?: any) => d) };
  const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
  const prisma: any = {
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: new Date('1975-01-01'), gender: 'FEMALE', familyName: '김', givenName: '영희' }) },
    allergy: { findMany: vi.fn().mockResolvedValue([]) },
    problemList: { findMany: vi.fn().mockResolvedValue([]) },
    prescription: { findMany: vi.fn().mockResolvedValue([]) },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
    orderSet: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const service = new MedicalAiService(config as any, runtime as any, prisma, { getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) } as any);
  vi.spyOn(service as any, 'getRecentLabsSummary').mockResolvedValue([]);
  return service;
};

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'modules', 'medical-ai', 'medical-ai.service.ts'),
  'utf8',
);

describe('AI 상류 401 — 키 인증 실패를 그대로 말한다(대신 고쳐주지 않는다)', () => {
  it('🔴 ① 401 은 UNAVAILABLE/UPSTREAM_AUTH — "규칙으로 대체했다"가 아니라 "말할 수 없다"', async () => {
    const service = mk();
    vi.spyOn(service as any, 'draft').mockRejectedValue(new Error('AI API error: 401'));
    const r: any = await service.autoSoap({ patientId: PID, subjective: '흉통' });
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toBe('UPSTREAM_AUTH');
  });

  it('② 대조군 — 401 이 아닌 상류 오류는 종전대로 FALLBACK/UPSTREAM_ERROR(가드가 모든 실패를 인증 실패라 하지 않는다)', async () => {
    const service = mk();
    vi.spyOn(service as any, 'draft').mockRejectedValue(new Error('AI API error: 500'));
    const r: any = await service.autoSoap({ patientId: PID, subjective: '흉통' });
    expect(r.source).toBe('FALLBACK');
    expect(r.reason).toBe('UPSTREAM_ERROR');
  });

  it('①-b 감별진단·추론 체인도 같은 계약이다', async () => {
    const s1 = mk();
    vi.spyOn(s1 as any, 'analyze').mockRejectedValue(new Error('AI API error: 403'));
    vi.spyOn(s1 as any, 'chatLlm').mockRejectedValue(new Error('AI API error: 403'));
    const ddx: any = await s1.realtimeDdx({ patientId: PID, subjective: '3일 전부터 흉통' });
    expect(ddx.source).toBe('UNAVAILABLE');
    expect(ddx.reason).toBe('UPSTREAM_AUTH');

    const s2 = mk();
    vi.spyOn(s2 as any, 'request').mockRejectedValue(new Error('AI API error: 401'));
    const chain: any = await s2.reasoningChain({ symptoms: ['흉통'] });
    expect(chain.source).toBe('UNAVAILABLE');
    expect(chain.reason).toBe('UPSTREAM_AUTH');
  });

  it('🔴 ③ 자동 키 재발급 경로가 소스에 없다 — 테넌트 재등록도, 하드코딩 조직정보도', () => {
    // 주석에는 "무엇을 지웠는지"가 남아 있으므로 주석을 뺀 본문만 본다
    const code = SERVICE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    expect(code).not.toMatch(/tenant\/register/);
    expect(code).not.toMatch(/refreshApiKeyIfNeeded/);
    expect(code).not.toMatch(/Hospital RUN HIS/);
    expect(code).not.toMatch(/admin@hospitalrun\.kr/);
    // 주석 제거가 실제로 동작했는지(대조군) — 안 되면 위 4개가 "다른 이유로" 통과한다
    expect(SERVICE_SRC).toMatch(/tenant\/register/); // 삭제 경위 주석은 남아 있다
    expect(code.length).toBeGreaterThan(1000);
  });

  it('④ 상태 진단(getStatus)이 401 을 "연결 실패"가 아니라 키 인증 실패로 말한다', async () => {
    const service = mk();
    vi.spyOn(service as any, 'aiFetch').mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as never);
    const st: any = await service.getStatus();
    expect(st.connected).toBe(false);
    expect(st.authFailed).toBe(true);
    expect(st.reason).toBe('UPSTREAM_AUTH');
    expect(String(st.error)).toMatch(/키 교체/);
  });

  it('④-b 대조군 — 503 은 authFailed 가 아니다', async () => {
    const service = mk();
    vi.spyOn(service as any, 'aiFetch').mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as never);
    const st: any = await service.getStatus();
    expect(st.connected).toBe(false);
    expect(st.authFailed).toBe(false);
    expect(String(st.error)).not.toMatch(/키 교체/);
  });
});
