/**
 * 시계열 이슈 추출 — 순수 로직.
 *
 * "무엇이 중요한 수치인가"와 "왜 이슈인가"를 함께 낸다. 원칙:
 *  - **판정 근거를 항상 문장으로 남긴다**(값만 빨갛게 칠하고 이유를 안 쓰면 판단에 도움이 안 됨).
 *  - 위급(CRITICAL)은 임상 통용 역치 표에 한정하고, 나머지 참고범위 이탈은 주의(WARN)로 둔다.
 *  - 추세는 같은 항목의 직전 값과만 비교한다(장기 회귀·예측은 하지 않음).
 *  - 없는 정보를 만들지 않는다(참고범위·직전값이 없으면 그 판정을 건너뛴다).
 */

export type IssueLevel = 'CRITICAL' | 'WARN' | 'INFO';

export interface Issue {
  level: IssueLevel;
  at: string;                 // ISO
  category: '검사' | '활력' | '추세' | '미확인';
  label: string;              // 무엇 (예: 'WBC', 'BP')
  value?: string;             // 값 (예: '13200 /μL')
  why: string;                // 왜 이슈인가(판정 근거)
  source?: { type: string; id: string }; // 원본 열람용
}

export interface IssueInput {
  type: string;
  at: string | Date;
  id: string;
  results?: { name: string; value: string; unit?: string; flag?: string | null; refLow?: number | null; refHigh?: number | null }[];
  vitals?: { bp?: string | null; hr?: number | null; temp?: number | null; spo2?: number | null; rr?: number | null; pain?: number | null };
}

/**
 * 위급 역치(임상 통용) — 이 표에 있는 항목만 CRITICAL 로 올린다.
 * [저역치, 고역치] · null = 해당 방향 위급 없음. 표기는 검사명 대문자 비교.
 */
export const CRITICAL_LAB: Record<string, { low: number | null; high: number | null; unit: string; why: string }> = {
  K:        { low: 2.5,  high: 6.5,   unit: 'mmol/L', why: '치명적 부정맥 위험' },
  NA:       { low: 120,  high: 160,   unit: 'mmol/L', why: '의식저하·경련 위험' },
  GLUCOSE:  { low: 50,   high: 400,   unit: 'mg/dL',  why: '저혈당 뇌손상 / 고혈당 위기(DKA·HHS) 위험' },
  HB:       { low: 7,    high: null,  unit: 'g/dL',   why: '수혈 고려 수준의 빈혈' },
  PLATELET: { low: 50,   high: null,  unit: '10^3/μL', why: '출혈 위험' },
  WBC:      { low: 1000, high: 30000, unit: '/μL',    why: '중증 감염·호중구감소 위험' },
  CREATININE: { low: null, high: 4,   unit: 'mg/dL',  why: '급성 신손상 의심' },
  CRP:      { low: null, high: 20,    unit: 'mg/dL',  why: '중증 염증·감염 시사' },
};

/**
 * 활력 위급/주의 역치 — 🔴 수치 선언은 vitals-evaluate 정본 하나(P0-a③ 통합).
 * 여기는 표현(라벨·사유 문구)만 소유한다. 종전엔 같은 값이 이중 선언돼 한쪽 수정 시 조용히 어긋났다.
 */
import { VITALS_THRESHOLDS, type VitalsThresholds } from '../vitals/vitals-evaluate';
import { isHighFlag, isLowFlag, isCriticalFlag } from '@hospital-run/shared';

type VitalRule = { key: 'sbp' | 'dbp' | 'hr' | 'temp' | 'spo2' | 'rr'; label: string; critLow?: number; critHigh?: number; warnLow?: number; warnHigh?: number; unit: string; whyHigh?: string; whyLow?: string };

function buildVitalRules(T: VitalsThresholds): VitalRule[] {
  const n = (v: number | null) => v ?? undefined;
  return [
    { key: 'sbp', label: '수축기혈압', critHigh: n(T.systolicBp.high), critLow: n(T.systolicBp.low), warnHigh: n(T.systolicBp.warnHigh), warnLow: n(T.systolicBp.warnLow), unit: T.systolicBp.unit, whyHigh: '고혈압 위기 범위 — 장기 손상 위험', whyLow: '쇼크·관류 저하 의심' },
    { key: 'dbp', label: '이완기혈압', critHigh: n(T.diastolicBp.high), critLow: n(T.diastolicBp.low), warnHigh: n(T.diastolicBp.warnHigh), warnLow: n(T.diastolicBp.warnLow), unit: T.diastolicBp.unit, whyHigh: '고혈압 위기 범위', whyLow: '관류압 저하' },
    { key: 'spo2', label: 'SpO2', critLow: n(T.spo2.low), warnLow: n(T.spo2.warnLow), unit: T.spo2.unit, whyLow: '저산소증 — 산소 공급·원인 평가 필요' },
    { key: 'temp', label: '체온', critHigh: n(T.temperature.high), critLow: n(T.temperature.low), warnHigh: n(T.temperature.warnHigh), warnLow: n(T.temperature.warnLow), unit: T.temperature.unit, whyHigh: '발열 — 감염 평가 필요', whyLow: '저체온' },
    { key: 'hr', label: '맥박', critHigh: n(T.heartRate.high), critLow: n(T.heartRate.low), warnHigh: n(T.heartRate.warnHigh), warnLow: n(T.heartRate.warnLow), unit: T.heartRate.unit, whyHigh: '빈맥 — 발열·탈수·부정맥 감별', whyLow: '서맥' },
    { key: 'rr', label: '호흡수', critHigh: n(T.respiratoryRate.high), critLow: n(T.respiratoryRate.low), warnHigh: n(T.respiratoryRate.warnHigh), warnLow: n(T.respiratoryRate.warnLow), unit: T.respiratoryRate.unit, whyHigh: '호흡부전 조기징후(NEWS2 가중)', whyLow: '호흡 저하' },
  ];
}

/** 기본 룰(코드 기본값 기준) — extractIssues 에 thresholds 를 주면 그 값으로 재구성 */
const VITAL_RULES: VitalRule[] = buildVitalRules(VITALS_THRESHOLDS);

const iso = (v: string | Date) => (typeof v === 'string' ? v : v.toISOString());
const num = (v: string) => {
  // 🔴 문자 결과("No growth"·"음성")가 0 으로 파싱되면 저역치 위급 오경보가 난다 → 숫자 형태만 허용.
  //    부등호 표기(<0.5·>400)는 임상 관행상 경계값으로 읽는다.
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** 검사·활력 항목에서 이슈를 뽑는다(최신순 정렬 반환) */
export function extractIssues(items: IssueInput[], thresholds?: VitalsThresholds): Issue[] {
  const vitalRules = thresholds ? buildVitalRules(thresholds) : VITAL_RULES;
  const out: Issue[] = [];
  const sorted = items.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // 검사 — 위급 역치 → 참고범위 이탈 → 추세(직전 대비 악화)
  const history = new Map<string, { at: string; v: number }[]>();
  for (const it of sorted) {
    if (it.type !== 'LAB') continue;
    for (const r of it.results ?? []) {
      const v = num(r.value);
      if (v === null) continue;
      const key = norm(r.name);
      const crit = CRITICAL_LAB[key];
      const unit = r.unit ?? crit?.unit ?? '';

      if (crit && ((crit.low !== null && v <= crit.low) || (crit.high !== null && v >= crit.high))) {
        const dir = crit.low !== null && v <= crit.low ? '이하' : '이상';
        const bound = crit.low !== null && v <= crit.low ? crit.low : crit.high;
        out.push({
          level: 'CRITICAL', at: iso(it.at), category: '검사', label: r.name, value: `${r.value} ${unit}`.trim(),
          why: `위급 기준(${bound} ${dir}) 도달 — ${crit.why}. 즉시 확인이 필요합니다.`,
          source: { type: 'LAB', id: it.id },
        });
      } else if (r.flag && r.flag !== 'N') {
        const range = r.refLow !== null && r.refLow !== undefined || r.refHigh !== null && r.refHigh !== undefined
          ? `참고범위 ${r.refLow ?? ''}~${r.refHigh ?? ''}`
          : '참고범위 미등록';
        out.push({
          level: 'WARN', at: iso(it.at), category: '검사', label: r.name, value: `${r.value} ${unit}`.trim(),
          why: `${range} ${isHighFlag(r.flag) ? (isCriticalFlag(r.flag) ? '위급 상회' : '상회') : isLowFlag(r.flag) ? (isCriticalFlag(r.flag) ? '위급 하회' : '하회') : `이탈(${r.flag})`} — 임상 맥락과 함께 해석하세요.`,
          source: { type: 'LAB', id: it.id },
        });
      }

      const h = history.get(key) ?? [];
      const prev = h[h.length - 1];
      // 추세 — 참고 상한/하한을 벗어나는 방향으로 직전보다 나빠졌을 때만
      if (prev && (r.refHigh !== null && r.refHigh !== undefined || r.refLow !== null && r.refLow !== undefined)) {
        const worseUp = r.refHigh !== null && r.refHigh !== undefined && v > prev.v && v > r.refHigh;
        const worseDown = r.refLow !== null && r.refLow !== undefined && v < prev.v && v < r.refLow;
        if (worseUp || worseDown) {
          const delta = Math.round((v - prev.v) * 100) / 100;
          out.push({
            level: 'WARN', at: iso(it.at), category: '추세', label: r.name,
            value: `${prev.v} → ${r.value}`,
            why: `직전(${prev.at.slice(0, 10)}) 대비 ${delta > 0 ? '+' : ''}${delta}${unit ? ` ${unit}` : ''} ${worseUp ? '상승' : '하락'}으로 참고범위를 더 벗어났습니다.`,
            source: { type: 'LAB', id: it.id },
          });
        }
      }
      h.push({ at: iso(it.at), v });
      history.set(key, h);
    }
  }

  // 활력 — 위급/주의
  for (const it of sorted) {
    if (it.type !== 'VITALS' || !it.vitals) continue;
    const v = it.vitals;
    const [sbpRaw, dbpRaw] = (v.bp ?? '').split('/');
    const vals: Record<string, number | null> = {
      sbp: sbpRaw ? num(sbpRaw) : null, dbp: dbpRaw ? num(dbpRaw) : null,
      hr: v.hr ?? null, temp: v.temp ?? null, spo2: v.spo2 ?? null, rr: v.rr ?? null,
    };
    for (const rule of vitalRules) {
      const x = vals[rule.key];
      if (x === null || x === undefined) continue;
      const critHi = rule.critHigh !== undefined && x >= rule.critHigh;
      const critLo = rule.critLow !== undefined && x <= rule.critLow;
      const warnHi = !critHi && rule.warnHigh !== undefined && x >= rule.warnHigh;
      const warnLo = !critLo && rule.warnLow !== undefined && x <= rule.warnLow;
      if (!critHi && !critLo && !warnHi && !warnLo) continue;
      const high = critHi || warnHi;
      out.push({
        level: critHi || critLo ? 'CRITICAL' : 'WARN',
        at: iso(it.at), category: '활력', label: rule.label, value: `${x} ${rule.unit}`,
        why: `${high ? `${critHi ? rule.critHigh : rule.warnHigh} 이상` : `${critLo ? rule.critLow : rule.warnLow} 이하`} — ${(high ? rule.whyHigh : rule.whyLow) ?? '기준 이탈'}.`,
        source: { type: 'VITALS', id: it.id },
      });
    }
  }

  // 최신순 + 레벨 우선(위급 먼저)
  const rank: Record<IssueLevel, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** 같은 항목이 반복되면 최신 1건만(목록 폭주 방지). 위급은 전부 유지. */
export function dedupeIssues(issues: Issue[], keepPerLabel = 1): Issue[] {
  const seen = new Map<string, number>();
  const out: Issue[] = [];
  for (const i of issues) {
    if (i.level === 'CRITICAL') { out.push(i); continue; }
    const key = `${i.category}|${i.label}`;
    const n = seen.get(key) ?? 0;
    if (n < keepPerLabel) { out.push(i); seen.set(key, n + 1); }
  }
  return out;
}
