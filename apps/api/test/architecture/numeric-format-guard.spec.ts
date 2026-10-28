import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 구조 가드 (수치 정책 P6) — **신규 `toFixed` 하드코딩 차단.**
 *
 * 자릿수·반올림·단위는 `NUMERIC_POLICIES`(shared) 정본에서 오고, 화면은 `<Num domain>`/`formatNum`,
 * 저장·계산은 `roundBy`, FHIR 는 `fhirQuantity` 를 쓴다. `toFixed` 를 직접 부르면 그 지점만 정책 밖에
 * 남아 조용히 드리프트한다(체온 `38.1999℃`·재원일 floor·위급 flag 부분매칭이 전부 같은 계열이었다).
 *
 * 🔴 **전면 금지가 아니라 기준선 동결**이다. 아래 목록은 정본 도입 시점(2026-08-10)의 잔여이며
 *    대부분 통계·경고 문자열이라 정책 대상이 아니다(기획 §6: "통계·내부 계산의 Math.round 408곳은
 *    대상 아님" — 무분별 치환은 평균을 왜곡한다). 같은 이유로 `Math.round` 는 전면 스캔하지 않는다.
 *
 * 이 테스트가 실패하면 둘 중 하나다:
 *   1. 새 표시·저장 코드가 `toFixed` 를 썼다 → `<Num>`/`formatNum`/`roundBy`/`fhirQuantity` 로 교체
 *   2. 잔여를 정본으로 치환해 줄었다 → 아래 기준선을 **낮춰서** 갱신(늘리는 방향은 근거 필요)
 *
 * 정본: packages/shared/src/numeric-policy.ts · fhir-quantity.ts
 * 기획: docs/01-plan/features/numeric-format-policy.plan.md §5(P6)·§9
 */

const APPS = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = [path.join(APPS, 'api', 'src'), path.join(APPS, 'web', 'src')];

/** 정본 도입 시점 잔여 — 파일별 허용 건수. 새 파일·증가분은 실패한다. */
const BASELINE: Record<string, number> = {
  // BE — 전부 통계 지표·경고 메시지 문자열(임상 표시값 아님)
  'api/src/common/interceptors/metrics.interceptor.ts': 1,
  'api/src/modules/chronic/chronic.service.ts': 2,
  'api/src/modules/concierge/concierge.service.ts': 1,
  'api/src/modules/diagnostic-test/diagnostic-test.service.ts': 1,
  'api/src/modules/dialysis/dialysis.service.ts': 2,
  'api/src/modules/executive/executive.service.ts': 2,
  'api/src/modules/imaging/imaging-safety.service.ts': 2,
  'api/src/modules/infection-control/infection-control.service.ts': 1,
  'api/src/modules/lab/qc.service.ts': 1,
  'api/src/modules/medical-ai/medical-ai.service.ts': 1,
  'api/src/modules/pathology/pathology.service.ts': 2,
  // 2026-08-18: QI 측정값 산출이 정본 `computeMeasurementValue`(indicator-policy) 한 곳으로
  // 모이면서 잔여 1건이 사라졌다 — 되살아나면 실패하도록 0 으로 낮춘다.
  'api/src/modules/quality/quality.service.ts': 0,
  'api/src/modules/radiation/radiation.service.ts': 1,
  'api/src/modules/voc/voc-admin.service.ts': 3,
  // FE — 백분율·파일크기·점수 등 단일화면 니치. 임상 표시 후보는 점진 치환 대상.
  'web/src/app/(main)/admin/codes/auto-mapping-dashboard.tsx': 9,
  'web/src/app/(main)/admin/codes/code-detail-panel.tsx': 1,
  'web/src/app/(main)/admin/codes/page.tsx': 1,
  'web/src/app/(main)/admin/data-quality/page.tsx': 1,
  'web/src/app/(main)/admin/homepage/media/page.tsx': 2,
  'web/src/app/(main)/concierge/page.tsx': 1,
  'web/src/app/(main)/cost-analysis/page.tsx': 1,
  'web/src/app/(main)/dashboard/components/DashboardCharts.tsx': 1,
  'web/src/app/(main)/dermatology/page.tsx': 1,
  'web/src/app/(main)/executive/page.tsx': 1,
  'web/src/app/(main)/lab/components/QcTab.tsx': 3,
  'web/src/app/(main)/nutrition/components/NutritionAdvanced.tsx': 1,
  'web/src/app/(main)/ophthalmology/page.tsx': 3,
  'web/src/app/(main)/patients/[id]/components/ClinicalToolsTab.tsx': 4,
  'web/src/app/(main)/patients/[id]/components/DermatologyTab.tsx': 1,
  'web/src/app/(main)/patients/[id]/components/DialysisTab.tsx': 2,
  'web/src/app/(main)/patients/[id]/components/OphthalmologyTab.tsx': 3,
  'web/src/app/(main)/patients/[id]/encounter/new/components/FamilyMedicineEncounterLayout.tsx': 1,
  'web/src/app/(main)/patients/[id]/encounter/new/components/InternalMedicineEncounterLayout.tsx': 1,
  'web/src/app/(main)/patients/[id]/encounter/new/components/PediatricsEncounterLayout.tsx': 1,
  'web/src/app/(main)/quality/page.tsx': 1,
  'web/src/app/(main)/satisfaction/page.tsx': 5,
  'web/src/app/(main)/telehealth/page.tsx': 1,
  'web/src/app/(main)/telehealth/recordings/page.tsx': 2,
  'web/src/components/admin/MediaPickerModal.tsx': 2,
  'web/src/components/chart/ChartRenderer.tsx': 3,
  'web/src/components/clinical-charts/ClinicalChartRunner.tsx': 3,
  'web/src/components/clinical-charts/RegimenOrderModal.tsx': 1,
  'web/src/components/specialty/BurnsChart.tsx': 2,
  'web/src/components/specialty/ScoreCalculator.tsx': 1,
  'web/src/components/voice-emr/ConversationStreamPanel.tsx': 3,
  'web/src/components/voice-emr/MicSettings.tsx': 1,
  'web/src/components/voice-emr/VoiceConfirmCard.tsx': 1,
};

const TO_FIXED = /\.toFixed\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if ((e.name.endsWith('.ts') || e.name.endsWith('.tsx')) && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** apps/ 기준 상대경로 → 건수 */
function scan(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const n = (fs.readFileSync(file, 'utf-8').match(TO_FIXED) ?? []).length;
      if (n > 0) found[path.relative(APPS, file).split(path.sep).join('/')] = n;
    }
  }
  return found;
}

describe('수치 표시 정본 가드 (P6)', () => {
  const found = scan();

  it('🔴 새 파일이 toFixed 를 쓰지 않는다 — 표시는 <Num>/formatNum, 저장은 roundBy, FHIR 는 fhirQuantity', () => {
    const newFiles = Object.keys(found).filter((f) => !(f in BASELINE)).sort();
    expect(newFiles, `정본을 우회한 신규 파일:\n  ${newFiles.join('\n  ')}`).toEqual([]);
  });

  it('🔴 기존 파일에서 toFixed 가 늘지 않는다', () => {
    const grown = Object.entries(found)
      .filter(([f, n]) => f in BASELINE && n > BASELINE[f])
      .map(([f, n]) => `${f}: ${BASELINE[f]} → ${n}`)
      .sort();
    expect(grown, `기준선 초과:\n  ${grown.join('\n  ')}`).toEqual([]);
  });

  it('치환으로 줄었으면 기준선을 낮춘다(동결값이 실제보다 크면 알린다)', () => {
    const stale = Object.entries(BASELINE)
      .filter(([f, n]) => (found[f] ?? 0) < n)
      .map(([f, n]) => `${f}: 기준선 ${n} → 실제 ${found[f] ?? 0}`)
      .sort();
    expect(stale, `기준선 갱신 필요(낮추기):\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
