/**
 * AI 스킬 **검증층 · 출력 계약** — 정본. 기획서 `chart-ai-assistant-agent.plan.md` §4.1·§4.4.
 *
 * 🔴 왜 있는가(2026-08-19 운영 실측): 검사해석이 K 5.9(H) 를 "저하"라 말했고, SOAP 초안이 영어로 "ACS 에서 아스피린 회피"를
 *    조언했고, 감별진단은 15~23초 뒤 **빈 배열**을 `source` 없이 돌려줘 화면이 "아직 안 눌렀다"처럼 그렸다.
 *    LLM 을 믿지 않는다 — 결정론 규칙을 통과한 것만 `AI` 로 나가고, 못 넘으면 `FALLBACK`(사유 코드) 로 **말한다**.
 *
 * 규칙은 순수 함수다(테스트 가능·모듈 의존 없음). 사유 코드는 계측의 분모가 된다(폐기율 사유별).
 */

import { roundBy } from '@hospital-run/shared';

export type SkillSource = 'AI' | 'FALLBACK' | 'UNAVAILABLE';
export type SkillReason =
  | 'EMPTY_RESULT' | 'PARSE_FAILED' | 'TIMEOUT' | 'UPSTREAM_ERROR' | 'UPSTREAM_FALLBACK'
  /**
   * 🔴 상류 401/403 — **키 인증 실패**. "AI 서버 오류"와 다른 사실이다: 재시도로 풀리지 않고 키를 교체해야 풀린다.
   *    (2026-09-09 P0-C R6: 종전엔 401 을 보면 하드코딩 조직정보로 테넌트를 재등록해 **새 키를 무감사·무승인으로**
   *     받아 메모리에 넣었다. 자동 재발급을 지우고, 못 부른다는 사실을 그대로 말한다.)
   */
  | 'UPSTREAM_AUTH'
  | `VERIFY_REJECTED:${string}`;

export interface SkillEnvelope {
  source: SkillSource;
  reason?: SkillReason | string;
  latencyMs: number;
  /** 검증층 결과 — 통과/실패 규칙명(화면·계측이 문구가 아니라 코드로 분기) */
  verify: { passed: string[]; failed: string[] };
  /** 무엇을 근거로 봤는지(근거 앵커가 없을 때 "무엇만 봤다"를 말한다) */
  groundedOn?: string[];
}

export interface VerifyCheck { name: string; ok: boolean; detail?: string }

// ── 규칙 1: 한국어 출력 ─────────────────────────────────────────────────────────
/** 한글(가-힣) 문자 비율 — 숫자·기호·공백은 분모에서 뺀다. 임상 약어(BP·SpO2·ACS)는 영문이라 임계는 0.3 으로 낮춘다. */
export function koreanRatio(text: string): number {
  const letters = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
  if (letters === 0) return 1; // 글자가 없으면(숫자만) 언어 위반이 아니다
  const ko = (text.match(/[가-힣]/g) ?? []).length;
  return ko / letters;
}
export function checkKorean(text: string, min = 0.3): VerifyCheck {
  const r = koreanRatio(text);
  return { name: 'KOREAN', ok: r >= min, detail: `ko%=${roundBy(r * 100, 'percent')}` };
}
/** 🔴 운영 실측(2026-08-19): 모델이 "D-다имер"·"에나르プリ" 처럼 한글에 키릴·가나를 섞어 낸다 — 약명이 깨지면 약가마스터 매칭도 실패한다 */
export function checkNoMixedScript(text: string): VerifyCheck {
  const m = text.match(/[\u0400-\u04FF\u3040-\u30FF]/g);
  return { name: 'MIXED_SCRIPT', ok: !m, detail: m ? `${m.length}자(${[...new Set(m)].slice(0, 5).join('')})` : undefined };
}

// ── 규칙 2: 검사 flag ↔ 해석 방향 대조 ───────────────────────────────────────────
const UP_WORDS = /(상승|증가|높|고[가-힣]*증|과다|초과)/;
const DOWN_WORDS = /(저하|감소|낮|저[가-힣]*증|미달|부족)/;
export type LabFlag = 'H' | 'HH' | 'L' | 'LL' | 'N' | '' | null | undefined;
export interface LabInput { testName: string; value?: string | number; flag?: LabFlag }
export interface LabFinding { test: string; interpretation?: string; severity?: string }

/**
 * flag H/HH 인데 해석이 "저하/낮음"만 말하거나, L/LL 인데 "상승/높음"만 말하면 방향 반전이다.
 * 둘 다 언급(예: "상승 — 저하 시 …")은 반전으로 보지 않는다(보수적 — 거짓 경보를 죽이지 않는다).
 */
export function checkLabDirection(inputs: LabInput[], findings: LabFinding[]): VerifyCheck {
  const bad: string[] = [];
  const byName = new Map(inputs.map((i) => [normName(i.testName), i]));
  for (const f of findings) {
    const inp = byName.get(normName(f.test));
    if (!inp || !inp.flag) continue;
    const t = f.interpretation ?? '';
    const up = UP_WORDS.test(t), down = DOWN_WORDS.test(t);
    if ((inp.flag === 'H' || inp.flag === 'HH') && down && !up) bad.push(`${f.test}:H→저하`);
    if ((inp.flag === 'L' || inp.flag === 'LL') && up && !down) bad.push(`${f.test}:L→상승`);
  }
  return { name: 'LAB_DIRECTION', ok: bad.length === 0, detail: bad.join(',') || undefined };
}
const normName = (s: string) => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, '');

// ── 규칙 3: 입력에 없는 검사 언급 ────────────────────────────────────────────────
export function checkMentionsOnlyProvidedTests(inputs: LabInput[], findings: LabFinding[]): VerifyCheck {
  const provided = new Set(inputs.map((i) => normName(i.testName)));
  const extra = findings.map((f) => f.test).filter((t) => t && !provided.has(normName(t)));
  return { name: 'ONLY_PROVIDED_TESTS', ok: extra.length === 0, detail: extra.join(',') || undefined };
}

// ── 규칙 4: 성별·연령 부적합 진단어 ─────────────────────────────────────────────
/** 최소 사전 — 위원회가 관리한다(기획서 §6-2). 여기 없는 것은 통과(거짓 경보 금지) */
const FEMALE_ONLY = /(자궁|난소|월경|폐경|임신|자궁경부|질염|유방암 재발)/; // 유방은 남성도 있어 제외
const MALE_ONLY = /(전립선|고환|정낭|음낭)/;
const PEDIATRIC_ONLY = /(신생아 황달|영아 산통|소아 발달 지연)/;
export function checkSexAgeAppropriate(text: string, sex: 'MALE' | 'FEMALE' | string | null | undefined, age: number | null | undefined): VerifyCheck {
  const bad: string[] = [];
  if (sex === 'FEMALE' && MALE_ONLY.test(text)) bad.push('FEMALE:' + text.match(MALE_ONLY)![0]);
  if (sex === 'MALE' && FEMALE_ONLY.test(text)) bad.push('MALE:' + text.match(FEMALE_ONLY)![0]);
  if (age != null && age >= 18 && PEDIATRIC_ONLY.test(text)) bad.push('ADULT:' + text.match(PEDIATRIC_ONLY)![0]);
  return { name: 'SEX_AGE', ok: bad.length === 0, detail: bad.join(',') || undefined };
}

// ── 규칙 5: 금칙 조언(최소 사전 · 위원회 관리) ───────────────────────────────────
const FORBIDDEN_ADVICE: Array<{ re: RegExp; label: string }> = [
  { re: /(avoid(?:ing|ed)?|withhold(?:ing)?|do not give|skip(?:ping)?)\s+aspirin.{0,80}(ACS|acute coronary|myocardial|STEMI|NSTEMI)/i, label: 'ACS-aspirin-avoid' },
  { re: /(ACS|급성 관상동맥|심근경색).{0,40}(아스피린|aspirin).{0,20}(회피|금지|피하)/, label: 'ACS-aspirin-avoid' },
  { re: /NSAIDs?.{0,120}(ACS|acute coronary|급성 관상동맥)/i, label: 'ACS-NSAID' },
];
export function checkForbiddenAdvice(text: string): VerifyCheck {
  const hit = FORBIDDEN_ADVICE.find((f) => f.re.test(text));
  return { name: 'FORBIDDEN_ADVICE', ok: !hit, detail: hit?.label };
}

// ── 규칙 6: 약명이 약가마스터로 특정되는가 ───────────────────────────────────────
/**
 * 🔴 2026-08-20 운영 실측: 진단 5종으로 `POST /api/v1/ai/recommend-drugs` 를 부르니 LLM 이 낸 약명 **6건 중 4건이
 *    약가마스터에 없었다** — `나이아즈올`(존재하지 않는 약 = 환각) · `로바statin`(한글+라틴 혼입) ·
 *    `파разォ린`(키릴+가나 — 이건 MIXED_SCRIPT 가 잡았다) · `Rosiglitazone`(국내 마스터 부재).
 *    그런데 그중 일부가 `source:'AI'` 로 나갔다 — **존재하지 않는 약을 "AI 검증 통과"로 화면에 내보내고 있었다.**
 *
 * 판정 재료는 `drug-verdict.ts` 가 이미 채운 `resolution`(EXACT|INGREDIENT_GROUP|AMBIGUOUS|NONE) 이다
 * (여기서 다시 조회하지 않는다 — 정본이 둘이면 갈라진다).
 *
 * 분모 규약(🔴 이 규칙이 거짓 경보가 되지 않게 하는 부분)
 *   · `items` 가 비면 **통과** — 빈 결과는 `NON_EMPTY` 가 잡는다. 한 사실에 두 규칙이 겹치면 폐기 사유가 갈린다.
 *   · `resolution` 이 하나도 기록되지 않았으면(DUR 미주입·재검증 실패) **통과** — 모르는 것을 위반으로 세지 않는다.
 *   · 분모는 **특정을 시도한 추천 수**다. detail 은 `미매칭 n/N` 으로 분모를 함께 낸다.
 *   · `AMBIGUOUS`(후보 여럿)는 미매칭이 아니다 — 처방 폼에서 특정할 수 있다. `NONE` 만 센다.
 */
export function checkDrugsResolvable(
  items: Array<{ resolution?: string | null }> | null | undefined,
  maxUnresolvedRatio = 0.5,
): VerifyCheck {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { name: 'DRUGS_RESOLVABLE', ok: true };
  const known = list.filter((r) => typeof r?.resolution === 'string' && r.resolution !== '');
  if (known.length === 0) return { name: 'DRUGS_RESOLVABLE', ok: true, detail: `판정 보류 — 특정 결과 미기록 ${list.length}건` };
  const max = Number.isFinite(maxUnresolvedRatio) && maxUnresolvedRatio >= 0 ? Math.min(1, maxUnresolvedRatio) : 0.5;
  const unresolved = known.filter((r) => r.resolution === 'NONE').length;
  return { name: 'DRUGS_RESOLVABLE', ok: unresolved / known.length <= max, detail: `미매칭 ${unresolved}/${known.length}` };
}

/** 용량 토큰 — 약명 표기 판정 전에 떼어낸다(`아스피린정100mg` 의 `mg` 를 라틴 혼입으로 보지 않게) */
const DOSE_TOKEN_RE = /(?<![A-Za-z0-9])\d+(?:[.,]\d+)?\s*(mg|mcg|µg|ug|g|kg|ml|mL|L|IU|U|%|정|캡슐|포|앰플|바이알|단위)(?![A-Za-z가-힣])/gi;

/**
 * 🔴 `checkNoMixedScript` 는 **키릴·가나만** 본다 — 한글+라틴 혼입(`로바statin`)은 통과한다.
 *    그렇다고 그 규칙을 넓히면 안 된다: 본문에는 `SpO2`·`D-dimer`·`ECG` 같은 정상 약어가 늘 섞여 있어 오탐이 된다.
 *    그래서 **약명에만** 적용하는 별도 규칙을 둔다.
 *
 * 판정: 한 토큰(단어) 안에 한글이 있고 **라틴 3글자 이상이 연달아 붙어** 있으면 표기 혼입이다.
 *   · 실패: `로바statin`
 *   · 통과: `ramipril` · `D-dimer`(한글 없음) · `암로디핀 5mg`·`아스피린정100mg`(용량 토큰) ·
 *           `비타민B12`·`메트포르민XR`(라틴 2글자 이하 접미 — 국내 상품명 관용) · `아스피린(aspirin)`·`아스피린-aspirin`(한글 병기)
 */
export function checkDrugNameScript(names: Array<string | null | undefined> | null | undefined): VerifyCheck {
  const bad: string[] = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const s = String(raw ?? '');
    if (!s.trim()) continue;
    const cleaned = s.replace(/[（(][^)）]*[)）]/g, ' ').replace(DOSE_TOKEN_RE, ' ');
    for (const tok of cleaned.split(/[\s,/·+\-–—()[\]{}]+/)) {
      if (!tok || !/[가-힣]/.test(tok)) continue;
      if (/[A-Za-z]{3,}/.test(tok)) { bad.push(s); break; }
    }
  }
  const uniq = [...new Set(bad)];
  return { name: 'DRUG_NAME_SCRIPT', ok: uniq.length === 0, detail: uniq.length ? uniq.slice(0, 5).join(',') : undefined };
}

// ── 규칙 7: 빈 결과 ────────────────────────────────────────────────────────────
export function checkNonEmpty(name: string, items: unknown[] | string | null | undefined): VerifyCheck {
  const ok = Array.isArray(items) ? items.length > 0 : typeof items === 'string' ? items.trim().length > 0 : false;
  return { name: `NON_EMPTY:${name}`, ok };
}

/** 객체의 문자열 잎(값)만 모은다 — JSON 키(영문)가 한국어 비율을 오염시키지 않게 */
export function textOf(v: unknown, depth = 0): string {
  if (depth > 6 || v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return '';
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth + 1)).join('\n');
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map((x) => textOf(x, depth + 1)).join('\n');
  return '';
}

// ── LLM JSON 추출 ───────────────────────────────────────────────────────────────
/**
 * LLM 답변에서 **첫 번째 균형 잡힌 JSON 객체**를 뽑는다. 종전 `text.match(/\{[\s\S]*\}/)` 는 탐욕 매칭이라
 * 답변 뒤에 설명·코드펜스·두 번째 객체가 붙으면 통째로 파싱 실패했다(운영 재실측: 감별진단·검사해석 "JSON 파싱 실패").
 * 문자열 안의 중괄호·이스케이프를 존중한다. 못 찾으면 null(호출자가 PARSE_FAILED 로 말한다).
 */
export function extractJsonObject(text: string | null | undefined): unknown | null {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  let innerStart = -1; const innerObjs: unknown[] = [];
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { depth++; if (depth === 2) innerStart = i; }
    else if (ch === '}') {
      depth--;
      if (depth === 1 && innerStart >= 0) { const inner = parseLenient(t.slice(innerStart, i + 1)); if (inner && typeof inner === 'object' && !Array.isArray(inner)) innerObjs.push(inner); innerStart = -1; }
      if (depth === 0) { const cand = t.slice(start, i + 1); return parseLenient(cand) ?? (innerObjs.length ? { __array: innerObjs } : null); }
    }
  }
  // 🔴 끝까지 균형이 안 맞으면(토큰 상한으로 잘린 답변 — 운영 실측 len 649·braces 7) 완결된 안쪽 객체만 살린다
  return innerObjs.length ? { __array: innerObjs, __truncated: true } : null;
}
function parseLenient(cand: string): unknown | null {
  try { return JSON.parse(cand); } catch { /* 아래 보정 */ }
  const noTrailingComma = cand.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(noTrailingComma); } catch { /* 아래 보정 */ }
  // 🔴 운영 재실측(2026-08-19): 모델이 `{ {…}, {…} }` — 배열을 중괄호로 감싼 "객체 집합"을 낸다(키 없음). 배열로 읽어 `__array` 로 돌려준다.
  if (/^\{\s*\{/.test(noTrailingComma)) {
    try { const arr = JSON.parse('[' + noTrailingComma.slice(1, -1) + ']'); if (Array.isArray(arr)) return { __array: arr }; } catch { /* 포기 */ }
  }
  return null;
}

// ── 봉투 ───────────────────────────────────────────────────────────────────────
/**
 * 검증 결과를 출력 계약으로 접는다 — 하나라도 실패하면 `FALLBACK` + `VERIFY_REJECTED:<첫 실패 규칙>`.
 * 실패해도 본문은 **지우지 않는다**(화면이 "왜 못 믿는지"와 함께 접어서 보여줄 수 있게) — 다만 `source` 가 AI 가 아니다.
 */
export function finalizeSkill<T extends object>(
  result: T,
  startedAt: number,
  checks: VerifyCheck[],
  opts?: { groundedOn?: string[]; sourceOverride?: { source: SkillSource; reason: SkillReason | string } },
): T & SkillEnvelope {
  const failed = checks.filter((c) => !c.ok);
  const envelope: SkillEnvelope = {
    source: 'AI',
    latencyMs: Math.max(0, Date.now() - startedAt),
    verify: { passed: checks.filter((c) => c.ok).map((c) => c.name), failed: failed.map((c) => (c.detail ? `${c.name}(${c.detail})` : c.name)) },
    groundedOn: opts?.groundedOn,
  };
  if (opts?.sourceOverride) {
    envelope.source = opts.sourceOverride.source;
    envelope.reason = opts.sourceOverride.reason;
  } else if (failed.length) {
    envelope.source = 'FALLBACK';
    // 빈 결과는 검증 실패가 아니라 "결과 없음"이다 — 사유 코드를 구분한다(계측 분모가 갈린다)
    const empty = failed.find((c) => c.name.startsWith('NON_EMPTY:'));
    envelope.reason = empty && failed.length === 1 ? 'EMPTY_RESULT' : `VERIFY_REJECTED:${(failed.find((c) => !c.name.startsWith('NON_EMPTY:')) ?? failed[0]).name}`;
  }
  return { ...result, ...envelope };
}

/** 검증 없이 실패를 봉투로 — 상류 오류·타임아웃·파싱 실패 */
export function failedSkill<T extends object>(result: T, startedAt: number, reason: SkillReason | string, groundedOn?: string[]): T & SkillEnvelope {
  return { ...result, source: 'FALLBACK', reason, latencyMs: Math.max(0, Date.now() - startedAt), verify: { passed: [], failed: [] }, groundedOn };
}

/**
 * 말할 수 없음 봉투 — `FALLBACK`(규칙으로 대체했다)과 다른 사실이다: **대체조차 하지 못했다.**
 * 상류 인증 실패(401/403)처럼 재시도로 풀리지 않고 사람이 키를 교체해야 하는 경우에 쓴다.
 */
export function unavailableSkill<T extends object>(result: T, startedAt: number, reason: SkillReason | string, groundedOn?: string[]): T & SkillEnvelope {
  return { ...result, source: 'UNAVAILABLE', reason, latencyMs: Math.max(0, Date.now() - startedAt), verify: { passed: [], failed: [] }, groundedOn };
}
