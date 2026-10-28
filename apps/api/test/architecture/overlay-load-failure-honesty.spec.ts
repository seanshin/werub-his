import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { applyReviewOverlay, __resetReviewOverlayKeysForTest, registerLocalePack, getLocalePack } from '@hospital-run/shared';
import { emptyState, makeService, realTranslatedKey } from './i18n-review-fixture';

/**
 * 🔴 **오버레이를 불러오지 못한 것을 "오버레이 없음"으로 번역하지 않는다**
 *    (정본 `i18n-human-review.plan.md` §2.2 · §4).
 *
 * 이 저장소의 실측: `.catch(() => 기본값)` 전수 24개소 중 **16개가 실결함**이었고, 그 전부가
 * "실패"를 "없음"으로 바꿔 말하고 있었다. 오버레이 축에서 그 번역이 일어나면
 * ①검수자가 승인한 값이 안 나가는데 아무도 모르고 ②권한을 못 읽었는데 "검수자 0명"이라 말한다.
 */
const MOD_DIR = join(process.cwd(), 'src/modules/i18n-review');
const OVERLAY_SRC = join(process.cwd(), '../../packages/shared/src/i18n/overlay.ts');
const LOCALE = 'en';

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('🔴 오버레이 조회 실패를 "없음"으로 번역하지 않는다', () => {
  it('스캐너 오라클 — 검사 대상 파일을 실제로 읽었다', () => {
    const files = tsFiles(MOD_DIR);
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(readFileSync(OVERLAY_SRC, 'utf8')).toContain('applyReviewOverlay');
  });

  it('모듈 어디에도 `.catch(() => 기본값)` 이 없다', () => {
    for (const f of [...tsFiles(MOD_DIR), OVERLAY_SRC]) {
      const src = readFileSync(f, 'utf8');
      // 실패를 조용히 값으로 바꾸는 형태 — `.catch(() => …)` / `.catch(() => ({}))` / `.catch(() => [])`
      expect(src, `${f} 가 실패를 기본값으로 번역한다`).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>/);
      expect(src, `${f} 가 실패를 기본값으로 번역한다`).not.toMatch(/\.catch\(\s*\(?\s*_?\w*\s*\)?\s*=>\s*(\[\]|\{\}|0|null|undefined)\s*\)/);
    }
  });

  it('설정 조회가 실패하면 검수자 수는 null 이고 화면이 이유를 말한다(0 이 아니다)', async () => {
    const failing = makeService(emptyState({ reviewersConfig: 'throw' }));
    const p = await failing.permissionFor({ id: 'u1', role: 'DOCTOR' }, LOCALE);
    expect(p.reviewerCount).toBeNull(); // 🔴 0 이면 "지정된 검수자가 없다"는 다른 사실이 된다
    expect(p.reason).toContain('읽지 못했습니다');
    expect(p.canPropose).toBe(false); // 판정 불가는 안전측으로 접는다 — 그러나 이유를 말한다
    expect(p.canApprove).toBe(false);
  });

  it('대조군 — 조회에 성공했고 지정이 없으면 0 이라고 말한다(실패와 다른 문구)', async () => {
    const ok = makeService(emptyState({ reviewersConfig: null }));
    const p = await ok.permissionFor({ id: 'u1', role: 'DOCTOR' }, LOCALE);
    expect(p.reviewerCount).toBe(0);
    expect(p.reason).toContain('지정되지 않았습니다');
    expect(p.reason).not.toContain('읽지 못했습니다');

    const named = makeService(emptyState({ reviewersConfig: { [LOCALE]: ['u1'] } }));
    const p2 = await named.permissionFor({ id: 'u1', role: 'DOCTOR' }, LOCALE);
    expect(p2.reviewerCount).toBe(1);
    expect(p2.canPropose).toBe(true); // 되는 사람은 된다고 말한다
  });

  it('문맥 결손을 산출할 수 없는 언어는 0 이 아니라 null + 사유다', async () => {
    const svc = makeService(emptyState());
    const s = await svc.stats('zz'); // 팩이 없는 언어
    expect(s.contextGaps).toBeNull();
    expect(s.contextGapsUnavailableReason).toContain('산출할 수 없습니다');
    // 대조군 — 팩이 있는 언어는 실제 수를 준다(사유는 없다)
    const en = await svc.stats(LOCALE);
    expect(typeof en.contextGaps).toBe('number');
    expect(en.contextGapsUnavailableReason).toBeNull();
  });

  it('검수 목록의 "쓰이는 곳"은 셀 수 없으면 빈 배열이 아니라 null + 사유다', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const r = await makeService(emptyState()).review({ id: 'u1', role: 'ADMIN' }, { locale: LOCALE, q: key });
    // 🔴 available 이 false 인데 사유가 없으면 "셀 수 없었다"를 말하지 못한다
    if (!r.meta.usage.available) {
      expect(r.meta.usage.unavailableReason).toBeTruthy();
      expect(r.rows[0]?.usedIn ?? null).toBeNull();
    } else {
      expect(r.meta.usage.scannedFiles).toBeGreaterThan(0);
      expect(Array.isArray(r.rows[0]?.usedIn)).toBe(true);
    }
  });

  it('shared 오버레이 — 팩이 없으면 조용히 성공하지 않는다(NO_PACK)', () => {
    __resetReviewOverlayKeysForTest();
    const r = applyReviewOverlay('zz', [{ key: '화면 언어', value: 'X' }]);
    expect(r.reason).toBe('NO_PACK');
    expect(r.applied).toBe(0);
    // 🔴 팩을 **지어내지 않는다** — 지어내면 번역 없는 언어가 선택지에 뜬다
    expect(getLocalePack('zz')).toBeUndefined();
  });

  it('shared 오버레이 — 회수되지 않은 키를 조용히 두지 않는다(staleKeys)', () => {
    __resetReviewOverlayKeysForTest();
    registerLocalePack({ code: 'zzt', label: 'zzt', dir: 'ltr', tag: 'en', status: 'DEFERRED', messages: { A: 'a', B: 'b' } });
    const first = applyReviewOverlay('zzt', [
      { key: 'A', value: '검수A' },
      { key: 'B', value: '검수B' },
    ]);
    expect(first.reason).toBe('APPLIED');
    expect(first.applied).toBe(2);
    expect(first.staleKeys).toEqual([]); // 대조군: 처음엔 회수 대상이 없다
    // B 의 승인이 취소된 뒤 다시 적용하면 — 팩 병합은 값을 되돌리지 못한다. 그 사실을 말한다.
    const second = applyReviewOverlay('zzt', [{ key: 'A', value: '검수A2' }]);
    expect(second.staleKeys).toEqual(['B']);
    expect(getLocalePack('zzt')!.messages.B).toBe('검수B'); // 실제로 옛 값이 남아 있다(그래서 말해야 한다)
  });
});
