/**
 * 내과 진료 화면 — 입력값을 진료기록(SOAP)으로 모으는 정본 (2026-08-18).
 *
 * 🔴 배경: 내과 화면은 현병력·검사값 12종·만성질환 목표·소견을 받아
 *    `POST /internal-medicine/exams` 로 보냈지만, 서버 DTO 에 해당 키가 없어
 *    전역 `ValidationPipe({ whitelist: true })` 가 **전부 조용히 버렸다.**
 *    화면은 "저장되었습니다"라고 말했다.
 *
 * 저장 위치 판정(2026-08-18 실측):
 * - `hba1c` 는 `InternalMedicineExam.hba1c` 컬럼이 있다 → 그 컬럼으로 보낸다.
 * - 나머지 검사값 11종은 컬럼이 없다. 🔴 **LabResult 로 만들지 않는다** —
 *   오더도 검체도 없는 값을 검사 원장에 넣으면 *시행하지 않은 검사의 결과*가 된다(P16).
 *   의사가 참조로 적은 값이므로 **진료기록 objective** 에 원문 그대로 남긴다.
 * - 현병력(HPI)은 subjective, 소견은 objective, 만성질환 관리 목표는 plan —
 *   SOAP 의 표준 자리다. 의사가 직접 쓴 SOAP 문단을 **덮어쓰지 않고 뒤에 잇는다.**
 * - 만성질환 **개인별 목표를 저장하는 모델이 없다**(서버 problem view 는 가이드라인 정본).
 *   그래서 목표·현재값도 기록으로만 남긴다 — 지표 시계열(ChronicObservation)에는 넣지 않는다.
 *   수기 입력을 시계열에 섞으면 추이·달성률이 오염된다.
 */

export interface SoapDraft {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
}

export interface LabEntry {
  key: string;
  label: string;
  value: string;
  unit: string;
}

export interface ChronicEntry {
  key: string;
  label: string;
  checked: boolean;
  targetValue: string;
  currentValue: string;
  unit: string;
}

/** 값이 있는 검사만 "AST 42 U/L" 형태로. 판정(정상/이상)은 붙이지 않는다 — 값만 사실이다. */
export function labSummary(labs: LabEntry[]): string {
  const entered = labs.filter((l) => l.value.trim() !== '');
  if (entered.length === 0) return '';
  return `검사값: ${entered.map((l) => `${l.label} ${l.value.trim()}${l.unit ? ` ${l.unit}` : ''}`).join(' · ')}`;
}

/** 체크된 만성질환만. 목표·현재값은 입력된 것만 적는다(빈 값을 0 이나 '-' 로 만들지 않는다). */
export function chronicSummary(conditions: ChronicEntry[]): string {
  const active = conditions.filter((c) => c.checked);
  if (active.length === 0) return '';
  const parts = active.map((c) => {
    const bits = [
      c.currentValue.trim() && `현재 ${c.currentValue.trim()}`,
      c.targetValue.trim() && `목표 ${c.targetValue.trim()}`,
    ].filter(Boolean);
    const detail = bits.length > 0 ? ` (${bits.join(' / ')}${c.unit ? ` ${c.unit}` : ''})` : '';
    return `${c.label}${detail}`;
  });
  return `만성질환 관리: ${parts.join(' · ')}`;
}

/** 같은 칸에 두 문단이 오면 줄바꿈으로 잇는다. 빈 문단은 만들지 않는다. */
function join(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.map((p) => (p ?? '').trim()).filter((p) => p !== '');
  return kept.length > 0 ? kept.join('\n') : undefined;
}

/**
 * 화면 입력 → 서명·임시저장에 실릴 SOAP.
 * 의사가 SOAP 칸에 직접 쓴 내용이 **앞**이고, 구조화 입력이 뒤에 붙는다.
 */
export function buildInternalMedicineSoap(input: {
  soap: SoapDraft;
  hpi: string;
  findings: string;
  labs: LabEntry[];
  conditions: ChronicEntry[];
}): SoapDraft {
  const { soap, hpi, findings, labs, conditions } = input;
  return {
    subjective: join(soap.subjective, hpi.trim() ? `현병력: ${hpi.trim()}` : ''),
    objective: join(soap.objective, findings, labSummary(labs)),
    assessment: join(soap.assessment),
    plan: join(soap.plan, chronicSummary(conditions)),
  };
}

/** 검사 탭의 HbA1c — 유일하게 저장 컬럼이 있는 항목. 값이 없으면 보내지 않는다. */
export function hba1cOf(labs: LabEntry[]): number | undefined {
  const v = labs.find((l) => l.key === 'hba1c')?.value.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
