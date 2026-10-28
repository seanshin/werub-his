'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import Link from 'next/link';
import PatientSelector from '@/components/ui/PatientSelector';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { EmptyState, Unit, Duration } from '@/components/ui/display';
import { AI_ORIGIN_TEXT, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';

const KTAS: Record<string, { label: string; color: string; desc: string }> = {
  LEVEL_1: { label: 'KTAS 1', color: 'bg-red-600 text-white', desc: '소생 (즉시)' },
  LEVEL_2: { label: 'KTAS 2', color: 'bg-orange-500 text-white', desc: '긴급 (10분)' },
  LEVEL_3: { label: 'KTAS 3', color: 'bg-amber-400 text-gray-900', desc: '응급 (30분)' },
  LEVEL_4: { label: 'KTAS 4', color: 'bg-green-500 text-white', desc: '준응급 (60분)' },
  LEVEL_5: { label: 'KTAS 5', color: 'bg-blue-500 text-white', desc: '비응급 (120분)' },
};

/**
 * 🔴 미분류를 KTAS 3(응급·30분)으로 단정하지 않는다.
 *    종전에는 표시 폴백(`?? KTAS.LEVEL_3`)과 입력 기본값(`useState('LEVEL_3')`) 두 곳에서
 *    **분류하지 않은 환자가 KTAS 3 으로 굳었다.** 실제로 KTAS 1~2 였다면 대응 시간이 늦고,
 *    4~5 였다면 자원이 낭비된다 — 어느 쪽이든 화면이 모르는 것을 안다고 말한 것이다.
 */
const KTAS_UNCLASSIFIED = { label: '미분류', color: 'bg-gray-200 text-gray-700', desc: '중증도 미분류 — 분류 필요' };

// EmergencyDisposition enum(정명)과 일치 — 구 어휘(ADMITTED/DISCHARGED)는 Prisma enum 쓰기 실패·필터 미매칭 원인
// 값은 표시 문자열이 아니라 **t() 키**다(유일 소비처가 `<T k=…>`)
const DISPOSITION_LABEL: Record<string, string> = {
  ADMISSION: '입원', DISCHARGE: '퇴원', TRANSFER: '전원', DEATH: '사망@처분',
  LEAVE_AMA: '자의퇴원', OBSERVATION: '관찰', SURGERY: '수술',
};

export default function EmergencyWorkstationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'triage' | 'queue' | 'completed'>('triage');
  const [showForm, setShowForm] = useState(false);
  // 응급→입원: 병상·주치의 선택 모달(admissions/create가 bedId/admittingDoctorId/admitDate 필수)
  const [admitFor, setAdmitFor] = useState<{ visitId: string; patientId: string; reason: string } | null>(null);

  // 응급실 대기열
  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['emergency-queue'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/emergency/queue'),
    refetchInterval: pollMs('fast'),
  });
  const rawQueue = queueRes?.data;
  const queue: Record<string, unknown>[] = (Array.isArray(rawQueue) ? rawQueue : (rawQueue as { data?: unknown[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const DONE_DISPOSITIONS = ['DISCHARGE', 'ADMISSION', 'TRANSFER', 'DEATH', 'LEAVE_AMA', 'SURGERY'];
  const waiting = queue.filter(v => !DONE_DISPOSITIONS.includes(String(v.disposition ?? '')));
  const completed = queue.filter(v => DONE_DISPOSITIONS.includes(String(v.disposition ?? '')));

  const safeFmt = (d: unknown) => {
    if (!d) return '-';
    try { const dt = new Date(String(d)); return isNaN(dt.getTime()) ? '-' : kdate(dt, 'datetimeShort'); } catch { return '-'; }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🚨 <T k="응급실" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">대기 {waiting.length}<Unit>건</Unit> · 처분 {completed.length}<Unit>건</Unit></p>
        </div>
        <div className="flex items-center gap-2">
          {/* 응급 코드 프로토콜 */}
          {[
            { code: 'CODE_BLUE', label: '코드블루', color: 'bg-blue-600 hover:bg-blue-700 shadow-blue-200', desc: '심폐소생술 팀 호출' },
            { code: 'CODE_RED', label: '코드레드', color: 'bg-red-700 hover:bg-red-800 shadow-red-200', desc: '화재 발생' },
            { code: 'CODE_WHITE', label: '코드화이트', color: 'bg-gray-700 hover:bg-gray-800 shadow-gray-200', desc: '폭력/위협 상황' },
          ].map(c => (
            <button key={c.code} onClick={async () => {
              if (!confirm(`${c.label} 발동: ${c.desc}\n전체 알림이 발송됩니다. 계속하시겠습니까?`)) return;
              try {
                await apiClient.post('/api/v1/emergency/code-alert', { code: c.code, location: '응급실' });
                toast.success(`${c.label} 발동 — 팀 알림 발송됨`);
              } catch { toast.error(`${c.label} 발동 실패`); }
            }}
              className={`min-h-[44px] px-3 py-2 text-white text-xs font-bold rounded-lg shadow-lg ${c.color}`}>
              <T k={c.label} />
            </button>
          ))}
          <a href="/display/er-flow" target="_blank" rel="noreferrer"
            title="대기실 TV 용 환자 흐름 보드(공개·마스킹) — 새 탭에서 열어 TV 브라우저에 띄우세요"
            className="px-3 py-2 bg-gray-800 text-white text-xs font-bold rounded-xl hover:bg-gray-700">
            📺 TV 보드 ↗
          </a>
          <button onClick={() => { setShowForm(true); setTab('triage'); }}
            className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 flex items-center gap-2 shadow-lg shadow-red-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            <T k="응급 접수" />
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-gray-100 pb-1">
        {/* 🔴 라벨과 건수를 분리한다 — 보간 문자열은 t() 키가 될 수 없다(ko 렌더 문자는 동일) */}
        {[
          { key: 'triage' as const, label: '접수/트리아지', count: null as number | null },
          { key: 'queue' as const, label: '대기열', count: waiting.length },
          { key: 'completed' as const, label: '처분 완료', count: completed.length },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t ${tab === t.key ? 'bg-gray-100 text-gray-800 border-b-2 border-gray-800' : 'text-gray-400'}`}>
            <T k={t.label} />{t.count != null ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {/* 접수/트리아지 폼 */}
      {tab === 'triage' && (
        showForm ? (
          <TriageForm onClose={() => setShowForm(false)} onSuccess={() => { setShowForm(false); setTab('queue'); qc.invalidateQueries({ queryKey: ['emergency-queue'] }); }} />
        ) : (
          <div className="py-16 text-center">
            <div className="text-5xl mb-4">🏥</div>
            <p className="text-gray-500 mb-4"><T k="응급 환자 접수를 시작하세요" /></p>
            <button onClick={() => setShowForm(true)} className="px-6 py-3 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700">
              + <T k="응급 접수 시작" />
            </button>
          </div>
        )
      )}

      {/* 대기열 */}
      {tab === 'queue' && (
        isLoading ? <div className="py-16 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div> :
        isError ? <QueryErrorFallback error={error} onRetry={refetch} /> :
        waiting.length === 0 ? <EmptyState icon="🚑" title="대기 중인 환자가 없습니다" /> :
        <div className="space-y-2">
          {waiting.map((v) => {
            const kt = KTAS[String(v.triageLevel)] ?? KTAS_UNCLASSIFIED;
            // 🔴 서버 계약과 어긋나 **환자 이름이 통째로 사라져 있었다** — 서버는 `patientName`
            //    (문자열 하나)·`mrn`·`arrivalAt` 을 주는데 화면은 `patient.familyName`·`createdAt` 을
            //    읽었고, `?? ''` 폴백이라 조용히 빈 칸이 됐다. KTAS 1 환자가 누구인지 알 수 없었다.
            return (
              <div key={String(v.id)} className="bg-white border rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50/30 transition">
                <Link href={`/emergency?visit=${v.id}`} className="block">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${kt.color}`}>{kt.label}</span>
                      <div>
                        <span className="font-bold text-gray-900">{v.patientName != null ? String(v.patientName) : <T k="(신원 미상)" />}</span>
                        <span className="ml-2 text-xs text-gray-400">{String(v.mrn ?? '')}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400">
                      <T k="대기" /> <Duration minutes={typeof v.waitingMinutes === 'number' ? v.waitingMinutes : null} /> · {safeFmt(v.arrivalAt)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 truncate">{String(v.chiefComplaint ?? '-')}</p>
                </Link>
                {/* 응급→입원 전환 버튼 */}
                <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100">
                  <button onClick={(e) => {
                    e.preventDefault();
                    setAdmitFor({ visitId: String(v.id), patientId: String(v.patientId), reason: String(v.chiefComplaint ?? '응급 입원') });
                  }} className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg text-[10px] font-semibold hover:bg-blue-200"><T k="입원 전환" /></button>
                  <button onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await apiClient.post(`/api/v1/emergency/visits/${v.id}/disposition`, { disposition: 'DISCHARGE' });
                      toast.success('퇴원 처리 완료');
                      refetch();
                    // 서버가 이유를 말하면 그대로 보여준다 — "실패" 한 줄은 다음 행동을 못 정하게 한다.
                    } catch (err) { toast.error((err as { message?: string })?.message || '퇴원 처리 실패'); }
                  }} className="min-h-[44px] px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200"><T k="퇴원" /></button>
                  <button onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await apiClient.post(`/api/v1/emergency/visits/${v.id}/disposition`, { disposition: 'TRANSFER' });
                      toast.success('전원 처리 완료');
                      refetch();
                    } catch (err) { toast.error((err as { message?: string })?.message || '전원 처리 실패'); }
                  }} className="min-h-[44px] px-3 py-2 bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-200"><T k="전원" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 처분 완료 */}
      {tab === 'completed' && (
        completed.length === 0 ? <EmptyState icon="✅" title="처분 완료 기록이 없습니다" /> :
        <div className="space-y-2">
          {completed.map((v) => {
            return (
              <div key={String(v.id)} className="bg-gray-50 border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-700">{v.patientName != null ? String(v.patientName) : <T k="(신원 미상)" />}</span>
                    <span className="ml-2 text-xs text-gray-400">{String(v.mrn ?? '')}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600">
                    <T k={DISPOSITION_LABEL[String(v.disposition)] ?? String(v.disposition ?? '완료')} />
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{String(v.chiefComplaint ?? '-')}</p>
              </div>
            );
          })}
        </div>
      )}
      {admitFor && <ErAdmitModal target={admitFor} onClose={() => setAdmitFor(null)} onDone={() => { setAdmitFor(null); refetch(); }} />}
    </div>
  );
}

/** 응급→입원: 병상·주치의 선택 후 입원 생성(disposition ADMITTED + admissions/create) */
function ErAdmitModal({ target, onClose, onDone }: { target: { visitId: string; patientId: string; reason: string }; onClose: () => void; onDone: () => void }) {
  const { user } = useAuthStore();
  const [bedId, setBedId] = useState('');
  const [busy, setBusy] = useState(false);
  interface BedItem { id: string; roomNumber?: string; bedNumber?: string; ward?: { name?: string } }
  const { data: bedsRes, isError: bedsIsError, error: bedsError, refetch: refetchBeds } = useQuery({
    queryKey: ['available-beds'],
    queryFn: () => apiClient.get<{ data: BedItem[] }>('/api/v1/beds/available'),
  });
  const _bRaw = bedsRes?.data;
  const beds: BedItem[] = Array.isArray(_bRaw) ? _bRaw : (_bRaw as unknown as { data?: BedItem[] })?.data ?? [];

  const submit = async () => {
    if (!bedId) { toast.error('병상을 선택하세요.'); return; }
    setBusy(true);
    try {
      // 정식 경로: transferToAdmission — 병상 선점(lock)·주치의/병상이력·여정·ER 청구·visit.admissionId 연결·disposition ADMISSION을 일괄 처리
      await apiClient.post(`/api/v1/emergency/visits/${target.visitId}/admit`, { bedId, admittingDoctorId: user?.id });
      toast.success('입원 전환 완료');
      onDone();
    } catch (e) {
      toast.error((e as { message?: string })?.message || '입원 전환 실패');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1"><T k="응급 → 입원 전환" /></h3>
        <p className="text-xs text-gray-400 mb-4"><T k="병상을 배정하면 입원이 생성됩니다." /></p>
        <label className="text-xs text-gray-500 mb-1 block"><T k="병상 배정" /> <span className="text-red-400">*</span></label>
        {/* 🔴 병상 조회 실패를 "가용 병상 0개"로 말하지 않는다 */}
        {bedsIsError && <QueryErrorFallback error={bedsError} onRetry={refetchBeds} size="compact" className="mb-2" />}
        <select value={bedId} onChange={(e) => setBedId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2">
          <option value="">가용 병상 선택 ({beds.length}<Unit>개</Unit>)</option>
          {beds.map((b) => <option key={b.id} value={b.id}>{b.ward?.name ? `${b.ward.name} · ` : ''}{b.roomNumber ?? ''}{b.bedNumber ? `-${b.bedNumber}` : ''}</option>)}
        </select>
        <p className="text-[11px] text-gray-400 mb-4">주치의: {user ? `${user.familyName ?? ''}${user.givenName ?? ''}` : '(로그인 사용자)'} · 입원사유: {target.reason}</p>
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy || !bedId} className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"><T k={busy ? '처리 중…' : '입원 전환'} /></button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600"><T k="닫기" /></button>
        </div>
      </div>
    </div>
  );
}

/** 응급 접수 + KTAS 트리아지 폼 */
function TriageForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const tAttr = useTAttr();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'search' | 'new'>('search');
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; mrn: string; familyName: string; givenName: string } | null>(null);
  // 🔴 기본값을 두지 않는다 — 고르지 않은 것이 KTAS 3 으로 저장되면 원장이 거짓이 된다
  const [triageLevel, setTriageLevel] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [notes, setNotes] = useState('');
  /**
   * 실제 도착 시각(선택). 비우면 접수 시각을 도착으로 본다.
   * 🔴 비워두면 door-to-triage 는 0분이 아니라 **산출 불가**로 집계된다 — 0 은 다른 사실이다.
   */
  const [arrivalAt, setArrivalAt] = useState('');
  const [vitals, setVitals] = useState({ systolicBp: '', diastolicBp: '', heartRate: '', temperature: '', spo2: '', respiratoryRate: '' });
  // 신규 환자
  const [newPatient, setNewPatient] = useState({ familyName: '', givenName: '', gender: 'MALE', dateOfBirth: '', phone: '' });
  // WeRU.B 증상 상담
  const [aiChat, setAiChat] = useState<string[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  // 채팅 KTAS 제안 — 자동 반영 대신 [적용] 버튼으로만 반영
  const [aiKtasSuggest, setAiKtasSuggest] = useState<number | null>(null);
  // 주호소 자동 트리아지 디바운스(900ms) — 타이핑마다 호출 방지
  const [debouncedComplaint, setDebouncedComplaint] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedComplaint(chiefComplaint.trim()), 900);
    return () => clearTimeout(t);
  }, [chiefComplaint]);

  // 신규 환자 등록
  const newPatientMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { id: string; mrn: string; familyName: string; givenName: string } }>('/api/v1/patients', {
      familyName: newPatient.familyName, givenName: newPatient.givenName,
      gender: newPatient.gender, dateOfBirth: newPatient.dateOfBirth || undefined,
      phone: newPatient.phone || undefined, insuranceType: 'NHI',
    }),
    onSuccess: (res) => {
      const raw = res?.data as { data?: { id: string; mrn: string; familyName: string; givenName: string } };
      const p = raw?.data ?? raw as unknown as { id: string; mrn: string; familyName: string; givenName: string };
      setSelectedPatient({ id: p.id, mrn: p.mrn, familyName: newPatient.familyName, givenName: newPatient.givenName });
      toast.success(`환자 등록 완료 (MRN: ${p.mrn})`);
      setStep(2);
    },
    onError: () => toast.error('환자 등록 실패'),
  });

  // WeRU.B 증상 상담
  const askAi = async () => {
    if (!aiInput.trim()) return;
    const question = aiInput.trim();
    setAiChat(prev => [...prev, `Q: ${question}`]);
    setAiInput('');
    setAiLoading(true);
    try {
      const res = await apiClient.post<{ data: Record<string, unknown> }>('/api/v1/ai/triage', { symptom: question });
      const d = (res?.data as { data?: Record<string, unknown> })?.data ?? res?.data;
      const recs = (d as Record<string, unknown>)?.recommendations as Array<{ department: string; confidence: number }> | undefined;
      const ktas = (d as Record<string, unknown>)?.ktas_level;
      const flags = (d as Record<string, unknown>)?.red_flags as string[] | undefined;
      const warning = (d as Record<string, unknown>)?.emergency_warning;
      let answer = '';
      if (recs?.length) answer += `추천 진료과: ${recs.map(r => `${r.department}(${Math.round(r.confidence * 100)}%)`).join(', ')}\n`;
      if (ktas) answer += `KTAS 제안: Level ${ktas}\n`;
      if (flags?.length) answer += `Red Flags: ${flags.join(', ')}\n`;
      if (warning) answer += `⚠️ ${warning}\n`;
      if (!answer) answer = `${AI_ORIGIN_TEXT} 분석 결과 없음`;
      setAiChat(prev => [...prev, `A: ${answer.trim()}`]);
      // 주호소 자동 채우기
      if (!chiefComplaint) setChiefComplaint(question);
      // KTAS는 자동 반영하지 않음 — 제안으로 표시하고 [적용] 버튼으로만 반영
      if (ktas) setAiKtasSuggest(Number(ktas));
    } catch {
      setAiChat(prev => [...prev, `A: ${AI_ORIGIN_TEXT} 분석 실패`]);
    }
    setAiLoading(false);
  };

  // WeRU.B 트리아지 제안 (900ms 디바운스된 주호소 기준)
  const { data: aiTriage, isError: aiTriageIsError, error: aiTriageError, refetch: refetchAiTriage } = useQuery({
    queryKey: ['ai-triage-suggest', debouncedComplaint],
    queryFn: () => apiClient.post<{ data: unknown }>('/api/v1/ai/triage', { symptom: debouncedComplaint }),
    enabled: debouncedComplaint.length >= 5,
    staleTime: 30000,
  });
  const aiResult: Record<string, unknown> | null = ((aiTriage?.data as { data?: Record<string, unknown> })?.data ?? aiTriage?.data ?? null) as Record<string, unknown> | null;

  // 접수 등록
  const triageMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/emergency/triage', {
      patientId: selectedPatient?.id,
      chiefComplaint,
      triageLevel,
      notes: notes || undefined,
      arrivalAt: arrivalAt ? new Date(arrivalAt).toISOString() : undefined,
    }),
    onSuccess: () => { toast.success('응급 접수 완료'); onSuccess(); },
    onError: () => toast.error('접수 실패'),
  });

  return (
    <div className="bg-white rounded-2xl border-2 border-red-200 shadow-lg">
      {/* 헤더 */}
      <div className="bg-red-50 px-5 py-3 rounded-t-2xl flex items-center justify-between border-b border-red-100">
        <h2 className="text-sm font-bold text-red-900"><T k="응급 환자 접수" /></h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="px-5 pt-3 flex gap-1">
        {['환자 확인', 'KTAS 분류', '바이탈/메모', '접수 확인'].map((s, i) => (
          <div key={i} className={`flex-1 h-1 rounded-full ${step > i ? 'bg-red-500' : step === i + 1 ? 'bg-red-300' : 'bg-gray-200'}`} />
        ))}
      </div>

      <div className="p-5">
        {/* Step 1: 환자 확인 (기존 검색 + 신규 등록 + WeRU.B 상담) */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-medium"><T k="1단계: 환자 확인" /></p>

            {/* 모드 전환 */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              <button onClick={() => setMode('search')} className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${mode === 'search' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                <T k="기존 환자 검색" />
              </button>
              <button onClick={() => setMode('new')} className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${mode === 'new' ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500'}`}>
                <T k="신규 환자 등록" />
              </button>
            </div>

            {/* 기존 환자 검색 */}
            {mode === 'search' && (
              <div>
                <PatientSelector
                  context="general"
                  placeholder="환자 이름, MRN 검색..."
                  showEmergency
                  autoFocus
                  onChange={(patientId, patient) => {
                    setSelectedPatient({ id: patientId, mrn: patient.mrn, familyName: patient.familyName, givenName: patient.givenName });
                    setStep(2);
                  }}
                />
              </div>
            )}

            {/* 신규 환자 간편 등록 */}
            {mode === 'new' && (
              <div className="space-y-2 bg-red-50/50 rounded-xl p-3 border border-red-100">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-gray-500"><T k="성" /></label>
                    <input value={newPatient.familyName} onChange={e => setNewPatient(p => ({ ...p, familyName: e.target.value }))}
                      placeholder="김" className="w-full px-3 py-2 border rounded-lg text-sm" autoFocus />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500"><T k="이름" /></label>
                    <input value={newPatient.givenName} onChange={e => setNewPatient(p => ({ ...p, givenName: e.target.value }))}
                      placeholder="영수" className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-gray-500"><T k="성별" /></label>
                    <select value={newPatient.gender} onChange={e => setNewPatient(p => ({ ...p, gender: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="MALE">남</option>
                      <option value="FEMALE">여</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500"><T k="생년월일 (선택)" /></label>
                    <input type="date" value={newPatient.dateOfBirth} onChange={e => setNewPatient(p => ({ ...p, dateOfBirth: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] text-gray-500"><T k="연락처 (선택)" /></label>
                  <input value={newPatient.phone} onChange={e => setNewPatient(p => ({ ...p, phone: e.target.value }))}
                    placeholder="010-0000-0000" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <button onClick={() => newPatientMut.mutate()} disabled={!newPatient.familyName || !newPatient.givenName || newPatientMut.isPending}
                  className="w-full min-h-[44px] px-3 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 disabled:opacity-50">
                  <T k={newPatientMut.isPending ? '등록 중...' : '신규 환자 등록 + 응급 접수'} />
                </button>
              </div>
            )}

            {/* WeRU.B 증상 상담 */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-[10px] font-bold text-amber-700 mb-1.5 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                <T k="증상 상담 (KTAS 자동 분류)" />
              </p>
              {aiChat.length > 0 && (
                <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-2 mb-2 max-h-32 overflow-y-auto space-y-1 text-xs">
                  {aiChat.map((msg, i) => (
                    <p key={i} className={msg.startsWith('Q:') ? 'text-gray-700 font-medium' : 'text-amber-700 whitespace-pre-wrap'}>{msg}</p>
                  ))}
                  {aiLoading && <p className="text-amber-500 animate-pulse"><T k="분석 중..." /></p>}
                </div>
              )}
              {aiKtasSuggest != null && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
                  <p className="text-[10px] font-bold text-amber-700 flex-1">KTAS 제안: Level {aiKtasSuggest}</p>
                  <button onClick={() => { setTriageLevel(`LEVEL_${aiKtasSuggest}`); toast.success(`KTAS ${aiKtasSuggest} 적용됨`); }}
                    className="px-2 py-1 bg-amber-600 text-white text-[10px] font-bold rounded-lg hover:bg-amber-700"><T k="적용" /></button>
                  <button onClick={() => setAiKtasSuggest(null)} className="text-[10px] text-gray-400 hover:text-gray-600"><T k="무시" /></button>
                </div>
              )}
              {aiChat.length > 0 && (
                <p className="text-[11px] text-gray-500 mb-1.5">{AI_ORIGIN_TEXT}가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다.</p>
              )}
              <div className="flex gap-1.5">
                <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && askAi()}
                  placeholder={tAttr('증상을 입력하세요 (예: 갑자기 가슴이 아프고 숨이 차요)')}
                  className="flex-1 px-3 py-2 border border-amber-200 rounded-lg text-xs bg-amber-50/30" />
                <button onClick={askAi} disabled={aiLoading || !aiInput.trim()}
                  className="px-3 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50 shrink-0">
                  <T k="상담" />
                </button>
              </div>
            </div>

            {/* 선택 완료 */}
            {selectedPatient && (
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
                <p className="text-xs text-blue-600 font-bold"><T k="선택된 환자" /></p>
                <p className="text-sm font-bold text-gray-900">{selectedPatient.familyName}{selectedPatient.givenName} ({selectedPatient.mrn})</p>
                <button onClick={() => setStep(2)} className="mt-2 w-full py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700"><T k="다음: KTAS 분류" /></button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: KTAS 분류 + 주호소 */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-medium"><T k="2단계: 주호소 + KTAS 분류" /></p>
            <textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)}
              rows={3} placeholder={tAttr('주호소를 입력하세요 (예: 흉통, 호흡곤란, 의식저하...)')}
              className="w-full px-4 py-2.5 border-2 border-red-200 rounded-xl text-sm resize-none focus:border-red-400 focus:outline-none" />

            {/* WeRU.B 트리아지 제안 */}
            {/* 🔴 자동 분류 호출 실패를 "제안 없음"으로 조용히 넘기지 않는다(수기 분류가 유일한 근거임을 밝힌다) */}
            {aiTriageIsError && <QueryErrorFallback error={aiTriageError} onRetry={refetchAiTriage} size="compact" />}
            {aiResult?.ktas_level != null && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold text-amber-700 flex-1">자동 분류 제안: KTAS {String(aiResult.ktas_level)}</p>
                  <button onClick={() => { setTriageLevel(`LEVEL_${aiResult.ktas_level}`); toast.success(`KTAS ${aiResult.ktas_level} 적용됨`); }}
                    className="px-2 py-1 bg-amber-600 text-white text-[10px] font-bold rounded-lg hover:bg-amber-700"><T k="적용" /></button>
                </div>
                {Array.isArray(aiResult.red_flags) && aiResult.red_flags.length > 0 && (
                  <p className="text-[10px] text-red-600 mt-1">Red Flags: {aiResult.red_flags.map(String).join(', ')}</p>
                )}
                <p className="text-[11px] text-gray-500 mt-1.5">{AI_ORIGIN_TEXT}가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다.</p>
              </div>
            )}

            <p className="text-xs font-bold text-gray-700 mt-2"><T k="KTAS 레벨 선택" /></p>
            <div className="grid grid-cols-5 gap-1.5">
              {Object.entries(KTAS).map(([key, v]) => (
                <button key={key} onClick={() => setTriageLevel(key)}
                  className={`py-2.5 rounded-xl text-center border-2 transition ${triageLevel === key ? 'border-gray-900 shadow-md scale-105' : 'border-transparent'} ${v.color}`}>
                  <p className="text-xs font-bold">{v.label}</p>
                  <p className="text-[8px] mt-0.5 opacity-80">{v.desc}</p>
                </button>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep(1)} className="text-xs text-gray-400">← <T k="이전" /></button>
              {chiefComplaint && <button onClick={() => setStep(3)} className="ml-auto px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700"><T k="다음: 바이탈" /></button>}
            </div>
          </div>
        )}

        {/* Step 3: 바이탈 + 메모 */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-medium"><T k="3단계: 초기 바이탈 + 메모 (선택)" /></p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'systolicBp', label: 'SBP', unit: 'mmHg' },
                { key: 'diastolicBp', label: 'DBP', unit: 'mmHg' },
                { key: 'heartRate', label: 'HR', unit: 'bpm' },
                { key: 'temperature', label: 'BT', unit: '°C' },
                { key: 'spo2', label: 'SpO2', unit: '%' },
                { key: 'respiratoryRate', label: 'RR', unit: '/min' },
              ].map(({ key, label, unit }) => (
                <div key={key}>
                  <label className="text-[9px] text-gray-400">{label} ({unit})</label>
                  <input type="number" value={vitals[key as keyof typeof vitals]}
                    onChange={e => setVitals(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-2 py-1.5 border rounded-lg text-xs" placeholder="--" />
                </div>
              ))}
            </div>
            <div>
              <label className="text-[10px] text-gray-500"><T k="실제 도착 시각 (선택)" /></label>
              <input type="datetime-local" value={arrivalAt} onChange={e => setArrivalAt(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl text-xs" />
              <p className="text-[10px] text-gray-400 mt-1">
                비우면 접수 시각을 도착으로 봅니다 — 이때 도착→분류 소요는 <b>0분이 아니라 {RATIO_UNAVAILABLE}</b>로 집계됩니다.
              </p>
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder={tAttr('초기 평가 메모 (선택)...')}
              className="w-full px-3 py-2 border rounded-xl text-xs resize-none" />
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep(2)} className="text-xs text-gray-400">← <T k="이전" /></button>
              <button onClick={() => setStep(4)} className="ml-auto px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700"><T k="다음: 확인" /></button>
            </div>
          </div>
        )}

        {/* Step 4: 접수 확인 */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-medium"><T k="4단계: 접수 확인" /></p>
            <div className="bg-red-50 rounded-xl p-4 space-y-2 border border-red-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900">{selectedPatient?.familyName ?? ''}{selectedPatient?.givenName ?? ''}</span>
                <span className={`px-2 py-1 rounded-lg text-xs font-bold ${KTAS[triageLevel]?.color}`}>{KTAS[triageLevel]?.label}</span>
              </div>
              <p className="text-xs text-gray-500">MRN: {String(selectedPatient?.mrn ?? '')}</p>
              <div className="border-t border-red-100 pt-2 mt-2">
                <p className="text-xs text-gray-700"><span className="font-bold"><T k="주호소" />:</span> {chiefComplaint}</p>
                {notes && <p className="text-xs text-gray-500 mt-1"><span className="font-bold"><T k="메모" />:</span> {notes}</p>}
                {Object.values(vitals).some(v => v) && (
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-bold"><T k="바이탈" />:</span>{' '}
                    {/* 표시 부품 정본 — 미측정 '—'·혈압 한 값·입력한 RR 도 표시·임계 정본 색 */}
                    <VitalSignsStrip vitals={vitals} keys={['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature']} />
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep(3)} className="text-xs text-gray-400">← <T k="수정@행위" /></button>
              {/* 🔴 중증도를 고르지 않은 채 접수하지 않는다 — 기본값으로 굳으면 원장이 거짓이 된다.
                  막는 것이 아니라 **무엇이 빠졌는지 말한다**(§6.3 강제는 거짓 데이터를 만든다). */}
              <button onClick={() => triageMut.mutate()} disabled={triageMut.isPending || !triageLevel}
                className="flex-1 min-h-[48px] py-3 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 shadow-lg shadow-red-200">
                {triageMut.isPending ? <T k="접수 중..." /> : !triageLevel ? <T k="중증도(KTAS)를 선택하세요" /> : <>🚨 <T k="응급 접수 확정" /></>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
