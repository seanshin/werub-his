/**
 * 음성 쓰기(구술·스크라이브 초안) — **확인 카드를 지나고, append 정본 하나로, 출처를 남긴다**
 * (기획서 voice-emr-ambient-conversation §13.2 P0-1·P1-1 · §13.4 D1 · §13.7 · 2026-09-22).
 *
 * 무엇이 틀려 있었나(전부 코드 실측):
 *  · `VoiceEmrLauncher` 가 `dictate` outcome 을 받는 즉시 `onApplySoap('subjective', text)` — 확인 카드 없음.
 *  · 진료 화면(`encounter/new/page.tsx`)의 VoiceHub `onApplySoap` 이 `setSoap(prev => ({...prev, [field]: text}))` — **덮어쓰기**.
 *    같은 화면에 앰비언트용 append 정본 `appendSoap` 이 이미 있었다(정본 둘).
 *  · provenance 는 항상 `'SCRIBE'` 로 남았다(구술이 스크라이브로 기록됨).
 *  · `hold` 사유가 하나뿐이라 게이트 OFF 를 "다시 말씀해 주세요"로 말할 수밖에 없었다.
 *
 * 정적 검사인 이유: 결함이 "확인 카드를 **안 부르는 것**"과 "덮어쓰는 setter 를 쓰는 것"이라 렌더 테스트로는 못 본다.
 * 🔴 대조군을 둔다 — 같은 검사가 무관한 파일에서 통과하면 검사가 아무것도 겨누지 않는 것이다.
 *
 * 재주입(각각 주입 성공 확인 후): 진료 화면의 `appendSoap(field, text)` 를 `setSoap(prev => ({ ...prev, [field]: text }))` 로
 * 되돌리면 ①이, 런처 onFinal 에 `if (o.kind === 'dictate') { onApplySoap?.('subjective', o.text); return; }` 를 다시 넣으면 ②가,
 * DTO `AI_DRAFT_SOURCES` 에서 `'DICTATE'` 를 빼면 ④가 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

const WEB_SRC = path.join(__dirname, '..', '..', 'src');
const API_SRC = path.join(__dirname, '..', '..', '..', 'api', 'src');
const readWeb = (...p: string[]) => stripComments(fs.readFileSync(path.join(WEB_SRC, ...p), 'utf8')) as string;
const readApi = (...p: string[]) => stripComments(fs.readFileSync(path.join(API_SRC, ...p), 'utf8')) as string;

const PAGE = readWeb('app', '(main)', 'patients', '[id]', 'encounter', 'new', 'page.tsx');
const LAUNCHER = readWeb('components', 'voice-emr', 'VoiceEmrLauncher.tsx');
const HUB = readWeb('components', 'voice-emr', 'VoiceHub.tsx');
const BANNER = readWeb('components', 'ai', 'DraftBanner.tsx');
const DTO = readApi('modules', 'medical-ai', 'dto', 'medical-ai.dto.ts');
/** 대조군 — 음성과 무관한 부품 */
const CONTROL = readWeb('components', 'ui', 'QueryErrorFallback.tsx');

/** VoiceHub 에 넘기는 onApplySoap 블록만 잘라낸다(화면의 다른 setSoap 은 이 가드의 대상이 아니다) */
function voiceHubBlock(src: string): string {
  const start = src.indexOf('<VoiceHub');
  expect(start, '진료 화면에 VoiceHub 배선이 없다 — 가드의 전제가 깨졌다').toBeGreaterThan(-1);
  const end = src.indexOf('/>', start);
  return src.slice(start, end);
}

describe('① 진료 화면 — 음성 쓰기 소비처는 append 정본 하나(appendSoap)', () => {
  const block = voiceHubBlock(PAGE);

  it('🔴 VoiceHub onApplySoap 이 appendSoap 를 부르고, 덮어쓰기 setter 를 쓰지 않는다', () => {
    expect(block).toMatch(/appendSoap\(field, text\)/);
    expect(block, '덮어쓰기(setSoap … [field]: text)로 되돌아갔다 — 앰비언트만 append 이던 정본 둘 상태').not.toMatch(/setSoap\(\s*prev\s*=>\s*\(\{\s*\.\.\.prev,\s*\[field\]:\s*text\s*\}\)\)/);
  });

  it('appendSoap 정본은 그대로다 — 중복 문장 재부착 안 함·기존 본문 뒤에 줄바꿈으로 덧붙임', () => {
    expect(PAGE).toMatch(/const appendSoap = useCallback\(\(field: 'subjective' \| 'objective' \| 'assessment' \| 'plan', text: string\)/);
    expect(PAGE).toMatch(/if \(!add \|\| base\.includes\(add\)\) return prev;/);
  });

  it('출처는 허브가 준 것을 그대로 남긴다(구술을 SCRIBE 로 기록하지 않는다)', () => {
    expect(block).toMatch(/onApplySoap=\{\(field, text, source\)/);
    expect(block).toMatch(/markSoapDraftApplied\(source,/);
    expect(block).not.toMatch(/markSoapDraftApplied\('SCRIBE'/);
  });

  it('대조군 — 무관한 부품에는 appendSoap 도 VoiceHub 도 없다', () => {
    expect(CONTROL).not.toContain('appendSoap');
    expect(CONTROL).not.toContain('<VoiceHub');
  });
});

describe('② 런처 — 구술은 확인 카드를 지난 뒤에만 SOAP 로 간다', () => {
  it('🔴 onFinal 에서 dictate 를 onApplySoap 로 바로 보내지 않는다', () => {
    expect(LAUNCHER, '확인 카드 없이 구술을 S 에 넣던 한 줄이 돌아왔다').not.toMatch(/o\.kind === 'dictate'[\s\S]{0,80}onApplySoap/);
  });

  it('onApplySoap 은 doConfirm(확정) 안에서만 불린다 — 카드의 field 로', () => {
    const calls = LAUNCHER.match(/onApplySoap\?\.\(/g) ?? [];
    expect(calls.length, 'onApplySoap 호출 지점이 확정 경로 하나가 아니다').toBe(1);
    expect(LAUNCHER).toMatch(/if \(card\.kind === 'dictate' && card\.field\) \{\s*onApplySoap\?\.\(card\.field, \(card\.editedText \?\? card\.text\)\.trim\(\)\)/);
    // 확정 전 이중 판정 — 필드 미선택·빈 본문은 서버로도 보내지 않는다
    expect(LAUNCHER).toMatch(/if \(card\.kind === 'dictate' && \(!card\.field \|\| !\(card\.editedText \?\? card\.text\)\.trim\(\)\)\) return;/);
  });

  it('구술 outcome 은 requireConfirm(확인 카드)으로 간다 · hold 사유 DICTATE_OFF 를 "다시 말하라"로 말하지 않는다', () => {
    expect(LAUNCHER).toMatch(/store\.requireConfirm\(o\)/);
    expect(LAUNCHER).toMatch(/o\.reason === 'DICTATE_OFF'/);
    expect(LAUNCHER).toMatch(/tAttr\('구술이 관리자 설정에서 비활성 상태입니다 — 이 발화는 기록되지 않았습니다'\)/);
  });

  it('세션은 mode 를 박아 시작하지 않는다(개인 기본 모드 → 서버) · 게이트 OFF 403 은 READ 로 재시작하며 그 사실을 말한다', () => {
    expect(LAUNCHER, "항상 'read' 로 시작하면 구술은 영원히 hold 다").not.toMatch(/voiceApi\.start\(encounterId, 'read'\);\s*\n\s*sidRef/);
    expect(LAUNCHER).toMatch(/s = await voiceApi\.start\(encounterId\);/);
    expect(LAUNCHER).toMatch(/code !== 'VOICE_DICTATE_OFF' && code !== 'VOICE_ORDER_OFF'/);
    expect(LAUNCHER).toMatch(/toVoiceMode\(s\.mode\)/);
  });
});

describe('③ 허브 — 두 도구가 같은 문(onApplySoap)을 지나되 출처를 갈라 넘긴다', () => {
  it('구술은 DICTATE, 스크라이브 초안은 SCRIBE', () => {
    expect(HUB).toMatch(/onApplySoap\(f, t, 'DICTATE'\)/);
    expect(HUB).toMatch(/onApplySoap\(f, t, 'SCRIBE'\)/);
    expect(HUB).toMatch(/source: VoiceHubSoapSource\) => void/);
  });
});

describe('④ 출처 어휘 — FE DraftSource 와 서버 AI_DRAFT_SOURCES 는 집합이 같다', () => {
  const feMatch = BANNER.match(/export type DraftSource = ([^;]+);/);
  const apiMatch = DTO.match(/export const AI_DRAFT_SOURCES = \[([^\]]+)\] as const;/);

  it('🔴 한쪽에만 더하면 draft-applied 가 400 이고 배너는 "남기지 못했습니다"를 그린다', () => {
    expect(feMatch, 'FE DraftSource 선언을 찾지 못했다').not.toBeNull();
    expect(apiMatch, 'API AI_DRAFT_SOURCES 선언을 찾지 못했다').not.toBeNull();
    const fe = new Set((feMatch![1].match(/'([A-Z_]+)'/g) ?? []).map((s) => s.replace(/'/g, '')));
    const api = new Set((apiMatch![1].match(/'([A-Z_]+)'/g) ?? []).map((s) => s.replace(/'/g, '')));
    expect([...fe].sort()).toEqual([...api].sort());
    expect(fe.has('DICTATE')).toBe(true);
  });

  it('배너 라벨 맵이 DICTATE 를 든다(라벨 없는 출처는 화면에 undefined 키를 넘긴다)', () => {
    expect(BANNER).toMatch(/DICTATE: '음성 구술 초안'/);
  });
});
