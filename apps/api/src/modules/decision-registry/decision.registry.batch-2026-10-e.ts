/**
 * 결정 등록부 배치 10-E (2026-10-09) — **무선 AP 기반 원내 위치**(기획 `docs/01-plan/features/wifi-ap-location.plan.md` §7).
 *
 * 수집 프로토콜(wifi-location.v1)·측위·AP 등록부·단말 연결(동의 근거)·3D 표시는 개발했다. 실제 환자 위치를 모으기 시작하는 것은
 * 개인위치정보 수집이라 **허가권자 결정**이고, 동의를 어떻게 받을지·교정 없이 써도 되는지는 기관이 정한다.
 *
 * 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고·기본 선택 없음. 어느 선택지도 집행 대상을 갖지 않는다(`enact: null`):
 *    수집 켜기는 결정 기록 뒤 관리자가 설정 `location.wifi.enabled` 를 바꾼다(결정 없이 켜면 설정 이력에 관리자 직접 변경으로 남는다).
 * 🔴 법령은 "적용 여부 검토"로만 적는다 — 조문·처리기한은 조사하지 않았으므로 적지 않는다(판정 규칙 §7).
 * 보존 기간은 기존 결정 `location.retentionDays`(배치 I) 가 측위 원장까지 덮는다 — 여기서 따로 만들지 않는다.
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/wifi-ap-location.plan.md`';

export const DECISION_BATCH_2026_10_E: DecisionDef[] = [
  {
    key: 'location.wifi.collect',
    track: 'PRIVACY',
    title: '무선 AP 로 환자 단말·위치 태그의 원내 위치를 수집할 것인가',
    layer: 'LICENSE_HOLDER',
    why:
      '실제 실시간 위치는 관측 원천이 있어야 나온다(운영 관측 기록 개통 이래 1건). 무선 AP 측위는 기존 무선망으로 환자 위치를 근사할 수 있지만, ' +
      '환자가 언제 어느 방에 있었는지를 계속 남기는 **개인위치정보 수집**이다. 수집 코드는 있고 설정이 꺼져 있다(수집기가 보내도 503).',
    legalReview: ['위치정보의 보호 및 이용 등에 관한 법률 적용 여부 검토', '개인정보 보호법상 수집·이용 동의와 보유 기간(원내 규정)', '감염 역학조사 목적 이용 범위'],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·병원장 · 개인정보보호책임자',
    options: [
      { value: 'NONE', label: '수집하지 않는다(현행)', effect: '설정 `location.wifi.enabled` 꺼짐 유지. 실제 위치는 QR 체크인·스테이션 도착만. 데모 시뮬레이션은 리허설에서만 돈다.', enact: null },
      { value: 'TAG_ONLY', label: '병원 지급 위치 태그만 — 동의한 환자에게 태그를 건네고 연결', effect: '관리 화면에서 설정을 켠다. 단말 종류를 태그로만 쓰는 것은 운영 절차다(시스템은 종류를 막지 않는다 — 막으려면 개발).', enact: null },
      { value: 'TAG_AND_DEVICE', label: '태그와 환자 단말(앱·무선망 접속) 모두 — 동의한 경우', effect: '관리 화면에서 설정을 켠다. 환자 단말의 MAC 무작위화로 같은 단말이 다른 값으로 보일 수 있어 앱 연동(단말 스캔) 개발이 남는다.', enact: null },
    ],
    statusQuo: '수집 EP(`POST /api/v1/location/wifi/ingest`)·측위·단말 연결·3D 표시가 있고 설정 `location.wifi.enabled` = false(기본). 꺼져 있으면 수집기에 503 을 돌려주고 아무것도 저장하지 않는다. 운영은 데모 AP 배치(실제 설치 아님)와 시뮬레이션 측위만 있다.',
    verifyHow: ['/admin/wifi-location 현황 "실제 위치 수집"', PLAN + ' §3·§6'],
    afterDecision: 'NONE 외에는 수집기 발급·실제 AP 등록(좌표)·교정 측정·단말 연결 절차 교육이 남는다.',
    owner: '개인정보보호팀 · 전산팀 · 시설팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'location.wifi.consentMethod',
    track: 'PRIVACY',
    title: '무선 위치 수집 동의를 어떤 방식으로 받을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '단말을 환자에게 연결하려면 동의 근거가 있어야 한다. 시스템은 지금 서면 동의와 구두 동의(누구에게서 어떻게 받았는지 메모 필수) 둘을 받는다. ' +
      '초진 동의 수집(태블릿·휴대폰·종이)에는 위치 수집 항목이 없다.',
    legalReview: ['동의 방식의 법적 요건(서면·전자·구두) 적용 검토', '미성년·의사결정 불가 환자의 대리 동의'],
    approvalPath: 'CODE_CHANGE',
    authority: '개인정보보호책임자 · 원무 · 간호부',
    dependsOn: ['location.wifi.collect'],
    options: [
      { value: 'WRITTEN_OR_VERBAL', label: '서면 또는 구두(기록자·메모 남김)(현행)', effect: '태그를 건네는 직원이 연결 화면에서 근거를 고른다. 서면 동의서 원본은 시스템 밖에 있다.', enact: null },
      { value: 'WRITTEN_ONLY', label: '서면 동의만', effect: '구두 선택지를 빼는 화면·서버 변경이 남는다.', enact: null },
      { value: 'REGISTRATION_CONSENT_ITEM', label: '초진 동의 수집에 위치 수집 항목을 추가', effect: '동의 원장 항목 추가·서명 화면 변경 개발이 남는다. 연결 때 그 동의를 찾아 근거로 잇는다.', enact: null },
    ],
    statusQuo: '`POST /api/v1/location/wifi/bindings` 는 근거 WRITTEN·VERBAL_RECORDED 를 받는다(구두는 메모 필수 · DEMO 는 거절). 근거 문서 첨부·초진 동의 연동은 없다.',
    verifyHow: ['/admin/wifi-location 단말 연결 폼', PLAN + ' §5'],
    afterDecision: 'WRITTEN_OR_VERBAL 외에는 화면·서버(·동의 원장) 변경이 남는다.',
    owner: '개인정보보호팀 · 원무팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'location.wifi.calibration',
    track: 'PLATFORM',
    title: '교정하지 않은 AP 의 측위를 운영 위치로 써도 되는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '교정하지 않은 AP 는 기본 전파 모델(1m −40dBm · 감쇠 지수 2.8 — 일반 실내 값의 중간, 측정값 아님)로 거리를 계산한다. ' +
      '벽·사람·단말 방향에 따라 실제 오차는 이보다 클 수 있다. 화면은 오차 반경과 "교정 안 됨"을 말하지만, 원장에 쓰는 것을 막지는 않는다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '시설 책임자 · 전산 책임자 · 감염관리실(접촉자 후보에 쓰일 때)',
    options: [
      { value: 'ALLOW_WITH_RADIUS', label: '교정 없이 쓰고 오차 반경을 함께 보인다(현행)', effect: '오차가 8m 를 넘으면 층까지만 기록한다. 교정은 시설팀이 순차로 한다.', enact: null },
      { value: 'SURVEY_FIRST', label: '현장 교정 측정 뒤에만 운영 위치로 쓴다', effect: '교정 안 된 AP 만으로 푼 측위는 측위 원장에만 남기고 위치 원장으로 옮기지 않는 개발이 남는다.', enact: null },
      { value: 'FINGERPRINT', label: '지점별 신호 지도(핑거프린트) 방식으로 바꾼다', effect: '층별 신호 수집 작업과 측위 엔진 교체 개발이 남는다.', enact: null },
    ],
    statusQuo: 'AP 마다 교정값(1m 세기·감쇠 지수)을 넣을 수 있다(관리 화면 · 둘을 함께). 운영 AP 는 전부 데모 배치·교정 안 됨이다.',
    verifyHow: ['/admin/wifi-location AP 등록부 "교정" 칸', 'shared `WIFI_PATH_LOSS_DEFAULT`·`WIFI_SOLVER`', PLAN + ' §4'],
    afterDecision: 'ALLOW_WITH_RADIUS 외에는 측위 반영 규칙 또는 엔진 변경 개발이 남는다.',
    owner: '시설팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
