import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 모델 호출 분포 · 모델 정합 카드 — 기획서 `ai-judgment-governance.plan.md` §2.2.
 *
 * 태어난 이유(실측 피해): AI 서버 이전 후 `gemma3:12b` 가 상류에 없어 컨시어지가 **상시 FALLBACK** 이었는데
 * 화면 어디에도 "우리가 부르는 모델이 서버에 없다"는 사실이 없었다.
 *
 * 이 가드가 굳히는 것은 숫자가 아니라 **세 상태를 뒤바꿔 말하지 않는가**이다:
 *   · 아직 안 온 것(로딩) ≠ 못 물어본 것(판정 불가) ≠ 진짜 0(표본 0)
 *   · 비율에는 분모가 함께 있고, 표본 0 은 0% 가 아니라 **산출 불가**다
 *   · 서버가 `available:null` 로 말한 것을 화면이 "없음"으로 번역하지 않는다
 *   · FE 가 읽는 키가 서버가 내는 키와 같다(P11 — 계약은 읽어서 맞춘다·양방향 대조)
 *
 * 재주입 검증(2026-09-09 실행 · 치환 `count==1` 확인 → 실패 확인 → 원복 → 복원 확인):
 *   (1) `{fit.available === null ? (` → `{false ? (`(판정 불가 분기 제거)         → 판정 불가 단언 실패
 *   (2) `.catch(() => setStats({ …sample: 0 }))` 로 조회 실패를 빈 통계로 접음     → catch 단언 실패
 *
 * 🔴 (1) 은 처음에 **통과했다** — 정규식 `/fit\.available === null \?/` 을 아래 행 단위 3상태의
 *    같은 표현이 대신 통과시켰다(다른 이유로 통과). 렌더 분기 문자열을 정확히 겨누도록 고쳤다.
 */
const PAGE = join(process.cwd(), 'src/app/(main)/admin/ai-settings/page.tsx');
const API_CONTROLLER = join(process.cwd(), '../api/src/modules/ai-call-log/ai-call-log.controller.ts');
const API_SERVICE = join(process.cwd(), '../api/src/modules/ai-call-log/ai-call-log.service.ts');

const page = readFileSync(PAGE, 'utf8');
const controller = readFileSync(API_CONTROLLER, 'utf8');
const service = readFileSync(API_SERVICE, 'utf8');

/**
 * 🔴 이 두 카드의 코드 구간만 잘라 본다 — 조준을 좁히는 것은 완화가 아니다.
 *    같은 파일의 **다른 갈래가 만든 카드**(AiFeedbackDashboard 는 `.catch(() => setStats(null))` 로
 *    조회 실패를 영구 로딩으로 굳힌다)를 내 가드가 대신 판정하면, 남의 결함을 내 이름으로 고치거나
 *    반대로 내 결함을 남의 코드에 묻게 된다. 그 건은 **보고**로 남긴다.
 *    (대상이 0 이 되지 않게 하한을 둔다 — 구간이 사라지면 이 가드는 헛돈다)
 */
const CARDS_START = page.indexOf('function AiCallStatsCard');
const CARDS_END = page.indexOf('// ── 하이브리드 브리핑 운영 스위치');
const cards = CARDS_START >= 0 && CARDS_END > CARDS_START ? page.slice(CARDS_START, CARDS_END) : '';

describe('카드가 화면에 실제로 붙어 있다', () => {
  it('두 카드가 패널 규약(data-panel)을 갖고 렌더된다', () => {
    expect(page).toContain('data-panel="ai-call-stats"');
    expect(page).toContain('data-panel="ai-model-fit"');
    // 정의만 하고 렌더하지 않으면 화면에는 없는 것과 같다
    expect(page).toContain('<AiCallStatsCard />');
    expect(page).toContain('<AiModelFitCard />');
  });

  it('🔴 다른 갈래(P0-D)의 R3 배지를 지우지 않았다', () => {
    expect(page).toContain('ClinicalDecisionBadge');
    expect(page).toContain("'policy.ai.clinicalFeatureScope'");
  });
});

describe('🔴 로딩 · 판정 불가 · 진짜 0 을 뒤바꿔 말하지 않는다', () => {
  it('아직 안 온 것은 "불러오는 중" 이다(기록 없음이라 말하지 않는다)', () => {
    expect(page).toMatch(/!err && !stats && <p[^>]*>\s*<T k="불러오는 중…"/);
    expect(page).toMatch(/!err && !fit && <p[^>]*>\s*<T k="불러오는 중…"/);
  });

  it('표본 0 은 0% 가 아니라 산출 불가다 — 문구는 shared 정본이 만든다', () => {
    expect(cards).toMatch(/stats\.sample === 0/);
    // 🔴 화면이 '산출 불가'를 손으로 적으면 어휘가 갈라진다(가드 clinical-ux-rules 기준선 65 동결)
    expect(cards).toContain('{RATIO_UNAVAILABLE}');
    expect(page).toContain("RATIO_UNAVAILABLE } from '@hospital-run/shared'");
    expect(cards).toContain('0% 가 아니다');
    // 아직 안 쌓인 것과 호출이 없었던 것을 구분해 말한다
    expect(cards).toContain('아직 안 쌓였다');
  });

  it('available 이 null 이면 판정하지 않는다 — missing 을 0·전부없음 어느 쪽으로도 그리지 않는다', () => {
    /**
     * 🔴 조준을 정확히 한다. 처음엔 `/fit\.available === null \?/` 로 봤는데, 재주입(그 JSX 분기를
     *    `false ?` 로 바꿈)에도 **아래 행 단위 3상태의 같은 표현이 대신 통과**했다 — 통과했지만
     *    아무것도 보증하지 않는 가드였다. 그래서 렌더 분기 자체를 겨눈다.
     */
    expect(cards, '판정 불가 렌더 분기가 사라졌다').toContain('{fit.available === null ? (');
    expect(cards).toContain('판정 불가');
    expect(cards).toContain('없다는 뜻이 아니다');
    // 행 단위로도 3상태다(보유·없음·확인 불가) — 위와 다른 자리다
    expect(cards).toMatch(/const has = fit\.available === null \? null :/);
    expect(cards).toContain('확인 불가');
  });

  it('상류가 모델을 말하지 않은 것은 "미상"이지 다른 모델이 아니다', () => {
    expect(page).toContain('미상');
    expect(page).toContain('&quot;다른 모델&quot;이 아니다');
  });
});

describe('🔴 분모를 함께 낸다', () => {
  it('성공률은 Ratio 정본으로 n/N 을 그린다(비율만 적지 않는다)', () => {
    expect(page).toMatch(/<Ratio numerator=\{r\.ok\} denominator=\{r\.calls\}/);
  });

  it('상태 분포와 표본 수를 함께 적는다', () => {
    expect(page).toMatch(/\{s\.calls\}<\/b>\/<span className="tabular-nums">\{stats\.sample\}/);
    expect(page).toMatch(/<T k="표본" \/> <b className="tabular-nums">\{stats\.sample\}<\/b>/);
  });

  it('잘랐으면 잘랐다고 말한다', () => {
    expect(page).toMatch(/stats\.rows\.length > 20/);
    expect(page).toContain('잘랐다는 사실을 적는다');
  });
});

describe('🔴 조회 실패를 기본값으로 접지 않는다', () => {
  it('가드가 겨누는 구간이 실재한다(대상 0 이면 이 파일은 아무것도 보증하지 않는다)', () => {
    expect(cards.length).toBeGreaterThan(1000);
    expect(cards).toContain('function AiModelFitCard');
  });

  it('두 카드의 catch 는 오류 상태로만 간다(빈 통계·null 로 접지 않는다)', () => {
    const catches = [...cards.matchAll(/\.catch\(\(e: \{ message\?: string \}\) => setErr\(/g)];
    expect(catches.length, '두 카드 모두 실패를 사유로 말해야 한다').toBe(2);
    // 🔴 `.catch(() => 기본값)` 은 실패를 "없음"으로 번역하는 코드다 · `setStats(null)` 은 영구 로딩이 된다
    expect(cards).not.toMatch(/\.catch\(\(\) =>/);
    expect(cards).toMatch(/setStats\(r\.data\)/);
    expect(cards).toMatch(/setFit\(r\.data\)/);
  });
});

describe('🔴 FE 가 읽는 계약이 서버가 내는 것과 같다(양방향 대조)', () => {
  it('경로가 실재한다 — 없는 EP 를 부르지 않는다', () => {
    expect(controller).toContain("@Controller('api/v1/admin/ai')");
    expect(controller).toContain("@Get('call-stats')");
    expect(controller).toContain("@Get('upstream-models')");
    expect(page).toContain('/api/v1/admin/ai/call-stats?days=');
    expect(page).toContain('/api/v1/admin/ai/upstream-models');
  });

  it('call-stats 응답 키(sample·rows·byStatusClass)를 서버가 실제로 낸다', () => {
    for (const key of ['sample', 'rows:', 'byStatusClass:', 'windowDays', 'generatedAt']) {
      expect(service, `call-stats 응답에 ${key} 가 없다`).toContain(key);
    }
    for (const key of ['calls', 'ok', 'failed', 'unknownStatus', 'mismatch']) {
      expect(service, `행 필드 ${key} 가 없다`).toContain(key);
    }
  });

  it('upstream-models 응답 키(required·available·missing·reason)를 서버가 실제로 낸다', () => {
    expect(service).toMatch(/available: null/);
    expect(service).toMatch(/missing: null/);
    expect(service).toContain('required:');
    expect(service).toContain('checkedAt');
    // 🔴 서버가 실패를 0개로 접지 않는다(FE 만 정직해도 소용없다)
    expect(service).not.toMatch(/available: \[\]\s*,\s*missing/);
  });

  it('모델 릴리즈 EP 3종이 있다(등록·목록·폐기)', () => {
    expect(controller).toContain("@Get('model-releases')");
    expect(controller).toContain("@Post('model-releases')");
    expect(controller).toContain("@Post('model-releases/:id/retire')");
  });
});
