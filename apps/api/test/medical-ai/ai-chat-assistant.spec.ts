/**
 * AI 어시스턴트 패널 `POST /api/v1/ai/chat` 재구성(2026-10-02).
 *  · 명령 정본 = shared `AI_CHAT_COMMANDS` — 서버 분기가 전 명령을 갖는다(빠지면 참고 검색으로 조용히 새지 않는다)
 *  · 요구 입력이 없으면 AI 를 부르지 않는다(`source:null`+이유 코드) — 빈 증상·빈 SOAP 을 보내지 않는다
 *  · 임상 판단 명령은 진료 직군만 — ADMIN 전역 우회를 명령 단위로 다시 막는다(AI 호출 앞)
 *  · 나이·성별은 환자 원장에서 — 화면이 보낸 값을 믿지 않는다
 *  · 상류 실패 = UNAVAILABLE+UPSTREAM_ERROR · kill switch = AI_DISABLED · 스킬이 보고한 FALLBACK 은 그대로
 *  · 감사: 명령·환자 귀속·출처(본문 없음) · 인터셉터 기본행과 이중 기록 없음(@NoAudit)
 * 재주입: 역할 검사를 지우면, ARG 검사를 지우면, 나이를 맥락에서 읽게 하면, 출처를 늘 AI 로 박으면 실패한다.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { AI_CHAT_COMMANDS } from '@hospital-run/shared';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';
import { MedicalAiController } from '../../src/modules/medical-ai/medical-ai.controller';
import { NO_AUDIT_KEY } from '../../src/modules/audit/no-audit.decorator';
import { aiDisabledException } from '../../src/common/util/ai-kill-switch';

const PID = '11111111-1111-4111-8111-111111111111';
const DR = { role: 'DOCTOR' };

function make() {
  const config = { get: vi.fn((_k: string, d?: unknown) => d) };
  const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
  const prisma = {
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findUnique: vi.fn() },
    admission: { findFirst: vi.fn() },
  };
  const service = new MedicalAiService(config as never, runtime as never, prisma as never);
  const spies = {
    analyze: vi.spyOn(service, 'analyze').mockResolvedValue({ differential_diagnosis: [] }),
    reference: vi.spyOn(service, 'reference').mockResolvedValue({ answer: '참고' }),
    summarize: vi.spyOn(service, 'summarize').mockResolvedValue({ summary: {} }),
    reasoning: vi.spyOn(service, 'reasoningChain'),
    codeMapping: vi.spyOn(service, 'codeMapping').mockResolvedValue({ tests: [] }),
  };
  return { service, prisma, spies };
}

describe('명령 정본 ↔ 서버 분기', () => {
  it('🔴 정본의 모든 명령(별칭 제외)에 서버 분기가 있고, 정본에 없는 분기는 없다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/medical-ai/medical-ai.service.ts'), 'utf8');
    const start = src.indexOf('async processCommand(');
    const body = src.slice(start, src.indexOf('private async callAi(', start));
    const cases = new Set([...body.matchAll(/case '(\/[^']+)'/g)].map((m) => m[1]));
    expect(cases.size, '분기를 찾지 못했다 — 가드가 헛돈다').toBeGreaterThanOrEqual(10);
    const canon = AI_CHAT_COMMANDS.map((c) => c.cmd).filter((c) => c !== '/도움'); // /도움 은 switch 앞에서 처리
    expect([...cases].sort()).toEqual([...canon].sort());
  });
});

describe('요구 입력 · 역할 — AI 를 부르기 전에', () => {
  let t: ReturnType<typeof make>;
  beforeEach(() => { t = make(); });

  it('🔴 인자 없는 /감별 은 AI 를 부르지 않는다(빈 증상을 보내지 않는다)', async () => {
    const r = await t.service.processCommand('/감별', null, DR);
    expect(r).toMatchObject({ cmd: '/감별', source: null, reason: 'ARG_REQUIRED' });
    expect(t.spies.analyze).not.toHaveBeenCalled();
  });

  it('🔴 ADMIN 은 임상 판단 명령을 쓸 수 없다(EP 의 ADMIN 우회와 별개) · 참고 명령은 쓴다', async () => {
    const r = await t.service.processCommand('/감별 두통', null, { role: 'ADMIN' });
    expect(r).toMatchObject({ source: null, reason: 'ROLE_NOT_ALLOWED' });
    expect(t.spies.analyze).not.toHaveBeenCalled();
    const ok = await t.service.processCommand('/참고 두통', null, { role: 'ADMIN' });
    expect(ok).toMatchObject({ cmd: '/참고', source: 'AI' });
  });

  it('/도움 은 그 역할이 쓸 수 있는 명령만 돌려준다', async () => {
    const nurse = await t.service.processCommand('/도움', null, { role: 'NURSE' });
    const admin = await t.service.processCommand('/도움', null, { role: 'ADMIN' });
    expect((nurse.data as { commands: string[] }).commands).toContain('/감별');
    expect((admin.data as { commands: string[] }).commands).not.toContain('/감별');
    expect((admin.data as { commands: string[] }).commands).toContain('/참고');
  });

  it('🔴 /요약 — SOAP 맥락이 없으면 SOAP_REQUIRED · 전부 비면 SOAP_EMPTY · 있으면 그 글로 요약', async () => {
    expect(await t.service.processCommand('/요약', null, DR)).toMatchObject({ reason: 'SOAP_REQUIRED' });
    expect(await t.service.processCommand('/요약', { soap: { subjective: ' ', plan: '' } }, DR)).toMatchObject({ reason: 'SOAP_EMPTY' });
    expect(t.spies.summarize).not.toHaveBeenCalled();
    const r = await t.service.processCommand('/요약', { soap: { subjective: '두통 3일' } }, DR);
    expect(r).toMatchObject({ type: 'summarize', draft: true, source: 'AI' });
    expect(t.spies.summarize.mock.calls[0][0]).toContain('S: 두통 3일');
  });

  it('모르는 명령은 참고 검색으로 처리하되 그 사실을 돌려준다', async () => {
    const r = await t.service.processCommand('/진단 두통', null, DR);
    expect(r).toMatchObject({ type: 'chat', unknownCommand: '/진단' });
  });
});

describe('환자 맥락 — 원장에서 읽는다', () => {
  it('🔴 /감별 의 나이·성별은 환자 원장 값이다 · 없는 환자면 AI 를 부르지 않는다', async () => {
    const t = make();
    t.prisma.patient.findUnique.mockResolvedValue({ id: PID, dateOfBirth: new Date('1950-01-01'), gender: 'FEMALE' });
    const r = await t.service.processCommand('/감별 두통, 구역', { patientId: PID }, DR);
    const arg = t.spies.analyze.mock.calls[0][0];
    expect(arg.symptoms).toEqual(['두통', '구역']);
    expect(arg.sex).toBe('F');
    expect(arg.age).toBeGreaterThan(70);
    expect(r.basis).toMatchObject({ patientId: PID, sex: 'F' });

    const u = make();
    u.prisma.patient.findUnique.mockResolvedValue(null);
    expect(await u.service.processCommand('/감별 두통', { patientId: PID }, DR)).toMatchObject({ reason: 'PATIENT_NOT_FOUND', source: null });
    expect(u.spies.analyze).not.toHaveBeenCalled();
  });

  it('성별 미상이면 성별을 보내지 않는다(M 으로 접지 않는다)', async () => {
    const t = make();
    t.prisma.patient.findUnique.mockResolvedValue({ id: PID, dateOfBirth: null, gender: 'UNKNOWN' });
    await t.service.processCommand('/감별 두통', { patientId: PID }, DR);
    expect(t.spies.analyze.mock.calls[0][0]).not.toHaveProperty('sex');
    expect(t.spies.analyze.mock.calls[0][0]).not.toHaveProperty('age');
  });
});

describe('출처 3상태', () => {
  it('🔴 상류 예외 = UNAVAILABLE+UPSTREAM_ERROR(답 없음이 아니다) · kill switch = AI_DISABLED', async () => {
    const t = make();
    t.spies.codeMapping.mockRejectedValueOnce(new Error('AI API error: 502'));
    expect(await t.service.processCommand('/매핑 I10', null, DR)).toMatchObject({ source: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR', data: null });
    t.spies.codeMapping.mockRejectedValueOnce(aiDisabledException());
    expect(await t.service.processCommand('/매핑 I10', null, DR)).toMatchObject({ source: 'UNAVAILABLE', reason: 'AI_DISABLED' });
    t.spies.codeMapping.mockRejectedValueOnce(new ServiceUnavailableException({ code: 'AI_SERVER_URL_UNSET' }));
    expect(await t.service.processCommand('/매핑 I10', null, DR)).toMatchObject({ reason: 'UPSTREAM_ERROR', detail: 'AI_SERVER_URL_UNSET' });
  });

  it('스킬이 보고한 FALLBACK 을 AI 로 덮지 않는다 · 대조군 성공은 AI', async () => {
    const t = make();
    t.spies.reasoning.mockResolvedValueOnce({ steps: [], source: 'FALLBACK' } as never);
    expect(await t.service.processCommand('/추론 두통', null, DR)).toMatchObject({ type: 'reasoning', source: 'FALLBACK' });
    t.spies.reasoning.mockResolvedValueOnce({ steps: [{ name: 'a' }] } as never);
    expect(await t.service.processCommand('/추론 두통', null, DR)).toMatchObject({ source: 'AI' });
  });
});

describe('컨트롤러 — 감사', () => {
  it('🔴 명령·환자 귀속·출처를 남기고(본문 없음) 인터셉터 기본행은 끈다', async () => {
    const svc = { processCommand: vi.fn().mockResolvedValue({ cmd: '/감별', type: 'diagnose', source: 'AI', draft: false, data: {} }) };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const ctl = new MedicalAiController(svc as never, audit as never);
    await ctl.chat({ message: '/감별 흉통 비밀내용', context: { patientId: PID } }, { id: 'u1', role: 'DOCTOR' });
    const rows = audit.log.mock.calls.map((c) => c[0]);
    expect(rows.map((r) => r.resourceType)).toEqual(['AiChat', 'AiChatOutcome']);
    expect(rows.every((r) => r.resourceId === PID)).toBe(true);
    expect(JSON.stringify(rows)).toContain('cmd=/감별');
    expect(JSON.stringify(rows)).toContain('source=AI');
    expect(JSON.stringify(rows)).not.toContain('비밀내용');
    expect(Reflect.getMetadata(NO_AUDIT_KEY, MedicalAiController.prototype.chat)).toBe(true);
  });
});
