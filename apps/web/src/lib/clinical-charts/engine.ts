/**
 * 임상차트 엔진 — 순수 계산 함수 (클라이언트)
 * Scoring(합산→밴드) · Lookup(매핑) · Formula(화이트리스트 수식)
 */
import type {
  ScoringDef, LookupDef, FormulaDef, CriteriaDef, TreeDef, ScoringBand,
  ScoringResult, LookupResult, FormulaResult, CriteriaResult, RegimenDoseLine,
} from './types';

/* ── Scoring ──────────────────────────────────────────────── */
export function bandFor(bands: ScoringBand[], total: number): ScoringBand | undefined {
  return bands.find((b) => total >= b.min && total <= b.max);
}

export function computeScoring(
  def: ScoringDef,
  selections: Record<string, number>,
): ScoringResult {
  const total = def.categories.reduce((sum, c) => {
    const v = selections[c.key];
    return sum + (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
  }, 0);
  const flags = (def.alertCategories ?? []).filter(
    (k) => typeof selections[k] === 'number' && selections[k] > 0,
  );
  return { total, band: bandFor(def.bands, total), flags };
}

/* ── Lookup ───────────────────────────────────────────────── */
export function evaluateLookup(def: LookupDef, code: string): LookupResult {
  return { option: def.options.find((o) => o.code === code) };
}

/* ── Formula (화이트리스트 평가 — eval 금지) ───────────────── */
type Token =
  | { t: 'num'; v: number }
  | { t: 'var'; v: string }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' };

const FUNCS: Record<string, (args: number[]) => number> = {
  sqrt: (a) => Math.sqrt(a[0]),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  round: (a) => Math.round(a[0]),
  ln: (a) => Math.log(a[0]),
  abs: (a) => Math.abs(a[0]),
  pow: (a) => Math.pow(a[0], a[1]),
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let num = '';
      while (i < expr.length && (/[0-9.]/.test(expr[i]))) { num += expr[i++]; }
      const v = Number(num);
      if (Number.isNaN(v)) throw new Error(`잘못된 숫자: ${num}`);
      tokens.push({ t: 'num', v });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { id += expr[i++]; }
      if (id in FUNCS) tokens.push({ t: 'fn', v: id });
      else tokens.push({ t: 'var', v: id });
      continue;
    }
    if ('+-*/'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '(') { tokens.push({ t: 'lp' }); i++; continue; }
    if (ch === ')') { tokens.push({ t: 'rp' }); i++; continue; }
    if (ch === ',') { tokens.push({ t: 'comma' }); i++; continue; }
    throw new Error(`허용되지 않은 문자: '${ch}'`);
  }
  return tokens;
}

/** 재귀 하강 파서: expr = term (('+'|'-') term)* ; term = factor (('*'|'/') factor)* */
function evalTokens(tokens: Token[], vars: Record<string, number>): number {
  let pos = 0;
  const peek = () => tokens[pos];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '+' || peek()?.t === 'op' && (peek() as { v: string }).v === '-') {
      const op = (tokens[pos++] as { v: string }).v;
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek()?.t === 'op' && ((peek() as { v: string }).v === '*' || (peek() as { v: string }).v === '/')) {
      const op = (tokens[pos++] as { v: string }).v;
      const r = parseFactor();
      if (op === '/') {
        if (r === 0) throw new Error('0으로 나눔');
        v = v / r;
      } else v = v * r;
    }
    return v;
  }
  function parseFactor(): number {
    const tk = peek();
    if (!tk) throw new Error('수식이 비정상 종료됨');
    if (tk.t === 'op' && tk.v === '-') { pos++; return -parseFactor(); }
    if (tk.t === 'op' && tk.v === '+') { pos++; return parseFactor(); }
    if (tk.t === 'num') { pos++; return tk.v; }
    if (tk.t === 'var') {
      pos++;
      const val = vars[tk.v];
      if (typeof val !== 'number' || Number.isNaN(val)) throw new Error(`변수 미입력: ${tk.v}`);
      return val;
    }
    if (tk.t === 'fn') {
      const fn = tk.v; pos++;
      if (peek()?.t !== 'lp') throw new Error(`함수 ${fn} 뒤 '(' 필요`);
      pos++; // (
      const args: number[] = [];
      if (peek()?.t !== 'rp') {
        args.push(parseExpr());
        while (peek()?.t === 'comma') { pos++; args.push(parseExpr()); }
      }
      if (peek()?.t !== 'rp') throw new Error(`함수 ${fn} 닫는 ')' 필요`);
      pos++; // )
      return FUNCS[fn](args);
    }
    if (tk.t === 'lp') {
      pos++;
      const v = parseExpr();
      if (peek()?.t !== 'rp') throw new Error("닫는 ')' 필요");
      pos++;
      return v;
    }
    throw new Error('수식 파싱 실패');
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('수식에 남은 토큰이 있음');
  return result;
}

export function computeFormula(def: FormulaDef, vars: Record<string, number>): FormulaResult {
  const value = evalTokens(tokenize(def.expr), vars);
  if (!Number.isFinite(value)) throw new Error('계산 결과가 유효하지 않음');
  const band = def.bands ? bandFor(def.bands, value) : undefined;
  return { value, band };
}

/* ── Criteria (불린 로직 — AND/OR/NOT/괄호 화이트리스트) ───── */
type BTok = { t: 'id'; v: string } | { t: 'and' } | { t: 'or' } | { t: 'not' } | { t: 'lp' } | { t: 'rp' };

function tokenizeBool(expr: string): BTok[] {
  const tokens: BTok[] = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\(|\))\s*/y;
  let i = 0;
  while (i < expr.length) {
    re.lastIndex = i;
    const m = re.exec(expr);
    if (!m) throw new Error(`허용되지 않은 문자: '${expr[i]}'`);
    const tk = m[1];
    if (tk === '(') tokens.push({ t: 'lp' });
    else if (tk === ')') tokens.push({ t: 'rp' });
    else if (/^and$/i.test(tk)) tokens.push({ t: 'and' });
    else if (/^or$/i.test(tk)) tokens.push({ t: 'or' });
    else if (/^not$/i.test(tk)) tokens.push({ t: 'not' });
    else tokens.push({ t: 'id', v: tk });
    i = re.lastIndex;
  }
  return tokens;
}

/** expr = orExpr ; orExpr = andExpr (OR andExpr)* ; andExpr = unary (AND unary)* ; unary = NOT unary | id | (expr) */
function evalBool(tokens: BTok[], vals: Record<string, boolean>): boolean {
  let pos = 0;
  const peek = () => tokens[pos];
  function parseOr(): boolean {
    let v = parseAnd();
    while (peek()?.t === 'or') { pos++; const r = parseAnd(); v = v || r; }
    return v;
  }
  function parseAnd(): boolean {
    let v = parseUnary();
    while (peek()?.t === 'and') { pos++; const r = parseUnary(); v = v && r; }
    return v;
  }
  function parseUnary(): boolean {
    const tk = peek();
    if (!tk) throw new Error('식이 비정상 종료됨');
    if (tk.t === 'not') { pos++; return !parseUnary(); }
    if (tk.t === 'id') { pos++; return vals[tk.v] === true; }
    if (tk.t === 'lp') {
      pos++;
      const v = parseOr();
      if (peek()?.t !== 'rp') throw new Error("닫는 ')' 필요");
      pos++;
      return v;
    }
    throw new Error('불린식 파싱 실패');
  }
  const result = parseOr();
  if (pos !== tokens.length) throw new Error('식에 남은 토큰이 있음');
  return result;
}

export function evaluateCriteria(def: CriteriaDef, answers: Record<string, boolean>): CriteriaResult {
  const positive = evalBool(tokenizeBool(def.expr), answers);
  return { positive, verdict: positive ? def.positive : def.negative };
}

/* ── Tree (레지멘 용량 계산) ────────────────────────────────── */
export function computeRegimenDoses(
  def: TreeDef,
  ctx: { bsa?: number; gfr?: number; weight?: number },
): RegimenDoseLine[] {
  return def.regimen.drugs.map((drug) => {
    let dose: number | undefined;
    if (drug.doseBasis === 'BSA' && ctx.bsa != null) dose = drug.doseValue * ctx.bsa;
    else if (drug.doseBasis === 'AUC' && ctx.gfr != null) dose = drug.doseValue * (ctx.gfr + 25); // Calvert
    else if (drug.doseBasis === 'weight' && ctx.weight != null) dose = drug.doseValue * ctx.weight;
    else if (drug.doseBasis === 'flat') dose = drug.doseValue;
    let capped = false;
    if (dose != null && drug.cap != null && dose > drug.cap) { dose = drug.cap; capped = true; }
    return { drug, dose: dose != null ? Math.round(dose * 10) / 10 : undefined, capped };
  });
}
