/**
 * 🔴 파트너 API 계측(ApiAccessLog) 배선 선언 — 화면 실사용 점검 W8(2026-08-14).
 *
 * 무엇이 잘못이었나:
 *  - `/admin/partner-monitoring` 은 `ApiAccessLog` 를 읽어 호출 수·에러율·평균 응답·알림을
 *    보여준다. 그런데 **그 테이블에 행을 쓰는 코드가 저장소에 한 줄도 없다**
 *    (`grep -rn apiAccessLog apps/api/src` → 전부 읽기). 운영 실측 0행.
 *  - 그래서 `errorRate = total > 0 ? … : 0` 이 항상 0 을 내고, 화면은 **초록 0.0%** 와
 *    "알림 없음"을 영원히 보여준다. 파트너 연동이 전부 500 을 뱉어도 화면은 초록이다.
 *    (P17 — 근거 없이 안심시킴 / P1 — 표본 부재를 0 으로 말함)
 *  - FE 조회 실패 폴백도 0 뭉치였다: 서버가 죽어도 화면은 "에러율 0%".
 *
 * 원칙: **로그를 쓰는 코드가 없으면 '에러율 0%'가 아니라 '측정되지 않음'이다.**
 *  - 계측이 붙기 전까지 호출 수·에러율·평균 응답은 `null`(산출 불가)로 낸다. 0 이 아니다.
 *  - 계측을 붙일 때는 **한 곳**(외부 클라이언트 요청을 지나는 인터셉터/미들웨어)에서만 쓴다.
 *    여러 컨트롤러에 흩으면 같은 사실에 정본이 둘이 된다(P12).
 *  - 붙이는 날 `wired: true` 로 바꾸고 `wiredSince` 를 채운다. 그 전엔 어떤 코드도
 *    이 화면에 "정상" 이라고 쓸 수 없다.
 */
export const API_ACCESS_INSTRUMENTATION = {
  source: 'ApiAccessLog',
  /** 🔴 기록 코드 존재 여부. 계측을 붙이는 날 true 로 바꾼다(그 전엔 지표를 0 으로 낼 수 없다). */
  wired: false,
  /** 계측이 시작된 시각 — `wired:true` 일 때만 의미가 있다(이전 구간은 여전히 미측정). */
  wiredSince: null as string | null,
  reason: 'ApiAccessLog 에 기록하는 코드가 없습니다 — 파트너 API 호출은 현재 측정되지 않습니다',
  /** 계측을 붙일 자리(한 곳) */
  wireHint:
    '외부 클라이언트 요청이 지나는 인터셉터 한 곳에서 method·path·statusCode·responseTime·clientId·orgId 를 ApiAccessLog 로 남기십시오(SmartAccessLog 를 남기는 AuditInterceptor 와 같은 자리).',
} as const;

export interface MeasurementNote {
  /** 이 화면의 수치가 실제 계측에서 나온 것인가 */
  measured: boolean;
  source: string;
  since: string | null;
  /** 미계측 사유 — 화면이 그대로 사람에게 보여준다 */
  note: string | null;
  hint: string | null;
}

export function apiAccessMeasurement(): MeasurementNote {
  return API_ACCESS_INSTRUMENTATION.wired
    ? { measured: true, source: API_ACCESS_INSTRUMENTATION.source, since: API_ACCESS_INSTRUMENTATION.wiredSince, note: null, hint: null }
    : {
        measured: false,
        source: API_ACCESS_INSTRUMENTATION.source,
        since: null,
        note: API_ACCESS_INSTRUMENTATION.reason,
        hint: API_ACCESS_INSTRUMENTATION.wireHint,
      };
}

/**
 * 에러율 — **분모를 묻는다.**
 *  - 미계측 → null(산출 불가)
 *  - 계측됐지만 호출 0건 → null(표본 부재는 0% 가 아니다)
 *  - 그 외 → 소수 1자리
 */
export function errorRateOf(total: number | null, errors: number | null): number | null {
  if (total === null || errors === null || total <= 0) return null;
  return Math.round((errors / total) * 1000) / 10;
}
