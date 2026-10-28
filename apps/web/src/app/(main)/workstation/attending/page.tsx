'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { EmptyState, DrugName } from '@/components/ui/display';
import { ageOf, stayDays } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

interface InpatientItem {
  id: string;
  patientId?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string; dateOfBirth?: string };
  // 🔴 서버 응답 필드명과 어긋나 있었다 — 화면은 `bed.room.roomNumber`·`bedNumber`·`admittedAt` 을
  //    읽는데 서버는 `bed.roomNumber`·`bed.bedLabel`·`admitDate` 를 준다.
  //    그래서 병실이 늘 `--?`, 재원일이 `-일째` 로 나왔다(실제 DB 에는 303-B·입원일 존재).
  bed?: { bedLabel?: string; roomNumber?: string; ward?: { name?: string } };
  admitDate?: string;
  status?: string;
  diagnosis?: string;
  attendingDoctorId?: string;
}

interface HandoffItem {
  id: string;
  patientId?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  ipassData?: Record<string, unknown>;
  status?: string;
  createdAt?: string;
}

interface PendingOrder {
  id: string;
  status: string;
  prescription?: {
    type?: string;
    encounter?: { patient?: { familyName?: string; givenName?: string; mrn?: string } };
    medicationCode?: { nameKo?: string; nameEn?: string | null; ingredient?: string | null };
    procedureCode?: { nameKo?: string };
  };
  createdAt?: string;
}

type AttendingTab = 'patients' | 'orders' | 'handoffs' | 'consults';

export default function AttendingWorkstationPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<AttendingTab>('patients');

  // 내 담당 입원 환자
  const { data: admData, isLoading: admLoading, isError, error, refetch } = useQuery({
    queryKey: ['attending-patients', user?.id],
    queryFn: () => apiClient.get<{ data: InpatientItem[] }>('/api/v1/admissions/active/list', { status: 'ACTIVE', attendingDoctorId: user?.id }),
    enabled: !!user?.id,
    refetchInterval: pollMs('normal'),
  });
  const patients: InpatientItem[] = (() => {
    const d = admData?.data;
    return Array.isArray(d) ? d : (d as Record<string, unknown> | undefined)?.data as InpatientItem[] ?? [];
  })();

  // 내 대기 오더
  const { data: orderData, isError: ordersIsError, error: ordersError, refetch: refetchOrders } = useQuery({
    queryKey: ['attending-orders', user?.id],
    queryFn: () => apiClient.get<{ data: PendingOrder[] }>('/api/v1/orders', { prescribedBy: user?.id, status: 'ORDERED' }),
    enabled: tab === 'orders' && !!user?.id,
  });
  const orders: PendingOrder[] = (() => {
    const d = orderData?.data;
    return Array.isArray(d) ? d : (d as Record<string, unknown> | undefined)?.data as PendingOrder[] ?? [];
  })();

  // 인수인계
  const { data: handoffData, isError: handoffsIsError, error: handoffsError, refetch: refetchHandoffs } = useQuery({
    queryKey: ['attending-handoffs', user?.id],
    queryFn: () => apiClient.get<{ data: HandoffItem[] }>('/api/v1/handoffs', { doctorId: user?.id }),
    enabled: tab === 'handoffs' && !!user?.id,
  });
  const handoffs: HandoffItem[] = (() => {
    const d = handoffData?.data;
    return Array.isArray(d) ? d : (d as Record<string, unknown> | undefined)?.data as HandoffItem[] ?? [];
  })();

  // 타과 협진 요청
  const { data: consultData, isError: consultsIsError, error: consultsError, refetch: refetchConsults } = useQuery({
    queryKey: ['attending-consults', user?.id],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/consultations/inbox', { limit: 30 }),
    enabled: tab === 'consults' && !!user?.id,
  });
  const consults: Record<string, unknown>[] = (() => {
    const d = consultData?.data;
    return Array.isArray(d) ? d : (d as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  // 나이·재원일수는 정본 계산 — 자체 근사(365.25 나눗셈·floor)는 생일 경계·청구 일수와 어긋난다
  const age = (dob?: string) => ageOf(dob) ?? '-';
  const daysSince = (d?: string) => stayDays(d) ?? '-';

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="👨‍⚕️ 주치의 워크스테이션" /></h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {user?.familyName}{user?.givenName} · 담당 환자 {patients.length}명 · 30초 갱신
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-blue-600">{patients.length}</div>
          <div className="text-[10px] text-gray-500"><T k="담당 환자" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-amber-600">{orders.length || '-'}</div>
          <div className="text-[10px] text-gray-500"><T k="대기 오더" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-violet-600">{consults.length || '-'}</div>
          <div className="text-[10px] text-gray-500"><T k="협진 요청" /></div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-lg font-bold text-emerald-600">{handoffs.length || '-'}</div>
          <div className="text-[10px] text-gray-500"><T k="인수인계" /></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {([
          { k: 'patients' as const, l: `담당 환자 (${patients.length})` },
          { k: 'orders' as const, l: '대기 오더' },
          { k: 'consults' as const, l: '협진 요청' },
          { k: 'handoffs' as const, l: '인수인계' },
        ]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              tab === t.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}>{t.l}</button>
        ))}
      </div>

      {/* Patients Tab */}
      {tab === 'patients' && (
        admLoading ? <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div> :
        patients.length === 0 ? <EmptyState icon="🛏️" title="담당 입원 환자가 없습니다" /> :
        <div className="space-y-2">
          {patients.map(p => (
            <Link key={p.id} href={`/inpatient/${p.id}`}
              className="block bg-white border rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50/30 transition">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                    {p.bed?.roomNumber && p.bed?.bedLabel
                      ? `${p.bed.roomNumber}-${p.bed.bedLabel}`
                      : '병상 미배정'}
                  </div>
                  <div>
                    <span className="font-bold text-gray-900">{p.patient?.familyName}{p.patient?.givenName}</span>
                    <span className="ml-2 text-xs text-gray-400">{p.patient?.mrn} · {age(p.patient?.dateOfBirth)}세</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-500">입원 {daysSince(p.admitDate)}일째</span>
                  <div className="text-[10px] text-gray-400">{p.bed?.ward?.name}</div>
                </div>
              </div>
              {p.diagnosis && <p className="text-xs text-gray-600 mt-1 truncate">{p.diagnosis}</p>}
            </Link>
          ))}
        </div>
      )}

      {/* Orders Tab */}
      {tab === 'orders' && (
        ordersIsError ? <QueryErrorFallback error={ordersError} onRetry={refetchOrders} /> :
        orders.length === 0 ? <EmptyState icon="📋" title="대기 중인 오더가 없습니다" /> :
        <div className="space-y-2">
          {orders.map(o => {
            const pt = o.prescription?.encounter?.patient;
            const name = o.prescription?.medicationCode?.nameKo ?? o.prescription?.procedureCode?.nameKo ?? '처방';
            return (
              <div key={o.id} className="bg-white border rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                    o.prescription?.type === 'MEDICATION' ? 'bg-blue-100 text-blue-700' :
                    o.prescription?.type === 'LAB' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
                  }`}>{o.prescription?.type ?? 'ORDER'}</span>
                  <div>
                    <span className="text-sm font-medium text-gray-900">{o.prescription?.medicationCode ? <DrugName nameKo={o.prescription.medicationCode.nameKo} nameEn={o.prescription.medicationCode.nameEn} ingredient={o.prescription.medicationCode.ingredient} /> : name}</span>
                    {pt && <span className="ml-2 text-xs text-gray-400">{pt.familyName}{pt.givenName}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-amber-600 font-semibold bg-amber-100 px-2 py-0.5 rounded-full whitespace-nowrap"><T k="대기" /></span>
              </div>
            );
          })}
        </div>
      )}

      {/* Consults Tab */}
      {tab === 'consults' && (
        consultsIsError ? <QueryErrorFallback error={consultsError} onRetry={refetchConsults} /> :
        consults.length === 0 ? <EmptyState icon="🤝" title="협진 요청이 없습니다" /> :
        <div className="space-y-2">
          {consults.map(c => (
            <div key={String(c.id)} className="bg-white border border-amber-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-900">의뢰: {String(c.reason ?? '-')}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                  c.urgency === 'EMERGENT' ? 'bg-red-100 text-red-700' : c.urgency === 'URGENT' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                }`}>{c.urgency === 'EMERGENT' ? '응급' : c.urgency === 'URGENT' ? '긴급' : '일반'}</span>
              </div>
              {c.clinicalQuestion ? <p className="text-xs text-gray-600">{String(c.clinicalQuestion)}</p> : null}
              <p className="text-[10px] text-gray-400 mt-1">
                의뢰과: {String((c.requestingDoctor as Record<string, unknown>)?.department ?? '-')}
                · {c.createdAt ? kdate(String(c.createdAt)) : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Handoffs Tab */}
      {tab === 'handoffs' && (
        handoffsIsError ? <QueryErrorFallback error={handoffsError} onRetry={refetchHandoffs} /> :
        handoffs.length === 0 ? <EmptyState icon="🔄" title="인수인계 기록이 없습니다" /> :
        <div className="space-y-2">
          {handoffs.map(h => (
            <Link key={h.id} href="/handoffs" className="block bg-white border rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{h.patient?.familyName}{h.patient?.givenName}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                  h.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                }`}>{h.status === 'PENDING' ? '대기' : '완료'}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{h.createdAt ? kdate(h.createdAt) : ''}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
