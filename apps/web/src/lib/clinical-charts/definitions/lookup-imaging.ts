/**
 * Lookup 콘텐츠 — 영상의학·근골격·외상 (PACS 판독 보조)
 * 출처: clinical-charts 02·05·12·14 문서.
 * ⚠️ verified=false — ACR/AO/AAST 등 공식 원문 대조 필수. 보조도구·최종판단 의사 귀속.
 *   영상 판정은 HIS 측 판독 보조 UI이며 PACS(OpenPACS)는 링크만 제공한다.
 */
import type { LookupDef } from '../types';

export const LOOKUP_IMAGING_DEFS: LookupDef[] = [
  /* ── RADS 계열 ── */
  {
    chartId: 'LIRADS', name: 'LI-RADS (간 — HCC 위험군)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'ACR LI-RADS', sourceVersion: 'v2018', verified: false, inputLabel: '범주',
    options: [
      { code: 'LR-1', label: 'LR-1 — 명백한 양성', level: 'normal' },
      { code: 'LR-2', label: 'LR-2 — 양성 추정', level: 'low' },
      { code: 'LR-3', label: 'LR-3 — 중간 확률', level: 'moderate' },
      { code: 'LR-4', label: 'LR-4 — HCC 가능성 높음', level: 'high' },
      { code: 'LR-5', label: 'LR-5 — HCC 명백', level: 'critical' },
      { code: 'LR-M', label: 'LR-M — 악성(HCC 비특이적)', level: 'high' },
      { code: 'LR-TIV', label: 'LR-TIV — 종양 정맥 침범', level: 'critical' },
      { code: 'LR-NC', label: 'LR-NC — 평가 불가', level: 'moderate' },
    ],
  },
  {
    chartId: 'PIRADS', name: 'PI-RADS (전립선 MRI)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'ACR PI-RADS', sourceVersion: 'v2.1', verified: false, inputLabel: '점수',
    options: [
      { code: '1', label: '1 — 매우 낮음', level: 'normal' },
      { code: '2', label: '2 — 낮음', level: 'low' },
      { code: '3', label: '3 — 중간(애매)', level: 'moderate' },
      { code: '4', label: '4 — 높음', level: 'high', recommendation: '표적 생검 고려' },
      { code: '5', label: '5 — 매우 높음', level: 'critical', recommendation: '표적 생검' },
    ],
  },
  {
    chartId: 'LUNGRADS', name: 'Lung-RADS (폐암 저선량 CT 검진)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'ACR Lung-RADS', sourceVersion: 'v1.1', verified: false, inputLabel: '범주',
    options: [
      { code: '0', label: '0 — 불완전', level: 'moderate', recommendation: '추가검사·이전영상' },
      { code: '1', label: '1 — 음성', level: 'normal', recommendation: '12개월 후 검진' },
      { code: '2', label: '2 — 양성 소견', level: 'low', recommendation: '12개월 후 검진' },
      { code: '3', label: '3 — 양성 추정', level: 'moderate', recommendation: '6개월 후 추적' },
      { code: '4A', label: '4A — 의심', level: 'high', recommendation: '3개월 추적 또는 PET/CT' },
      { code: '4B', label: '4B — 의심(높음)', level: 'critical', recommendation: '조직검사/PET/CT' },
      { code: '4X', label: '4X — 추가 악성 의심 동반', level: 'critical', recommendation: '4B에 준함' },
    ],
  },
  {
    chartId: 'ORADS', name: 'O-RADS (난소·부속기)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'ACR O-RADS', sourceVersion: 'v2022', verified: false, inputLabel: '범주',
    options: [
      { code: '0', label: '0 — 불완전', level: 'moderate' },
      { code: '1', label: '1 — 정상(생리적)', level: 'normal' },
      { code: '2', label: '2 — 거의 확실한 양성(<1%)', level: 'low' },
      { code: '3', label: '3 — 낮은 위험(1–<10%)', level: 'moderate' },
      { code: '4', label: '4 — 중간 위험(10–<50%)', level: 'high' },
      { code: '5', label: '5 — 높은 위험(≥50%)', level: 'critical' },
    ],
  },
  {
    chartId: 'CAD_RADS', name: 'CAD-RADS (관상동맥 CT)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'SCCT CAD-RADS', sourceVersion: '2.0', verified: false, inputLabel: '범주(최대 협착)',
    options: [
      { code: '0', label: '0 — 0% (협착 없음)', level: 'normal' },
      { code: '1', label: '1 — 1–24% 미미', level: 'low' },
      { code: '2', label: '2 — 25–49% 경증', level: 'moderate' },
      { code: '3', label: '3 — 50–69% 중등도', level: 'high' },
      { code: '4A', label: '4A — 70–99% 협착', level: 'critical', recommendation: '침습적 관상동맥조영 고려' },
      { code: '4B', label: '4B — 좌주간부 ≥50% 또는 3혈관 ≥70%', level: 'critical', recommendation: '침습적 관상동맥조영·치료' },
      { code: '5', label: '5 — 100% 완전 폐색', level: 'critical' },
    ],
  },

  /* ── 근골격·척추 ── */
  {
    chartId: 'GARDEN', name: 'Garden 분류 (대퇴 경부 골절)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Garden', sourceVersion: '1961', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 불완전·감입(외반)', level: 'low', attribute: '안정형' },
      { code: 'II', label: 'II — 완전 골절, 전위 없음', level: 'moderate', attribute: '안정형' },
      { code: 'III', label: 'III — 완전 골절, 부분 전위', level: 'high', attribute: '불안정형' },
      { code: 'IV', label: 'IV — 완전 골절, 완전 전위', level: 'critical', attribute: '불안정형' },
    ],
  },
  {
    chartId: 'WEBER', name: 'Weber 분류 (발목 비골 골절)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Danis-Weber', sourceVersion: '', verified: false, inputLabel: '유형',
    options: [
      { code: 'A', label: 'A — 인대결합 하방(온전)', level: 'low' },
      { code: 'B', label: 'B — 인대결합 높이(부분 손상 가능)', level: 'moderate' },
      { code: 'C', label: 'C — 인대결합 상방(손상)', level: 'high' },
    ],
  },
  {
    chartId: 'SALTER_HARRIS', name: 'Salter-Harris (소아 성장판 골절)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Salter-Harris', sourceVersion: '1963', verified: false, inputLabel: '유형',
    options: [
      { code: 'I', label: 'I — 성장판만 분리(Slipped)', level: 'low' },
      { code: 'II', label: 'II — 성장판+골간단(Above) 가장 흔함', level: 'moderate' },
      { code: 'III', label: 'III — 성장판+골단(Lower)', level: 'high' },
      { code: 'IV', label: 'IV — 골단·성장판·골간단 관통(Through)', level: 'high' },
      { code: 'V', label: 'V — 성장판 압박 손상(Rammed)', level: 'critical' },
    ],
  },
  {
    chartId: 'KELLGREN_LAWRENCE', name: 'Kellgren-Lawrence (골관절염)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Kellgren & Lawrence', sourceVersion: '1957', verified: false, inputLabel: '등급',
    options: [
      { code: '0', label: '0 — 정상', level: 'normal' },
      { code: '1', label: '1 — 의심되는 협소, 골극 가능성', level: 'low' },
      { code: '2', label: '2 — 명확한 골극, 협소 가능', level: 'moderate' },
      { code: '3', label: '3 — 다수 골극·명확한 협소·경화', level: 'high' },
      { code: '4', label: '4 — 큰 골극·심한 협소·골변형', level: 'critical' },
    ],
  },
  {
    chartId: 'PFIRRMANN', name: 'Pfirrmann (추간판 변성, MRI)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Pfirrmann', sourceVersion: '2001', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 균일·고신호·정상 높이', level: 'normal' },
      { code: 'II', label: 'II — 불균일·경계 명확·고신호', level: 'low' },
      { code: 'III', label: 'III — 회색·중간 신호', level: 'moderate' },
      { code: 'IV', label: 'IV — 경계 소실·중간~저신호', level: 'high' },
      { code: 'V', label: 'V — 저신호·디스크 붕괴', level: 'critical' },
    ],
  },
  {
    chartId: 'MODIC', name: 'Modic (종판·골수 변화)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Modic', sourceVersion: '1988', verified: false, inputLabel: '유형',
    options: [
      { code: 'I', label: 'I — T1저/T2고 (부종·염증, 급성)', level: 'moderate' },
      { code: 'II', label: 'II — T1고/T2등~고 (지방 변성, 만성)', level: 'low' },
      { code: 'III', label: 'III — T1저/T2저 (경화)', level: 'low' },
    ],
  },
  {
    chartId: 'MEYERDING', name: 'Meyerding (척추전방전위증)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Meyerding', sourceVersion: '', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 0–25%', level: 'low' },
      { code: 'II', label: 'II — 26–50%', level: 'moderate' },
      { code: 'III', label: 'III — 51–75%', level: 'high' },
      { code: 'IV', label: 'IV — 76–100%', level: 'high' },
      { code: 'V', label: 'V — >100% (척추탈락)', level: 'critical' },
    ],
  },

  /* ── 외상 장기손상 (AAST) ── */
  {
    chartId: 'AAST_SPLEEN', name: 'AAST 비장 손상 (OIS)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'AAST OIS', sourceVersion: '2018', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 피막하혈종<10%, 열상<1cm', level: 'low' },
      { code: 'II', label: 'II — 혈종 10–50%, 열상 1–3cm', level: 'moderate' },
      { code: 'III', label: 'III — 혈종>50%/실질내≥5cm, 열상>3cm', level: 'high' },
      { code: 'IV', label: 'IV — 분절·문부 혈관손상, 실질>25% 무혈관화', level: 'critical' },
      { code: 'V', label: 'V — 완전 파열·전체 무혈관화', level: 'critical' },
    ],
  },
  {
    chartId: 'AAST_LIVER', name: 'AAST 간 손상 (OIS)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'AAST OIS', sourceVersion: '2018', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 피막하혈종<10%, 열상<1cm', level: 'low' },
      { code: 'II', label: 'II — 혈종 10–50%, 열상 1–3cm', level: 'moderate' },
      { code: 'III', label: 'III — 혈종>50%, 열상>3cm', level: 'high' },
      { code: 'IV', label: 'IV — 실질 파괴 1엽의 25–75%', level: 'critical' },
      { code: 'V', label: 'V — 실질 파괴>75%·주위 정맥 손상', level: 'critical' },
      { code: 'VI', label: 'VI — 간 적출(avulsion)', level: 'critical' },
    ],
  },
  {
    chartId: 'AAST_KIDNEY', name: 'AAST 신장 손상 (OIS)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'AAST OIS', sourceVersion: '2018', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 좌상/피막하혈종, 열상 없음', level: 'low' },
      { code: 'II', label: 'II — 열상<1cm, 요누출 없음', level: 'moderate' },
      { code: 'III', label: 'III — 열상>1cm, 요누출 없음', level: 'high' },
      { code: 'IV', label: 'IV — 집뇨계 침범/요누출, 분절 혈관손상', level: 'critical' },
      { code: 'V', label: 'V — 신장 파쇄·신문부 혈관손상', level: 'critical' },
    ],
  },
  {
    chartId: 'TILE', name: 'Tile 분류 (골반 골절)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Tile', sourceVersion: '', verified: false, inputLabel: '유형',
    options: [
      { code: 'A', label: 'A — 안정(골반환 온전)', level: 'low' },
      { code: 'B', label: 'B — 회전 불안정·수직 안정', level: 'high' },
      { code: 'C', label: 'C — 회전·수직 모두 불안정', level: 'critical' },
    ],
  },
  {
    chartId: 'SCHATZKER', name: 'Schatzker 분류 (경골고원 골절)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Schatzker', sourceVersion: '', verified: false, inputLabel: '유형',
    options: [
      { code: 'I', label: 'I — 외측 쐐기형 분리', level: 'low' },
      { code: 'II', label: 'II — 외측 분리+함몰', level: 'moderate' },
      { code: 'III', label: 'III — 순수 함몰(외측)', level: 'moderate' },
      { code: 'IV', label: 'IV — 내측 고원', level: 'high' },
      { code: 'V', label: 'V — 양측 고원', level: 'high' },
      { code: 'VI', label: 'VI — 고원-골간 분리', level: 'critical' },
    ],
  },
  {
    chartId: 'TIMI_FLOW', name: 'TIMI Flow Grade (관상동맥 혈류)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'TIMI', sourceVersion: '', verified: false, inputLabel: '등급',
    options: [
      { code: '0', label: '0 — 폐색, 조영 통과 없음', level: 'critical' },
      { code: '1', label: '1 — 침투하나 원위부 충만 안 됨', level: 'high' },
      { code: '2', label: '2 — 원위부 충만되나 느림', level: 'moderate' },
      { code: '3', label: '3 — 정상 관류', level: 'normal' },
    ],
  },
  {
    chartId: 'TICI', name: 'TICI (뇌 재관류 등급)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'mTICI', sourceVersion: '2013', verified: false, inputLabel: '등급',
    note: '성공적 재관류 기준 ≥2b.',
    options: [
      { code: '0', label: '0 — 관류 없음', level: 'critical' },
      { code: '1', label: '1 — 통과하나 원위부 충만 안 됨', level: 'high' },
      { code: '2a', label: '2a — 원위부 <50% 충만', level: 'high' },
      { code: '2b', label: '2b — 원위부 ≥50% 불완전', level: 'moderate' },
      { code: '2c', label: '2c — 거의 완전', level: 'low' },
      { code: '3', label: '3 — 완전 재관류', level: 'normal' },
    ],
  },
  {
    chartId: 'GUSTILO', name: 'Gustilo-Anderson (개방골절)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'Gustilo-Anderson', sourceVersion: '', verified: false, inputLabel: '등급',
    options: [
      { code: 'I', label: 'I — 상처<1cm, 깨끗', level: 'low' },
      { code: 'II', label: 'II — 1–10cm, 중등도 연부조직 손상', level: 'moderate' },
      { code: 'IIIA', label: 'IIIA — 광범위 손상·충분한 덮개', level: 'high' },
      { code: 'IIIB', label: 'IIIB — 골막 박리·피판 필요', level: 'critical' },
      { code: 'IIIC', label: 'IIIC — 동맥 손상·혈관 재건 필요', level: 'critical' },
    ],
  },
  {
    chartId: 'BREAST_DENSITY', name: '유방 실질 밀도 (ACR)', category: '영상', archetype: 'lookup',
    sourceGuideline: 'ACR BI-RADS Density', sourceVersion: '5th ed', verified: false, inputLabel: '범주',
    options: [
      { code: 'a', label: 'a — 거의 전부 지방', level: 'normal' },
      { code: 'b', label: 'b — 산재성 섬유선 조직', level: 'low' },
      { code: 'c', label: 'c — 불균질 치밀', level: 'moderate', recommendation: '보조검사(US 등) 고려' },
      { code: 'd', label: 'd — 극도로 치밀', level: 'moderate', recommendation: '검사 민감도 저하·보조검사 고려' },
    ],
  },
  {
    chartId: 'GLEASON_ISUP', name: 'Gleason / ISUP Grade Group (전립선암)', category: '병리', archetype: 'lookup',
    sourceGuideline: 'ISUP/WHO', sourceVersion: '2014', verified: false, inputLabel: 'Grade Group',
    options: [
      { code: 'GG1', label: 'GG1 — Gleason ≤6 (3+3)', level: 'low', attribute: '저위험' },
      { code: 'GG2', label: 'GG2 — 3+4=7', level: 'moderate', attribute: '중간(우호적)' },
      { code: 'GG3', label: 'GG3 — 4+3=7', level: 'high', attribute: '중간(불량)' },
      { code: 'GG4', label: 'GG4 — 8', level: 'high', attribute: '고위험' },
      { code: 'GG5', label: 'GG5 — 9–10', level: 'critical', attribute: '최고위험' },
    ],
  },
];
