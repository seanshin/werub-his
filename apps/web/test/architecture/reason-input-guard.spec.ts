import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { REASON_PRESETS, reasonFilled } from '../../src/lib/reason-presets';

/**
 * 사유 입력 보조 가드 (2026-08-24 · 입력 보조 UX P2 — input-assist-ux.plan.md §4)
 *
 * 🔴 이 가드가 지키는 것은 **입력 보조가 허용 목록으로 변질되지 않는 것**이다.
 *    급양 축에서 미배식 사유를 영문 enum 으로 강제하려다 철회했다 — 아무도 쓰지 않는 어휘를
 *    지어내면 기존 화면이 깨지고 이미 남은 기록이 고아가 된다. 같은 실수가 이 부품으로
 *    **43곳에 한꺼번에** 퍼질 수 있으므로, 부품 자체를 가드로 못박는다.
 *
 * 세 가지를 본다:
 *  1. `<ReasonInput>` 이 자유 입력을 막지 않는다 — datalist 는 제안이지 제한이 아니다
 *  2. `required` 가 **공백만**을 거른다(어휘가 아니라 '비어 있음'만 강제)
 *  3. 전환한 화면이 맨 `<input>` 으로 되돌아가지 않는다
 *
 * 대조군을 함께 둔다 — **성공하는 입력을 실패라고 말하지 않는다.** 무조건 통과하는 가드는
 * 가드가 아니고, 무조건 막는 부품은 입력 보조가 아니다.
 */
const SRC = path.join(__dirname, '..', '..', 'src');
const COMPONENT = path.join(SRC, 'components', 'ui', 'ReasonInput.tsx');
const PRESETS = path.join(SRC, 'lib', 'reason-presets.ts');
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('reasonFilled — 필수 사유의 판정 정본', () => {
  it('🔴 공백만 넣은 것은 채운 것이 아니다', () => {
    // 실측: `사유(필수)` 라 적어놓고 게이트가 `!reason` 이던 자리가 21곳이었다
    expect(reasonFilled(' ')).toBe(false);
    expect(reasonFilled('\t\n  ')).toBe(false);
    expect(reasonFilled('')).toBe(false);
    expect(reasonFilled(null)).toBe(false);
    expect(reasonFilled(undefined)).toBe(false);
  });

  it('대조군 — 실제로 쓴 사유를 "비었다"고 말하지 않는다', () => {
    expect(reasonFilled('환자 거부')).toBe(true);
    expect(reasonFilled('가')).toBe(true);
    // 앞뒤 공백이 있어도 내용이 있으면 채운 것이다(값을 잘라내지는 않는다 — 표시는 원문 그대로)
    expect(reasonFilled('  금식(NPO)  ')).toBe(true);
  });
});

describe('프리셋 정본 — 어휘를 지어내지 않는다', () => {
  const src = read(PRESETS);

  it('스캔이 비면 가드가 아니다 — 도메인 키를 실제로 읽는다', () => {
    expect(Object.keys(REASON_PRESETS).length).toBeGreaterThan(10);
  });

  it('🔴 채택한 프리셋은 2026-08-24 운영 DB 실측 어휘와 글자까지 같다', () => {
    // `inventory_transactions.reason` 전 10행의 어휘. 한 글자라도 고치면 기존 행과 갈라진다
    // (v4.6.0: FE 에 지어낸 어휘를 넣어 서버와 교집합 0 이 됐고, 내 가드가 내 어휘를 테스트해 통과했다)
    expect([...REASON_PRESETS.inventoryTxn].sort()).toEqual(
      ['미사용 반납', '부서 불출', '재고 실사 조정', '정기 입고'],
    );
  });

  it('🔴 시드 표식이 프리셋에 섞여 들어오지 않는다', () => {
    for (const [domain, list] of Object.entries(REASON_PRESETS)) {
      for (const v of list) {
        expect(v, `${domain}: 시드/데모 표식이 그대로 들어왔다 — "${v}"`).not.toMatch(
          /\[시연\]|\[데모|데모:|SEED|E2E|테스트|검증|실측/,
        );
        expect(v.trim(), `${domain}: 빈 프리셋 항목`).not.toBe('');
      }
    }
  });

  it('보류 판정은 사유와 함께 파일에 남아 있다(빈 배열을 말없이 두지 않는다)', () => {
    // 실사용이 없어서 비운 것과, 그냥 채우다 만 것은 다른 사실이다
    expect(src).toMatch(/실사용\(비시드\) 쓰기가 5건 이상인 사유 도메인은 하나도 없다/);
    expect(src).toMatch(/medicationHold: \[\], \/\/ 보류 근거/);
    expect(src).toMatch(/patientFlag: \[\], \/\/ 보류 근거/);
  });
});

describe('🔴 ReasonInput 은 입력 보조이지 허용 목록이 아니다', () => {
  const src = read(COMPONENT);

  it('스캔이 비면 가드가 아니다 — 부품 소스를 실제로 읽는다', () => {
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain('export function ReasonInput');
  });

  it('🔴 프리셋을 고르는 UI 가 <select> 가 아니다 (select 는 목록 밖 값을 원리적으로 막는다)', () => {
    expect(src).toContain('<datalist');
    expect(src, '사유를 <select> 로 바꾸면 자유 입력이 사라진다 — 급양에서 철회한 그 함정').not.toMatch(
      /<select[\s>]/,
    );
  });

  it('🔴 프리셋 밖 값을 차단하는 코드가 없다', () => {
    // 어휘 강제의 흔한 모양들 — 하나라도 생기면 이 부품은 허용 목록이 된다
    const forbidden: [RegExp, string][] = [
      [/\bpreset\.includes\s*\(/, '프리셋 포함 여부로 값을 판정한다'],
      [/\bREASON_PRESETS\[[^\]]*\]\.includes\s*\(/, '프리셋 포함 여부로 값을 판정한다'],
      [/\bpattern=/, 'pattern 속성으로 입력을 제한한다'],
      [/onChange\((?:[^)]*)\.trim\(\)\)/, 'onChange 에서 값을 가공한다(타이핑을 방해한다)'],
    ];
    for (const [re, why] of forbidden) {
      expect(re.test(src), `${why}: ${re}`).toBe(false);
    }
  });

  it('required 는 "비어 있음"만 강제한다 — 어휘 검사가 아니다', () => {
    expect(src).toContain('reasonFilled(value)');
    // required 분기가 프리셋을 쳐다보지 않는다
    const blankLine = src.split('\n').find((l) => l.includes('const blankOnly'));
    expect(blankLine).toBeTruthy();
    expect(blankLine).not.toMatch(/preset/i);
  });
});

/**
 * 전환한 화면이 되돌아가지 않는다.
 * 🔴 재주입 검증: 아래 목록의 파일에서 `ReasonInput` 을 지우고 맨 `<input placeholder="…사유">` 로
 *    되돌리면 이 블록이 실패한다(실제로 되돌려 실패를 확인했다).
 */
const CONVERTED = [
  'app/(main)/inventory/components/TransactionsTab.tsx',
  'app/(main)/inventory/components/CountsTab.tsx',
  'app/(main)/inpatient/[admissionId]/nursing/mar/page.tsx',
  'app/(main)/workstation/pharmacy/page.tsx',
  'app/(main)/pharmacy/page.tsx',
  'app/(main)/billing/page.tsx',
  'app/(main)/ess/_components/EssContent.tsx',
  'app/(main)/ess/_components/AttendanceSelfServiceSection.tsx',
  'app/(main)/cssd/page.tsx',
  'app/staff/team/page.tsx',
  'app/staff/approvals/HrApprovalSection.tsx',
  'app/(main)/chemo/page.tsx',
  'app/(main)/quality/MeasurementPanel.tsx',
  'app/(main)/workstation/documents/page.tsx',
  'app/(main)/claims/[id]/ClaimAdjustmentSection.tsx',
  'app/(main)/claims/[id]/page.tsx',
  'app/(main)/patients/[id]/components/EditPatientModal.tsx',
  'app/(main)/patients/[id]/components/PatientFlagBar.tsx',
  'app/(main)/admin/blockchain-cert/page.tsx',
  'app/(main)/emergency/page.tsx',
];

describe('전환한 화면이 맨 input 으로 되돌아가지 않는다', () => {
  it.each(CONVERTED)('%s 는 ReasonInput 을 쓴다', (rel) => {
    const full = path.join(SRC, rel);
    expect(fs.existsSync(full), `파일이 사라졌다(이동했으면 이 목록을 고친다): ${rel}`).toBe(true);
    expect(read(full)).toContain('<ReasonInput');
  });

  it('🔴 필수 사유 게이트가 공백을 통과시키지 않는다 (`!reason` 회귀 차단)', () => {
    // 전환 전 실측: `disabled={!cancelReason}` 처럼 trim 없이 막던 자리가 이 파일들에 있었다
    const mustUseHelper = [
      'app/(main)/workstation/pharmacy/page.tsx',
      'app/(main)/pharmacy/page.tsx',
      'app/(main)/chemo/page.tsx',
      'app/(main)/emergency/page.tsx',
      'app/(main)/inpatient/[admissionId]/nursing/mar/page.tsx',
      'app/(main)/patients/[id]/components/EditPatientModal.tsx',
    ];
    const missing = mustUseHelper.filter((rel) => !read(path.join(SRC, rel)).includes('reasonFilled('));
    expect(missing, `필수 사유 판정은 reasonFilled() 로 한다: ${missing.join(', ')}`).toEqual([]);
  });
});
