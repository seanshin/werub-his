import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 판독 워크스테이션 WeRU.B 사전판독 — 되는 것처럼 보이게 두지 않는다(2026-08-18).
 *
 * 종전: `item.studyInstanceUid` 로 만든 WADO URL 을 `POST /api/v1/ai/vision/analyze` 로 보냈다.
 *   · `ImagingResult` 에 StudyInstanceUID 컬럼이 없어 그 값은 **항상 undefined** 였고
 *   · `/api/v1/pacs/wado` 는 HIS 인증을 요구해 외부 AI 가 가져갈 수도 없다.
 * 그런데도 AI 가 돌려준 문장이 판독보고서 소견란에 그대로 들어갔다(보지 않은 영상의 소견 — P15/P16).
 * 덤으로 환자 성명이 `clinicalInfo` 로 외부 AI 에 나갔다.
 *
 * 살아나려면 스키마·저장·바이트 전달이 함께 와야 한다. 그 전까지 화면은 **못 한다고 말한다.**
 */
const PAGE = join(process.cwd(), 'src', 'app', '(main)', 'workstation', 'reading', 'page.tsx');
const src = readFileSync(PAGE, 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('판독 화면은 성립하지 않는 사전판독을 흉내내지 않는다', () => {
  it('🔴 외부 AI 에 HIS 내부 WADO URL 을 보내지 않는다', () => {
    expect(code).not.toContain('/api/v1/pacs/wado');
    expect(code).not.toContain('/api/v1/ai/vision/analyze');
  });

  it('🔴 존재하지 않는 필드(studyInstanceUid)를 근거로 동작하지 않는다', () => {
    expect(code).not.toContain('studyInstanceUid');
  });

  it('🔴 환자 성명을 외부 AI 로 보내지 않는다', () => {
    expect(code).not.toContain('clinicalInfo');
  });

  it('🔴 AI 문장을 판독 소견 폼에 자동 주입하지 않는다', () => {
    expect(code).not.toContain('applyAiToForm');
  });

  it('사용 불가 사유를 화면에 쓴다(툴팁만이 아니라 본문에)', () => {
    expect(code).toContain('PRE_READ_UNAVAILABLE');
    expect(src).toContain('StudyInstanceUID');
    // 사유 문구가 JSX 본문으로도 렌더된다
    expect(code).toMatch(/\{PRE_READ_UNAVAILABLE\}\s*\n?\s*<\/p>/);
  });

  it('버튼은 눌리지 않는다(disabled)', () => {
    expect(code).toMatch(/사전판독[^<]*\(사용 불가\)/);
    expect(code).toMatch(/<button[^>]*disabled[^>]*>[\s\S]{0,120}사전판독/);
  });
});
