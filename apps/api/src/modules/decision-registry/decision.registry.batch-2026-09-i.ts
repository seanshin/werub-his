/**
 * 결정 등록부 배치 I (2026-09-28) — **공간·동선 축**(기획 `docs/01-plan/features/spatial-flow-vision-3d.plan.md` §9 D1~D12).
 *
 * 그 기획서의 사람 결정 표는 키만 적은 채 "착수 시 등재"로 남아 있었다 — 문서에 있는 동안엔 아무도 못 고른다.
 * P0~P3 가 배포된 뒤라 `statusQuo` 는 **배포된 코드를 다시 읽고** 적었다(2026-09-28 · `a007e9edf`·`26be19b4a`).
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다. 어느 항목도 `enactKind` 를 갖지 않고
 *    모든 선택지의 `enact` 는 `null` 이다 — 어느 쪽을 골라도 코드 또는 설정 변경이 남는다(CODE_CHANGE).
 * 🔴 법령은 "적용 여부 검토"로만 적는다 — 조문·처리기한은 조사하지 않았으므로 적지 않는다(판정 규칙 §7).
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/spatial-flow-vision-3d.plan.md` §9';

export const DECISION_BATCH_2026_09_I: DecisionDef[] = [
  {
    key: 'space.drawingExtract.provider',
    track: 'AI',
    title: '병원 도면(평면도) 이미지를 누가 판독해 공간 초안을 만들 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '실제 도면에서 방·문·동선을 뽑아 공간 모델을 만드는 일은 사람 손으로 하면 층당 수백 개 항목이다. ' +
      '이미지 판독 모델이 초안을 만들 수 있지만, 서버가 외부 모델을 부르면 **대외 발신**(도면 이미지가 원외로 나감)이다. ' +
      '도면은 환자 정보가 아니지만 보안 구역·설비 배치가 담긴 기관 자산이다. 원내 WeRU.B 비전 모델의 도면 판독 품질은 잰 적이 없다.',
    legalReview: ['도면(보안 구역·설비 배치)의 원외 전송 허용 여부 — 원내 보안 규정', 'AI 기본법상 표기·설명 의무 적용 여부(판독 결과는 초안으로만 쓴다)'],
    approvalPath: 'CODE_CHANGE',
    authority: '정보보호책임자 · 시설 책임자 · AI 운영 위원회',
    options: [
      { value: 'DEV_ONLY', label: '런타임 판독 없음 — 개발 단계에서만 판독해 가져오기 파일로 넣는다(현행)', effect: '서버는 어떤 모델에도 도면을 보내지 않는다. 도면이 바뀔 때마다 개발 작업이 필요하다.', enact: null },
      { value: 'ONPREM_WERUB', label: '원내 WeRU.B 비전 모델로 서버가 판독', effect: '원외 전송 없음. 판독 품질을 먼저 수용 시험(D3)으로 재야 한다. 서비스 개발이 남는다.', enact: null },
      { value: 'EXTERNAL_API', label: '외부 모델 API 로 서버가 판독(대외 발신 3조건: 구현+설정 기본 OFF+승인)', effect: '도면 이미지가 원외로 나간다. 발신 호스트 허용·설정·승인 절차가 필요하다.', enact: null },
    ],
    statusQuo:
      '런타임 판독 코드가 없다. 2026-09-28 판독 수용 시험은 **개발 단계**에서 새 에이전트에게 합성 도면 PNG 를 주고 받은 결과다(`docs/04-report/space-drawing-read-2026-09-28.md`). ' +
      '운영 도면은 `/admin/space-model` 에 space-import.v1 JSON 으로만 올릴 수 있다.',
    verifyHow: ['`apps/api/src/modules/space-model` 에 모델 호출 코드가 없다(`ai-egress-fetch` 미사용)', PLAN],
    afterDecision: 'DEV_ONLY 외에는 판독 서비스·수용 시험·(외부면) 발신 승인 절차 개발이 남는다.',
    owner: '시설팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'space.geometry.confirmAuthority',
    track: 'PLATFORM',
    title: '도면을 "확정"해 공간 모델에 반영할 권한을 누가 가질 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '확정된 도면은 동선 뷰어·환자 길안내·자산 배치 좌표의 기준이 된다. 잘못된 도면을 확정하면 환자가 엉뚱한 방으로 안내된다. ' +
      '지금은 시스템 관리자면 누구나 확정·철회할 수 있고, 확정자가 시설 담당인지 시스템은 검증하지 못한다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '시설 책임자 · 전산 책임자',
    options: [
      { value: 'ADMIN', label: '시스템 관리자(현행)', effect: '관리자 누구나 확정·철회한다. 확정자 id 는 남지만 직책은 검증하지 않는다.', enact: null },
      { value: 'FACILITY_TWO_PERSON', label: '올린 사람과 다른 관리자가 확정(2인 확인)', effect: '올린 사람 ≠ 확정자 검사를 추가한다(결재 엔진 재사용).', enact: null },
      { value: 'DEDICATED_ROLE', label: '시설 담당 전용 권한을 만든다', effect: '시설 담당만 도면을 확정·철회한다. 관리자 계정이 도면을 바꾸지 못하게 되며, 역할·권한 추가 개발이 필요하다.', enact: null },
    ],
    statusQuo: '`POST /api/v1/space/imports/:id/confirm`·`withdraw` 는 `@Roles(ADMIN)` 하나다. 확정자(`confirmedById`)·시각은 남는다.',
    verifyHow: ['`apps/api/src/modules/space-model/space-model.controller.ts` 의 `@Roles` 를 읽는다', PLAN],
    afterDecision: 'ADMIN 외에는 권한 검사 개발이 남는다.',
    owner: '시설팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'space.drawingExtract.acceptance',
    track: 'AI',
    title: '도면 판독 결과를 "초안으로 쓸 만하다"고 볼 합격선을 무엇으로 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '합성 도면 시험에서 방은 145/145 를 찾았지만 문은 114/135 였다(놓친 문은 빗금·계단·엘리베이터 기호가 문 호를 가린 자리). ' +
      '문을 놓치면 동선 그래프가 끊겨 길안내가 돌아간다. 합격선은 병원이 감당할 수 있는 수정량의 문제라 코드가 정할 수 없다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '시설 책임자 · AI 운영 위원회',
    options: [
      { value: 'ROOMS_ONLY', label: '방 재현 95% 이상이면 초안 허용 — 문은 사람이 전량 확인', effect: '방 이름·경계만 합격선으로 본다. 문 위치 확인 작업이 사람 몫으로 남는다.', enact: null },
      { value: 'ROOMS_AND_DOORS', label: '방 95%·문 90% 이상이어야 초안 허용', effect: '현 합성 시험 기준으로는 3층(77.8%)이 미달이다.', enact: null },
      { value: 'NO_GATE', label: '합격선 없이 초안은 늘 사람이 전량 검토', effect: '판독은 보조일 뿐이고 검토 부담은 그대로다.', enact: null },
    ],
    statusQuo: '합격선이 없다. 채점기(`scripts/floorplan/score-drawing-read.mjs`)는 수치만 내고 판정하지 않는다. 합성 도면 결과는 실제 도면 정확도가 아니다.',
    verifyHow: ['`node scripts/floorplan/score-drawing-read.mjs` 를 실행한다', '`docs/04-report/space-drawing-read-2026-09-28.md`'],
    afterDecision: '실도면 표본이 생기면 같은 채점기로 재측정하고 합격선을 적용하는 개발이 남는다.',
    owner: '시설팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
    dependsOn: ['space.drawingExtract.provider'],
  },
  {
    key: 'location.inferred.display',
    track: 'CLINICAL',
    title: '여정 이벤트에서 추정한 환자 위치를 운영 화면에 보여줄 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '"오더가 났다 → 검사실에 있다" 같은 추정 위치가 위치 원장의 대부분이다(2026-09-28 운영 실측: 열린 위치 33건 **전부 추정**, 관측 0). ' +
      '추정을 보여주면 화면이 채워지지만 틀린 위치일 수 있고, 숨기면 관측(QR 스캔) 운영 전까지 화면이 비어 보인다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '간호부 · 원무 · 의료정보 책임자',
    options: [
      { value: 'HIDE_DEFAULT', label: '기본 숨김 · 켜면 다른 모양(빈 점선 점)으로(현행)', effect: '관측 운영 전까지 뷰어의 방이 대부분 비어 보이고, 추정은 사용자가 켜야 보인다.', enact: null },
      { value: 'SHOW_LABELED', label: '기본 표시 · "추정" 표식 필수', effect: '화면이 채워지지만 추정이라는 표식에 의존한다.', enact: null },
      { value: 'STOP_INFERRING', label: '추정 기록 자체를 멈춘다(관측만 남김)', effect: '여정→위치 번역 코드를 끈다. 관측 운영 전까지 위치 원장이 거의 빈다.', enact: null },
    ],
    statusQuo: '`PatientLocation.source` 로 관측/추정을 구분한다. 도면 뷰어의 추정 위치 레이어는 기본 꺼짐이고, 켜면 빈 점선 점으로 그린다. 메타버스 지표는 관측·추정을 나눠 센다.',
    verifyHow: ['`/metaverse` 도면 뷰어의 "추정 위치도 표시" 버튼', '`apps/api/src/modules/journey/journey.service.ts` `updatePatientLocation`', PLAN],
    afterDecision: 'HIDE_DEFAULT 외에는 화면 기본값 또는 여정 매핑 코드 변경이 남는다.',
    owner: '간호부 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'wayfinding.patientExposure',
    track: 'PRIVACY',
    title: '환자에게 원내 길안내(평면도·경로)를 어디까지 공개할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '공개 QR 대기표가 진료실까지의 경로와 층 평면도(방 이름·배치)를 보여준다. 인증 없이 열리는 화면이다. ' +
      '평면도에는 통제 구역(수술부·중환자실 등)의 이름과 위치도 그려진다 — 경로는 통제 구역을 지나지 않지만 배치는 보인다.',
    legalReview: ['시설 배치 공개 범위 — 원내 보안 규정(통제 구역 표시 여부)'],
    approvalPath: 'CODE_CHANGE',
    authority: '원무 책임자 · 보안 책임자',
    options: [
      { value: 'QR_GUIDE', label: 'QR 대기표에서 공개(현행) — 경로가 지나는 층만', effect: '대기표를 가진 사람은 누구나 경로 층의 방 이름·배치(통제 구역 포함)를 본다.', enact: null },
      { value: 'QR_GUIDE_MASK_RESTRICTED', label: 'QR 대기표 공개 · 통제 구역은 이름·배치를 가림', effect: '공개 응답에서 통제 구역을 빈 칸으로 바꾸는 개발이 남는다.', enact: null },
      { value: 'STAFF_ONLY', label: '환자에게 공개하지 않는다(직원 길찾기만)', effect: '길안내는 직원 화면에만 남긴다. 환자 대기표의 길안내 버튼을 뺀다.', enact: null },
    ],
    statusQuo: '`GET /api/v1/guide/:queueId/route` 는 무인증이며 대기표 검증(만료·존재) 뒤 경로가 지나는 층의 방 이름·사각형·통제 여부를 준다. 진료실이 공간에 연결돼야 경로가 나온다(운영 7/30 연결).',
    verifyHow: ['QR 대기표 `/guide/<접수id>` 의 "진료실까지 길 안내"', '`apps/api/src/modules/waiting-queue/waiting-queue.service.ts` `guideRoute`', PLAN],
    afterDecision: 'QR_GUIDE 외에는 공개 응답·화면 변경이 남는다.',
    owner: '원무팀 · 보안팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'space.i18nNames',
    track: 'I18N',
    title: '방·구역 이름을 다국어로 관리할 것인가',
    layer: 'STAFF',
    why: '외국인 환자에게 길안내를 하려면 방 이름이 그 언어로 나와야 한다. 방 이름은 기관 데이터라 화면 번역 카탈로그에 넣으면 기관 사실을 언어마다 복제하게 된다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '원무 · 국제진료 담당',
    options: [
      { value: 'KO_ONLY', label: '한국어만(현행)', effect: '다른 언어 화면·길안내에서도 방 이름은 한국어로 나온다.', enact: null },
      { value: 'SPACE_NODE_FIELD', label: '공간 모델에 언어별 이름 칸을 둔다', effect: '스키마·관리 화면 개발과 이름 입력 작업이 남는다.', enact: null },
      { value: 'CATALOG', label: '화면 번역 카탈로그에 넣는다', effect: '방이 바뀔 때마다 카탈로그 배포가 필요하다.', enact: null },
    ],
    statusQuo: '방 이름은 도면 가져오기(space-import.v1)와 `SpaceNode.name` 에 한국어로만 있다.',
    verifyHow: [PLAN],
    afterDecision: 'KO_ONLY 외에는 개발과 입력 작업이 남는다.',
    owner: '원무팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'location.retentionDays',
    track: 'PRIVACY',
    title: '환자 위치 기록(원내 동선)을 얼마나 보관할 것인가',
    layer: 'LICENSE_HOLDER',
    why:
      '위치 원장(`patient_locations`)은 환자가 언제 어느 구역에 있었는지를 남긴다. 지금은 **지우는 코드가 없다**. ' +
      '보관 기간은 개인정보 보유 원칙과 감염 역학조사 필요가 부딪히는 자리라 기관이 정해야 한다.',
    legalReview: ['위치정보의 보호 및 이용 등에 관한 법률 적용 여부 검토', '개인정보 보유기간 원내 규정 · 국가 보존 기간 결정(T10)과의 정합'],
    approvalPath: 'CODE_CHANGE',
    authority: '개인정보보호책임자 · 병원장',
    options: [
      { value: 'KEEP_ALL', label: '기한 없이 보관(현행)', effect: '환자별 원내 동선 기록이 기한 없이 쌓인다.', enact: null },
      { value: 'DAYS_FIXED', label: '정해진 일수가 지나면 파기', effect: '파기 작업(보존 기간 엔진 재사용)과 일수 결정이 남는다.', enact: null },
      { value: 'AGGREGATE_ONLY', label: '일정 기간 뒤 개인 식별을 지우고 구역별 집계만 남긴다', effect: '기한이 지난 위치는 층·구역별 인원 집계로만 남긴다. 익명화 작업 개발이 남는다.', enact: null },
    ],
    statusQuo: '`patient_locations` 를 지우거나 익명화하는 코드가 없다. QR 위치 동의(`PatientLocToken`)는 기록 여부만 가린다.',
    verifyHow: ['`apps/api/src` 에서 `patientLocation.delete` 를 찾는다 — 없다', PLAN],
    afterDecision: 'KEEP_ALL 외에는 파기·익명화 작업 개발이 남는다.',
    owner: '개인정보보호팀 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'infection.contactCandidates',
    track: 'CLINICAL',
    title: '위치 기록이 겹친 환자를 감염 접촉자 "후보"로 뽑아 보여줄 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '감염 환자와 같은 시간·같은 구역에 있던 환자를 위치 원장에서 찾을 수 있다. 그러나 해상도는 **구역 단위**라 같은 대기실이라도 거리는 모르고, ' +
      '대부분의 위치는 이벤트 추정이다. 후보를 확정으로 읽으면 과잉 격리·불안이, 안 쓰면 수작업 역학조사만 남는다.',
    legalReview: ['감염병 역학조사 목적의 위치 정보 이용 범위 — 원내 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '감염관리위원회',
    options: [
      { value: 'OFF', label: '쓰지 않는다(현행 — 설정 기본 꺼짐)', effect: '위치 겹침 조회를 만들지 않는다. 접촉자는 지금처럼 감염관리실이 직접 입력한다.', enact: null },
      { value: 'IC_OBSERVED_ONLY', label: '감염관리실만 · 관측 위치 겹침만 후보로', effect: '관리 화면에서 `infection.contactCandidates.enabled` 를 켠다. 관측 운영 전에는 후보가 거의 없다.', enact: null },
      { value: 'IC_WITH_INFERRED', label: '감염관리실만 · 추정 겹침도 별도 등급으로', effect: '후보가 늘지만 추정 등급을 확정으로 읽지 않게 교육이 필요하다.', enact: null },
    ],
    statusQuo: '후보 조회(감염관리 화면 · 관리자 전용 · `GET /api/v1/infection-control/contact-candidates`)는 있으나 설정 `infection.contactCandidates.enabled` 가 꺼져 있으면(기본) 조회하지 않는다. 추정 겹침은 두 번째 설정 `…includeInferred`(기본 꺼짐)가 켜져야 보인다. 확정은 기존 접촉자 등록(수동)으로만 이어진다.',
    verifyHow: ['시스템 설정에서 `infection.contactCandidates.enabled`·`infection.contactCandidates.includeInferred` 값을 본다', '`apps/api/src/modules/infection-control/contact-candidates.service.ts`', PLAN],
    afterDecision: 'OFF 외에는 `infection.contactCandidates.enabled` 를 켜고(추정 포함이면 `…includeInferred` 도) 사용 교육을 한다. 두 설정을 함께 바꾸므로 자동 집행을 걸지 않았다.',
    owner: '감염관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'space.assets.readRoles',
    track: 'SECURITY',
    title: '의료기기·장비 위치 조회를 임상 직군에게 열 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why: '간호사가 "인공호흡기가 어디 있나"를 찾으려면 위치 조회가 필요하다. 그러나 같은 원장에 등록 단말(PC) 목록이 있어 보안 자산 목록을 여는 셈이 된다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '정보보호책임자 · 간호부',
    options: [
      { value: 'ADMIN_ONLY', label: '관리자만(현행)', effect: '임상 직군은 장비 위치를 화면에서 찾을 수 없다(관리자에게 묻는다).', enact: null },
      { value: 'CLINICAL_DEVICES', label: '의료기기·장비만 임상 직군에 공개 · 단말·보관 장소는 관리자만', effect: '간호·의사가 의료기기 위치만 조회한다(단말 제외). 종류별 권한 분기 개발이 남는다.', enact: null },
    ],
    statusQuo: '`api/v1/space-assets` 전 EP 가 `@Roles(ADMIN)` 이다. 도면 뷰어의 자산 레이어도 관리자에게만 불러온다.',
    verifyHow: ['`apps/api/src/modules/space-asset/space-asset.controller.ts`', PLAN],
    afterDecision: 'ADMIN_ONLY 외에는 권한 분기 개발이 남는다.',
    owner: '전산팀 · 간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'space.assets.legacyText',
    track: 'PLATFORM',
    title: '장비·단말 테이블의 자유 텍스트 위치 칸을 어떻게 할 것인가',
    layer: 'STAFF',
    why:
      '공식 위치는 배치 원장(`asset_placements`)이 됐지만, 장비·검사장비·보관 장소 등 등록 폼에는 자유 텍스트 위치 칸이 남아 두 정본이 병행한다. ' +
      '등록 권한(행정직·약사 등)과 원장 쓰기 권한(관리자)이 달라 폼에서 바로 원장에 쓰게 할 수도 없다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '시설 책임자 · 전산 책임자',
    options: [
      { value: 'PARALLEL', label: '병행 유지 · 원장과 다르면 "텍스트 다름"으로 표시(현행)', effect: '위치가 두 곳에 적히고, 등록 폼의 텍스트는 원장과 어긋날 수 있다.', enact: null },
      { value: 'PICKER', label: '등록·수정 폼을 공간 선택기로 바꾸고 텍스트는 표시 캐시로', effect: '자유 텍스트 입력을 공간 선택기로 바꾼다. 폼별 개발과 권한 결정(D9)이 필요하다.', enact: null },
      { value: 'REMOVE', label: '자유 텍스트 칸을 없앤다', effect: '기존 텍스트는 원장 이관 뒤 폐기. 스키마 변경.', enact: null },
    ],
    statusQuo: '9개 자산 테이블에 `location` 텍스트가 남아 있다. 배치 원장은 덮어쓰지 않고 대조만 한다. 워크스테이션 관리 화면만 공식 위치를 함께 보여준다.',
    verifyHow: ['`/admin/space-assets` 종류별 현황의 "텍스트 다름"', PLAN],
    afterDecision: 'PARALLEL 외에는 폼·스키마 개발이 남는다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
    dependsOn: ['space.assets.readRoles'],
  },
  {
    key: 'space.assets.controlledSubstance',
    track: 'CLINICAL',
    title: '마약류 금고의 물리 위치를 공간 모델에 연결할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why: '마약류 재고의 보관 장소 값은 재고의 논리 키이고 법정 대장과 묶여 있다. 물리 위치를 연결하면 금고 위치가 배치 원장·도면 뷰어에 드러난다.',
    legalReview: ['마약류 관리 법정 대장과 보관 장소 표기의 일치 — 약제부 규정', '금고 위치 노출 범위 — 원내 보안 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '약제부장 · 보안 책임자',
    options: [
      { value: 'NO_LINK', label: '연결하지 않는다(현행)', effect: '금고 위치는 재고의 보관 장소 값(논리 키)으로만 남고 도면에 나타나지 않는다.', enact: null },
      { value: 'STORAGE_LINK', label: '금고를 보관 장소로 등록하고 배치 원장에 연결(관리자만 조회)', effect: '재고 논리 키와 보관 장소 매핑 개발이 남는다.', enact: null },
    ],
    statusQuo: '`controlled_substance_stocks` 는 배치 원장 제외 목록(`ASSET_KINDS_EXCLUDED`)에 사유와 함께 있다.',
    verifyHow: ['`packages/shared/src/space-asset.ts` `ASSET_KINDS_EXCLUDED`', PLAN],
    afterDecision: 'NO_LINK 외에는 매핑 개발이 남는다.',
    owner: '약제부 · 전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'space.floorApi.fallbackGeometry',
    track: 'PLATFORM',
    title: '층 API(외부 clinic 저장소가 소비)의 폴백 좌표를 없앨 것인가',
    layer: 'STAFF',
    why:
      '층 API 는 좌표가 없는 구역에 기본 상자(`{0,0,4,3}`)·구역 중심 문·직선 거리를 채워 준다 — 외부 계약 문서가 그 폴백을 약속한다. ' +
      '2026-09-28 부터 값은 두고 출처(`boundsSource`·`doorSource`·`distanceSource`)를 함께 싣는다. 폴백을 없애면(null) 계약이 바뀐다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '전산 책임자 · 외부 연동 담당',
    options: [
      { value: 'KEEP_WITH_SOURCE', label: '폴백 유지 · 출처 병기(현행)', effect: '외부 소비자가 출처 필드를 읽어야 지어낸 좌표를 가린다.', enact: null },
      { value: 'NULL_AFTER_NOTICE', label: '외부 점검 후 폴백 제거(null)', effect: '외부 clinic 저장소가 null 을 처리하도록 바뀌어야 한다.', enact: null },
    ],
    statusQuo: '`apps/api/src/modules/floor/floor.service.ts` `getZones`·`getTopology` 가 폴백 값과 출처 필드를 함께 준다. 계약 문서 `docs/05-reference/clinic-floor-his-api-response.md`.',
    verifyHow: ['`GET /api/floor/topology/2f` 의 `distanceSource`(운영: 전부 WALK_TIME_MIN)', PLAN],
    afterDecision: 'NULL_AFTER_NOTICE 는 외부 점검·외부 저장소 대응이 선행한다.',
    owner: '전산팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
];
