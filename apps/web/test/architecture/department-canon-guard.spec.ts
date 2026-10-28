import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 부서(진료과) 목록 정본 가드 (2026-08-24 · 입력 보조 UX P1 — input-assist-ux.plan.md §4)
 *
 * 🔴 실측: 마스터 `department_codes` 36행과 `GET /api/v1/codes/departments` EP 가 다 있는데
 *    **FE 소비 0건** — 화면 13곳이 각자 로컬 배열을 들고 있었고 목록이 서로 달랐다
 *    (front-desk 16과·dept-catalog 10과·cost-analysis 는 '소아과'·'비뇨기과' 같은 이표기까지).
 *    관리자가 마스터에 과를 추가해도 어느 화면에도 나타나지 않았다. 11파일을 `useDepartments()` 로 수렴.
 *
 * 규약: **진료과 목록은 `useDepartments()` 로만 가져온다** — 화면 로컬 배열 재정의 금지.
 * 탐지: 한 배열 리터럴 안에 진료과 이름이 3종 이상 나열된 것(단건 예시·라벨·매핑 키는 잡지 않는다).
 *
 * 재주입하면 실패한다: 어느 화면이든 `const DEPTS = ['내과','외과','산부인과']` 를 새로 만들면 잡힌다.
 */
const SRC = path.join(__dirname, '..', '..', 'src');
const walk = (d: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !/\.spec\./.test(e.name)) out.push(full);
  }
  return out;
};
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

/** 마스터 nameKo 표본 — 이 중 3종 이상이 한 배열에 있으면 "진료과 목록"으로 본다 */
const DEPT_NAMES = ['내과', '외과', '정형외과', '신경외과', '소아청소년과', '산부인과', '이비인후과', '피부과', '비뇨의학과', '응급의학과', '재활의학과', '가정의학과'];

/** 파일에서 배열 리터럴([ … ])을 추출해 부서명 3종 이상 나열 여부를 센다 */
function countDeptArrays(content: string): number {
  let n = 0;
  const re = /\[[^\]]{0,2000}?\]/g;
  for (const m of content.matchAll(re)) {
    const body = m[0];
    const hits = DEPT_NAMES.filter((d) => body.includes(`'${d}'`) || body.includes(`"${d}"`));
    if (hits.length >= 3) n += 1;
  }
  return n;
}

/**
 * 기준선 — 정당 사유가 있는 곳만. 늘리지 않는다(P1 에서 11파일을 0 으로 만들었다).
 * · portal/homepage: 환자·공개 화면이라 스태프 EP(JWT) 호출 불가 — 공개 부서 EP 신설은 설계 판단(잔여 대장)
 * · ReferralTab: 정본이 마스터가 아니라 `/consultations/departments`(받을 의사가 있는 과) — 이 배열은 그 조회 실패 시 폴백
 */
const BASELINE: Record<string, number> = {
  'app/portal/_home/SelfCheckIn.tsx': 1, // 환자 인증 — 스태프 EP 불가(공개 부서 EP 는 설계 판단·잔여 대장)
  'app/(main)/patients/[id]/components/ReferralTab.tsx': 1, // 정본은 /consultations/departments(받을 의사가 있는 과) — 이 배열은 그 폴백
  'app/(main)/his-checkup/visit/[id]/page.tsx': 1, // 판독 의뢰과 — 검진 프로토콜 소관(마스터 전체가 아님·부록 H 분석물 정본과 한 벌)
  'app/(main)/patients/[id]/page.tsx': 1, // 진료과→차트 라우트 매핑 — 옵션 목록이 아니라 화면 라우팅 정본
  'app/(main)/remote-consult/page.tsx': 1, // 비대면 적합도 안내 콘텐츠 — 적합도 판정은 진료부 소관(목록 아님)
  'components/layout/Sidebar.tsx': 1, // 메뉴 라우트 정의 — 옵션 목록 아님
  'lib/test-accounts.ts': 1, // 개발용 테스트 계정 라벨 — 운영 번들에서 제거되는 파일(iOS 축 가드가 산출물 검증)
};

describe('부서 목록 정본 (useDepartments 하나 — 화면 로컬 배열 금지)', () => {
  const found: Record<string, number> = {};
  for (const f of walk(SRC)) {
    const n = countDeptArrays(fs.readFileSync(f, 'utf8'));
    if (n > 0) found[rel(f)] = n;
  }

  it('스캔이 비면 가드가 아니다 — 기준선 파일을 실제로 찾는다', () => {
    expect(Object.keys(found).length).toBeGreaterThan(0);
  });

  it('🔴 새 화면이 진료과 로컬 배열을 들이지 않는다 — useDepartments() 를 쓴다', () => {
    const newcomers = Object.keys(found).filter((f) => !(f in BASELINE));
    expect(newcomers, `useDepartments()(마스터+현재값 합집합)를 쓰거나, 스태프 EP 를 못 쓰는 공개 화면이면 사유와 함께 기준선에 등재: ${newcomers.join(', ')}`).toEqual([]);
  });

  it('기존 파일에서 늘지 않는다', () => {
    const grown = Object.entries(found)
      .filter(([f, n]) => f in BASELINE && n > BASELINE[f])
      .map(([f, n]) => `${f}: ${BASELINE[f]} → ${n}`);
    expect(grown).toEqual([]);
  });

  it('줄었으면 기준선을 낮춘다', () => {
    const shrunk = Object.entries(BASELINE)
      .filter(([f, n]) => (found[f] ?? 0) < n)
      .map(([f, n]) => `${f}: 기준선 ${n} → 실제 ${found[f] ?? 0}`);
    expect(shrunk, `기준선 갱신 필요(낮추기): ${shrunk.join(' · ')}`).toEqual([]);
  });
});
