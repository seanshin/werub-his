# 언어 팩 추가 방법 (2026-09-07)

새 언어를 넣을 때 **영역 카탈로그(`messages/*.ts`) 11개 파일을 열지 않는다.**

1. `packs/<code>.ts` 를 만든다(아래 형식).
2. `packs/index.ts` 에 한 줄 등재한다.
3. 끝. `t()`·`<T>`·StatusBadge·포맷 부품이 자동으로 그 언어를 본다.

```ts
// packs/zh.ts
import type { LocalePack } from '../pack';

export const ZH_PACK: LocalePack = {
  code: 'zh',
  label: '中文',
  dir: 'ltr',
  tag: 'zh-CN',
  // 🔴 ACTIVE 로 두면 화면 선택지에 뜬다 — 번역·검수가 준비되기 전에는 DEFERRED.
  status: 'DEFERRED',
  messages: {
    '저장': '保存',
    '취소': '取消',
    // … 키는 **한국어 원문**(동음이의는 `원문@문맥`)
  },
  verified: new Set(),      // 사람 검수 완료 키만 — 비등재는 미검수 티가 붙는다
  note: '초안 — 검수 전',
};
```

## 규약

- **부분 번역이 정상이다.** 없는 키는 한국어 원문 + 미번역 티로 나온다(지어내지 않는다).
- **키는 한국어 원문**이다. 기존 키 목록은 `scripts/i18n-draft.mjs` 로 뽑거나
  빌트인 팩(`allLocalePacks()`)의 `messages` 키를 참조한다.
- **RTL 언어**(`dir: 'rtl'`)는 팩만으로 완성되지 않는다 — 레이아웃 대응이 별도로 필요하다
  (정본 `docs/01-plan/features/ui-locale-i18n.plan.md` §8).
- 같은 `code` 로 다시 등록하면 **병합**된다(확장 팩) — 부분 보정 팩을 따로 둘 수 있다.
