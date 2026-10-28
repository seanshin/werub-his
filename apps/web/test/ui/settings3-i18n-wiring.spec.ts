import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tOf } from '@hospital-run/shared';
// 계측 규칙의 정본은 스캐너 하나다 — 여기서 다시 세면 두 수치가 갈라진다.
import { scanScreens } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 개인설정 5 + 입원·간호 11 화면의 UI 언어 배선 가드 (영역 카탈로그 `settings3.ts`).
 *
 * 이 가드가 지키는 것은 넷이다 — **전부 반증 가능한 것만** 못박는다:
 *   ① `<T>`/`tAttr` 이 실제로 배선돼 있다(대조군: 0 이 되면 아무것도 보증하지 않는다).
 *   ② 화면이 쓰는 키가 **카탈로그에 실제로 있다** — 없으면 화면에 `EN×` 거짓 티가 뜬다.
 *      단, `settings3.ts` 헤더에 **사유를 적고 일부러 뺀 키**는 예외로 열거한다(아래 EXPECTED_UNREGISTERED).
 *      🔴 예외를 "없는 것"으로 뭉뚱그리지 않는다 — 목록이 곧 "무엇을 왜 뺐는가"의 기계 대조다.
 *   ③ **죽은 키 0** — 카탈로그에만 있고 어느 화면도 쓰지 않는 키는 등록 순서상 영원히 안 보인다.
 *   ④ **잔여 한글 기준선 동결** — 줄면 낮추고, 늘면 실패한다(여유를 두면 신규 위반을 흡수한다).
 *
 * 🔴 재주입 역검증(2026-09-09): ② 는 카탈로그에서 `'투약확인 (MAR)'` 1건을 지워 실패를 확인했고,
 *    ③ 은 쓰이지 않는 키 1건을 넣어 실패를 확인했고, ④ 는 `<T k="합계" />` 를 생한글로 되돌려
 *    실패를 확인한 뒤 전부 복원했다(복원 자체도 재확인).
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const CATALOG = join(ROOT, 'packages/shared/src/i18n/messages/settings3.ts');

/** 이 갈래가 소유한 화면 — `[admissionId]/discharge-summary` 는 다른 갈래 소유라 제외 */
const OWNED = [
  '(main)/inpatient/[admissionId]/nursing/assessment/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/care-plan/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/checklist/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/flowsheet/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/handoff/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/io/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/mar/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/notes/page.tsx',
  '(main)/inpatient/[admissionId]/nursing/timeline/page.tsx',
  '(main)/inpatient/[admissionId]/page.tsx',
  '(main)/inpatient/page.tsx',
  '(main)/settings/my-certificate/page.tsx',
  '(main)/settings/my-codes/page.tsx',
  '(main)/settings/my-signature/page.tsx',
  '(main)/settings/shortcuts/page.tsx',
  '(main)/settings/voice/page.tsx',
  '(main)/settings/password/page.tsx',
];

/**
 * 2026-09-09 실측 — 화면별 **남은 한글 조각 수**(재현: `node scripts/i18n-unwired-scan.mjs --json`).
 * 🔴 이 수는 "표시 문구"가 아니라 **상한**이다(비교값·Record 키 등 화면에 안 뜨는 리터럴 포함).
 *    그래도 회귀는 잡는다 — 배선을 되돌리면 반드시 늘어난다.
 */
const KO_BASELINE: Record<string, number> = {
  '(main)/inpatient/[admissionId]/nursing/assessment/page.tsx': 23,
  '(main)/inpatient/[admissionId]/nursing/care-plan/page.tsx': 8,
  '(main)/inpatient/[admissionId]/nursing/checklist/page.tsx': 6,
  '(main)/inpatient/[admissionId]/nursing/flowsheet/page.tsx': 10,
  '(main)/inpatient/[admissionId]/nursing/handoff/page.tsx': 4,
  '(main)/inpatient/[admissionId]/nursing/io/page.tsx': 6,
  '(main)/inpatient/[admissionId]/nursing/mar/page.tsx': 20,
  '(main)/inpatient/[admissionId]/nursing/notes/page.tsx': 22,
  '(main)/inpatient/[admissionId]/nursing/timeline/page.tsx': 23,
  '(main)/inpatient/[admissionId]/page.tsx': 61, // 65→61 2026-10-22 중간정산 섹션을 InterimBillingSection.tsx 로 옮기며 번역 노드로 다시 씀 · // 2026-10-07 활력 표시 부품 이관 — 로컬 '통증' 라벨 회수(66→65) · 2026-10-04 I-PASS 폼(68→66)
  '(main)/inpatient/page.tsx': 20, // 29→20 (2026-10-07) AI 위험 배지를 components/inpatient/AiRiskBadges.tsx 로 분리
  '(main)/settings/my-certificate/page.tsx': 80,
  '(main)/settings/my-codes/page.tsx': 15,
  '(main)/settings/my-signature/page.tsx': 7,
  '(main)/settings/shortcuts/page.tsx': 22,
  '(main)/settings/voice/page.tsx': 10,
  '(main)/settings/password/page.tsx': 0,
};

/**
 * 🔴 **일부러 등재하지 않은 키** — `settings3.ts` 헤더 ③ 과 짝이다.
 *    `nursing.ts` 가 "SBAR 안내 placeholder"로 이미 뺀 어휘라 사본을 만들지 않는다.
 *    화면은 이 자리에서 한국어 원문을 그대로 보여준다(그게 정직하다).
 */
const EXPECTED_UNREGISTERED = [
  '바이탈 변화, 의식 상태, 간호 판단...',
  '진단명, 입원일, 주요 기왕력, 현재 치료...',
  '필요한 처치, 검사, 의사 보고 사항...',
];

const HAS_KO = /[가-힣]/;
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

/** 화면이 실제로 쓰는 i18n 키(리터럴만 — 동적 키는 아래 Record 검사가 따로 본다) */
function literalKeys(src: string): string[] {
  const keys = new Set<string>();
  for (const re of [/<T\s+k="((?:[^"\\]|\\.)*)"/g, /<T\s+k='((?:[^'\\]|\\.)*)'/g]) {
    for (const m of src.matchAll(re)) keys.add(m[1]);
  }
  for (const m of src.matchAll(/<T\s+k=\{([^}]*)\}/g)) {
    for (const q of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) keys.add(q[1]);
  }
  for (const m of src.matchAll(/tAttr\(([^)]*)\)/g)) {
    for (const q of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) keys.add(q[1]);
  }
  return [...keys];
}

/** settings3.ts 가 등재한 키(표 파싱 — 정본 파일에서 파생한다) */
function catalogKeys(): string[] {
  const src = readFileSync(CATALOG, 'utf8');
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en:'));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*\[/gm)].map((m) => m[1].replace(/\\'/g, "'"));
}

function allWebSources(): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(ROOT, 'apps/web/src'));
  // 2026-10-10 라벨 정본 — 위험 추이 패널이 `<T k={it.label} />` 로 넘기는 Braden 하위 항목 이름(shared braden.ts)
  out.push(readFileSync(join(ROOT, 'packages/shared/src/braden.ts'), 'utf8'));
  return out.join('\n');
}

describe('🔴 settings3 — 개인설정·입원 간호 화면의 UI 언어 배선', () => {
  it('대조군 — 소유 화면이 실제로 `<T>`/tAttr 을 쓴다(0 이면 이 가드는 아무것도 보증하지 않는다)', () => {
    for (const rel of OWNED) {
      const src = read(rel);
      const n = (src.match(/<T[\s>]/g) ?? []).length + (src.match(/tAttr\(/g) ?? []).length;
      expect(n, `${rel} 에 i18n 배선이 없다`).toBeGreaterThan(0);
    }
  });

  it('① 카탈로그가 비어 있지 않다 — 표가 지워지면 아래 검사가 조용히 통과한다', () => {
    expect(catalogKeys().length).toBeGreaterThan(200);
  });

  it('② 화면이 쓰는 키는 어느 카탈로그에든 등재돼 있다(EN× 거짓 티 0) — 예외는 사유와 함께 열거된 것뿐', () => {
    const missing: string[] = [];
    for (const rel of OWNED) {
      for (const k of literalKeys(read(rel))) {
        if (!HAS_KO.test(k)) continue; // 코드값·영문 고유명사는 번역 대상이 아니다(부품이 티를 달지 않는다)
        if (EXPECTED_UNREGISTERED.includes(k)) continue;
        if (tOf(k, 'en').missing) missing.push(`${rel} :: ${k}`);
      }
    }
    expect(missing, `미등록 키 — 화면에 EN× 가 뜬다:\n${missing.join('\n')}`).toEqual([]);
  });

  it('②-b 대조군 — "일부러 뺀 키"는 지금도 실제로 미등록이다(예외 목록이 낡으면 알려준다)', () => {
    for (const k of EXPECTED_UNREGISTERED) {
      expect(tOf(k, 'en').missing, `'${k}' 가 등재됐다 — 예외 목록에서 빼고 사유 주석도 고쳐라`).toBe(true);
    }
  });

  it('③ 죽은 키 0 — 카탈로그에만 있고 아무 화면도 쓰지 않는 키가 없다', () => {
    const all = allWebSources();
    const used = (k: string) =>
      all.includes(`'${k}'`) || all.includes(`"${k}"`) || all.includes(`k="${k}"`) || all.includes(`k='${k}'`) ||
      (!k.includes('@') && new RegExp(`>\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<`).test(all));
    const dead = catalogKeys().filter((k) => !used(k));
    expect(dead, `죽은 키(등재만 되고 소비처 0):\n${dead.join('\n')}`).toEqual([]);
  });

  /**
   * 🔴 **죽은 키의 다른 얼굴** — 화면이 쓰더라도, 그 키를 **먼저 등록된 카탈로그가 이미 정의**했다면
   *    `t()` 는 그쪽을 돌려주고 `settings3` 의 정의는 영영 보이지 않는다(등록 순서 = 우선순위 정본).
   *    2026-09-09 실측: 병행 갈래가 같은 라운드에 채운 `clinical3`·`admin4`·`ws3`·`components2`·`nav` 와
   *    **12건이 겹쳐 있었다**(‘내 서명 등록’·‘작동 방식’·‘문서 ID’·‘일’·‘세트’·‘코드 검색’ 등) — 전부 제거했다.
   *    🔴 등재 시점의 중복 검사만으로는 못 잡는다(그때는 상대 카탈로그가 비어 있었다). 그래서 가드가 잰다.
   */
  it('③-a settings3 가 먼저 등록된 카탈로그의 키를 다시 정의하지 않는다(지는 정의 = 죽은 키)', () => {
    const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
    const reg = readFileSync(join(MSG, 'registry.ts'), 'utf8');
    const order = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => m[1]);
    const before = order.slice(0, order.indexOf('settings3')).filter((f) => f !== 'settings3');
    expect(before.length, 'registry 파싱이 깨지면 이 가드는 조용히 통과한다').toBeGreaterThan(10);
    const dup: string[] = [];
    for (const f of before) {
      const s = readFileSync(join(MSG, `${f}.ts`), 'utf8');
      for (const k of catalogKeys()) if (s.includes(`'${k}':`)) dup.push(`${f} :: ${k}`);
    }
    expect(dup, `먼저 등록된 카탈로그가 이미 정의한 키 — settings3 의 정의는 죽는다:\n${dup.join('\n')}`).toEqual([]);
  });

  it('③-b 세 언어 키 집합이 같고 빈 값이 없다', () => {
    const keys = catalogKeys();
    for (const k of keys) {
      for (const loc of ['en', 'ja', 'ar'] as const) {
        const r = tOf(k, loc);
        expect(r.missing, `${loc} 에 '${k}' 가 없다`).toBe(false);
        expect(r.text.trim().length, `${loc} 의 '${k}' 가 빈 값이다`).toBeGreaterThan(0);
      }
    }
  });

  it('④ 잔여 한글 기준선이 조용히 늘지 않는다(줄면 낮춘다 · 여유 0)', () => {
    const rows = scanScreens(APP, APP) as { file: string; ko: number }[];
    const actual: Record<string, number> = {};
    for (const r of rows) if (r.file in KO_BASELINE) actual[r.file] = r.ko;
    expect(Object.keys(actual).sort(), '소유 화면이 사라졌다(이동했으면 목록을 고친다)').toEqual(Object.keys(KO_BASELINE).sort());
    expect(actual).toEqual(KO_BASELINE);
  });

  it('🔴 안전 어휘는 여전히 한국어다 — "번역했다"가 아니라 "일부러 두었다"를 못박는다', () => {
    // MAR 상태·BCMA 입력·고위험 배지·이중확인 안내는 `settings3.ts` 헤더 ① 의 미등재 대상이다.
    for (const k of [
      '투여완료', '미투약', '⛔고위험',
      '손목밴드 스캔(MRN)', '약품 바코드 스캔',
      '스캔 없이 투약 시 정책에 따라 경고 표식 또는 차단됩니다.',
      '확인 간호사를 지정하거나 우회 사유를 선택하세요',
      '독립보행',
    ]) {
      expect(tOf(k, 'en').missing, `'${k}' 가 등재됐다 — 안전 어휘는 사람 검수 후에만 등재한다`).toBe(true);
    }
  });

  /**
   * 🔴 **등재 여부만으로는 판정할 수 없는 자리가 있다.**
   *    `'BCMA 바코드 대조 (환자·약품)'`·`'침상안정'`·`'욕창 위험'` 은 `nursing.ts` 가 "일부러 뺐다"고
   *    선언한 어휘인데 **`wsportal.ts`·다른 영역 카탈로그에는 등재돼 있다**(같은 사실에 정본이 둘 — P12).
   *    그래서 이 화면들에 대해서는 "카탈로그에 없다"가 아니라 **"화면이 그것을 쓰지 않는다(배선 0)"**
   *    를 재야 한다. 아래가 그 단언이다 — `<T k="…">`/`tAttr('…')` 로 감싸면 실패한다.
   */
  it('🔴 정본이 갈린 안전 어휘 — 이 화면들은 그 키를 **부르지 않는다**(등재 여부와 무관하게)', () => {
    const NOT_WIRED_HERE: Record<string, string[]> = {
      '(main)/inpatient/[admissionId]/nursing/mar/page.tsx': ['BCMA 바코드 대조 (환자·약품)', '⛔고위험'],
      '(main)/inpatient/[admissionId]/nursing/assessment/page.tsx': ['침상안정', '욕창 위험', '독립보행'],
    };
    for (const [rel, phrases] of Object.entries(NOT_WIRED_HERE)) {
      const src = read(rel);
      for (const p of phrases) {
        expect(src, `${rel} 에 '${p}' 원문이 사라졌다 — 원문을 바꾸지 않는다`).toContain(p);
        expect(src, `${rel} 가 '${p}' 를 <T k> 로 감쌌다 — 이 어휘는 사람 검수 전이다`).not.toContain(`k="${p}"`);
        expect(src, `${rel} 가 '${p}' 를 tAttr 로 감쌌다 — 이 어휘는 사람 검수 전이다`).not.toContain(`tAttr('${p}')`);
      }
    }
  });
});

// relative 를 쓰지 않으면 lint 가 미사용 import 를 잡는다 — 경로 계산의 근거를 남긴다
void relative;
