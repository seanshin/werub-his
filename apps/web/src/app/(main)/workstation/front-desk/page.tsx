'use client';

import { useMemo, useState } from 'react';
import { Duration, Unit } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { MutationError, parsePatientQr } from '@hospital-run/shared';
import { ConsentDispatchModal, ConsentPatient } from './ConsentDispatchModal';
import { QrScanModal } from './QrScanModal';
import { QrImage } from '@/components/ui/QrImage';
import { useHotkeys, comboLabel, ariaKeyshortcuts } from '@/components/hotkeys/HotkeyProvider';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kdate, pollMs } from '@/lib/ui-settings';
import { useQueueThresholds, waitTone, WAIT_TONE_TEXT } from '@/lib/queue-thresholds';

interface QueueItem {
  id: string; queueNumber: number; status: string; departmentName: string; roomName?: string;
  visitType: string; type: string; checkedInAt: string;
  patient?: { familyName: string; givenName: string; mrn: string };
  doctor?: { familyName: string; givenName: string };
}
interface QueueStats { avgWaitMinutes?: Record<string, number> }
interface SelPatient { id: string; familyName: string; givenName: string; mrn: string }

// 진료과 목록 정본 = 마스터(useDepartments) — 로컬 배열 재정의 금지(input-assist-ux P1)

const COLUMNS = [
  { key: 'WAITING', label: '대기', accent: 'amber', statuses: ['WAITING'] },
  { key: 'CALLED', label: '호출', accent: 'blue', statuses: ['CALLED'] },
  { key: 'IN_CONSULTATION', label: '진료중', accent: 'emerald', statuses: ['IN_CONSULTATION'] },
] as const;
const ACCENT: Record<string, { head: string; dot: string; card: string }> = {
  amber: { head: 'text-amber-700', dot: 'bg-amber-500', card: 'border-amber-100' },
  blue: { head: 'text-blue-700', dot: 'bg-blue-500', card: 'border-blue-100' },
  emerald: { head: 'text-emerald-700', dot: 'bg-emerald-500', card: 'border-emerald-100' },
};

export default function FrontDeskWorkstation() {
  const qThresholds = useQueueThresholds(); // 임계 정본 = config clinical.queue.*(§7 P2)
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['fd-queue'],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>('/api/v1/queue', {}),
    refetchInterval: 8000,
  });
  const { data: statsData } = useQuery({
    queryKey: ['fd-queue-stats'],
    queryFn: () => apiClient.get<{ data: QueueStats }>('/api/v1/queue/stats'),
    refetchInterval: pollMs('fast'),
  });

  const raw = data?.data;
  const queues: QueueItem[] = Array.isArray(raw) ? raw : (raw as unknown as Record<string, unknown>)?.data as QueueItem[] ?? [];
  const stats = statsData?.data;

  // ── 인라인 빠른 접수 ──
  const [patient, setPatient] = useState<SelPatient | null>(null);
  const [dept, setDept] = useState('');
  const { names: departments, isError: deptListError, refetch: refetchDepts } = useDepartments({ category: 'CLINICAL', include: [dept] });
  const [visitType, setVisitType] = useState<'INITIAL' | 'FOLLOW_UP'>('INITIAL');
  const [reason, setReason] = useState('');
  const [consentFor, setConsentFor] = useState<ConsentPatient | null>(null);
  const [guide, setGuide] = useState<{ id: string; queueNumber?: number; name: string } | null>(null);

  const checkIn = useMutation({
    mutationFn: () => apiClient.post<{ data: { id: string; queueNumber?: number } }>('/api/v1/queue/check-in', {
      patientId: patient!.id, departmentName: dept, visitType, reason: reason || undefined, type: 'WALK_IN',
    }),
    onSuccess: (res) => {
      const p = patient!;
      const wasInitial = visitType === 'INITIAL';
      // 이중 래핑 제거(2026-07) 이후엔 res.data 가 큐 객체. 구 응답 호환을 위해 폴백 유지.
      const q = (res.data as unknown as { data?: { id?: string; queueNumber?: number } })?.data ?? (res.data as unknown as { id?: string; queueNumber?: number });
      toast.success(`${p.familyName}${p.givenName} 접수 완료`);
      setPatient(null); setDept(''); setReason(''); setVisitType('INITIAL');
      qc.invalidateQueries({ queryKey: ['fd-queue'] });
      if (q?.id) setGuide({ id: q.id, queueNumber: q.queueNumber, name: `${p.familyName}${p.givenName}` }); // R7 안내 QR
      if (wasInitial) setConsentFor({ id: p.id, familyName: p.familyName, givenName: p.givenName }); // R5 동의서
    },
    onError: (e: MutationError) => toast.error(e?.message ?? '접수 처리 오류'),
  });
  const guideUrl = guide && typeof window !== 'undefined' ? `${window.location.origin}/guide/${guide.id}` : '';

  // R8: 환자 QR 스캔 → 환자 인지(검색 후 선택)
  const [scanning, setScanning] = useState(false);
  const onScan = async (raw: string) => {
    setScanning(false);
    // 🔴 스캔 원문 해석은 정본 하나로(parsePatientQr) — 팔찌(구 JSON)·포털(구 `HRPT:`)·신규(MRN) 혼재.
    //    종전엔 `HRPT:` 접두만 벗겨서, 팔찌 QR(JSON)을 스캔하면 JSON 문자열로 환자를 검색해 못 찾았다.
    const q = parsePatientQr(raw) ?? raw;
    try {
      const r = await apiClient.get<{ data: SelPatient[] }>('/api/v1/patients', { q, limit: 1 });
      const list = Array.isArray(r.data) ? r.data : (r.data as unknown as { data?: SelPatient[] })?.data ?? [];
      const p = list[0];
      if (p) { setPatient({ id: p.id, familyName: p.familyName, givenName: p.givenName, mrn: p.mrn }); setVisitType('FOLLOW_UP'); toast.success(`${p.familyName}${p.givenName} 인식됨`); }
      else toast.error('해당 QR의 환자를 찾을 수 없습니다.');
    } catch { toast.error('환자 조회 실패'); }
  };

  const counts = useMemo(() => {
    const c = { WAITING: 0, CALLED: 0, IN_CONSULTATION: 0, COMPLETED: 0 };
    for (const q of queues) if (q.status in c) (c as Record<string, number>)[q.status]++;
    return c;
  }, [queues]);
  const longestWait = useMemo(() => {
    const w = queues.filter((q) => q.status === 'WAITING');
    return w.length ? Math.max(...w.map((q) => Math.round((Date.now() - new Date(q.checkedInAt).getTime()) / 60000))) : 0;
  }, [queues]);

  const canCheckIn = patient && dept && !checkIn.isPending;

  // 화면 내 핫키 (Mac 친화)
  useHotkeys([
    { combo: 'mod+Enter', label: '접수', group: '접수 워크스테이션', allowInInput: true, when: () => !!canCheckIn, onTrigger: () => checkIn.mutate() },
    { combo: 'alt+s', label: 'QR 스캔', group: '접수 워크스테이션', onTrigger: () => setScanning(true) },
  ]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="접수 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="실시간 대기 현황" /> · {dataUpdatedAt ? kdate(new Date(dataUpdatedAt), 'timeSec') : ''} <T k="갱신" /></p>
        </div>
        <Link href="/reception?tab=newpatient" className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50"><T k="신규 환자 등록" /></Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4 flex-shrink-0">
        <Stat label="대기" value={counts.WAITING} accent="text-amber-600" />
        <Stat label="호출" value={counts.CALLED} accent="text-blue-600" />
        <Stat label="진료중" value={counts.IN_CONSULTATION} accent="text-emerald-600" />
        <Stat label="완료(오늘)" value={counts.COMPLETED} accent="text-gray-500" />
        {/* 🔴 원시 분 표기(`159분`) 금지 — 60분을 넘으면 사람이 못 읽는다. 정본 <Duration> 경유 */}
        <Stat label="최장 대기" value={<Duration minutes={longestWait} />} accent={WAIT_TONE_TEXT[waitTone(longestWait, qThresholds)!] ?? 'text-gray-700'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-0">
        {/* 인라인 빠른 접수 */}
        <div className="lg:col-span-1 bg-white rounded-2xl border border-blue-100 shadow-sm p-4 flex flex-col min-h-0 overflow-y-auto scrollbar-thin">
          {guide && (
            <div className="mb-3 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-sm font-bold text-gray-900">{guide.name} <T k="접수 완료@상태" /></p>
              {guide.queueNumber != null && <p className="text-2xl font-extrabold text-emerald-700">대기 {guide.queueNumber}번</p>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <QrImage value={guideUrl} size={140} alt={tAttr('환자 안내 QR')} className="mx-auto rounded-xl bg-white p-2 my-2" />
              <p className="text-[11px] text-gray-500"><T k="환자에게 QR을 보여주세요 — 스캔 시 대기·진료실 안내" /></p>
              <button onClick={() => setGuide(null)} className="mt-2 text-xs text-gray-500 underline"><T k="닫기" /></button>
            </div>
          )}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">⚡ <T k="빠른 접수" /></h3>
            <button onClick={() => setScanning(true)} aria-keyshortcuts={ariaKeyshortcuts('alt+s')} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 flex items-center gap-1">📷 <T k="QR 스캔" /> <kbd className="text-[9px] font-semibold bg-white/20 rounded px-1 py-0.5">{comboLabel('alt+s')}</kbd></button>
          </div>
          <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="환자" /></label>
          <PatientSelector
            value={patient?.id ?? ''}
            onChange={(id, p) => setPatient(id && p.familyName ? { id, familyName: p.familyName, givenName: p.givenName, mrn: p.mrn } : null)}
            context="general"
          />
          <label className="text-xs font-medium text-gray-500 mt-3 mb-1 block"><T k="진료과" /></label>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-100">
            <option value="">{tAttr('진료과 선택')}</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {deptListError && <DeptLoadError onRetry={refetchDepts} />}
          <label className="text-xs font-medium text-gray-500 mt-3 mb-1 block"><T k="유형" /></label>
          <div className="flex gap-2">
            {[['INITIAL', '초진'], ['FOLLOW_UP', '재진']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setVisitType(v as 'INITIAL' | 'FOLLOW_UP')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium ${visitType === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k={l} /></button>
            ))}
          </div>
          <label className="text-xs font-medium text-gray-500 mt-3 mb-1 block"><T k="접수 사유 (선택)" /></label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('증상')} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-100" />
          <button onClick={() => checkIn.mutate()} disabled={!canCheckIn} aria-keyshortcuts={ariaKeyshortcuts('mod+Enter')}
            className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {checkIn.isPending ? <T k="접수 중..." /> : visitType === 'INITIAL' ? <T k="접수 + 동의서 전송" /> : <T k="접수@원무" />}
            {!checkIn.isPending && <kbd className="ml-2 text-[10px] font-semibold bg-white/20 rounded px-1.5 py-0.5">{comboLabel('mod+Enter')}</kbd>}
          </button>
          {patient && (
            <button onClick={() => setConsentFor({ id: patient.id, familyName: patient.familyName, givenName: patient.givenName })}
              className="mt-2 w-full py-2.5 rounded-xl border border-violet-200 text-violet-700 text-sm font-medium hover:bg-violet-50">
              <T k="동의서만 태블릿 전송" />
            </button>
          )}
        </div>

        {/* 실시간 보드 */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
          {COLUMNS.map((col) => {
            const items = queues.filter((q) => col.statuses.includes(q.status as never)).sort((a, b) => a.queueNumber - b.queueNumber);
            const a = ACCENT[col.accent];
            return (
              <div key={col.key} className="bg-gray-50 rounded-2xl border border-gray-100 flex flex-col min-h-0">
                <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-100 flex-shrink-0">
                  <span className={`w-2 h-2 rounded-full ${a.dot}`} /><span className={`text-sm font-bold ${a.head}`}><T k={col.label} /></span><span className="text-sm text-gray-400">{items.length}</span>
                </div>
                <div className="p-3 space-y-2 overflow-y-auto flex-1 scrollbar-thin">
                  {items.map((q) => {
                    const wait = Math.round((Date.now() - new Date(q.checkedInAt).getTime()) / 60000);
                    return (
                      <div key={q.id} className={`bg-white rounded-xl border ${a.card} shadow-sm px-3.5 py-2.5`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg font-bold text-gray-900">#{q.queueNumber}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{q.patient?.familyName}{q.patient?.givenName}
                                <span className="ml-1.5 text-[11px] font-normal text-gray-400"><T k={q.visitType === 'INITIAL' ? '초진' : '재진'} />{q.type === 'APPOINTMENT' && <> · <T k="예약" /></>}</span>
                              </p>
                              <p className="text-[11px] text-gray-400 truncate">{q.departmentName}{q.doctor ? ` · ${q.doctor.familyName}${q.doctor.givenName}` : ''}{q.roomName ? ` · ${q.roomName}` : ''}</p>
                            </div>
                          </div>
                          {col.key === 'WAITING' && <span className={`text-xs font-bold whitespace-nowrap ${WAIT_TONE_TEXT[waitTone(wait, qThresholds)!] ?? 'text-gray-400'}`}><Duration minutes={wait} /></span>}
                        </div>
                      </div>
                    );
                  })}
                  {!items.length && <p className="text-xs text-gray-400 text-center py-8"><T k="없음" /></p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {consentFor && <ConsentDispatchModal patient={consentFor} onClose={() => setConsentFor(null)} />}
      {scanning && <QrScanModal onResult={onScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

function Stat({ label, value, suffix, accent }: { label: string; value: number | React.ReactNode; suffix?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className={`text-3xl font-bold ${accent ?? 'text-gray-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        <span className="text-base font-medium ml-0.5">{suffix}</span>
      </div>
      {/* 문자열 prop 렌더는 <T k={prop}> 감쌈(P1-D 규약) — 카탈로그 히트 시 번역·미스 시 원문+티 */}
      <div className="text-xs text-gray-500 mt-1"><T k={label} /></div>
    </div>
  );
}
