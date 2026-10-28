import { describe, it, expect } from 'vitest';
import { tOf } from '@hospital-run/shared';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
// 계측 정본은 스크립트에 있다 — 수치를 두 곳에 적으면 갈라진다.
import { scanScreens } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 질·안전·연구·약제 화면의 UI 언어 배선 (2026-09-09 P3)
 *
 * 🔴 이 가드가 지키는 것은 넷이다.
 *   ① **한글 잔여 기준선 동결** — 화면별 정확 일치. 늘면 실패(새 하드코딩), 줄면 기준선을 낮춘다.
 *      여유를 두지 않는다(이 저장소가 55/50 여유에 재주입 1건을 흡수당했다).
 *   ② **카탈로그 키 존재** — 소유 화면의 `<T k="…">` 리터럴 키가 **활성 축 en·ja** 에서 해석된다.
 *      앞 카탈로그가 이미 가진 원문이면 그쪽이 해석한다 — 그래서 "quality2 에 있는가"가 아니라
 *      **"조회되는가"** 를 본다(사본을 두면 죽은 키가 되므로 있으면 오히려 틀렸다).
 *      🔴 ar 은 보류 언어(정본 §8)라 **부분 번역이 정상**이다 — 여기서 ar 을 강제하면
 *      다른 영역이 `ar: {}` 로 둔 정당한 선택을 실패로 말하게 된다. quality2 자신의 ar 은 ④가 본다.
 *   ③ **죽은 키 0** — quality2 의 모든 키가 소유 화면 소스에 원문으로 실재한다. 화면이 부르지 않는
 *      번역은 유지비만 남기고 조용히 낡는다.
 *   ④ 세 언어 키 집합 동일 · 빈 값 0 · `verified` 0(전량 AI 초안).
 *
 * 재현: `node scripts/i18n-unwired-scan.mjs`
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const CATALOG = join(ROOT, 'packages/shared/src/i18n/messages/quality2.ts');

/** 소유 화면(이 갈래가 배선한 것만) */
const OWNED_PREFIX = [
  '(main)/research/',
  '(main)/safety/',
  '(main)/pharmacist-activity/',
  '(main)/cancer-registry/',
  '(main)/pharmacy/admin/',
  '(main)/journey-console/',
  '(main)/quality/',
  '(main)/equipment/',
];

/**
 * 2026-09-09 실측 — 화면별 한글 조각 잔여(유니크). 🔴 **0 이 목표가 아니다**:
 * 라벨 맵 정의·보간 템플릿·토스트·저장값은 그대로 남고 렌더 자리에서만 조회된다(카탈로그 헤더 ②).
 */
const KO_BASELINE: [string, number][] = [
  ['(main)/cancer-registry/page.tsx', 87],
  ['(main)/equipment/components/EquipmentDetailSections.tsx', 7],
  ['(main)/equipment/components/EquipmentRegisterForm.tsx', 3],
  ['(main)/equipment/components/InspectionLogTab.tsx', 8],
  ['(main)/equipment/components/MaintenanceLogModal.tsx', 8],
  ['(main)/equipment/components/PartsTab.tsx', 3],
  ['(main)/equipment/components/shared.tsx', 0],
  ['(main)/equipment/components/UsageLogTab.tsx', 2],
  ['(main)/equipment/page.tsx', 22],
  ['(main)/journey-console/delay-ack.tsx', 8],
  ['(main)/journey-console/live-stream.tsx', 0], // 2026-09-15 S4 FR-10 실시간 배지(전량 배선)
  ['(main)/journey-console/page.tsx', 28],
  ['(main)/journey-console/export-readiness.tsx', 0], // 2026-10-01 여정 P3-1 반출 준비도 카드(전량 배선)
  ['(main)/journey-console/recording-health.tsx', 0], // 2026-10-01 여정 P2-5 기록 상태 카드(전량 배선)
  ['(main)/pharmacist-activity/components/CounselTab.tsx', 17],
  ['(main)/pharmacist-activity/components/NaranjoDialog.tsx', 18],
  // 🔴 106 → 72 (2026-09-09): 화면이 아니라 **계측이 고쳐졌다**. 스캐너가 `/filename="?([^"]+)"?/` 같은
  //    정규식 리터럴을 문자열로 읽어 파일 끝까지 삼키던 자리 — 이 화면이 §11 의 원 사례다.
  // 72 → 71 (2026-09-30): 중재 유형 라벨 표를 공유 정본(`lib/pharmacist-intervention.ts`)으로 옮겼다(의사 회신 화면과 한 벌)
  ['(main)/pharmacist-activity/page.tsx', 71],
  ['(main)/pharmacy/admin/page.tsx', 15], // 2026-09-30 17→15 — 대체조제 판정 토스트가 공용 판정 부품으로
  ['(main)/quality/MeasurementPanel.tsx', 10],
  // 2026-10-08 QI 흐름 — 남은 조각은 탭·라벨 정의(렌더 자리에서 <T k={…}>·tAttr 로 조회)
  ['(main)/quality/AccreditationSection.tsx', 3],
  ['(main)/quality/QiFlowOps.tsx', 7],
  ['(main)/quality/QiFlowPanel.tsx', 4],
  ['(main)/quality/page.tsx', 12], // 2026-10-08 16→12 원장 대조 문구 배선(QI 흐름 P0)
  ['(main)/quality/QiSupplierCatalog.tsx', 0], // 2026-10-10 자동 산출 공급원 목록(전량 배선)
  ['(main)/research/page.tsx', 102],
  ['(main)/safety/page.tsx', 53], // 2026-10-08 53→51 상태 라벨 shared 정본(INCIDENT_STATUS_LABEL)으로 · 51→53 보고 폼 유형·중증도 미선택 검증 문구 2(<T k={errors…message}> 로 조회)
];

type Row = { file: string; t: number; ko: number; frags: string[] };
const rows: Row[] = (scanScreens(APP, APP) as Row[]).filter((r) => OWNED_PREFIX.some((p) => r.file.startsWith(p)));

/** 소유 화면 + 그 화면이 읽는 형제 소스(.ts 라벨 표 포함) 전문 */
function ownedSources(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.tsx') || p.endsWith('.ts')) {
        const rel = relative(APP, p);
        if (OWNED_PREFIX.some((pre) => rel.startsWith(pre))) out.push(readFileSync(p, 'utf8'));
      }
    }
  };
  walk(APP);
  return out.join('\n');
}
const OWNED_SRC = ownedSources();

/**
 * 🔴 JSX 는 속성 문자열의 HTML 엔티티도 디코드한다 — 소스의 `&lsquo;` 는 런타임 키에서 ‘ 다.
 *    디코드하지 않으면 이 가드가 **없는 미등록을 고발**한다(실측으로 3키가 그랬다).
 */
const decode = (s: string) => s.replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’');

/** shared 정본에서 오는 어휘 — 화면 소스에 원문이 없지만 `<T k={FLAG_LABEL[…]}>` 로 실제 조회된다 */
const FROM_SHARED_CANON = new Set([
  '접수 지연', '트리아지 지연', '호출 지연', '진료 지연', '수납 지연', '정산 대기', '장기 재원', '고액 미수',
  // 2026-10-08 사고 상태 라벨 — shared INCIDENT_STATUS_LABEL 에서 `<T k={STATUS_LABEL[…]}>` 로 조회
  '보고됨', '조사중', '해결됨', '종료',
  // 2026-10-08 QI 흐름 — shared 정본(QI_SUPPLIERS·QI_SUPPLY_UNAVAILABLE_TEXT·QI_MEASUREMENT_SOURCE_LABEL·QI_FLOW_SETTING_KEYS·ACCREDITATION_JUDGMENT_LABEL·QI_DEVICE_TYPE_LABEL)에서 `<T k={…}>`·`tAttr(…)` 로 조회
  '자동 산출(처방 원장)', '시드(가상)', '외부 결과', '자동 산출 공급원이 없는 지표(수기 지표)', '분모가 정해지지 않았습니다(결정 qi.autoMeasure.denominator)', '이 기간 재원일수 스냅샷이 다 차지 않았습니다', '기구일수 원천이 정해지지 않았습니다(결정 qi.deviceDays.source)', '기구일수를 산출하지 않기로 했습니다(건수만)', '이 기간 기구일수 입력이 없습니다', '분모 0 — 표본이 없습니다', '환자안전사고(낙상) ÷ 분모(결정)', '환자안전사고(투약오류) ÷ 분모(결정)', '환자안전사고(욕창) ÷ 분모(결정)', '손위생 관찰 수행 ÷ 관찰 기회', 'CAUTI 건 ÷ 도뇨관 일수(결정)', 'CLABSI 건 ÷ 중심정맥관 일수(결정)', 'VAP 건 ÷ 인공호흡기 일수(결정)', 'VoC 불만 접수 건수(월)', '자동 월 마감(크론)', '사고율 분모', '기구일수 원천', '수기·자동 값 정본', '지표 정의 직접 수정', '익명 사고 보고', '위해 정도 척도', '부분 충족', '중심정맥관', '유치도뇨관',
  '기구 원장 전수 기록 시작일이 정해지지 않았습니다(설정 qi.deviceLedger.coverageFrom)', '기구 원장 전수 기록 시작일 이전 기간입니다', 'POA 입력 필수',
  // 2026-10-10 간호 과정 지표 공급원(QI_SUPPLIERS.NURSING_INITIAL_24H.label)
  '입원 24시간 안 간호초기평가 ÷ 24시간 이상 머문 입원',
  // 2026-10-27 공급원 통증 재평가 기한 내 수행률(QI_SUPPLIERS·QI_SUPPLIER_DEFINITION·QI_SUPPLY_UNAVAILABLE_TEXT)
  '낙상·욕창 위험 재평가 기한 내 수행률',
  '그 달 재원 중 낙상(Morse)·욕창(Braden) 평가',
  '그 평가 등급의 주기 안에 같은 유형 다음 평가',
  '기한이 아직 안 온 평가 · 기한 전에 재원이 끝난 평가 · 점수 범위 밖',
  'nursing.riskReassess.intervalHours(원내 규정 · 비면 코드 기본값 — 근거에 출처)',
  '기한 안 다음 평가가 있는 낙상·욕창 평가 ÷ 기한이 지난 평가(등급별 주기)',
  '통증 재평가 기한 내 수행률',
  '그 달 재원 중 통증 사건(기준 이상 통증 기록 · 규정이 켜면 진통제 투여)',
  '사건 뒤 기한 안 통증 재기록',
  '기한이 아직 안 온 사건 · 기한 전에 재원이 끝난 사건 · 약품 분류를 모르는 투약(수만 셈)',
  'nursing.pain.reassessRule(원내 규정 · 미설정이면 산출 불가)',
  '기한 안 재평가된 통증 사건 ÷ 기한이 지난 통증 사건(원내 규정)',
  '통증 재평가 원내 규정이 정해지지 않았습니다(설정 nursing.pain.reassessRule · 간호 원내 규정 화면)',
  '통증 재평가 원내 규정을 조회하지 못했습니다',
  // 2026-10-10 과정 지표 공급원·공급원 정의(QI_SUPPLIERS·QI_SUPPLIER_DEFINITION·QI_SUPPLY_UNAVAILABLE_TEXT) — 자동 산출 공급원 목록·고르기에서 `<T k={…}>`·`tAttr(…)` 로 조회
  '활력이 1회 이상 기록된 재원 근무조 ÷ 재원 중 온전히 지난 근무조',
  '48시간 안 회신된 협진 ÷ 그 달 의뢰된 협진(회신 없이 종결 제외)',
  '7일 안 서명된 진료기록 ÷ 그 달 작성 시작된 진료기록',
  '조사 기록자가 남은 조사 완료 분할 ÷ 그 달 조사 완료 분할',
  '처리 기한 안 발급된 서류 ÷ 그 달 신청된 서류(반려·기한 미도래 제외)',
  '방까지 확정된 관측 측위 ÷ 그 달 관측 측위(시뮬레이션 제외)',
  '낙상 발생률',
  '재원 중 일어난 낙상(병동 기록 또는 그 시각 재원)',
  '환자안전사고 낙상',
  '재원 밖(외래·응급) 사고 · 환자·병동 둘 다 없는 사고(수만 셈)',
  'qi.autoMeasure.incidentDenominator',
  '투약오류 발생률',
  '재원 중 일어난 투약오류',
  '환자안전사고 투약오류',
  '재원 밖 사고 · 환자·병동 둘 다 없는 사고',
  '욕창 발생률',
  '재원 중 발생한 욕창',
  '환자안전사고 욕창',
  '손위생 수행률',
  '그 달 손위생 관찰 기회',
  '수행',
  '없음',
  '요로감염 발생률 (도뇨관)',
  '도뇨관 일수',
  'CAUTI 사례',
  'qi.deviceDays.source',
  '중심정맥관 관련 혈류감염률',
  '중심정맥관 일수',
  'CLABSI 사례',
  '인공호흡기 관련 폐렴 발생률',
  '인공호흡기 일수',
  'VAP 사례',
  '환자 불만 건수',
  '그 달',
  'VoC 불만 접수',
  '간호초기평가 24시간 내 완료율',
  '그 달 입원(취소 제외) 중 24시간 이상 머문 입원',
  '입원 시각부터 24시간 안 간호초기평가',
  '24시간 미만 퇴원 · 24시간이 아직 안 지난 재원',
  '근무조 활력 기록 완결률',
  '그 달 재원 중 처음부터 끝까지 재원이었던 근무조(교대 경계 설정)',
  '그 근무조에 활력이 1회 이상(플로시트·간호 스테이션 입력 두 원장)',
  '입원·퇴원이 걸친 근무조 · 끝나지 않은 근무조',
  '협진 48시간 내 회신율',
  '그 달 의뢰된 협진',
  '의뢰 시각부터 48시간 안 회신',
  '회신 없이 종결(취소) · 48시간이 아직 안 지난 미회신',
  '진료기록 7일 내 서명률',
  '그 달 작성 시작된 진료기록',
  '작성 시작부터 7일 안 서명',
  '7일이 아직 안 지난 미서명',
  '방사선 조사 기록자 기재율',
  '그 달 조사 완료 분할',
  '조사 기록자(치료사)가 남은 분할',
  '서류 발급 처리 기한 준수율',
  '그 달 신청된 서류',
  '원내 처리 기한 안 발급',
  '반려 · 기한이 아직 안 온 미발급',
  'qi.docIssuance.slaHours(원내 처리 기한 · 미설정이면 산출 불가)',
  '무선 측위 방 확정률',
  '그 달 관측 측위(수집기)',
  '방까지 확정(오차 반경·층 판정 통과)',
  '시뮬레이션 측위',
  'location.wifi.collect(수집 결정 · 꺼져 있으면 산출 불가)',
  '서류 처리 기한(원내 규정)이 정해지지 않았습니다(설정 qi.docIssuance.slaHours)',
  '무선 위치 수집이 꺼져 있습니다(결정 location.wifi.collect · 설정 location.wifi.enabled)',
]);

/** 카탈로그 표를 소스에서 읽는다(정본 파일 하나 — dist 딥 임포트를 만들지 않는다) */
function catalogRows(): { key: string; en: string; ja: string; ar: string }[] {
  const src = readFileSync(CATALOG, 'utf8');
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('\n};'));
  const out: { key: string; en: string; ja: string; ar: string }[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s*(?:'((?:\\.|[^'\\])*)'|"([^"]*)"):\s*\[(.*)\],\s*$/.exec(line);
    if (!m) continue;
    const key = (m[1] !== undefined ? m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : m[2]) as string;
    const vals: string[] = [];
    const rest = m[3];
    let i = 0;
    while (i < rest.length && vals.length < 3) {
      const q = rest[i];
      if (q !== "'" && q !== '"') { i++; continue; }
      let j = i + 1; let v = '';
      while (j < rest.length) {
        if (rest[j] === '\\') { v += rest[j + 1]; j += 2; continue; }
        if (rest[j] === q) break;
        v += rest[j]; j++;
      }
      vals.push(v); i = j + 1;
    }
    out.push({ key, en: vals[0], ja: vals[1], ar: vals[2] });
  }
  return out;
}
const CAT = catalogRows();

describe('🔴 질·안전·연구·약제 화면 — UI 언어 배선', () => {
  it('대조군 — 스캔·파서가 실제 대상을 본다(대상이 0이면 이 스펙은 아무것도 보증하지 않는다)', () => {
    expect(rows.length).toBe(KO_BASELINE.length);
    expect(rows.reduce((a, r) => a + r.t, 0)).toBeGreaterThan(1000); // <T>/tAttr 배선 총량
    expect(CAT.length).toBeGreaterThan(500); // 파서가 죽으면 ③④가 조용히 통과한다
    expect(OWNED_SRC.length).toBeGreaterThan(100_000);
  });

  it('① 화면별 한글 잔여 기준선 — 정확 일치(늘면 실패·줄면 기준선을 낮춘다)', () => {
    const actual = rows.map((r) => [r.file, r.ko] as [string, number]).sort((a, b) => a[0].localeCompare(b[0]));
    expect(actual).toEqual([...KO_BASELINE].sort((a, b) => a[0].localeCompare(b[0])));
  });

  it('② 소유 화면의 `<T k="원문">` 리터럴 키는 활성 축(en·ja)에서 조회된다 — EN×/JA× 거짓 티 0', () => {
    const keys = new Set<string>();
    for (const m of OWNED_SRC.matchAll(/<T\s+k="((?:[^"\\]|\\.)*)"/g)) {
      const k = decode(m[1]);
      if (/[가-힣]/.test(k)) keys.add(k);
    }
    expect(keys.size).toBeGreaterThan(400);
    const missing: string[] = [];
    for (const k of keys) for (const loc of ['en', 'ja']) if (tOf(k, loc).missing) missing.push(`${loc}:${k}`);
    expect(missing).toEqual([]);
  });

  it('③ 죽은 키 0 — quality2 의 모든 키가 소유 화면 소스에 원문으로 실재한다', () => {
    const dead = CAT.map((r) => r.key)
      .filter((k) => !FROM_SHARED_CANON.has(k))
      .filter((k) => !OWNED_SRC.includes(k));
    expect(dead).toEqual([]);
  });

  it('④ 세 언어 값이 모두 있고 빈 값이 없다 (한 언어만 조용히 비는 회귀를 막는다)', () => {
    const empty = CAT.filter((r) => !r.en?.trim() || !r.ja?.trim() || !r.ar?.trim()).map((r) => r.key);
    expect(empty).toEqual([]);
  });

  it('⑤ 전량 AI 초안이다 — 사람 검수(VERIFIED)를 했다고 말하지 않는다', () => {
    const src = readFileSync(CATALOG, 'utf8');
    expect(src).toMatch(/QUALITY2_VERIFIED: ReadonlySet<string> = new Set\(\);/);
  });
});
