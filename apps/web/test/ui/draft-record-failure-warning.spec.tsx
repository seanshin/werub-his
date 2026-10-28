/**
 * 🔴 (2026-09-15 T2) AI 초안 적용 기록 실패를 **결정 시점**에 숨기지 않는다 + 사전오더 DUR 재검증 실패 경고.
 *
 * 실측: 협진 의뢰 전송(ReferralTab)·MDT 요약 저장·동의서 생성은 `recordDraftApplied(...)` 의 반환값(기록 성공 여부)을
 * 버리고 곧바로 초안 배너를 지웠다 → 배너가 `recorded === false` 를 그릴 기회도 사라져
 * "AI 초안에서 출발한 기록"이 감사·제안 원장에서 빠진 사실이 어디에도 보이지 않았다.
 * 정본 헬퍼 `warnIfDraftNotRecorded` 한 곳에서 비차단 경고를 띄운다(성공이면 침묵 — 대조군).
 *
 * 배너가 계속 떠 있는 적용 시점 호출(진료 SOAP·퇴원요약·동의서 초안 적용)은 배너가 `recorded` 로 이미 말하므로 대상이 아니다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const toastWarning = vi.fn();
vi.mock('@/stores/toast-store', () => ({ toast: { warning: (m: string) => toastWarning(m), success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api-client', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/lib/ai-proposal', () => ({ decideProposal: vi.fn() }));

import { warnIfDraftNotRecorded, DRAFT_NOT_RECORDED_TEXT } from '@/components/ai/DraftBanner';

const SRC = join(__dirname, '..', '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

describe('warnIfDraftNotRecorded — 기록 실패는 경고, 성공은 침묵', () => {
  beforeEach(() => toastWarning.mockReset());

  it('🔴 recorded=false → 번역을 거친 경고 1회', () => {
    const translate = vi.fn((k: string) => `EN:${k}`);
    expect(warnIfDraftNotRecorded(false, translate)).toBe(false);
    expect(translate).toHaveBeenCalledWith(DRAFT_NOT_RECORDED_TEXT);
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledWith(`EN:${DRAFT_NOT_RECORDED_TEXT}`);
  });

  it('대조군 — recorded=true 면 아무 말도 하지 않는다', () => {
    expect(warnIfDraftNotRecorded(true, (k) => k)).toBe(true);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('경고 문장은 배너의 실패 문장과 같은 키다(같은 사실에 문장 둘을 두지 않는다)', () => {
    const banner = read('components', 'ai', 'DraftBanner.tsx');
    expect(banner).toContain(`<T k="${DRAFT_NOT_RECORDED_TEXT}" />`);
  });
});

/** 마커 다음 `recordDraftApplied({` 호출의 짝 괄호 끝 뒤 200자 — 반환값을 헬퍼로 넘기는지 본다 */
function afterCall(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return '';
  const open = src.indexOf('(', src.indexOf('recordDraftApplied', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(at, i + 220); }
  }
  return '';
}

describe('결정 시점 호출부가 기록 결과를 버리지 않는다', () => {
  const sites: Array<{ name: string; file: string[]; marker: string }> = [
    { name: '협진 의뢰 전송', file: ['app', '(main)', 'patients', '[id]', 'components', 'ReferralTab.tsx'], marker: "clientContext: 'ReferralTab/협진 의뢰 전송'" },
    { name: 'MDT 요약 저장', file: ['app', '(main)', 'mdt', 'page.tsx'], marker: "clientContext: 'mdt/요약 저장'" },
    { name: '동의서 생성', file: ['app', '(main)', 'workstation', 'consent', 'page.tsx'], marker: 'consent-form:${createdId}' },
  ];
  for (const s of sites) {
    it(`🔴 ${s.name} — warnIfDraftNotRecorded 로 결과를 넘긴다`, () => {
      const src = read(...s.file);
      // 마커가 호출 안쪽이라 호출 시작부터 다시 잡는다
      const callStart = src.lastIndexOf('recordDraftApplied(', src.indexOf(s.marker));
      expect(callStart, `${s.name}: 호출을 찾지 못했다 — 파서가 헛돈다`).toBeGreaterThan(0);
      const chunk = afterCall(src, src.slice(callStart, callStart + 30));
      expect(chunk, `${s.name}: 호출 조각이 비었다`).not.toBe('');
      expect(chunk).toMatch(/warnIfDraftNotRecorded\(recorded,\s*tAttr\)/);
    });
  }
});

describe('사전오더 승인 — DUR 재검증 실패를 화면이 말한다', () => {
  it('🔴 PreOrderBanner 가 durCheck.status FAILED 에 경고를 띄운다', () => {
    const src = read('app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components', 'PreOrderBanner.tsx');
    expect(src).toMatch(/durCheck\?\.status/);
    expect(src).toMatch(/if \(durStatus === 'FAILED'\) \{\s*toast\.warning\(/);
  });
});
