'use client';

import { When } from './ext/RowListWidget';
import Link from 'next/link';
import { T, Tf } from '@/components/ui/i18n-text';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';
import { useAuthStore } from '@/stores/auth-store';

interface OrderResult {
  id: string;
  patientId?: string;
  department?: string;
  patient?: { familyName: string; givenName: string };
  prescription?: {
    encounter?: { patient?: { id: string; familyName: string; givenName: string } };
    procedureCode?: { nameKo: string };
    medicationCode?: { nameKo: string };
  };
  testName?: string;
  orderName?: string;
  name?: string;
  itemName?: string;
  completedAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

/** 검사결과 확인함 응답(서버 `DoctorsService.getResultsInbox`) 중 위젯이 쓰는 부분 */
interface InboxItem {
  orderId: string;
  department: string;
  completedAt: string | null;
  severity: 'CRITICAL' | 'ABNORMAL' | 'NORMAL' | 'UNJUDGED' | 'NO_FLAG';
  testName: string | null;
  patient: { id: string; familyName: string; givenName: string } | null;
}
interface InboxResponse { total: number; counts: { critical: number; abnormal: number; other: number }; items: InboxItem[] }

const unwrap = <X,>(r: unknown): X => ((r as { data?: X })?.data ?? r) as X;

/**
 * 검사결과 도착 위젯.
 *
 * 🔴 (2026-09-30) 종전엔 `/orders?...&mine=true` 를 보냈는데 서버가 `mine` 을 **조용히 무시**해
 *    의사 대시보드에 **병원 전체** 완료 결과가 "내 결과"처럼 떴다. 개수도 10+5건으로 잘린 수를 "N건"이라 말했다.
 *    → 의사·관리자: 검사결과 확인함(내 오더 · 미확인 · 총 건수는 서버가 센다)
 *    → 검사실: 병원 전체 최근 완료분이라고 **밝히고** 보여준다(검사실에게 "내 오더"는 없다)
 */
export default function LabResultsWidget({ settings }: { settings?: Record<string, unknown> }) {
  const maxItems = (settings?.maxItems as number) ?? 8;
  const role = useAuthStore((s) => s.user?.role);
  const isInbox = role === 'DOCTOR' || role === 'ADMIN';
  return isInbox ? <InboxView maxItems={maxItems} /> : <HospitalRecentView maxItems={maxItems} />;
}

function InboxView({ maxItems }: { maxItems: number }) {
  const { data, isError } = useQuery({
    queryKey: ['results-inbox', 'widget', maxItems],
    queryFn: async () => unwrap<InboxResponse>(await apiClient.get(`/api/v1/doctors/results-inbox?limit=${Math.min(Math.max(maxItems, 1), 100)}`)),
    refetchInterval: pollMs('fast'),
  });
  const items = data?.items ?? [];
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {data && data.total > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              <Tf k="미확인 {건수}건" params={{ 건수: data.total }} />
            </span>
          )}
          {data && data.counts.critical > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white"><T k="위급" /> {data.counts.critical}</span>
          )}
        </div>
        <Link href="/doctor-inbox?tab=results" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="확인하러 가기" /> →</Link>
      </div>
      {isError ? (
        <p className="text-xs text-red-600 py-2 text-center"><T k="결과 조회 실패 — ‘없음’이 아니라" /> <b><T k="확인 불가" /></b></p>
      ) : !data ? (
        <div className="h-10 bg-gray-50 rounded animate-pulse" />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 py-2 text-center"><T k="확인할 결과가 없습니다." /></p>
      ) : (
        <div className="divide-y divide-gray-50">
          {items.slice(0, maxItems).map((r) => (
            <Link
              key={r.orderId}
              href={r.patient ? `/patients/${r.patient.id}` : '/doctor-inbox?tab=results'}
              className="flex items-center justify-between py-1.5 px-1 hover:bg-emerald-50 transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${
                  r.department === 'IMAGING' ? 'bg-pink-100 text-pink-700' : 'bg-indigo-100 text-indigo-700'
                }`}>
                  <T k={r.department === 'IMAGING' ? '영상' : '검사'} />
                </span>
                {(r.severity === 'CRITICAL' || r.severity === 'ABNORMAL') && (
                  <span className={`text-[10px] font-bold ${r.severity === 'CRITICAL' ? 'text-red-600' : 'text-orange-600'}`}>
                    <T k={r.severity === 'CRITICAL' ? '위급' : '이상'} />
                  </span>
                )}
                <span className="text-xs font-medium text-gray-900">{r.patient ? `${r.patient.familyName}${r.patient.givenName}` : '-'}</span>
                <span className="text-[11px] text-gray-500 truncate max-w-[200px]">{r.testName ?? '-'}</span>
              </div>
              {/* 🔴 (2026-10-02) 시각만 그리면 8월 결과가 "오늘 12:55"로 읽혔다 — 오늘이 아니면 날짜 */}
              <span className="text-[10px] text-gray-400">{r.completedAt ? <When at={r.completedAt} /> : '-'}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function HospitalRecentView({ maxItems }: { maxItems: number }) {
  // 🔴 종전 `.catch(() => ({ data: [] }))` — 조회 실패가 **"새 검사결과 없음"** 으로 둔갑했다(P17).
  const { data: labData, isError: labErr } = useQuery({
    queryKey: ['orders-lab-completed', 'hospital'],
    queryFn: () => apiClient.get<{ data: OrderResult[] }>('/api/v1/orders?department=LAB&status=COMPLETED&limit=10'),
    refetchInterval: pollMs('fast'),
  });
  const { data: imgData, isError: imgErr } = useQuery({
    queryKey: ['orders-imaging-completed', 'hospital'],
    queryFn: () => apiClient.get<{ data: OrderResult[] }>('/api/v1/orders?department=IMAGING&status=COMPLETED&limit=5'),
    refetchInterval: pollMs('fast'),
  });

  const labResults: OrderResult[] = Array.isArray(labData?.data) ? labData.data : [];
  const imagingResults: OrderResult[] = Array.isArray(imgData?.data) ? imgData.data : [];
  const allResults = [...labResults, ...imagingResults].sort((a, b) => {
    const dA = new Date(a.completedAt ?? a.updatedAt ?? a.createdAt ?? 0).getTime();
    const dB = new Date(b.completedAt ?? b.updatedAt ?? b.createdAt ?? 0).getTime();
    return dB - dA;
  });

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-500"><T k="병원 전체 최근 완료분(검사 10·영상 5건까지)" /></span>
        <Link href="/orders" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="확인하러 가기" /> →</Link>
      </div>
      {(labErr || imgErr) ? (
        <p className="text-xs text-red-600 py-2 text-center"><T k="결과 조회 실패 — ‘없음’이 아니라" /> <b><T k="확인 불가" /></b></p>
      ) : allResults.length === 0 ? (
        <p className="text-xs text-gray-400 py-2 text-center"><T k="새 검사결과 없음" /></p>
      ) : (
        <div className="divide-y divide-gray-50">
          {allResults.slice(0, maxItems).map((r) => (
            <Link
              key={r.id}
              href={`/patients/${r.patientId || r.prescription?.encounter?.patient?.id || ''}`}
              className="flex items-center justify-between py-1.5 px-1 hover:bg-emerald-50 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${
                  r.department === 'IMAGING' ? 'bg-pink-100 text-pink-700' : 'bg-indigo-100 text-indigo-700'
                }`}>
                  <T k={r.department === 'IMAGING' ? '영상' : '검사'} />
                </span>
                <span className="text-xs font-medium text-gray-900">
                  {r.patient?.familyName ?? r.prescription?.encounter?.patient?.familyName ?? ''}{r.patient?.givenName ?? r.prescription?.encounter?.patient?.givenName ?? ''}
                </span>
                <span className="text-[11px] text-gray-500 truncate max-w-[200px]">
                  {r.testName ?? r.orderName ?? r.name ?? r.itemName ?? r.prescription?.procedureCode?.nameKo ?? r.prescription?.medicationCode?.nameKo ?? '-'}
                </span>
              </div>
              <span className="text-[10px] text-gray-400">
                {(r.completedAt || r.updatedAt || r.createdAt)
                  ? <When at={r.completedAt ?? r.updatedAt ?? r.createdAt ?? ''} />
                  : '-'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
