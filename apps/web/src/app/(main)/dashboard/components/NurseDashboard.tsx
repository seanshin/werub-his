'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Ratio, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useShiftBoundaries, shiftOf } from '@/lib/shift';
import { bedStatusSummary } from '@/lib/widget-summaries';
import { useHasRole } from '@/hooks/use-admin-write';
import { When } from './widgets/ext/RowListWidget';

interface MedAdmin {
  id: string;
  scheduledAt: string;
  patientName: string;
  room: string;
  medication: string;
  route?: string;
  overdueMinutes: number;
  severity: 'high' | 'medium' | 'low';
}

interface InpatientItem {
  id: string;
  patient?: { familyName: string; givenName: string; id: string };
  bed?: { roomNumber: string; bedNumber: string; ward?: { name: string } };
  ward?: string | { name: string };
  roomNumber?: string;
  bedNumber?: string;
  admitDate?: string;
  admitReason?: string;
  dietType?: string;
  diet?: string;
}

interface HandoffItem {
  id: string;
  type?: string;
  summary?: string;
  createdAt?: string;
  acknowledgedAt?: string;
  pendingItems?: { patientName?: string; content?: string; priority?: string }[];
  patient?: { id?: string; familyName?: string; givenName?: string; mrn?: string };
  fromDoctor?: { id?: string; familyName?: string; givenName?: string };
  toDoctor?: { id?: string; familyName?: string; givenName?: string };
  // legacy compat
  fromShift?: string;
  toShift?: string;
  items?: { patientName?: string; content?: string; priority?: string }[];
  author?: { familyName?: string; givenName?: string };
}


interface ApiWrapper<T> { data?: T }

const SHIFT_LABEL: Record<string, string> = { DAY: '주간(D)', EVENING: '초번(E)', NIGHT: '야간(N)' };
const SHIFT_COLOR: Record<string, string> = { DAY: 'bg-amber-100 text-amber-700', EVENING: 'bg-blue-100 text-blue-700', NIGHT: 'bg-indigo-100 text-indigo-700' };

export default function NurseDashboard() {
  const tt = useTAttr();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showHandoffForm, setShowHandoffForm] = useState(false);

  // 내 배정 환자 — 🔴 (2026-10-02) 종전 '담당 환자'는 `/inpatient`(병원 전체 입원) 수였다(내 것이 아닌 것을 "담당"이라 말함)
  //    서버 @Roles = NURSE·ADMIN — 그 밖의 역할은 묻지 않는다(이 패널은 간호 배치에만 있지만 스캐너는 화면 단위로 본다)
  const canSeeAssignments = useHasRole('NURSE', 'ADMIN');
  const { data: assignData, isError: assignIsError } = useQuery({
    queryKey: ['nurse-assignments-my'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/nurse-station/assignments/my'),
    enabled: canSeeAssignments,
    refetchInterval: pollMs('normal'),
  });

  // 병동 현황
  const { data: bedsData, isError: bedsIsError, error: bedsError, refetch: refetchBeds } = useQuery({
    queryKey: ['beds-status'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/beds/status'),
    refetchInterval: pollMs('fast'),
  });

  // 입원 환자
  const { data: inpatientData, isError: inpatientIsError, error: inpatientError, refetch: refetchInpatient } = useQuery({
    queryKey: ['nurse-inpatient'],
    queryFn: () => apiClient.get<{ data: InpatientItem[] }>('/api/v1/inpatient'),
    refetchInterval: pollMs('normal'),
  });

  // 투약 스케줄 (오늘 미투여)
  // 🔴 종전 `/orders?status=PENDING` 은 OrderStatus 에 없는 값이라 **개통 이래 항상 실패**했고
  //    (전 500·현 400) 반환 모양도 Order 라 위젯 타입(MAR)과 달랐다 — 미투약 정본 EP 로 교체.
  const { data: medData, isError: medIsError, error: medError, refetch: refetchMed } = useQuery({
    queryKey: ['nurse-med-overdue'],
    queryFn: () => apiClient.get<{ data: { overdue: MedAdmin[]; totalOverdue: number } }>('/api/workgroup/medication/overdue'),
    refetchInterval: pollMs('fast'),
  });

  // 인수인계 (최근)
  const { data: handoffData, isError: handoffIsError, error: handoffError, refetch: refetchHandoff } = useQuery({
    queryKey: ['nurse-handoff'],
    queryFn: () => apiClient.get<{ data: HandoffItem[] }>('/api/v1/handoffs?limit=3'),
    refetchInterval: pollMs('slow'),
  });

  /**
   * 🔴 (2026-10-02) 서버는 `{ total, byStatus:[{status,_count}] }` 인데 `occupiedBeds`·`occupied` 를 읽어 **개통 이래 "입원 중 0 ·
   *    가용 57 · 0%"**였다(실측 사용 중 5 · 가용 49 · 청소 2 · 정비 1). 가용도 "전체 − 사용"이 아니라 AVAILABLE 수다.
   *    파서 정본 `bedStatusSummary`(병상 가동률 위젯과 같은 함수).
   */
  const bedSummary = bedStatusSummary(bedsData?.data);
  const totalBeds = bedSummary.total;
  const occupiedBeds = bedSummary.occupied;
  const availableBeds = bedSummary.available;

  const inpatients: InpatientItem[] = (() => {
    const raw = inpatientData?.data;
    return Array.isArray(raw) ? raw : (raw as unknown as ApiWrapper<InpatientItem[]>)?.data ?? [];
  })();

  const medOverdue: MedAdmin[] = medData?.data?.overdue ?? [];
  // 서버 총계 — 목록 길이로 세지 않는다
  const medOverdueTotal = medData?.data?.totalOverdue ?? medOverdue.length;
  const assignRaw = assignData?.data as unknown;
  const myAssigned = Array.isArray(assignRaw) ? assignRaw.length : Array.isArray((assignRaw as { data?: unknown[] })?.data) ? (assignRaw as { data: unknown[] }).data.length : 0;

  const handoffs: HandoffItem[] = (() => {
    const raw = handoffData?.data;
    return Array.isArray(raw) ? raw : (raw as unknown as ApiWrapper<HandoffItem[]>)?.data ?? [];
  })();


  // 교대 판정 정본 — 경계는 config(nursing.shift.boundaries)
  const shiftBoundaries = useShiftBoundaries();
  const currentShift = shiftOf(new Date(), shiftBoundaries);

  const getDaysSince = (date: string) => Math.max(1, Math.ceil((Date.now() - new Date(date).getTime()) / 86400000));

  return (
    <div className="space-y-4">
      {/* 🔴 투약 대기 조회 실패 — 배너가 안 뜨는 것을 "대기 없음"으로 읽히게 두지 않는다 */}
      {medIsError && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-2"><T k="투약 지연" /></h3>
          <QueryErrorFallback error={medError} onRetry={refetchMed} size="compact" />
        </div>
      )}

      {/* 투약 알림 (긴급) */}
      {!medIsError && medOverdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
              </div>
              <div>
                {/* 🔴 (2026-10-02) 이 목록은 예정 시각이 지난 미투약이다 — "대기"가 아니라 지연 */}
                <h3 className="text-sm font-bold text-red-800"><T k="투약 지연" /></h3>
                <p className="text-[10px] text-red-600">{medOverdueTotal}<Unit><T k="건" /></Unit> · <T k="예정 시각 지남" /></p>
              </div>
            </div>
            <Link href="/orders?department=PHARMACY" className="text-xs text-red-600 hover:text-red-700 font-medium"><T k="전체 보기" /> &rarr;</Link>
          </div>
          <div className="space-y-1.5">
            {medOverdue.slice(0, 4).map((m) => {
              const patientName = m.patientName || tt('미상');
              const drugName = m.medication || tt('약물');
              const bedInfo = m.room && m.room !== '-' ? m.room : '';
              return (
                <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-white/80">
                  <div className="flex items-center gap-2">
                    {bedInfo && <span className="text-[10px] font-medium text-red-600">{bedInfo}</span>}
                    <span className="text-xs font-medium text-gray-900">{patientName}</span>
                    <span className="text-[10px] text-gray-500">{drugName}</span>
                  </div>
                  <span className="text-[10px] text-red-500">
                    {/* 오늘이 아니면 날짜로 — 지난 예정을 오늘 시각처럼 그리지 않는다 */}
                    <When at={m.scheduledAt} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 근무 상태 + 병상 현황 — 🔴 (2026-10-02) 병동 패널의 '외래 대기'(병원 전체 접수 대기)는 병동 간호의 일이 아니라 뺐다
          (게다가 응답 키를 잘못 읽어 늘 0 이었다). 외래·원무 간호는 비병동 배치의 '접수 대기 현황'이 말한다 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 현재 근무 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <h3 className="text-sm font-bold text-gray-900"><T k="현재 근무" /></h3>
          </div>
          <div className="text-center py-2">
            <span className={`text-lg font-bold px-4 py-1.5 rounded-full ${SHIFT_COLOR[currentShift]}`}>
              <T k={SHIFT_LABEL[currentShift]} />
            </span>
            <p className="text-xs text-gray-400 mt-2">
              {kdate(new Date(), 'monthDayWeekday')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-100">
            <div className="text-center">
              <p className="text-xl font-bold text-rose-600">{assignIsError ? '—' : myAssigned}</p>
              <p className="text-[10px] text-gray-500"><T k="내 배정 환자" />{assignIsError ? <> (<T k="조회 실패" />)</> : ''}</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-amber-600">{medIsError ? '—' : medOverdueTotal}</p>
              <p className="text-[10px] text-gray-500"><T k="투약 지연" />{medIsError ? <> (<T k="조회 실패" />)</> : ''}</p>
            </div>
          </div>
        </div>

        {/* 병동 현황 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" /></svg>
            {/* 병원 전체 병상이다 — 내 병동으로 좁히는 기준(간호사↔병동)이 아직 없어 그 사실을 이름에 적는다 */}
            <h3 className="text-sm font-bold text-gray-900"><T k="병상 현황(병원 전체)" /></h3>
          </div>
          {bedsIsError && <QueryErrorFallback error={bedsError} onRetry={refetchBeds} size="compact" />}
          {!bedsIsError && (
          <div className="space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500"><T k="총 병상" /></span>
              <span className="text-sm font-bold text-gray-900">{totalBeds}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500"><T k="입원 중" /></span>
              <span className="text-sm font-bold text-rose-600">{occupiedBeds}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500"><T k="가용 병상" /></span>
              <span className="text-sm font-bold text-emerald-600">{availableBeds}</span>
            </div>
            {totalBeds > 0 && (
              <div className="pt-1">
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className={`h-2 rounded-full ${occupiedBeds / totalBeds > 0.9 ? 'bg-red-500' : occupiedBeds / totalBeds > 0.7 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, Math.round((occupiedBeds / totalBeds) * 100))}%` }} />
                </div>
                {/* 🔴 비율은 분모와 함께(§3.3) — 정본 `<Ratio>`. 인라인 계산은 등록 병상 0 에서 NaN% 를 그린다 */}
                <Ratio numerator={occupiedBeds} denominator={totalBeds} className="block text-[10px] text-gray-400 text-right mt-0.5" unavailableHint="등록 병상 0" />
              </div>
            )}
          </div>
          )}
          <Link href="/beds" className="mt-2 block text-center text-xs text-blue-600 hover:text-blue-700 font-medium">
            <T k="병상 관리" /> &rarr;
          </Link>
        </div>

      </div>

      {/* 바이탈 미체크 + 투약 예정 */}
      <VitalUncheckedWidget />
      <UpcomingMedsWidget />

      {/* 입원 환자 목록 + 인수인계 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 입원 환자 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" /></svg>
              <h3 className="text-sm font-bold text-gray-900"><T k="입원 환자" /></h3>
              {!inpatientIsError && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{inpatients.length}<Unit><T k="명" /></Unit></span>}
            </div>
            <Link href="/inpatient" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="전체 보기" /> &rarr;</Link>
          </div>
          {inpatientIsError ? (
            <QueryErrorFallback error={inpatientError} onRetry={refetchInpatient} size="compact" />
          ) : inpatients.length === 0 ? (
            <EmptyState compact icon="👤" title="입원환자가 없습니다" />
          ) : (
            <div className="space-y-1.5">
              {inpatients.slice(0, 8).map((p) => {
                const ward = typeof p.ward === 'string' ? p.ward : p.ward?.name ?? p.bed?.ward?.name ?? '';
                const room = p.roomNumber ?? p.bed?.roomNumber ?? '';
                const bed = p.bedNumber ?? p.bed?.bedNumber ?? '';
                const diet = p.dietType ?? p.diet ?? '';
                const dietColors: Record<string, string> = { '일반식': 'bg-gray-100 text-gray-600', '저염식': 'bg-blue-100 text-blue-700', '당뇨식': 'bg-amber-100 text-amber-700', '유동식': 'bg-violet-100 text-violet-700', '금식': 'bg-red-100 text-red-700' };
                return (
                  <Link key={p.id} href={`/inpatient/${p.id}`}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-violet-50 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-medium text-violet-600 w-20 shrink-0">{ward} {room}-{bed}</span>
                      <span className="text-sm font-medium text-gray-900">{p.patient?.familyName}{p.patient?.givenName}</span>
                      <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{p.admitReason ?? ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {diet && <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${dietColors[diet] ?? 'bg-gray-100 text-gray-600'}`}><T k={diet} /></span>}
                      {p.admitDate && <span className="text-[10px] text-gray-400">{getDaysSince(p.admitDate)}<T k="일차" /></span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* 인수인계 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
              <h3 className="text-sm font-bold text-gray-900"><T k="인수인계" /></h3>
            </div>
            <button onClick={() => setShowHandoffForm(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="작성" /></button>
          </div>
          {handoffIsError ? (
            <QueryErrorFallback error={handoffError} onRetry={refetchHandoff} size="compact" />
          ) : handoffs.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400 mb-2"><T k="최근 인수인계가 없습니다" /></p>
              <button onClick={() => setShowHandoffForm(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="인수인계 작성" /> &rarr;</button>
            </div>
          ) : (
            <div className="space-y-2">
              {handoffs.map((h) => {
                const fromName = h.fromDoctor ? `${h.fromDoctor.familyName ?? ''}${h.fromDoctor.givenName ?? ''}` : (h.author ? `${h.author.familyName ?? ''}${h.author.givenName ?? ''}` : '');
                const toName = h.toDoctor ? `${h.toDoctor.familyName ?? ''}${h.toDoctor.givenName ?? ''}` : '';
                const patName = h.patient ? `${h.patient.familyName ?? ''}${h.patient.givenName ?? ''}` : '';
                const typeLabel = h.type === 'SHIFT_CHANGE' ? tt('근무교대') : h.type === 'TRANSFER' ? tt('전동') : h.type ?? '';
                const items = h.pendingItems ?? h.items ?? [];
                return (
                  <div key={h.id} className={`p-2.5 rounded-xl border ${h.acknowledgedAt ? 'bg-gray-50 border-gray-100' : 'bg-amber-50 border-amber-100'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 whitespace-nowrap">{typeLabel}</span>
                      {fromName && <span className="text-[10px] text-gray-600">{fromName}</span>}
                      <span className="text-[10px] text-gray-400">&rarr;</span>
                      {toName && <span className="text-[10px] text-gray-600">{toName}</span>}
                      {!h.acknowledgedAt && <span className="text-[9px] bg-rose-100 text-rose-600 px-1 py-0.5 rounded ml-auto whitespace-nowrap"><T k="미확인" /></span>}
                    </div>
                    {patName && <p className="text-[10px] text-gray-500 mb-0.5"><T k="환자" />: {patName}</p>}
                    {h.summary && <p className="text-[10px] text-gray-700 line-clamp-2">{h.summary}</p>}
                    {Array.isArray(items) && items.slice(0, 2).map((item: { patientName?: string; content?: string; priority?: string }, i: number) => (
                      <p key={i} className="text-[10px] text-gray-600 truncate">
                        {item.priority === 'HIGH' && <span className="text-red-500 font-bold mr-1">!</span>}
                        {item.patientName && <span className="font-medium">{item.patientName}: </span>}
                        {item.content}
                      </p>
                    ))}
                    {h.createdAt && <p className="text-[9px] text-gray-400 mt-1">{kdate(h.createdAt, 'datetimeShort')}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 인수인계 작성 모달 */}
      {showHandoffForm && <HandoffFormModal patients={inpatients} userId={user?.id} onClose={() => setShowHandoffForm(false)} onSuccess={() => { qc.invalidateQueries({ queryKey: ['nurse-handoff'] }); setShowHandoffForm(false); }} />}
    </div>
  );
}

// ── 바이탈 미체크 환자 위젯 ──
interface VitalUncheckedItem { admissionId: string; patient?: { familyName: string; givenName: string; mrn: string }; bed?: { roomNumber: string; bedNumber: string; ward?: { name: string } }; daysSince: number }
function VitalUncheckedWidget() {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['vital-unchecked'],
    queryFn: () => apiClient.get<{ data: VitalUncheckedItem[] }>('/api/v1/nurse/vital-unchecked'),
    refetchInterval: pollMs('slow'),
  });

  const _raw = data?.data as VitalUncheckedItem[] | { data?: VitalUncheckedItem[] } | undefined;
  const unchecked: VitalUncheckedItem[] = Array.isArray(_raw) ? _raw : ((_raw as { data?: VitalUncheckedItem[] } | undefined)?.data ?? []);

  // 🔴 조회 실패로 위젯이 사라지면 "미체크 없음"으로 읽힌다 — 실패는 실패라고 말한다
  if (isError) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-900 mb-2"><T k="바이탈 미체크" /></h3>
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      </div>
    );
  }
  if (unchecked.length === 0) return null;

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <div>
          <h3 className="text-sm font-bold text-orange-800"><T k="바이탈 미체크" /></h3>
          <p className="text-[10px] text-orange-600">{unchecked.length}<Unit><T k="명" /></Unit> — <T k="오늘 바이탈 기록 없음" /></p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {unchecked.slice(0, 8).map(p => (
          <Link key={p.admissionId} href={`/inpatient/${p.admissionId}/nursing/flowsheet`}
            className="flex items-center gap-2 p-2 rounded-lg bg-white/80 hover:bg-white transition-colors">
            <span className="text-[10px] font-mono text-orange-600 shrink-0">{p.bed?.ward?.name ?? ''} {p.bed?.roomNumber}-{p.bed?.bedNumber}</span>
            <span className="text-xs font-medium text-gray-900 truncate">{p.patient?.familyName}{p.patient?.givenName}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── 투약 예정 스케줄 위젯 ──
interface UpcomingMedItem { id: string; scheduledAt: string; dose: string; route: string; patient?: { familyName: string; givenName: string } }
function UpcomingMedsWidget() {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['upcoming-meds'],
    queryFn: () => apiClient.get<{ data: UpcomingMedItem[] }>('/api/v1/nurse/upcoming-medications'),
    refetchInterval: pollMs('slow'),
  });

  const _raw = data?.data as UpcomingMedItem[] | { data?: UpcomingMedItem[] } | undefined;
  const meds: UpcomingMedItem[] = Array.isArray(_raw) ? _raw : ((_raw as { data?: UpcomingMedItem[] } | undefined)?.data ?? []);

  // 🔴 조회 실패로 위젯이 사라지면 "예정 투약 없음"으로 읽힌다
  if (isError) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-900 mb-2"><T k="투약 예정" /></h3>
        <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
      </div>
    );
  }
  if (meds.length === 0) return null;

  // 시간별 그룹핑
  const groups: Record<string, typeof meds> = {};
  for (const m of meds) {
    const hour =kdate(m.scheduledAt, 'time');
    if (!groups[hour]) groups[hour] = [];
    groups[hour].push(m);
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <div>
          <h3 className="text-sm font-bold text-blue-800"><T k="투약 예정" /></h3>
          <p className="text-[10px] text-blue-600">{meds.length}<Unit><T k="건" /></Unit> <T k="남은 스케줄" /></p>
        </div>
      </div>
      <div className="space-y-2">
        {Object.entries(groups).slice(0, 4).map(([time, items]) => (
          <div key={time} className="flex items-start gap-3">
            <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded-lg shrink-0 whitespace-nowrap">{time}</span>
            <div className="flex-1 space-y-0.5">
              {items.map(m => (
                <div key={m.id} className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-gray-900">{m.patient?.familyName}{m.patient?.givenName}</span>
                  <span className="text-gray-500">{m.dose}</span>
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded whitespace-nowrap">{m.route}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HandoffFormModal({ patients, userId, onClose, onSuccess }: {
  patients: InpatientItem[];
  userId?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const tt = useTAttr();
  const [patientId, setPatientId] = useState('');
  const [summary, setSummary] = useState('');
  const [type, setType] = useState('SHIFT_CHANGE');

  const createMut = useMutation({
    mutationFn: () =>
      apiClient.post('/api/v1/handoffs', {
        type,
        patientId,
        fromDoctorId: userId,
        toDoctorId: userId, // 인수자는 추후 인수확인 시 매핑
        summary,
      }),
    onSuccess: () => {
      toast.success(tt('인수인계가 작성되었습니다.'));
      onSuccess();
    },
    onError: () => toast.error(tt('인수인계 작성에 실패했습니다.')),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900"><T k="인수인계 작성" /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="유형" /></label>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="SHIFT_CHANGE">{tt('근무교대')}</option>
              <option value="TRANSFER">{tt('전동')}</option>
              <option value="DISCHARGE">{tt('퇴원')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자" /></label>
            <select value={patientId} onChange={e => setPatientId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">{tt('환자 선택')}</option>
              {patients.map(p => (
                <option key={p.patient?.id ?? p.id} value={p.patient?.id ?? p.id}>
                  {p.patient?.familyName}{p.patient?.givenName} ({p.bed?.roomNumber ?? ''}-{p.bed?.bedNumber ?? ''})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="인계 내용" /></label>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder={tt('현재 상태, 주의사항, 투약 현황, 특이사항 등')}
              rows={5}
              className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => createMut.mutate()}
            disabled={!patientId || !summary.trim() || createMut.isPending}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <T k={createMut.isPending ? '작성 중...' : '인수인계 작성'} />
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
        </div>
      </div>
    </div>
  );
}
