'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, PatientName } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface ScheduleSlot {
  id: string;
  dayOfWeek: number;
  period: string;
  startTime: string;
  endTime: string;
}

interface DoctorInfo {
  id: string;
  familyName: string;
  givenName: string;
}

interface DoctorSchedule {
  doctor: DoctorInfo;
  departmentName: string;
  roomName?: string;
  slots: ScheduleSlot[];
}

interface ClinicClosure {
  id: string;
  date: string;
  period?: string;
  reason: string;
  doctor?: DoctorInfo;
  substitute?: DoctorInfo;
}

interface CreateSchedulePayload {
  doctorId: string;
  departmentName: string;
  roomName?: string;
  dayOfWeek: number;
  period: string;
  startTime: string;
  endTime: string;
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 요일 라벨 키 — 한 글자 원문은 동음이의라 문맥 키를 쓴다(정본은 outpatient 카탈로그의 `월~일@요일`) */
const DAY_KEY = ['일@요일', '월@요일', '화@요일', '수@요일', '목@요일', '금@요일', '토@요일'];
const PERIODS = ['AM', 'PM'];

// 🔴 화면 실사용 점검 W8 — 진료표 슬롯의 period 는 AM/PM 만이 아니다.
//    운영 실측 232건 중 **175건이 'ALL'(종일)** 인데 그리드가 AM/PM 만 조회해
//    의사 32명 중 25명이 요일 전부 '-'(진료 없음)로 보였다. 종일 슬롯은 접지 않고 그대로 그린다.
const PERIOD_LABEL: Record<string, string> = { AM: '오전', PM: '오후', ALL: '종일', FULL: '종일' };
const periodLabel = (p: string) => PERIOD_LABEL[p] ?? p;

export default function ClinicScheduleAdminPage() {
  const queryClient = useQueryClient();
  // 휴진이 닿는 기존 예약을 볼 날짜 — 등록 직후 자동으로 열고, 목록의 '영향 예약'으로도 연다
  const [affectedDate, setAffectedDate] = useState<string | null>(null);
  const tAttr = useTAttr();

  // Weekly schedule data
  const { data: weekData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clinic-schedule-week'],
    queryFn: () => apiClient.get<{ data: DoctorSchedule[] }>('/api/v1/clinic-schedule/week'),
  });

  // Closures
  const { data: closureData } = useQuery({
    queryKey: ['clinic-closures'],
    queryFn: () => apiClient.get<{ data: ClinicClosure[] }>('/api/v1/clinic-closure'),
  });

  // Doctors list
  const { data: usersData } = useQuery({
    queryKey: ['users-doctors'],
    queryFn: () => apiClient.get<{ data: DoctorInfo[] }>('/api/v1/users', { role: 'DOCTOR' }),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateSchedulePayload) => apiClient.post('/api/v1/clinic-schedule', data),
    onSuccess: () => {
      toast.success(tAttr('진료표가 등록되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['clinic-schedule-week'] });
    },
    onError: () => toast.error(tAttr('진료표 등록 중 오류가 발생했습니다.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/clinic-schedule/${id}`),
    onSuccess: () => {
      toast.success(tAttr('진료표가 삭제되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['clinic-schedule-week'] });
    },
    onError: () => toast.error(tAttr('삭제 중 오류가 발생했습니다.')),
  });

  const _doctorsRaw = weekData?.data;
  const doctors: DoctorSchedule[] = Array.isArray(_doctorsRaw) ? _doctorsRaw : (_doctorsRaw as Record<string, unknown> | undefined)?.data as DoctorSchedule[] ?? [];
  const _closuresRaw = closureData?.data;
  const closures: ClinicClosure[] = Array.isArray(_closuresRaw) ? _closuresRaw : (_closuresRaw as Record<string, unknown> | undefined)?.data as ClinicClosure[] ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="진료표 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="의사별 주간 진료 스케줄과 휴진을 관리합니다." /></p>
      </div>

      {/* Weekly Schedule Grid */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-semibold text-gray-900"><T k="주간 진료표" /></h3>
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-4 h-4 rounded bg-blue-600" /> <T k="오전/오후" />
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block px-1 h-4 leading-4 rounded bg-indigo-600 text-white text-[9px] font-bold"><T k="종일" /></span> <T k="종일 진료" />
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-4 h-4 rounded bg-gray-100" /> <T k="미배정(클릭하면 추가)" />
            </span>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : doctors.length === 0 ? (
          <EmptyState icon="📋" title="등록된 진료표가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-3 text-left font-medium text-gray-500 min-w-[120px]"><T k="의사" /></th>
                  <th className="pb-3 text-left font-medium text-gray-500 min-w-[80px]"><T k="진료과" /></th>
                  {DAY_KEY.map((dayKey, i) => (
                    <th key={i} className="pb-3 text-center font-medium text-gray-500 min-w-[80px]">
                      <div><T k={dayKey} /></div>
                      <div className="flex justify-center gap-1 mt-1">
                        <span className="text-[10px] text-gray-400"><T k="오전" /></span>
                        <span className="text-[10px] text-gray-400"><T k="오후" /></span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doctors.map((doc: DoctorSchedule) => {
                  // 요일별 슬롯 — AM/PM 이 아닌 period('ALL'=종일 등)도 버리지 않는다
                  const byDay = new Map<number, ScheduleSlot[]>();
                  for (const slot of doc.slots) {
                    const arr = byDay.get(slot.dayOfWeek) ?? [];
                    arr.push(slot);
                    byDay.set(slot.dayOfWeek, arr);
                  }
                  return (
                    <tr key={doc.doctor.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-3 font-medium text-gray-900">
                        {doc.doctor.familyName}{doc.doctor.givenName}
                      </td>
                      <td className="py-3 text-gray-500 text-xs">{doc.departmentName}</td>
                      {DAYS.map((_, dayIdx) => {
                        const daySlots = byDay.get(dayIdx) ?? [];
                        // 종일(ALL)/기타 period 슬롯 — 오전·오후 중 하나로 접으면 정보를 잃는다
                        const spanning = daySlots.filter((s) => s.period !== 'AM' && s.period !== 'PM');
                        return (
                          <td key={dayIdx} className="py-3 text-center">
                            <div className="flex justify-center gap-1">
                              {spanning.length > 0
                                ? spanning.map((slot) => (
                                    <button
                                      key={slot.id}
                                      onClick={() => deleteMutation.mutate(slot.id)}
                                      className="px-2 h-7 rounded-lg text-[11px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
                                      title={`${tAttr(periodLabel(slot.period))} ${slot.startTime}~${slot.endTime} (${tAttr('클릭: 삭제')})`}
                                    >
                                      <T k={periodLabel(slot.period)} />
                                    </button>
                                  ))
                                : PERIODS.map((period) => {
                                    const slot = daySlots.find((s) => s.period === period);
                                    return (
                                      <button
                                        key={period}
                                        onClick={() => {
                                          if (slot) {
                                            deleteMutation.mutate(slot.id);
                                          } else {
                                            createMutation.mutate({
                                              doctorId: doc.doctor.id,
                                              departmentName: doc.departmentName,
                                              roomName: doc.roomName,
                                              dayOfWeek: dayIdx,
                                              period,
                                              startTime: period === 'AM' ? '09:00' : '14:00',
                                              endTime: period === 'AM' ? '12:30' : '17:30',
                                            });
                                          }
                                        }}
                                        className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                                          slot
                                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                        }`}
                                        title={slot ? `${slot.startTime}~${slot.endTime} (${tAttr('클릭: 삭제')})` : tAttr('클릭: 추가')}
                                      >
                                        {slot ? 'O' : '-'}
                                      </button>
                                    );
                                  })}
                            </div>
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
      </div>

      {/* Closure Management */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="휴진 관리" /></h3>
        <ClosureForm onRegistered={setAffectedDate} doctors={Array.isArray(usersData?.data) ? usersData.data : (usersData?.data as Record<string, unknown> | undefined)?.data as DoctorInfo[] ?? []} />
        {affectedDate && <ClosureAffectedPanel date={affectedDate} onClose={() => setAffectedDate(null)} />}
        <div className="mt-6">
          {closures.length === 0 ? (
            <EmptyState icon="📋" title="등록된 휴진이 없습니다." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <th className="pb-3 font-medium text-gray-500"><T k="의사" /></th>
                    <th className="pb-3 font-medium text-gray-500"><T k="날짜" /></th>
                    <th className="pb-3 font-medium text-gray-500"><T k="시간대" /></th>
                    <th className="pb-3 font-medium text-gray-500"><T k="사유" /></th>
                    <th className="pb-3 font-medium text-gray-500"><T k="대체 의사" /></th>
                    <th className="pb-3 font-medium text-gray-500"><T k="작업" /></th>
                  </tr>
                </thead>
                <tbody>
                  {closures.map((c: ClinicClosure) => (
                    <ClosureRow key={c.id} closure={c} onShowAffected={setAffectedDate} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClosureForm({ doctors, onRegistered }: { doctors: DoctorInfo[]; onRegistered: (date: string) => void }) {
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState('');
  const [reason, setReason] = useState('');
  const [substituteId, setSubstituteId] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/api/v1/clinic-closure', {
        doctorId,
        date,
        period: period || undefined,
        reason,
        substituteId: substituteId || undefined,
      }),
    onSuccess: () => {
      toast.success(tAttr('휴진이 등록되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['clinic-closures'] });
      queryClient.invalidateQueries({ queryKey: ['clinic-closure-affected', date] });
      // 등록한 사람이 바로 누구에게 연락해야 하는지 보게 한다(기억으로 찾지 않게)
      onRegistered(date);
      setDoctorId('');
      setDate('');
      setPeriod('');
      setReason('');
      setSubstituteId('');
    },
    onError: () => toast.error(tAttr('휴진 등록 중 오류가 발생했습니다.')),
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1"><T k="의사" /></label>
        <select
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">{tAttr('선택')}</option>
          {doctors.map((d: DoctorInfo) => (
            <option key={d.id} value={d.id}>
              {d.familyName}{d.givenName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1"><T k="날짜" /></label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1"><T k="시간대" /></label>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">{tAttr('종일')}</option>
          <option value="AM">{tAttr('오전')}</option>
          <option value="PM">{tAttr('오후')}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1"><T k="사유" /></label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={tAttr('학회, 연차...')}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1"><T k="대체 의사" /></label>
        <select
          value={substituteId}
          onChange={(e) => setSubstituteId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">{tAttr('없음')}</option>
          {doctors
            .filter((d: DoctorInfo) => d.id !== doctorId)
            .map((d: DoctorInfo) => (
              <option key={d.id} value={d.id}>
                {d.familyName}{d.givenName}
              </option>
            ))}
        </select>
      </div>
      <button
        onClick={() => createMutation.mutate()}
        disabled={!doctorId || !date || !reason || createMutation.isPending}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        <T k="등록" />
      </button>
    </div>
  );
}

function ClosureRow({ closure, onShowAffected }: { closure: ClinicClosure; onShowAffected: (date: string) => void }) {
  const queryClient = useQueryClient();
  const tAttr = useTAttr();

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.del(`/api/v1/clinic-closure/${closure.id}`),
    onSuccess: () => {
      toast.success(tAttr('휴진이 취소되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['clinic-closures'] });
    },
    onError: () => toast.error(tAttr('취소 중 오류가 발생했습니다.')),
  });

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50">
      <td className="py-3 font-medium text-gray-900">
        {closure.doctor?.familyName}{closure.doctor?.givenName}
      </td>
      <td className="py-3 text-gray-600">
        {kdate(new Date(closure.date))}
      </td>
      <td className="py-3 text-gray-600">
        <T k={closure.period === 'AM' ? '오전' : closure.period === 'PM' ? '오후' : '종일'} />
      </td>
      <td className="py-3 text-gray-600">{closure.reason}</td>
      <td className="py-3 text-gray-600">
        {closure.substitute
          ? `${closure.substitute.familyName}${closure.substitute.givenName}`
          : '-'}
      </td>
      <td className="py-3 flex gap-1.5">
        <button
          type="button"
          // closure.date 는 @db.Date(UTC 자정) — 날짜 조각을 그대로 쓴다(시간대 변환하면 하루 밀린다)
          onClick={() => onShowAffected(String(closure.date).slice(0, 10))}
          className="px-2.5 py-1 text-xs font-medium bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <T k="영향 예약" />
        </button>
        <button
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="px-2.5 py-1 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
        >
          <T k="취소" />
        </button>
      </td>
    </tr>
  );
}

interface ClosureAffectedRow {
  appointmentId: string;
  scheduledAt: string;
  durationMinutes: number;
  appointmentStatus: string;
  patient: { id: string; mrn?: string | null; familyName?: string | null; givenName?: string | null; phone?: string | null } | null;
  closurePeriod: string | null;
  substitute: { familyName: string; givenName: string } | null;
  basis: 'FULL_DAY' | 'SESSION' | 'OUTSIDE_SCHEDULE' | 'ALL_DAY_SESSION_HALF_CLOSURE';
}
interface ClosureAffectedResponse {
  date: string;
  affected: ClosureAffectedRow[];
  needsReview: ClosureAffectedRow[];
  counts: { affected: number; needsReview: number };
}


/**
 * 휴진이 닿는 기존 예약 — 연락할 사람의 목록.
 * 🔴 여기서는 아무것도 자동으로 하지 않는다(예약 취소·이관·문자 발송 없음) — 연락과 조치는 사람이 한다.
 * 🔴 판정할 수 없는 예약은 "영향 없음"으로 빼지 않고 따로 보여준다.
 */
function ClosureAffectedPanel({ date, onClose }: { date: string; onClose: () => void }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clinic-closure-affected', date],
    queryFn: () => apiClient.get<{ data: ClosureAffectedResponse }>(`/api/v1/clinic-closure/affected/${date}`),
  });
  const res = data?.data;

  const table = (rows: ClosureAffectedRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 text-left text-gray-500">
            <th className="py-2 font-medium"><T k="예약 시각" /></th>
            <th className="py-2 font-medium"><T k="환자" /></th>
            <th className="py-2 font-medium"><T k="연락처" /></th>
            <th className="py-2 font-medium"><T k="판정 근거" /></th>
            <th className="py-2 font-medium"><T k="대체 의사" /></th>
            <th className="py-2 font-medium"><T k="조치" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.appointmentId} className="border-b border-gray-50">
              <td className="py-2 tabular-nums whitespace-nowrap">{kdate(r.scheduledAt, 'time')}</td>
              <td className="py-2"><PatientName familyName={r.patient?.familyName} givenName={r.patient?.givenName} mrn={r.patient?.mrn} /></td>
              <td className="py-2 text-gray-600">{r.patient?.phone || <span className="text-gray-400"><T k="등록된 연락처 없음" /></span>}</td>
              <td className="py-2 text-gray-600"><T k={r.basis === 'FULL_DAY' ? '종일 휴진'
                : r.basis === 'SESSION' ? '같은 진료 세션'
                : r.basis === 'OUTSIDE_SCHEDULE' ? '진료 시간표 밖 예약 — 반일 휴진에 닿는지 판정 불가'
                : '종일 진료 세션에 반일 휴진 — 어느 반쪽인지 판정 불가'} /></td>
              <td className="py-2 text-gray-600">{r.substitute ? `${r.substitute.familyName}${r.substitute.givenName}` : '-'}</td>
              <td className="py-2"><span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold whitespace-nowrap"><T k="연락 필요" /></span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900"><Tf k="{날짜} 휴진이 닿는 기존 예약" params={{ 날짜: date }} /></h4>
        <button type="button" onClick={onClose} className="px-2 py-1 text-xs rounded-lg border bg-white"><T k="닫기" /></button>
      </div>
      <p className="text-[11px] text-gray-500"><T k="예약을 자동으로 취소하거나 문자를 보내지 않습니다 — 환자에게 연락해 변경·대진 여부를 정하세요." /></p>
      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : isLoading || !res ? (
        <p className="text-xs text-gray-400"><T k="불러오는 중..." /></p>
      ) : (
        <>
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1"><Tf k="영향 예약 {건수}건" params={{ 건수: res.counts.affected }} /></p>
            {res.affected.length === 0 ? <p className="text-xs text-gray-400"><T k="이 휴진에 닿는 예약이 없습니다" /></p> : table(res.affected)}
          </div>
          {res.needsReview.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1"><Tf k="확인 필요 {건수}건" params={{ 건수: res.counts.needsReview }} /></p>
              {table(res.needsReview)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
