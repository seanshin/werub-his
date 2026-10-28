'use client';

/**
 * 언어별 검수자 지정 — **ADMIN 전용 화면(`/admin/ui-locale`) 소유**.
 *
 * 🔴 처음엔 검수 워크리스트(`/admin/ui-locale/review`)에 뒀는데, 그 화면은 비관리자 검수자에게도
 *    열려 있어서 **EVERY_ROLE 화면이 ADMIN 전용 EP(직원 목록·설정 쓰기)를 부르는 모양**이 됐다.
 *    역할×EP 가드가 그 미스매치를 잡았고, EP 를 여는 대신 **성격에 맞는 화면으로 옮겼다**(§규약 5:
 *    EP 를 여는 것이 항상 답은 아니다 — 화면이 부르지 않는 것이 답인 자리가 있다).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ── 언어별 검수자 지정 ───────────────────────────────────────────────────────
 * 🔴 서버는 `i18n.reviewers` 를 읽는데(`i18n-review.service.ts`) **설정할 화면이 없었다**
 *    (2026-09-09 실측: config `DEFAULTS` 미등재 → 관리 목록에도 안 뜨고, `/admin/config` 는 읽기 전용).
 *    그래서 "검수자는 비관리자 언어 전문가"라는 설계가 있는데도 **쓰기 주체가 ADMIN 하나로 고착**돼 있었다.
 * 🔴 기본값 `{}` 는 **DB 행이 아니다** — 저장을 눌러야 행이 생긴다. 화면이 그 사실을 말한다.
 */
interface StaffUser { id: string; familyName?: string; givenName?: string; email?: string; role?: string; isActive?: boolean }
type ReviewerMap = Record<string, string[]>;

const unwrapList = <T,>(res: unknown): T[] | null => {
  const d = (res as { data?: unknown } | undefined)?.data;
  if (Array.isArray(d)) return d as T[];
  const inner = (d as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : null;
};

export function ReviewerAssignPanel({ locale, isAdmin }: { locale: string; isAdmin: boolean }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  /**
   * 🔴 `isAdmin` 을 **호출자가 준다** — 화면이 권한 객체를 지어내지 않는다.
   *    이 패널이 사는 `/admin/ui-locale` 은 `ADMIN_ONLY` 라우트라 그 사실이 이미 보장돼 있고,
   *    서버도 `PUT /api/v1/config/:key` 에서 다시 막는다(화면 판정은 표시용이지 게이트가 아니다).
   */

  const cfg = useQuery({
    queryKey: ['i18n-reviewers'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/config/i18n.reviewers'),
  });
  const staff = useQuery({
    queryKey: ['i18n-reviewers-staff'],
    queryFn: () => apiClient.get<unknown>('/api/v1/users'),
    enabled: isAdmin,
  });

  const save = useMutation({
    mutationFn: (next: ReviewerMap) => apiClient.put('/api/v1/config/i18n.reviewers', { value: next }),
    onSuccess: () => {
      toast.success(tAttr('검수자 지정을 저장했습니다 — 다음 조회부터 적용됩니다.'));
      qc.invalidateQueries({ queryKey: ['i18n-reviewers'] });
      qc.invalidateQueries({ queryKey: ['i18n-review'] });
    },
  });

  // 🔴 조회 실패를 "검수자 0명"으로 그리지 않는다 — 다른 사실이다
  if (cfg.isError) return <QueryErrorFallback error={cfg.error} onRetry={cfg.refetch} />;
  if (cfg.isLoading) {
    return <div className="rounded-2xl border border-gray-100 bg-white p-4 text-xs text-gray-400 shadow-sm"><T k="검수자 지정을 불러오는 중입니다…" /></div>;
  }

  const raw = (cfg.data as { data?: unknown } | undefined)?.data;
  const map: ReviewerMap = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ReviewerMap) : {};
  const current = Array.isArray(map[locale]) ? map[locale] : [];
  const users = unwrapList<StaffUser>(staff.data) ?? [];
  const nameOf = (id: string) => {
    const u = users.find((x) => x.id === id);
    // 🔴 이름을 못 찾으면 id 를 이름인 척 그리지 않는다
    return u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || (u.email ?? id) : null;
  };
  const mutate = (next: string[]) => save.mutate({ ...map, [locale]: next });

  return (
    <div className="space-y-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-gray-900"><T k="언어별 검수자 지정" /></h2>
        <span className="text-[11px] text-gray-400">
          <T k="설정 i18n.reviewers · 지정된 사용자는 비관리자여도 그 언어를 검수할 수 있습니다" />
        </span>
      </div>

      {current.length === 0 ? (
        <p className="text-xs text-amber-800">
          <T k="🔴 이 언어에 지정된 검수자가 없습니다 — 지금은 ADMIN 만 제안·승인할 수 있습니다(설정이 비어 있는 것이지 권한이 없는 것이 아닙니다)." />
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {current.map((id) => (
            <li key={id} className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-700">
              <span>{nameOf(id) ?? <span className="font-mono opacity-70">{id}</span>}</span>
              {nameOf(id) === null && <span className="text-[10px] text-gray-400"><T k="(이름 확인 불가)" /></span>}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => mutate(current.filter((x) => x !== id))}
                  disabled={save.isPending}
                  className="min-h-[44px] px-1 text-red-600 hover:underline disabled:opacity-40"
                  title={tAttr('이 검수자를 해제합니다')}
                >
                  <T k="해제@지정" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="min-h-[44px] rounded-lg border border-gray-200 px-2 text-xs"
            aria-label={tAttr('검수자로 지정할 직원')}
          >
            <option value="">{tAttr('직원 선택')}</option>
            {users
              .filter((u) => u.isActive !== false && !current.includes(u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {`${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || u.email || u.id}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!pick || save.isPending}
            onClick={() => { mutate([...current, pick]); setPick(''); }}
            className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            <T k="검수자로 지정" />
          </button>
          {staff.isError && (
            <span className="text-[11px] text-red-700"><T k="직원 목록을 불러오지 못했습니다 — 이름 없이 id 로만 보입니다." /></span>
          )}
          {save.isError && (
            <span className="text-[11px] text-red-700"><T k="저장하지 못했습니다 — 지정은 반영되지 않았습니다." /></span>
          )}
        </div>
      ) : (
        // 🔴 권한이 없으면 버튼을 숨기지 않고 왜 못 하는지 말한다
        <p className="pt-1 text-[11px] text-gray-500">
          <T k="검수자 지정은 ADMIN 만 할 수 있습니다 — 이 화면에서는 현재 지정 상태만 보입니다." />
        </p>
      )}
    </div>
  );
}
