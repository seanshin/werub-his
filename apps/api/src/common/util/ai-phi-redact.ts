/**
 * 외부 AI 전송 전 직접식별자 제거 — **정본 하나**.
 *
 * 🔴 배경: 같은 일을 하는 코드가 이미 네 곳에 흩어져 있었다(referral-letter·surgery·telehealth·간호 SOAP).
 *    넷 다 "성명을 `[환자명]` 으로 바꿔 보내고, 응답을 받아 실명으로 되돌린다"는 **같은 패턴**인데
 *    구현이 각자여서, 새로 생기는 경로(예약 챗봇·데이터 품질)는 그 패턴을 **아예 적용받지 못했다**.
 *    정본이 넷이면 다섯 번째는 갈라진다 — 신규·회수 경로는 이 파일만 쓴다.
 *
 * 🔴 이 유틸이 **하지 않는 것**(중요):
 *    - 이름을 **추측하지 않는다.** 호출부가 아는 이름만 지운다(`names`). 한국어 텍스트에서 인명을
 *      패턴으로 잡으려 하면 반드시 오탐이 난다 — 거짓 마스킹은 임상 텍스트를 훼손한다.
 *    - 마스킹했다고 "비식별"이라 부르지 않는다. 임상 내용 자체는 그대로 나간다.
 *      **경계를 벗어나면 안 되는 데이터는 애초에 보내지 않는 것이 정답**이고(INV-PHI-03),
 *      이 유틸은 그때까지의 피해 축소 수단이다.
 */

import { createHmac } from 'crypto';

import { signingSecret } from './signing-secret';

/** LLM 에게 "이 자리에 이름이 온다"고 알려주는 표기 — 응답 수신 후 서버가 실명으로 되돌린다. */
export const PATIENT_NAME_PLACEHOLDER = '[환자명]';
export const STAFF_NAME_PLACEHOLDER = '[의료진명]';

/** 값으로 보이면 지우는 직접식별자 — **형식이 명확한 것만**(오탐 시 임상 텍스트 훼손). */
const IDENTIFIER_RULES: { re: RegExp; to: string }[] = [
  // 주민등록번호 13자리(하이픈 유무). 생년월일 6자리 + 성별코드로 시작하는 7자리.
  { re: /\b\d{6}\s?-\s?[1-8]\d{6}\b/g, to: '[주민번호]' },
  // 외국인등록번호도 같은 형식(성별코드 5~8) — 위 규칙에 포함됨.
  // 여권번호 — 한국 여권 M12345678(영문 1~2 + 숫자 8). 숫자 7자리까지 넓히면 검사·오더 코드를
  // 오탐하므로 8자리로 좁힌다(거짓 마스킹은 임상 텍스트를 훼손한다).
  { re: /\b[A-Z]{1,2}\d{8}\b/g, to: '[여권번호]' },
  // 휴대전화·유선 (010-1234-5678 / 02-000-0000 / 01012345678)
  { re: /\b0\d{1,2}\s?-\s?\d{3,4}\s?-\s?\d{4}\b/g, to: '[전화번호]' },
  { re: /\b01[016789]\d{7,8}\b/g, to: '[전화번호]' },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, to: '[이메일]' },
  // HIS 내부 식별자(UUID) — 외부에 나가면 재식별 키가 된다.
  { re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, to: '[식별자]' },
];

/** 형식이 명확한 직접식별자 제거 + **치환 건수**(화면이 "몇 건을 지웠다"고 말할 재료 — 지어내지 않고 센다). */
function redactIdentifiersCounted(text: string): { text: string; count: number } {
  let out = text;
  let count = 0;
  for (const { re, to } of IDENTIFIER_RULES) {
    out = out.replace(re, () => {
      count += 1;
      return to;
    });
  }
  return { text: out, count };
}

/** 형식이 명확한 직접식별자 제거(이름은 건드리지 않음 — `redactKnownValues` 참조). */
export function redactIdentifiers(text: string): string {
  return redactIdentifiersCounted(text).text;
}

/** 호출부가 **아는** 이름/MRN 만 플레이스홀더로 치환 + 건수. 추측하지 않는다. */
function redactKnownValuesCounted(
  text: string,
  values: (string | null | undefined)[],
  placeholder: string,
): { text: string; count: number } {
  let out = text;
  let count = 0;
  // 긴 값부터 — '김철수' 를 먼저 지우고 '철수' 를 보면 남은 자리가 없어 이중 계수가 나지 않는다
  const vals = [...new Set(values.map((v) => (v ?? '').trim()).filter((v) => v.length >= 2))].sort((a, b) => b.length - a.length);
  for (const s of vals) {
    const parts = out.split(s);
    count += parts.length - 1;
    out = parts.join(placeholder);
  }
  return { text: out, count };
}

/** 호출부가 **아는** 이름/MRN 만 플레이스홀더로 치환. 추측하지 않는다(1글자 값은 오탐 폭발 — 건드리지 않는다). */
export function redactKnownValues(text: string, values: (string | null | undefined)[], placeholder: string): string {
  return redactKnownValuesCounted(text, values, placeholder).text;
}

export interface AiEgressRedaction {
  /** 외부로 보내도 되는 텍스트 */
  text: string;
  /** 실제로 치환이 일어났는지(감사 로그용 — 본문은 기록하지 않는다) */
  redacted: boolean;
  /**
   * 치환 건수 — `names`=환자·의료진·등록번호 등 **호출부가 준 값**의 치환 수, `identifiers`=형식 기반(주민·전화·이메일·UUID).
   * 🔴 "비식별했다"의 근거가 아니라 **무엇을 얼마나 지웠는지**의 사실이다(0 = 지울 것이 없었거나 이름을 못 받았거나 — 호출부가 가른다).
   */
  counts: { names: number; identifiers: number };
  /** LLM 응답의 플레이스홀더를 실명으로 되돌린다(문자열/객체 모두). 실패 시 원본 유지. */
  rehydrate<T>(value: T): T;
}

export interface AiEgressRedactOptions {
  /** 환자 성명(알고 있을 때만) */
  patientNames?: (string | null | undefined)[];
  /** 의료진 성명(알고 있을 때만) */
  staffNames?: (string | null | undefined)[];
  /** MRN 등 병원 발급 번호 */
  recordNumbers?: (string | null | undefined)[];
  /** 형식 기반 식별자(주민·전화·이메일·UUID) 제거 여부. 기본 true */
  identifiers?: boolean;
  /**
   * 되돌릴 실명을 **호출부가 명시**한다 — `patientNames` 에 한 사람의 표기 여러 개(성명·띄어쓴 성명·한글 호칭·이름만)를
   * 넣으면 자동 되돌리기는 "어느 이름인지 모른다"며 멈추는데, 호출부는 그것이 **한 사람**임을 안다.
   * 여기 적은 값으로만 되돌린다. 적지 않으면 종전 규칙(이름이 하나일 때만).
   */
  rehydrateTo?: { patient?: string | null; staff?: string | null };
}

/**
 * 외부 AI 전송 직전 1회 호출 — 치환된 텍스트와 **되돌리는 함수**를 함께 돌려준다.
 *
 * ```ts
 * const red = redactForAiEgress(prompt, { patientNames: [name] });
 * const answer = await ai.complete(red.text);
 * return red.rehydrate(answer);   // 실명은 서버 안에서만 붙는다
 * ```
 */
export function redactForAiEgress(text: string, opts: AiEgressRedactOptions = {}): AiEgressRedaction {
  const patientNames = (opts.patientNames ?? []).map((n) => (n ?? '').trim()).filter((n) => n.length >= 2);
  const staffNames = (opts.staffNames ?? []).map((n) => (n ?? '').trim()).filter((n) => n.length >= 2);

  let out = text;
  let names = 0;
  let identifiers = 0;
  const p = redactKnownValuesCounted(out, patientNames, PATIENT_NAME_PLACEHOLDER);
  out = p.text; names += p.count;
  const st = redactKnownValuesCounted(out, staffNames, STAFF_NAME_PLACEHOLDER);
  out = st.text; names += st.count;
  const rn = redactKnownValuesCounted(out, opts.recordNumbers ?? [], '[등록번호]');
  out = rn.text; names += rn.count;
  if (opts.identifiers !== false) {
    const idr = redactIdentifiersCounted(out);
    out = idr.text; identifiers = idr.count;
  }

  // 되돌리기: 이름이 **하나일 때만** 안전하다. 여럿이면 어느 이름인지 알 수 없으므로
  // 되돌리지 않는다(모르는 것을 아는 것처럼 말하지 않는다 — 엉뚱한 사람 이름이 기록에 박히는 사고 방지).
  // 단 호출부가 `rehydrateTo` 로 "여러 표기가 한 사람"임을 밝혔으면 그 값으로 되돌린다.
  const explicitPatient = (opts.rehydrateTo?.patient ?? '').trim();
  const explicitStaff = (opts.rehydrateTo?.staff ?? '').trim();
  const patientBack = explicitPatient || (patientNames.length === 1 ? patientNames[0] : null);
  const staffBack = explicitStaff || (staffNames.length === 1 ? staffNames[0] : null);

  const swap = (s: string): string => {
    let r = s;
    if (patientBack) r = r.split(PATIENT_NAME_PLACEHOLDER).join(patientBack);
    if (staffBack) r = r.split(STAFF_NAME_PLACEHOLDER).join(staffBack);
    return r;
  };

  return {
    text: out,
    redacted: out !== text,
    counts: { names, identifiers },
    rehydrate<T>(value: T): T {
      if (value == null) return value;
      if (typeof value === 'string') return swap(value) as unknown as T;
      if (typeof value !== 'object') return value;
      try {
        return JSON.parse(swap(JSON.stringify(value))) as T;
      } catch {
        return value; // 직렬화 불가(순환 등) — 원본 유지
      }
    },
  };
}

/**
 * HIS 내부 식별자(환자 UUID 등)를 외부 AI 에 넘겨야 할 때의 **가명**.
 *
 * 🔴 외부 서비스에 HIS 의 환자 UUID 를 그대로 주면, 그쪽에 남는 모든 대화가 **우리 원장(原帳) 키로
 *    묶인 재식별 가능 기록**이 된다. 세션 연속성만 필요하다면 원 키를 줄 이유가 없다.
 *    AUTH_SECRET 기반 HMAC — 우리만 되돌릴 수 있고, 저쪽에서는 그냥 안정된 문자열이다.
 *
 * 시크릿을 못 읽으면 **가명 대신 아무것도 보내지 않는다**(null) — 실패는 안전한 쪽으로만.
 */
export function aiPseudonymousId(id: string | null | undefined): string | null {
  const raw = (id ?? '').trim();
  if (!raw) return null;
  try {
    return createHmac('sha256', signingSecret('ai-egress')).update(raw).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}
