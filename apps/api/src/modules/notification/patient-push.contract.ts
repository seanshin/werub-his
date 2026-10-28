/**
 * 환자 푸시(대외 발신) 계약 — **정본**. 순수 데이터·함수만(Nest 의존 없음 → 어느 모듈에서든 import 가능).
 *
 * 🔴 왜 여기 한 곳인가(2026-08-20): 발화 지점은 도메인 서비스에 흩어져 있지만
 *    **"보낼 것인가"의 판정은 한 곳**이어야 한다. 발행부마다 조건을 두면 정본이 둘이 되고
 *    조용히 갈라진다(이 저장소에서 반복된 함정 P12). 발행부는 "사실이 참이 됐다"만 알리고,
 *    켜짐·야간·중복 판정은 `PatientPushGateService` 하나가 한다.
 *
 * 🔴 기본값은 **전부 OFF** 다. 대외 발신(환자 휴대폰에 실제로 도달하는 것)은 자동으로 켜지지 않는다 —
 *    마스터 1개 + 타입별 1개가 **둘 다** true 여야 나간다. 한쪽만 보면 "켰는데 안 나간다"가 된다.
 *
 * 🔴 보내지 않았으면 보냈다고 적지 않는다 — 발행부는 전송 시각·성공 플래그를 원장에 찍지 않는다.
 *    이 파일의 `PatientPushResult` 가 "무슨 일이 있었는지"를 그대로 돌려주고, 화면은 그것을 말한다.
 */

/** 배선된 환자 푸시 유형 = `PatientNotification.type` 그대로(어휘를 바꾸지 않는다) */
export type PatientPushType = 'CALLED' | 'PHARMACY' | 'LAB_RESULT' | 'BILLING' | 'MESSAGE' | 'DOCUMENT_READY' | 'DOCUMENT_REJECTED' | 'QUEUE_NEAR';

/**
 * 발송 판정 사유 — 화면이 이 값을 그대로 말한다. 🔴 정직하게 붙인다.
 * · SENT                 실제로 PatientNotification 을 만들고 FCM 발송을 걸었다
 * · NOT_REQUESTED        직원이 "환자 앱 알림"을 요청하지 않았다(옵트인 미체크) — 설정만으로는 몰래 나가지 않는다
 * · DISABLED_BY_CONFIG   마스터 스위치 OFF
 * · TYPE_DISABLED        마스터는 ON 이지만 이 유형이 OFF
 * · QUIET_HOURS          야간 억제 창(KST) — 🔴 나중에 보내지 **않는다**(예약 발송 큐 없음). 미발송이다
 * · NO_PATIENT_ACCOUNT   환자앱 계정이 없다(앱 미설치는 실패가 아니다 — 보낼 곳이 없는 것)
 * · DUPLICATE_SUPPRESSED 같은 환자·같은 유형 억제 창 안 재발화
 * · NOT_APPLICABLE       이 건에는 해당 알림이 사실이 아니다(예: 입원 조제는 병동 인계 — 환자가 약국에 가지 않는다)
 * · CRITICAL_WITHHELD    위급값 포함 결과 — 환자에게 먼저 알리지 않는다(사유는 gate 서비스 주석)
 * · NO_LISTENER          알림 모듈이 이벤트를 받지 않았다(수신자 0) — 아무 일도 일어나지 않았다
 * · ERROR                발송 시도 중 예외
 */
export type PatientPushReason =
  | 'SENT'
  | 'NOT_REQUESTED'
  | 'DISABLED_BY_CONFIG'
  | 'TYPE_DISABLED'
  | 'QUIET_HOURS'
  | 'NO_PATIENT_ACCOUNT'
  | 'DUPLICATE_SUPPRESSED'
  | 'NOT_APPLICABLE'
  | 'CRITICAL_WITHHELD'
  | 'NO_LISTENER'
  | 'ERROR';

export interface PatientPushResult {
  /** 게이트를 통과해 실제 발송을 시도했는가(계정 조회 이후) */
  attempted: boolean;
  /** PatientNotification 이 만들어졌는가. 🔴 false 면 환자는 아무것도 받지 못했다 */
  sent: boolean;
  reason: PatientPushReason;
  /**
   * 🔴 **단말 푸시**는 인앱 알림과 다른 층이다.
   *   `ATTEMPTED`   FCM 이 설정돼 있어 발송을 시도했다(도달까지 보장하지는 않는다)
   *   `UNAVAILABLE` FCM 자격이 설정돼 있지 않다 — **앱을 열어야 본다**
   *   `null`        보내지 않았으므로 해당 없음
   * 이것을 빼면 화면이 `sent:true` 를 "폰으로 갔다"로 읽는다(FCM 이 꺼져 있어도 sent 는 true 다).
   */
  pushChannel: 'ATTEMPTED' | 'UNAVAILABLE' | null;
}

export interface PatientPushTypeDef {
  type: PatientPushType;
  label: string;
  /**
   * 🔴 사람이 방아쇠를 당기는 알림인가. true 면 요청 DTO 의 `notifyPatient === true` 가 **추가로** 필요하다
   * (설정만으로 몰래 나가지 않게). 크론·시스템이 만드는 것은 누를 사람이 없으므로 false.
   */
  requiresOptIn: boolean;
  /** 야간 억제 예외 — 사유는 `quietHoursNote`(감으로 정하지 않는다) */
  quietHoursExempt: boolean;
  quietHoursNote: string;
  /** 같은 환자·같은 유형 재발화 억제 창(분). 선례: schedule.service 도착확인 10분 */
  dedupMinutes: number;
  /** 환자앱 딥링크(`data.route` — 모바일 usePushNotifications 가 소비). 실재하는 라우트만 적는다 */
  route: string;
  /** 타입별 킬 스위치 SystemConfig 키 */
  configKey: string;
  /** 경보 등록부(alert-registry.ts) 코드 — 채널이 달라 직원 코드와 이름이 겹치지 않게 접두 */
  alertCode: string;
}

export const PATIENT_PUSH_MASTER_KEY = 'notification.patientPush.enabled';
export const PATIENT_PUSH_QUIET_HOURS_KEY = 'notification.patientPush.quietHours';
export const patientPushTypeKey = (type: PatientPushType) => `notification.patientPush.types.${type}`;

/**
 * 차례 임박 기준(앞 대기 인원 · 포털 B3 · 2026-10-26) — 🔴 원내 정책이다. **기본값을 두지 않는다**:
 * 미설정·형식 밖이면 null = 차례 임박 알림을 만들지 않는다(마스터·유형 스위치를 켜도). 0~10 정수만.
 */
export const PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY = 'notification.patientPush.queueNearAhead';
export function normalizeQueueNearAhead(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;
}

/**
 * 🔴 야간 억제 예외 판단(2026-08-20 · 근거를 여기 남긴다):
 *   예외로 두는 기준은 "심야에 울려도 되는 알림"이 아니라 **"환자가 지금 원내에서 그것을 기다리고 있는가"** 다.
 *   응급실은 24시간 돌아간다 — 새벽 3시 진료 호출을 억제하면 그 환자는 부르는 소리를 못 듣는다.
 *   CALLED·PHARMACY·BILLING 은 셋 다 직원이 **환자를 눈앞에 두고** 누르는 것이고(옵트인 필수),
 *   그 순간 도달하지 않으면 알림 자체가 무의미해진다 → 예외.
 *   LAB_RESULT 는 환자가 귀가한 뒤 시스템이 만드는 것이고 새벽에 깨울 이유가 없다 → 억제.
 *   🔴 억제는 **지연 발송이 아니라 미발송**이다(예약 큐가 없다). 그래서 억제 대상은 "안 받아도 손해가 없는 것"만.
 */
export const PATIENT_PUSH_TYPES: Readonly<Record<PatientPushType, PatientPushTypeDef>> = {
  CALLED: {
    type: 'CALLED',
    label: '진료 호출',
    requiresOptIn: true,
    quietHoursExempt: true,
    quietHoursNote: '지금 부르는 것이다 — 억제하면 환자가 호출을 못 듣는다(응급실은 24시간). 직원 옵트인 필수.',
    dedupMinutes: 3,
    route: '/(tabs)/notifications',
    configKey: patientPushTypeKey('CALLED'),
    alertCode: 'PATIENT_PUSH_CALLED',
  },
  PHARMACY: {
    type: 'PHARMACY',
    label: '약 조제 완료(수령 안내)',
    requiresOptIn: true,
    quietHoursExempt: true,
    quietHoursNote: '환자가 약국 앞에서 기다리는 중이다(외래 조제 검수 완료 = 지금 줄 수 있다). 직원 옵트인 필수.',
    dedupMinutes: 30,
    route: '/(tabs)/medication',
    configKey: patientPushTypeKey('PHARMACY'),
    alertCode: 'PATIENT_PUSH_PHARMACY',
  },
  BILLING: {
    type: 'BILLING',
    label: '수납 대기',
    requiresOptIn: true,
    quietHoursExempt: true,
    quietHoursNote: '진료가 방금 끝나 원내에 있는 환자를 수납 창구로 부르는 것이다. 직원 옵트인 필수.',
    dedupMinutes: 60,
    route: '/(tabs)/billing',
    configKey: patientPushTypeKey('BILLING'),
    alertCode: 'PATIENT_PUSH_BILLING',
  },
  LAB_RESULT: {
    type: 'LAB_RESULT',
    label: '검사 결과 확정(VERIFIED)',
    requiresOptIn: false,
    quietHoursExempt: false,
    quietHoursNote: '귀가한 환자에게 가는 정보성 알림 — 새벽에 깨울 이유가 없다.',
    dedupMinutes: 60,
    route: '/(tabs)/labs',
    configKey: patientPushTypeKey('LAB_RESULT'),
    alertCode: 'PATIENT_PUSH_LAB_RESULT',
  },
  MESSAGE: {
    type: 'MESSAGE',
    label: '담당의 메시지 답변',
    requiresOptIn: true,
    quietHoursExempt: false,
    quietHoursNote: '답변은 앱 메시지함에 남는다 — 새벽에 깨울 이유가 없다(억제분은 나중에 보내지 않지만 답변 자체는 사라지지 않는다). 의사 옵트인 필수.',
    dedupMinutes: 10,
    route: '/(tabs)/messages',
    configKey: patientPushTypeKey('MESSAGE'),
    alertCode: 'PATIENT_PUSH_MESSAGE',
  },
  /**
   * 서류 발급 완료·반려(2026-10-10) — 🔴 종전엔 개별 서류는 발급·반려돼도 환자에게 아무것도 가지 않았다(실손 번들만 알림).
   * 환자는 포털 목록을 직접 열어 봐야 알았다. 시스템이 만드는 정보성 알림(옵트인 없음) · 귀가한 환자에게 가므로 야간 억제.
   * 어휘 DOCUMENT_READY 는 환자 알림 설정 기본 목록(patient-auth defaultTypes)·번들 알림과 같은 문자열이다.
   */
  DOCUMENT_READY: {
    type: 'DOCUMENT_READY',
    label: '서류 발급 완료',
    requiresOptIn: false,
    quietHoursExempt: false,
    quietHoursNote: '발급된 서류는 앱·창구에 남는다 — 새벽에 깨울 이유가 없다.',
    dedupMinutes: 10,
    route: '/(tabs)/documents',
    configKey: patientPushTypeKey('DOCUMENT_READY'),
    alertCode: 'PATIENT_PUSH_DOCUMENT_READY',
  },
  DOCUMENT_REJECTED: {
    type: 'DOCUMENT_REJECTED',
    label: '서류 발급 반려',
    requiresOptIn: false,
    quietHoursExempt: false,
    quietHoursNote: '반려 사유는 앱에 남는다 — 새벽에 깨울 이유가 없다. 사유는 알림에 싣지 않는다(잠금 화면).',
    dedupMinutes: 10,
    route: '/(tabs)/documents',
    configKey: patientPushTypeKey('DOCUMENT_REJECTED'),
    alertCode: 'PATIENT_PUSH_DOCUMENT_REJECTED',
  },
  /**
   * 진료 차례 임박(포털 B3 · 2026-10-26) — 같은 진료과 오늘 대기에서 앞 인원이 기준(`queueNearAhead`) **이하가 된 첫 순간** 한 번.
   * 시스템이 만든다(누를 사람이 없다 → 옵트인 없음) · 🔴 기준 미설정이면 만들지 않는다 · 같은 대기표에는 두 번 보내지 않는다(발행부가 대기표 id 로 확인).
   */
  QUEUE_NEAR: {
    type: 'QUEUE_NEAR',
    label: '진료 차례 임박',
    requiresOptIn: false,
    quietHoursExempt: true,
    quietHoursNote: '원내에서 지금 차례를 기다리는 환자다(접수한 오늘 대기) — 억제하면 응급실 야간 대기자가 차례를 놓친다. 호출(CALLED)과 같은 이유.',
    dedupMinutes: 3,
    route: '/(tabs)/notifications',
    configKey: patientPushTypeKey('QUEUE_NEAR'),
    alertCode: 'PATIENT_PUSH_QUEUE_NEAR',
  },
};

export const PATIENT_PUSH_TYPE_LIST: readonly PatientPushTypeDef[] = Object.values(PATIENT_PUSH_TYPES);

export interface QuietHours {
  /** KST 기준 억제 시작 시(0~23) */
  startHour: number;
  /** KST 기준 억제 종료 시(0~23·미포함). start === end 이면 억제 없음 */
  endHour: number;
}

/** 🔴 값은 운영이 정한다. 코드 기본은 22:00~07:00(KST) — 설정이 없거나 형식 위반이면 이 값이 산다. */
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 22, endHour: 7 };

/** 설정값 정규화 — 형식 위반은 조용히 무시하고 기본값 유지(fail-safe: 억제는 남는다) */
export function normalizeQuietHours(raw: unknown): QuietHours {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_QUIET_HOURS;
  const r = raw as { startHour?: unknown; endHour?: unknown };
  const s = Number(r.startHour);
  const e = Number(r.endHour);
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= 23;
  if (!ok(s) || !ok(e)) return DEFAULT_QUIET_HOURS;
  return { startHour: s, endHour: e };
}

/**
 * 🔴 컨테이너 OS 는 UTC 다 — `getHours()` 를 믿지 않는다(pm2 TZ 가 유일한 KST 소스이고 그것도 프로세스마다 다르다).
 *    KST 시각은 오프셋으로 직접 계산한다(선례 `schedule-reminder.cron.ts`).
 */
export function kstHour(now: Date = new Date()): number {
  return new Date(now.getTime() + 9 * 3600_000).getUTCHours();
}

/** 자정을 넘는 창(22→7)도 처리 */
export function isQuietHour(hour: number, q: QuietHours): boolean {
  if (q.startHour === q.endHour) return false; // 억제 없음
  return q.startHour < q.endHour
    ? hour >= q.startHour && hour < q.endHour
    : hour >= q.startHour || hour < q.endHour;
}

export const patientPushResult = (
  reason: PatientPushReason,
  /** 🔴 보낸 경우에만 의미가 있다 — 단말 푸시가 가능한 상태였는가(FCM 자격 설정 여부) */
  pushChannel: PatientPushResult['pushChannel'] = null,
): PatientPushResult => ({
  attempted: reason === 'SENT' || reason === 'NO_PATIENT_ACCOUNT' || reason === 'ERROR',
  sent: reason === 'SENT',
  reason,
  pushChannel: reason === 'SENT' ? pushChannel : null,
});

/**
 * `emitAsync` 가 돌려준 리스너 반환값 중 첫 `PatientPushResult` 를 고른다.
 * 🔴 하나도 없으면 **아무 일도 일어나지 않은 것**이다(수신자 0) — 성공으로 접지 않는다.
 */
export function firstPatientPushResult(results: unknown): PatientPushResult {
  const list = Array.isArray(results) ? results : [results];
  for (const r of list) {
    if (r && typeof r === 'object' && 'reason' in r && 'sent' in r && 'attempted' in r) {
      return r as PatientPushResult;
    }
  }
  return patientPushResult('NO_LISTENER');
}
