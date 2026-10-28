/**
 * IRB 승인 유효성 판정 — 임상연구 화면·API 의 **단일 정본**.
 *
 * 🔴 종전엔 이 판정이 코드베이스 어디에도 없었다. `irbExpiryDate` 는 스키마에만 있고
 *    응답 매핑에서 탈락해 화면에 도달하지 못했으며, `approve()` 는 승인일만 찍고 만료일을 남기지 않았다.
 *    그래서 **IRB 상태는 한 번 '승인'이 되면 영구히 '승인'** 이었다. 만료된 승인으로 연구를 계속하는 것은
 *    규제 위반이고, 화면은 그 사실을 말할 방법이 없었다(화면 실사용 점검 W7).
 *
 * 🔴 없는 데이터로 판정을 지어내지 않는다. 만료일이 비어 있으면 **'유효'가 아니라 '만료일 미등록'** 이다
 *    (이 저장소 원칙: 미상을 최선값으로 폴백 금지 — P1).
 *
 * 🔴 이 함수는 **판정만** 한다. `irbStatus` 를 'EXPIRED' 로 바꾸는 상태 전이는 하지 않는다.
 *    만료는 시간이 흐르면 저절로 성립하는 사실이라 기록을 고쳐 쓸 일이 아니고,
 *    누가 언제 만료 처리했는지 없는 결재를 만들어내는 것이 되기 때문이다.
 */

/** 만료 임박 경보 기준(일) — 갱신 심의 상정에 필요한 최소 리드타임 */
export const IRB_EXPIRY_SOON_DAYS = 30;

export type IrbValidityState =
  /** 승인 상태가 아님 — 만료 판정 대상 자체가 아니다 */
  | 'NOT_APPROVED'
  /** 🔴 승인인데 만료일이 기록되지 않음 — '유효'로 단정하면 안 된다 */
  | 'NO_EXPIRY_ON_RECORD'
  | 'VALID'
  | 'EXPIRING_SOON'
  | 'EXPIRED';

export interface IrbValidity {
  state: IrbValidityState;
  /** YYYY-MM-DD — 기록이 없으면 null */
  expiryDate: string | null;
  /** 남은 일수(음수=경과일). 판정 불가면 null */
  daysLeft: number | null;
  /** 화면이 그대로 쓸 수 있는 한국어 사유 */
  reason: string;
}

/**
 * `@db.Date` 컬럼 → 'YYYY-MM-DD'.
 * date-only 는 UTC 자정으로 들어오므로 로컬 변환 없이 ISO 앞 10자만 쓴다
 * (`toLocaleDateString` 을 거치면 KST 에서 하루 밀린다 — 날짜/타임존 경계 감사).
 */
export function ymdOf(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/** 서버 로컬(pm2 TZ=Asia/Seoul) 기준 오늘 — 'YYYY-MM-DD' */
export function todayYmd(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 날짜(문자열) 사이 일수 — 둘 다 UTC 자정으로 고정 해석해 DST/오프셋 영향을 없앤다 */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  return Math.round(
    (Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000,
  );
}

export function irbValidityOf(
  study: { irbStatus: string; irbExpiryDate: Date | string | null },
  now: Date = new Date(),
): IrbValidity {
  const expiryDate = ymdOf(study.irbExpiryDate);

  if (study.irbStatus !== 'APPROVED') {
    return {
      state: 'NOT_APPROVED',
      expiryDate,
      daysLeft: null,
      reason: '승인 상태가 아니라 만료 판정 대상이 아닙니다',
    };
  }

  // 🔴 여기서 '유효'로 낙착시키면 만료 관리가 통째로 사라진다. 모르면 모른다고 말한다.
  if (!expiryDate) {
    return {
      state: 'NO_EXPIRY_ON_RECORD',
      expiryDate: null,
      daysLeft: null,
      reason: '승인 기록에 만료일이 없어 유효 여부를 판정할 수 없습니다',
    };
  }

  const daysLeft = daysBetweenYmd(todayYmd(now), expiryDate);
  if (daysLeft < 0) {
    return { state: 'EXPIRED', expiryDate, daysLeft, reason: `승인 만료 ${-daysLeft}일 경과` };
  }
  if (daysLeft <= IRB_EXPIRY_SOON_DAYS) {
    return {
      state: 'EXPIRING_SOON',
      expiryDate,
      daysLeft,
      reason: daysLeft === 0 ? '오늘 만료' : `만료 ${daysLeft}일 전`,
    };
  }
  return { state: 'VALID', expiryDate, daysLeft, reason: `만료까지 ${daysLeft}일` };
}
