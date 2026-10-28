'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { safeFormat as format } from '@/lib/safe-date';
import { T, useTAttr } from '@/components/ui/i18n-text';

const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  CREATE: { label: '생성', color: 'bg-emerald-50 text-emerald-700' },
  READ:   { label: '조회', color: 'bg-blue-50 text-blue-700' },
  UPDATE: { label: '수정', color: 'bg-amber-50 text-amber-700' },
  DELETE: { label: '삭제', color: 'bg-red-50 text-red-700' },
};

const RESOURCE_LABEL: Record<string, string> = {
  Patient: '환자', Encounter: '진료', Prescription: '처방', Billing: '수납',
  Appointment: '예약', Order: '오더', User: '사용자', Admission: '입원',
  // 직원 접속기록(의료법 §23④) — action 은 CREATE=로그인 / DELETE=로그아웃 으로 읽는다.
  // 🔴 성공과 실패는 resourceType 이 다르다. 이 화면은 changes 를 렌더하지 않으므로
  //    한 벌로 묶으면 실패가 성공처럼 보인다(그래서 나누어 놓았다).
  AuthSession: '로그인/로그아웃', AuthLoginFailure: '로그인 실패',
  PrintAttempt: '인쇄 시도',
};

/**
 * 행위 배지 — AuditAction 은 CRUD 4종뿐이라 접속 사건은 resourceType 과 함께 읽어야 뜻이 산다.
 * '생성/삭제'로 표시하면 로그인·로그아웃이 화면에서 무슨 일인지 사라진다.
 */
function actionBadge(action: string, resourceType: string): { label: string; color: string } {
  if (resourceType === 'AuthSession') {
    if (action === 'CREATE') return { label: '로그인', color: 'bg-indigo-50 text-indigo-700' };
    if (action === 'DELETE') return { label: '로그아웃', color: 'bg-slate-100 text-slate-600' };
  }
  if (resourceType === 'AuthLoginFailure') return { label: '로그인 실패', color: 'bg-red-50 text-red-700' };
  return ACTION_LABEL[action] ?? { label: action, color: 'bg-gray-100 text-gray-600' };
}

interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  timestamp: string;
  ipAddress?: string;
  user?: { familyName?: string; givenName?: string };
}

interface AuditPagination {
  total: number;
  hasMore: boolean;
}

interface AuditResourceCount {
  resource: string;
  count: number;
}

/**
 * 🔴 W8 — 통계는 감사 대시보드와 **같은 엔드포인트**(`/api/v1/audit/dashboard`)를 쓴다.
 * 종전에는 이 화면만 `/api/v1/audit/stats` 를 봐서
 *  ① 외부 SMART 앱 접근 27,102건을 통째로 누락하고도 '전체 로그'라 불렀고,
 *  ② 리소스 유형을 상위 10종만 받아 "10"이라 표시했다(실제 104종 — 94종은 필터조차 불가).
 * 같은 사실에 정본이 둘이 되면 두 화면이 서로 다른 숫자를 말한다(W7 에서 대시보드만 고친 결과).
 */
interface AuditStats {
  totalAccess?: number;
  smartAccess?: number;
  totalAccessAllChannels?: number;
  last24hAudit?: number;
  last24hSmart?: number;
  last24hAllChannels?: number;
  byResource?: AuditResourceCount[];
  byAction?: { action: string; count: number }[];
}

export default function AuditPage() {
  const tAttr = useTAttr();
  /** UI 크롬 언어(P2-7) — 라벨 Record 는 ko 정본 그대로, 렌더에서만 `원문@감사` 키로 카탈로그를 본다.
   *  한글이 아닌 폴백(원시 코드값)은 번역 대상이 아니므로 그대로 둔다. */
  const L = (s: string) => (/[가-힣]/.test(s) ? <T k={`${s}@감사`} /> : <>{s}</>);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit-logs', page, actionFilter, resourceFilter],
    queryFn: () => apiClient.get<{ data: AuditLog[]; pagination: AuditPagination }>('/api/v1/audit', {
      page, limit: 30,
      ...(actionFilter ? { action: actionFilter } : {}),
      ...(resourceFilter ? { resourceType: resourceFilter } : {}),
    }),
  });

  // 감사 대시보드와 같은 정본(anomaly-detection.getDashboardStats) — 새 병합 로직을 만들지 않는다.
  const { data: stats } = useQuery({
    queryKey: ['audit-dashboard-stats'],
    queryFn: () => apiClient.get<{ data: AuditStats }>('/api/v1/audit/dashboard'),
  });

  const _logsRaw = data?.data;
  const logs: AuditLog[] = Array.isArray(_logsRaw) ? _logsRaw : (_logsRaw as unknown as Record<string, unknown>)?.data as AuditLog[] ?? [];
  const pagination = data?.pagination;
  const _statsRaw = stats?.data;
  const st: AuditStats = ((_statsRaw as unknown as Record<string, unknown>)?.data as AuditStats) ?? (_statsRaw as AuditStats) ?? {};

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="감사 로그" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="시스템 접근 및 데이터 변경 이력" /></p>
      </div>

      {/* Stats — 감사 대시보드와 같은 분모(내부 감사 + 외부 SMART 앱) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{st.totalAccessAllChannels?.toLocaleString() ?? '-'}</p>
          <p className="text-[11px] font-medium text-gray-500 mt-1"><T k="전체 접근(내부+외부 앱)" /></p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            <T k="내부" /> {st.totalAccess?.toLocaleString() ?? '-'} · <T k="SMART 앱" /> {st.smartAccess?.toLocaleString() ?? '-'}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{st.last24hAllChannels?.toLocaleString() ?? '-'}</p>
          <p className="text-[11px] font-medium text-blue-600 mt-1"><T k="최근 24시간" /></p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            <T k="내부" /> {st.last24hAudit?.toLocaleString() ?? '-'} · <T k="SMART 앱" /> {st.last24hSmart?.toLocaleString() ?? '-'}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{st.byResource?.length ?? '-'}</p>
          <p className="text-[11px] font-medium text-gray-500 mt-1"><T k="리소스 유형" /></p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{st.byAction?.length ?? '-'}</p>
          <p className="text-[11px] font-medium text-gray-500 mt-1"><T k="액션 유형" /></p>
        </div>
      </div>

      {/* 🔴 아래 목록은 내부 감사 로그(AuditLog)만 보여준다 — 외부 SMART 앱 접근은 별도 원장이라
          이 표에 섞이지 않는다. 카드 수치와 표의 총계가 다른 이유를 화면이 직접 말한다. */}
      <p className="text-xs text-gray-500 mb-3">
        아래 목록은 <b>내부 감사 로그</b>만 표시합니다. 외부 SMART 앱 접근({st.smartAccess?.toLocaleString() ?? '-'}건)은
        별도 원장에 기록되며 <a href="/admin/smart-clients" className="text-blue-600 hover:underline">외부 앱 접근</a>에서 확인합니다.
      </p>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{tAttr('전체 액션')}</option>
          <option value="CREATE">{tAttr('생성@감사')}</option>
          <option value="READ">{tAttr('조회@감사')}</option>
          <option value="UPDATE">{tAttr('수정@감사')}</option>
          <option value="DELETE">{tAttr('삭제@감사')}</option>
        </select>
        <select
          value={resourceFilter}
          onChange={(e) => { setResourceFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{tAttr('전체 리소스')}</option>
          {/* 🔴 상위 10종만 받던 것을 전량으로 — 94종은 필터 목록에 없어 아예 조회할 수 없었다 */}
          {(st.byResource ?? []).map((r) => (
            <option key={r.resource} value={r.resource}>
              {RESOURCE_LABEL[r.resource] ? tAttr(`${RESOURCE_LABEL[r.resource]}@감사`) : r.resource} ({r.count})
            </option>
          ))}
        </select>
      </div>

      {/* Log Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-5 space-y-3">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        ) : !logs.length ? (
          <div className="p-12 text-center">
            <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108" />
            </svg>
            <p className="text-sm text-gray-400"><T k="감사 로그가 없습니다." /></p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 w-36"><T k="시간" /></th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 w-20"><T k="액션" /></th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 w-24"><T k="리소스" /></th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500"><T k="사용자" /></th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 w-28">IP</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500"><T k="리소스 ID" /></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const ac = actionBadge(log.action, log.resourceType);
                  return (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                      <td className="py-2.5 px-4 text-xs text-gray-500 font-mono">
                        {format(new Date(log.timestamp), 'MM-dd HH:mm:ss')}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${ac.color}`}>{L(ac.label)}</span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-gray-600">
                        {RESOURCE_LABEL[log.resourceType] ? L(RESOURCE_LABEL[log.resourceType]) : log.resourceType}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-slate-600">{log.user?.familyName?.charAt(0)}</span>
                          </div>
                          <span className="text-sm text-gray-900">{log.user?.familyName}{log.user?.givenName}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-gray-400 font-mono">{log.ipAddress ?? '-'}</td>
                      <td className="py-2.5 px-4 text-xs text-gray-400 font-mono truncate max-w-[120px]">{log.resourceId?.slice(0, 8)}...</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pagination && pagination.total > 30 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                <span><T k="총" /> {pagination.total.toLocaleString()}<Unit>건</Unit></span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page<=1} className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30 text-xs"><T k="이전" /></button>
                  <span className="px-3 py-1 text-xs">{page} / {Math.ceil(pagination.total/30)}</span>
                  <button onClick={() => setPage(p => p+1)} disabled={!pagination.hasMore} className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30 text-xs"><T k="다음" /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
