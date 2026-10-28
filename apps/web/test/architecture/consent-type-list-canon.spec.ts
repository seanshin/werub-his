import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSENT_TYPE_CODES, RECORDING_CONSENT_FORBIDDEN_ASSERTIONS } from '@hospital-run/shared';

/**
 * 🔴 (2026-09-22 · voice-emr §13.2 P0-2) 서버는 `ConsentForm(consentType=RECORDING)` 행을 요구하는데
 *    동의서 워크스테이션 유형 목록에 RECORDING 이 없어 **그 행을 만들 화면이 없었다** — "데이터 0행"의 세 번째 뜻(쓰기 경로가 막혀 있다).
 *
 * 지키는 것:
 *  ① 워크스테이션 `CONSENT_TYPES` 코드 집합 == shared `CONSENT_TYPE_CODES`(= Prisma enum · shared 가드가 schema 와 대조).
 *     순서는 화면이 정하고 **집합은 정본이 정한다**. 라벨은 로컬 재정의 없이 `consentTypeText` 만.
 *  ② 외국인 등록 화면의 enum 사본이 다시 생기지 않는다(정본 둘 금지).
 *  ③ 녹음 확인 팝업(`RecordingConsentGate`)이 설치 형태를 모르면서 단정하지 않고("외부로 제공되지 않습니다" 류),
 *     서버에 남지 않는 체크박스로 버튼을 막지 않으며(가짜 게이트), 접수 화면으로 가는 링크를 갖는다.
 *  ④ 워크스테이션이 RECORDING 문안을 shared 초안 정본에서 가져오고 "검토 전" 표시를 함께 그린다.
 *
 * 재주입 검증(2026-09-22): `CONSENT_TYPES` 에서 'RECORDING' 을 빼면 ① 이 `missingOnScreen: ['RECORDING']` 로 실패한다.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const WS_PAGE = strip(read('app/(main)/workstation/consent/page.tsx'));
const FOREIGN_PAGE = strip(read('app/(main)/patients/register/foreign/page.tsx'));
const GATE = strip(read('components/scribe/RecordingConsentGate.tsx'));

/** `const CONSENT_TYPES = [ … ].map(` 의 배열 리터럴에서 코드만 */
function workstationCodes(): string[] {
  const m = WS_PAGE.match(/const CONSENT_TYPES = \[([\s\S]*?)\]\s*\.map\(/);
  if (!m) return [];
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

describe('🔴 동의서 유형 목록 — shared ConsentType 정본과 집합 일치', () => {
  it('스캔이 비면 아무것도 보증하지 않는다 — 화면 목록을 실제로 읽는다', () => {
    expect(workstationCodes().length).toBeGreaterThan(5);
    expect(CONSENT_TYPE_CODES.length).toBeGreaterThan(5);
  });

  it('① 워크스테이션 CONSENT_TYPES 코드 집합 == CONSENT_TYPE_CODES(화면에만 없는 코드 0 · 정본에 없는 코드 0)', () => {
    const screen = new Set(workstationCodes());
    const canon = new Set<string>(CONSENT_TYPE_CODES);
    const missingOnScreen = [...canon].filter((c) => !screen.has(c));
    const unknownOnScreen = [...screen].filter((c) => !canon.has(c));
    expect({ missingOnScreen, unknownOnScreen }).toEqual({ missingOnScreen: [], unknownOnScreen: [] });
  });

  it('① 라벨은 shared 정본만 — 로컬 라벨표 없음', () => {
    expect(WS_PAGE).toMatch(/\.map\(\(k\) => \(\{ k, l: consentTypeText\(k\) \}\)\)/);
    expect(WS_PAGE).not.toMatch(/const CONSENT_TYPE_LABEL\b/);
  });

  it('② 외국인 등록 화면은 enum 사본을 두지 않고 shared CONSENT_TYPE_CODES 를 쓴다', () => {
    expect(FOREIGN_PAGE).not.toMatch(/CONSENT_TYPE_ENUM\s*=\s*\[/);
    expect(FOREIGN_PAGE).toMatch(/CONSENT_TYPE_ENUM[^=]*=\s*CONSENT_TYPE_CODES/);
  });
});

describe('🔴 녹음 확인 팝업 — 설치가 실제로 하는 일만 말하고, 기록되지 않는 체크로 막지 않는다', () => {
  it('③ 설치 형태를 모르면서 하는 단정이 없다', () => {
    for (const bad of RECORDING_CONSENT_FORBIDDEN_ASSERTIONS) expect(GATE).not.toContain(bad);
  });

  it('③ 서버에 남지 않는 체크박스로 시작 버튼을 막지 않는다(가짜 게이트) — 대신 기록되지 않는다는 사실을 말한다', () => {
    expect(GATE).not.toMatch(/type="checkbox"/);
    expect(GATE).not.toMatch(/disabled=\{!checked\}/);
    expect(GATE).toContain('이 확인은 어디에도 기록되지 않습니다');
  });

  it('③ 접수 화면(동의서 워크스테이션)으로 가는 링크가 있고, 문안이 검토 전임을 말한다', () => {
    expect(GATE).toMatch(/href="\/workstation\/consent"/);
    expect(GATE).toContain('문안은 법무 검토 전 초안입니다');
  });
});

describe('🔴 워크스테이션 RECORDING 접수 — 문안은 shared 초안 정본 · 검토 전 표시가 함께 간다', () => {
  it('④ 프리필은 recordingConsentDraftText() 하나에서 온다(화면이 문안을 따로 들고 있지 않다)', () => {
    expect(WS_PAGE).toMatch(/explanation: recordingConsentDraftText\(\)/);
    for (const bad of RECORDING_CONSENT_FORBIDDEN_ASSERTIONS) expect(WS_PAGE).not.toContain(bad);
  });

  it('④ RECORDING 선택 시 "법무 검토 전 초안" 표시와 미확정 항목을 그린다', () => {
    expect(WS_PAGE).toMatch(/isRecording && \(/);
    expect(WS_PAGE).toMatch(/<T k="법무 검토 전 초안" \/>/);
    expect(WS_PAGE).toMatch(/RECORDING_CONSENT_DRAFT\.unresolved/);
  });
});
