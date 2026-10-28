import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tOf } from '@hospital-run/shared';
import { UIPARTS_MESSAGES } from '@hospital-run/shared/dist/i18n/messages/uiparts';
// 계측 규칙 정본은 스캐너 하나 — 수치를 두 곳에 적으면 갈라진다(`scripts/i18n-unwired-scan.mjs`).
import { stripComments, stripI18nKeys } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **공용 표시 부품 i18n 배선 가드** — 2026-09-09 P3 라운드 3.
 *
 * 왜 이 가드가 있는가: 화면을 아무리 배선해도 **숫자 옆 단위어와 3상태 문구**는 부품 안에 있어
 * 한국어로 남았다(운영 스크린샷 실측). 화면 갈래 6기가 전부 "공용 컴포넌트 잔여 한글"로 보고했지만
 * 소유가 아니라 손대지 못한 자리다. 여기서 그 부품들을 못박는다.
 *
 * 무엇을 못박는가:
 *  (a) 소유 파일별 **한글 JSX 텍스트 노드 잔여 수 정확 동결**(여유 0 — 늘면 실패·줄면 기준선을 낮춘다).
 *  (b) 대표 키가 **실제로 조회된다**(`tOf` 실행 — 배선만 하고 카탈로그가 빈 상태를 막는다).
 *  (c) 🔴 **죽은 키 0** — `tOf` 는 먼저 등록된 카탈로그가 이기므로, 앞 영역에 이미 있는 원문을
 *      uiparts 에 또 적으면 그 정의는 영원히 조회되지 않는다. 실행으로 판정한다(수기 대조 금지).
 *  (d) 🔴 **고아 키 0** — 카탈로그에만 있고 **소스 어디서도 쓰지 않는 키**를 막는다.
 *      (c)의 거울이다: (c)는 "써도 안 보이는 정의", (d)는 "아무도 부르지 않는 정의".
 *  (e) 🔴 **단위어 계약** — 부품이 `@단위` 문맥 키만 보고 **맨 키로 폴백하지 않는다**.
 *      맨 키 `시간`→'Time'·`원`→'KRW' 라, 폴백했다면 `5시간 52분`→`5Time 52min` 이 되고
 *      **locked 통화 표기**가 바뀐다. 이 가드는 그 폴백이 되살아나는 것을 막는다.
 *  (f) 🔴 **통화·수치 불변** — `Money`/`MoneyText`/`Num` 이 단위 조회를 지나지 않는다.
 *
 * 🔴 대조군을 함께 둔다 — 대상이 0 이면 통과가 아무것도 보증하지 않는다.
 */
const WEB_SRC = resolve(process.cwd(), 'src');
const read = (f: string) => readFileSync(join(WEB_SRC, f), 'utf8');

/** 소유 파일 — 이 갈래가 배선한 공용 표시 부품 12 */
const OWNED = [
  'components/ui/display.tsx',
  'components/ui/StatCard.tsx',
  'components/ui/PageHeader.tsx',
  'components/ui/QueryErrorFallback.tsx',
  'components/ui/ConfirmDialog.tsx',
  'components/ui/ReasonInput.tsx',
  'components/ui/PatientSelector.tsx',
  'components/ui/StatusBadge.tsx',
  'components/nursing/MedDoubleCheck.tsx',
  'components/ai/NursingAiDraftPanel.tsx',
  'components/governance/ProposeAgendaModal.tsx',
  'components/notification/PatientNotifyConfirm.tsx',
] as const;

/**
 * 2026-09-09 실측 — 한글 JSX 텍스트 노드 잔여(배선 후). 🔴 **여유를 두지 않는다.**
 *
 * 0 이 아닌 셋은 **왜 남겼는지**가 분명한 자리다(수를 올려 덮은 것이 아니다):
 *  · `display.tsx` 1 = `<Unit>일</Unit>` — 스캐너에는 한글로 보이지만 부품이 런타임에
 *    `일@단위`(→'days')로 바꿔 그린다. **소스가 한국어인 것이 정상**이다(원문이 키다).
 *  · `MedDoubleCheck.tsx` 2 · `ProposeAgendaModal.tsx` 3 = 문장 안에 `<b>` 강조가 있어
 *    키 하나로 만들 수 없는 자리(쪼개면 뜻이 무너지고, 강조를 지우면 ko 화면이 바뀐다).
 */
const JSX_KO_BASELINE: Record<string, number> = {
  'components/ui/display.tsx': 1,
  'components/ui/StatCard.tsx': 0,
  'components/ui/PageHeader.tsx': 0,
  'components/ui/QueryErrorFallback.tsx': 0,
  'components/ui/ConfirmDialog.tsx': 0,
  'components/ui/ReasonInput.tsx': 0,
  'components/ui/PatientSelector.tsx': 0,
  'components/ui/StatusBadge.tsx': 0,
  'components/nursing/MedDoubleCheck.tsx': 2,
  'components/ai/NursingAiDraftPanel.tsx': 0,
  'components/governance/ProposeAgendaModal.tsx': 3,
  'components/notification/PatientNotifyConfirm.tsx': 0,
};

/** JSX 텍스트 노드만 — 문자열 리터럴(Record 값·비교값)은 제외한다(계측 규칙과 동일) */
function jsxKoFragments(src: string): string[] {
  const noc = stripI18nKeys(stripComments(src));
  const out = new Set<string>();
  for (const m of noc.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)) {
    const s = m[1].trim();
    if (s) out.add(s);
  }
  return [...out];
}

/** 대표 키 — 파일마다 그 부품이 실제로 쓰는 원문 하나 */
const SAMPLES: [string, string][] = [
  ['components/ui/display.tsx', '아직 없음'],
  ['components/ui/display.tsx', '분모 미상'],
  ['components/ui/PatientSelector.tsx', '오늘 내 환자'],
  ['components/nursing/MedDoubleCheck.tsx', '독립 이중확인 필요 (IPSG.3)'],
  ['components/ai/NursingAiDraftPanel.tsx', '초안 신뢰도 낮음 — 면밀히 검토하세요.'],
  ['components/governance/ProposeAgendaModal.tsx', '안건 제목 *'],
  ['components/notification/PatientNotifyConfirm.tsx', '환자 앱으로 알림도 보낼까요?'],
];

describe('🔴 공용 표시 부품 — UI 언어 배선(uiparts)', () => {
  it('대조군 — 소유 파일이 실제로 존재하고 <T>/tAttr 로 배선돼 있다(대상 0이면 이 가드는 헛돈다)', () => {
    expect(OWNED.length).toBe(12);
    for (const f of OWNED) {
      const noc = stripComments(read(f));
      const wired = (noc.match(/<T[\s>]/g) || []).length + (noc.match(/tAttr\(/g) || []).length + (noc.match(/tOf\(/g) || []).length;
      expect(wired, `${f} 이 배선돼 있지 않다`).toBeGreaterThan(0);
    }
  });

  it('(a) 파일별 한글 JSX 텍스트 노드 잔여가 기준선과 **정확히** 일치한다(늘면 실패·줄면 기준선을 낮춘다)', () => {
    const actual: Record<string, number> = {};
    for (const f of OWNED) actual[f] = jsxKoFragments(read(f)).length;
    expect(actual).toEqual(JSX_KO_BASELINE);
  });

  it('(b) 대표 키가 세 언어 모두에서 실제로 조회된다(배선만 하고 카탈로그가 빈 상태를 막는다)', () => {
    for (const [file, key] of SAMPLES) {
      for (const loc of ['en', 'ja', 'ar'] as const) {
        const r = tOf(key, loc);
        expect(r.missing, `${file}: ${JSON.stringify(key)} 가 ${loc} 에 없다`).toBe(false);
        expect(r.text.trim(), `${file}: ${JSON.stringify(key)} 의 ${loc} 값이 비어 있다`).not.toBe('');
      }
    }
  });

  it('(c) 🔴 죽은 키 0 — uiparts 의 모든 키가 실제로 uiparts 값으로 조회된다', () => {
    const dead: string[] = [];
    for (const [key, val] of Object.entries(UIPARTS_MESSAGES.en ?? {})) {
      // 앞 영역이 같은 원문을 선점했다면 tOf 는 그쪽 값을 준다 = 이 정의는 죽었다
      if (tOf(key, 'en').text !== val) dead.push(`${key} → 실제 '${tOf(key, 'en').text}' (uiparts 는 '${val}')`);
    }
    expect(Object.keys(UIPARTS_MESSAGES.en ?? {}).length, '카탈로그가 비면 이 검사는 헛돈다').toBeGreaterThan(50);
    expect(dead, `앞 카탈로그가 선점해 조회되지 않는 정의:\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('(d) 🔴 고아 키 0 — 카탈로그 키가 전부 web 소스 어딘가에서 쓰인다', () => {
    const files: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|ts)$/.test(e.name)) files.push(relative(WEB_SRC, p));
      }
    })(WEB_SRC);
    expect(files.length, '소스를 훑지 못했습니다 — 검사가 헛돕니다').toBeGreaterThan(500);
    /**
     * 🔴 **shared 정본도 키를 만든다**(2026-09-10) — 상대시각(`freshnessRelative`)이 `{초}초 전` 같은
     *    키를 돌려주고 화면은 변수로 받아 그린다. web 만 훑으면 그 키들이 "아무도 안 쓰는 키"로 보인다.
     *    범위를 좁게 잡아 정당한 키를 고아로 잡으면, 다음 사람이 **키를 지우는 쪽으로** 고친다.
     */
    const SHARED_SRC = resolve(process.cwd(), '..', '..', 'packages', 'shared', 'src');
    const sharedFiles: string[] = [];
    (function walkShared(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkShared(p);
        else if (/\.ts$/.test(e.name)) sharedFiles.push(p);
      }
    })(SHARED_SRC);
    expect(sharedFiles.length, 'shared 소스를 훑지 못했습니다').toBeGreaterThan(20);
    // 🔴 카탈로그 파일 자신은 제외한다 — 카탈로그에 있다는 사실로 "쓰인다"고 말하면 검사가 무의미해진다
    const sharedCode = sharedFiles
      .filter((f) => !f.includes(`${join('i18n', 'messages')}`) && !f.includes(`${join('i18n', 'packs')}`))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const all = files.map((f) => read(f)).join('\n') + '\n' + sharedCode;
    const orphans = Object.keys(UIPARTS_MESSAGES.en ?? {}).filter((k) => {
      // `원문@문맥` 키는 원문만 소스에 있을 수도 있다(부품이 접미를 붙여 조회) — 둘 다 본다
      // 🔴 `@` 로 **시작하는** 키는 bare 가 빈 문자열이 되어 `includes('')` 가 늘 true → 무조건 통과였다.
      //    재주입으로 적발(2026-09-10): 그 상태에서는 어떤 고아 키든 `@` 를 앞에 붙이면 검사를 빠져나간다.
      const at = k.lastIndexOf('@');
      const bare = at > 0 ? k.slice(0, at) : k;
      return !all.includes(k) && !(bare && all.includes(bare));
    });
    expect(orphans, `카탈로그에만 있고 아무도 부르지 않는 키:\n  ${orphans.join('\n  ')}`).toEqual([]);
  });

  it('(e) 🔴 단위어는 `@단위` 문맥 키만 본다 — 맨 키 폴백이 되살아나지 않는다', () => {
    const s = stripComments(read('components/ui/display.tsx'));
    const fn = /function useUnitWord\(\)[\s\S]{0,600}?\n}/.exec(s)?.[0] ?? '';
    expect(fn, 'useUnitWord 를 찾지 못했습니다 — 검사가 헛돕니다').not.toBe('');
    expect(fn, '`@단위` 문맥 키로 조회해야 한다').toMatch(/@단위/);
    // 🔴 맨 키로 한 번 더 조회하면(폴백) `시간`→'Time'·`원`→'KRW' 가 새어 들어온다
    expect((fn.match(/tOf\(/g) || []).length, '조회는 한 번뿐이어야 한다(맨 키 폴백 금지)').toBe(1);
    expect(fn, '미등록이면 한국어 원문을 그대로 돌려줘야 한다').toMatch(/if \(r\.missing\) return u;/);

    // 실행으로도 확인한다 — 소스 모양이 아니라 사실을 본다
    expect(tOf('시간@단위', 'en').text).toBe('hours');
    expect(tOf('시간', 'en').text, '맨 키는 시각 열 머리글 뜻이다 — 단위로 쓰면 안 된다').toBe('Time');
    expect(tOf('원@단위', 'en').missing, '통화 접미는 등재하지 않는다(locked)').toBe(true);
  });

  it('(f) 🔴 통화·수치 표기는 언어와 무관하게 불변 — Money/MoneyText/Num 은 단위 조회를 지나지 않는다', () => {
    const s = stripComments(read('components/ui/display.tsx'));
    for (const name of ['Money', 'MoneyText', 'Num']) {
      const body = new RegExp(`export function ${name}\\(\\{[\\s\\S]{0,1400}?\\n\\}`).exec(s)?.[0] ?? '';
      expect(body, `${name} 본문을 찾지 못했습니다 — 검사가 헛돕니다`).not.toBe('');
      expect(body, `${name} 이 단위어 조회를 타면 locked 통화·수치 표기가 언어에 따라 바뀐다`)
        .not.toMatch(/useUnitWord/);
    }
    // 🔴 대조군 — 조회를 타야 하는 쪽은 실제로 타고 있다(둘 다 통과하면 이 검사는 무의미하다)
    expect(s).toMatch(/export function Unit\(\{[\s\S]{0,600}?useUnitWord\(\)/);
    expect(s).toMatch(/export function UnitText\(\{[\s\S]{0,900}?useUnitWord\(\)/);
  });

  it('🔴 3상태 정직성 어휘가 서로 다른 말로 번역돼 있다 — 뭉개지면 화면이 거짓말을 한다', () => {
    const keys = ['기록 없음', '해당 없음', '아직 없음', '산출 불가', '분자 미집계', '분모 미상'];
    for (const loc of ['en', 'ja'] as const) {
      const texts = keys.map((k) => tOf(k, loc).text);
      for (const [i, t] of texts.entries()) expect(t, `${keys[i]}(${loc}) 미등재`).not.toBe(keys[i]);
      expect(new Set(texts).size, `${loc}: 3상태 어휘가 겹친다 — ${texts.join(' / ')}`).toBe(keys.length);
    }
  });
});
