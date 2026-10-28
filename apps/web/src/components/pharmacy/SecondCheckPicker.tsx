'use client';

/**
 * 고위험약/마약류 **조제 2차 확인자** 입력 정본 — 2026-08-26.
 *
 * 🔴 이 컴포넌트가 생긴 이유: BE 게이트는 완성돼 있었는데 **2차 확인자를 고르는 UI 가 없었다.**
 *    두 조제 화면(`/pharmacy`·`/workstation/pharmacy`)이 `complete` 를 **body 없이** 호출해
 *    `secondCheckBy` 가 항상 `undefined` 였고, web 전역 `secondCheckBy` grep 은 **0건**이었다.
 *    `pharmacy.highAlertDoubleCheck` 는 운영 `system_configs` 에 **미설정** → `gateMode` 의
 *    fail-closed 기본이 **BLOCK** 이므로, 고위험약이 처방되는 순간 조제 완료가 **409 로 영원히 막힌다.**
 *
 * 🔴 실피해가 0인 것은 통제가 작동해서가 아니라 **잴 것이 없었기 때문**이다 —
 *    운영 MEDICATION 처방 656건 중 `high_alert_flag`/`control_schedule` 약품을 참조하는 처방이
 *    0건이다(마스터에는 고위험 634·마약류 300 등재). 실약품이 들어오는 날 발동한다.
 *
 * 규약:
 *  - **게이트를 약화하지 않는다.** 이 컴포넌트는 고를 사람을 줄 뿐, 무엇도 우회시키지 않는다.
 *  - **버튼을 막지 않는다.** 차단 여부는 서버 설정(OFF/WARN/BLOCK)이 정한다. FE 가 미리 막으면
 *    게이트가 OFF/WARN 인 병원에서 조제가 화면 때문에 멈춘다("막으면 방치된다").
 *    대신 서버가 거부하면 **그 사유를 그대로** 보여준다.
 *  - 초기값은 **미선택**(쓰기 폼 규약). 자동으로 아무나 채우지 않는다.
 *  - 대상이 아니면 **아무것도 렌더하지 않는다** — 전부에 걸면 형식화되어 검출력이 사라진다(ISMP).
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface SecondCheckerRow {
  id: string;
  familyName?: string | null;
  givenName?: string | null;
  role?: string;
}

/** 조제 대상이 독립 2인확인 대상인가 — 고위험약(ISMP) **또는** 마약류/향정. */
export function needsSecondCheck(med?: {
  highAlertFlag?: boolean | null;
  controlSchedule?: string | null;
} | null): boolean {
  if (!med) return false;
  return !!med.highAlertFlag || !!med.controlSchedule;
}

/**
 * 2차 확인자 후보. 🔴 `GET /users?role=PHARMACIST` 를 쓰지 않는다 —
 * 그 EP 는 `@Roles(ADMIN, DOCTOR, NURSE)` 라 **약사가 부르면 403** 이고,
 * 게이트가 인정하는 ADMIN 확인자도 빠져 목록과 서버 판정이 갈라진다.
 * 약국 스코프 EP 하나가 정본이며 서버가 본인을 이미 제외해 돌려준다.
 */
export function useSecondCheckers() {
  const q = useQuery({
    queryKey: ['pharmacy-second-checkers'],
    // 🔴 `queryFn` 안에서 `.catch(() => [])` 금지 — 조회 실패가 "확인자 없음"으로 번역되면
    //    약사는 사람이 없어서 못 하는 줄 안다(실제로는 목록을 못 받았을 뿐이다).
    queryFn: () => apiClient.get<{ data: SecondCheckerRow[] }>('/api/v1/pharmacy/second-checkers'),
    staleTime: 5 * 60 * 1000,
  });
  const raw = q.data?.data;
  const rows: SecondCheckerRow[] = Array.isArray(raw)
    ? raw
    : ((raw as unknown as { data?: SecondCheckerRow[] })?.data ?? []);
  return { checkers: rows, isLoading: q.isLoading, failed: q.isError, retry: () => { void q.refetch(); } };
}

export function checkerName(c: SecondCheckerRow): string {
  return `${c.familyName ?? ''}${c.givenName ?? ''}`.trim() || c.id.slice(0, 8);
}

export function SecondCheckPicker({
  required,
  value,
  onChange,
  reason,
  compact,
}: {
  /** 고위험약/마약류인가. false 면 아무것도 렌더하지 않는다. */
  required: boolean;
  value: string;
  onChange: (v: string) => void;
  /** 왜 필요한지 — 화면이 근거를 말한다(믿으라고 하지 않는다) */
  reason?: string;
  compact?: boolean;
}) {
  const { checkers, isLoading, failed, retry } = useSecondCheckers();
  if (!required) return null;

  return (
    <div className={`rounded-xl border border-red-200 bg-red-50/70 ${compact ? 'p-2.5 space-y-1.5' : 'p-3 space-y-2'}`}>
      <p className={`font-semibold text-red-800 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        ⛔ 고위험약/마약류 — 독립 2인확인 필요
      </p>
      {reason && <p className={`text-red-700 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{reason}</p>}

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-2.5 py-1.5 border border-red-200 rounded-lg bg-white ${compact ? 'text-[11px]' : 'text-xs'}`}
      >
        {/* 초기값은 미선택 — 아무나 자동으로 채우지 않는다 */}
        <option value="">
          {isLoading
            ? '확인 약사 조회 중…'
            /* 🔴 조회 실패를 "확인 약사 없음"이라 말하지 않는다 — 다른 사실이다 */
            : failed
              ? '확인자 목록 조회 실패 — 다시 시도하세요'
              : checkers.length === 0
                ? '선택 가능한 확인자가 없습니다(활성 약사·관리자 본인 외 0명)'
                : '2차 확인자 선택(본인 제외)'}
        </option>
        {checkers.map((c) => (
          <option key={c.id} value={c.id}>{checkerName(c)}</option>
        ))}
      </select>

      {failed && (
        <button
          type="button"
          onClick={retry}
          className={`px-2 py-1 rounded-lg bg-white border border-red-200 text-red-700 ${compact ? 'text-[10px]' : 'text-[11px]'}`}
        >
          다시 조회
        </button>
      )}

      {/* 🔴 화면이 갖지 않은 권한을 가진 척하지 않는다 — 차단 여부는 서버 설정이 정한다 */}
      <p className={`text-red-600/80 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
        미선택 상태로도 완료를 시도할 수 있습니다. 원내 게이트 설정에 따라 서버가 거부하면 그 사유가 표시됩니다.
      </p>
    </div>
  );
}
