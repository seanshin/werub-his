/**
 * 행정 **증빙 문서 판독** 어휘 정본 — 2026-08-28.
 *
 * 사람 지시: *"증빙자료 첨부하도록 하게 하고, 자료는 AI가 분석해서 입력하도록."*
 *
 * 대상은 **행정 증빙**이다 — 개설신고증·사업자등록증·계약서·지정통지서 같은 것.
 * 임상 문서가 아니다(임상은 별도 축이고 규약이 다르다).
 *
 * 🔴 이 파일이 못박는 것 넷 — 어기면 화면이 사람 대신 사실을 정한다.
 *
 * ① **판독은 초안이다.** 저장하지 않는다. 사람이 보고 고쳐서 저장한다.
 *    자동 저장은 P16(실행하지 않고 성공 상태만 기록)의 문서판이다.
 * ② **못 읽은 칸은 빈 칸이다.** 그럴듯한 값을 만들지 않는다 — 증빙 번호를
 *    지어내면 그 번호가 원장에 박히고, 나중에 아무도 그게 가짜인 줄 모른다.
 * ③ **출처는 3상태**(`AI`/`FALLBACK`/`UNAVAILABLE`). 안 부른 것과 부르고 실패한 것과
 *    성공한 것은 다른 사실이다.
 *    🔴 이 축에는 **`FALLBACK` 이 없다** — 규칙 기반으로 문서 번호를 "추정"하는 것은
 *    대체가 아니라 날조다. 부를 수 없으면 `UNAVAILABLE` 이다.
 * ④ **문서가 어디로 가는지 화면이 말한다.** 파일이 AI 서버로 전송된다는 사실을
 *    숨기면 사람은 원내 처리라고 믿는다.
 */

/** 판독 출처 — 🔴 `FALLBACK` 은 이 축에 없다(규칙으로 번호를 추정하지 않는다) */
export type EvidenceExtractSource = 'AI' | 'UNAVAILABLE';

/** 판독이 채우려는 칸 — 🔴 화면 입력칸과 **같은 이름**이어야 옮겨 담을 때 갈라지지 않는다 */
export interface EvidenceExtractFields {
  /** 증빙 참조(신고증·문서 번호) */
  evidenceRef?: string;
  /** 증빙 일자 — `YYYY-MM-DD` 만. 형식이 안 맞으면 **비운다** */
  evidenceDate?: string;
  /** 발급 기관 */
  issuer?: string;
  /** 문서 제목 */
  docTitle?: string;
}

export const EVIDENCE_FIELD_LABEL: Record<keyof EvidenceExtractFields, string> = {
  evidenceRef: '증빙 참조(문서 번호)',
  evidenceDate: '증빙 일자',
  issuer: '발급 기관',
  docTitle: '문서 제목',
};

export interface EvidenceExtractResult {
  source: EvidenceExtractSource;
  /** 🔴 못 읽은 칸은 **없는 키**다 — 빈 문자열로 "읽었는데 비었다"라고 말하지 않는다 */
  fields: EvidenceExtractFields;
  /**
   * 🔴 왜 이 결과인가 — `UNAVAILABLE` 이면 **이유가 반드시 있다**.
   *    "AI 판독을 끄셨습니다" / "PDF 는 판독할 수 없습니다" / "AI 서버에 닿지 못했습니다".
   *    조용한 빈 결과는 "문서에 아무것도 없다"로 읽힌다.
   */
  reason: string | null;
  /** 판독한 파일 — 사람이 무엇을 근거로 채워졌는지 알아야 한다 */
  fileName: string | null;
  extractedAt: string;
}

/** 판독 불가를 만드는 유일한 통로 — 이유 없는 `UNAVAILABLE` 을 만들 수 없게 한다 */
export function evidenceUnavailable(reason: string, fileName?: string | null): EvidenceExtractResult {
  return {
    source: 'UNAVAILABLE',
    fields: {},
    reason,
    fileName: fileName ?? null,
    extractedAt: new Date().toISOString(),
  };
}

/** `YYYY-MM-DD` 만 통과 — 그 밖은 **버린다**(형식을 고쳐 맞추면 날짜를 지어내는 것이다) */
export function pickIsoDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  // 실재하는 날짜인가(2026-02-30 을 통과시키지 않는다)
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 문자열 칸 — 공백뿐이면 **키를 만들지 않는다**(빈 값과 미판독을 뭉개지 않는다) */
export function pickText(raw: unknown, max = 200): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  return v.slice(0, max);
}

/** 판독 결과가 실제로 무언가를 채웠는가 — 화면이 "채운 칸 없음"을 말할 수 있게 */
export function extractedCount(f: EvidenceExtractFields): number {
  return Object.values(f).filter((v) => typeof v === 'string' && v.trim()).length;
}

/** 🔴 화면이 반드시 보여줘야 하는 사실 — 파일이 원내를 떠난다 */
export const EVIDENCE_EGRESS_NOTICE =
  '첨부한 문서가 AI 판독 서버로 전송됩니다. 판독 결과는 **초안**이며 저장되지 않습니다 — 확인하고 고친 뒤 저장하세요.';
