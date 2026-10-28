'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useCreateAppointment } from '@/hooks/useAppointments';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { localeTimeText, localeDateTimeText } from '@hospital-run/shared';

interface ScheduleRow { departmentName?: string; doctorId?: string }
interface AvailabilitySlot { start: string; end: string; available: boolean }
interface AvailabilitySession {
  doctorId: string;
  doctorName: string;
  departmentName: string;
  roomName?: string;
  period?: string;
  startTime: string;
  endTime: string;
  maxPatients: number;
  booked: number;
  remaining: number;
  closed: boolean;
  /** 종일 세션+반일 휴진 — 휴진한 반나절이 어느 쪽인지 시간표가 말하지 않는다(서버 판정 `classifySessionClosure`). */
  closureReview?: boolean;
  slots: AvailabilitySlot[];
}

const TYPE_OPTIONS = [
  { value: 'INITIAL', label: '초진' },
  { value: 'FOLLOW_UP', label: '재진' },
  { value: 'URGENT', label: '응급' },
  { value: 'ROUTINE', label: '정기' },
];

function todayStr() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST
}
function fmtTime(iso: string) {
  // 🔴 정본 kdate 로 옮기지 않았다 — 예약 슬롯은 **병원 시간대(Asia/Seoul)** 로 고정해야 한다(원격 접속 브라우저의 로컬 TZ 를 따르면 슬롯이 밀린다).
  //    formatKDate 는 로컬 TZ 기준이라 여기엔 맞지 않는다. 시간대 고정 모드는 별건(사람 확인: 원격 예약 정책).
  return localeTimeText(new Date(iso), 'ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
}

export default function NewAppointmentPage() {
  const router = useRouter();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const createAppointment = useCreateAppointment();

  // 일 뷰 빈 슬롯 클릭 등에서 넘어온 프리필(department·date)
  const initParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  // 진료 화면 '다음 예약 잡기'가 환자·유형(재진)을 넘긴다 — 다시 찾게 하지 않는다
  const [patientId, setPatientId] = useState(initParams?.get('patientId') ?? '');
  const [department, setDepartment] = useState(initParams?.get('department') ?? '');
  const [date, setDate] = useState(initParams?.get('date') ?? todayStr());
  const [duration, setDuration] = useState(30);
  const [type, setType] = useState(() => { const t = initParams?.get('type'); return t && TYPE_OPTIONS.some((o) => o.value === t) ? t : 'INITIAL'; });
  const [reason, setReason] = useState('');
  const [autoAssign, setAutoAssign] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [selected, setSelected] = useState<{ doctorId: string; doctorName: string; scheduledAt: string; period?: string } | null>(null);
  const [formError, setFormError] = useState('');

  // 진료과 목록(근무 시간표에서 파생)
  const { data: schedRes } = useQuery({
    queryKey: ['clinic-schedule-week-depts'],
    queryFn: () => apiClient.get<{ data: ScheduleRow[] }>('/api/v1/clinic-schedule/week'),
    staleTime: 5 * 60 * 1000,
  });
  const departments = useMemo(() => {
    // /clinic-schedule/week는 이중 래핑({data:{data:[...]}}) — 배열/객체 모두 방어적 언랩
    const raw = schedRes?.data as unknown;
    const rows = (Array.isArray(raw) ? raw : (raw as { data?: ScheduleRow[] })?.data ?? []) as ScheduleRow[];
    return [...new Set(rows.map((r) => r.departmentName).filter(Boolean) as string[])].sort();
  }, [schedRes]);

  // 가용 슬롯(과 + 날짜)
  const { data: availRes, isFetching: availLoading } = useQuery({
    queryKey: ['appointment-availability', department, date, duration],
    queryFn: () =>
      apiClient.get<{ data: { sessions: AvailabilitySession[] } }>(
        `/api/v1/appointments/availability?departmentName=${encodeURIComponent(department)}&date=${date}&duration=${duration}`,
      ),
    enabled: !!department && !!date,
  });
  const sessions = availRes?.data?.sessions ?? [];

  const canSubmit = !!patientId && !!selected;

  const onSubmit = async () => {
    setFormError('');
    if (!patientId) return setFormError(tAttr('환자를 선택하세요.'));
    if (!selected) return setFormError(tAttr('가용 슬롯을 선택하세요.'));
    try {
      const res = await createAppointment.mutateAsync({
        patientId,
        // 자동배정: doctorId 생략 → 서버가 부하분산 배정
        ...(autoAssign ? { departmentName: department } : { doctorId: selected.doctorId }),
        scheduledAt: selected.scheduledAt,
        duration,
        type,
        reason: reason || undefined,
        bookedVia: 'STAFF',
        ...(repeatWeeks > 1 ? { repeatWeeks } : {}),
      });
      const meta = (res as { meta?: { warnings?: string[]; recurring?: { created: number; requested: number } } })?.meta;
      if (meta?.recurring) toast.success(tfAttr('반복 예약 {생성}/{요청}회 생성되었습니다.', { 생성: meta.recurring.created, 요청: meta.recurring.requested }));
      if (meta?.warnings?.length) toast.warning(meta.warnings.join(' '));
      router.push('/schedule');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : tAttr('예약 생성에 실패했습니다.'));
    }
  };

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6"><T k="예약 생성" /></h2>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        {/* 환자 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1"><T k="환자" /></label>
          <PatientSelector value={patientId} onChange={setPatientId} context="schedule" />
        </div>

        {/* 진료과 + 날짜 + 소요시간 */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="진료과" /></label>
            <select
              value={department}
              onChange={(e) => { setDepartment(e.target.value); setSelected(null); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{tAttr('선택')}</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="날짜" /></label>
            <input
              type="date" value={date}
              onChange={(e) => { setDate(e.target.value); setSelected(null); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="진료 시간(분)" /></label>
            <input
              type="number" value={duration} min={5} max={240} step={5}
              onChange={(e) => { setDuration(Number(e.target.value) || 30); setSelected(null); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 가용 슬롯 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700"><T k="가용 슬롯" /></label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
              <T k="담당의 없이 자동 배정(부하분산)" />
            </label>
          </div>
          {!department && <p className="text-xs text-gray-400"><T k="진료과를 선택하면 가용 슬롯이 표시됩니다." /></p>}
          {department && availLoading && <p className="text-xs text-gray-400"><T k="슬롯 조회 중..." /></p>}
          {department && !availLoading && sessions.length === 0 && (
            <p className="text-xs text-gray-400"><T k="해당 날짜에 근무 시간표가 없습니다." /></p>
          )}
          <div className="space-y-3">
            {sessions.map((s) => (
              <div key={`${s.doctorId}-${s.period}-${s.startTime}`} className={`border rounded-lg p-3 ${s.closed ? 'bg-gray-50 border-gray-200' : 'border-gray-200'}`}>
                <div className="flex items-center gap-2 mb-2 text-sm">
                  <span className="font-semibold text-gray-800">{s.doctorName || <T k="의사" />}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-500">{s.period} {s.startTime}~{s.endTime} {s.roomName && `· ${s.roomName}`}</span>
                  {s.closed
                    ? <span className="ml-auto text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full"><T k="휴진" /></span>
                    : s.closureReview
                    ? <span className="ml-auto text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full whitespace-nowrap"><T k="반일 휴진 확인 필요" /></span>
                    : <span className="ml-auto text-[11px] text-gray-500"><Tf k="잔여 {잔여}/{정원}" params={{ 잔여: s.remaining, 정원: s.maxPatients }} /></span>}
                </div>
                {!s.closed && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.slots.map((sl) => {
                      const isSel = selected?.scheduledAt === sl.start && (autoAssign || selected?.doctorId === s.doctorId);
                      return (
                        <button
                          key={sl.start}
                          type="button"
                          disabled={!sl.available}
                          onClick={() => setSelected({ doctorId: s.doctorId, doctorName: s.doctorName, scheduledAt: sl.start, period: s.period })}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                            !sl.available ? 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed line-through'
                            : isSel ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                          }`}
                        >
                          {fmtTime(sl.start)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          {selected && (
            <p className="text-xs text-blue-700 mt-2">
              <Tf k="선택: {일시}" params={{ 일시: localeDateTimeText(new Date(selected.scheduledAt), 'ko-KR', { timeZone: 'Asia/Seoul' }) }} />
              {autoAssign ? <> · <T k="자동 배정" /></> : ` · ${selected.doctorName}`}
            </p>
          )}
        </div>

        {/* 유형 + 반복 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="유형" /></label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{tAttr(t.label)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="반복(주 단위 회차)" /></label>
            <input
              type="number" value={repeatWeeks} min={1} max={12}
              onChange={(e) => setRepeatWeeks(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-gray-400 mt-0.5"><T k="1=단건, N=매주 동일 시각 N회" /></p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1"><T k="방문 사유" /></label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder={tAttr('방문 사유를 입력하세요 (선택)')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button" onClick={onSubmit}
            disabled={!canSubmit || createAppointment.isPending}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <T k={createAppointment.isPending ? '생성 중...' : '예약 생성'} />
          </button>
          <button type="button" onClick={() => router.back()} className="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            <T k="취소" />
          </button>
        </div>
      </div>
    </div>
  );
}
