import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 숫자 placeholder 기준선 가드 (2026-08-24 · 입력 보조 UX P0 — input-assist-ux.plan.md §4)
 *
 * 🔴 실측: 임상 수치 입력의 placeholder 가 **정상값을 제안**하고 있었다 —
 *    투석 폼 체온 "36.5"·혈압 "140"/"90"·심박 "72", 산부인과 Apgar "8"/"9",
 *    혈액은행 용량 "320"(과거 '수혈량 320 날조'와 같은 숫자), 영양 알부민 "3.5" 등 **36건**.
 *    placeholder 는 저장되지 않지만 바쁜 현장에서 "권장값"으로 읽혀
 *    **"쓰기 폼의 초기값은 미선택"** 규약(임상 UX §2)을 placeholder 가 우회한다.
 *
 * 규약: **placeholder 는 형식을 말하고 값을 제안하지 않는다.**
 *  · 임상 수치 입력 → placeholder 제거(라벨이 단위를 말한다) 또는 단위 텍스트("mmHg"·"회/분")
 *  · 범위 힌트는 "0~10" 처럼 범위로(순수 숫자가 아니므로 이 가드에 걸리지 않는다)
 *
 * 순수 숫자 placeholder 가 남은 곳은 아래 기준선뿐이다 — 수량·가격·형식힌트로 **개별 판정된 정당**뿐.
 * (이연이던 임상 4파일 13건은 2026-08-24 8·9단계 병합 때 회수했다 — 임상 이연 잔여 0)
 *
 * 재주입하면 실패한다: 어느 화면이든 placeholder="36.5" 같은 순수 숫자 placeholder 를 새로 넣으면 잡힌다.
 */
const SRC = path.join(__dirname, '..', '..', 'src');
const walk = (d: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
};
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

/** 순수 숫자 placeholder — "0~10"(범위)·"mmHg"(단위)·"010-0000-0000"(형식)은 매칭되지 않는다 */
const NUMERIC_PLACEHOLDER = /placeholder="[0-9]+(?:\.[0-9]+)?"/g;

/**
 * 기준선 (2026-08-24 · 파일 → 허용 개수)
 * [이연] = 임상값인데 병행 에이전트(8·9단계)가 그 파일을 편집 중이라 P0 에서 못 고친 것 — 병합 후 0 으로
 * [정당] = 수량·가격·개수·형식힌트 — 값 제안이 아니라고 개별 판정한 것
 */
const BASELINE: Record<string, number> = {
  'app/(main)/research/page.tsx': 4, // [정당] 목표 등록수·문서 버전(1.0/2.0 = 형식)
  'app/(main)/equipment/components/PartsTab.tsx': 3, // [정당] 재고 수량·단가
  'app/(main)/billing/[id]/page.tsx': 3, // [정당] 승인번호 형식·금액 0
  'app/distributor/page.tsx': 2, // [정당] MFA 000000 형식
  'app/(main)/equipment/components/UsageLogTab.tsx': 2, // [정당] 환자수·사용시간 0
  'app/(main)/admin/cdss-rules/page.tsx': 2, // [정당] 룰 연령 경계 0/120(범위 정의)
  'app/display/kiosk/page.tsx': 1, // [정당] 생년월일 형식
  'app/(main)/staff-meal/page.tsx': 1, // [정당] 가격
  'app/(main)/reception/components/NewPatientTab.tsx': 1, // [정당] 생년월일 형식
  'app/(main)/inventory/components/ItemsTab.tsx': 1, // [정당] 안전재고 수량
  'app/(main)/equipment/components/MaintenanceLogModal.tsx': 1, // [정당] 비용 0
  'app/(main)/equipment/components/EquipmentRegisterForm.tsx': 1, // [정당] 구매가 0
  'app/(main)/cost-analysis/page.tsx': 1, // [정당] 금액 0
  'app/(main)/admin/non-covered/page.tsx': 1, // [정당] 가격 예시
  'app/(main)/admin/codes/code-detail-panel.tsx': 1, // [정당] SNOMED 코드 형식
};

function scan(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const f of walk(SRC)) {
    const n = (fs.readFileSync(f, 'utf8').match(NUMERIC_PLACEHOLDER) ?? []).length;
    if (n > 0) found[rel(f)] = n;
  }
  return found;
}

describe('숫자 placeholder 기준선 (placeholder 는 형식을 말하고 값을 제안하지 않는다)', () => {
  const found = scan();

  it('스캔이 비면 가드가 아니다 — 기준선 파일을 실제로 찾는다', () => {
    expect(Object.keys(found).length).toBeGreaterThan(0);
  });

  it('🔴 새 파일이 순수 숫자 placeholder 를 들이지 않는다', () => {
    const newcomers = Object.keys(found).filter((f) => !(f in BASELINE));
    expect(newcomers, `임상 수치라면 제거(라벨이 단위를 말한다) 또는 단위 텍스트("mmHg")로, 수량·형식힌트라면 이 가드의 기준선에 사유와 함께 등재: ${newcomers.join(', ')}`).toEqual([]);
  });

  it('🔴 기존 파일에서 늘지 않는다', () => {
    const grown = Object.entries(found)
      .filter(([f, n]) => f in BASELINE && n > BASELINE[f])
      .map(([f, n]) => `${f}: ${BASELINE[f]} → ${n}`);
    expect(grown).toEqual([]);
  });

  it('줄었으면 기준선을 낮춘다 (이연분 회수를 잊지 않기 위해)', () => {
    const shrunk = Object.entries(BASELINE)
      .filter(([f, n]) => (found[f] ?? 0) < n)
      .map(([f, n]) => `${f}: 기준선 ${n} → 실제 ${found[f] ?? 0}`);
    expect(shrunk, `기준선 갱신 필요(낮추기): ${shrunk.join(' · ')}`).toEqual([]);
  });

  it('총계가 기준선을 넘지 않는다 (파일 이동 회피 차단)', () => {
    const totalFound = Object.values(found).reduce((a, b) => a + b, 0);
    const totalBase = Object.values(BASELINE).reduce((a, b) => a + b, 0);
    expect(totalFound).toBeLessThanOrEqual(totalBase);
  });
});
