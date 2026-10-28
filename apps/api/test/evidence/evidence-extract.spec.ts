import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EvidenceExtractService } from '../../src/modules/evidence/evidence-extract.service';

/**
 * 행정 증빙 AI 판독 (2026-08-28).
 *
 * 🔴 이 축의 위험은 **그럴듯한 값을 만드는 것**과 **못 읽은 것을 조용히 넘기는 것**이다.
 *    증빙 번호를 지어내면 그 번호가 원장에 박히고, 나중에 아무도 가짜인 줄 모른다.
 */
const cfg = (enabled: unknown) => ({ get: vi.fn().mockResolvedValue(enabled) });
const ai = (content: string) => ({ extractDocumentFields: vi.fn().mockResolvedValue(content) });

describe('🔴 켜지 않으면 부르지 않는다', () => {
  it('명시적으로 껐으면 부르지 않는다', async () => {
    const svc = new EvidenceExtractService(cfg(false) as never, ai('{}') as never);
    const r = await svc.extract('/x/a.png', 'a.png', '개설신고증');
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toContain('꺼져 있습니다');
  });

  it('🔴 **미설정도 OFF** 다 — 배포만으로 문서가 나가지 않는다', async () => {
    // 🔴 명시 false 만 보는 가드는 `v !== false` 같은 역전을 통과시킨다(실제로 통과했다).
    //    설정 부재·null·문자열이 전부 OFF 여야 한다.
    // 🔴 `source` 만 보면 안 된다 — 파일이 없어 실패해도 UNAVAILABLE 이다(그렇게 한 번 헛돌았다).
    //    **이유가 게이트여야** 게이트가 일한 것이다. 그래서 실재하는 파일로 부른다.
    const real = require('path').join(process.cwd(), 'test', 'evidence', 'fixture.png');
    for (const v of [undefined, null, '', 'off', 0]) {
      const svc = new EvidenceExtractService(cfg(v) as never, ai('{"docNo":"A-1"}') as never);
      const r = await svc.extract(real, 'fixture.png', '개설신고증');
      expect(r.source, String(v)).toBe('UNAVAILABLE');
      expect(r.reason, String(v)).toContain('꺼져 있습니다');
    }
  });

  it('켜면 부른다 — 게이트가 항상 막기만 하면 그것도 거짓이다', async () => {
    const svc = new EvidenceExtractService(cfg(true) as never, ai('{"docNo":"A-1"}') as never);
    const r = await svc.extract(
      require('path').join(process.cwd(), 'test', 'evidence', 'fixture.png'), 'fixture.png', '개설신고증',
    );
    expect(r.source).toBe('AI');
  });

  it('🔴 AI 주입이 비면 조용히 빈 결과를 내지 않는다 — 배선 문제를 사실로 말한다', async () => {
    const svc = new EvidenceExtractService(cfg(true) as never, undefined);
    const r = await svc.extract('/x/a.png', 'a.png', '개설신고증');
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toContain('배선');
  });
});

describe('🔴 읽을 수 없는 것을 읽는 척하지 않는다', () => {
  it('PDF 는 판독하지 않는다 — vision 모델은 이미지만 읽는다', async () => {
    const svc = new EvidenceExtractService(cfg(true) as never, ai('{}') as never);
    const r = await svc.extract('/x/a.pdf', 'a.pdf', '개설신고증');
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toMatch(/판독할 수 없습니다/);
    expect(r.reason).toContain('직접 입력');
  });

  it('파일을 못 읽으면 실패라고 말한다 — "없음"으로 번역하지 않는다', async () => {
    const svc = new EvidenceExtractService(cfg(true) as never, ai('{}') as never);
    const r = await svc.extract('/없는경로/a.png', 'a.png', '개설신고증');
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toContain('읽지 못했습니다');
  });
});

describe('판독 결과 담기', () => {
  const tmp = join(process.cwd(), 'test', 'evidence', 'fixture.png');
  const withFile = (content: string) => {
    const svc = new EvidenceExtractService(cfg(true) as never, ai(content) as never);
    return svc;
  };

  it('정상 판독은 정본 파서로만 담는다', async () => {
    const r = await withFile(JSON.stringify({
      docNo: ' 제2026-1호 ', issuedDate: '2026-03-01', issuer: '가상시보건소', docTitle: '의료기관 개설신고증',
    })).extract(tmp, 'fixture.png', '개설신고증');
    expect(r.source).toBe('AI');
    expect(r.fields.evidenceRef).toBe('제2026-1호');
    expect(r.fields.evidenceDate).toBe('2026-03-01');
    expect(r.fields.issuer).toBe('가상시보건소');
  });

  it('🔴 형식이 다른 날짜는 담지 않는다 — 고쳐 맞추면 날짜를 지어내는 것이다', async () => {
    const r = await withFile(JSON.stringify({ docNo: 'A-1', issuedDate: '2026.03.01' }))
      .extract(tmp, 'fixture.png', '개설신고증');
    expect(r.fields.evidenceRef).toBe('A-1');
    expect('evidenceDate' in r.fields, '읽지 못한 칸은 키가 없다').toBe(false);
  });

  it('🔴 빈 값은 키를 만들지 않는다 — "읽었는데 비었다"라고 말하지 않는다', async () => {
    const r = await withFile(JSON.stringify({ docNo: '', issuedDate: '', issuer: '  ' }))
      .extract(tmp, 'fixture.png', '개설신고증');
    expect(r.source).toBe('AI');
    expect(r.fields).toEqual({});
  });

  it('🔴 결과를 이해하지 못하면 그렇게 말한다', async () => {
    const r = await withFile('죄송합니다 읽을 수 없습니다').extract(tmp, 'fixture.png', '개설신고증');
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toContain('이해하지 못했습니다');
  });

  it('🔴 AI 호출 실패를 "없음"으로 번역하지 않는다', async () => {
    const svc = new EvidenceExtractService(
      cfg(true) as never,
      { extractDocumentFields: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as never,
    );
    const r = await svc.extract(tmp, 'fixture.png', '개설신고증');
    expect(r.source).toBe('UNAVAILABLE');
    expect(r.reason).toContain('닿지 못했습니다');
  });
});

describe('🔴 소스 규약', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const SRC = strip(readFileSync(join(process.cwd(), 'src/modules/evidence/evidence-extract.service.ts'), 'utf-8'));
  const AI = strip(readFileSync(join(process.cwd(), 'src/modules/medical-ai/medical-ai.service.ts'), 'utf-8'));

  it('🔴 저장하지 않는다 — 초안만 돌려준다', () => {
    expect(SRC, '판독 서비스가 DB 를 건드리면 초안이 아니다').not.toMatch(/prisma|update\(|create\(/);
  });

  it('🔴 FALLBACK 을 만들지 않는다 — 규칙으로 번호를 추정하는 것은 날조다', () => {
    expect(SRC).not.toContain("'FALLBACK'");
  });

  it('🔴 프롬프트가 "모르면 비워라"를 명시한다 — 안 적으면 모델이 번호를 만든다', () => {
    expect(AI).toMatch(/extractDocumentFields/);
    expect(AI).toContain('추측하지 마세요');
    expect(AI).toContain('빈 문자열');
  });

  it('🔴 신분증 OCR 과 다른 함수다 — 합치면 행정 문서가 주민번호를 묻는다', () => {
    expect(AI).toMatch(/async idCardOcr/);
    expect(AI).toMatch(/async extractDocumentFields/);
  });
});
