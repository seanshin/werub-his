/**
 * 🔴 프롬프트 층의 "없음" 3상태 가드 — AI 에게 "없음"이라고 말하는 것은 임상 주장이다.
 *
 * 2026-08-19 실측: FE 는 NKA 3상태(미문진/없음 확인/확인 불가)를 지키는데, 프롬프트 조립 층 26곳이
 * `list.join(', ') || '없음'` 이었다. 감별진단·약물 추천이 **문진하지 않은 환자를 "알레르기 없음"으로 전제**하고
 * 약을 골랐다 — 근거 게이트가 프롬프트 층에서 뒤집힌 것이다(`clinical-ux-agent-era.plan.md` §7.5-b).
 *
 * 재주입하면 실패한다: `allergyPromptLine` 을 `join || '없음'` 으로 되돌리면 실제로 나간 프롬프트에서 잡힌다.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';
import { PROMPT_UNRECORDED, allergyPromptLine, promptList } from '../../src/modules/medical-ai/ai-grounding';

describe('promptList / allergyPromptLine — 정본 자체', () => {
  it('빈 목록은 "없음"이 아니라 미기록이라고 말한다', () => {
    expect(promptList([])).toBe(PROMPT_UNRECORDED);
    expect(promptList(undefined)).toBe(PROMPT_UNRECORDED);
    expect(promptList([null, ''])).toBe(PROMPT_UNRECORDED);
    expect(PROMPT_UNRECORDED).not.toBe('없음');
    expect(PROMPT_UNRECORDED).toContain('없음"으로 확인된 것은 아님');
    expect(promptList(['A', 'B'])).toBe('A, B');
  });

  it('알레르기 3상태를 구분한다 — 없음(확인됨)만이 "없음"이다', () => {
    expect(allergyPromptLine({ status: 'NO_KNOWN_ALLERGIES', allergies: [] })).toContain('없음(문진으로 확인됨)');
    expect(allergyPromptLine({ status: 'NOT_ASSESSED', allergies: [] })).toContain('미문진');
    expect(allergyPromptLine({ status: 'UNABLE_TO_ASSESS', allergies: [] })).toContain('확인 불가');
    expect(allergyPromptLine({ status: 'HAS_ALLERGIES', allergies: [{ allergen: '페니실린' }] })).toBe('페니실린');
    expect(allergyPromptLine(null)).toContain('조회 불가');
    // 미문진·확인불가·조회실패는 전부 "없음으로 가정하지 말 것"을 AI 에게 명시한다
    for (const st of ['NOT_ASSESSED', 'UNABLE_TO_ASSESS']) expect(allergyPromptLine({ status: st, allergies: [] })).toContain('가정하지 말 것');
    expect(allergyPromptLine(null)).toContain('가정하지 말 것');
  });
});

describe('MedicalAiService — 실제로 나간 프롬프트가 3상태를 말한다', () => {
  const mk = (allergyService: any) => {
    const config = { get: vi.fn((_k: string, d?: any) => d) };
    const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma: any = {
      systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: new Date('1970-01-01'), gender: 'FEMALE' }) },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      problemList: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      labResult: { findMany: vi.fn().mockResolvedValue([]) },
      orderSet: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new MedicalAiService(config as any, runtime as any, prisma, allergyService);
    vi.spyOn(service as any, 'getRecentLabsSummary').mockResolvedValue([]);
    const chat = vi.spyOn(service as any, 'chatLlm').mockResolvedValue('{"differentials":[]}');
    return { service, chat };
  };
  const promptOf = (chat: any) => (chat.mock.calls[0][0] as { role: string; content: string }[]).map((m) => m.content).join('\n');

  it('🔴 미문진 환자를 "알레르기: 없음"으로 전제하지 않는다(감별진단)', async () => {
    const { service, chat } = mk({ getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) });
    await service.realtimeDdx({ patientId: 'pat-1', subjective: '흉통 2시간' });
    const p = promptOf(chat);
    expect(p).not.toMatch(/알레르기: 없음\b/);
    expect(p).toContain('알레르기: 미문진');
    expect(p).toContain('활성 문제목록: ' + PROMPT_UNRECORDED);
  });

  it('문진으로 확인된 무알레르기만 "없음(문진으로 확인됨)"이라고 말한다', async () => {
    const { service, chat } = mk({ getStatus: vi.fn().mockResolvedValue({ status: 'NO_KNOWN_ALLERGIES', allergies: [] }) });
    await service.realtimeDdx({ patientId: 'pat-1', subjective: '흉통 2시간' });
    expect(promptOf(chat)).toContain('알레르기: 없음(문진으로 확인됨)');
  });

  it('상태 서비스가 없거나 실패하면 "조회 불가"라고 말한다 — 조용히 없음이 되지 않는다', async () => {
    const a = mk(undefined);
    await a.service.realtimeDdx({ patientId: 'pat-1', subjective: '흉통' });
    expect(promptOf(a.chat)).toContain('알레르기: 조회 불가');
    const b = mk({ getStatus: vi.fn().mockRejectedValue(new Error('db down')) });
    await b.service.realtimeDdx({ patientId: 'pat-1', subjective: '흉통' });
    expect(promptOf(b.chat)).toContain('알레르기: 조회 불가');
  });

  it('약물 추천: 클라가 빈 배열을 넘겨도 "없음"이 되지 않는다(빈 배열 ≠ 확인된 없음)', async () => {
    const { service, chat } = mk({ getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) });
    vi.spyOn(service as any, 'aiFetch').mockResolvedValue({ ok: false, status: 503, json: async () => ({}), text: async () => '' } as any);
    await service.recommendDrugs({ patientId: 'pat-1', diagnosis: '고혈압', patientContext: { allergies: [] } } as any).catch(() => undefined);
    // 프롬프트는 chatLlm 또는 aiFetch 어느 쪽으로든 나간다 — 나간 인자 전문을 직렬화해 검사한다
    const sent = [
      ...chat.mock.calls.map((c) => JSON.stringify(c)),
      ...((service as any).aiFetch as any).mock.calls.map((c: unknown[]) => JSON.stringify(c)),
    ].join('\n');
    expect(sent.length, '프롬프트가 아예 나가지 않았다 — 테스트가 헛돈다').toBeGreaterThan(0);
    expect(sent).not.toMatch(/알레르기: 없음\b/);
    expect(sent).toContain('알레르기: 미문진');
  });
});

describe('구조 가드 — 프롬프트 조립 층에 `|| \'없음\'` 이 되살아나지 않는다', () => {
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(full);
    }
    return out;
  };
  it('src/modules 전 범위 0건(로그 문자열 1건만 허용 목록)', () => {
    const root = path.join(__dirname, '..', '..', 'src', 'modules');
    const hits: string[] = [];
    for (const f of walk(root)) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(l)) return; // 주석(이 정본의 실측 기록 포함)은 코드가 아니다
        if (/\|\|\s*['"]없음['"]/.test(l)) hits.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
    // fhir-lab-ingest 의 logger.warn 한 줄은 프롬프트가 아니다(허용 목록은 정확한 파일로만)
    const allowed = hits.filter((h) => h.startsWith('fhir-lab/fhir-lab-ingest.service.ts:'));
    const offenders = hits.filter((h) => !allowed.includes(h));
    expect(offenders, `프롬프트에 "없음"을 접는 코드:\n${offenders.join('\n')}`).toEqual([]);
    expect(allowed.length).toBeLessThanOrEqual(1);
  });
});
