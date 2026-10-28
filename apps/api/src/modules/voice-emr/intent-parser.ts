/**
 * VoiceEMR — Intent 파서 (프로토타입·순수 로직·미배선·DB 불필요)
 *
 * final 전사 텍스트 → {intent, slots}. DRUG/LAB/BODYPART 는 마스터 대조 전 단계라
 * 후보 term 만 추출(실제 n-best 코드매핑은 DB 계층·별도). 자동 실행 없음 — 확인 게이트 전제.
 * 설계: docs/02-design/voice-emr-pipeline-design.md §2 · 골든: test/voice-emr/intent-parser.spec.ts
 */
import { normalizeNumeric } from './korean-number';

export type IntentResult =
  | { intent: 'SYSTEM'; action: 'cancel' | 'confirm' | 'sign' | 'stop' }
  | { intent: 'HOLD'; reason: 'low_confidence' }
  | { intent: 'ALIAS'; pattern: string; action: unknown }
  | { intent: 'READ'; target: string; term?: string }
  | { intent: 'VITAL'; metric: string; values: number[] }
  | { intent: 'ORDER'; sub: 'LAB'; labs: string[]; needsConfirm: true }
  | { intent: 'ORDER'; sub: 'IMAGING'; modality: string; bodyPart?: string; needsConfirm: true }
  | { intent: 'ORDER'; sub: 'RX'; drug: string; dose?: number; unit?: string; freq?: string; route?: string; needsConfirm: true }
  | { intent: 'DICTATE'; text: string };

export interface CustomPhrases {
  aliases?: { pattern: string; action: unknown }[];
  habits?: { from: string; to: string }[];
}
export interface ParseOpts { confidence?: number; customPhrases?: CustomPhrases }

const RESERVED: [RegExp, IntentResult][] = [
  [/^(취소|그만|중단)$/, { intent: 'SYSTEM', action: 'cancel' }],
  [/^(확정|맞아|맞습니다)$/, { intent: 'SYSTEM', action: 'confirm' }],
  [/^서명$/, { intent: 'SYSTEM', action: 'sign' }],
];
export const RESERVED_WORDS = ['취소', '그만', '중단', '확정', '서명'];

const METRICS: Record<string, { code: string; n: number }> = {
  혈압: { code: 'BP', n: 2 }, 체온: { code: 'TEMP', n: 1 }, 맥박: { code: 'HR', n: 1 },
  호흡: { code: 'RR', n: 1 }, 산소포화도: { code: 'SPO2', n: 1 }, 체중: { code: 'WEIGHT', n: 1 },
  신장: { code: 'HEIGHT', n: 1 }, 공복혈당: { code: 'FBS', n: 1 }, 혈당: { code: 'FBS', n: 1 },
};
const MODALITY: Record<string, string> = { 엑스레이: 'XR', 'x-ray': 'XR', 시티: 'CT', ct: 'CT', 초음파: 'US', 엠알아이: 'MRI', mri: 'MRI' };
const FREQ: [RegExp, string][] = [
  [/하루\s*두\s*번|하루\s*2\s*번|1일\s*2회/, 'bid'], [/하루\s*세\s*번|하루\s*3\s*번|1일\s*3회/, 'tid'],
  [/하루\s*한\s*번|하루\s*1\s*번|1일\s*1회/, 'qd'], [/취침\s*전/, 'hs'], [/아침/, 'qAM'],
  [/식후/, 'pc'], [/식전/, 'ac'], [/필요\s*시|피\s*알\s*엔/, 'prn'],
];
const ORDER_VERB = /(오더|처방|낼게|추가|나가|나가고|줘|투여)/;
const QUESTION = /(까요|나요|을까|ㄹ까|습니까)\s*$/; // 의문=명령 아님

const FILLER = /(^|\s)(어|음|그|저기)(?=\s)/g;

function extractNumbers(s: string): number[] {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** final 텍스트 1건 파싱 → 결과 배열(복합=다건·단건=1건) */
export function parseIntent(raw: string, opts: ParseOpts = {}): IntentResult[] {
  if (opts.confidence !== undefined && opts.confidence < 0.5) return [{ intent: 'HOLD', reason: 'low_confidence' }];

  let text = raw.trim();
  // 예약어(정규화 전·정확 일치)
  for (const [re, res] of RESERVED) if (re.test(text)) return [res];

  // HABIT 개인 보정(텍스트 치환)
  for (const h of opts.customPhrases?.habits ?? []) text = text.split(h.from).join(h.to);
  // 필러 제거
  text = text.replace(FILLER, '$1').replace(/\s+/g, ' ').trim();
  // 수사·단위 정규화
  text = normalizeNumeric(text);

  // ALIAS(개인·우선) — 정규화 후 부분 일치
  for (const a of opts.customPhrases?.aliases ?? []) {
    if (text.includes(a.pattern)) return [{ intent: 'ALIAS', pattern: a.pattern, action: a.action }];
  }

  // 복합: VITAL 지표가 2개 이상이면 " 하고/그리고 "로 분절
  const metricHits = Object.keys(METRICS).filter((m) => text.includes(m));
  if (metricHits.length >= 2 && /\s(하고|그리고|및)\s/.test(text)) {
    return text.split(/\s(?:하고|그리고|및)\s/).flatMap((seg) => parseIntent(seg, {}));
  }

  // VITAL
  for (const m of Object.keys(METRICS)) {
    if (text.startsWith(m) || text.includes(m + ' ') || text.includes(m)) {
      if (!/[\d]/.test(text)) continue;
      const { code, n } = METRICS[m];
      // 자기정정: 말고/아니 뒤 값 우선
      const after = /(말고|아니|정정하고|정정)/.test(text) ? text.split(/(?:말고|아니|정정하고|정정)/).pop()! : text;
      const nums = extractNumbers(after).slice(0, n);
      if (nums.length >= 1) return [{ intent: 'VITAL', metric: code, values: nums }];
    }
  }

  // READ (ORDER 보다 먼저 — "보여줘"의 "줘"가 ORDER_VERB 와 겹침)
  const readVerb = /(보여줘|조회|열어|알려줘)/;
  if (readVerb.test(text)) {
    const targetMap: [RegExp, string][] = [
      [/검사\s*결과|검사/, 'lab'], [/약|약물|복용/, 'medication'], [/활력|바이탈/, 'vitals'],
      [/영상|엑스레이|판독/, 'imaging'], [/진단|상병/, 'diagnosis'],
    ];
    const term = (text.match(/(당화혈색소|크레아티닌|사구체여과율|간기능|갑상선|혈압|혈당)/) ?? [])[1];
    for (const [re, target] of targetMap) {
      if (re.test(text)) return [{ intent: 'READ', target, term }];
    }
    // 명시 target 없으나 알려진 검사 용어 → lab 조회
    if (term) return [{ intent: 'READ', target: 'lab', term }];
    return [{ intent: 'READ', target: 'unknown' }];
  }

  // 의문이면 명령 아님 → 구술 폴백
  if (QUESTION.test(text)) return [{ intent: 'DICTATE', text }];

  // 복합 처방 — " 하고/그리고 "로 나뉜 다중 약+용량(mg 2개+) 은 건별 개별 파싱(§2.6·오더 일괄 확정 금지)
  if (/\s(하고|그리고)\s/.test(text) && (text.match(/\d+(?:\.\d+)?\s*(?:mg|mcg|정|알)/g) ?? []).length >= 2) {
    return text.split(/\s(?:하고|그리고)\s/).flatMap((seg) => parseIntent(seg, {}));
  }

  // ORDER/RX — 약명+용량 패턴은 명령 동사 없어도 트리거(PTT=발화 자체가 명령)
  const rx = text.match(/([가-힣A-Za-z]+)\s*(\d+(?:\.\d+)?)\s*(mg|mcg|g|cc|정|알)?/);
  if (rx && /(mg|mcg|정|알|IV|IM|SC|주사|처방|줘|투여|취침|아침|식후|식전|하루|prn)/.test(text)) {
    const freq = FREQ.find(([re]) => re.test(text))?.[1];
    const route = /IV/.test(text) ? 'IV' : /IM/.test(text) ? 'IM' : /SC/.test(text) ? 'SC' : undefined;
    return [{ intent: 'ORDER', sub: 'RX', drug: rx[1], dose: Number(rx[2]), unit: rx[3] ?? undefined, freq, route, needsConfirm: true }];
  }
  // 용량 없는 약 처방("메트포르민 처방")
  const rxNoDose = text.match(/^([가-힣A-Za-z]+)\s*(처방|줘|투여)/);
  if (rxNoDose) return [{ intent: 'ORDER', sub: 'RX', drug: rxNoDose[1], needsConfirm: true }];

  // ORDER/IMAGING — 모달리티 + 명령 동사
  const mod = Object.keys(MODALITY).find((k) => text.toLowerCase().includes(k));
  if (mod && ORDER_VERB.test(text)) {
    const bodyPart = (text.match(/(흉부|복부|상복부|하복부|두부|경부|골반|척추|사지|전신)/) ?? [])[1];
    return [{ intent: 'ORDER', sub: 'IMAGING', modality: MODALITY[mod], bodyPart, needsConfirm: true }];
  }

  // ORDER/LAB — 명령 동사 + 검사 용어 나열
  if (ORDER_VERB.test(text)) {
    const labZone = text.replace(new RegExp(ORDER_VERB, 'g'), ' ').replace(/하고|,/g, ' ');
    // ⚠ 부분매칭 금지: '소변검사'가 '검사' 포함으로 탈락하지 않게 **정확 토큰**만 제외
    const labs = labZone.split(/\s+/).filter((w) => w.length >= 2 && !/^\d/.test(w) && !/^(검사|추가|나가|나가고|오더|처방|줘|투여)$/.test(w));
    if (labs.length >= 1) return [{ intent: 'ORDER', sub: 'LAB', labs, needsConfirm: true }];
  }

  // 폴백: 자유 구술
  return [{ intent: 'DICTATE', text }];
}
