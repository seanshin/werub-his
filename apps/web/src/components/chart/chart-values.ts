/**
 * 차트 템플릿 입력값 → 진료기록(SOAP) 합성 정본.
 *
 * 🔴 W8-R7 원 결함(2026-08-14 실측)
 *  - E1: 진료 화면이 `chartValues` 를 **어떤 요청에도 싣지 않았다**. 운영 26템플릿 250필드 중
 *        SOAP 슬롯에 매핑된 122만 저장되고, `mappedTo` 없는 **102필드(41%)가 조용히 버려졌다**
 *        (text 33·select 24·number 19·textarea 16·multiselect 3·date 3·photo 2·checkbox 1·vitals 1).
 *  - E2: 같은 슬롯끼리 **대입**이라 서로 덮어썼다. `내과 외래 초진`(실사용 12회)은 혈압·맥박·체온·
 *        호흡수·SpO2·이학적소견 6필드가 전부 `objective` → 마지막 입력만 남았다(19필드 → 최대 4값).
 *
 * 저장 위치 판단 근거:
 *  스키마 수정이 금지돼 있고, Encounter 에는 임의 JSON 을 담을 컬럼이 없다(subjective/objective/
 *  assessment/plan/chiefComplaint/… 은 전부 정형 컬럼, socialHistory·ros·pe 는 용도 고정).
 *  FormSubmission 은 `formSchemaId` 필수 FK 라 ChartTemplate 을 담을 수 없고,
 *  ClinicalChartResult 는 임상도구 78종 전용(chartId 필수)이다.
 *  → **오늘 스키마로 값을 잃지 않는 유일한 목적지는 SOAP 본문**이다. 값은 변형하지 않고
 *    라벨과 함께 원문 그대로 합성한다(사람이 읽는 법정 기록에 남긴다).
 *  → 구조화 보관이 필요하면 `Encounter.chartTemplateId Uuid?` + `Encounter.chartValues JsonB?`
 *    2컬럼이 필요하다(보고서에 제안).
 */

export const SOAP_SLOTS = ['subjective', 'objective', 'assessment', 'plan'] as const;
export type SoapSlot = (typeof SOAP_SLOTS)[number];
export type SoapDraft = Record<SoapSlot, string>;

/** SOAP 매핑이 없는 필드가 모이는 슬롯 — 관찰·기록 자료라 객관적 소견(O)에 블록으로 남긴다. */
export const UNMAPPED_SLOT: SoapSlot = 'objective';

export const SOAP_SLOT_LABEL: Record<SoapSlot, string> = {
  subjective: '주관적 (S)',
  objective: '객관적 소견 (O)',
  assessment: '평가 (A)',
  plan: '계획 (P)',
};

export interface ChartFieldDef {
  id: string;
  type: string;
  label: string;
  mappedTo?: string;
  /** @deprecated 🔴 E3 — 에디터만 쓰고 렌더러/저장은 읽지 않던 두 번째 매핑 키. `mappedTo` 로 수렴. */
  soapMapping?: string;
}

export interface ChartSectionDef {
  id: string;
  title: string;
  fields: ChartFieldDef[];
}

const isSoapSlot = (v: unknown): v is SoapSlot =>
  typeof v === 'string' && (SOAP_SLOTS as readonly string[]).includes(v);

/**
 * 필드가 저장될 SOAP 슬롯. `mappedTo` 가 정본이고, 레거시 `soapMapping` 은 마이그레이션 전
 * 데이터를 읽기 위해서만 폴백으로 본다(쓰기는 서버가 `mappedTo` 로 정규화한다).
 */
export function slotOfField(field: ChartFieldDef): SoapSlot | null {
  if (isSoapSlot(field.mappedTo)) return field.mappedTo;
  if (isSoapSlot(field.soapMapping)) return field.soapMapping;
  return null;
}

const KEY_LABEL: Record<string, string> = {
  hr: 'HR', systolicBp: 'SBP', diastolicBp: 'DBP', spo2: 'SpO2', rr: 'RR', bt: 'BT',
  name: '', dosage: '용량', frequency: '횟수', duration: '기간', route: '경로',
  type: '', priority: '', note: '비고', time: '', action: '',
  gender: '성별', metric: '항목', ageMonths: '개월', measurement: '측정값',
};

/**
 * 값 → 사람이 읽는 문자열. **값 자체는 변형하지 않는다**(반올림·단위 추가·재계산 금지).
 * 빈 값은 빈 문자열을 돌려 호출부가 줄 자체를 생략하게 한다(표본 부재의 정답은 폴백이 아니라 없음).
 */
export function formatChartValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isNaN(value) ? '' : String(value);
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (Array.isArray(value)) return value.map((v) => formatChartValue(v)).filter(Boolean).join(', ');
  if (typeof value !== 'object') return String(value);

  const o = value as Record<string, unknown>;

  // 임상도구(clinical-chart) — 결과 라벨/점수/등급. 원본은 ClinicalChartResult 에 별도 영속된다.
  if (o.result && typeof o.result === 'object') {
    const r = o.result as Record<string, unknown>;
    const num = r.value ?? r.total;
    const parts = [r.label, num != null ? formatChartValue(num) : '', r.level]
      .map((p) => (typeof p === 'string' ? p : p != null ? String(p) : ''))
      .filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }

  // 점수 계산기 — { selections, total }
  if ('selections' in o && 'total' in o) {
    return o.total == null || o.total === '' ? '' : `총점 ${formatChartValue(o.total)}`;
  }

  // 진단 검색 — { code, name }
  if (typeof o.code === 'string' && typeof o.name === 'string' && Object.keys(o).length <= 3) {
    return `${o.code} ${o.name}`.trim();
  }

  // 처방/오더/타임라인 — { items } / { entries }
  const list = (Array.isArray(o.items) ? o.items : Array.isArray(o.entries) ? o.entries : null) as unknown[] | null;
  if (list) return list.map((it) => formatChartValue(it)).filter(Boolean).join(' / ');

  return Object.entries(o)
    .map(([k, v]) => {
      const s = formatChartValue(v);
      if (!s) return '';
      const label = k in KEY_LABEL ? KEY_LABEL[k] : k;
      return label ? `${label} ${s}` : s;
    })
    .filter(Boolean)
    .join(', ');
}

export interface ChartMappingSummary {
  /** 슬롯별로 저장되는 필드(정의 순서) */
  perSlot: Record<SoapSlot, ChartFieldDef[]>;
  /** SOAP 매핑이 없는 필드 — UNMAPPED_SLOT 블록에 라벨과 함께 저장된다 */
  unmapped: ChartFieldDef[];
  /** 두 개 이상이 한 슬롯을 공유하는 슬롯(합쳐서 저장) */
  sharedSlots: SoapSlot[];
  totalFields: number;
}

/** 템플릿이 값을 어디에 저장하는지 — 화면이 사실대로 말하기 위한 요약(P16). */
export function chartMappingSummary(sections: ChartSectionDef[]): ChartMappingSummary {
  const perSlot: Record<SoapSlot, ChartFieldDef[]> = {
    subjective: [], objective: [], assessment: [], plan: [],
  };
  const unmapped: ChartFieldDef[] = [];
  let totalFields = 0;

  for (const section of sections ?? []) {
    for (const field of section?.fields ?? []) {
      totalFields += 1;
      const slot = slotOfField(field);
      if (slot) perSlot[slot].push(field);
      else unmapped.push(field);
    }
  }

  return {
    perSlot,
    unmapped,
    sharedSlots: SOAP_SLOTS.filter((s) => perSlot[s].length > 1),
    totalFields,
  };
}

const joinBlocks = (parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join('\n\n');

export function unmappedBlockHeader(templateName: string): string {
  return `[차트: ${templateName || '템플릿'} · SOAP 미지정]`;
}

/**
 * 차트 값 → 슬롯별 본문. 같은 슬롯에 둘 이상이면 **라벨과 함께 누적**한다(대입 금지 — E2).
 * 한 슬롯에 기여하는 필드가 하나뿐이면 원문 그대로(기존 기록 형태 보존).
 */
export function composeChartNarrative(
  sections: ChartSectionDef[],
  values: Record<string, unknown>,
  templateName: string,
): Partial<Record<SoapSlot, string>> {
  const summary = chartMappingSummary(sections);
  const out: Partial<Record<SoapSlot, string>> = {};

  for (const slot of SOAP_SLOTS) {
    const fields = summary.perSlot[slot];
    const lines: string[] = [];
    for (const f of fields) {
      const text = formatChartValue(values[f.id]);
      if (!text) continue;
      lines.push(fields.length > 1 ? `${f.label}: ${text}` : text);
    }
    if (lines.length) out[slot] = lines.join('\n');
  }

  // 🔴 E1/E4 — 매핑이 없다고 버리지 않는다. 라벨과 함께 블록으로 남긴다.
  const unmappedLines = summary.unmapped
    .map((f) => {
      const text = formatChartValue(values[f.id]);
      return text ? `${f.label}: ${text}` : '';
    })
    .filter(Boolean);

  if (unmappedLines.length) {
    const block = [unmappedBlockHeader(templateName), ...unmappedLines].join('\n');
    out[UNMAPPED_SLOT] = joinBlocks([out[UNMAPPED_SLOT] ?? '', block]);
  }

  return out;
}

/**
 * 합성 결과를 SOAP 초안에 반영한다.
 * 이전 합성분(prevComposed)을 잘라내고 새 합성분을 붙이므로 **의사가 직접 친 문장은 보존**된다.
 * 반환한 composed 를 호출부가 들고 있다가 다음 호출에 다시 넘겨야 한다.
 */
export function applyChartValuesToSoap(
  prevSoap: SoapDraft,
  prevComposed: Partial<Record<SoapSlot, string>>,
  sections: ChartSectionDef[],
  values: Record<string, unknown>,
  templateName: string,
): { soap: SoapDraft; composed: Partial<Record<SoapSlot, string>> } {
  const composed = composeChartNarrative(sections, values, templateName);
  const soap: SoapDraft = { ...prevSoap };

  for (const slot of SOAP_SLOTS) {
    const before = prevComposed[slot] ?? '';
    const after = composed[slot] ?? '';
    if (before === after) continue;
    const current = soap[slot] ?? '';
    const manual = before && current.includes(before) ? current.replace(before, '') : current;
    soap[slot] = joinBlocks([manual, after]);
  }

  return { soap, composed };
}
