'use client';

import { HOSPITAL_CONTACT, telHref } from '@/lib/hospital-contact';
import { portalDateText } from '../_shared/portal-date';
import { useState, useEffect, useRef } from 'react';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import type { PatientInfo, PortalData, PortalItem, CareSegment, Encounter, Questionnaire } from '../_types';
import { fmt, fmtTime, splitAppointments } from '../_helpers';
import { Icon, StatusBadge, EmptyState, SkeletonCard, SegmentControl } from '../_shared';
export { splitAppointments };
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { PrescriptionExplainSheet } from '../_shared/DrugExplainSheet';
import TreatmentScheduleSegment from './TreatmentScheduleSegment';
import { CostEstimatePanel } from './CostEstimatePanel';
import { AppointmentRoutePanel } from './AppointmentRoutePanel';
import { VisitSummaryPanel } from './VisitSummaryPanel';
import { ICONS } from '../_icons';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { PT, usePortalTAttr } from '../_shared/PT';
import { VideoLinkStatus, deriveVideoLinkView, useBrowserOnline } from '@/components/telehealth/VideoLinkStatus';

// UTF-8 안전 base64 (btoa는 Latin1만 → 한글 이름/문서해시 인코딩 시 오류)

interface CareTabProps {
  patient: PatientInfo;
  data: PortalData;
  initialSegment?: CareSegment;
}

const CARE_SEGMENTS: { key: CareSegment; label: string }[] = [
  { key: 'appointments', label: '예약/대기' },
  { key: 'schedule', label: '치료 일정' },
  { key: 'encounters', label: '진료이력' },
  { key: 'questionnaire', label: '문진표' },
  { key: 'consent' as CareSegment, label: '동의서' },
  { key: 'messages', label: '비대면진료' },
];

export default function CareTab({ patient, data, initialSegment }: CareTabProps) {
  const [segment, setSegment] = useState<CareSegment>(initialSegment ?? 'appointments');

  // 외부에서 initialSegment가 변경되면 반영
  useEffect(() => {
    if (initialSegment) setSegment(initialSegment);
  }, [initialSegment]);

  return (
    <div className="space-y-4">
      <SegmentControl segments={CARE_SEGMENTS} active={segment} onChange={setSegment} />

      {segment === 'appointments' && (
        <AppointmentsSegment appointments={data.appointments} />
      )}
      {segment === 'schedule' && (
        <TreatmentScheduleSegment />
      )}
      {segment === 'encounters' && (
        <EncountersSegment encounters={data.encounters} />
      )}
      {segment === 'questionnaire' && (
        <QuestionnaireOnlySegment questionnaires={data.questionnaires} />
      )}
      {(segment as string) === 'consent' && (
        <ConsentSegment patient={patient} />
      )}
      {segment === 'messages' && (
        <MessagesSegment />
      )}
    </div>
  );
}

/* ── 세그먼트 1: 예약/대기 ── */
function AppointmentsSegment({ appointments }: { appointments: PortalData['appointments'] }) {
  const tAttr = usePortalTAttr();
  const [list, setList] = useState(appointments);
  const [showBooking, setShowBooking] = useState(false);
  const { upcoming, past } = splitAppointments(list);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="예약 내역" /></h3>
        <div className="flex gap-2">
          <button onClick={() => setShowBooking((v) => !v)} className="text-xs px-3 py-1 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50">{showBooking ? '닫기' : '+ 새 예약 신청'}</button>
          <Link href="/booking" className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{AI_ORIGIN_TEXT} 예약</Link>
        </div>
      </div>

      {showBooking && <SelfBookingForm onDone={() => setShowBooking(false)} />}

      {/* 대기 현황 */}
      <WaitingStatusCard />

      {/* 🔴 (2026-10-19 포털 세련화 A2) 지난 예약(8/10 '접수')이 "예약 내역" 맨 위에 섞였다 — 다가오는 것과 지난 것을 가른다 */}
      <h4 className="text-xs font-semibold text-gray-600"><PT k="다가오는 예약" /></h4>
      {upcoming.length === 0 ? (
        <EmptyState icon="📋" title="다가오는 예약이 없습니다" actionLabel="예약하러 가기" onAction={() => { window.location.href = '/booking'; }} />
      ) : upcoming.map(a => (
        <div key={a.id} className="bg-white rounded-xl border p-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-sm font-medium text-gray-900">{a.department} · {a.doctorName}</p>
              <p className="text-xs text-gray-500 mt-0.5">{fmt(a.scheduledAt)} {fmtTime(a.scheduledAt)}</p>
              {a.reason && <p className="text-xs text-gray-400 mt-0.5">{a.reason}</p>}
            </div>
            <StatusBadge status={a.status} domain="appointment" />
          </div>
          {(a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && (
            <div className="flex gap-2 mt-2 pt-2 border-t">
              <button onClick={async () => {
                const newDate = prompt('변경할 날짜와 시간을 입력하세요\n(예: 2026-05-25T10:00)', new Date(a.scheduledAt).toISOString().slice(0, 16));
                if (!newDate) return;
                try {
                  await apiClient.put(`/api/v1/portal/appointments/${a.id}/reschedule`, { scheduledAt: newDate });
                  setList(prev => prev.map(ap => ap.id === a.id ? { ...ap, scheduledAt: newDate } : ap));
                  alert('예약이 변경되었습니다.');
                } catch { alert('변경에 실패했습니다.'); }
              }} className="text-xs text-blue-600 hover:text-blue-800"><PT k="변경" /></button>
              <button onClick={async () => {
                if (!confirm('예약을 취소하시겠습니까?')) return;
                try {
                  await apiClient.put(`/api/v1/portal/appointments/${a.id}/cancel`, { reason: '환자 직접 취소' });
                  setList(prev => prev.map(ap => ap.id === a.id ? { ...ap, status: 'CANCELLED' } : ap));
                } catch { alert('취소에 실패했습니다.'); }
              }} className="text-xs text-red-500 hover:text-red-700">취소</button>
            </div>
          )}
          {/* 🔴 (2026-10-20 B6 · 결정 portal.costEstimate) 예측 자료 — 펼칠 때만 계산한다 */}
          {(a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && <CostEstimatePanel appointmentId={a.id} />}
          {/* (2026-10-26 B1 남은 몫) 접수 전 진료실 가는 길 — 오늘 이후 예약 · 펼칠 때만 부른다 */}
          {(a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && <AppointmentRoutePanel appointmentId={a.id} />}
        </div>
      ))}
      {past.length > 0 && (
        <details className="bg-white rounded-xl border" data-portal-past-appointments>
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-gray-600"><PT k="지난 예약" /> {past.length}</summary>
          <ul className="divide-y">
            {past.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                <span className="text-gray-700">{fmt(a.scheduledAt)} {fmtTime(a.scheduledAt)} · {a.department} · {a.doctorName}</span>
                <StatusBadge status={a.status} domain="appointment" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ── 셀프 예약 신청 ── */
interface BookSlot { start: string; available: boolean }
interface BookSession { doctorId: string; doctorName: string; period?: string; startTime: string; endTime: string; remaining: number; closed: boolean; closureReview?: boolean; slots: BookSlot[] }
function SelfBookingForm({ onDone }: { onDone: () => void }) {
  const tAttr = usePortalTAttr();
  const qc = useQueryClient();
  const [department, setDepartment] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
  const [selected, setSelected] = useState<{ doctorId: string; doctorName: string; scheduledAt: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: deptData, isError: deptIsError, error: deptError, refetch: refetchDepts } = useQuery({
    queryKey: ['portal-public-depts'],
    queryFn: () => apiClient.get<{ data: { name: string }[] }>('/api/v1/public/departments'),
  });
  const departments: string[] = (() => {
    const d = deptData?.data;
    const arr = Array.isArray(d) ? d : (d as unknown as { data?: { name: string }[] })?.data ?? [];
    return arr.map((x) => x.name).filter(Boolean);
  })();

  const { data: availData, isFetching, isError: availIsError, error: availError, refetch: refetchAvail } = useQuery({
    queryKey: ['portal-availability', department, date],
    queryFn: () => apiClient.get<{ data: { sessions: BookSession[] } }>(`/api/v1/portal/appointments/availability?departmentName=${encodeURIComponent(department)}&date=${date}`),
    enabled: !!department && !!date,
  });
  const sessions = availData?.data?.sessions ?? [];

  const submit = async () => {
    setErr('');
    if (!selected) { setErr('가용 시간을 선택하세요.'); return; }
    setBusy(true);
    try {
      await apiClient.post('/api/v1/portal/appointments', { departmentName: department, doctorId: selected.doctorId, scheduledAt: selected.scheduledAt, reason: reason || undefined });
      alert('예약이 신청되었습니다. 병원 확정 후 안내됩니다.');
      qc.invalidateQueries({ queryKey: ['portal'] });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '예약 신청에 실패했습니다 (셀프예약 미활성일 수 있습니다).');
    }
    setBusy(false);
  };

  const registerWaitlist = async () => {
    setErr('');
    if (!department) { setErr('진료과를 선택하세요.'); return; }
    setBusy(true);
    try {
      await apiClient.post('/api/v1/portal/appointments/waitlist', { departmentName: department, note: reason || undefined });
      alert('대기자로 등록되었습니다. 자리가 나면 안내드립니다.');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '대기 등록에 실패했습니다.');
    }
    setBusy(false);
  };

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select value={department} onChange={(e) => { setDepartment(e.target.value); setSelected(null); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value=""><PT k="진료과 선택" /></option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSelected(null); }} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      {deptIsError && <QueryErrorFallback error={deptError} onRetry={() => refetchDepts()} size="compact" />}
      {!department && !deptIsError && <p className="text-xs text-gray-400"><PT k="진료과를 선택하면 예약 가능 시간이 표시됩니다." /></p>}
      {department && isFetching && <p className="text-xs text-gray-400"><PT k="가용 시간 조회 중..." /></p>}
      {/* 🔴 (2026-10-22 포털 A6) 조회 실패를 "예약 가능한 진료가 없습니다"로 말하지 않는다 — 환자는 자리가 없다고 믿고 돌아선다 */}
      {department && !isFetching && availIsError && <QueryErrorFallback error={availError} onRetry={() => refetchAvail()} size="compact" />}
      {department && !isFetching && !availIsError && sessions.length === 0 && <p className="text-xs text-gray-400"><PT k="해당 날짜에 예약 가능한 진료가 없습니다." /></p>}
      <div className="space-y-2">
        {sessions.filter((s) => !s.closed).map((s) => (
          <div key={`${s.doctorId}-${s.startTime}`} className="border border-gray-100 rounded-lg p-2">
            <p className="text-xs font-medium text-gray-700 mb-1">{s.doctorName} · {s.period} (잔여 {s.remaining})</p>
            {/* 서버가 종일 세션+반일 휴진 슬롯을 내놓지 않는다(portal getAppointmentAvailability) — 왜 비었는지 말한다 */}
            {s.closureReview && <p className="text-[11px] text-amber-700 mb-1"><PT k="이 날은 반일 휴진이 있어 온라인 예약을 받지 않습니다. 병원에 문의해 주세요." /></p>}
            <div className="flex flex-wrap gap-1">
              {s.slots.map((sl) => {
                const isSel = selected?.scheduledAt === sl.start && selected?.doctorId === s.doctorId;
                return (
                  <button key={sl.start} type="button" disabled={!sl.available}
                    onClick={() => setSelected({ doctorId: s.doctorId, doctorName: s.doctorName, scheduledAt: sl.start })}
                    className={`text-xs px-2 py-1 rounded-md border ${!sl.available ? 'bg-gray-100 text-gray-300 line-through cursor-not-allowed' : isSel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                    {fmtTime(sl.start)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('방문 사유 (선택)')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      {selected && <p className="text-xs text-blue-700">선택: {fmt(selected.scheduledAt)} {fmtTime(selected.scheduledAt)} · {selected.doctorName}</p>}
      <button onClick={submit} disabled={!selected || busy} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
        {busy ? '신청 중...' : '예약 신청'}
      </button>
      <button onClick={registerWaitlist} disabled={!department || busy} className="w-full py-2 border border-blue-300 text-blue-700 rounded-lg text-sm font-medium disabled:opacity-50">
        <PT k="원하는 시간이 없어요 · 대기 등록" />
      </button>
    </div>
  );
}

/* ── 대기 현황 카드 ── */
function WaitingStatusCard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-waiting'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/waiting-status'),
    refetchInterval: 30000,
  });

  if (isLoading) return <SkeletonCard lines={2} />;
  // 🔴 (포털 A6) 실패를 "대기 없음"(카드 숨김)으로 접지 않는다 — 대기 중인 환자는 순번이 사라진 줄 안다
  //    30초 갱신 중 한 번 실패하면 받은 값은 남는다(react-query) — 받은 값이 없을 때만 실패로 그린다
  if (isError && !data) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;

  const raw = data?.data;
  const queues = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  if (!queues.length) return null;

  return (
    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
      <p className="text-xs font-semibold text-emerald-800 mb-2 flex items-center gap-1">
        <Icon d={ICONS.stethoscope} cls="w-3.5 h-3.5" /> <PT k="대기 현황" />
      </p>
      {queues.map((q: PortalItem) => (
        <div key={String(q.id)} className="flex justify-between items-center text-sm">
          <span className="text-gray-700">{String(q.departmentName ?? '')} · #{String(q.queueNumber ?? '')}</span>
          <div className="text-right">
            <span className="text-emerald-700 font-semibold">앞 {String(q.aheadCount ?? '')}<Unit>명</Unit></span>
            {/* 🔴 W9: `{estimatedMinutes ?? ''}분` 은 서버의 null(=표본 없어 모름)을 받아 "(분)" 으로 깨졌다. 모르면 안 적는다. */}
            {q.estimatedMinutes != null && <span className="text-xs text-gray-500 ml-1">({String(q.estimatedMinutes)}<Unit>분</Unit>)</span>}
            {/* 🔴 (2026-10-19 포털 B1) 대기표 길안내(공개 · 출입구→진료실 경로 · 통제 구역 가림)로 잇는다 — 진료실이 정해진 뒤에만 */}
            {q.roomName ? (
              <a href={`/guide/${String(q.id)}`} target="_blank" rel="noopener noreferrer" data-portal-guide-link
                className="ml-2 inline-flex min-h-[32px] items-center rounded-lg border border-emerald-300 bg-white px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                <PT k="진료실 가는 길" />
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 세그먼트 2: 진료이력 ── */
function EncountersSegment({ encounters }: { encounters: Encounter[] }) {
  const tAttr = usePortalTAttr();
  // F-7: "이번 처방 한눈에" — encounter 단위 처방 쉬운 설명(비동기 잡·폴링). OFF(404)/처방 없음은 시트 안 조용한 폴백
  const [explainEncounterId, setExplainEncounterId] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 mb-1"><PT k="진료 이력" /></h3>
      {encounters.length > 0 && <PortalAiEncounterSummary encounters={encounters} />}
      {encounters.length === 0 ? (
        <EmptyState icon="🩺" title="진료 이력이 없습니다" />
      ) : encounters.map(e => (
        <div key={e.id} className="bg-white rounded-xl border p-4">
          <div className="flex justify-between items-start mb-2">
            <p className="text-sm font-medium text-gray-900">{e.doctorName}</p>
            <p className="text-xs text-gray-500">{fmt(e.encounteredAt)}</p>
          </div>
          {e.diagnosisNames?.length > 0 && (
            <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-1.5 mb-2">{e.diagnosisNames.join(', ')}</p>
          )}
          {/* 🔴 (2026-10-20 B2 · 결정 portal.visitSummaryScope = GENERAL) 의사 소견 원문 대신 일반 수준 진료 후 요약 */}
          <VisitSummaryPanel encounterId={e.id} />
          {/* F-7 진입 버튼 — 브랜드 없는 라벨(§6.5-①) */}
          <button
            onClick={() => setExplainEncounterId(e.id)}
            className="mt-2 w-full py-2 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors">
            <PT k="이번 처방 한눈에" />
          </button>
        </div>
      ))}
      {explainEncounterId && (
        <PrescriptionExplainSheet open onClose={() => setExplainEncounterId(null)} encounterId={explainEncounterId} />
      )}

      {/* 만족도 평가 */}
      <SatisfactionSection />

      {/* 수술 전 체크리스트 */}
      <SurgeryChecklistSection />
    </div>
  );
}

/* ── WeRU.B 진료 요약 ── */
function PortalAiEncounterSummary({ encounters }: { encounters: Encounter[] }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const text = encounters.slice(0, 5).map(e =>
        `${fmt(e.encounteredAt)}: ${e.doctorName} - ${e.diagnosisNames?.length ? e.diagnosisNames.join(', ') : '진단 기록 없음'}`
      ).join('\n');
      const question = `다음은 제 최근 진료 이력입니다. 쉬운 한국어로 요약해주세요.\n\n${text || '최근 진료 없음'}`;
      const res = await apiClient.post<{ data: { answer?: string } }>('/api/v1/portal/ai/ask', { question });
      setSummary(res?.data?.answer ?? '요약을 생성하지 못했습니다.');
    } catch { setSummary(`${AI_ORIGIN_TEXT} 요약에 실패했습니다.`); }
    setLoading(false);
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-indigo-700">최근 진료 {AI_ORIGIN_TEXT} 요약</p>
        <button onClick={generate} disabled={loading}
          className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-[10px] font-medium hover:bg-indigo-700 disabled:opacity-50">
          {loading ? '요약 중...' : '요약 보기'}
        </button>
      </div>
      {summary && (
        <div className="mt-2 bg-white rounded-lg p-2.5 text-xs text-indigo-900 whitespace-pre-wrap border border-indigo-100">
          {summary}
          <p className="text-[11px] text-indigo-700 mt-1">AI(WeRU.B) 생성 참고 정보 — 정확한 내용은 담당 의사에게 문의하세요</p>
        </div>
      )}
    </div>
  );
}

/* ── 만족도 평가 ── */
function SatisfactionSection() {
  const tAttr = usePortalTAttr();
  const { data, refetch, isError, error } = useQuery({
    queryKey: ['portal-satisfaction'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/satisfaction'),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ overallRating: 5, waitRating: 5, staffRating: 5, facilityRating: 5, comment: '' });
  const raw = data?.data;
  const surveys = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const submit = async () => {
    try {
      await apiClient.post('/api/v1/portal/satisfaction', form);
      setOpen(false);
      refetch();
    } catch { alert('제출에 실패했습니다.'); }
  };
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

  return (
    <div className="mt-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="만족도 평가" /></h3>
        {!open && <button onClick={() => setOpen(true)} className="text-xs text-blue-600 hover:underline"><PT k="+ 평가하기" /></button>}
      </div>
      {open && (
        <div className="bg-white rounded-xl border p-4 mb-2 space-y-3">
          {[
            { key: 'overallRating', label: '전체 만족도' },
            { key: 'waitRating', label: '대기 시간' },
            { key: 'staffRating', label: '직원 친절도' },
            { key: 'facilityRating', label: '시설 청결도' },
          ].map(({ key, label }) => (
            <div key={key} className="flex justify-between items-center">
              <span className="text-xs text-gray-600">{label}</span>
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map(v => (
                <button key={v} onClick={() => setForm(f => ({ ...f, [key]: v }))}
                  className={`text-lg ${v <= (form as unknown as Record<string, number>)[key] ? 'text-yellow-400' : 'text-gray-200'}`}>★</button>
              ))}</div>
            </div>
          ))}
          <textarea value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
            placeholder={tAttr('의견을 남겨주세요 (선택)')} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
          <div className="flex gap-2">
            <button onClick={submit} className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg"><PT k="제출" /></button>
            <button onClick={() => setOpen(false)} className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg">취소</button>
          </div>
        </div>
      )}
      {isError && <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" className="mb-1.5" />}
      {surveys.slice(0, 3).map((s: PortalItem) => (
        <div key={String(s.id)} className="bg-white rounded-xl border p-3 mb-1.5">
          <div className="flex justify-between">
            <span className="text-xs text-yellow-500">{stars(Number(s.overallRating ?? 0))}</span>
            <span className="text-[10px] text-gray-400">{portalDateText(s.createdAt, 'date')}</span>
          </div>
          {s.comment != null && <p className="text-xs text-gray-600 mt-1">{String(s.comment)}</p>}
        </div>
      ))}
    </div>
  );
}

/* ── 수술 전 체크리스트 ── */
function SurgeryChecklistSection() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-surgery-checklist'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/surgery-checklist'),
  });

  if (isError) return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-2"><PT k="수술 전 체크리스트" /></h3>
      <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
    </div>
  );
  if (isLoading) return <SkeletonCard lines={3} />;

  const raw = data?.data;
  const surgeries = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];
  if (!surgeries.length) return null;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-2"><PT k="수술 전 체크리스트" /></h3>
      {surgeries.map((s: PortalItem) => {
        const checklist = s.checklist as Record<string, unknown> | undefined;
        return (
        <div key={String(s.id)} className="bg-white rounded-xl border p-4 mb-1.5">
          <div className="flex justify-between items-start mb-2">
            <p className="text-sm font-medium text-gray-900">{String(s.procedureName ?? '')}</p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${s.status === 'PREP' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
              {s.status === 'PREP' ? '준비중' : '예정'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            {portalDateText(s.scheduledAt, 'monthDayTime')}
          </p>
          {checklist && (
            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
              <div className={`rounded-lg py-1.5 ${checklist.signIn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>Sign In {checklist.signIn ? '✓' : '—'}</div>
              <div className={`rounded-lg py-1.5 ${checklist.timeOut ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>Time Out {checklist.timeOut ? '✓' : '—'}</div>
              <div className={`rounded-lg py-1.5 ${checklist.signOut ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>Sign Out {checklist.signOut ? '✓' : '—'}</div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

/* ── 세그먼트 3: 문진/동의 ── */
/* ── 문진표만 (동의서 분리) ── */
function QuestionnaireOnlySegment({ questionnaires }: { questionnaires: Questionnaire[] }) {
  const tAttr = usePortalTAttr();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 mb-1"><PT k="문진표" /></h3>
      {questionnaires.length === 0 ? (
        <EmptyState icon="📝" title="문진표가 없습니다" />
      ) : questionnaires.map(q => {
        const isPending = q.status !== 'COMPLETED' && new Date(q.expiresAt) > new Date();
        const isExpired = q.status !== 'COMPLETED' && new Date(q.expiresAt) <= new Date();
        return (
          <div key={q.id} className="bg-white rounded-xl border p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-gray-900">{q.formSchema?.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {q.completedAt ? `작성: ${fmt(q.completedAt)}` : `발송: ${fmt(q.createdAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {q.status === 'COMPLETED' && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium whitespace-nowrap"><PT k="완료" /></span>}
                {isPending && <a href={`/questionnaire/${q.token}`} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"><PT k="작성하기" /></a>}
                {isExpired && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 whitespace-nowrap"><PT k="만료" /></span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── 동의서 세그먼트 (초진 동의서 + 진료 동의서) ── */
function ConsentSegment({ patient }: { patient: PatientInfo }) {
  return (
    <div className="space-y-4">
      {/* 초진 동의서 (RegistrationConsent) */}
      <RegistrationConsentSection patientId={patient.id} />

      {/* 진료 동의서 (수술/시술 등) */}
      <ConsentSection />
    </div>
  );
}

/**
 * 🔴 동의서 전문(全文)의 정본은 **서버**다(registration-consent `consent-details.ts` · 2026-08-25 이동).
 *    종전엔 법정 전문 10종이 이 파일 상수(270여 줄)에 있었다 — 정본이 화면 코드에 있으면
 *    개정 시 배포가 필요하고 접수창구·포털·앱이 서로 다른 문안을 보여줄 수 있다.
 *    이제 API 가 detail 을 동봉한다. **전문이 안 오면 안 온다고 말한다** — 빈 전문에
 *    '내용 확인' 체크를 열지 않는다(개인정보보호법 §22: 명확히 인지하고 동의).
 */
interface RegistrationConsentItem {
  type: string; label: string; required: boolean; law: string;
  agreed: boolean; signedAt: string | null; expired: boolean;
  detail?: string | null; consentId?: string | null;
}

/* ── 초진 동의서 (법정 10종) ── */
function RegistrationConsentSection({ patientId }: { patientId: string }) {
  const tAttr = usePortalTAttr();
  const { data, refetch, isError: consentIsError, error: consentError } = useQuery({
    queryKey: ['portal-registration-consents', patientId],
    queryFn: () => apiClient.get<{ data: { consents: RegistrationConsentItem[]; requiredComplete: boolean } }>('/api/v1/portal/registration-consents'),
  });

  // 블록체인 인증서 조회
  const { data: certData, refetch: refetchCert, isError: certIsError, error: certQueryError } = useQuery({
    queryKey: ['portal-cert-for-consent'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/cert/my'),
  });
  const rawCerts = certData?.data;
  const certs = (Array.isArray(rawCerts) ? rawCerts : (rawCerts as any)?.data ?? []) as { id?: string; status?: string; certificateId?: string }[];
  const activeCert = certs.find(c => c.status === 'ACTIVE');

  // 🔴 (2026-09-15 N2) 종전엔 인증서가 없으면 **마운트 시 자동 발급**하며 `base64('portal-patient-<시각>')` 를
  //    공개키라고 보냈고, 갱신 버튼도 같은 가짜 키를 보냈다 — 개인키가 어디에도 없는 인증서가 "블록체인 인증서 활성"으로
  //    그려졌다. 환자 개인키를 어디에 보관할지는 정해지지 않았으므로(사람 결정) 이 화면은 인증서를 발급하지 않는다.
  //    서버도 이제 SPKI 가 아닌 공개키를 400 으로 거부한다. 동의서 서명은 이름 입력으로 기록된다(T2).

  const result = data?.data;
  // 🔴 전문·목록 모두 서버 정본 그대로 — 폴백 목록을 상태처럼 렌더하지 않는다(빈 응답이면 빈 사실을 보여준다)
  const consents: RegistrationConsentItem[] = (result as any)?.consents ?? [];
  const requiredComplete = (result as any)?.requiredComplete ?? false;
  const pendingRequired = consents.filter((c: any) => c.required && !c.agreed);

  const [signing, setSigning] = useState<string | null>(null);
  const [sigName, setSigName] = useState('');
  const [showBulkSign, setShowBulkSign] = useState(false);
  const [bulkSigName, setBulkSigName] = useState('');
  const [bulkSigning, setBulkSigning] = useState(false);

  // 각 동의서별 "내용 확인" 체크 (개인정보보호법 제22조: 명확하게 인지)
  const [readChecks, setReadChecks] = useState<Record<string, boolean>>({});
  const toggleRead = (type: string) => setReadChecks(prev => ({ ...prev, [type]: !prev[type] }));

  const unsignedConsents = consents.filter((c: any) => !c.agreed);
  const unsignedRequired = unsignedConsents.filter((c: any) => c.required);
  const allRequiredRead = unsignedRequired.every((c: any) => readChecks[c.type]);

  // 일괄 서명
  const doBulkSign = async () => {
    if (!bulkSigName.trim()) { alert('이름을 입력해주세요'); return; }
    if (!allRequiredRead) { alert('모든 필수 동의서 내용을 확인(체크)해주세요'); return; }
    setBulkSigning(true);
    const token = apiClient.getToken();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    let success = 0;

    // 확인된 동의서만 서명 (필수 전체 + 선택 중 체크된 것)
    const toSign = unsignedConsents.filter((c: any) => c.required || readChecks[c.type]);

    for (const c of toSign) {
      try {
        const res = await fetch(`${apiUrl}/api/v1/portal/registration-consents/${(c as any).type}/sign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            // 🔴 (2026-09-15 T2) 서명 방식·서명값을 화면이 지어내지 않는다 — 종전 `BLOCKCHAIN` + base64(이름-유형-시각)
            //   은 서명이 아니었고 서버도 저장하지 않았다. 방식은 서버가 PORTAL 로 기록한다(consent-sign-evidence.ts).
            signedBy: bulkSigName,
          }),
        });
        if (res.ok) success++;
      } catch { /* continue */ }
    }

    setBulkSigning(false);
    setShowBulkSign(false);
    setBulkSigName('');
    setReadChecks({});
    if (success > 0) refetch();
    alert(`${success}건 동의 완료`);
  };

  const doSign = async (type: string) => {
    if (!sigName.trim()) { alert('이름을 입력해주세요'); return; }
    try {
      const token = apiClient.getToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${apiUrl}/api/v1/portal/registration-consents/${type}/sign`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          signedBy: sigName,
        }),
      });
      if (res.ok) {
        setSigning(null); setSigName('');
        refetch();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body?.message || body?.error?.message || `서명 실패 (${res.status})`);
      }
    } catch (e) {
      alert(`서명 요청 실패: ${e instanceof Error ? e.message : '네트워크 오류'}`);
    }
  };

  // 🔴 조회 실패를 "미동의"로 말하지 않는다 — 서명 여부를 모르는 상태다
  if (consentIsError) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="접수 동의서" /></h3>
        <QueryErrorFallback error={consentError} onRetry={() => refetch()} size="compact" />
        <p className="text-[11px] text-gray-500"><PT k="동의서 서명 여부를 확인하지 못했습니다. 잠시 후 다시 시도하거나 접수창구에 문의해주세요." /></p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="접수 동의서" /></h3>
        {requiredComplete ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold whitespace-nowrap"><PT k="전체 동의 완료" /></span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold whitespace-nowrap">필수 {pendingRequired.length}<Unit>건</Unit> <PT k="미동의" /></span>
        )}
      </div>

      {/* 인증서 상태 — 등록된 인증서가 있어도 이 화면의 서명에 쓰이지 않는다는 사실만 말한다 */}
      {certIsError ? (
        <QueryErrorFallback error={certQueryError} onRetry={() => refetchCert()} size="compact" />
      ) : activeCert ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-[11px] text-gray-600">등록된 인증서가 있지만 동의서 서명에는 적용되지 않습니다 — 동의서 서명은 이름 입력으로 기록됩니다.</p>
        </div>
      ) : null}

      {!requiredComplete && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-amber-800 font-medium"><PT k="필수 동의서 서명이 필요합니다" /></p>
              <p className="text-[10px] text-amber-600 mt-0.5">각 동의서 내용을 확인한 후 일괄 서명하거나 개별 서명할 수 있습니다.</p>
            </div>
            <button onClick={() => setShowBulkSign(!showBulkSign)}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 whitespace-nowrap">
              <PT k="일괄 동의" />
            </button>
          </div>
        </div>
      )}

      {/* 일괄 동의 패널 */}
      {showBulkSign && (
        <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-bold text-blue-900"><PT k="일괄 동의 서명" /></h4>
          <p className="text-[10px] text-blue-700">
            개인정보보호법 제22조에 따라 각 동의 사항을 명확하게 인지한 후 동의해야 합니다.
            아래 각 동의서의 "내용을 확인했습니다" 체크박스를 모두 체크한 후 서명해주세요.
          </p>

          {/* 확인 현황 */}
          <div className="bg-white rounded-lg p-3 space-y-1.5">
            {unsignedConsents.map((c: any) => (
              <label key={c.type} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!readChecks[c.type]} onChange={() => toggleRead(c.type)}
                  className="rounded border-gray-300 text-blue-600" />
                <span className="text-xs text-gray-700 flex-1">{c.label}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${c.required ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                  {c.required ? '필수' : '선택'}
                </span>
                {readChecks[c.type] && <span className="text-emerald-500 text-xs">✓</span>}
              </label>
            ))}
          </div>

          {!allRequiredRead && (
            <p className="text-[10px] text-red-600">필수 동의서 내용을 모두 확인(체크)해야 일괄 서명이 가능합니다.</p>
          )}

          <input value={bulkSigName} onChange={e => setBulkSigName(e.target.value)} placeholder={tAttr('본인 이름 (예: 홍길동)')}
            className="w-full border-2 border-blue-200 rounded-lg px-3 py-3 text-center text-lg font-bold tracking-wider focus:border-blue-500" />

          <div className="flex gap-2">
            <button onClick={doBulkSign} disabled={bulkSigning || !allRequiredRead || !bulkSigName.trim()}
              className="flex-1 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40">
              {bulkSigning ? '서명 중...' : `${unsignedConsents.filter((c: any) => c.required || readChecks[c.type]).length}건 일괄 서명`}
            </button>
            <button onClick={() => { setShowBulkSign(false); setReadChecks({}); setBulkSigName(''); }}
              className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-lg">취소</button>
          </div>
        </div>
      )}

      {consents.map((c: any) => (
        <div key={c.type} className={`bg-white rounded-xl border p-4 ${c.required && !c.agreed ? 'border-amber-300' : 'border-gray-100'}`}>
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-gray-900">{c.label}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${c.required ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                  {c.required ? '필수' : '선택'}
                </span>
              </div>
              <p className="text-[10px] text-blue-500 mt-0.5">{c.law}</p>
              {c.detail && (
                <div className="mt-2 bg-gray-50 rounded-lg p-2.5 text-[11px] text-gray-600 leading-relaxed whitespace-pre-line">{c.detail}</div>
              )}
              {!c.agreed && c.detail && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={!!readChecks[c.type]} onChange={() => toggleRead(c.type)}
                    className="rounded border-gray-300 text-blue-600" />
                  <span className="text-[11px] text-gray-700 font-medium">위 내용을 읽고 확인했습니다</span>
                </label>
              )}
              {/* 🔴 전문이 없으면 없다고 말한다 — 읽지 않은 문서에 '확인' 체크를 열지 않는다(§22 인지 요건) */}
              {!c.agreed && !c.detail && (
                <p className="mt-2 text-[11px] text-amber-700"><PT k="동의서 전문을 불러오지 못했습니다 — 전문 확인 후 서명할 수 있습니다." /> <button type="button" onClick={() => refetch()} className="underline"><PT k="다시 불러오기" /></button></p>
              )}
            </div>
            {c.agreed ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium whitespace-nowrap">
                동의 완료 {c.signedAt ? fmt(c.signedAt) : ''}
              </span>
            ) : (
              <button onClick={() => setSigning(c.type)}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap">
                <PT k="동의하기" />
              </button>
            )}
          </div>

          {/* 서명 입력 */}
          {signing === c.type && (
            <div className="mt-3 pt-3 border-t space-y-2">
              <p className="text-xs text-gray-600">아래에 본인 이름을 입력하여 동의합니다.</p>
              <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder={tAttr('본인 이름 (예: 홍길동)')}
                className="w-full border-2 border-blue-200 rounded-lg px-3 py-3 text-center text-lg font-bold tracking-wider focus:border-blue-500" autoFocus />
              <div className="flex gap-2">
                <button onClick={() => doSign(c.type)} className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                  {'동의 서명'}
                </button>
                <button onClick={() => { setSigning(null); setSigName(''); }} className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg">취소</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── 동의서 섹션 ── */
function ConsentSection() {
  const tAttr = usePortalTAttr();
  const { data, refetch, isError, error } = useQuery({
    queryKey: ['portal-consents'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/consents'),
  });
  const { data: certData, isError: certIsError, error: certError, refetch: refetchCert } = useQuery({
    queryKey: ['portal-cert'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/cert/my'),
  });

  const [signingId, setSigningId] = useState<string | null>(null);
  const [sigCanvas, setSigCanvas] = useState('');

  const raw = data?.data;
  const consents = (Array.isArray(raw) ? raw : (raw as unknown as PortalItem)?.data ?? []) as PortalItem[];

  const rawCerts = certData?.data;
  const certs = (Array.isArray(rawCerts) ? rawCerts : (rawCerts as unknown as PortalItem)?.data ?? []) as PortalItem[];
  const hasActiveCert = certs.some(c => c.status === 'ACTIVE');

  const doSign = async (id: string) => {
    if (!sigCanvas.trim()) { alert('서명을 입력해 주세요.'); return; }
    try {
      await apiClient.put(`/api/v1/portal/consents/${id}/sign`, { signature: sigCanvas });
      setSigningId(null); setSigCanvas('');
      refetch();
    } catch { alert('서명에 실패했습니다.'); }
  };

  // 🔴 조회 실패를 "동의서 없음"으로 접지 않는다(섹션이 통째로 사라진다)
  if (isError) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 mb-1"><PT k="동의서" /></h3>
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      </div>
    );
  }
  if (!consents.length) return null;

  const typeLabel: Record<string, string> = {
    SURGERY: '수술', PROCEDURE: '시술', ANESTHESIA: '마취', TREATMENT: '치료', RESEARCH: '연구', GENERAL: '일반',
  };

  const pendingCount = consents.filter(c => c.status === 'PENDING').length;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
        동의서
        {pendingCount > 0 && (
          <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full">{pendingCount}</span>
        )}
      </h3>
      {certIsError ? (
        <QueryErrorFallback error={certError} onRetry={() => refetchCert()} size="compact" className="mb-2" />
      ) : hasActiveCert && pendingCount > 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-2">
          <p className="text-xs text-emerald-700">인증서가 활성 상태입니다. 동의서 서명은 이름 입력으로 기록되며 인증서 서명은 적용되지 않습니다.</p>
        </div>
      ) : null}
      {consents.map((c: PortalItem) => {
        const cId = String(c.id ?? '');
        const cConsentType = String(c.consentType ?? '');
        const cType = String(c.type ?? '');
        return (
        <div key={cId} className="bg-white rounded-xl border p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded whitespace-nowrap">{typeLabel[cConsentType] ?? (cConsentType ? cConsentType : cType)}</span>
                <p className="text-sm font-medium text-gray-900">{String(c.templateName ?? '')}</p>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{c.signedAt ? `서명: ${fmt(c.signedAt as string)}` : `생성: ${fmt(c.createdAt as string)}`}</p>
            </div>
            {c.status === 'SIGNED' ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium whitespace-nowrap"><PT k="서명완료" /></span>
            ) : (
              <button onClick={() => setSigningId(cId)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"><PT k="서명하기" /></button>
            )}
          </div>
          {c.risks != null && <p className="text-xs text-gray-600 bg-amber-50 rounded-lg px-3 py-1.5 mt-2">위험/부작용: {String(c.risks)}</p>}

          {/* 서명 입력 */}
          {signingId === cId && (
            <div className="mt-3 pt-3 border-t space-y-2">
              <p className="text-xs text-gray-600">아래에 본인 이름을 서명으로 입력해 주세요.</p>
              <input value={sigCanvas} onChange={e => setSigCanvas(e.target.value)} placeholder={tAttr('본인 이름 (예: 홍길동)')}
                className="w-full border-2 border-blue-200 rounded-lg px-3 py-3 text-center text-lg font-bold tracking-wider focus:border-blue-500 focus:ring-2 focus:ring-blue-200" autoFocus />
              <div className="flex gap-2">
                <button onClick={() => doSign(cId)} className="flex-1 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                  {hasActiveCert ? '전자서명' : '서명 확인'}
                </button>
                <button onClick={() => { setSigningId(null); setSigCanvas(''); }} className="flex-1 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg">취소</button>
              </div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

/* ── 세그먼트 4: 비대면진료 (RemoteConsultation) ── */
function MessagesSegment() {
  const tAttr = usePortalTAttr();
  const [view, setView] = useState<'list' | 'detail' | 'new' | 'consent' | 'video'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  // 첫 이용 동의 상태
  const { data: consentData, isError: consentIsError, error: consentError, refetch: refetchConsent } = useQuery({
    queryKey: ['portal-remote-consent-status'],
    queryFn: () => apiClient.get<{ data: { agreed: boolean; paymentMethod?: string | null } }>('/api/v1/portal/remote-consult/consent-status'),
  });
  const consent = ((consentData?.data as PortalItem)?.data ?? consentData?.data) as { agreed?: boolean; paymentMethod?: string | null } | undefined;
  const hasConsent = !!consent?.agreed;

  // 상담 목록 (15초 폴링)
  const { data: listData, isLoading, isError: listIsError, error: listError, refetch: refetchList } = useQuery({
    queryKey: ['portal-remote-consults'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/remote-consult'),
    refetchInterval: 15000,
  });
  const consultations = (Array.isArray(listData?.data) ? listData.data : (listData?.data as unknown as PortalItem)?.data ?? []) as PortalItem[];

  // 상담 상세 (5초 폴링 — 채팅 실시간)
  const { data: detailData, isError: detailIsError, error: detailError, refetch: refetchDetail } = useQuery({
    queryKey: ['portal-remote-consult-detail', selectedId],
    queryFn: () => apiClient.get<{ data: unknown }>(`/api/v1/portal/remote-consult/${selectedId}`),
    enabled: !!selectedId && (view === 'detail' || view === 'video'),
    refetchInterval: 5000,
  });
  const detail = (detailData?.data as PortalItem)?.data ? (detailData?.data as PortalItem).data as PortalItem : detailData?.data as PortalItem | null;
  const detailMessages = ((detail?.messages ?? []) as PortalItem[]);

  // 가능 의사 목록
  const { data: doctorsData, isError: doctorsIsError, error: doctorsError, refetch: refetchDoctors } = useQuery({
    queryKey: ['portal-remote-consult-doctors'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/portal/remote-consult/doctors'),
    enabled: view === 'new',
  });
  const doctors = (Array.isArray(doctorsData?.data) ? doctorsData.data : (doctorsData?.data as unknown as PortalItem)?.data ?? []) as PortalItem[];

  // 새 상담 폼 상태
  const [newForm, setNewForm] = useState({ doctorId: '', channel: 'TEXT', category: 'GENERAL', subject: '', chiefComplaint: '' });

  const refreshDetail = () => queryClient.invalidateQueries({ queryKey: ['portal-remote-consult-detail', selectedId] });
  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['portal-remote-consults'] });

  const sendMessage = async () => {
    if (!msgInput.trim() || !selectedId || sending) return;
    setSending(true);
    try {
      await apiClient.post(`/api/v1/portal/remote-consult/${selectedId}/messages`, { content: msgInput.trim() });
      setMsgInput('');
      refreshDetail();
    } catch { alert('전송에 실패했습니다.'); }
    setSending(false);
  };

  const createConsult = async () => {
    if (!newForm.doctorId || !newForm.subject.trim()) return;
    try {
      await apiClient.post('/api/v1/portal/remote-consult', { ...newForm, chiefComplaint: newForm.chiefComplaint || newForm.subject });
      setView('list');
      setNewForm({ doctorId: '', channel: 'TEXT', category: 'GENERAL', subject: '', chiefComplaint: '' });
      refreshList();
    } catch (e: unknown) {
      // 🔴 ApiError 에는 response 가 없다 — 종전엔 서버 사유가 늘 일반 문구로 덮였다(2026-09-29 외국인 등록에서 발견·같은 형태 봉합)
      const msg = extractErrorMessage(e);
      alert(msg || '상담 요청에 실패했습니다.');
    }
  };

  // 새 상담 진입 — 동의 게이트
  const startNewConsult = () => setView(hasConsent ? 'new' : 'consent');

  // 결제
  const payConsult = async (paymentMethod: string) => {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/portal/remote-consult/${selectedId}/pay`, { paymentMethod });
      refreshDetail(); refreshList();
    } catch { alert('결제에 실패했습니다.'); }
    setBusy(false);
  };

  // 화상 전환 요청
  const requestVideo = async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/portal/remote-consult/${selectedId}/video/request`, {});
      refreshDetail();
    } catch { alert('화상 전환 요청에 실패했습니다.'); }
    setBusy(false);
  };

  // 화상 전환 수락 (의사 제안)
  const acceptVideo = async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/portal/remote-consult/${selectedId}/video/accept`, {});
      refreshDetail();
    } catch { alert('화상 전환 수락에 실패했습니다.'); }
    setBusy(false);
  };

  // 만족도 평가
  const submitRating = async (rating: number, feedback: string) => {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/portal/remote-consult/${selectedId}/rate`, { rating, feedback });
      refreshDetail(); refreshList();
    } catch { alert('평가 등록에 실패했습니다.'); }
    setBusy(false);
  };

  const fmtShort = (d: string) => portalDateText(d, 'monthDayTimeShort');
  const channelIcon: Record<string, string> = { TEXT: '💬', VIDEO: '📹', RESULT_REVIEW: '🔬', HYBRID: '🔄' };
  const statusLabel: Record<string, { text: string; cls: string }> = {
    REQUESTED: { text: '대기', cls: 'bg-amber-100 text-amber-700' },
    ACCEPTED: { text: '수락', cls: 'bg-blue-100 text-blue-700' },
    IN_PROGRESS: { text: '진행 중', cls: 'bg-emerald-100 text-emerald-700' },
    COMPLETED: { text: '완료', cls: 'bg-gray-100 text-gray-600' },
    CANCELLED: { text: '취소', cls: 'bg-red-100 text-red-600' },
  };

  // ── 응급 배너 (Ottehr EmergencyBanner 패턴) ──
  const EmergencyBanner = () => (
    <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-700 flex items-center gap-2">
      <span className="text-base">🚨</span>
      <span>
        응급 상황 시 <a href={telHref(HOSPITAL_CONTACT.emergency119)} className="font-bold underline">119</a> 또는 응급실(
        <a href={telHref(HOSPITAL_CONTACT.emergency)} className="font-bold underline">{HOSPITAL_CONTACT.emergency}</a>)로 즉시 연락하세요.
      </span>
    </div>
  );

  if (isLoading) return <SkeletonCard lines={4} />;

  // ══════════════ 첫 이용 동의 (4단계) ══════════════
  if (view === 'consent') {
    return <RemoteConsentOnboarding
      onCancel={() => setView('list')}
      onDone={() => { queryClient.invalidateQueries({ queryKey: ['portal-remote-consent-status'] }); setView('new'); }}
    />;
  }

  // 🔴 (포털 A6) 상세 조회가 실패하면 목록으로 조용히 떨어지지 않는다 — 실패했다고 말하고 돌아갈 길을 둔다
  if ((view === 'detail' || view === 'video') && !detail && detailIsError) {
    return (
      <div className="space-y-3" data-portal-consult-detail-error>
        <button onClick={() => setView('list')} className="text-sm text-gray-500"><PT k="← 목록으로" /></button>
        <QueryErrorFallback error={detailError} onRetry={() => refetchDetail()} size="compact" />
      </div>
    );
  }

  // ══════════════ 화상 진료 대기실 + 진료실 ══════════════
  if (view === 'video' && detail) {
    return <RemoteVideoRoom
      consultId={String(detail.id)}
      doctorName={(() => { const d = detail.doctor as Record<string, unknown> | undefined; return d ? `${d.familyName}${d.givenName} 교수` : '담당의'; })()}
      scheduledAt={detail.videoScheduledAt ? String(detail.videoScheduledAt) : undefined}
      onBack={() => setView('detail')}
    />;
  }

  // ══════════════ 새 상담 요청 ══════════════
  if (view === 'new') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-600"><span className="sr-only"><PT k="목록으로" /></span><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg></button>
          <h3 className="text-sm font-bold text-gray-900"><PT k="새 상담 요청" /></h3>
        </div>
        <EmergencyBanner />

        {/* 진료 방법 */}
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block"><PT k="진료 방법" /></label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'TEXT', icon: '💬', label: '텍스트 상담', price: '20,000원', desc: '24h 내 답변' },
              { key: 'VIDEO', icon: '📹', label: '화상 진료', price: '40,000원~', desc: '예약제' },
              { key: 'RESULT_REVIEW', icon: '🔬', label: '결과 설명', price: '30,000원', desc: '검사 해석' },
            ].map(ch => (
              <button key={ch.key} onClick={() => setNewForm({ ...newForm, channel: ch.key })}
                className={`p-3 rounded-xl border text-center transition-all ${newForm.channel === ch.key ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}>
                <span className="text-xl">{ch.icon}</span>
                <p className="text-xs font-semibold text-gray-900 mt-1">{ch.label}</p>
                <p className="text-[10px] text-blue-600 font-medium">{ch.price}</p>
                <p className="text-[10px] text-gray-400">{ch.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 담당의 */}
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block"><PT k="담당의 선택" /></label>
          {doctorsIsError ? (
            <QueryErrorFallback error={doctorsError} onRetry={() => refetchDoctors()} size="compact" />
          ) : doctors.length === 0 ? (
            <p className="text-xs text-gray-400"><PT k="최근 진료 이력이 있는 의사가 없습니다." /></p>
          ) : (
            <div className="space-y-1.5">
              {doctors.map((d: PortalItem) => (
                <button key={String(d.id)} onClick={() => setNewForm({ ...newForm, doctorId: String(d.id) })}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${newForm.doctorId === String(d.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500">
                    {String(d.familyName ?? '').charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{String(d.familyName ?? '')}{String(d.givenName ?? '')} 교수</p>
                    <p className="text-[10px] text-gray-500">{String(d.department ?? '')} · 최근 진료 {d.lastVisit ? fmtShort(String(d.lastVisit)) : ''}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 제목 + 내용 */}
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="상담 제목" /></label>
          <input value={newForm.subject} onChange={e => setNewForm({ ...newForm, subject: e.target.value })}
            placeholder={tAttr('예: 두통 증상 상담')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="증상/상담 내용" /></label>
          <textarea value={newForm.chiefComplaint} onChange={e => setNewForm({ ...newForm, chiefComplaint: e.target.value })}
            placeholder={tAttr('증상이나 궁금한 점을 자세히 적어주세요...')} rows={4}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
        </div>

        {/* 면책 + 수가 안내 */}
        <div className="bg-gray-50 rounded-xl p-3 text-[10px] text-gray-500 space-y-1">
          <p>💰 상담료: 의사 답변 완료 시 자동 청구 · 48시간 미답변 시 자동 환불</p>
          <p>⚖️ 이 서비스는 의료법 제34조에 의한 원격의료 서비스이며, 대면 진료를 대체하지 않습니다.</p>
        </div>

        <button onClick={createConsult} disabled={!newForm.doctorId || !newForm.subject.trim()}
          className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
          <PT k="상담 요청" />
        </button>
      </div>
    );
  }

  // ══════════════ 상담 상세 (채팅) ══════════════
  if (view === 'detail' && detail) {
    const doctor = detail.doctor as Record<string, unknown> | undefined;
    const status = statusLabel[String(detail.status)] ?? statusLabel.REQUESTED;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => { setView('list'); setSelectedId(null); }} className="text-gray-400 hover:text-gray-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg></button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{channelIcon[String(detail.channel)] ?? '💬'} {String(detail.subject ?? '')}</p>
            <p className="text-[10px] text-gray-500">
              {doctor ? `${doctor.familyName}${doctor.givenName} 교수 · ${doctor.department}` : ''} · <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${status.cls}`}>{status.text}</span>
            </p>
          </div>
          {detail.feeAmount != null && Number(detail.feeAmount) > 0 && (
            <span className="text-[10px] text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
              💰 {Number(detail.feeAmount ?? 0).toLocaleString()}원
            </span>
          )}
        </div>

        <EmergencyBanner />

        {/* 채팅 영역 */}
        <div className="bg-gray-50 rounded-xl p-3 max-h-80 overflow-y-auto space-y-2.5">
          {detailMessages.map((m: PortalItem, i: number) => (
            <div key={String(m.id ?? i)} className={`flex ${m.sender === 'PATIENT' ? 'justify-end' : 'justify-start'}`}>
              {m.sender === 'DOCTOR' && (
                <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center mr-1.5 mt-0.5 shrink-0">
                  <Icon d={ICONS.stethoscope} cls="w-3 h-3 text-blue-600" />
                </div>
              )}
              {m.sender === 'SYSTEM' ? (
                <div className="text-center w-full py-1"><span className="text-[10px] text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{String(m.content ?? '')}</span></div>
              ) : (
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                  m.sender === 'PATIENT' ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm'
                }`}>
                  <p className="whitespace-pre-wrap leading-relaxed">{String(m.content ?? '')}</p>
                  {m.isMedicalAdvice === true && <p className="text-[8px] mt-1 opacity-60"><PT k="의료 상담 내용" /></p>}
                  <p className={`text-[9px] mt-1 ${m.sender === 'PATIENT' ? 'text-blue-200' : 'text-gray-400'}`}>
                    {m.createdAt ? fmtShort(String(m.createdAt)) : ''}
                    {m.isRead ? ' ✓✓' : m.sender === 'PATIENT' ? ' ✓' : ''}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 화상 전환 컨트롤 (진행 중일 때) */}
        {detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED' && (
          <div>
            {detail.videoRoomId ? (
              <button onClick={() => setView('video')}
                className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1.5">
                <PT k="📹 화상 진료실 입장" />
              </button>
            ) : detail.videoRequestedBy === 'DOCTOR' ? (
              <button onClick={acceptVideo} disabled={busy}
                className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                <PT k="📹 의사의 화상 전환 제안 수락" />
              </button>
            ) : detail.videoRequestedBy === 'PATIENT' ? (
              <p className="text-[11px] text-center text-amber-600 bg-amber-50 rounded-xl py-2"><PT k="📹 화상 전환을 요청했습니다 · 의사 수락 대기 중" /></p>
            ) : String(detail.channel) !== 'VIDEO' ? (
              <button onClick={requestVideo} disabled={busy}
                className="w-full py-2.5 border border-emerald-300 text-emerald-700 text-sm font-medium rounded-xl hover:bg-emerald-50 disabled:opacity-50 transition-colors">
                <PT k="📹 화상 진료로 전환 요청" />
              </button>
            ) : null}
          </div>
        )}

        {/* 입력 (진행 중일 때만) */}
        {detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED' && (
          <div className="flex gap-2">
            <input value={msgInput} onChange={e => setMsgInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && sendMessage()}
              placeholder={tAttr('메시지를 입력하세요...')} disabled={sending}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50" />
            <button onClick={sendMessage} disabled={sending || !msgInput.trim()}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <PT k="전송" />
            </button>
          </div>
        )}

        {/* 결제 (종료 + 청구확정 + 유료) */}
        {detail.status === 'COMPLETED' && detail.billingStatus === 'CONFIRMED' && !detail.isFreeConsult && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-blue-900"><PT k="💳 상담료 결제" /></p>
              <p className="text-sm font-bold text-blue-700">{Number(detail.feeAmount ?? 0).toLocaleString()}<Unit>원</Unit></p>
            </div>
            {/* 🔴 (2026-10-14 수납·청구 결함 발굴 P3-1) 카드·카카오페이 결제를 승인받을 연동이 없다 — 종전엔 버튼을 누르면
                승인 없이 '결제 완료'가 됐다. 서버가 거부하므로 늘 실패할 버튼을 두지 않고, 할 수 있는 것(후불 정산)만 둔다. */}
            <p className="text-[11px] text-blue-800" data-online-payment-unavailable>
              <PT k="온라인 결제(카드·카카오페이)는 아직 연결되지 않았습니다 — 후불 정산을 고르시면 다음 방문 때 창구에서 수납합니다." />
            </p>
            {detail.paymentMethod === 'DEFERRED' ? (
              <p className="text-[11px] text-blue-700 font-medium"><PT k="후불 정산으로 기록되었습니다 — 다음 방문 때 창구에서 수납합니다." /></p>
            ) : (
              <button onClick={() => payConsult('DEFERRED')} disabled={busy}
                className="w-full py-2 bg-white border border-blue-300 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors">
                <PT k="후불 정산" />
              </button>
            )}
          </div>
        )}
        {detail.status === 'COMPLETED' && detail.billingStatus === 'PAID' && (
          <p className="text-[11px] text-center text-emerald-600 bg-emerald-50 rounded-xl py-2">✅ 결제가 완료되었습니다 ({Number(detail.feeAmount ?? 0).toLocaleString()}<Unit>원</Unit>)</p>
        )}

        {/* 만족도 평가 (종료 + 미평가) */}
        {detail.status === 'COMPLETED' && detail.patientRating == null && (
          <RemoteRatingCard busy={busy} onSubmit={submitRating} />
        )}
        {detail.status === 'COMPLETED' && detail.patientRating != null && (
          <p className="text-[11px] text-center text-gray-400">평가해주셔서 감사합니다 · {'★'.repeat(Number(detail.patientRating))}{'☆'.repeat(5 - Number(detail.patientRating))}</p>
        )}

        {/* 취소 (답변 전) */}
        {(detail.status === 'REQUESTED' || detail.status === 'ACCEPTED') && !detail.doctorRepliedAt && (
          <button onClick={async () => { if (!confirm('상담을 취소하시겠습니까? (결제한 금액이 있으면 전액 환불)')) return; setBusy(true); try { await apiClient.post(`/api/v1/portal/remote-consult/${selectedId}/cancel`, {}); setView('list'); refreshList(); } catch { alert('취소에 실패했습니다.'); } setBusy(false); }}
            disabled={busy} className="w-full py-2 text-xs text-red-500 hover:text-red-600 disabled:opacity-50">
            <PT k="상담 취소 (답변 전 · 결제한 금액은 전액 환불)" />
          </button>
        )}

        <p className="text-[10px] text-gray-400 text-center">⚖️ 의료법 제34조 원격의료 · 진료 내용은 의무기록으로 보존됩니다</p>
      </div>
    );
  }

  // ══════════════ 상담 목록 ══════════════
  // 🔴 목록 조회 실패를 "상담 없음"으로 말하지 않는다
  if (listIsError) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900"><PT k="비대면 진료" /></h3>
        <EmergencyBanner />
        <QueryErrorFallback error={listError} onRetry={() => refetchList()} />
      </div>
    );
  }

  const active = consultations.filter((c: PortalItem) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED');
  const completed = consultations.filter((c: PortalItem) => c.status === 'COMPLETED' || c.status === 'CANCELLED');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-gray-900"><PT k="비대면 진료" /></h3>
        <button onClick={startNewConsult} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-xl hover:bg-blue-700 transition-colors"><PT k="+ 새 상담 요청" /></button>
      </div>

      <EmergencyBanner />

      {/* 🔴 첫 이용 동의 상태를 확인하지 못했다 — "미동의"로 접으면 이미 동의한 환자를 다시 받게 된다 */}
      {consentIsError && <QueryErrorFallback error={consentError} onRetry={() => refetchConsent()} size="compact" />}

      {/* 진행 중 */}
      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500"><PT k="진행 중" /></p>
          {active.map((c: PortalItem) => {
            const doctor = c.doctor as Record<string, unknown> | undefined;
            const lastMsg = ((c.messages ?? []) as PortalItem[])[0];
            const status = statusLabel[String(c.status)] ?? statusLabel.REQUESTED;
            return (
              <button key={String(c.id)} onClick={() => { setSelectedId(String(c.id)); setView('detail'); }}
                className="w-full bg-white rounded-xl border border-gray-200 p-3 text-left hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{channelIcon[String(c.channel)] ?? '💬'}</span>
                    <p className="text-sm font-semibold text-gray-900 truncate">{String(c.subject ?? '')}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${status.cls}`}>{status.text}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {doctor ? `${doctor.familyName}${doctor.givenName}` : ''} · {c.createdAt ? fmtShort(String(c.createdAt)) : ''}
                </p>
                {lastMsg && <p className="text-[10px] text-gray-400 truncate mt-0.5">{String(lastMsg.content ?? '').substring(0, 50)}</p>}
                {c.feeAmount != null && Number(c.feeAmount) > 0 && (
                  <p className="text-[10px] text-blue-600 mt-1">💰 {Number(c.feeAmount ?? 0).toLocaleString()}<Unit>원</Unit> · {c.billingStatus === 'PAID' ? '결제 완료' : c.billingStatus === 'WAIVED' ? '무료' : '답변 시 결제'}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 완료 */}
      {completed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500"><PT k="완료된 진료" /></p>
          {completed.slice(0, 5).map((c: PortalItem) => {
            const doctor = c.doctor as Record<string, unknown> | undefined;
            return (
              <button key={String(c.id)} onClick={() => { setSelectedId(String(c.id)); setView('detail'); }}
                className="w-full bg-white/70 rounded-xl border border-gray-100 p-3 text-left hover:bg-white transition-all">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-700 truncate">{channelIcon[String(c.channel)] ?? ''} {String(c.subject ?? '')}</p>
                  <p className="text-[10px] text-gray-400">{c.completedAt ? fmtShort(String(c.completedAt)) : ''}</p>
                </div>
                <p className="text-[10px] text-gray-400">{doctor ? `${doctor.familyName}${doctor.givenName}` : ''} · {c.feeAmount != null && Number(c.feeAmount) > 0 ? `${Number(c.feeAmount).toLocaleString()}원 ✅` : '무료'}</p>
              </button>
            );
          })}
        </div>
      )}

      {active.length === 0 && completed.length === 0 && (
        <EmptyState icon="🩺" title="비대면 진료 내역이 없습니다" description="담당 의료진에게 텍스트 상담, 화상 진료, 검사결과 설명을 받을 수 있습니다"
          actionLabel="새 상담 요청" onAction={startNewConsult} />
      )}

      <p className="text-[10px] text-gray-400 text-center">⚖️ 비대면 진료는 의료법 제34조에 의한 원격의료 서비스입니다</p>
    </div>
  );
}

/* ── 비대면 진료 첫 이용 동의 (4단계: 안내→수가→동의→결제수단) ── */
function RemoteConsentOnboarding({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const tAttr = usePortalTAttr();
  const [step, setStep] = useState(1);
  const [agree, setAgree] = useState({ remoteService: false, feeAgreement: false, healthInfoConsent: false, recordRetention: false, videoRecording: false });
  const [signature, setSignature] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('DEFERRED'); // P3-1: 온라인 결제 연동이 없어 고를 수 있는 것은 후불뿐
  const [submitting, setSubmitting] = useState(false);
  const requiredOk = agree.remoteService && agree.feeAgreement && agree.healthInfoConsent && agree.recordRetention;

  const submit = async () => {
    if (!requiredOk || !signature.trim() || submitting) return;
    setSubmitting(true);
    try {
      await apiClient.post('/api/v1/portal/remote-consult/consent', { ...agree, signatureData: signature.trim(), paymentMethod });
      onDone();
    } catch { alert('동의 처리에 실패했습니다.'); setSubmitting(false); }
  };

  const FEES = [
    ['텍스트 상담', '20,000원 / 건'], ['검사결과 해석', '30,000원 / 건'],
    ['화상 진료 (15분)', '40,000원 / 회'], ['화상 진료 (30분)', '60,000원 / 회'], ['퇴원 후 추적 상담', '무료 (1회)'],
  ];
  const CONSENTS: { key: keyof typeof agree; label: string; law: string; required: boolean }[] = [
    { key: 'remoteService', label: '원격의료 서비스 이용 동의', law: '의료법 제34조, 비대면 진료 시범사업 지침', required: true },
    { key: 'feeAgreement', label: '비대면 진료 비급여 수가 동의', law: '국민건강보험법', required: true },
    { key: 'healthInfoConsent', label: '건강(민감)정보 처리 동의', law: '개인정보보호법 제23조', required: true },
    { key: 'recordRetention', label: '진료 내용 의무기록 보존 동의', law: '의료법 제22조 (10년 보존)', required: true },
    { key: 'videoRecording', label: '화상 진료 녹화 동의 (선택)', law: '녹화본은 진료 보조 자료로 보관', required: false },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><span className="sr-only"><PT k="취소" /></span><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg></button>
        <h3 className="text-sm font-bold text-gray-900"><PT k="비대면 진료 첫 이용 동의" /></h3>
      </div>
      {/* 진행 표시 */}
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map(s => <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-blue-500' : 'bg-gray-200'}`} />)}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <div className="text-center py-2"><span className="text-3xl">🏥</span><p className="text-sm font-bold text-gray-900 mt-1"><PT k="비대면 진료 서비스" /></p></div>
          <p className="text-xs text-gray-600 leading-relaxed">담당 의료진과 텍스트 상담, 화상 진료, 검사결과 설명을 받을 수 있는 원격의료 서비스입니다.</p>
          <ul className="text-xs text-gray-700 space-y-1.5 bg-gray-50 rounded-xl p-3">
            <li>💬 <strong>텍스트 상담</strong>: 사진 첨부 + 의사 답변 (24h 내)</li>
            <li>📹 <strong>화상 진료</strong>: 실시간 영상통화 (예약제)</li>
            <li>🔬 <strong>결과 설명</strong>: 검사/영상 결과 의사 직접 설명</li>
          </ul>
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[11px] text-red-700">
            ⚠️ 응급 상황은 <a href={telHref(HOSPITAL_CONTACT.emergency119)} className="font-bold underline">119</a> 또는 응급실(
            <a href={telHref(HOSPITAL_CONTACT.emergency)} className="font-bold underline">{HOSPITAL_CONTACT.emergency}</a>)로 즉시 연락하세요.
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-gray-900"><PT k="이용 요금 (비급여)" /></p>
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
            {FEES.map(([k, v]) => <div key={k} className="flex justify-between px-3 py-2.5 text-xs"><span className="text-gray-600">{k}</span><span className="font-semibold text-gray-900">{v}</span></div>)}
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-[11px] text-gray-500 space-y-1">
            <p>· 의사 미답변 시 48시간 내 자동 환불</p>
            <p>· 결제: 후불 정산(다음 방문 시 창구 수납) — 온라인 결제(카드·카카오페이)는 아직 연결되지 않았습니다</p>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-gray-900"><PT k="동의서" /></p>
          <div className="space-y-2">
            {CONSENTS.map(c => (
              <button key={c.key} onClick={() => setAgree(a => ({ ...a, [c.key]: !a[c.key] }))}
                className={`w-full flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all ${agree[c.key] ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                <span className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center text-[10px] shrink-0 ${agree[c.key] ? 'bg-blue-600 text-white' : 'border border-gray-300'}`}>{agree[c.key] ? '✓' : ''}</span>
                <span>
                  <span className="text-xs font-medium text-gray-900">{c.label} {c.required && <span className="text-red-500">*</span>}</span>
                  <span className="block text-[10px] text-gray-400">{c.law}</span>
                </span>
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block"><PT k="전자 서명 (본인 성명)" /></label>
            <input value={signature} onChange={e => setSignature(e.target.value)} placeholder={tAttr('성명을 입력하여 서명합니다')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-gray-900"><PT k="결제수단 선택" /></p>
          <div className="space-y-2">
            {/* 🔴 (P3-1) 온라인 결제 연동이 없다 — 고를 수 있는 것만 둔다 */}
            {[{ k: 'DEFERRED', label: '후불 정산 (다음 방문 시 수납)' }].map(p => (
              <button key={p.k} onClick={() => setPaymentMethod(p.k)}
                className={`w-full flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${paymentMethod === p.k ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${paymentMethod === p.k ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`} />
                <span className="text-sm text-gray-900">{p.label}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400">온라인 결제(카드·카카오페이)는 아직 연결되지 않아 후불 정산만 고를 수 있습니다. 상담료는 상담 종료 뒤 청구됩니다.</p>
        </div>
      )}

      {/* 네비게이션 */}
      <div className="flex gap-2 pt-1">
        {step > 1 && <button onClick={() => setStep(step - 1)} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl"><PT k="이전" /></button>}
        {step < 4 && <button onClick={() => setStep(step + 1)} disabled={step === 3 && (!requiredOk || !signature.trim())}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50"><PT k="다음" /></button>}
        {step === 4 && <button onClick={submit} disabled={!requiredOk || !signature.trim() || submitting}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50">{submitting ? '처리 중...' : '동의하고 시작하기'}</button>}
      </div>
    </div>
  );
}

/* ── 화상 진료 대기실 + 진료실 (장비 테스트 → Jitsi) ── */
function RemoteVideoRoom({ consultId, doctorName, scheduledAt, onBack }: { consultId: string; doctorName: string; scheduledAt?: string; onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [device, setDevice] = useState({ cam: false, mic: false });
  const [recordConsent, setRecordConsent] = useState(false);
  const [entered, setEntered] = useState(false);
  const [jitsiUrl, setJitsiUrl] = useState<string | null>(null);
  const online = useBrowserOnline();
  const [error, setError] = useState<string | null>(null);

  // 장비 테스트 (카메라/마이크 미리보기)
  useEffect(() => {
    if (entered) return;
    let active = true;
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setDevice({ cam: stream.getVideoTracks().length > 0, mic: stream.getAudioTracks().length > 0 });
      })
      .catch(() => setError('카메라/마이크 접근 권한이 필요합니다. 브라우저 설정을 확인해주세요.'));
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [entered]);

  const enterRoom = async () => {
    try {
      streamRef.current?.getTracks().forEach(t => t.stop()); // Jitsi가 장비 재요청
      const res = await apiClient.get<{ data: { token: string; roomId: string } }>(`/api/v1/portal/remote-consult/${consultId}/video/token`);
      const d = (res?.data as { data?: { token?: string; roomId?: string } })?.data ?? (res?.data as { token?: string; roomId?: string });
      const token = d?.token; const roomId = d?.roomId;
      if (!token || !roomId) { setError('화상 세션 정보를 가져오지 못했습니다.'); return; }
      const baseEnv = process.env.NEXT_PUBLIC_JITSI_URL || '/meet';
      const base = baseEnv.startsWith('http') ? baseEnv : `${window.location.origin}${baseEnv}`;
      setJitsiUrl(`${base}/${roomId}?jwt=${token}#config.prejoinPageEnabled=false`);
      setEntered(true);
    } catch { setError('진료실 입장에 실패했습니다.'); }
  };

  if (entered && jitsiUrl) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-gray-900">📹 {doctorName}와 화상 진료 중</p>
          <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700"><PT k="나가기" /></button>
        </div>
        <VideoLinkStatus view={deriveVideoLinkView({ online, window: 'EMBEDDED' })} text={(k) => <PT k={k} />} dark={false} />
        <iframe src={jitsiUrl} allow="camera; microphone; fullscreen; display-capture; autoplay"
          className="w-full rounded-xl border border-gray-200" style={{ height: '70vh' }} title="화상 진료" />
        <p className="text-[10px] text-gray-400 text-center">⚖️ 의료법 제34조 원격의료 · 진료 내용은 의무기록으로 보존됩니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600"><span className="sr-only"><PT k="뒤로" /></span><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg></button>
        <h3 className="text-sm font-bold text-gray-900"><PT k="화상 진료 대기실" /></h3>
      </div>
      <div className="text-center">
        <p className="text-sm text-gray-700">{doctorName}</p>
        {scheduledAt && <p className="text-[11px] text-gray-400">예약: {portalDateText(scheduledAt, 'monthDayTime')}</p>}
      </div>

      {/* 카메라 미리보기 */}
      <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video flex items-center justify-center">
        {error ? <p className="text-xs text-gray-300 px-4 text-center">{error}</p>
          : <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />}
        <span className="absolute bottom-2 left-2 text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded"><PT k="내 모습" /></span>
      </div>

      {/* 장비 상태 */}
      <div className="flex justify-center gap-4 text-xs">
        <span className={device.cam ? 'text-emerald-600' : 'text-gray-400'}>{device.cam ? '✅' : '⚪'} 카메라</span>
        <span className={device.mic ? 'text-emerald-600' : 'text-gray-400'}>{device.mic ? '✅' : '⚪'} 마이크</span>
        <span className="text-emerald-600"><PT k="✅ 네트워크" /></span>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-gray-600">
        <input type="checkbox" checked={recordConsent} onChange={e => setRecordConsent(e.target.checked)} className="rounded" />
        <PT k="화상 진료 녹화에 동의합니다 (선택)" />
      </label>

      <button onClick={enterRoom} disabled={!device.cam && !device.mic}
        className="w-full py-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors">
        <PT k="진료실 입장" />
      </button>
      <p className="text-[10px] text-amber-600 text-center">⚠️ 진료 시작 5분 전부터 입장 가능 · 10분 이상 미접속 시 자동 취소될 수 있습니다</p>
    </div>
  );
}

/* ── 만족도 평가 (CallEndedPage 패턴) ── */
function RemoteRatingCard({ busy, onSubmit }: { busy: boolean; onSubmit: (rating: number, feedback: string) => void }) {
  const tAttr = usePortalTAttr();
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
      <p className="text-xs font-bold text-gray-900 text-center"><PT k="진료는 어떠셨나요?" /></p>
      <div className="flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map(s => (
          <button key={s} onClick={() => setRating(s)} className="text-2xl leading-none">{s <= rating ? '★' : '☆'}</button>
        ))}
      </div>
      <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={2} placeholder={tAttr('개선이 필요한 점이 있으면 알려주세요 (선택)')}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-blue-200" />
      <button onClick={() => rating > 0 && onSubmit(rating, feedback)} disabled={rating === 0 || busy}
        className="w-full py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50"><PT k="평가 등록" /></button>
    </div>
  );
}
