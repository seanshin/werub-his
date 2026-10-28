/**
 * 스크라이브 S3 — 임상 개체 추출(NER) · 순수 로직 · 외부 무의존 · 골든 테스트 가능
 *
 * 전사 텍스트 → 구조화 개체(활력·약물·증상[부정 인식]·계획). STT(GPU) 확정 후 SOAP 초안 품질에 반영.
 * 규칙 기반(사전 무의존)이라 오탐 방지를 위해 값 범위·부정어·키워드 앵커를 보수적으로 적용.
 * 계획서 §2-A(스크라이브 S3) · Q12(HIS-side normalization) 정합.
 */
import { normalizeKoreanNumber } from '@hospital-run/shared';

export type VitalType = 'BP' | 'HR' | 'RR' | 'TEMP' | 'SPO2' | 'BST';
export interface ExtractedVital { type: VitalType; value: number[]; unit: string; raw: string }
export interface ExtractedMed { name: string; dose?: number; doseUnit?: string; frequency?: string; duration?: string; raw: string }
export interface ExtractedSymptom { term: string; negated: boolean }
export type PlanKind = 'MEDICATION' | 'LAB' | 'IMAGING' | 'FOLLOWUP' | 'OBSERVE' | 'ORDER';
export interface ExtractedPlan { kind: PlanKind; text: string }
export interface ClinicalEntities { vitals: ExtractedVital[]; medications: ExtractedMed[]; symptoms: ExtractedSymptom[]; plan: ExtractedPlan[] }

// ── 활력징후 ──
interface VitalSpec { type: VitalType; unit: string; re: RegExp; range: [number, number]; pair?: boolean }
const VITALS: VitalSpec[] = [
  { type: 'BP', unit: 'mmHg', re: /(?:혈압|비피|\bbp\b)\D{0,8}(\d{2,3})\s*(?:에|\/|·|,|의|\s)\s*(\d{2,3})/i, range: [40, 260], pair: true },
  { type: 'TEMP', unit: '℃', re: /(?:체온|온도)\D{0,6}(\d{2}(?:\.\d)?)/i, range: [34, 43] },
  { type: 'SPO2', unit: '%', re: /(?:산소\s*포화도|포화도|산소포화|spo2|사투레이션)\D{0,6}(\d{2,3})/i, range: [50, 100] },
  { type: 'HR', unit: 'bpm', re: /(?:맥박|심박수|심박|\bhr\b|펄스)\D{0,6}(\d{2,3})/i, range: [30, 220] },
  { type: 'RR', unit: '회/분', re: /(?:호흡수|호흡|\brr\b)\D{0,6}(\d{1,2})/i, range: [5, 60] },
  { type: 'BST', unit: 'mg/dL', re: /(?:혈당|당수치|\bbst\b|혈당수치)\D{0,6}(\d{2,3})/i, range: [30, 600] },
];

function extractVitals(text: string): ExtractedVital[] {
  const out: ExtractedVital[] = [];
  for (const v of VITALS) {
    const m = v.re.exec(text);
    if (!m) continue;
    if (v.pair) {
      const sys = Number(m[1]); const dia = Number(m[2]);
      if (sys >= v.range[0] && sys <= v.range[1] && dia >= 20 && dia <= 160 && sys > dia)
        out.push({ type: v.type, value: [sys, dia], unit: v.unit, raw: m[0].trim() });
    } else {
      const n = Number(m[1]);
      if (n >= v.range[0] && n <= v.range[1]) out.push({ type: v.type, value: [n], unit: v.unit, raw: m[0].trim() });
    }
  }
  return out;
}

// ── 약물 (용량·빈도·기간 앵커) ──
const FREQ = /(하루\s*(?:한|두|세|네|[1-4])\s*번|1일\s*[1-4]\s*회|[1-4]\s*회|식후|식전|취침\s*전|아침|점심|저녁|필요\s*시)/;
const DURATION = /(\d+\s*(?:일|주|개월|달)(?:분|치)?)/;
function extractMeds(text: string): ExtractedMed[] {
  const out: ExtractedMed[] = [];
  // 용량 토큰 앵커: (이름) (수치)(mg|밀리그램|정|캡슐|밀리)
  const re = /([가-힣A-Za-z][가-힣A-Za-z0-9·]{1,20}?)\s*(\d+(?:\.\d+)?)\s*(mg|밀리그램|밀리|㎎|정|캡슐|㎍|mcg|iu|유닛|㏄|cc|ml|밀리리터)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/(을|를|은|는|이|가|,)$/,'').trim();
    if (!name || /^(혈압|체온|맥박|호흡|산소|혈당|나이|체중|키)$/.test(name)) continue; // 활력/신체계측 오탐 배제
    const tail = text.slice(m.index, m.index + 60);
    const freq = FREQ.exec(tail)?.[1]?.replace(/\s+/g, ' ').trim();
    const dur = DURATION.exec(tail)?.[1]?.replace(/\s+/g, '').trim();
    out.push({ name, dose: Number(m[2]), doseUnit: m[3].toLowerCase(), frequency: freq, duration: dur, raw: m[0].trim() });
  }
  return out;
}

// ── 증상 (부정 인식) ──
const SYMPTOMS = [
  '두통', '어지럼', '어지러움', '발열', '고열', '오한', '기침', '가래', '콧물', '인후통', '목통증', '복통', '설사', '변비',
  '구토', '메스꺼움', '오심', '흉통', '가슴통증', '호흡곤란', '숨참', '부종', '발진', '가려움', '소양감', '관절통', '근육통',
  '피로', '무기력', '식욕부진', '체중감소', '불면', '떨림', '저림', '마비', '시야흐림', '이명', '빈뇨', '배뇨통',
];
/**
 * 구어체 증상 표현 → 정본 용어. 환자는 '흉통'이 아니라 '가슴이 아파요'라고 말한다(앰비언트 대화 전제).
 * 공백 제거된 절(clause)에 대해 부분일치로 검사하므로 패턴도 공백 없이 적는다.
 */
const SYMPTOM_SYNONYMS: [RegExp, string][] = [
  [/열이나|열난|열나|미열|고열/, '발열'],
  [/가슴이아프|가슴이따|가슴통증|흉부통증|가슴이답답/, '흉통'],
  [/배가아프|배아프|복부통증|속이쓰리/, '복통'],
  [/머리가아프|머리아프|머리가지끈|머리가무겁/, '두통'],
  [/목이아프|목아프|목이따|목이칼칼/, '인후통'],
  [/어지럽|어지러|현기증/, '어지럼'],
  [/토했|토할것같|구역질/, '구토'],
  [/메슥|미식거|속이안좋/, '메스꺼움'],
  [/숨이차|숨쉬기힘들|숨이가쁘|숨이막히/, '호흡곤란'],
  [/잠을못|잠이안오|잠이안와|잠들기힘들/, '불면'],
  [/기운이없|힘이없|기력이없/, '무기력'],
  [/입맛이없|밥맛이없/, '식욕부진'],
];
/**
 * 사전 용어 중 동의어 표가 이미 다른 정본 용어로 보내는 것 — 같은 증상이 두 이름으로 나오지 않게 한다.
 * 🔴 2026-09-27 실제 대화 골든에서 드러난 상류 결함: '가슴 통증은 없어요' 가 `흉통`(동의어)과 `가슴통증`(사전)
 *    두 항목으로 나와 S 에 "흉통, 가슴통증 부인." 이 찍혔다. '고열'→발열·'어지러움'→어지럼 도 같은 구조.
 */
const SYMPTOM_CANONICAL: Record<string, string> = { '가슴통증': '흉통', '고열': '발열', '어지러움': '어지럼' };
const NEG = /(없|않|아니|안\s?(?:나|아프|있)|괜찮|호전|사라|가라앉|정상|부인|아뇨|아니요)/;
/** 절(clause) 분할 — 연결어미/구두점 경계. 부정 스코프가 다음 절로 새지 않게. */
function splitClauses(text: string): string[] {
  return text
    .split(/(?<=고)\s|(?<=며)\s|(?<=는데)\s|(?<=지만)\s|(?<=요)\s|(?<=다)\s|[,.。!?\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function extractSymptoms(text: string): ExtractedSymptom[] {
  const clauses = splitClauses(text);
  const seen = new Map<string, boolean>();
  for (const clause of clauses) {
    const negated = NEG.test(clause);
    // 공백 무관 매칭 — 구어는 '가슴 통증'처럼 띄어 쓰지만 사전은 '가슴통증'
    const flat = clause.replace(/\s+/g, '');
    const hit = (raw: string) => {
      const term = SYMPTOM_CANONICAL[raw] ?? raw;
      // 같은 증상 여러 번이면 긍정 우선(하나라도 긍정이면 있음)
      if (!seen.has(term) || (seen.get(term) && !negated)) seen.set(term, negated);
    };
    for (const s of SYMPTOMS) {
      if (flat.includes(s.replace(/\s+/g, ''))) hit(s);
    }
    for (const [re, canonical] of SYMPTOM_SYNONYMS) {
      if (re.test(flat)) hit(canonical);
    }
  }
  return [...seen.entries()].map(([term, negated]) => ({ term, negated }));
}

// ── 계획/오더 ──
const PLAN_CUES: Array<{ kind: PlanKind; re: RegExp }> = [
  { kind: 'IMAGING', re: /(엑스레이|x-?ray|씨티|\bct\b|엠아르아이|\bmri\b|초음파|소노|촬영|사진\s*찍)/i },
  { kind: 'LAB', re: /(검사|피검사|혈액검사|소변검사|채혈|랩)/ },
  { kind: 'MEDICATION', re: /(처방|약\s*(?:드릴|줄|처방)|복용)/ },
  { kind: 'FOLLOWUP', re: /(재방문|다시\s*오|외래\s*예약|다음\s*(?:주|번|에)|추적\s*관찰|f\/?u)/i },
  { kind: 'OBSERVE', re: /(경과\s*관찰|지켜보|관찰\s*후|경과\s*보)/ },
  { kind: 'ORDER', re: /(오더\s*(?:내|낼|넣)|오더하)/ },
];
function extractPlan(text: string): ExtractedPlan[] {
  const out: ExtractedPlan[] = [];
  const sentences = text.split(/(?<=[.。!?])|\n|,\s*/).map((s) => s.trim()).filter(Boolean);
  for (const sent of sentences) {
    for (const c of PLAN_CUES) {
      if (c.re.test(sent)) { out.push({ kind: c.kind, text: sent }); break; }
    }
  }
  return out;
}

export const VITAL_LABEL: Record<VitalType, string> = { BP: 'BP', HR: 'HR', RR: 'RR', TEMP: 'BT', SPO2: 'SpO2', BST: 'BST' };
/** 활력 값 표기 — BP 는 수축/이완 슬래시, 나머지는 단일값. `consolidate()` 의 이전값 괄호 표기가 같은 표기를 쓴다. */
export function vitalValueText(type: VitalType, value: number[]): string {
  return type === 'BP' ? `${value[0]}/${value[1]}` : String(value[0]);
}
export function vitalText(v: ExtractedVital): string {
  return `${VITAL_LABEL[v.type]} ${vitalValueText(v.type, v.value)}${v.unit}`;
}
export function medText(m: ExtractedMed): string {
  return [m.name, m.dose ? `${m.dose}${m.doseUnit ?? ''}` : '', m.frequency ?? '', m.duration ?? ''].filter(Boolean).join(' ');
}

/**
 * 구조화 개체 → SOAP 초안 텍스트(규칙 기반·AI 미가용 시 저하 경로).
 * S=증상(긍정/부인)·O=활력·P=계획+약물. A(평가)는 임상 판단이라 비움(의사 작성).
 */
export function entitiesToSoap(e: ClinicalEntities): { subjective?: string; objective?: string; plan?: string } {
  const pos = e.symptoms.filter((s) => !s.negated).map((s) => s.term);
  const neg = e.symptoms.filter((s) => s.negated).map((s) => s.term);
  const sParts: string[] = [];
  if (pos.length) sParts.push(`${pos.join(', ')} 호소.`);
  if (neg.length) sParts.push(`${neg.join(', ')} 부인.`);
  const objective = e.vitals.length ? e.vitals.map(vitalText).join(', ') : undefined;
  const planParts = [...e.plan.map((p) => p.text), ...e.medications.map(medText)];
  return {
    subjective: sParts.length ? sParts.join(' ') : undefined,
    objective,
    plan: planParts.length ? planParts.join('\n') : undefined,
  };
}

/** 전사 텍스트 → 구조화 임상 개체. 순수·결정적. */
export function extractClinicalEntities(rawText: string): ClinicalEntities {
  const text = normalizeKoreanNumber(rawText || '');
  return {
    vitals: extractVitals(text),
    medications: extractMeds(text),
    symptoms: extractSymptoms(rawText || ''), // 증상은 원문(수사 정규화 불필요)
    plan: extractPlan(rawText || ''),
  };
}
