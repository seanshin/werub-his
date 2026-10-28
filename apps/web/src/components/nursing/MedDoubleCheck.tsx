'use client';

/**
 * 고위험약 **독립 이중확인(IPSG.3)** 입력 정본 — 2026-08-18.
 *
 * 🔴 이 컴포넌트가 생긴 이유: BE 로직은 견고했는데 **2차 확인자를 고르는 UI 가 아예 없었다.**
 *    투약 EP 를 부르는 화면 4곳이 전부 `verifiedBy` 를 보내지 않아 고위험약이 전건 우회됐고,
 *    우회 표식(`[IPSG3-DOUBLECHECK-BYPASS]`)은 notes 에만 박혀 **어느 화면에도 뜨지 않았다.**
 *
 * 규약:
 *  - 적용 범위 판정은 shared 정본(`requiresIndependentDoubleCheck`) 하나만 쓴다(FE 재정의 금지).
 *  - **우회를 막지 않는다**(야간 단독근무가 실재한다). 대신 **사유를 고르게 하고 기록·표시**한다.
 *  - 대상이 아니면 아무것도 요구하지 않는다 — 전부에 걸면 형식화되어 검출력이 사라진다(ISMP).
 */

import { useQuery } from '@tanstack/react-query';
import {
  requiresIndependentDoubleCheck,
  DOUBLE_CHECK_BYPASS_REASONS,
  parseDoubleCheckBypass,
  type DoubleCheckScope,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

export interface DoubleCheckValue {
  /** 2차 확인 간호사 User.id */
  verifiedBy: string;
  /** 우회 사유 코드('' = 미선택) */
  bypassCode: string;
  /** 기타 사유 자유 입력 */
  bypassText: string;
}

export const EMPTY_DOUBLE_CHECK: DoubleCheckValue = { verifiedBy: '', bypassCode: '', bypassText: '' };

export interface MedLike {
  route?: string | null;
  prescription?: { medicationCode?: { highAlertFlag?: boolean | null; highAlertCategory?: string | null } | null } | null;
}

/** MAR 행(서버 응답 원형)에서 이중확인 범위를 판정한다. */
export function doubleCheckScopeOf(med: MedLike | null | undefined, route?: string | null): DoubleCheckScope {
  const mc = med?.prescription?.medicationCode;
  return requiresIndependentDoubleCheck({
    highAlertFlag: mc?.highAlertFlag,
    highAlertCategory: mc?.highAlertCategory,
    route: route ?? med?.route,
  });
}

/** 우회 사유 문자열(선택 없음이면 빈 문자열 — 없는 사유를 만들어내지 않는다). */
export function bypassReasonText(v: DoubleCheckValue): string {
  if (!v.bypassCode) return '';
  if (v.bypassCode === 'OTHER') return v.bypassText.trim();
  return DOUBLE_CHECK_BYPASS_REASONS.find((r) => r.code === v.bypassCode)?.label ?? v.bypassCode;
}

/**
 * 투약 확인 버튼을 눌러도 되는가.
 * 대상이 아니면 항상 true. 대상이면 **확인자 지정** 또는 **우회 사유 기재** 중 하나는 있어야 한다.
 * (막는 게 아니라 "아무것도 안 하고 통과"를 막는다 — 우회는 사유만 쓰면 즉시 가능하다.)
 */
export function doubleCheckReady(scope: DoubleCheckScope, v: DoubleCheckValue): boolean {
  if (!scope.required) return true;
  return !!v.verifiedBy || !!bypassReasonText(v);
}

/** 서버로 보낼 조각 — 키 이름은 `AdministerMedDto` 와 기계 대조된다(whitelist 가 조용히 지운다). */
export function doubleCheckPayload(scope: DoubleCheckScope, v: DoubleCheckValue): {
  verifiedBy?: string;
  doubleCheckBypassReason?: string;
} {
  if (!scope.required) return v.verifiedBy ? { verifiedBy: v.verifiedBy } : {};
  if (v.verifiedBy) return { verifiedBy: v.verifiedBy };
  const reason = bypassReasonText(v);
  return reason ? { doubleCheckBypassReason: reason } : {};
}

interface NurseRow { id: string; familyName?: string; givenName?: string }

/** 활성 간호사 목록(선례: blood-bank 워크스테이션 2인 확인). 실패해도 우회 경로는 살아 있다. */
export function useVerifierNurses() {
  const me = useAuthStore((s) => s.user);
  const q = useQuery({
    queryKey: ['double-check-nurses'],
    queryFn: () =>
      apiClient
        .get<{ data: NurseRow[] }>('/api/v1/users?role=NURSE&limit=50'),
    staleTime: 5 * 60 * 1000,
  });
  const raw = q.data?.data;
  const rows: NurseRow[] = Array.isArray(raw) ? raw : ((raw as unknown as { data?: NurseRow[] })?.data ?? []);
  // 자가서명 차단 — 서버도 막지만 고를 수 없게 하는 것이 먼저다.
  return { nurses: rows.filter((n) => n.id !== me?.id), isLoading: q.isLoading, failed: q.isError, retry: () => { void q.refetch(); } };
}

/**
 * 이중확인 패널. `scope.required === false` 면 **아무것도 렌더하지 않는다**(불필요한 마찰 금지).
 */
export function MedDoubleCheckPanel({
  scope,
  value,
  onChange,
  compact,
}: {
  scope: DoubleCheckScope;
  value: DoubleCheckValue;
  onChange: (v: DoubleCheckValue) => void;
  compact?: boolean;
}) {
  const { nurses, isLoading, failed, retry } = useVerifierNurses();
  const tAttr = useTAttr();
  if (!scope.required) return null;

  const reason = bypassReasonText(value);
  const bypassing = !value.verifiedBy;

  return (
    <div className={`rounded-xl border border-violet-200 bg-violet-50/70 ${compact ? 'p-2.5 space-y-1.5' : 'p-3 space-y-2'}`}>
      <p className={`font-semibold text-violet-800 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <T k="독립 이중확인 필요 (IPSG.3)" />
      </p>
      <p className={`text-violet-700 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{scope.reason}</p>

      <select
        value={value.verifiedBy}
        onChange={(e) => onChange({ ...value, verifiedBy: e.target.value, ...(e.target.value ? { bypassCode: '', bypassText: '' } : {}) })}
        className={`w-full px-2.5 py-1.5 border border-violet-200 rounded-lg bg-white ${compact ? 'text-[11px]' : 'text-xs'}`}
      >
        <option value="">
          {/* 🔴 <option> 안이라 티를 그릴 수 없다(요소 자식이 텍스트여야 한다) — tAttr 로 문자열만 */}
          {tAttr(isLoading ? '확인 간호사 조회 중…' : failed ? '간호사 목록 조회 실패 — 우회 사유로 진행' : '② 확인 간호사 선택(본인 제외)')}
        </option>
        {nurses.map((n) => (
          <option key={n.id} value={n.id}>{`${n.familyName ?? ''}${n.givenName ?? ''}`.trim() || n.id.slice(0, 8)}</option>
        ))}
      </select>

      {/* 🔴 목록 조회 실패는 "확인 간호사 없음"이 아니다 — 다시 시도할 수 있게 둔다 */}
      {failed && (
        <button
          type="button"
          onClick={retry}
          className={`text-violet-700 underline ${compact ? 'text-[10px]' : 'text-[11px]'}`}
        >
          <T k="간호사 목록 다시 불러오기" />
        </button>
      )}

      {bypassing && (
        <div className="space-y-1.5">
          <p className={`text-amber-700 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
            {/* 🔴 문장 안에 `<b>` 강조가 있어 **키 하나로 만들 수 없다** — 쪼개면 뜻이 무너지고,
                강조를 지우면 ko 화면이 바뀐다. 배선하지 않고 한국어 원문으로 남겼다(카탈로그 주석 ③). */}
            확인 간호사가 없으면 <b>우회 사유</b>를 남기고 진행할 수 있습니다 — 사유·시각·투약자가 기록에 남고 화면에 표시됩니다.
          </p>
          <select
            value={value.bypassCode}
            onChange={(e) => onChange({ ...value, bypassCode: e.target.value })}
            className={`w-full px-2.5 py-1.5 border border-amber-200 rounded-lg bg-white ${compact ? 'text-[11px]' : 'text-xs'}`}
          >
            <option value="">{tAttr('우회 사유 선택')}</option>
            {DOUBLE_CHECK_BYPASS_REASONS.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
          {value.bypassCode === 'OTHER' && (
            <input
              value={value.bypassText}
              onChange={(e) => onChange({ ...value, bypassText: e.target.value })}
              maxLength={200}
              placeholder={tAttr('사유를 입력하세요')}
              className={`w-full px-2.5 py-1.5 border border-amber-200 rounded-lg ${compact ? 'text-[11px]' : 'text-xs'}`}
            />
          )}
          {reason && (
            <p className={`text-amber-800 font-medium ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
              ⚠ 이중확인 우회로 기록됩니다 — 사유: {reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 이미 투약된 기록의 **우회 사실 표시**. 종전에는 notes 안에만 있어 아무 화면에도 뜨지 않았다.
 * 표식이 없으면 `null` — 없는 우회를 만들어내지 않는다.
 */
export function DoubleCheckBypassBadge({ notes, className }: { notes?: string | null; className?: string }) {
  const rec = parseDoubleCheckBypass(notes);
  if (!rec) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap ${className ?? ''}`}
      title={`독립 이중확인 우회 — 사유: ${rec.reason}${rec.at ? ` · ${rec.at}` : ''}`}
    >
      ⚠ <T k="이중확인 우회" />
      {/* 🔴 `rec.reason` 은 **서버에 저장된 우회 사유 원문**이다 — 번역하지 않는다(기록과 화면이 갈라진다) */}
      <span className="font-normal">({rec.reason})</span>
    </span>
  );
}
