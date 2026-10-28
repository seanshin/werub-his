/**
 * 🔴 활력 표시 정본 구조 가드(2026-10-07).
 *
 * 실측(전환 전 ~34 표시 자리): 공용 부품 0 · 이상 판정 정본 10곳뿐 · 단위 표기 ℃/°C/° 셋 · 혈압을 `${s}/${d}` 로 손조립해
 * `120/undefined`·`null/null` · truthy 검사가 측정된 0 을 숨김 · `formatTemp(..)` 뒤에 단위를 또 붙여 "36.5℃℃"(환자 포털 포함 4곳).
 * 정본 = shared `vital-signs.ts`(순서·LOINC·UCUM·단위) + 부품 `components/vitals/VitalSigns.tsx`.
 *
 * ① formatTemp 뒤 단위 중복 = 0(여유 없음)
 * ② 전환한 화면은 부품을 계속 쓴다(되돌리면 실패)
 * ③ 손조립 혈압·값 뒤 단위 리터럴·°C 표기 — 파일별 정확 동결(늘면 실패 · 줄면 기준선을 내린다)
 *    남은 것: 입력 폼 라벨·보관 온도(°C)·PACU 화면(별도 밀착감시 기준)·환자용 화면
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '../../src');
function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const FILES = walk(SRC).map((p) => ({ rel: relative(SRC, p), src: readFileSync(p, 'utf8') }))
  .filter((f) => !f.rel.startsWith('components/vitals/'));

const PATTERNS = {
  dupUnit: /formatTemp\([^)]*\)\s*\}?\s*(℃|°C|°)/g,
  degC: /°C/g,
  handBP: /(systolicBp|sbp|systolic)\w*\s*\}?\s*\/\s*\$?\{?[^}\n]{0,40}(diastolicBp|dbp|diastolic)/g,
  unitAfterVital: /(heartRate|\bhr\b|spo2|spO2|temperature|\btemp\b|respiratoryRate|\brr\b)[^{}\n]{0,30}\}\s*(bpm|℃|°C|\/min|회\/분|%)/g,
} as const;
type K = keyof typeof PATTERNS;

function scan(k: K): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of FILES) {
    const n = (strip(f.src).match(PATTERNS[k]) ?? []).length;
    if (n) out[f.rel] = n;
  }
  return out;
}

const BASELINE: Record<Exclude<K, 'dupUnit'>, Record<string, number>> = {
  degC: {
    'app/(homepage)/booking/page.tsx': 1,
    'app/(main)/workstation/emergency/page.tsx': 1,
    'app/(main)/workstation/nursing/page.tsx': 1,
    'app/(main)/workstation/therapy/page.tsx': 1,
    'app/(main)/patients/[id]/encounter/new/components/InternalMedicineEncounterLayout.tsx': 1,
    'app/(main)/patients/[id]/encounter/new/components/ObGynEncounterLayout.tsx': 2,
    'app/(main)/inpatient/[admissionId]/page.tsx': 3,
    'app/(main)/nurse-station/page.tsx': 1,
    'app/(main)/telehealth/[sessionId]/_components/NurseChart.tsx': 1,
    'app/(main)/pharmacy/admin/page.tsx': 2,
    'app/(main)/lab/components/CellTherapyTab.tsx': 2,
    'app/(main)/inventory/components/StoragesTab.tsx': 1,
    'app/(main)/pacu/page.tsx': 1,
  },
  handBP: {
    'app/portal/_health/HealthTab.tsx': 1,
    'app/(homepage)/booking/page.tsx': 1,
    'app/(main)/inpatient/[admissionId]/page.tsx': 1,
    'app/(main)/pacu/page.tsx': 1,
  },
  unitAfterVital: {
    'app/(main)/lab/components/CellTherapyTab.tsx': 1,
    'app/(main)/pacu/page.tsx': 3,
  },
};

/** 전환한 화면 — 부품 import 가 사라지면(손그림으로 되돌리면) 실패 */
const MIGRATED = [
  'app/(main)/concierge/page.tsx', 'app/(main)/emergency/page.tsx', 'app/(main)/handoffs/page.tsx', 'app/(main)/icu/page.tsx',
  'app/(main)/inpatient/[admissionId]/nursing/flowsheet/page.tsx', 'app/(main)/inpatient/[admissionId]/nursing/timeline/page.tsx',
  'app/(main)/inpatient/[admissionId]/page.tsx', 'app/(main)/nurse-station/page.tsx', 'app/(main)/pacu/page.tsx',
  'app/(main)/patients/[id]/components/NurseSideRail.tsx', 'app/(main)/patients/[id]/components/OverviewTab.tsx',
  'app/(main)/patients/[id]/components/VitalsTab.tsx', 'app/(main)/patients/[id]/encounter/new/page.tsx', 'app/(main)/rounds/page.tsx',
  'app/(main)/surgery/components/SurgeryAdvanced.tsx', 'app/(main)/surgery/components/SurgeryLiveBoard.tsx',
  'app/(main)/telehealth/[sessionId]/_components/NurseChart.tsx', 'app/(main)/telehealth/[sessionId]/_components/PatientInfoPanel.tsx',
  'app/(main)/workstation/emergency/page.tsx', 'app/(main)/workstation/icu/page.tsx', 'app/(main)/workstation/nursing/page.tsx',
  'app/(main)/workstation/post-op/page.tsx', 'app/tablet/_components/TabletSummary.tsx', 'components/nursing/NursingNotePanel.tsx',
  'components/record-timeline/record-card.tsx', 'app/(main)/admin/vitals-standard/page.tsx',
];

describe('🔴 활력 표시 정본 구조 가드', () => {
  it('대조군 — 스캐너가 실제로 잡는다(옛 형태 문자열)', () => {
    expect('{formatTemp(v.temperature)}°C'.match(PATTERNS.dupUnit)).toBeTruthy();
    expect('{v.systolicBp}/{v.diastolicBp}'.match(PATTERNS.handBP)).toBeTruthy();
    expect('`${e.systolicBp}/${e.diastolicBp}`'.match(PATTERNS.handBP)).toBeTruthy();
    expect('{v.spo2}%'.match(PATTERNS.unitAfterVital)).toBeTruthy();
    expect(FILES.length).toBeGreaterThan(500);
  });
  it('🔴 formatTemp 뒤 단위 중복 0', () => {
    expect(scan('dupUnit')).toEqual({});
  });
  it('🔴 전환한 화면은 부품을 쓴다', () => {
    const missing = MIGRATED.filter((rel) => !FILES.find((f) => f.rel === rel)?.src.includes("@/components/vitals/VitalSigns'"));
    expect(missing).toEqual([]);
  });
  for (const k of ['degC', 'handBP', 'unitAfterVital'] as const) {
    it(`${k} — 파일별 정확 동결(늘면 실패·줄면 내린다)`, () => {
      expect(scan(k)).toEqual(BASELINE[k]);
    });
  }
});
