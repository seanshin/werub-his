'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { USER_ROLE_LABEL } from '@hospital-run/shared';

/**
 * 역할×권한 매트릭스 — 코드 기본값을 관리 화면에서 **역할 단위로 조정**한다.
 *
 * 화면이 답해야 하는 질문은 둘이다: "이 역할이 지금 무엇을 할 수 있나", "기본값에서 무엇을 바꿨나".
 * 그래서 셀은 3상태(기본 허용 / 기본 거부 / **관리자가 바꾼 값**)로 구분해 보여준다.
 *
 * 🔴 UI 언어 배선(2026-09-09): 역할명은 shared 정본 `USER_ROLE_LABEL` 값 문자열을 키로 `<T>` 에 넘긴다
 *    (Record 를 화면에서 재정의하지 않는다 — 정본이 둘이면 갈라진다).
 * 🔴 **권한 도메인/항목 라벨·힌트(`d.label`·`p.label`·`p.hint`)는 서버 응답**이라 배선하지 않았다 —
 *    기획 §2.1 이 BE 응답 문구를 이번 스코프 밖으로 두었고, 여기서 카탈로그에 베끼면 BE 가 문구를
 *    고치는 순간 죽은 키가 된다(정본이 둘이면 갈라진다). 한국어 원문 그대로가 현재의 사실이다.
 */
interface PermMeta { key: string; label: string; hint: string; sensitive?: boolean }
interface Domain { key: string; label: string; permissions: PermMeta[] }
interface RoleRow { key: string; locked: boolean; defaults: string[]; effective: { key: string; allowed: boolean; overridden: boolean }[] }
/**
 * 🔴 집행 등급 — 서버가 소스를 기계 스캔해 내려준다(손으로 적은 표가 아니다).
 *  matrix      = 이 화면의 토글이 실제 판정에 쓰인다
 *  other-guard = 다른 가드가 판정한다 → 이 토글은 무효
 *  none        = 집행점이 없다 → 켜도 꺼도 달라지는 API 가 없다
 */
type EnforcementMode = 'matrix' | 'other-guard' | 'none';
interface Enforcement { mode: EnforcementMode; count: number; files: string[]; note: string | null }
interface Matrix {
  domains: Domain[];
  roles: RoleRow[];
  overrides: Record<string, Record<string, boolean>>;
  uncataloged: string[];
  enforcement?: Record<string, Enforcement>;
  enforcementSummary?: { total: number; matrix: number; otherGuard: number; none: number };
}

export default function RbacMatrixPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [openDomains, setOpenDomains] = useState<string[]>(['patient']);

  const { data, isLoading } = useQuery({
    queryKey: ['rbac-matrix'],
    queryFn: () => apiClient.get<{ data: Matrix }>('/api/v1/admin/rbac/matrix'),
  });
  const m = ((data?.data as unknown as { data?: Matrix })?.data ?? data?.data) as Matrix | undefined;

  const setOverride = useMutation({
    mutationFn: (v: { role: string; permission: string; allow: boolean | null }) =>
      apiClient.put('/api/v1/admin/rbac/override', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rbac-matrix'] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tAttr('변경하지 못했습니다')),
  });

  const resetRole = useMutation({
    mutationFn: (role?: string) => apiClient.post('/api/v1/admin/rbac/reset', role ? { role } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rbac-matrix'] }); toast.success(tAttr('기본값으로 되돌렸습니다')); },
  });

  const roleState = useMemo(() => {
    const map = new Map<string, Map<string, { allowed: boolean; overridden: boolean }>>();
    for (const r of m?.roles ?? []) map.set(r.key, new Map(r.effective.map((e) => [e.key, e])));
    return map;
  }, [m]);

  const overrideCount = (role: string) => Object.keys(m?.overrides?.[role] ?? {}).length;

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400"><T k="권한 매트릭스를 불러오는 중…" /></div>;
  if (!m) return <EmptyState icon="🔐" title="권한 매트릭스를 불러오지 못했습니다" />;

  const roles = m.roles;
  const enf = (key: string): Enforcement | undefined => m.enforcement?.[key];
  const sum = m.enforcementSummary;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900"><T k="역할 권한" /></h2>
          <p className="mt-0.5 text-xs text-gray-500">
            <T k="코드 기본값 위에 **역할별 조정**을 얹습니다 — 셀을 눌러 허용/차단을 바꾸고, 되돌리면 기본값으로 복귀합니다." />
          </p>
        </div>
        <button
          onClick={() => { if (confirm(tAttr('모든 역할의 조정값을 지우고 기본값으로 되돌릴까요?'))) resetRole.mutate(undefined); }}
          className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <T k="전체 초기화" />
        </button>
      </div>

      {/* 범례 — 셀 3상태를 먼저 알려준다 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500" /> <T k="허용" /></span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-gray-200" /> <T k="거부" /></span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-blue-500 ring-2 ring-blue-200" /> <T k="관리자 조정(기본값과 다름)" /></span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-gray-100 ring-1 ring-inset ring-gray-300" /> <T k="미집행(토글해도 안 바뀜)" /></span>
        <span className="ml-auto text-gray-400"><T k="관리자 역할은 잠금 방지를 위해 조정할 수 없습니다" /></span>
      </div>

      {/*
        🔴 이 화면이 저지르던 P17(근거 없이 안심시킴): 켜도 꺼도 아무 API 도 달라지지 않는 권한을
           평범한 초록/회색 토글로 보여줬다. 이제 분모를 먼저 말한다 — 몇 개가 실제로 집행되는가.
      */}
      {sum && (
        <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-[11px] text-gray-600">
          <span className="font-semibold text-gray-900"><T k="이 매트릭스가 실제로 판정하는 권한" /> {sum.matrix}<Unit><T k="개" /></Unit></span>
          <span className="text-gray-400"> / <T k="전체" /> {sum.total}<Unit><T k="개" /></Unit></span>
          {(sum.otherGuard > 0 || sum.none > 0) && (
            <span className="ml-2 text-amber-700">
              — 나머지 {sum.otherGuard + sum.none}<Unit>개</Unit>는 이 화면으로 바뀌지 않습니다
              (다른 가드가 판정 {sum.otherGuard}<Unit>개</Unit> · 집행점 없음 {sum.none}<Unit>개</Unit>).
            </span>
          )}
          <span className="ml-1 text-gray-400"><T k="집행 여부는 서버가 소스를 스캔해 판정합니다(수기 표 아님)." /></span>
        </div>
      )}

      {m.uncataloged.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          설명이 없는 권한 {m.uncataloged.length}건: {m.uncataloged.join(', ')} — <T k="카탈로그에 라벨을 추가하세요." />
        </p>
      )}

      {m.domains.map((d) => {
        const open = openDomains.includes(d.key);
        return (
          <section key={d.key} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <button
              onClick={() => setOpenDomains((prev) => (open ? prev.filter((k) => k !== d.key) : [...prev, d.key]))}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
            >
              <span className="text-sm font-semibold text-gray-900">{d.label}</span>
              <span className="text-[11px] text-gray-400">{d.permissions.length}<Unit><T k="개" /></Unit> <T k="권한" /></span>
              <span className="ml-auto text-gray-400">{open ? '−' : '+'}</span>
            </button>

            {open && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full min-w-[900px] text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="px-3 py-2 text-left font-medium text-gray-500"><T k="권한" /></th>
                      {roles.map((r) => (
                        <th key={r.key} className="px-2 py-2 text-center font-medium text-gray-500">
                          <div className="whitespace-nowrap"><T k={USER_ROLE_LABEL[r.key] ?? r.key} /></div>
                          {overrideCount(r.key) > 0 && (
                            <button
                              onClick={() => resetRole.mutate(r.key)}
                              title={`${overrideCount(r.key)}건 조정됨 — 이 역할만 기본값으로`}
                              className="mt-0.5 rounded bg-blue-50 px-1 text-[9px] font-semibold text-blue-600 hover:bg-blue-100"
                            >
                              <T k="조정" /> {overrideCount(r.key)} ↺
                            </button>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.permissions.map((p) => {
                      const e = enf(p.key);
                      // 🔴 집행되지 않는 권한은 토글을 잠근다 — 누를 수 있게 두면 "차단했다"는 착각을 준다.
                      const ineffective = !!e && e.mode !== 'matrix';
                      return (
                      <tr key={p.key} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/40 ${ineffective ? 'bg-gray-50/70' : ''}`}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-medium ${ineffective ? 'text-gray-500' : 'text-gray-800'}`}>{p.label}</span>
                            {p.sensitive && (
                              <span className="rounded bg-rose-50 px-1 text-[9px] font-semibold text-rose-600" title={tAttr('되돌리기 어렵거나 민감한 권한')}><T k="민감" /></span>
                            )}
                            {e?.mode === 'other-guard' && (
                              <span className="rounded bg-amber-50 px-1 text-[9px] font-semibold text-amber-700" title={tAttr('다른 가드가 판정 — 이 화면의 토글은 무효')}><T k="다른 가드가 판정" /></span>
                            )}
                            {e?.mode === 'none' && (
                              <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold text-gray-600" title={tAttr('이 권한을 읽는 집행점이 소스에 없다')}><T k="집행점 없음" /></span>
                            )}
                            {e?.mode === 'matrix' && (
                              <span className="rounded bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-700" title={`집행점 ${e.count}곳: ${e.files.slice(0, 5).join(', ')}${e.files.length > 5 ? ` 외 ${e.files.length - 5}` : ''}`}>
                                <T k="집행" /> {e.count}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">{p.hint}</div>
                          {ineffective && (
                            <div className="mt-0.5 text-[10.5px] leading-relaxed text-amber-700">
                              <T k="이 항목은 이 화면으로 바뀌지 않습니다" />{e?.note ? ` — ${e.note}` : ''}
                            </div>
                          )}
                        </td>
                        {roles.map((r) => {
                          const st = roleState.get(r.key)?.get(p.key);
                          const allowed = st?.allowed ?? false;
                          const overridden = st?.overridden ?? false;
                          return (
                            <td key={r.key} className="px-2 py-2 text-center">
                              <button
                                disabled={r.locked || ineffective || setOverride.isPending}
                                title={
                                  ineffective
                                    ? `${tAttr('이 권한은 이 매트릭스로 집행되지 않습니다')}${e?.note ? ` — ${e.note}` : ''}`
                                    : r.locked ? tAttr('관리자 역할은 조정할 수 없습니다')
                                    : overridden ? tAttr('관리자 조정값 — 다시 누르면 기본값으로')
                                    : allowed ? tAttr('허용 → 차단') : tAttr('거부 → 허용')
                                }
                                onClick={() => {
                                  // 3상태 순환: 기본 → 반대값(조정) → 기본 복귀
                                  const next = overridden ? null : !allowed;
                                  setOverride.mutate({ role: r.key, permission: p.key, allow: next });
                                }}
                                className={`h-6 w-10 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                  // 🔴 미집행 권한은 초록(허용)으로 칠하지 않는다 — 색이 "이대로 통제된다"를 뜻해버린다
                                  ineffective
                                    ? 'bg-gray-100 ring-1 ring-inset ring-gray-300'
                                    : overridden
                                    ? allowed ? 'bg-blue-500 ring-2 ring-blue-200' : 'bg-blue-100 ring-2 ring-blue-200'
                                    : allowed ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-gray-200 hover:bg-gray-300'
                                }`}
                              >
                                <span className={`text-[10px] font-bold ${ineffective ? 'text-gray-400' : overridden && !allowed ? 'text-blue-600' : 'text-white'}`}>
                                  {/* 미집행이면 O/X 라고 단정하지 않는다 — 판정하는 주체가 여기가 아니다 */}
                                  {ineffective ? '–' : allowed ? 'O' : 'X'}
                                </span>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <p className="text-[11px] text-gray-400">
        <T k="변경은 즉시 적용되며 감사에 기록됩니다(누가 어떤 역할의 어떤 권한을 바꿨는지). 기본 매트릭스 정본은" />
        <span className="mx-1 font-mono">docs/05-reference/patient-access-matrix.md</span><T k="입니다." />
      </p>
    </div>
  );
}
