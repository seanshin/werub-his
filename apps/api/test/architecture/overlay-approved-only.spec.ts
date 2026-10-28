import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TranslationOverrideStatus } from '@prisma/client';
import { codeEntriesFor } from '../../src/modules/i18n-review/catalog-source';
import { emptyState, makeService, overrideRow, realTranslatedKey } from './i18n-review-fixture';

/**
 * 🔴 **`PROPOSED`/`REJECTED` 는 런타임에 반영되지 않는다** (정본 `i18n-human-review.plan.md` §2.2 · §4).
 *
 * 왜 가드가 필요한가: 검수 오버레이는 **화면에 나가는 글자**를 바꾸는 층이다. 미승인 제안이
 * 그대로 나가면 "검수 화면에 적어 둔 것"이 곧 "환자·직원이 보는 것"이 되고, 안전 키(KTAS·투약·격리)
 * 에서는 그것이 곧 위해다. 그래서 ①값이 실제로 어느 쪽인지 ②EP 가 상태를 고르게 두지 않는지
 * ③대조군(승인분은 정말 나가는지)을 함께 본다 — 셋 다 없으면 "다른 이유로 통과"가 된다.
 */
const SVC = join(process.cwd(), 'src/modules/i18n-review/i18n-review.service.ts');
const CTRL = join(process.cwd(), 'src/modules/i18n-review/i18n-review.controller.ts');
const DTO = join(process.cwd(), 'src/modules/i18n-review/dto/i18n-review.dto.ts');
const LOCALE = 'en';

describe('🔴 오버레이는 승인분만 런타임에 나간다', () => {
  it('스캐너 오라클 — 대상 파일과 카탈로그를 실제로 읽었다(0을 통과로 읽지 않는다)', () => {
    expect(readFileSync(SVC, 'utf8')).toContain('listOverrides');
    expect(readFileSync(CTRL, 'utf8')).toContain("@Get('overrides')");
    expect(realTranslatedKey(LOCALE).value.length).toBeGreaterThan(0);
  });

  it('런타임 EP 는 status 파라미터를 갖지 않는다 — 고를 수 있으면 언젠가 PROPOSED 가 나간다', () => {
    const dto = readFileSync(DTO, 'utf8');
    const overridesDto = /export class OverridesQueryDto \{([\s\S]*?)\n\}/.exec(dto)?.[1];
    expect(overridesDto, 'OverridesQueryDto 를 찾지 못했다(가드가 헛돈다)').toBeTruthy();
    expect(overridesDto!).not.toMatch(/\bstatus\b/);
    // 컨트롤러도 상태를 서비스로 넘기지 않는다
    expect(readFileSync(CTRL, 'utf8')).not.toMatch(/listOverrides\([^)]*status/);
  });

  it('listOverrides 는 APPROVED 로만 조회한다(실제로 넘어간 where 를 본다)', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const state = emptyState({
      overrides: [
        overrideRow({ locale: LOCALE, key, status: TranslationOverrideStatus.APPROVED, draftValue: '승인된 값' }),
        overrideRow({ id: 'p', locale: LOCALE, key: `${key}@문맥`, status: TranslationOverrideStatus.PROPOSED, draftValue: '제안된 값' }),
      ],
    });
    const r = await makeService(state).listOverrides(LOCALE);
    expect(state.overrideFindManyWhere[0]).toEqual({ locale: LOCALE, status: TranslationOverrideStatus.APPROVED });
    // 대조군 — 🔴 승인분은 **정말로 나간다**(성공을 실패로 말하지 않는다)
    expect(r.entries).toEqual([{ key, value: '승인된 값' }]);
    expect(r.entries.some((e) => e.value === '제안된 값')).toBe(false);
  });

  it('검수 목록의 "지금 화면에 나가는 값"도 승인분만 오버레이다', async () => {
    const { key, value } = realTranslatedKey(LOCALE);
    const proposed = emptyState({
      overrides: [overrideRow({ locale: LOCALE, key, status: TranslationOverrideStatus.PROPOSED, draftValue: '제안된 값' })],
    });
    const rowP = (await makeService(proposed).review({ id: 'u1', role: 'ADMIN' }, { locale: LOCALE, q: key })).rows.find((r) => r.key === key)!;
    expect(rowP, '대상 키를 목록에서 찾지 못했다').toBeTruthy();
    expect(rowP.effectiveValue).toBe(value); // 코드 초안이 그대로 나간다
    expect(rowP.effectiveOrigin).not.toBe('REVIEW_APPROVED');
    expect(rowP.overlayValue).toBe('제안된 값'); // 미리보기는 별도 칸에 있다(런타임 값이 아니다)

    const rejected = emptyState({
      overrides: [overrideRow({ locale: LOCALE, key, status: TranslationOverrideStatus.REJECTED, draftValue: '반려된 값' })],
    });
    const rowR = (await makeService(rejected).review({ id: 'u1', role: 'ADMIN' }, { locale: LOCALE, q: key })).rows.find((r) => r.key === key)!;
    expect(rowR.effectiveValue).toBe(value);

    // 대조군 — 승인이면 오버레이가 이긴다
    const approved = emptyState({
      overrides: [overrideRow({ locale: LOCALE, key, status: TranslationOverrideStatus.APPROVED, draftValue: '승인된 값' })],
    });
    const rowA = (await makeService(approved).review({ id: 'u1', role: 'ADMIN' }, { locale: LOCALE, q: key })).rows.find((r) => r.key === key)!;
    expect(rowA.effectiveValue).toBe('승인된 값');
    expect(rowA.effectiveOrigin).toBe('REVIEW_APPROVED');
  });

  /* ── §2.4 "이 키는 번역하지 않는다" — 빈 값이 승인으로 새지 않는다 ─────────────── */

  it('🔴 빈 draftValue 는 승인할 수 없다 — 승인되면 빈 문자열이 화면에 나간다', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const state = emptyState({
      reviewersConfig: { [LOCALE]: ['r1'] },
      overrides: [
        overrideRow({
          id: '00000000-0000-4000-9000-0000000000e1',
          locale: LOCALE,
          key,
          status: TranslationOverrideStatus.REJECTED,
          draftValue: '', // "번역하지 않음"의 표현
        }),
      ],
    });
    const svc = makeService(state);
    await expect(svc.decide({ id: 'r1', role: 'DOCTOR' }, '00000000-0000-4000-9000-0000000000e1', 'APPROVED')).rejects.toThrow();
    expect(state.overrides[0].status).toBe(TranslationOverrideStatus.REJECTED); // 상태도 안 바뀐다
    // 공백만 있는 값도 같다(trim)
    state.overrides[0].draftValue = '   ';
    await expect(svc.decide({ id: 'r1', role: 'DOCTOR' }, '00000000-0000-4000-9000-0000000000e1', 'APPROVED')).rejects.toThrow();
    // 대조군 — 값이 있으면 승인된다(성공을 실패로 말하지 않는다)
    state.overrides[0].draftValue = '실제 교정값';
    const ok = await svc.decide({ id: 'r1', role: 'DOCTOR' }, '00000000-0000-4000-9000-0000000000e1', 'APPROVED');
    expect(ok.status).toBe(TranslationOverrideStatus.APPROVED);
  });

  it('🔴 키만으로 반려한 행은 런타임 오버레이에 나가지 않는다(빈 값이 새지 않는다)', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const state = emptyState({ reviewersConfig: { [LOCALE]: ['r1'] } });
    const svc = makeService(state);
    const r = await svc.rejectKey({ id: 'r1', role: 'DOCTOR' }, { locale: LOCALE, key, reason: '안전 키 — 원문+티로 둔다' });
    expect(r.status).toBe(TranslationOverrideStatus.REJECTED);
    expect(state.overrides[0].draftValue).toBe('');
    const runtime = await svc.listOverrides(LOCALE);
    expect(runtime.entries).toEqual([]); // 승인분이 아니므로 애초에 나가지 않는다
  });

  it('🔴 "번역하지 않음"은 기록이지 적용이 아니다 — 코드 초안이 남으면 그렇게 말한다', async () => {
    const { key, value } = realTranslatedKey(LOCALE); // 코드에 값이 **있는** 키
    const state = emptyState({ reviewersConfig: { [LOCALE]: ['r1'] } });
    const svc = makeService(state);
    const r = await svc.rejectKey({ id: 'r1', role: 'DOCTOR' }, { locale: LOCALE, key, reason: '오역 위해 — 번역하지 않는다' });
    expect(r.appliedToRuntime).toBe(false);
    expect(r.codeStillShows).toBe(true);
    expect(r.codeValue).toBe(value);
    expect(r.appliedNote).toContain('적용되지는 않았습니다');
    // 통계가 그 수를 분모와 함께 센다 — 안 세면 "N건 번역 안 함"과 화면이 모순된다
    const s = await svc.stats(LOCALE);
    expect(s.noTranslate).toBe(1);
    expect(s.noTranslateButCodeStillShows).toBe(1);
    expect(s.translated + s.untranslated).toBe(s.catalogTotal);
    // 목록도 어휘를 준다(FE 가 `overlayValue: ''` 를 "값 있음"으로 읽지 않게)
    const row = (await svc.review({ id: 'r1', role: 'DOCTOR' }, { locale: LOCALE, q: key })).rows.find((x) => x.key === key)!;
    expect(row.noTranslate).toBe(true);
    expect(row.effectiveValue).toBe(value); // 화면에는 여전히 코드 초안이 나간다(사실 그대로)
  });

  /**
   * 🔴 "번역 있음"의 계수 규칙 — **판별력이 있는 표본에서** 잰다.
   *
   *    첫 판은 `en` 에서 재고 "오버레이 없는 서비스의 stats" 와 비교했다. `en` 은 **전건 번역**이라
   *    계수 규칙을 `else translated++` 로 망가뜨려도 값이 그대로였고, 비교 대상도 똑같이 틀려
   *    **가드가 통과했다**(재주입 역검증이 그 자리를 잡았다). 전건이 정상인 표본에서는 탐지기가
   *    작동하는지 알 수 없다 — 그래서 미번역이 남아 있는 언어에서 재고, 판별력 자체를 단언한다.
   */
  it('🔴 "번역 있음"은 코드 값이 있는 키만 센다(부분 번역 언어에서 잰다)', async () => {
    const partial = ['ar', 'th', 'vi', 'zh', 'ru', 'kk', 'mn'].find((l) => {
      const vals = [...codeEntriesFor(l).values()];
      return vals.some((c) => c.value == null) && vals.some((c) => c.value != null);
    });
    expect(partial, '부분 번역 언어를 찾지 못했다 — 전건 번역 언어에서는 이 대조가 아무것도 보증하지 않는다').toBeTruthy();
    const codeTranslated = [...codeEntriesFor(partial!).values()].filter((c) => c.value != null).length;
    const s = await makeService(emptyState()).stats(partial!);
    expect(s.translated).toBe(codeTranslated);
    expect(s.translated, '표본에 미번역이 없으면 이 단언은 판별력이 없다').toBeLessThan(s.catalogTotal);
    expect(s.translated + s.untranslated).toBe(s.catalogTotal);
  });

  it('🔴 reject-key 도 카탈로그에 없는 키는 받지 않는다(propose 와 같은 400)', async () => {
    const state = emptyState({ reviewersConfig: { [LOCALE]: ['r1'] } });
    const svc = makeService(state);
    await expect(
      svc.rejectKey({ id: 'r1', role: 'DOCTOR' }, { locale: LOCALE, key: '카탈로그에 없는 키 zzz', reason: '사유' }),
    ).rejects.toMatchObject({ response: { code: 'I18N_UNKNOWN_KEY' } });
    expect(state.overrides).toEqual([]); // 행을 만들지 않았다
  });

  it('기존 제안이 있으면 draftValue·제안자 근거를 덮지 않고 기존 결정 경로로 흐른다', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const state = emptyState({
      reviewersConfig: { [LOCALE]: ['r1'] },
      overrides: [
        overrideRow({
          id: '00000000-0000-4000-9000-0000000000e2',
          locale: LOCALE,
          key,
          status: TranslationOverrideStatus.PROPOSED,
          draftValue: '제안된 교정값',
          note: '제안자가 적은 근거',
          proposedBy: 'r2',
        }),
      ],
    });
    const svc = makeService(state);
    const r = await svc.rejectKey({ id: 'r1', role: 'DOCTOR' }, { locale: LOCALE, key, reason: '이 키는 번역하지 않는다' });
    expect(r.createdRow).toBe(false);
    expect(state.overrides).toHaveLength(1); // 새 행을 만들지 않았다
    expect(state.overrides[0].draftValue).toBe('제안된 교정값'); // 🔴 덮지 않는다
    expect(state.overrides[0].note).toBe('제안자가 적은 근거');
    expect(state.overrides[0].status).toBe(TranslationOverrideStatus.REJECTED);
    expect(state.transitions.at(-1)!.reason).toBe('이 키는 번역하지 않는다');
  });

  it('제안은 "저장됐지만 반영되지 않았다"를 응답이 말한다(기록 ≠ 적용)', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const state = emptyState({ reviewersConfig: { [LOCALE]: ['u1'] } });
    const r = await makeService(state).propose({ id: 'u1', role: 'DOCTOR' }, { locale: LOCALE, key, value: '새 값' });
    expect(r.status).toBe(TranslationOverrideStatus.PROPOSED);
    expect(r.appliedToRuntime).toBe(false);
    expect(r.appliedNote).toContain('반영되지 않습니다');
  });
});
