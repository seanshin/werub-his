/**
 * 결정 등록부 배치 2026-10-B (2026-10-01) — **문서에만 있던 사람 결정 6건**.
 *
 * 출처: `docs/04-report/ecosystem-notice-reply-2026-09-21.md`(H 절 "사람 결정으로 올리는 것"·"이번에 고치지 않은 것") ·
 *       `ecosystem-notice-reply-2026-09-21-H-appendix.md` H4·H6·X2 · `docs/05-reference/known-limitations.md` D24 ·
 *       커밋 `41d73038b`(전자결재 콜백 자동 재시도) · `1c26f7460`(카탈로그에 실리지 않는 검사 패널 18) ·
 *       `docs/01-plan/features/clinic-sso-token-redesign.plan.md` §5 D1·D3(D2·D4~D6 은 아직 미등재).
 * 여섯 항목 모두 문서에는 "사람 결정"으로 적혀 있었지만 등록부에 없었다 — 문서에 있는 동안엔 아무도 못 고른다.
 *
 * `statusQuo` 는 2026-10-01 코드를 다시 읽고 적었다(file:line). 🔴 운영 DB 건수(8건·18 패널)는 위 커밋 메시지의 운영 실측을
 * 옮긴 것이고 이 등재 작업에서 다시 재지 않았다(운영 접근 없음) — 그 사실을 verifyHow 에 함께 적는다.
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다. 어느 항목도 `enactKind` 를 갖지 않는다 —
 *    어느 쪽을 골라도 코드(또는 마스터 데이터) 작업이 남는다(CODE_CHANGE). 코드가 읽지 않는 설정 키를 지어내지 않았다.
 * 🔴 법령은 "적용 여부 검토"로만 적는다 — 조문은 조사하지 않았으므로 적지 않는다(판정 규칙 §7).
 */
import type { DecisionDef } from './decision.registry';

const JWT = '`apps/api/src/modules/auth/strategies/jwt.strategy.ts`';
const EAPPROVAL = '`apps/api/src/modules/clinic-integration/erp-eapproval.service.ts`';
const LIS = '`apps/api/src/modules/lis-reference/lis-reference.service.ts`';
const SSO_PLAN = '`docs/01-plan/features/clinic-sso-token-redesign.plan.md`';
const REPLY = '`docs/04-report/ecosystem-notice-reply-2026-09-21.md`';
const H_APPX = '`docs/04-report/ecosystem-notice-reply-2026-09-21-H-appendix.md`';

export const DECISION_BATCH_2026_10_B: DecisionDef[] = [
  {
    key: 'auth.staffIdleTimeout',
    track: 'SECURITY',
    title: '직원 로그인 유휴 만료(임상 30분·행정 60분)를 실제로 집행할 것인가 — 네이티브 직원 앱도 포함하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '유휴 만료는 설정·문서상 있으나 서버에서 사실상 작동하지 않는다. 유휴 키의 수명이 `ttl+60` 초라 판정은 30~31분 사이 60초 창에서만 걸리고, ' +
      '걸리면 키를 지워 다음 요청이 통과한다. 31분을 넘기면 키가 이미 사라져 그냥 통과한다(2026-09-28 재현 · 회신 H 절). ' +
      '고치면 지금껏 강제 로그아웃을 겪지 않은 모든 클라이언트에 유휴 로그아웃이 켜진다 — 특히 네이티브 직원 앱(access 15분·refresh 7일)은 ' +
      '현장 단말에서 다시 로그인해야 하는 빈도가 바뀐다. 끊는 방향은 사람 판단이다.',
    legalReview: ['개인정보 처리시스템 접속 관리(일정 시간 미사용 시 접속 차단 등) 요건의 적용 여부 검토 — 조문은 조사하지 않았다'],
    approvalPath: 'CODE_CHANGE',
    authority: '정보보호위원회 · 정보보호책임자(CISO)',
    options: [
      {
        value: 'ENFORCE_ALL',
        label: '모든 클라이언트에 집행한다(웹·네이티브 직원 앱)',
        effect: '역할별 30·60분 동안 요청이 없으면 다음 요청이 거부되고 다시 로그인해야 한다. 네이티브 앱도 같은 기준으로 끊긴다.',
        enact: null,
      },
      {
        value: 'ENFORCE_EXCEPT_NATIVE',
        label: '웹에만 집행하고 네이티브 직원 앱(IOS_NATIVE)은 제외한다',
        effect: '웹은 30·60분 유휴로 끊긴다. 네이티브 앱은 access 15분·refresh 7일·기기 바인딩으로만 관리되고 유휴 만료가 없다(그 차이를 문서에 밝혀야 한다).',
        enact: null,
      },
      {
        value: 'NOT_ENFORCED',
        label: '집행하지 않는다(현행 동작을 정책으로 인정)',
        effect: '유휴 로그아웃이 없다. 문서·화면의 "30·60분 유휴 만료" 표기를 철회해야 사실과 맞는다. 세션은 토큰 만료·로그아웃·폐기로만 끝난다.',
        enact: null,
      },
    ],
    statusQuo:
      '2026-10-12 사용자 지시로 ENFORCE_ALL 을 구현했다(v4.77.0) — 역할별 기준(ADMIN·CRM 60분, 그 밖 30분)을 웹·네이티브 직원 앱 모두에 집행: 유휴 키를 세션보다 오래(8일) 두고, ' +
      '기준을 넘기면 401 SESSION_IDLE_EXPIRED 와 함께 그 세션(refresh 포함)을 폐기한다 — 다시 로그인해야 한다. ' +
      '🔴 등록부 기록은 아직 개발 시드 형식이다 — 정보보호위원회가 실결정으로 기록해야 결정으로 센다. 실결정이 다르면 이 동작을 되돌린다(종전: 키 수명 기준+60초·판정 키 삭제로 사실상 무동작).',
    verifyHow: [
      JWT + ':31-33 idleSeconds · :95-111 유휴 키 get/set(EX ttl+60)/del',
      '`apps/api/src/modules/auth/mobile/mobile-auth.service.ts:11-12` 네이티브 직원 access 15분·refresh 7일',
      '`docs/05-reference/known-limitations.md` D24 · `docs/01-plan/features/staff-sso-passwordless.plan.md` FR-19("dead code") · `security-governance-master.plan.md` G7 정정',
      REPLY + ' H 절 "이번에 고치지 않은 것" · ' + H_APPX + ' X2',
    ],
    afterDecision:
      'NOT_ENFORCED 외에는 유휴 판정 수정(키 수명·판정 후 처리)과 갱신(refresh) 경로가 유휴를 어떻게 볼지 정하는 개발이 남는다 — `idle:` 키는 jwt.strategy.ts 한 곳에서만 다룬다. ' +
      'NOT_ENFORCED 면 known-limitations D24·보안 기획 G7 표기 정정이 남는다.',
    owner: '정보보호팀 · 전산팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'imaging.radiologistIdentity',
    track: 'CLINICAL',
    title: '영상 판독의는 누구(어느 원천)로 기록하는가 — `ImagingResult.radiologistId` 를 직원 계정 외래키로 묶을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '판독 기록의 판독의 칸(`radiologist_id`)은 UUID 형식이지만 외래키(relation·FK 제약)가 없다. 직원 계정이 아닌 값이 들어와도 DB 가 막지 않는다. ' +
      '연동 상대(PACS)는 이 칸을 "HIS 직원 UUID 외래키"로 이해하고 있었다(회신 H 절 #13-3 — 부분 오판). ' +
      '판독의 원천을 HIS 직원 계정으로 할지, PACS 가 가진 판독의 식별(표시명)로 둘지가 정해지지 않아 FK 를 걸 근거도 없다. ' +
      '관련된 별도 사안 — HIS 프록시가 ADMIN 에게 판독 서명을 열어 둔 것(pacs-proxy.controller.ts:207-209)과 RADIOLOGIST 역할 부재(회신 H4) — 는 권한 정책 축이라 이 항목에 섞지 않았다(등록부 미등재로 남는다).',
    legalReview: ['판독 기록 작성자(서명자) 표시 요건의 적용 여부 — 의무기록 작성자 식별 관점에서 검토(조문 미조사)'],
    approvalPath: 'CODE_CHANGE',
    authority: '진료부(영상의학과) · 의무기록위원회',
    options: [
      {
        value: 'HIS_USER_FK',
        label: '판독의 = HIS 직원 계정 — `radiologistId` 에 직원 외래키를 건다',
        effect: '없는 계정 UUID 는 저장 단계에서 거부된다. 스키마 변경이고, 걸기 전에 기존 값 중 직원 계정에 없는 행을 세어 처리 방침을 정해야 한다. PACS 판독의는 HIS 계정과 짝이 있어야 기록된다.',
        enact: null,
      },
      {
        value: 'PACS_NAME_ONLY',
        label: '판독의 = PACS 가 소유 — HIS 는 표시명(`radiologistName`)만 보존하고 `radiologistId` 는 원내 판독 경로에서만 채운다',
        effect: '외부에서 온 판독은 이름만 남고 HIS 계정과 연결되지 않는다(이름→계정 추측 매핑은 하지 않는다). 판독의별 집계·권한 확인은 원내 판독분에만 가능하다.',
        enact: null,
      },
      {
        value: 'KEEP',
        label: '현행 유지 — 외래키 없이 둔다',
        effect: '존재하는 직원 UUID 면 판독의가 아닌 사람이어도 그대로 저장된다. 다른 시스템이 DB 에 직접 쓰는 경로가 있으면 없는 UUID 도 막히지 않는다.',
        enact: null,
      },
    ],
    statusQuo:
      '`schema.prisma` `ImagingResult.radiologistId String? @db.Uuid` 에 relation 없음(baseline 마이그레이션에도 FK 없음 · H 부록 13-3). ' +
      '원내 경로 두 곳: 워크스테이션 판독은 로그인 사용자로 고정(workstation.service.ts:1018), `/imaging/:orderId/report` 는 DOCTOR 만 부르지만 본문의 `radiologistId`(선택·UUID 형식만 검사 · imaging-result.dto.ts:90-93)를 그대로 저장한다(imaging.service.ts:216). ' +
      '이 경로는 같은 값을 `Order.completedById`(직원 외래키 있음)에도 쓰므로(imaging.service.ts:208) 없는 UUID 는 거기서 트랜잭션째 실패할 것으로 읽힌다(코드 읽기 · 실행 미확인). PACS 웹훅은 이름만 보존한다(pacs-webhook.controller.ts:114). 감시자 정합성 스캔에 imaging_results 판독의 불변식은 없다.',
    verifyHow: [
      '`apps/api/prisma/schema.prisma` model ImagingResult `radiologistId`',
      '`apps/api/src/modules/imaging/imaging.service.ts:178-220` · `imaging/dto/imaging-result.dto.ts:90-93` · `workstation/workstation.service.ts:1005-1020`',
      '`apps/api/src/modules/pacs-proxy/pacs-webhook.controller.ts:114` · `pacs-proxy.controller.ts:207-209`(ADMIN 판독 서명 — 별도 사안)',
      REPLY + ' "오판 1건" #13-3 · ' + H_APPX + ' 13-3·H4·H6',
      '🔴 운영 행 중 직원 계정에 없는 radiologist_id 수는 이 등재에서 재지 않았다(미확인)',
    ],
    afterDecision:
      'HIS_USER_FK 면 기존 값 대사 → 스키마 변경(FK) → 운영 적용(수동 SQL 미리보기)이 남는다. PACS_NAME_ONLY 면 본문 `radiologistId` 수신 경로를 인증 사용자로 고정하거나 닫는 개발이 남는다. ' +
      'ADMIN 판독 서명·RADIOLOGIST 역할은 어느 쪽이든 별도로 정해야 한다.',
    owner: '영상의학과 · 의무기록팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'integration.eapprovalUndeliveredBacklog',
    track: 'NOTIFY',
    title: '2026-10-01 이전에 ERP 로 전달되지 못한 전자결재 승인 결과(운영 8건)를 어떻게 처리할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '전자결재 결과 콜백이 즉시 3회 실패하면 종전엔 아무도 다시 보내지 않았다. 2026-10-01 부터는 실패분을 연동 아웃박스가 자동 재시도하지만, ' +
      '그 이전에 실패한 건은 일부러 자동 적재하지 않았다 — 오래된 결재 결과를 ERP 가 지금 받으면 이미 다른 경로로 처리했을 수 있다(중복 반영). ' +
      '보낼지·버릴지·사람이 확인했다고 적을지는 코드가 정할 수 없다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '의료정보위원회 · ERP 연동 담당(인사·총무)',
    options: [
      {
        value: 'RESEND_ALL_ONCE',
        label: '전부 한 번 다시 보낸다(관리자 1회 실행)',
        effect: '8건이 아웃박스에 적재돼 지금 결과 그대로·미전달일 때만 나간다(발송 직전 확인). ERP 가 이미 처리한 건이면 중복 수신이 된다. 1회 실행 경로는 지금 없다(개발 필요).',
        enact: null,
      },
      {
        value: 'WAIT_CLINIC_RESEND',
        label: '그대로 두고 Clinic 재전송을 기다린다',
        effect: 'Clinic 이 같은 결과를 다시 보내면 미전달 건은 재전달된다. 다시 보내지 않으면 ERP 는 결과를 받지 못한 채로 남는다.',
        enact: null,
      },
      {
        value: 'MARK_HANDLED_MANUALLY',
        label: 'ERP 담당자가 수기로 확인·반영하고, HIS 에는 "수동 처리"로 남긴다',
        effect: '자동 발송은 없다. "전달됨"으로 적지 않고 수동 처리 사실을 따로 남겨야 한다(지금 그 기록 칸이 없다 — 개발 필요).',
        enact: null,
      },
    ],
    statusQuo:
      '즉시 전달 3회 실패분은 `enqueueDirect` 로 아웃박스에 적재된다(erp-eapproval.service.ts:297 · 2026-10-01 이후 실패분만). 적재 전 실패분은 `callbackDelivered=false` 로 남고, ' +
      '같은 결과가 Clinic 에서 다시 오면 재전달된다(:218-223). 과거분을 골라 적재하는 화면·EP 는 없다(`enqueueDirect` 호출부 1곳). 개발·리허설 모드에서는 아웃박스 발송이 보류된다(integration-outbox.service.ts:307-324).',
    verifyHow: [
      EAPPROVAL + ':205-236 재수신 재전달 · :261-305 즉시 3회·아웃박스 적재 · :52-64 발송 직전 확인·발송 후 표시',
      '`apps/api/src/modules/clinic-integration/eapproval-callback.ts` 콜백 계약(본문·X-Signature·허용 호스트)',
      '운영 `e_approval_relays` 에서 result=APPROVED·callback_delivered=false 건수 — 커밋 `41d73038b` 메시지의 운영 실측 8건(🔴 이 등재에서 재측정하지 않았다 · 시험 결재인지 실결재인지 미확인)',
    ],
    afterDecision:
      'RESEND_ALL_ONCE 는 대상 지정 1회 적재 경로(관리자 실행·감사 기록), MARK_HANDLED_MANUALLY 는 수동 처리 기록 칸이 필요하다. WAIT_CLINIC_RESEND 는 Clinic 팀에 재전송 요청이 남는다.',
    owner: '전산팀 · 인사총무팀',
    dueBy: 'NONE',
    goLive: 'NOT_RELATED',
  },
  {
    key: 'lis.panelEdiMapping',
    track: 'MASTER',
    title: 'LIS 카탈로그에 실리지 않는 검사 패널 18개의 EDI 코드를 어떻게 바로잡을 것인가(코드 마스터 검수)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '결과 항목(lab_test_codes)이 붙은 패널 25 중 18 이 LIS 검사코드 카탈로그(전체 동기화 포함)로 나가지 않는다. 11 개는 처방 코드 행이 아예 없고' +
      '(D6591~D6596·E6712·E6721·E6731·E6741·E6771), 7 개는 실제 수가 마스터에서 다른 행위의 코드다(E6541=심전도검사에 CBC 결과 항목이 붙음 · E6551·E6561·E6571·E6581·E6751·E6761). ' +
      '시드가 만든 EDI 코드가 06-10 수가 마스터 반입으로 실코드에 덮인 것으로 보인다(커밋 1c26f7460). ' +
      '카탈로그 범위를 "결과 항목이 붙은 코드"로 넓히면 LIS 가 "심전도검사 = CBC 패널"을 받게 되므로 넓히지 않았다 — 올바른 매핑은 코드 마스터 검수(사람)다. ' +
      '마스터의 공식 원천은 별도 결정 `legal.master.dataSources` 가 다룬다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '진단검사의학과 · 보험심사 · 의무기록위원회(코드 마스터)',
    options: [
      {
        value: 'REMAP_AFTER_REVIEW',
        label: '코드 마스터 검수 후 올바른 EDI 코드로 다시 연결한다',
        effect: '검수자가 18 패널마다 실제 검사 수가 코드를 정해 결과 항목의 EDI 코드를 바꾼다. 카탈로그에 실리고 감시자 86 이 줄어든다. 같은 코드를 쓰는 시드(seed.ts — E6541 을 CBC 로 만든 행·오더·청구 라인)도 함께 고쳐야 다음 시드에서 되살아나지 않는다.',
        enact: null,
      },
      {
        value: 'DEACTIVATE_SEED_ITEMS',
        label: '해당 시드 결과 항목을 비활성화한다',
        effect: '18 패널의 결과 항목이 결과 입력·카탈로그 대상에서 빠진다. 그 패널을 쓰던 데모 흐름(시드 오더의 결과 입력)이 비게 된다. 실검사 패널 구성은 개시 전 마스터 반입 때 따로 채워야 한다.',
        enact: null,
      },
      {
        value: 'KEEP_DISCLOSED',
        label: '현행 유지 — 실리지 않는다고 밝히고 센다',
        effect: '카탈로그 응답이 `panelsOutOfCatalog` 로 18 개를 밝히고 감시자 86 이 계속 센다. LIS 는 이 패널의 결과 항목을 받지 못한다.',
        enact: null,
      },
    ],
    statusQuo:
      `카탈로그는 검사 범위(labScope — B/C/D 접두·검사 분류·LOINC · lis-reference.service.ts:95) 안 처방 코드만 싣고, 결과 항목이 있으나 실리지 않는 패널을 ` +
      '`panelsOutOfCatalog { missingProcedureCode, outOfScope }` 로 응답에 밝힌다(:143-164·:207). 감시자 정합성 불변식 86 이 같은 규칙으로 센다(infra/scripts/data-integrity-scan.sql:135-144 · 운영 첫 측정 18). 자동 교정 없음. ' +
      '해당 결과 항목은 시드가 만든다(prisma/seed.ts:8444-8487 — 예: L0001~L0005 edi E6541 · upsert update:{} 라 재시드가 DB 수정을 덮지 않는다).',
    verifyHow: [
      LIS + ':95-110 labScope · :143-164 panelsOutOfCatalog',
      '`infra/scripts/data-integrity-scan.sql` 불변식 86 · `/admin/sentinel`',
      '`apps/api/prisma/seed.ts:736`(E6541 을 CBC 처방 코드로 생성) · `:8444-8487`(결과 항목 edi)',
      '커밋 `1c26f7460` 메시지의 운영 실측(25 패널 중 18 · 🔴 이 등재에서 재측정하지 않았다)',
    ],
    afterDecision:
      'REMAP_AFTER_REVIEW 는 검수 결과에 따른 마스터 데이터 수정과 시드 생성기 수정이, DEACTIVATE_SEED_ITEMS 는 비활성화 실행(운영 데이터)과 시드 반영이 남는다. KEEP_DISCLOSED 는 남는 작업이 없지만 LIS 연동 개시 전에 다시 보아야 한다.',
    owner: '진단검사의학과 · 보험심사팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'integration.clinicSsoRedesign',
    track: 'SECURITY',
    title: 'Clinic → HIS SSO 로그인 토큰을 어떻게 다시 설계할 것인가(현행 완화 / HIS 단독 정본 세션 / 1회용 코드 계약 / 표준 OIDC)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      'Clinic SSO 로 들어온 직원에게 HIS 가 발급하는 토큰은 정본 로그인 세션과 다르다 — `aud`·`sid`·`jti` 가 없어 HIS 로그아웃으로 끊을 수 없고, ' +
      '7일짜리 "refresh" 토큰이 메인 비밀키로 서명돼 메인 API Bearer 로 7일간 통과한다. 웹 `/sso` 페이지는 URL 의 `accessToken` 을 출처와 무관하게 세션으로 넣어 ' +
      '다른 사람 토큰으로 로그인되는 고정(fixation)이 가능하고, SSO 로그인은 감사(AuditLog)에 남지 않는다. ' +
      '옵션 2·3 은 Clinic 쪽 변경이 필요해 HIS 혼자 정할 수 없다. 실제로 Clinic 이 어느 진입점을 쓰는지·운영에서 이 경로가 쓰이는지는 미확인이다(기획서 §6 질문 10건).',
    legalReview: ['접속기록 보관 요건의 적용 여부 — SSO 로그인이 감사에 남지 않는 공백(조문 미조사)'],
    approvalPath: 'CODE_CHANGE',
    authority: '원내 정보보호 책임 주체(구체 직책·위원회는 원내 지정) · 옵션 2·3 은 Clinic 운영 주체 합의 필요',
    options: [
      {
        value: 'OPT0_MITIGATE',
        label: '옵션 0 — 현행 유지 + 완화(URL 에서 토큰 지움·로그의 토큰 앞 8자 제거·검증 EP 스로틀)',
        effect: 'Clinic 변경 없음·깨지는 것 없음. 로그아웃으로 끊을 수 없음·7일 Bearer·로그인 고정·감사 공백·세션 정책 우회는 그대로 남는다. 이미 엣지 로그에 남은 URL 은 지우지 못한다.',
        enact: null,
      },
      {
        value: 'OPT1_HIS_CANON_SESSION',
        label: '옵션 1 — HIS 단독: SSO 발급을 정본 세션(aud·sid·감사)으로, HIS 토큰은 URL 밖으로',
        effect: 'HIS 로그아웃이 그 기기 SSO 세션을 즉시 끊고, 원내 세션 시간·동시 세션 상한·LOGIN 감사가 SSO 에도 적용된다. `?accessToken=` 으로 들어오는 클라이언트가 있으면 그 로그인이 끊긴다(있는지 미확인 — Clinic 확인 1건). Clinic 로그아웃은 여전히 HIS 에 닿지 않는다.',
        enact: null,
      },
      {
        value: 'OPT2_ONE_TIME_CODE',
        label: '옵션 2 — 옵션 1 + Clinic 토큰을 1회용 코드로 계약(대상 결합·선택적 state 왕복)',
        effect: '엣지 로그에 남은 Clinic 코드가 재사용되지 않는다(Clinic 이 1회 소비를 보장할 때만). Clinic 구현·배포가 선행돼야 하고, HIS 가 계약 필드를 강제하는 시점이 Clinic 배포보다 앞서면 그 로그인이 실패한다. state 를 쓰면 Clinic 화면에서 바로 여는 동선이 HIS 를 한 번 거친다.',
        enact: null,
      },
      {
        value: 'OPT3_OIDC',
        label: '옵션 3 — 표준 OIDC(Clinic = IdP · 인가 코드 + PKCE · 백채널 로그아웃)',
        effect: 'Clinic 로그아웃이 HIS 세션을 끊을 수 있다(Clinic 이 백채널을 보낼 때). 양쪽 구현량이 가장 크고(규모 미산정) 호환 기간이 가장 길다. 서명 키 회전·시계 오차 같은 운영 의존이 생긴다.',
        enact: null,
      },
    ],
    statusQuo:
      '`sso.controller.ts:107-111` 이 `{sub,email,role}` 만 담아 메인 `AUTH_SECRET` 으로 access(8h)와 7일 토큰을 서명한다(aud·sid·jti 없음 · Redis `refresh:<userId>` :114-119). ' +
      'API 랜딩은 `{FRONTEND_URL}/sso?accessToken=…` 로 리다이렉트한다(:133-135). 웹 `apps/web/src/app/sso/page.tsx:24-32` 는 URL 의 `accessToken` 이 있으면 그대로 세션을 완성한다. ' +
      '메인 API 는 무aud 토큰을 레거시 호환으로 통과시키고(jwt.strategy.ts:26-28 주석 "clinic SSO refresh·SMART 등은 이 단계에선 통과"), 세션 폐기 검사는 `sid` 가 있을 때만 한다(:77-90).',
    verifyHow: [
      '`apps/api/src/modules/clinic-integration/sso.controller.ts:104-135`(경로 A) · `:152-195`(경로 B `/sso/verify`)',
      '`apps/web/src/app/sso/page.tsx:24-32` Case 1 · `apps/api/src/modules/auth/strategies/jwt.strategy.ts:26-28·:77-90`',
      SSO_PLAN + ' §1 현행 실측 · §2 위험 W1~W7 · §4 선택지 · §6 Clinic 팀 질문',
      REPLY + ' H 절 "이번에 고치지 않은 것" · ' + H_APPX + ' B2(#47-3)',
    ],
    afterDecision:
      '어느 옵션이든 개발이 남는다(옵션 0 도 페이지·로그·스로틀 수정). 옵션 1~3 은 운영 반영 전 Clinic 팀 회신(Q1·Q2)이 선행 — 회신 없이 경로를 걷으면 일방 폐기가 된다. ' +
      '이미 발급된 무sid 토큰 처리는 별도 결정 `integration.clinicSsoLegacyTokenCutoff`. 경로 A 처리·세션 정책 적용·로그아웃 전파·호환 기간(기획서 D2·D4~D6)은 아직 등록부에 없다.',
    owner: '정보보호팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'integration.clinicSsoLegacyTokenCutoff',
    track: 'SECURITY',
    title: '이미 발급된 sid 없는 Clinic SSO 토큰(최대 7일)을 어떻게 끊을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      'SSO 발급을 고쳐도 이미 나간 토큰(access 8h·7일 토큰)은 `sid`·`aud` 가 없어 로그아웃·세션 폐기로 끊을 수 없다. ' +
      '끊는 수단마다 다른 것까지 함께 끊긴다 — 무aud 전면 거부는 SMART 등 다른 무aud 토큰도, 비밀키 교체는 전 직원 세션을 끊는다. 자동으로 끊는 방향은 사람 판단이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '원내 정보보호 책임 주체(구체 직책·위원회는 원내 지정)',
    options: [
      {
        value: 'A_WAIT_EXPIRY',
        label: '(a) 자연 만료까지 기다린다',
        effect: '추가 작업이 없다. 마지막 무sid 발급 뒤 최대 7일 동안 그 토큰이 메인 API 를 통과한다(계정 비활성화로만 막힌다).',
        enact: null,
      },
      {
        value: 'B_REJECT_AUDLESS',
        label: '(b) 무aud 토큰을 메인 API 에서 전면 거부한다(strict 플립)',
        effect: '구 SSO 토큰이 즉시 끊긴다. SMART 등 aud 없이 발급되는 다른 내부 토큰도 함께 끊긴다 — 그 영향 범위는 미확인이라 먼저 세어야 한다.',
        enact: null,
      },
      {
        value: 'C_ISSUED_AT_CUTOFF',
        label: '(c) "발급 시각이 T 이전인 sid 없는 토큰 거부" 규칙을 새로 둔다',
        effect: '구 SSO 토큰을 겨눠 끊을 수 있다. 정본 로그인으로 받은 레거시(sid 없는) 토큰도 같은 조건에 걸릴 수 있다. 규칙과 기준 시각 T 를 설정·배포해야 한다.',
        enact: null,
      },
      {
        value: 'D_ROTATE_SECRET',
        label: '(d) 메인 서명 키 AUTH_SECRET 을 교체한다',
        effect: '구 토큰 전부가 즉시 무효가 된다 — 전 직원이 일괄 로그아웃된다. 같은 키를 쓰는 다른 토큰(ERP SSO 핸드오프 등)도 함께 바뀐다.',
        enact: null,
      },
    ],
    statusQuo:
      '무aud 토큰은 메인 API 를 통과하고(jwt.strategy.ts:26-28 · aud 가 있으면 his 만 허용 :51-53), `sid` 가 없으면 세션 폐기 검사를 건너뛴다(:77-90). ' +
      '그래서 SSO 로 발급된 토큰은 만료(8h·7일) 또는 계정 비활성(:61-63) 전까지 유효하다. 발급 시각 기준 거부 규칙은 없다.',
    verifyHow: [
      '`apps/api/src/modules/auth/strategies/jwt.strategy.ts:26-28·:51-53·:61-63·:77-90`',
      '`apps/api/src/modules/clinic-integration/sso.controller.ts:107-111` 7일 토큰 서명',
      SSO_PLAN + ' §5 D3 · §1.3 로그아웃·폐기가 닿는가',
      '🔴 무aud 로 발급되는 다른 토큰(SMART 등)의 목록·운영 사용량은 이 등재에서 세지 않았다(미확인)',
    ],
    afterDecision:
      '(a) 외에는 개발(거부 규칙) 또는 운영 작업(키 교체 — 재배포·전 직원 재로그인 공지)이 남는다. (b) 는 먼저 무aud 토큰 발급처를 전수해야 한다. ' +
      '어느 쪽이든 `integration.clinicSsoRedesign` 으로 새 발급이 sid 를 갖게 된 뒤에야 끝이 정해진다.',
    owner: '정보보호팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
