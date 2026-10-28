import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';
import { MedicalAiController } from '../../src/modules/medical-ai/medical-ai.controller';

/**
 * W8-R6 가드 — AI 화면의 PHI 유출 경로 + 실패 은닉.
 *
 * 이 스펙이 굳히는 사실 4가지:
 *  ① 모든 aiFetch 경로가 res.ok 를 검사한다(구조 가드) — 실패를 성공으로 내려보내지 않는다.
 *  ② 진료 녹취 전문(transcript.full_text·speaker_segments)이 관리자 응답에 실리지 않는다.
 *  ③ 의료영상 외부 전송 전에 동의 게이트를 통과해야 한다(id-ocr 과 동일 계약).
 *  ④ 상담 위기감지 실패가 "위기 없음"이 되지 않는다(판단 불가로 내려간다).
 */

const SERVICE_PATH = join(__dirname, '../../src/modules/medical-ai/medical-ai.service.ts');

function newService() {
  const cfg = { get: vi.fn((_k: string, d?: any) => d ?? '') };
  const rt = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
  // 🔴 목적지(ai.server.url)는 실제 값을 준다 — 빈 문자열 하니스는 현실에 없는 상태였고,
  //    2026-08-18 egress 목적지 검증이 붙은 뒤로는 '미설정'으로 잡힌다(하니스가 거짓말하던 자리).
  const prisma = { systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'ai.server.url', value: 'https://example.org/ollama' }]) } };
  return new MedicalAiService(cfg as any, rt as any, prisma as any);
}

/** 실패 응답(상류 502) — 에러 본문에는 is_crisis 도 결과도 없다 */
const failRes = (status = 502, body: any = { detail: 'upstream boom' }) => ({
  ok: false,
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  json: vi.fn().mockResolvedValue(body),
});
const okRes = (body: any) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(body), text: vi.fn().mockResolvedValue(JSON.stringify(body)) });

describe('W8-R6 ① aiFetch 전 경로 res.ok 검사(구조 가드)', () => {
  const src = readFileSync(SERVICE_PATH, 'utf8');
  const lines = src.split('\n');

  it('aiFetch 호출부는 예외 없이 res.ok / aiJson / assertStreamOk 중 하나를 거친다', () => {
    // 🔴 원 결함: res.ok 를 검사하는 request() 경로와, 검사 없이 res.json() 을 반환하는 개별 aiFetch 경로가
    //    공존했다(6경로). "한 곳만 고치면 갈라진다" — 전 경로를 한 벌로 묶는 가드.
    const offenders: string[] = [];
    let callSites = 0;
    lines.forEach((line, i) => {
      if (!/this\.aiFetch\(/.test(line)) return;
      if (/private async aiFetch\(/.test(line)) return; // 정의부
      callSites++;
      const window = lines.slice(i, i + 16).join('\n');
      const checked = /\.ok\b/.test(window) || /this\.aiJson\(/.test(window) || /this\.assertStreamOk\(/.test(window) || /\bres\.status\b/.test(window);
      if (!checked) offenders.push(`L${i + 1}: ${line.trim()}`);
    });
    expect(callSites).toBeGreaterThan(30); // 경로가 통째로 사라지면(리팩터 사고) 가드가 무력해지므로 하한 고정
    expect(offenders).toEqual([]);
  });

  it('aiJson / assertStreamOk 자체가 res.ok 를 검사하고 실패를 던진다', () => {
    const aiJson = src.slice(src.indexOf('private async aiJson('), src.indexOf('private async assertStreamOk('));
    expect(aiJson).toMatch(/if \(!res\.ok\)/);
    expect(aiJson).toMatch(/throw new ServiceUnavailableException/);
    const assertStream = src.slice(src.indexOf('private async assertStreamOk('));
    expect(assertStream.slice(0, 800)).toMatch(/if \(!res\.ok\)/);
    expect(assertStream.slice(0, 800)).toMatch(/throw new ServiceUnavailableException/);
  });

  it.each([
    ['meetingAnalyze', (s: MedicalAiService) => s.meetingAnalyze({ file_url: 'https://x/a.mp4' })],
    ['meetingJobs', (s: MedicalAiService) => s.meetingJobs()],
    ['meetingStatus', (s: MedicalAiService) => s.meetingStatus()],
    ['counselingChat', (s: MedicalAiService) => s.counselingChat('죽고 싶어요')],
    ['translate', (s: MedicalAiService) => s.translate('안녕', 'en')],
    ['visionMedicalAnalyze', (s: MedicalAiService) => s.visionMedicalAnalyze({ imageBase64: 'AAAA', modality: 'xray', bodyPart: 'chest' })],
    ['reasoningChainStream', (s: MedicalAiService) => s.reasoningChainStream({ symptoms: ['두통'] })],
    ['autoRecordStream', (s: MedicalAiService) => s.autoRecordStream({ conversation: 'x' })],
  ])('%s: 상류 실패를 삼키지 않고 던진다', async (_name, call) => {
    global.fetch = vi.fn().mockResolvedValue(failRes()) as any;
    await expect(call(newService())).rejects.toThrow();
  });
});

describe('W8-R6 ② 진료 녹취 전문이 관리자 응답에 실리지 않는다', () => {
  let service: MedicalAiService;
  beforeEach(() => { service = newService(); });

  const scribeJob = {
    id: 'job-scribe-1',
    status: 'completed',
    metadata: { source: 'scribe', encounter: 'e-1' },
    result: {
      transcript: { full_text: '환자: 가슴이 아파요 / 의사: 언제부터요' },
      speaker_segments: [{ speaker: 'SPK1', text: '가슴이 아파요' }],
      summary: '흉통 호소',
    },
  };
  const ownJob = {
    id: 'job-mine-1',
    status: 'completed',
    metadata: { source: 'his-meeting', room_name: '주간 진료부 회의' },
    result: {
      summary: '주간 회의 요약',
      action_items: ['수술 스케줄 조정'],
      transcript: { full_text: '회의 전문…' },
      speaker_segments: [{ speaker: 'SPK1', text: '…' }],
    },
  };

  it('목록: 타 출처(진료녹취 포함) 작업은 빠지고, 개수만 사실대로 보고한다', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes({
      jobs: [scribeJob, { id: 'j2', metadata: { source: 'edu-stt' } }, { id: 'j3' }, ownJob],
    })) as any;

    const r = await service.meetingJobs();
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].id).toBe('job-mine-1');
    expect(r.queueTotal).toBe(4);
    expect(r.excluded.total).toBe(3);
    expect(r.excluded.bySource).toEqual({ scribe: 1, 'edu-stt': 1, unknown: 1 });
    // 남의 큐를 "병원 회의"로 렌더하지 않는다 — 직렬화 어디에도 녹취 문장이 없어야 한다.
    expect(JSON.stringify(r)).not.toContain('가슴이 아파요');
  });

  it('목록: 병원 회의가 0건이면 폴백 없이 빈 목록(0건이라 말한다)', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes({ jobs: [scribeJob] })) as any;
    const r = await service.meetingJobs();
    expect(r.jobs).toEqual([]);
    expect(r.excluded.total).toBe(1);
  });

  it('상세: 타 출처 작업(진료 녹취)은 403 — 회의 화면으로 열 수 없다', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes(scribeJob)) as any;
    await expect(service.meetingJobStatus('job-scribe-1')).rejects.toMatchObject({
      response: { code: 'NOT_A_HOSPITAL_MEETING_JOB' },
    });
  });

  it('상세: 우리 작업이어도 전사 전문·화자분절은 응답에서 제거된다', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes(ownJob)) as any;
    const r = await service.meetingJobStatus('job-mine-1');
    const s = JSON.stringify(r);
    expect(s).not.toContain('full_text');
    expect(s).not.toContain('speaker_segments');
    expect(s).not.toContain('회의 전문');
    expect(r!.result).toMatchObject({ summary: '주간 회의 요약', transcriptOmitted: true });
  });

  it('제출: 출처는 서버가 확정한다(scribe 로 위장 제출 불가)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes({ job_id: 'x' }));
    global.fetch = fetchMock as any;
    await service.meetingAnalyze({ file_url: 'https://x/a.mp4', metadata: { source: 'scribe', room_name: 'A' } });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.metadata.source).toBe('his-meeting');
    expect(sent.metadata.room_name).toBe('A');
  });
});

describe('W8-R6 ③ 의료영상 외부 전송 동의 게이트(id-ocr 과 동일 계약)', () => {
  let controller: MedicalAiController;
  let service: any;

  beforeEach(() => {
    service = { visionMedicalAnalyze: vi.fn().mockResolvedValue({ findings: 'ok' }), idCardOcr: vi.fn() };
    controller = new MedicalAiController(service, { log: vi.fn().mockResolvedValue(null) } as any);
  });

  const body = { imageBase64: 'AAAA', modality: 'xray', bodyPart: 'chest' };

  it('동의 없으면 CONSENT_REQUIRED — 외부 전송이 일어나지 않는다', async () => {
    const r: any = await controller.visionMedicalAnalyze({ ...body, consent: false } as any, 'u-1');
    expect(r.error.code).toBe('CONSENT_REQUIRED');
    expect(service.visionMedicalAnalyze).not.toHaveBeenCalled();
  });

  it('consent 필드 자체가 없어도 전송하지 않는다(기본 거부)', async () => {
    const r: any = await controller.visionMedicalAnalyze({ ...body } as any, 'u-1');
    expect(r.error.code).toBe('CONSENT_REQUIRED');
    expect(service.visionMedicalAnalyze).not.toHaveBeenCalled();
  });

  it('동의가 있으면 전송하고, 감사에 무엇을·누구의를 남긴다', async () => {
    const audit = { log: vi.fn().mockResolvedValue(null) };
    controller = new MedicalAiController(service, audit as any);
    const pid = '11111111-2222-4333-8444-555555555555';
    await controller.visionMedicalAnalyze({ ...body, consent: true, patientId: pid } as any, 'u-1');
    expect(service.visionMedicalAnalyze).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'AiVisionEgress',
      resourceId: pid, // 🔴 기존: 전량 00000000-…
    }));
    const changes = audit.log.mock.calls[0][0].changes;
    expect(changes.egress.new).toContain('modality=xray'); // 최상위 필드명이 아니라 전송 내용의 메타
  });

  it('환자를 모르면 추정하지 않는다(ZERO_UUID 유지)', async () => {
    const audit = { log: vi.fn().mockResolvedValue(null) };
    controller = new MedicalAiController(service, audit as any);
    await controller.visionMedicalAnalyze({ ...body, consent: true } as any, 'u-1');
    expect(audit.log.mock.calls[0][0].resourceId).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('W8-R6 ④ 상담 위기감지 실패가 "위기 없음"이 되지 않는다', () => {
  let service: MedicalAiService;
  beforeEach(() => { service = newService(); });

  it('상류 실패는 예외 — 조용한 "위기 없음" 응답을 만들지 않는다', async () => {
    // 🔴 원 결함: res.ok 미검사 → 에러 본문 그대로 반환 → is_crisis undefined → 배너 미표시 + 빈 말풍선.
    global.fetch = vi.fn().mockResolvedValue(failRes(502, { detail: 'model down' })) as any;
    await expect(service.counselingChat('죽고 싶어요')).rejects.toThrow();
  });

  it('200 이어도 상류가 is_crisis 를 판정하지 않았으면 crisis_assessed=false·is_crisis=null', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes({ message: '힘드셨겠어요', session_id: 's1' })) as any;
    const r = await service.counselingChat('죽고 싶어요');
    expect(r.crisis_assessed).toBe(false);
    expect(r.is_crisis).toBeNull(); // false(=위기 없음)로 위장하지 않는다
  });

  it('상류가 명시적으로 판정하면 그대로 전달한다', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes({ message: '…', is_crisis: true })) as any;
    const crisis = await service.counselingChat('죽고 싶어요');
    expect(crisis).toMatchObject({ is_crisis: true, crisis_assessed: true });

    global.fetch = vi.fn().mockResolvedValue(okRes({ message: '…', is_crisis: false })) as any;
    const safe = await service.counselingChat('오늘 날씨 좋네요');
    expect(safe).toMatchObject({ is_crisis: false, crisis_assessed: true });
  });
});

describe('W8-R6 부수: AI 상태는 모르는 것을 지어내지 않는다', () => {
  it('연결 실패 시 connected=false + 사유를 담는다(화면이 초록으로 칠할 수 없게)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    const r = await newService().getStatus();
    expect(r.connected).toBe(false);
    expect(r.error).toBe('HTTP 503');
  });

  it('물어본 적 없는 model 상수를 응답에 넣지 않는다', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes({ documents: 1 })) as any;
    const r = await newService().getStatus();
    expect(r.connected).toBe(true);
    expect(r).not.toHaveProperty('model'); // 🔴 기존: model:'qwen2.5' 하드코딩(P15)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2026-08-18 확장 — AI 외부 전송 안전장치(INV-PHI-03 / INV-NET-01)
//
//  🔴 모든 AI 추론은 지금도 외부 퍼블릭 FQDN 으로 나간다. 폐쇄망 전환은 인프라(사람) 결정이고,
//     여기서 굳히는 것은 **코드로 지금 닫을 수 있는 구멍**뿐이다:
//      ⑤ 환자에게 AI 답변이 사람 검토 없이 전송되지 않는다(상담실 aiMode)
//      ⑥ AI egress 목적지를 설정 PUT 으로 바꿀 수 없다 + 나가기 직전 목적지를 검증한다
//      ⑦ 데이터 품질 AI 가 환자 실명·생일을 보내지 않는다(주석과 코드가 같은 말을 한다)
//      ⑧ 영상 URL 경로에도 동의 게이트가 있다(바이트 경로와 동일 계약)
//      ⑨ 예약 챗봇이 실명·HIS 환자 UUID 를 보내지 않는다
//
//  이 스펙의 모든 단언은 **결함을 되살리면 실패하도록** 작성했다(구조 문자열 매칭 최소화).
// ═══════════════════════════════════════════════════════════════════════════

import { ConfigRuntimeController } from '../../src/modules/config/config-runtime.controller';
import { ConsultService } from '../../src/modules/consult/consult.service';
import { clampAiMode, isConsultAutoReplyAllowed, SAFE_DEFAULT_AI_MODE } from '../../src/modules/consult/consult-ai-gate';
import { DataQualityService } from '../../src/modules/data-quality/data-quality.service';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';
import {
  PATIENT_NAME_PLACEHOLDER,
  aiPseudonymousId,
  redactForAiEgress,
  redactIdentifiers,
} from '../../src/common/util/ai-phi-redact';
import { assertAiServerUrl } from '../../src/common/util/ai-egress-url';

describe('⑤ 상담실 — AI 답변이 사람 검토 없이 환자에게 가지 않는다', () => {
  /** SystemConfig 를 흉내내는 최소 prisma — 게이트 값만 바꿔 가며 본다. */
  const cfgPrisma = (autoReply: unknown) => ({
    systemConfig: { findUnique: vi.fn().mockResolvedValue(autoReply === undefined ? null : { value: autoReply }) },
  }) as any;

  it('게이트 기본값은 꺼짐 — 설정 행이 아예 없으면 자동응답 불가', async () => {
    expect(await isConsultAutoReplyAllowed(cfgPrisma(undefined))).toBe(false);
  });

  it('설정 조회가 실패해도 "허용"으로 넘어가지 않는다(fail-closed)', async () => {
    const boom = { systemConfig: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } } as any;
    expect(await isConsultAutoReplyAllowed(boom)).toBe(false);
  });

  it('명시적 true 일 때만 허용 — 문자열 "1"·1·{} 같은 truthy 는 허용이 아니다', async () => {
    expect(await isConsultAutoReplyAllowed(cfgPrisma(true))).toBe(true);
    expect(await isConsultAutoReplyAllowed(cfgPrisma('true'))).toBe(true);
    for (const v of ['1', 1, {}, 'yes', 'AUTO']) {
      expect(await isConsultAutoReplyAllowed(cfgPrisma(v))).toBe(false);
    }
  });

  it('clamp: 게이트가 꺼져 있으면 AUTO 는 SUGGEST 로 — 미상·미지정도 SUGGEST', () => {
    expect(clampAiMode('AUTO', false)).toBe('SUGGEST');
    expect(clampAiMode('AUTO', true)).toBe('AUTO');
    expect(clampAiMode('OFF', false)).toBe('OFF');
    expect(clampAiMode(null, false)).toBe(SAFE_DEFAULT_AI_MODE);
    expect(clampAiMode('SOMETHING_NEW', true)).toBe(SAFE_DEFAULT_AI_MODE); // 모르는 값은 안전한 쪽
    expect(SAFE_DEFAULT_AI_MODE).not.toBe('AUTO');
  });

  /** ConsultService 를 실제로 돌려 "환자에게 메시지가 저장되는가"를 본다(모드 문자열이 아니라 결과로). */
  function consultHarness(opts: { autoReply?: unknown; storedMode: string }) {
    const created: any[] = [];
    const prisma: any = {
      systemConfig: { findUnique: vi.fn().mockResolvedValue(opts.autoReply === undefined ? null : { value: opts.autoReply }) },
      consultSession: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1', aiMode: opts.storedMode }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 's-new', ...data })),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      consultTeam: { findUnique: vi.fn().mockResolvedValue({ defaultAiMode: 'AUTO' }) },
      consultMessage: { create: vi.fn().mockImplementation(({ data }: any) => { created.push(data); return Promise.resolve({ id: 'm1', ...data }); }), update: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
      consultAgent: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const t: any = { complete: vi.fn().mockResolvedValue('AI 가 만든 답변입니다'), translate: vi.fn().mockResolvedValue({ translated: 'x' }) };
    const redis: any = { setex: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null) };
    const config: any = { get: vi.fn().mockReturnValue('') };
    const teamSvc: any = { routeTeam: vi.fn().mockResolvedValue('team-1') };
    const svc = new ConsultService(prisma, t, config, teamSvc, undefined, undefined, redis, undefined);
    return { svc, prisma, t, redis, created };
  }

  it('🔴 신규 세션은 AUTO 로 태어나지 않는다 — 팀 기본값이 AUTO 여도 게이트가 꺼졌으면 SUGGEST', async () => {
    const h = consultHarness({ storedMode: 'AUTO' });
    await h.svc.openSession('p-1', 'ko', 'GENERAL');
    expect(h.prisma.consultSession.create).toHaveBeenCalled();
    // 🔴 원 결함: aiMode 를 스키마 기본값(AUTO)에 맡기거나 'AUTO' 를 명시 저장했다.
    expect(h.prisma.consultSession.create.mock.calls[0][0].data.aiMode).toBe('SUGGEST');
  });

  it('🔴 이미 AUTO 로 저장된 기존 세션도 환자에게 자동 전송되지 않는다(DB 를 고치지 않고 멈춘다)', async () => {
    const h = consultHarness({ storedMode: 'AUTO' });
    await (h.svc as any).processAsync('s1', 'ko', '예약 되나요?', 'pm-1');
    // AI 메시지(sender:'AI')가 하나도 만들어지지 않아야 한다 = 환자 화면에 뜨지 않는다.
    expect(h.created.filter((c) => c.sender === 'AI')).toEqual([]);
    // 대신 직원이 검토할 초안으로 남는다(기능이 죽는 게 아니라 사람이 끼는 것).
    expect(h.redis.setex).toHaveBeenCalledWith(expect.stringContaining('consult:draft:'), 3600, 'AI 가 만든 답변입니다');
  });

  it('게이트를 명시적으로 켜면 종전 동작(AUTO 자동 전송)이 그대로 살아난다 — 기능을 없앤 게 아니다', async () => {
    const h = consultHarness({ autoReply: true, storedMode: 'AUTO' });
    await (h.svc as any).processAsync('s1', 'ko', '예약 되나요?', 'pm-1');
    expect(h.created.filter((c) => c.sender === 'AI').length).toBeGreaterThan(0);
  });

  it('🔴 조용히 강등하지 않는다 — AUTO 로 바꾸려 하면 무엇이 막는지 말하고 거절한다', async () => {
    const h = consultHarness({ storedMode: 'SUGGEST' });
    await expect(h.svc.setAiMode('s1', 'AUTO', 'u-1')).rejects.toMatchObject({
      response: { code: 'CONSULT_AUTO_REPLY_DISABLED' },
    });
    expect(h.prisma.consultSession.update).not.toHaveBeenCalled();
    // 안전한 방향(OFF/SUGGEST)으로의 변경은 막지 않는다
    await expect(h.svc.setAiMode('s1', 'OFF', 'u-1')).resolves.toMatchObject({ aiMode: 'OFF' });
  });
});

describe('⑥ AI egress 목적지 — 설정 PUT 으로 바꿀 수 없다 + 나가기 직전 검증', () => {
  const controller = () => new ConfigRuntimeController(Object.assign({ get: async () => null }, { set: vi.fn(), get: vi.fn() } as any) as never, { emitAsync: async () => [] } as never);

  it('🔴 ai.server.url 은 범용 설정 PUT 으로 변경 불가(환자 데이터의 목적지)', async () => {
    const svc = { set: vi.fn() };
    const c = new ConfigRuntimeController(Object.assign({ get: async () => null }, svc as any) as never, { emitAsync: async () => [] } as never);
    await expect(c.set('ai.server.url', { value: 'https://attacker.example/ollama' } as any, 'admin-1'))
      .rejects.toMatchObject({ response: { code: 'CONFIG_KEY_PROTECTED' } });
    expect(svc.set).not.toHaveBeenCalled(); // 저장 시도 자체가 없어야 한다
  });

  it('보호되지 않는 키는 그대로 변경된다(전면 차단이 아니다)', async () => {
    const svc = { set: vi.fn().mockResolvedValue({ key: 'ai.disclaimer' }) };
    const c = new ConfigRuntimeController(Object.assign({ get: async () => null }, svc as any) as never, { emitAsync: async () => [] } as never);
    await c.set('ai.disclaimer', { value: '참고용' } as any, 'admin-1');
    expect(svc.set).toHaveBeenCalledWith('ai.disclaimer', '참고용', 'admin-1');
    void controller;
  });

  it('목적지 검증: 프로토콜·자격증명 밀반입은 거절', () => {
    expect(() => assertAiServerUrl('file:///etc/passwd')).toThrow();
    expect(() => assertAiServerUrl('javascript:fetch(1)')).toThrow();
    expect(() => assertAiServerUrl('https://user:pw@example.org/ollama')).toThrow();
    expect(() => assertAiServerUrl('not a url')).toThrow();
  });

  it('운영 현재값은 통과하고, 원내 사설 GPU 주소도 통과한다(폐쇄망 전환을 막지 않는다)', () => {
    expect(() => assertAiServerUrl('https://example.org/ollama')).not.toThrow();
    expect(() => assertAiServerUrl('http://10.0.0.5:11434')).not.toThrow();
  });

  it('AI_EGRESS_ALLOWED_HOSTS 를 지정하면 그 밖의 호스트는 차단된다(실제 봉쇄는 이 설정으로 성립)', () => {
    const prev = process.env.AI_EGRESS_ALLOWED_HOSTS;
    process.env.AI_EGRESS_ALLOWED_HOSTS = 'example.org';
    try {
      expect(() => assertAiServerUrl('https://example.org/ollama')).not.toThrow();
      expect(() => assertAiServerUrl('https://attacker.example/ollama')).toThrow();
    } finally {
      if (prev === undefined) delete process.env.AI_EGRESS_ALLOWED_HOSTS; else process.env.AI_EGRESS_ALLOWED_HOSTS = prev;
    }
  });

  it('AI 클라이언트는 목적지가 불량이면 요청을 보내지 않고 실패로 올린다(빈 결과로 덮지 않음)', async () => {
    const cfg = { get: vi.fn((_k: string, d?: any) => d ?? '') };
    const rt = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma = { systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'ai.server.url', value: 'ftp://evil.example/x' }]) } };
    const svc = new MedicalAiService(cfg as any, rt as any, prisma as any);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    await expect(svc.translate('안녕', 'en')).rejects.toMatchObject({ response: { code: 'AI_EGRESS_BLOCKED' } });
    expect(fetchMock).not.toHaveBeenCalled(); // 🔴 한 바이트도 나가지 않았다
  });
});

describe('⑦ 데이터 품질 AI — 주석이 "(식별자 없음)"이라 적혀 있으면 실제로 없어야 한다(P14)', () => {
  const NAME_FAMILY = '검';
  const NAME_GIVEN = '종단';

  async function runScoreDuplicates() {
    const bodies: string[] = [];
    global.fetch = vi.fn().mockImplementation((_u: string, init: any) => {
      bodies.push(init.body);
      return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ response: '{"score":0.9,"reason":"동일 가능성"}' })) });
    }) as any;
    const prisma: any = {
      $queryRaw: vi.fn().mockResolvedValue([{ family_name: NAME_FAMILY, given_name: NAME_GIVEN, date_of_birth: new Date('1981-03-07') }]),
      patient: { findMany: vi.fn().mockResolvedValue([{ gender: 'MALE', phone: '010-2222-3333', nationality: 'KR' }]) },
    };
    const config: any = {
      get: vi.fn(async (k: string) => ({
        'quality.ai.enabled': 'true',
        'ai.server.url': 'https://example.org/ollama',
        'ai.server.gpuKey': 'k',
        'ai.server.enabled': true,
      } as Record<string, unknown>)[k]),
    };
    const svc = new DataQualityService(prisma, config);
    const out = await svc.scoreDuplicates(1);
    return { out, sent: bodies.join('\n') };
  }

  it('🔴 환자 실명이 프롬프트에 실리지 않는다', async () => {
    const { sent } = await runScoreDuplicates();
    expect(sent).not.toContain(`${NAME_FAMILY}${NAME_GIVEN}`);
  });

  it('🔴 생년월일 전체가 실리지 않는다(출생연도까지만)', async () => {
    const { sent } = await runScoreDuplicates();
    expect(sent).not.toContain('1981-03-07');
    expect(sent).toContain('1981'); // 판별에 필요한 최소치는 남긴다 — 기능을 없앤 게 아니다
  });

  it('그래도 판별은 동작한다(그룹 라벨은 서버 안에서만 실명)', async () => {
    const { out } = await runScoreDuplicates();
    expect(out.pairs[0]).toMatchObject({ group: `${NAME_FAMILY}${NAME_GIVEN}`, score: 0.9 });
  });
});

describe('⑧ 영상 URL 경로 — 바이트 경로와 같은 동의 계약', () => {
  const body = { imageUrl: 'https://cdn.example/x.png', modality: 'xray', bodyPart: 'chest' };
  let service: any;
  let audit: any;

  beforeEach(() => {
    service = { visionAnalyze: vi.fn().mockResolvedValue({ findings: 'ok' }) };
    audit = { log: vi.fn().mockResolvedValue(null) };
  });

  it('🔴 동의 없으면 CONSENT_REQUIRED — 외부 전송이 일어나지 않는다', async () => {
    const c = new MedicalAiController(service, audit);
    const r: any = await c.visionAnalyze({ ...body } as any, 'u-1');
    expect(r.error.code).toBe('CONSENT_REQUIRED');
    expect(service.visionAnalyze).not.toHaveBeenCalled();
  });

  it('동의가 있으면 전송하고 감사에 남긴다 — 임상정보 본문은 감사에 기록하지 않는다', async () => {
    const c = new MedicalAiController(service, audit);
    const pid = '11111111-2222-4333-8444-555555555555';
    await c.visionAnalyze({ ...body, consent: true, patientId: pid, clinicalInfo: '흉통 3일' } as any, 'u-1');
    expect(service.visionAnalyze).toHaveBeenCalled();
    expect(audit.log.mock.calls[0][0].resourceId).toBe(pid);
    const summary = audit.log.mock.calls[0][0].changes.egress.new;
    expect(summary).toContain('clinicalInfoChars=5');
    expect(summary).not.toContain('흉통'); // 감사로그가 스스로 PHI 를 흘리지 않는다
  });

  it('DTO 가 clinicalInfo 길이 상한을 실제로 강제한다(장문 임상기록 통째 전송 방지)', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { AiVisionAnalyzeDto } = await import('../../src/modules/medical-ai/dto/medical-ai.dto');
    const dto = plainToInstance(AiVisionAnalyzeDto, { ...body, consent: true, clinicalInfo: 'ㄱ'.repeat(4001) });
    const errs = await validate(dto);
    expect(errs.map((e) => e.property)).toContain('clinicalInfo');
  });

  it('🔴 컨트롤러를 거치지 않는 내부 호출자도 마지막 관문을 통과한다(식별자 제거 + 자른 사실 고지)', async () => {
    const cfg = { get: vi.fn((_k: string, d?: any) => d ?? '') };
    const rt = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma = { systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'ai.server.url', value: 'https://example.org/ollama' }]) } };
    const svc = new MedicalAiService(cfg as any, rt as any, prisma as any);
    const fetchMock = vi.fn().mockResolvedValue(okRes({ findings: 'ok' }));
    global.fetch = fetchMock as any;
    await svc.visionAnalyze('https://cdn.example/x.png', 'xray', 'chest', `연락처 010-2222-3333 / 주민 810307-1234567 ${'가'.repeat(4100)}`);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.clinical_info).not.toContain('010-2222-3333');
    expect(sent.clinical_info).not.toContain('810307-1234567');
    expect(sent.clinical_info).toContain('4000자 초과분 미전송'); // 자르면 잘랐다고 말한다
  });
});

describe('⑨ 예약 챗봇 — 실명·HIS 환자 UUID 를 외부로 보내지 않는다', () => {
  const PID = '11111111-2222-4333-8444-555555555555';
  const FAMILY = '홍';
  const GIVEN = '길동';

  function harness(opts: { chatAnswer?: string } = {}) {
    const session = {
      id: 's1', state: 'COMPLETED', channel: 'WEB_BOOKING',
      context: { patient: { resolved: true, id: PID, familyName: FAMILY, givenName: GIVEN, birthDate: '1980-01-01', gender: 'MALE' }, aiSessionId: null },
      messages: [{ role: 'user', content: `제 이름은 ${FAMILY}${GIVEN}이고 010-2222-3333 입니다`, timestamp: new Date() }],
    };
    const loose = () => new Proxy({}, { get: (_t, m: string) => vi.fn().mockResolvedValue(m === 'findMany' || m === 'groupBy' ? [] : m === 'count' ? 0 : null) });
    const prisma: any = new Proxy(
      { agentSession: { findUnique: vi.fn().mockResolvedValue(session), update: vi.fn().mockResolvedValue({}) } } as any,
      { get: (t: any, p: string) => (p in t ? t[p] : (t[p] = loose())) },
    );
    const medicalAi: any = {
      chatWithSession: vi.fn().mockResolvedValue({ answer: opts.chatAnswer ?? `${PATIENT_NAME_PLACEHOLDER}님, 안내드리겠습니다. 무엇을 도와드릴까요?` }),
      orchestrate: vi.fn().mockResolvedValue({ response: `${PATIENT_NAME_PLACEHOLDER}님, 확인해 드리겠습니다. 예약을 이어서 진행할까요?` }),
      generateNaturalResponse: vi.fn().mockResolvedValue(''),
      enhancedChat: vi.fn().mockResolvedValue({ answer: '' }),
    };
    const svc = new AgentSessionService(prisma, medicalAi, {} as any, {} as any, {} as any);
    return { svc, medicalAi };
  }

  it('🔴 시스템 프롬프트에 환자 실명이 없다 — 플레이스홀더로만 나간다', async () => {
    const h = harness();
    await h.svc.processMessage('s1', '고맙습니다');
    const [, opts] = h.medicalAi.chatWithSession.mock.calls[0];
    expect(opts.systemPrompt).not.toContain(`${FAMILY}${GIVEN}`);
    expect(opts.systemPrompt).toContain(PATIENT_NAME_PLACEHOLDER);
  });

  it('🔴 HIS 환자 UUID 가 외부로 넘어가지 않는다 — 되돌릴 수 없는 가명만', async () => {
    const h = harness();
    await h.svc.processMessage('s1', '고맙습니다');
    const [, opts] = h.medicalAi.chatWithSession.mock.calls[0];
    expect(opts.userId).not.toBe(PID);
    expect(opts.userId).toBe(aiPseudonymousId(PID)); // 세션 연속성은 유지된다
  });

  it('🔴 오케스트레이터 경로도 같다 — 실명·UUID 없이 호출된다', async () => {
    // 🔴 이 케이스가 없을 때, "chatWithSession 이 답을 주면 오케스트레이터는 안 불린다"는 이유로
    //    가드가 통과해 버렸다(결함 재주입 역검증에서 적발). 답이 비어야 이 경로가 열린다.
    const h = harness({ chatAnswer: '' });
    await h.svc.processMessage('s1', '고맙습니다');
    expect(h.medicalAi.orchestrate).toHaveBeenCalled(); // 경로가 사라지면 가드가 무력해진다
    const [msg, orch] = h.medicalAi.orchestrate.mock.calls[0];
    expect(orch.patientId).not.toBe(PID);
    expect(orch.patientId).toBe(aiPseudonymousId(PID));
    expect(orch.patientName).toBe(PATIENT_NAME_PLACEHOLDER);
    expect(JSON.stringify([msg, orch])).not.toContain(`${FAMILY}${GIVEN}`);
  });

  it('오케스트레이터 답변도 서버 안에서 실명으로 되돌아온다', async () => {
    const h = harness({ chatAnswer: '' });
    const r = await h.svc.processMessage('s1', '고맙습니다');
    expect(r.response).toContain(`${FAMILY}${GIVEN}님`);
    expect(r.response).not.toContain(PATIENT_NAME_PLACEHOLDER);
  });

  it('🔴 환자가 직접 쓴 발화·이력에 섞인 이름/연락처도 거른다', async () => {
    const h = harness();
    await h.svc.processMessage('s1', `${FAMILY}${GIVEN}인데요 010-2222-3333 로 연락주세요`);
    const everythingSent = JSON.stringify(h.medicalAi.chatWithSession.mock.calls.concat(h.medicalAi.orchestrate.mock.calls));
    expect(everythingSent).not.toContain(`${FAMILY}${GIVEN}`);
    expect(everythingSent).not.toContain('010-2222-3333');
    expect(everythingSent).not.toContain(PID);
  });

  it('답변 품질은 유지된다 — 플레이스홀더는 서버 안에서 실명으로 되돌아온다', async () => {
    const h = harness();
    const r = await h.svc.processMessage('s1', '고맙습니다');
    expect(r.response).toContain(`${FAMILY}${GIVEN}님`);
    expect(r.response).not.toContain(PATIENT_NAME_PLACEHOLDER);
  });
});

describe('공통 유틸(정본) — 흩어진 마스킹 구현을 더 늘리지 않는다', () => {
  it('형식이 명확한 식별자만 지운다(주민·전화·이메일·UUID)', () => {
    const out = redactIdentifiers('주민 810307-1234567 전화 010-2222-3333 메일 a.b@x.example id 11111111-2222-4333-8444-555555555555');
    expect(out).not.toMatch(/810307-1234567|010-2222-3333|a\.b@x\.co\.kr|11111111-2222/);
    expect(out).toContain('[주민번호]');
  });

  it('🔴 이름을 추측하지 않는다 — 모르는 이름은 그대로 남는다(거짓 마스킹 금지)', () => {
    const r = redactForAiEgress('환자 김철수 흉통 호소', {});
    expect(r.text).toContain('김철수'); // 알려주지 않았으면 지우지 않는다(오탐이 임상 텍스트를 훼손한다)
    expect(r.redacted).toBe(false);
  });

  it('🔴 되돌리기는 이름이 하나일 때만 — 여럿이면 엉뚱한 사람 이름을 박지 않는다', () => {
    const one = redactForAiEgress('김철수 님 안내', { patientNames: ['김철수'] });
    expect(one.text).not.toContain('김철수');
    expect(one.rehydrate(`${PATIENT_NAME_PLACEHOLDER} 님 안내드립니다`)).toBe('김철수 님 안내드립니다');

    const many = redactForAiEgress('김철수·박영희', { patientNames: ['김철수', '박영희'] });
    expect(many.rehydrate(`${PATIENT_NAME_PLACEHOLDER} 님`)).toBe(`${PATIENT_NAME_PLACEHOLDER} 님`);
  });

  it('객체 응답도 되돌린다(문자열만 다루는 구현이 아니다)', () => {
    const r = redactForAiEgress('김철수', { patientNames: ['김철수'] });
    expect(r.rehydrate({ soap: { s: `${PATIENT_NAME_PLACEHOLDER} 호소` } })).toEqual({ soap: { s: '김철수 호소' } });
  });

  it('가명은 결정적이고 원본을 담지 않는다', () => {
    const a = aiPseudonymousId('11111111-2222-4333-8444-555555555555');
    expect(a).toBe(aiPseudonymousId('11111111-2222-4333-8444-555555555555'));
    expect(a).not.toContain('1111');
    expect(aiPseudonymousId('')).toBeNull();
  });
});
