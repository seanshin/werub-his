'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import MyWaitingQueueWidget from './MyWaitingQueueWidget';
import MyCensusPanel from './MyCensusPanel';
import PendingHandoffBanner from './PendingHandoffBanner';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kstToday } from '@/lib/kst-today';

interface ClinicScheduleItem {
  doctorId?: string;
  doctor?: { userId?: string };
  period?: string;
  timeSlot?: string;
  startTime?: string;
  endTime?: string;
  clinicRoom?: { name: string };
}

interface DraftEncounter {
  id: string;
  patientId: string;
  patient?: { familyName: string; givenName: string };
  chiefComplaint?: string;
  reason?: string;
  date?: string;
}

interface InpatientItem {
  id: string;
  doctorId?: string;
  attendingDoctorId?: string;
  doctor?: { userId?: string };
  ward?: string | { name: string };
  bed?: { ward?: { name: string }; roomNumber: string; bedNumber: string };
  roomNumber?: string;
  bedNumber?: string;
  patient?: { familyName: string; givenName: string };
  admitReason?: string;
  diagnosis?: string;
  admitDate?: string;
}

interface SurgeryItem {
  id: string;
  scheduledDate?: string;
  date?: string;
  scheduledTime?: string;
  startTime?: string;
  surgeonId?: string;
  surgeon?: { userId?: string };
  doctorId?: string;
  patient?: { familyName: string; givenName: string };
  procedureName?: string;
  surgeryName?: string;
  name?: string;
  status?: string;
}

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

export default function DoctorDashboard() {
  const tt = useTAttr();
  const { user } = useAuthStore();

  const { data: clinicScheduleData } = useQuery({
    queryKey: ['clinic-schedule-today-role'],
    queryFn: () => apiClient.get<{ data: ClinicScheduleItem[] }>('/api/v1/clinic-schedule/today'),
    refetchInterval: pollMs('slow'),
  });

  const { data: draftEncountersData } = useQuery({
    queryKey: ['encounters-draft-my'],
    queryFn: () => apiClient.get<{ data: DraftEncounter[] }>('/api/v1/encounters?status=DRAFT&limit=10&mine=true'),
    refetchInterval: pollMs('fast'),
  });

  const { data: doctorInpatientData, isError: inpatientIsError, error: inpatientError, refetch: refetchInpatient } = useQuery({
    queryKey: ['doctor-inpatient'],
    queryFn: () => apiClient.get<{ data: InpatientItem[] }>('/api/v1/inpatient'),
    refetchInterval: pollMs('normal'),
  });

  const { data: doctorSurgeryData, isError: surgeryIsError, error: surgeryError, refetch: refetchSurgery } = useQuery({
    queryKey: ['doctor-surgery-schedule'],
    queryFn: () => apiClient.get<{ data: SurgeryItem[] }>('/api/v1/surgery/schedule'),
    refetchInterval: pollMs('normal'),
  });

  const { data: completedLabData, isError: labIsError, error: labError, refetch: refetchLab } = useQuery({
    queryKey: ['orders-lab-completed'],
    queryFn: () => apiClient.get<{ data: OrderResult[] }>('/api/v1/orders?department=LAB&status=COMPLETED&limit=10&mine=true'),
    refetchInterval: pollMs('fast'),
  });

  const { data: completedImagingData, isError: imagingIsError, error: imagingError, refetch: refetchImaging } = useQuery({
    queryKey: ['orders-imaging-completed'],
    queryFn: () => apiClient.get<{ data: OrderResult[] }>('/api/v1/orders?department=IMAGING&status=COMPLETED&limit=5&mine=true'),
    refetchInterval: pollMs('fast'),
  });

  const rawSchedule = clinicScheduleData?.data;
  const scheduleArr: ClinicScheduleItem[] = Array.isArray(rawSchedule) ? rawSchedule : (rawSchedule as Record<string, unknown> | undefined)?.data as ClinicScheduleItem[] ?? [];
  const doctorSchedules = scheduleArr.filter(
    (s: ClinicScheduleItem) => s.doctorId === user?.id || s.doctor?.userId === user?.id,
  );
  const rawDraft = draftEncountersData?.data;
  const draftEncounters: DraftEncounter[] = Array.isArray(rawDraft) ? rawDraft : (rawDraft as Record<string, unknown> | undefined)?.data as DraftEncounter[] ?? [];
  const amSchedule = doctorSchedules.find((s: ClinicScheduleItem) => s.period === 'AM' || s.timeSlot === 'AM');
  const pmSchedule = doctorSchedules.find((s: ClinicScheduleItem) => s.period === 'PM' || s.timeSlot === 'PM');

  return (
    <div className="space-y-3">
      {/* 미확인 인수인계 배너 */}
      <PendingHandoffBanner />

      {/* 담당 환자 센서스 */}
      <MyCensusPanel />

      {/* 3-column: 진료표 + 미완료차트 + 대기환자 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Today's Clinic Schedule */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
            <h3 className="text-sm font-bold text-gray-900"><T k="오늘 진료표" /></h3>
            {doctorSchedules[0]?.clinicRoom?.name && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 ml-auto">
                {doctorSchedules[0].clinicRoom.name}
              </span>
            )}
          </div>
          {doctorSchedules.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center"><T k="오늘 진료 없음" /></p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${amSchedule ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                <span className="text-xs font-medium text-gray-900"><T k="오전" /></span>
                <span className="text-xs text-gray-500">
                  {amSchedule ? `${amSchedule.startTime ?? '09:00'} ~ ${amSchedule.endTime ?? '12:30'}` : <T k="없음" />}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${pmSchedule ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                <span className="text-xs font-medium text-gray-900"><T k="오후" /></span>
                <span className="text-xs text-gray-500">
                  {pmSchedule ? `${pmSchedule.startTime ?? '14:00'} ~ ${pmSchedule.endTime ?? '17:30'}` : <T k="없음" />}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Incomplete Charts */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            <h3 className="text-sm font-bold text-gray-900"><T k="미완료 차트" /></h3>
            {draftEncounters.length > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {draftEncounters.length}<Unit><T k="건" /></Unit>
              </span>
            )}
          </div>
          {draftEncounters.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center"><T k="없음" /></p>
          ) : (
            <div className="divide-y divide-gray-50">
              {draftEncounters.slice(0, 5).map((enc: DraftEncounter) => (
                <Link
                  key={enc.id}
                  // 🔴 미완료 차트는 **그 진료를 이어 쓴다** — encounterId 없이 가면 새 진료가 생겨 옛 초안은 영영 미완료로 남았다
                  href={`/patients/${enc.patientId}/encounter/new?encounterId=${enc.id}`}
                  className="flex items-center justify-between py-1.5 px-1 hover:bg-amber-50 transition-colors"
                >
                  <span className="text-xs font-medium text-gray-900">
                    {enc.patient?.familyName}{enc.patient?.givenName}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {enc.date ?kdate(enc.date, 'monthDay') : '-'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Waiting Queue (inline) */}
        <MyWaitingQueueWidget />
      </div>

      {/* Inpatients + Surgery */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* My Inpatients */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
              <h3 className="text-sm font-bold text-gray-900"><T k="담당 입원환자" /></h3>
            </div>
            <Link href="/inpatient" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="전체 보기" /> →</Link>
          </div>
          {inpatientIsError && <QueryErrorFallback error={inpatientError} onRetry={refetchInpatient} size="compact" />}
          {!inpatientIsError && (() => {
            const allInpatients: InpatientItem[] = Array.isArray(doctorInpatientData?.data) ? doctorInpatientData.data : [];
            const myInpatients = allInpatients.filter((p: InpatientItem) => p.doctorId === user?.id || p.attendingDoctorId === user?.id || p.doctor?.userId === user?.id);
            if (myInpatients.length === 0) {
              return <EmptyState compact icon="👤" title="담당 입원환자가 없습니다" />;
            }
            return (
              <div>
                <p className="text-[11px] text-gray-400 mb-1"><T k="총" /> {myInpatients.length}<Unit><T k="명" /></Unit></p>
                <div className="divide-y divide-gray-50">
                  {myInpatients.slice(0, 5).map((p: InpatientItem) => (
                    <div key={p.id} className="flex items-center justify-between py-1.5 px-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-indigo-600 whitespace-nowrap">
                          {typeof p.ward === 'string' ? p.ward : p.ward?.name ?? p.bed?.ward?.name ?? ''} {p.roomNumber ?? p.bed?.roomNumber ?? ''}-{p.bedNumber ?? p.bed?.bedNumber ?? ''}
                        </span>
                        <span className="text-xs font-medium text-gray-900">
                          {p.patient?.familyName}{p.patient?.givenName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-500 truncate max-w-[120px]">{p.admitReason ?? p.diagnosis ?? ''}</span>
                        {p.admitDate && (
                          <span className="text-[10px] text-gray-400">
                            {kdate(p.admitDate, 'monthDay')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <Link href="/inpatient" className="mt-1.5 block text-center text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  <T k="회진 시작" /> →
                </Link>
              </div>
            );
          })()}
        </div>

        {/* Today's Surgery */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
              <h3 className="text-sm font-bold text-gray-900"><T k="오늘 수술 일정" /></h3>
            </div>
            <Link href="/surgery" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="수술 관리" /> →</Link>
          </div>
          {surgeryIsError && <QueryErrorFallback error={surgeryError} onRetry={refetchSurgery} size="compact" />}
          {!surgeryIsError && (() => {
            const allSurgeries: SurgeryItem[] = Array.isArray(doctorSurgeryData?.data) ? doctorSurgeryData.data : [];
            const today = kstToday();
            const mySurgeries = allSurgeries.filter((s: SurgeryItem) => {
              const surgeryDate = String(s.scheduledDate ?? s.date ?? '').slice(0, 10);
              const isSurgeon = s.surgeonId === user?.id || s.surgeon?.userId === user?.id || s.doctorId === user?.id;
              return surgeryDate === today && isSurgeon;
            });
            if (mySurgeries.length === 0) {
              return <EmptyState compact icon="📅" title="오늘 수술 일정이 없습니다" />;
            }
            return (
              <div className="divide-y divide-gray-50">
                {mySurgeries.map((s: SurgeryItem) => (
                  <div key={s.id} className="flex items-center justify-between py-1.5 px-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-rose-700">
                        {s.scheduledTime ?? s.startTime ?? '-'}
                      </span>
                      <span className="text-xs font-medium text-gray-900">
                        {s.patient?.familyName}{s.patient?.givenName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-500">{s.procedureName ?? s.surgeryName ?? s.name ?? ''}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${
                        s.status === 'IN_PROGRESS' ? 'bg-red-100 text-red-700' :
                        s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        <T k={s.status === 'IN_PROGRESS' ? '진행중' : s.status === 'COMPLETED' ? '완료' : '예정'} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Lab Results */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m14 0H5" /></svg>
            <h3 className="text-sm font-bold text-gray-900"><T k="검사결과 도착" /></h3>
            {!labIsError && !imagingIsError && (() => {
              const labResults: OrderResult[] = Array.isArray(completedLabData?.data) ? completedLabData.data : [];
              const imagingResults: OrderResult[] = Array.isArray(completedImagingData?.data) ? completedImagingData.data : [];
              const totalCount = labResults.length + imagingResults.length;
              return totalCount > 0 ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {totalCount}<Unit><T k="건" /></Unit>
                </span>
              ) : null;
            })()}
          </div>
          <Link href="/orders" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="확인하러 가기" /> →</Link>
        </div>
        {/* 🔴 조회 실패를 "새 검사결과 없음"으로 말하지 않는다 */}
        {labIsError && <QueryErrorFallback error={labError} onRetry={refetchLab} size="compact" />}
        {imagingIsError && <QueryErrorFallback error={imagingError} onRetry={refetchImaging} size="compact" />}
        {!labIsError && !imagingIsError && (() => {
          const labResults: OrderResult[] = Array.isArray(completedLabData?.data) ? completedLabData.data : [];
          const imagingResults: OrderResult[] = Array.isArray(completedImagingData?.data) ? completedImagingData.data : [];
          const allResults = [...labResults, ...imagingResults].sort((a: OrderResult, b: OrderResult) => {
            const dateA = new Date(a.completedAt ?? a.updatedAt ?? a.createdAt ?? 0).getTime();
            const dateB = new Date(b.completedAt ?? b.updatedAt ?? b.createdAt ?? 0).getTime();
            return dateB - dateA;
          });
          if (allResults.length === 0) {
            return <p className="text-xs text-gray-400 py-2 text-center"><T k="새 검사결과 없음" /></p>;
          }
          return (
            <div className="divide-y divide-gray-50">
              {allResults.slice(0, 8).map((r: OrderResult) => (
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
                      ?kdate(r.completedAt ?? r.updatedAt ?? r.createdAt ?? '', 'time')
                      : '-'}
                  </span>
                </Link>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
