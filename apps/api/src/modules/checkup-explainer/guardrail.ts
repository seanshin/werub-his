/**
 * 검진결과 해석 서비스 — 출력 가드레일 (웰니스 유지 · 규제 안전장치)
 * 원 기획서 §7.2: 진단 확정·처방/용량 지시 패턴을 출력 단계에서 차단, 면책 상시 부착.
 *
 * ⚠️ 방어적 휴리스틱(defense-in-depth)이며 단독 안전장치가 아니다.
 *    1차 안전장치는 감수 콘텐츠 + RAG 고정(자유 생성 억제). 본 필터는 사후 차단막.
 */

export const NON_DEVICE_DISCLAIMER =
  '본 정보는 의료기기가 아니므로 질병의 유무를 판단할 수 없으며, 질병의 유무를 판단하기 위해서는 의사의 검진이 필요합니다.';

export interface GuardrailHit { category: string; match: string }
export interface GuardrailResult {
  blocked: boolean;
  hits: GuardrailHit[];
  /** 면책 문구가 부착된(차단되지 않은 경우) 안전 출력 */
  safeText: string;
}

/** 금칙 패턴 — 진단 확정 / 처방·투약·용량 지시. (정보 제공·권유형은 허용) */
const FORBIDDEN: { category: string; re: RegExp }[] = [
  // 진단 확정("당신은 ○○병입니다" / "○○로 진단됩니다/확진")
  { category: '진단확정', re: /(당신은|귀하(는|께서는)?|환자분(은|께서는)?)[^.\n]{0,40}(병|증|암|염|당뇨|고혈압|고지혈증|이상지질혈증)\s*(입니다|이십니다|이에요|예요|이다)/ },
  { category: '진단확정', re: /(으로|로)\s*(진단(됩니다|되었습니다|이에요|합니다)|확진(됩니다|되었습니다|입니다))/ },
  { category: '진단확정', re: /(확실히|명백히|틀림없이)\s*[^.\n]{0,20}(병|암|당뇨|고혈압)/ },
  // 처방·투약·용량 지시(정보가 아니라 지시)
  { category: '처방지시', re: /(을|를|은|는)?\s*(복용|투여|복약)\s*(하세요|하십시오|하시기 바랍니다|해야 합니다|필요합니다)/ },
  { category: '처방지시', re: /\d+\s*(mg|밀리그램|정|알|캡슐|cc|ml|단위)\s*(을|를)?\s*(복용|투여|드세요|먹|처방)/ },
  { category: '처방지시', re: /(처방(해\s*드립니다|받으세요|합니다)|약을?\s*(드세요|복용하세요|먹으세요))/ },
  // 진료 회피 조장(안전 위배)
  { category: '진료회피', re: /(병원에?\s*(갈|방문할)\s*필요\s*없|진료\s*(안|불)\s*받아도)/ },
];

/** 출력 텍스트 심사 — 금칙 적발 시 blocked, 아니면 면책 부착 */
export function screenOutput(text: string): GuardrailResult {
  const src = text ?? '';
  const hits: GuardrailHit[] = [];
  for (const { category, re } of FORBIDDEN) {
    const m = src.match(re);
    if (m) hits.push({ category, match: m[0].trim().slice(0, 60) });
  }
  const blocked = hits.length > 0;
  return {
    blocked,
    hits,
    safeText: blocked ? '' : appendDisclaimer(src),
  };
}

/** 면책·진료 권유 문구 자동 부착(중복 부착 방지) */
export function appendDisclaimer(text: string): string {
  const src = (text ?? '').trimEnd();
  if (src.includes(NON_DEVICE_DISCLAIMER)) return src;
  return `${src}\n\n${NON_DEVICE_DISCLAIMER}`;
}

/** 콘텐츠 저장 전 정적 검증(감수 제출 게이트에서 사용) — 금칙 포함 여부만 반환 */
export function validateContentText(text?: string | null): GuardrailHit[] {
  if (!text) return [];
  return screenOutput(text).hits;
}
