/**
 * 제형 ↔ 투여경로 정합성 정본 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 🔴 진료과 코드 카탈로그 8건 중 7건이 안내문과 실제 코드가 어긋나 있었고,
 *    그중 둘은 **제형과 경로가 임상적으로 모순**이었다:
 *      · "위산분비억제제" → **덱사메타손 주사 5mg**(제형 `주사`)을 `1C 1일1회 **PO** 28일`
 *      · "항혈소판제"     → **신선동결혈장(FFP) 200mL**(제형 `혈액제제`)을 `**1T** 1일1회 **PO** 30일`
 *    이 값들은 개인 약속처방(⭐고정·38회 사용)에 등재돼 **CPOE 처방 검색의 기본값을 프리필**한다.
 *    주사제를 경구로, 혈장제제를 정제로 "권장"하는 화면이 처방 입력의 출발점이었다.
 *
 * 🔴 안내문↔약품 불일치(고혈압 1차 약물 → 세파렉신=항생제)는 약효분류 온톨로지가 없어
 *    기계로 판정할 수 없다 — **임상 검토로 이연**한다. 여기서는 **기계로 확정 가능한 모순만** 잡는다.
 *    확실하지 않으면 경고하지 않는다(거짓 경보는 진짜 경보를 죽인다).
 */

/** 경구 투여가 임상적으로 불가능한 제형 — 확실한 것만 등재 */
const NON_ORAL_FORMS = ['주사', '앰플', '바이알', '혈액제제', '점안액', '크림', '겔', '관', '패치', '좌제'] as const;

/** 경구 경로 표기(자유 문자열이라 대소문자·한글 혼용) */
const ORAL_ROUTES = ['PO', '경구', 'ORAL', 'P.O.', 'PER OS'];

/** 정제·캡슐 단위 — 액상·주사 제형에 붙으면 모순 */
const SOLID_DOSE_UNITS = ['T', '정', 'TAB', 'C', '캡슐', 'CAP'];

/**
 * 정제·캡슐 단위가 붙을 수 없는 **확실한** 제형.
 * 🔴 "고형 경구가 아닌 것"으로 뒤집어 판정하면 미상 제형('기타'·'개'·'회')까지 걸린다 —
 *    거짓 경보는 진짜 경보를 죽인다. **아는 것만 경고한다.**
 */
const NON_SOLID_FORMS = ['주사', '앰플', '바이알', '혈액제제', '시럽', '점안액', '크림', '겔', '패치', '좌제'];

export type DosageRouteIssueCode = 'NON_ORAL_FORM_ORAL_ROUTE' | 'NON_SOLID_FORM_SOLID_UNIT';

export interface DosageRouteIssue {
  code: DosageRouteIssueCode;
  /** 사람이 읽을 사유 — 화면에 그대로 띄운다 */
  message: string;
}

function norm(v: string | null | undefined): string {
  return String(v ?? '').trim().toUpperCase();
}

/** 경구 경로인가 */
function isOralRoute(route: string | null | undefined): boolean {
  const r = norm(route);
  if (!r) return false;
  return ORAL_ROUTES.some((o) => r === norm(o));
}

/** 용량 문자열(`1T`·`1C`·`2정`)의 단위가 고형 경구 단위인가 */
function hasSolidDoseUnit(dosage: string | null | undefined): boolean {
  const d = norm(dosage);
  if (!d) return false;
  // 숫자 뒤에 오는 단위만 본다(`100MG` 의 G 를 오인하지 않게)
  const m = /^\s*[\d.]+\s*([A-Z가-힣.]+)/.exec(d);
  if (!m) return false;
  const unit = m[1].replace(/\./g, '');
  return SOLID_DOSE_UNITS.some((u) => unit === norm(u));
}

/**
 * 제형과 투여 기본값이 모순인지 판정한다.
 * **모르면 빈 배열** — 제형이 비어 있거나 등재되지 않은 값이면 경고하지 않는다.
 */
export function dosageRouteIssues(input: {
  dosageForm?: string | null;
  defaultRoute?: string | null;
  defaultDosage?: string | null;
}): DosageRouteIssue[] {
  const form = String(input.dosageForm ?? '').trim();
  if (!form) return []; // 제형 미상 — 추정하지 않는다

  const issues: DosageRouteIssue[] = [];
  const nonOral = NON_ORAL_FORMS.some((f) => form.includes(f));

  if (nonOral && isOralRoute(input.defaultRoute)) {
    issues.push({
      code: 'NON_ORAL_FORM_ORAL_ROUTE',
      message: `제형이 '${form}' 인데 투여경로가 경구(${String(input.defaultRoute).trim()})로 지정돼 있습니다`,
    });
  }

  const knownNonSolid = NON_SOLID_FORMS.some((f) => form.includes(f));
  if (knownNonSolid && hasSolidDoseUnit(input.defaultDosage)) {
    issues.push({
      code: 'NON_SOLID_FORM_SOLID_UNIT',
      message: `제형이 '${form}' 인데 용량이 정제·캡슐 단위(${String(input.defaultDosage).trim()})로 지정돼 있습니다`,
    });
  }

  return issues;
}

/** 모순이 하나라도 있는가 — 목록에서 배지를 띄울 때 */
export function hasDosageRouteConflict(input: Parameters<typeof dosageRouteIssues>[0]): boolean {
  return dosageRouteIssues(input).length > 0;
}
