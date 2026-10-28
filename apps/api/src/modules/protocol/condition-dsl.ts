// 프로토콜 전이 조건식 DSL — 안전 평가(eval/Function 금지·화이트리스트 필드).
// 문법: 비교를 && / || 로 결합(우선순위: AND > OR, 괄호 없음).
//   비교 = <field> <op> <value>   op ∈ ==,!=,>,>=,<,<=,in
//   값 = 숫자 | 단어/따옴표문자열 | in (a,b,c)
// 예: "ktas <= 2", "disposition == ADMISSION", "age >= 65 && ktas <= 3", "ktas in (1,2)"

export type ConditionCtx = Record<string, string | number | boolean | null | undefined>;

export interface ConditionField { field: string; label: string; type: 'number' | 'enum'; domains: string[]; values?: string[] }

// 분기에 쓸 수 있는 화이트리스트 필드(컨텍스트 빌더가 채움)
export const CONDITION_FIELDS: ConditionField[] = [
  { field: 'age', label: '나이(세)', type: 'number', domains: ['SURGERY', 'IPD', 'OPD', 'ER'] },
  { field: 'gender', label: '성별', type: 'enum', domains: ['SURGERY', 'IPD', 'OPD', 'ER'], values: ['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'] },
  { field: 'ktas', label: 'KTAS 등급(1~5)', type: 'number', domains: ['ER'] },
  { field: 'disposition', label: '응급 결정', type: 'enum', domains: ['ER'], values: ['ADMISSION', 'DISCHARGE', 'TRANSFER', 'DEATH', 'LEFT_WITHOUT'] },
];
const KNOWN_FIELDS = new Set(CONDITION_FIELDS.map((f) => f.field));
const CMP = /^([a-zA-Z_][\w.]*)\s*(==|!=|>=|<=|>|<|in)\s+(.+)$/;

function parseValue(s: string): string | number {
  const t = s.trim().replace(/^['"]|['"]$/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}
function parseList(s: string): (string | number)[] {
  return s.trim().replace(/^\(|\)$/g, '').split(',').map((x) => parseValue(x));
}
function looseEq(a: unknown, b: unknown): boolean {
  if (a == null) return false;
  if (String(a) === String(b)) return true;
  const na = Number(a), nb = Number(b);
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
}

function evalComparison(c: string, ctx: ConditionCtx): boolean {
  const m = c.trim().match(CMP);
  if (!m) return false;
  const [, field, op, rhsRaw] = m;
  const lhs = ctx[field];
  if (lhs == null) return false; // 컨텍스트에 값 없음 → 미충족
  if (op === 'in') return parseList(rhsRaw).some((v) => looseEq(lhs, v));
  const rhs = parseValue(rhsRaw);
  if (op === '==') return looseEq(lhs, rhs);
  if (op === '!=') return !looseEq(lhs, rhs);
  const a = Number(lhs), b = Number(rhs);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : false;
}

/** 조건식 평가 — 비어있으면 무조건(true). */
export function evalCondition(expr: string | undefined | null, ctx: ConditionCtx): boolean {
  if (!expr || !expr.trim()) return true;
  return expr.split('||').some((orPart) => orPart.split('&&').every((andPart) => evalComparison(andPart, ctx)));
}

/** 문법·필드 검증 — 오류 메시지 또는 null(정상). */
export function validateCondition(expr: string | undefined | null): string | null {
  if (!expr || !expr.trim()) return null;
  for (const orPart of expr.split('||')) {
    for (const andPart of orPart.split('&&')) {
      const c = andPart.trim();
      const m = c.match(CMP);
      if (!m) return `조건식 형식 오류: "${c}" (예: ktas <= 2)`;
      if (!KNOWN_FIELDS.has(m[1])) return `미지원 조건 필드: ${m[1]}`;
    }
  }
  return null;
}
