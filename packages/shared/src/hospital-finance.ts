/**
 * 병원 경영성과(손익) 정본 — 의료기관 회계정보공시(한국보건산업진흥원 HASPA) 손익계산서 계정 기준.
 *
 * 출처·학습: 외부 공개 프로젝트 "국내 (상급)종합병원 경영성과 대시보드"(github.com/TAEJIN-AHN/Hospital-Profit-Visualization)의
 * 분석 틀(지역 내 의료이익 비교 · 의료수익경상이익률 동급 비교 · 의료이익률 추이 · 의료수익 대비 비용 구조 편차)을 옮겼다.
 * 그 저장소의 데이터 파일은 **라이선스 표기가 없어 복사하지 않았다** — 공시 원자료는 관리자가 가져오기로 올린다.
 *
 * 🔴 정직 규칙:
 *   - 비율의 분모는 **의료수익**이다. 의료수익이 0 이하이거나 없으면 비율은 `null`(산출 불가) — 0 으로 두지 않는다.
 *   - 동급 비교는 **평균만 쓰지 않는다** — 중앙값·사분위·기관 수(n)를 함께 낸다.
 *     실측: 종합병원 2020 의료이익률 평균 −15.0% · 중앙값 −3.7%(극단값 몇 곳이 평균을 끌어내린다).
 *   - 가져오기는 공시 항등식(의료수익−의료비용=의료이익 · 비용 4항목 합 · 법인세차감전순이익 항등식)을 검증한다.
 *   - "우리 병원" 손익은 HIS 에 없다(수납 금액뿐 · 비용은 ERP/회계) — 지정되지 않으면 비교하지 않는다.
 */

/** 손익 계정(공시 상위 계정 · 세목 제외) */
export const FINANCE_ACCOUNTS = [
  'medicalRevenue', 'inpatientRevenue', 'outpatientRevenue', 'otherMedicalRevenue',
  'medicalCost', 'laborCost', 'materialCost', 'adminCost', 'otherMedicalCost',
  'medicalProfit',
  'nonMedicalRevenue', 'researchRevenue', 'donationRevenue',
  'nonMedicalCost', 'interestCost',
  'preTaxIncome', 'netIncome',
] as const;
export type FinanceAccount = (typeof FINANCE_ACCOUNTS)[number];
export type FinanceAccounts = Partial<Record<FinanceAccount, number>>;

/** 공시 열 이름 → 계정(원 저장소 final_data 와 HASPA 표기 모두) */
export const DISCLOSURE_COLUMN_MAP: Record<string, FinanceAccount> = {
  'Ⅰ.의료수익': 'medicalRevenue',
  'Ⅰ-1.입원수익': 'inpatientRevenue',
  'Ⅰ-2.외래수익': 'outpatientRevenue',
  'Ⅰ-3.기타의료수익': 'otherMedicalRevenue',
  'Ⅱ.의료비용': 'medicalCost',
  'Ⅱ-1.인건비': 'laborCost',
  'Ⅱ-2.재료비': 'materialCost',
  'Ⅱ-3.관리운영비': 'adminCost',
  'Ⅱ-4.기타의료비용': 'otherMedicalCost',
  'Ⅲ.의료이익(손실)': 'medicalProfit',
  'Ⅳ.의료외수익': 'nonMedicalRevenue',
  'Ⅳ-7.연구수익': 'researchRevenue',
  'Ⅳ-13.기부금수익': 'donationRevenue',
  'Ⅴ.의료외비용': 'nonMedicalCost',
  'Ⅴ-2.이자비용': 'interestCost',
  'Ⅵ.법인세차감전순이익(순손실)': 'preTaxIncome',
  '당기순이익(순손실)': 'netIncome',
};

/** 기관 정보 열 */
export const DISCLOSURE_META_COLUMNS = {
  year: '연도', name: '기관명', beds: '병상수', type: '종별', founding: '설립형태', address: '주소', lat: '위도', lng: '경도',
  // 선택 열 — 있으면 주소 해석보다 먼저(HASPA 는 구조화된 시도·시군구를 따로 준다 · 주소 칸에 병원명·층수만 온 기관이 있다)
  sido: '시도', sigungu: '시군구',
  // 선택 열 — 공시 기관 코드(HASPA hosCode). 있으면 이것으로 기관을 식별한다(연도마다 이름 표기가 달라도 같은 기관)
  code: '기관코드',
  // 선택 열 — 세목 JSON({계정코드: 금액}) · 드릴다운용(없으면 상위 계정만)
  detail: '세목',
} as const;

/**
 * 종별 — 동급 비교의 기본 묶음이자 화면 줄 순서(HASPA 공시 `kindName` 표기 그대로).
 * 공시에 이 밖의 종별(치과병원 등)이 오면 막지 않고 뒤에 이름순으로 붙인다(정본에 없는 값을 금지하지 않는다).
 * 🔴 의원은 없다 — 회계정보공시 대상이 아니다(손익이 공개되지 않는다).
 */
export const HOSPITAL_TYPES = ['상급종합병원', '종합병원', '병원', '요양병원', '정신병원', '한방병원'] as const;

/** 지표 — 분모는 전부 의료수익 */
export const FINANCE_RATIOS = [
  'medicalProfitMargin', // 의료이익률 = 의료이익 / 의료수익
  'ordinaryMargin',      // 의료수익경상이익률 = 법인세차감전순이익 / 의료수익(의료외 손익 포함 — 연구·기부 수익이 반영된다)
  'laborRatio',          // 인건비율
  'materialRatio',       // 재료비율
  'adminRatio',          // 관리운영비율
  'inpatientShare',      // 입원수익 비중
  'netMargin',           // 당기순이익률 = 당기순이익 / 의료수익
  'nonMedicalNetRatio',  // 의료외 순손익률 = (의료외수익 − 의료외비용) / 의료수익 — 경상이익률과 의료이익률의 차이
  'researchShare',       // 연구수익 비중 = 연구수익 / 의료수익
] as const;
export type FinanceRatio = (typeof FINANCE_RATIOS)[number];

/** 비용 지표 — 동급보다 높으면 개선 검토 대상(원 대시보드의 적색 편차) */
export const COST_RATIOS: readonly FinanceRatio[] = ['laborRatio', 'materialRatio', 'adminRatio'];

const NUMERATOR: Record<Exclude<FinanceRatio, 'nonMedicalNetRatio'>, FinanceAccount> = {
  medicalProfitMargin: 'medicalProfit',
  ordinaryMargin: 'preTaxIncome',
  laborRatio: 'laborCost',
  materialRatio: 'materialCost',
  adminRatio: 'adminCost',
  inpatientShare: 'inpatientRevenue',
  netMargin: 'netIncome',
  researchShare: 'researchRevenue',
};

/** 한 기관·한 해의 지표 — 의료수익이 없거나 0 이하면 전부 null(산출 불가) */
export function financeRatios(a: FinanceAccounts): Record<FinanceRatio, number | null> {
  const rev = a.medicalRevenue;
  const ok = typeof rev === 'number' && Number.isFinite(rev) && rev > 0;
  const out = {} as Record<FinanceRatio, number | null>;
  for (const r of FINANCE_RATIOS) {
    const n = r === 'nonMedicalNetRatio'
      ? (typeof a.nonMedicalRevenue === 'number' && typeof a.nonMedicalCost === 'number' ? a.nonMedicalRevenue - a.nonMedicalCost : undefined)
      : a[NUMERATOR[r]];
    out[r] = ok && typeof n === 'number' && Number.isFinite(n) ? n / (rev as number) : null;
  }
  return out;
}

export interface PeerStat { n: number; mean: number | null; median: number | null; p25: number | null; p75: number | null }

/** 분위수(선형 보간) — 정렬된 배열 */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 동급 통계 — null 은 빼고 센다(표본 n 을 함께) · 표본 0 이면 전부 null */
export function peerStat(values: Array<number | null | undefined>): PeerStat {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, median: null, p25: null, p75: null };
  return {
    n: v.length,
    mean: v.reduce((s, x) => s + x, 0) / v.length,
    median: quantile(v, 0.5),
    p25: quantile(v, 0.25),
    p75: quantile(v, 0.75),
  };
}

/**
 * 동급 대비 편차(비율 차 — %p 로 표시할 값). 기준은 **중앙값**(극단값에 끌리지 않게) · 둘 중 하나라도 없으면 null.
 * `worse` = 비용 지표는 높을수록, 이익 지표는 낮을수록 나쁘다.
 */
export function peerDeviation(ratio: FinanceRatio, value: number | null, peer: PeerStat): { diff: number | null; worse: boolean | null } {
  if (value == null || peer.median == null) return { diff: null, worse: null };
  const diff = value - peer.median;
  const isCost = COST_RATIOS.includes(ratio);
  return { diff, worse: diff === 0 ? false : isCost ? diff > 0 : diff < 0 };
}

/** 시도 약칭 → 정식 이름(공시 주소에 '대전 유성구'·'경북 안동시' 같은 약칭이 섞여 온다 — 2026-09-29 FY2024 실측) */
export const SIDO_FULL_NAME: Record<string, string> = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시',
  세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도',
  경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도',
};
const SIDO_NAMES = new Set([
  ...Object.values(SIDO_FULL_NAME), '강원도', '전라북도', '제주도', '세종시',
]);
/** 시도 표기를 정식 이름으로 — 모르는 값은 null(지어내지 않는다) */
export function normalizeSidoName(token: string | null | undefined): string | null {
  const t = (token ?? '').trim();
  if (!t) return null;
  if (SIDO_FULL_NAME[t]) return SIDO_FULL_NAME[t];
  if (t === '제주도') return '제주특별자치도';
  if (t === '세종시') return '세종특별자치시';
  return SIDO_NAMES.has(t) ? t : null;
}

/**
 * 주소 → 시도·시군구 — **시도로 읽히는 첫 어절**과 그다음 어절.
 * 🔴 종전: 첫 두 어절을 그대로 → 약칭(`대전`)이 정식 이름과 다른 시도로 갈리고, '1층 …'·'.' 같은 주소가 시도로 들어갔다(FY2024 245곳이 지도에서 빠짐).
 *    시도를 못 찾으면 둘 다 null(주소 원문은 따로 남는다).
 */
export function regionOf(address: string | null | undefined): { sido: string | null; sigungu: string | null } {
  const parts = (address ?? '').trim().split(/\s+/).filter(Boolean);
  const i = parts.findIndex((p) => normalizeSidoName(p) != null);
  if (i < 0) return { sido: null, sigungu: null };
  return { sido: normalizeSidoName(parts[i]), sigungu: parts[i + 1] ?? null };
}

/** 공시 항등식 검증 — 어긋난 식 이름 목록(허용 오차 1원 · 계정이 없으면 그 식은 검사하지 않는다) */
export function disclosureIdentityIssues(a: FinanceAccounts): string[] {
  const has = (...k: FinanceAccount[]) => k.every((x) => typeof a[x] === 'number');
  const off = (x: number, y: number) => Math.abs(x - y) > 1;
  const issues: string[] = [];
  if (has('medicalRevenue', 'medicalCost', 'medicalProfit') && off(a.medicalRevenue! - a.medicalCost!, a.medicalProfit!)) issues.push('PROFIT');
  if (has('medicalCost', 'laborCost', 'materialCost', 'adminCost', 'otherMedicalCost')
    && off(a.laborCost! + a.materialCost! + a.adminCost! + a.otherMedicalCost!, a.medicalCost!)) issues.push('COST_PARTS');
  if (has('medicalProfit', 'nonMedicalRevenue', 'nonMedicalCost', 'preTaxIncome')
    && off(a.medicalProfit! + a.nonMedicalRevenue! - a.nonMedicalCost!, a.preTaxIncome!)) issues.push('PRETAX');
  return issues;
}

/** CSV 한 줄 파싱(따옴표·쉼표 포함 필드) — 외부 라이브러리 없이 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
