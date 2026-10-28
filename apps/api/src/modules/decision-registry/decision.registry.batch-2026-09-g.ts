/**
 * 결정 등록부 배치 G (2026-09-27) — **음성·대화(스크라이브) 축**에서 코드로 닫을 수 없는 5건.
 *
 * 출처: `docs/01-plan/features/voice-emr-ambient-conversation.plan.md` §13.6 표. 그 표는 **정본이 아니다** —
 *      "문서에 있는 동안엔 아무도 못 고른다"라서 여기 키를 만들고 표가 이 키들을 가리키게 했다.
 *      같은 문서의 D1·D2·D5·D6·D7·D8 은 코드로 닫았고(배포됨), D3·D9 는 2026-09-27 에 닫았다.
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다(판정 규칙 6장).
 *    어느 항목도 `enactKind` 를 갖지 않고 모든 선택지의 `enact` 는 `null` 이다 — 기록이 시스템을 자동으로 바꾸지 않는다.
 * 🔴 `statusQuo` 는 등재 시점(2026-09-27 · main `025b34e7d` 이후)에 **코드를 다시 읽고** 적었다.
 *    기획서 §13.6 초안이 적은 문장을 옮기지 않았다 — D3·D9 를 닫으면서 사실이 달라진 자리가 있다.
 * 🔴 법령 조문·수수료·기한은 적지 않는다(검토 항목 이름만).
 */
import type { DecisionDef } from './decision.registry';

export const DECISION_BATCH_2026_09_G: DecisionDef[] = [
  {
    key: 'policy.voice.readOpen',
    track: 'CLINICAL',
    title: '음성 조회(T0)를 실제로 열 것인가 — 지금은 명령만 인식하고 결과를 표시하지 않는다',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '음성 명령 파서는 "최근 검사 보여줘" 를 `read` 로 판정하지만, 그 결과를 띄우는 화면 배선이 없다. ' +
      '조회를 여는 것은 **음성 한마디로 환자 임상정보가 화면에 뜨는 것**이라(주변에 다른 환자·가족이 있을 수 있다) ' +
      '기능 편의가 아니라 열람 경계의 문제다. 열지 않기로 정하는 것도 유효한 결정이다.',
    legalReview: [
      '진료 중 음성 응답·화면 표시로 인한 제3자 청취·열람 가능성(진료실 환경)',
      '음성 열람의 감사 기록 범위 — 무엇을 열람했다고 기록해야 하는가',
    ],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회 · 개인정보보호책임자',
    options: [
      {
        value: 'OPEN',
        label: '연다 — 해당 탭 전환·검색 프리필로 결과를 보여준다',
        effect: '조회 명령이 화면을 실제로 바꾼다(처방 초안 `onOrderDraft` 와 같은 패턴). 열람 감사 배선이 함께 필요하다.',
        enact: null,
      },
      {
        value: 'KEEP_CLOSED',
        label: '닫아 둔다 — 안내 문구만 사실대로(현행)',
        effect: '조회 명령은 인식만 되고 결과는 표시되지 않는다. 화면이 그 사실을 말한다.',
        enact: null,
      },
    ],
    statusQuo:
      '`apps/api/src/modules/voice-emr/orchestrator.ts` 가 `kind:\'read\'` 를 돌려주고, ' +
      '`apps/web/src/components/voice-emr/VoiceEmrLauncher.tsx` 는 그것을 받아 **토스트만** 띄운 뒤 `return` 한다(화면 변화 없음). ' +
      '🔴 2026-09-27 까지는 그 토스트가 `조회: <대상>` 이었고 허브 안내는 예시로 "최근 검사 보여줘"(조회) 를 들며 "현재 조회 중심" 이라 ' +
      '말해, 되지 않는 것을 되는 것처럼 안내했다. 같은 날 문구를 사실대로 고쳤다(모드 이름도 "조회 명령 인식"). 기능은 그대로 닫혀 있다.',
    opens: ['조회 결과 표시 배선(탭 전환·검색 프리필)', '음성 열람의 감사 기록 규약'],
    verifyHow: [
      '진료 화면에서 음성 허브를 열고 "최근 검사 보여줘" 라고 말한다 — 토스트만 뜨고 화면이 바뀌지 않는다',
      '`VoiceEmrLauncher.tsx` 의 `o.kind === \'read\'` 분기를 읽는다 — 토스트 후 `return` 뿐이다',
    ],
    afterDecision: '열기로 하면 표시 배선·열람 감사 개발이 남는다(기록만으로 열리지 않는다).',
    owner: '임상정보팀 · 의무기록팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.voice.dictateWriteScope',
    track: 'CLINICAL',
    title: '구술(음성 받아쓰기)이 쓸 수 있는 기록 칸을 어디까지로 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '구술은 지금 S·O·A·P **네 칸 모두**에 덧붙일 수 있다. A(평가)는 임상 판단이라 ' +
      '"말한 대로 들어간 문장"이 판단으로 읽힐 수 있고, 규칙 엔진은 A 를 제안하지 않도록 일부러 막아 두었다 — ' +
      '즉 자동 제안은 A 를 피하는데 사람의 구술은 A 에 바로 들어간다. 그 비대칭을 원내에서 정할 일이다.',
    legalReview: ['의무기록 작성 주체·기재 책임(구술 원문이 그대로 기록에 남는 경우)'],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회',
    options: [
      { value: 'S_ONLY', label: 'S(주관)만', effect: '구술 반영 대상이 S 하나로 줄어든다.', enact: null },
      { value: 'S_O_P', label: 'S·O·P — A(평가)는 제외', effect: '평가는 손으로만 쓴다(자동 제안 규칙과 같은 경계).', enact: null },
      { value: 'ALL_FIELDS', label: '전 칸(A 포함·현행)', effect: '지금과 같다. A 에 들어간 구술도 "(제안)" 표기 강제를 함께 정해야 한다.', enact: null },
    ],
    statusQuo:
      '`apps/web/src/components/voice-emr/VoiceConfirmCard.tsx` `DICTATE_FIELDS` = S·O·A·P 네 칸. ' +
      '초기값은 **미선택**이고 필드를 고르지 않으면 확정 버튼이 막힌다(2026-09-22 봉합). 반영은 덧붙이기이며 덮어쓰지 않는다. ' +
      '규칙 제안 쪽은 `ambient-soap.ts` 가 A 를 만들지 않는다.',
    opens: ['구술 대상 칸 제한(FE 선택지 축소)', 'A 반영 시 "(제안)" 접두 강제 여부'],
    verifyHow: ['진료 화면에서 구술 확인 카드를 띄운다 — 라디오 네 개(S·O·A·P)가 보인다'],
    afterDecision: '제한을 택하면 확인 카드 선택지를 줄이는 개발이 남는다.',
    owner: '임상정보팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.voice.guardianSpeech',
    track: 'CLINICAL',
    title: '보호자·제3자 발화(화자 UNKNOWN)를 대화 분석에 포함할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '화자 판정은 DOCTOR·PATIENT·UNKNOWN 세 갈래이고 추정이다. 분석은 **환자 발화만** 수치·계획에서 빼는데, ' +
      '보호자·실습생·다른 직원의 말은 대개 UNKNOWN 으로 찍혀 **의료진 발화와 같이 취급된다** — 보호자가 말한 혈압 숫자가 ' +
      'O(객관)에 들어갈 수 있다. 화자 추정은 안전 판정의 근거가 못 되므로 코드가 혼자 정할 문제가 아니다.',
    legalReview: ['동의 범위 — 녹음·분석 대상에 동반자 발화가 포함되는지', '제3자 발화 기록 시 그 제3자의 개인정보 취급'],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회 · 개인정보보호책임자',
    options: [
      { value: 'EXCLUDE_UNKNOWN', label: 'UNKNOWN 은 수치·계획에서 제외', effect: '환자 발화와 같은 규칙으로 뺀다(제안이 줄고 누락 사유가 남는다).', enact: null },
      { value: 'INCLUDE', label: '포함(현행)', effect: '지금과 같다. 보호자 발화의 수치가 제안에 들어갈 수 있다.', enact: null },
      { value: 'CONSENT_SCOPED', label: '동의 범위에 명시한 경우만 포함', effect: '동의 문안 개정이 선행된다.', enact: null },
    ],
    statusQuo:
      '`apps/api/src/modules/scribe/ambient-soap.ts:171` `const isPatient = u.speaker === \'PATIENT\'` — ' +
      'UNKNOWN 은 `isPatient=false` 라 활력·약물·계획 제안에서 **빠지지 않는다**(제외 사유 `PATIENT_SPEAKER` 는 PATIENT 에만 붙는다). ' +
      '화자 라벨은 추정이고 사람이 탭으로 정정할 수 있다.',
    opens: ['UNKNOWN 제외 규칙', '동의 문안에 동반자 발화 명시'],
    verifyHow: ['`ambient-soap.ts` 에서 `isPatient` 를 검색한다 — 세 자리 전부 `PATIENT` 만 막는다'],
    afterDecision: '제외를 택하면 분석 규칙과 누락 사유 어휘를 고치는 개발이 남는다.',
    owner: '임상정보팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.scribe.transcriptRetentionDays',
    track: 'PRIVACY',
    title: '대화 전사(transcript) 보존 기간과 기산점을 무엇으로 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '보존 엔진에 전사 파기 핸들러가 있고 기본값 90일이 설정에 들어 있지만, **기본값은 정책이 아니다.** ' +
      '자동 파기는 전부 닫혀 있어서 지금은 아무것도 지워지지 않는다 — 즉 미결의 실제 효과는 "무기한 보존" 이다. ' +
      '진료기록 보존기간과 같게 둘 것인지, 반영 후 즉시 파기할 것인지는 법무 검토가 선행된다.',
    legalReview: [
      '진료기록 보존 의무 기간과 전사 텍스트가 그 범위에 드는지',
      '민감정보(음성 유래 텍스트) 파기 의무와 보존 근거',
    ],
    approvalPath: 'COMMITTEE',
    authority: '의무기록위원회 · 개인정보보호책임자(법무 선행)',
    options: [
      { value: 'DAYS_90', label: '90일(현 설정 기본값)', effect: '설정 기본값을 정책으로 확정한다.', enact: null },
      { value: 'SAME_AS_RECORD', label: '진료기록 보존기간과 동일', effect: '전사를 기록의 일부로 본다(파기 대상에서 사실상 빠진다).', enact: null },
      { value: 'PURGE_AFTER_APPLY', label: '반영 후 즉시 파기', effect: '초안이 기록에 들어간 뒤 전사를 남기지 않는다(근거 역추적이 끊긴다).', enact: null },
    ],
    statusQuo:
      '`retention.service.ts` 에 `SCRIBE_TRANSCRIPT` 핸들러가 있고 `scribe.transcript.retention` 기본값은 90(일)이다. ' +
      '실행은 3중으로 닫혀 있다 — 전역 `retention.purgeEnabled=false` 면 DRY-RUN 만 되고(`retention.service.ts:453`), ' +
      '정책 행이 REPORT_ONLY·법무 미확정이면 거부되며, **설정 출처가 default/unset 이면 거부**한다(기본값을 정책으로 쓰지 않는다). ' +
      '🔴 그래서 지금 실제로 지워지는 전사는 없다.',
    opens: ['자동 파기 활성(사람 승인)', '보존 정책 행의 법적 근거 기재'],
    verifyHow: ['`/admin/retention` 에서 전사 항목을 본다 — 후보 건수는 나오지만 파기는 DRY-RUN 으로만 돈다'],
    afterDecision: '기간을 정해도 파기를 켜는 것은 별개의 사람 승인이다(4-eyes·보존명령 제외 확인).',
    owner: '의무기록팀 · 개인정보보호팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
    drillDown: '/admin/retention',
  },
  {
    key: 'policy.voice.aiDraftOn',
    track: 'AI',
    title: '대화 전체를 AI 에 보내는 초안 경로를 열 것인가(규칙만 / 파일럿 / 전체)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '대화 분석은 기본적으로 **규칙 엔진만** 돌고, AI 경로는 설정으로 꺼져 있다. 켜면 진료 대화 텍스트가 AI 서버로 나간다 — ' +
      '이름·식별자는 전송 전에 치환하지만(비식별) 대화 내용 자체는 나간다. AI 서버 위치는 설정이며 원내일 수도 아닐 수도 있다.',
    legalReview: ['진료 대화 텍스트의 처리 위탁·국외 이전 여부(AI 서버 위치에 따라)', '환자 대상 AI 사용 고지 범위'],
    approvalPath: 'COMMITTEE',
    authority: '의료정보위원회 · 개인정보보호책임자',
    dependsOn: ['policy.ai.clinicalFeatureScope'],
    options: [
      { value: 'RULE_ONLY', label: '규칙만(현행)', effect: '대화 텍스트가 AI 서버로 나가지 않는다.', enact: null },
      { value: 'PILOT', label: '파일럿 — 지정 사용자만', effect: '지정 사용자 대화만 AI 경로를 탄다.', enact: null },
      { value: 'ALL', label: '전체 개방', effect: '대화 분석이 기본으로 AI 경로를 탄다.', enact: null },
    ],
    statusQuo:
      '`ambient.service.ts:205` — `voiceEmr.ambient.aiDraft.enabled === true` 일 때만 AI 경로를 탄다. ' +
      '설정 기본값은 `false`(`config-runtime.service.ts:128` "대화 전체 분석 AI 경로(기본 OFF=규칙 제안만)"). ' +
      'AI 미가용은 503 이 아니라 규칙 제안만으로 내려가고, 전송 전 이름·식별자 치환 건수는 분석 응답 `redacted` 로 화면이 말한다. ' +
      '이름을 조회하지 못하면 **비식별 없이 보내지 않는다**(`AI_SKIPPED: NAMES_UNAVAILABLE`).',
    opens: ['AI 초안 경로 활성(파일럿 범위 지정)'],
    verifyHow: [
      '시스템 설정에서 `voiceEmr.ambient.aiDraft.enabled` 를 확인한다 — 행이 없으면 기본 OFF 다',
      '대화 패널의 SOAP 초안 머리글에서 엔진 표기를 본다 — "규칙" 이면 AI 를 부르지 않았다',
    ],
    afterDecision: '파일럿을 택하면 대상 지정 방식(사용자 목록)을 정하는 작업이 남는다.',
    owner: '임상정보팀 · 개인정보보호팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
