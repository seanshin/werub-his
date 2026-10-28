'use client';

import { useState } from 'react';
import { genderText } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useCanManageCheckupVisit, CHECKUP_WRITE_NOTICE } from '../checkup-access';

const STATUS_LABELS: Record<string, string> = {
  RESERVED: '예약',
  CHECKED_IN: '접수',
  IN_PROGRESS: '진행중',
  EXAM_COMPLETE: '검사완료',
  PARTIAL_COMPLETE: '부분완료',
  REVIEW: '소견대기',
  COMPLETED: '완료',
  DELIVERED: '전달완료',
  CANCELLED: '취소',
  NO_SHOW: '미방문',
};

const STATUS_COLORS: Record<string, string> = {
  RESERVED: 'bg-gray-100 text-gray-700',
  CHECKED_IN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  EXAM_COMPLETE: 'bg-orange-100 text-orange-700',
  PARTIAL_COMPLETE: 'bg-yellow-100 text-yellow-700',
  REVIEW: 'bg-purple-100 text-purple-700',
  COMPLETED: 'bg-green-100 text-green-700',
  DELIVERED: 'bg-green-200 text-green-800',
  CANCELLED: 'bg-red-50 text-red-500',
  NO_SHOW: 'bg-gray-200 text-gray-500',
};

/**
 * 표시용 카탈로그 키 — 🔴 STATUS_LABELS(원문 정본)는 그대로 두고 동음이의만 문맥 키로 가른다
 * (무문맥 '접수'=부서명 Reception · '취소'=버튼 Cancel · '예약'=Appointment).
 */
const STATUS_I18N: Record<string, string> = {
  RESERVED: '예약@상태', CHECKED_IN: '접수@상태', CANCELLED: '취소@상태',
};
const statusKey = (status: string, label: string) => STATUS_I18N[status] ?? label;

export default function CheckupSchedulePage() {
  // 🔴 검진 예약·접수 쓰기 권한(정본 `checkup-access`) — 의사는 보지만 누를 수는 없던 자리
  const canManage = useCanManageCheckupVisit();
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const today = kstToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    patientId: '',
    patientName: '',
    programId: '',
    scheduledDate: today,
    selectedOptions: [] as string[],
  });

  const { data: visitsRes, isError, error, refetch } = useQuery({
    queryKey: ['checkup-schedule', selectedDate],
    queryFn: () =>
      apiClient.get<any>('/api/v1/checkup/visits', { date: selectedDate }),
  });
  const visits = visitsRes?.data ?? [];

  const { data: programsRes } = useQuery({
    queryKey: ['checkup-programs-active'],
    queryFn: () =>
      apiClient.get<any>('/api/v1/checkup/programs', { isActive: 'true' }),
  });
  const programs = programsRes?.data ?? [];

  const createVisit = useMutation({
    mutationFn: (data: any) => apiClient.post('/api/v1/checkup/visits', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-schedule'] });
      setShowCreate(false);
      toast.success('검진 예약이 생성되었습니다');
    },
    onError: () => toast.error('예약 생성 실패'),
  });

  const checkIn = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/api/v1/checkup/visits/${id}/check-in`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-schedule'] });
      toast.success('접수 완료');
    },
    onError: () => toast.error('접수 실패'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('ko-KR').format(n) + '원';

  // 주간 날짜 네비게이션
  const dateOffset = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold"><T k="검진 예약 관리" /></h1>
        {canManage ? (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <T k="+ 새 예약" />
          </button>
        ) : (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5"><T k={CHECKUP_WRITE_NOTICE} /></span>
        )}
      </div>

      {/* 날짜 선택 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSelectedDate(dateOffset(-1))}
          className="px-3 py-1.5 bg-gray-100 rounded hover:bg-gray-200 text-sm"
        >
          &lt;
        </button>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => setSelectedDate(dateOffset(1))}
          className="px-3 py-1.5 bg-gray-100 rounded hover:bg-gray-200 text-sm"
        >
          &gt;
        </button>
        <button
          onClick={() => setSelectedDate(today)}
          className="px-3 py-1.5 bg-gray-100 rounded hover:bg-gray-200 text-sm"
        >
          <T k="오늘" />
        </button>
        <span className="text-sm text-gray-500">
          {visits.length}건
        </span>
      </div>

      {/* 예약 생성 폼 */}
      {showCreate && (
        <div className="bg-white border rounded-lg p-5 space-y-4">
          <h3 className="font-semibold"><T k="새 검진 예약" /></h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                <T k="환자 검색" />
              </label>
              <PatientSelector
                value={form.patientId}
                onChange={(pid, p) => setForm({ ...form, patientId: pid, patientName: `${p.familyName}${p.givenName}` })}
                context="schedule"
                placeholder={tAttr('이름, 등록번호로 검색')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                <T k="프로그램" />
              </label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.programId}
                onChange={(e) =>
                  setForm({ ...form, programId: e.target.value })
                }
              >
                <option value="">{tAttr('선택')}</option>
                {programs.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatPrice(p.price)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                <T k="예약일" />
              </label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.scheduledDate}
                onChange={(e) =>
                  setForm({ ...form, scheduledDate: e.target.value })
                }
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() =>
                createVisit.mutate({
                  patientId: form.patientId,
                  programId: form.programId,
                  scheduledDate: form.scheduledDate,
                  selectedOptions: form.selectedOptions,
                })
              }
              disabled={!form.patientId || !form.programId}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
            >
              <T k="예약 생성" />
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 text-sm"
            >
              <T k="취소" />
            </button>
          </div>
        </div>
      )}

      {/* 예약 목록 */}
      <div className="bg-white rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left"><T k="수검자" /></th>
              <th className="px-4 py-2 text-left"><T k="프로그램" /></th>
              <th className="px-4 py-2 text-right"><T k="금액" /></th>
              <th className="px-4 py-2 text-center"><T k="상태" /></th>
              <th className="px-4 py-2 text-center"><T k="관리" /></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visits.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  <T k="해당 날짜에 예약이 없습니다" />
                </td>
              </tr>
            )}
            {visits.map((v: any) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {v.patient?.familyName}{v.patient?.givenName}
                  </div>
                  <div className="text-xs text-gray-400">
                    {v.patient?.mrn} /{' '}
                    {genderText(v.patient?.gender)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div>{v.program?.name}</div>
                  <div className="text-xs text-gray-400">{v.program?.code}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {formatPrice(v.totalPrice)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
                      STATUS_COLORS[v.status] ?? 'bg-gray-100'
                    }`}
                  >
                    <T k={statusKey(v.status, STATUS_LABELS[v.status] ?? v.status)} />
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {canManage && v.status === 'RESERVED' && (
                    <button
                      onClick={() => checkIn.mutate(v.id)}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                    >
                      <T k="접수@버튼" />
                    </button>
                  )}
                  {v.status !== 'RESERVED' && (
                    <a
                      href={`/his-checkup/visit/${v.id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      <T k="상세" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
