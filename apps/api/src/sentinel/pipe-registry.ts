/**
 * 축 D — 파이프 생존 등록부.
 *
 * "돈다고 믿는 것이 실제로 도는가"를 본다. 아래 항목은 **전부 이 저장소에서 실제로 겪은 사고**다:
 *  - 실행 비트 하나가 **정기 백업을 89일** 막았다(아무도 몰랐다)
 *  - 공개 사이트가 **76일** 낡은 빌드를 서비스했다(소스는 최신이었다)
 *  - 모듈 등록 누락으로 크론이 조용히 사라졌다
 *  - PACS 프록시가 401 을 `{count:0}` 으로 덮었다
 *
 * 🔴 **관측할 수 없는 것을 '정상'이라 말하지 않는다.** 프로브가 실패하면 위반이 아니라
 *    `UNOBSERVABLE` 이고, 화면은 그것을 0 과 다르게 그린다.
 */

import { PERIODIC_BACKUP_PATTERN } from '../common/backup-files';

export type PipeProbe = 'FILE_AGE' | 'HTTP' | 'CRON' | 'SOURCE' | 'STATUS_FILE' | 'OUTBOX';

/**
 * 백업 스크립트(`infra/scripts/backup-copy.sh`·`backup-verify.sh`)가 백업 디렉터리에 남기는 상태 파일 이름.
 * 🔴 스크립트 원문과 기계 대조한다(`test/architecture/backup-copy-verify.spec.ts`) — 이름이 갈라지면 감시자는 영영 "관측 불가"만 말한다.
 */
export const BACKUP_STATUS_FILE = 'backup-status.json';

export interface PipeCheck {
  /** 'pipe.backup' */
  key: string;
  label: string;
  probe: PipeProbe;
  severity: 'RED' | 'AMBER' | 'INFO';
  /** 이 시간(시)을 넘으면 위반. FILE_AGE·HTTP 에만 쓴다 */
  maxAgeHours?: number;
  /** 프로브 대상(경로·URL). 감시자가 해석한다 */
  target?: string;
  /** FILE_AGE 에서 셀 파일 이름 패턴 — 🔴 아무 파일이나 세면 다른 경로가 대신 통과시킨다 */
  filePattern?: string;
  /** 어디서 고치는가 — 🔴 모르면 비운다(경로를 지어내지 않는다) */
  drillDown?: string;
  /** 왜 이 항목인가 — 화면 툴팁이자 판정 근거 */
  why: string;
}

export const PIPE_CHECKS: PipeCheck[] = [
  {
    key: 'pipe.backup',
    label: '정기 DB 백업이 하루 안에 있었는가',
    probe: 'FILE_AGE',
    severity: 'RED',
    maxAgeHours: 26, // 03시 크론 + 여유 2시간
    target: '/home/deploy/backups/hospitalrun',
    // 🔴 **정기 백업만 센다.** 처음엔 확장자만 보다가 배포 백업(`pre-deploy_*.sql.gz`)을 집어
    //    "정기 백업 0시간 전"이라 말했다 — 그러면 **정기 크론이 죽어도 배포만 하면 통과한다.**
    //    검출기 자신이 거짓 안심을 만든 자리라, 이름 패턴을 못박는다(정본 `common/backup-files.ts` — go-live 와 공유).
    filePattern: PERIODIC_BACKUP_PATTERN.source,
    why: '실행 비트 하나가 정기 백업을 89일 막은 적이 있다. 그동안 아무 화면도 그 사실을 말하지 않았다.',
  },
  {
    key: 'pipe.backup.secondCopy',
    label: '백업 2차 사본이 원본과 다른 장치에 검증돼 있는가',
    probe: 'STATUS_FILE',
    // AMBER — 고치는 길(외장·원격·오프라인 저장소)이 사람 결정이라, 매일 빨간 경보로 그리면 진짜 경보가 묻힌다
    severity: 'AMBER',
    target: '/home/deploy/backups/hospitalrun',
    why: '정기 백업이 DB 와 같은 디스크·같은 네트워크에 있고 30일 뒤 지워진다. 디스크 하나가 죽으면 원본과 백업이 함께 사라진다.',
  },
  {
    key: 'pipe.backup.filesArchive',
    label: '업로드·첨부 파일 저장소가 최신 백업에 담겼는가',
    probe: 'STATUS_FILE',
    // AMBER — 어떤 파일이 법정 보존 대상인지·보관 매체는 사람 결정(T10)이라 매일 빨간 경보로 그리지 않는다.
    //    다만 경로가 없으면(NO_PATHS) 초록이 아니라 관측 불가다.
    severity: 'AMBER',
    target: '/home/deploy/backups/hospitalrun',
    why: '백업은 DB 덤프뿐이었다. DB 만 복원하면 진료 첨부·녹음·서류 행은 돌아오지만 그 행이 가리키는 파일은 없어 화면이 404 를 낸다.',
  },
  {
    key: 'pipe.backup.restoreVerify',
    label: '백업을 열어 본(복원 검증) 기록이 한 달 안에 있는가',
    probe: 'STATUS_FILE',
    severity: 'AMBER',
    maxAgeHours: 24 * 31,
    target: '/home/deploy/backups/hospitalrun',
    why: '열어 본 적 없는 백업은 백업이 아니다. 운영 문서끼리 "복원 확인됨"과 "미수행"이 서로 모순이었고, 검증을 남기는 경로가 없었다.',
  },
  {
    key: 'pipe.cron.inactive',
    label: '등록됐지만 돌지 않는 크론',
    probe: 'CRON',
    severity: 'RED',
    why: '중지된 잡은 영영 뜨지 않는다. 등록만으로는 돈다는 뜻이 아니다.',
  },
  {
    key: 'pipe.cron.registered',
    label: '등록된 크론 수(기대치 미만이면 사라진 것)',
    probe: 'CRON',
    severity: 'RED',
    why: '모듈 등록 누락으로 크론이 조용히 사라진 사고가 있었다. 수가 줄면 그 자체가 신호다.',
  },
  {
    key: 'pipe.publicSite',
    label: '공개 사이트 빌드 최신성',
    probe: 'HTTP',
    severity: 'AMBER',
    maxAgeHours: 24 * 14, // 2주. 홈페이지는 매일 배포하는 대상이 아니다
    target: 'https://hospital.example.org',
    drillDown: '/admin/homepage/deploy',
    why: 'HIS 전체 배포에 공개 사이트가 들어 있지 않아 76일 낡은 빌드를 서비스했다. 소스가 같은 것과 배포된 것이 같은 것은 다르다.',
  },
  {
    /**
     * 🔴 (2026-09-16 E4 실측) 운영 outbox 는 **2026-08-02 이후 6주간 0행**인데 그 사이 청구 73·조제 86건이 생겼고
     *    `erp.webhookEnabled=true`·활성 웹훅 2개였다. 발신이 멈춘 것인지 보낼 것이 없던 것인지 **아무도 모른다** —
     *    `enqueue()` 는 실패를 `logger.warn` 하나로 삼키고, 감시자는 이 파이프를 아예 보지 않았다.
     *    적재가 멈춘 사실 자체를 관측점으로 만든다(발신 0 은 정상일 수도 있으므로 RED 가 아니라 AMBER).
     */
    key: 'pipe.outbox.idle',
    label: '대외 발신 적재가 멈춤(발신 대상이 있는데 outbox 가 조용함)',
    probe: 'OUTBOX',
    severity: 'AMBER',
    maxAgeHours: 24 * 14,
    drillDown: '/admin/erp',
    why: '발신 설정이 켜져 있는데 적재가 오래 멈춰 있으면, 보낼 것이 없던 것인지 enqueue 가 조용히 실패한 것인지 구분해야 한다.',
  },
  {
    key: 'pipe.outbox.stuck',
    label: '발송되지 못한 대외 발신(FAILED·재시도 기한 경과 PENDING)',
    probe: 'OUTBOX',
    severity: 'RED',
    drillDown: '/admin/erp',
    why: 'FAILED 는 자동 재시도하지 않는다(같은 실패 반복 금지) — 사람이 보지 않으면 영영 안 나간다.',
  },
  {
    key: 'pipe.event.unconsumed',
    label: '발행만 되고 받는 곳이 없는 이벤트',
    probe: 'SOURCE',
    severity: 'AMBER',
    why: '이벤트를 emit 하는데 @OnEvent 도 SSE 구독도 없으면 그 기능은 배선되지 않은 것이다.',
  },
];

/**
 * 🔴 **리스너가 없는 것이 정상인 이벤트** — 근거와 함께 선언한다.
 *    선언 없이 목록에서 빼면 "왜 빠졌는지" 아무도 모르고, 나중에 진짜 미배선이 여기 숨는다.
 */
export const EVENT_CONSUMED_ELSEWHERE: Record<string, string> = {
  'queue.changed': 'SSE 컨트롤러가 fromEvent 로 직접 받는다(@OnEvent 가 아니다)',
  // 🔴 (2026-09-16 F2) 세 번째 소비 통로 — `Subject` 스트림. `fromEvent` 가 아니라 서비스가 직접 next() 한다.
  'consent.doctor_signed': 'ConsentForm.doctorSignedAt 기록 + 같은 자리에서 emitWs(wsStream Subject)로 워크스테이션 SSE 에 전달 — @OnEvent·fromEvent 가 아닌 세 번째 통로',
};

/**
 * **받는 곳이 없어도 사실은 원장에 남는 이벤트** — 어디에 남는지를 값으로 적는다.
 *
 * 🔴 위 `EVENT_CONSUMED_ELSEWHERE`(다른 방식으로 **소비**됨)와 다른 부류다.
 *    이쪽은 아무도 안 받지만, **바로 옆에서 DB 에 쓴다**. 그래서 기능이 죽지 않는다.
 *    (2026-09-03 전수 확인 — 8종 모두 emit 직전·직후에 영속 기록이 있다)
 *
 * 🔴 **"어디에 남는가"를 비워 둘 수 없다.** 가드가 그 문자열을 요구한다 —
 *    비워도 되면 진짜 미배선을 여기 숨길 수 있고, 그러면 이 축이 무의미해진다.
 * 🔴 목록에서 **지우지 않고** 선언으로 남기는 이유: 나중에 누가 이 이벤트를 받아야 할 때
 *    (예: 환자 알림·외부 연동) 후보가 어디 있는지 보이게 하기 위해서다.
 */
export const EVENT_BROADCAST_ONLY: Record<string, string> = {
  'billing.amend_review_needed': 'PatientJourneyEvent BILLING_AMEND_REVIEW — 대시보드 청구 검토 큐 위젯이 조회',
  'billing.create_failed': 'PatientJourneyEvent BILLING_CREATE_FAILED(severity CRITICAL) — 같은 위젯이 조회',
  'chemo.cycle.started': 'ChemoCycle 상태 + 조제 오더(CompoundingOrder) 생성이 그 자리에서 커밋된다',
  'dispensing.issued': 'Dispensing 기록 + MAR 연결. 환자 알림은 별도 `prescription.ready`(소비됨) 경로다',
  'document.delivered': 'DocumentRequest.status=DELIVERED + AuditLog(UPDATE)',
  'document.rejected': 'DocumentRequest.status=REJECTED + rejectReason + AuditLog(UPDATE)',
  'encounter.amended': 'PatientJourneyEvent ENCOUNTER_AMENDED(재서명 필요) — 진료기록 타임라인',
  'billing.consult_code_missing': '로그(ERROR) — 진찰료 코드 미등재로 청구에서 진찰료가 빠질 때. 수가 마스터 보정이 사람 몫이라 방송으로만 남긴다',
  'encounter.drafts_purged': '삭제 건수를 크론 로그로 남긴다(정리 작업이라 환자 원장에 남길 사실이 아니다)',

  /**
   * 🔴 (2026-09-16 F2) 아래 7종은 감시자가 6주간 AMBER 로 들고 있던 것들이다. 한 건씩 emit 자리를 읽어
   *    **바로 옆에 영속 기록이 있는지** 확인했고(운영 행 수까지 대조), 전부 사실을 잃지 않는다.
   *    선언 없이 목록에서 빼지 않는 이유는 위와 같다 — 나중에 이것들을 **받아야 할 때** 후보가 여기 보인다.
   */
  'emergency.billing_failed': 'PatientJourneyEvent ER_BILLING_FAILED 를 같은 자리에서 발행 — billing.service 가 조회해 대시보드 청구 검토 큐 위젯에 띄운다',
  'handoff.created': 'ClinicalHandoff 행 + 인수자 인앱 알림(Notification refType CLINICAL_HANDOFF). W.Channel 릴레이 어댑터는 미구현 — 어댑터가 생기면 이 이벤트의 구독자가 된다',
  'psych.seclusion.started': 'PsychSeclusionOrder 행(legalMaxUntil 포함) — safety-gate.service 가 ACTIVE·법정시간 초과를 조회해 /admin/safety-gates 에 띄운다',
  'psych.seclusion.released': 'PsychSeclusionOrder.status=RELEASED·releasedAt·releasedById 기록 — 같은 안전게이트 조회가 해제분을 활성 목록에서 뺀다',
  'registration.consent.collected': 'RegistrationConsent upsert(동의 항목별 signedAt·collectedBy) — 원무 창구 법정 동의 패널이 폴링으로 다시 읽는다',
  'registration.consent.signed': 'RegistrationConsent upsert(signMethod·signatureData·ipAddress) — 같은 창구 화면이 다시 읽는다(실시간 push 아님·소스 주석에 실측으로 명시)',
  'registration.consent.portal_requested': 'PatientNotification 행(알림이 실제로 만들어진 뒤에만 발행) + FCM 푸시 시도 — 미발송이면 애초에 발행되지 않는다',
};
