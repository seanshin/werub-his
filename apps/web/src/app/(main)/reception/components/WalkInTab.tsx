'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { MutationError, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { useHotkeys, comboLabel, ariaKeyshortcuts } from '@/components/hotkeys/HotkeyProvider';
import { AiReceptionChat } from './AiReceptionChat';
import { PatientAvatar } from '@/components/PatientAvatar';
import { EligibilityVerifyModal } from './EligibilityVerifyModal';
import { money, kdate } from '@/lib/ui-settings';
import { Money, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface TriageRecommendation {
  rank: number;
  department: string;
  department_full?: string;
  reason?: string;
  confidence: number;
}

interface TriageResult {
  emergency_warning?: string;
  recommendations?: TriageRecommendation[];
  symptom_analysis?: { extracted_symptoms?: string[] };
  disclaimer?: string;
}

interface TriageFollowUpResult {
  updated_recommendations?: TriageRecommendation[];
  additional_analysis?: string;
  disclaimer?: string;
}

interface CommonSymptom {
  symptom: string;
  category?: string;
}

interface PatientSearchItem {
  id: string;
  familyName: string;
  givenName: string;
  mrn: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  insuranceType?: string;
}

interface ClinicScheduleItem {
  id: string;
  doctorId: string;
  doctor?: { familyName: string; givenName: string };
  doctorFamilyName?: string;
  doctorGivenName?: string;
  waitingCount: number;
  period: string;
  startTime: string;
  endTime: string;
  roomName: string;
}

// 진료과 목록 정본 = 마스터(useDepartments) — 로컬 배열 재정의 금지(input-assist-ux P1)

const walkInSchema = z.object({
  patientId: z.string().min(1, '환자를 선택하세요'),
  departmentName: z.string().min(1, '진료과를 선택하세요'),
  doctorId: z.string().optional(),
  visitType: z.enum(['INITIAL', 'FOLLOW_UP']),
  reason: z.string().optional(),
});
type WalkInForm = z.infer<typeof walkInSchema>;

export function WalkInTab({ onNewPatient }: { onNewPatient?: (p: { familyName?: string; givenName?: string; phone?: string; birth?: string; reason?: string }) => void } = {}) {
  const tt = useTAttr();
  const queryClient = useQueryClient();
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [triageLoading, setTriageLoading] = useState(false);
  const [followUpResult, setFollowUpResult] = useState<TriageFollowUpResult | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpInput, setFollowUpInput] = useState('');
  const [commonSymptoms, setCommonSymptoms] = useState<CommonSymptom[]>([]);
  const [commonSymptomsLoading, setCommonSymptomsLoading] = useState(false);
  const [commonSymptomsOpen, setCommonSymptomsOpen] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors }, reset } = useForm<WalkInForm>({
    resolver: zodResolver(walkInSchema),
    defaultValues: { patientId: '', departmentName: '', doctorId: '', visitType: 'INITIAL', reason: '' },
  });

  const selectedDept = watch('departmentName');
  const { names: departments, isError: deptListError, refetch: refetchDepts } = useDepartments({ category: 'CLINICAL' });
  const selectedDoctor = watch('doctorId');
  const visitType = watch('visitType');
  const reason = watch('reason') ?? '';

  const [selectedPatient, setSelectedPatient] = useState<PatientSearchItem | null>(null);
  const [aiKey, setAiKey] = useState(0);
  const [aiAuto, setAiAuto] = useState<{ q: string; ts: number } | null>(null);
  const [typedQuery, setTypedQuery] = useState('');
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 환자 선택 검색어 → WeRU.B 어시스턴트로 자동 전달(타이핑 멈춘 뒤)
  const handlePatientQuery = (q: string) => {
    setTypedQuery(q);
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    const t = q.trim();
    if (t.length < 2) return;
    aiDebounceRef.current = setTimeout(() => setAiAuto({ q: t, ts: Date.now() }), 900);
  };

  // 신규 환자 등록 탭으로 입력값 이관 (이름/전화 자동 분해)
  const goNewPatient = () => {
    const q = (typedQuery || reason || '').trim();
    const prefill: { familyName?: string; givenName?: string; phone?: string; reason?: string } = { reason: reason || undefined };
    const phoneM = q.match(/01[016789]-?\d{3,4}-?\d{4}/);
    if (phoneM) prefill.phone = phoneM[0];
    const nameM = q.replace(/01[016789]-?\d{3,4}-?\d{4}/g, '').trim().match(/^([가-힣]{2,4})/);
    if (nameM) { prefill.familyName = nameM[1][0]; prefill.givenName = nameM[1].slice(1); }
    onNewPatient?.(prefill);
  };

  const resetAll = () => {
    setSelectedPatient(null);
    setValue('patientId', '');
    setValue('departmentName', '');
    setValue('doctorId', '');
    setValue('reason', '');
    setValue('visitType', 'INITIAL');
    setTriageResult(null);
    setFollowUpResult(null);
    setFollowUpInput('');
    setAiAuto(null);
    setTypedQuery('');
    setAiKey((k) => k + 1); // WeRU.B 어시스턴트 대화 초기화(리마운트)
  };

  const { data: doctorsData } = useQuery({
    queryKey: ['clinic-schedule-today', selectedDept],
    queryFn: () => apiClient.get<{ data: ClinicScheduleItem[] }>('/api/v1/clinic-schedule/today', { department: selectedDept || undefined }),
    enabled: !!selectedDept,
  });

  // 선택 환자 미납(미수금) 안내 — 접수 시점 수납 안내용
  const { data: unpaidData, isError: unpaidIsError, error: unpaidError, refetch: refetchUnpaid } = useQuery({
    queryKey: ['patient-outstanding', selectedPatient?.id],
    queryFn: () => apiClient.get<{ data: { total: number; totalOutstandingAmount: number } }>(`/api/v1/billing/outstanding?patientId=${selectedPatient!.id}&limit=1`),
    enabled: !!selectedPatient?.id,
  });
  const unpaid = (() => {
    const raw = unpaidData?.data as { total?: number; totalOutstandingAmount?: number } | { data?: { total?: number; totalOutstandingAmount?: number } } | null | undefined;
    const d = raw && 'total' in raw ? raw : (raw as { data?: { total?: number; totalOutstandingAmount?: number } })?.data;
    return d && (d.total ?? 0) > 0 ? { count: d.total ?? 0, amount: d.totalOutstandingAmount ?? 0 } : null;
  })();

  const checkInMutation = useMutation({
    mutationFn: (formData: WalkInForm) =>
      apiClient.post('/api/v1/queue/check-in', {
        patientId: formData.patientId,
        doctorId: formData.doctorId || undefined,
        departmentName: formData.departmentName,
        visitType: formData.visitType,
        reason: formData.reason || undefined,
        type: 'WALK_IN',
      }),
    onSuccess: (res: unknown, vars: WalkInForm) => {
      toast.success(tt('접수가 완료되었습니다.'));
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      const queueId = (res as { data?: { id?: string } })?.data?.id;
      const name = selectedPatient ? `${selectedPatient.familyName ?? ''}${selectedPatient.givenName ?? ''}` : '';
      // 접수 직후 자격조회·본인확인(의무화) 모달
      setVerifyTarget({ patientId: vars.patientId, queueId: queueId ?? '', name, visitType: vars.visitType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'INITIAL' });
      setSelectedPatient(null);
      reset();
    },
    onError: (err: MutationError) => toast.error(err?.message ?? tt('접수 처리 중 오류가 발생했습니다.')),
  });

  const [verifyTarget, setVerifyTarget] = useState<{ patientId: string; queueId: string; name: string; visitType: string } | null>(null);

  const onSubmit = (data: WalkInForm) => checkInMutation.mutate(data);

  // 화면 내 핫키 (Mac 친화 — F-키 대신 ⌘/Ctrl+Enter, Alt+문자)
  useHotkeys([
    { combo: 'mod+Enter', label: tt('접수 완료'), group: tt('당일 접수'), allowInInput: true, when: () => !!selectedPatient && !checkInMutation.isPending, onTrigger: () => handleSubmit(onSubmit)() },
    { combo: 'alt+n', label: tt('신규 환자 등록'), group: tt('당일 접수'), when: () => !selectedPatient && typedQuery.trim().length >= 2, onTrigger: goNewPatient },
    { combo: 'alt+r', label: tt('전체 초기화'), group: tt('당일 접수'), onTrigger: resetAll },
  ]);

  const _doctorsRaw = doctorsData?.data;
  const doctors: ClinicScheduleItem[] = Array.isArray(_doctorsRaw) ? _doctorsRaw : (_doctorsRaw as unknown as Record<string, unknown>)?.data as ClinicScheduleItem[] ?? [];

  const handleTriage = async () => {
    if (reason.trim().length < 2) return;
    setTriageLoading(true);
    setTriageResult(null);
    try {
      const res = await apiClient.post<{ data: TriageResult | null }>('/api/v1/ai/triage', { symptom: reason.trim() });
      const result = res.data;
      if (!result || (!result.recommendations?.length && !result.emergency_warning)) {
        toast.error(`${AI_ORIGIN_TEXT} 추천 결과를 받지 못했습니다. ${AI_ORIGIN_TEXT} 서버 상태를 확인하거나 잠시 후 다시 시도하세요.`);
      } else {
        setTriageResult(result);
      }
    } catch {
      toast.error(`${AI_ORIGIN_TEXT} 트리아지 서비스에 연결할 수 없습니다.`);
    }
    setTriageLoading(false);
  };

  const handleFollowUp = async () => {
    if (followUpInput.trim().length < 2) return;
    setFollowUpLoading(true);
    setFollowUpResult(null);
    try {
      const res = await apiClient.post<{ data: TriageFollowUpResult }>('/api/v1/ai/triage/follow-up', { symptom: followUpInput.trim() });
      const data = (res.data as unknown as Record<string, unknown>)?.data as TriageFollowUpResult ?? res.data;
      if (!data || (!data.updated_recommendations?.length && !data.additional_analysis)) {
        toast.error(tt('추가 분석 결과를 받지 못했습니다. 잠시 후 다시 시도하세요.'));
      } else {
        setFollowUpResult(data);
      }
    } catch {
      toast.error(`${AI_ORIGIN_TEXT} 추가 분석 서비스에 연결할 수 없습니다.`);
    }
    setFollowUpLoading(false);
  };

  const handleFetchCommonSymptoms = async () => {
    if (commonSymptoms.length > 0) {
      setCommonSymptomsOpen(!commonSymptomsOpen);
      return;
    }
    setCommonSymptomsLoading(true);
    try {
      const res = await apiClient.get<{ data: CommonSymptom[] }>('/api/v1/ai/triage/common-symptoms');
      const data = (res.data as unknown as Record<string, unknown>)?.data as CommonSymptom[] ?? res.data;
      setCommonSymptoms(Array.isArray(data) ? data : []);
      setCommonSymptomsOpen(true);
    } catch {
      toast.error(tt('자주 묻는 증상 조회에 실패했습니다.'));
    }
    setCommonSymptomsLoading(false);
  };

  const [leftWidth, setLeftWidth] = useState(55);
  const isDragging = useRef(false);

  const handleMouseDown = () => { isDragging.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; };
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const container = document.getElementById('reception-split');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.min(75, Math.max(30, pct)));
    };
    const handleMouseUp = () => { isDragging.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  return (
    <div id="reception-split" className="flex gap-0 overflow-hidden h-full">
      {/* 좌측 = 위(스크롤: 환자·진료과·현재 접수 환자) + 아래 고정(접수 유형·사유·접수 완료).
          2026-09-30 사람 요청 — 마무리 조작은 흐름의 끝(하단)에 둔다. 우측 어시스턴트 입력줄과 같은 높이에 선다. */}
      <div style={{ width: `${leftWidth}%`, height: '100%' }} className="flex flex-col min-h-0 pr-3" data-walkin-left>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4" data-walkin-scroll>
      {/* Patient Search */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900"><T k="환자 선택" /></h3>
          <div className="flex items-center gap-1.5">
          {!selectedPatient && typedQuery.trim().length >= 2 && (
            <button type="button" onClick={goNewPatient} aria-keyshortcuts={ariaKeyshortcuts('alt+n')}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap">
              + <T k="신규 환자 등록" /> <kbd className="ml-1 text-[9px] font-semibold bg-white/25 rounded px-1 py-0.5">{comboLabel('alt+n')}</kbd>
            </button>
          )}
          <button
            type="button"
            onClick={resetAll}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <T k="전체 초기화" />
          </button>
          </div>
        </div>
        <PatientSelector
          value={watch('patientId')}
          onChange={(id, p) => {
            setValue('patientId', id);
            if (id && p.familyName) {
              setSelectedPatient({
                id, familyName: p.familyName, givenName: p.givenName, mrn: p.mrn,
                dateOfBirth: p.dateOfBirth, gender: p.gender, phone: p.phone, insuranceType: p.insuranceType,
              });
            } else {
              setSelectedPatient(null);
            }
          }}
          context="general"
          autoFocus
          onQueryChange={handlePatientQuery}
        />
        {errors.patientId && !selectedPatient && (
          <p className="mt-1 text-xs text-red-500">{errors.patientId.message}</p>
        )}
      </div>

      {/* Department + Doctor Selection */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4"><T k="진료과 / 의사 선택" /></h3>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-2"><T k="진료과" /></label>
          <div className="flex flex-wrap gap-2">
            {departments.map((dept) => (
              <button key={dept} onClick={() => { setValue('departmentName', dept); setValue('doctorId', ''); }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  selectedDept === dept ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>{dept}</button>
            ))}
          </div>
          {errors.departmentName && <p className="mt-1 text-xs text-red-500">{errors.departmentName.message}</p>}
        </div>

        {selectedDept && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-500 mb-2">오늘 {selectedDept} 진료 의사</label>
            {doctors.length === 0 ? (
              <p className="text-sm text-gray-400 py-4"><T k="현재 진료 가능한 의사가 없습니다." /></p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {doctors.map((doc: ClinicScheduleItem) => (
                  <button key={doc.id} onClick={() => setValue('doctorId', doc.doctorId)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      selectedDoctor === doc.doctorId ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:border-gray-200'
                    }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-gray-900">{doc.doctor?.familyName}{doc.doctor?.givenName}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        doc.waitingCount > 5 ? 'bg-red-100 text-red-700' : doc.waitingCount > 2 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                      }`}>대기 {doc.waitingCount}명</span>
                    </div>
                    <p className="text-xs text-gray-500"><T k={doc.period === 'AM' ? '오전' : doc.period === 'PM' ? '오후' : '종일'} /> ({doc.startTime}~{doc.endTime})</p>
                    <p className="text-xs text-gray-400 mt-0.5">{doc.roomName}</p>
                  </button>
                ))}
                <button onClick={() => setValue('doctorId', '')}
                  className={`p-4 rounded-2xl border-2 border-dashed text-left transition-all ${
                    selectedDoctor === '' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}>
                  <p className="text-sm font-medium text-gray-600"><T k="자동 배정" /></p>
                  <p className="text-xs text-gray-400 mt-1"><T k="대기 수가 가장 적은 의사에게 자동 배정" /></p>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedPatient && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <T k="현재 접수 환자" />
          </h3>
          <div className="flex items-center gap-4 mb-3">
            <PatientAvatar gender={selectedPatient.gender} dateOfBirth={selectedPatient.dateOfBirth} familyName={selectedPatient.familyName} givenName={selectedPatient.givenName} />
            <div>
              <p className="text-base font-bold text-gray-900">{selectedPatient.familyName}{selectedPatient.givenName}</p>
              <p className="text-xs text-gray-500">{selectedPatient.gender === 'MALE' ? <T k="남" /> : selectedPatient.gender === 'FEMALE' ? <T k="여" /> : ''} · {selectedPatient.dateOfBirth ? kdate(selectedPatient.dateOfBirth) : ''}</p>
            </div>
            {/* 🔴 미납 조회 실패를 "미납 없음"으로 읽히게 두지 않는다 — 배지가 그냥 사라진다 */}
            {unpaidIsError && (
              <QueryErrorFallback error={unpaidError} onRetry={() => refetchUnpaid()} size="compact" className="ml-auto" />
            )}
            {!unpaidIsError && unpaid && (
              <a href="/reception-billing-board" target="_blank" rel="noopener noreferrer" title={tt('원무·수납 보드에서 확인')}
                className="ml-auto px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors whitespace-nowrap">
                <T k="미납" /> {unpaid.count}<Unit>건</Unit> · <Money value={unpaid.amount} />
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-gray-400"><T k="환자번호" /></span>
              <p className="font-mono font-medium text-gray-800">{selectedPatient.mrn}</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-gray-400"><T k="연락처" /></span>
              <p className="font-medium text-gray-800">{selectedPatient.phone ?? '-'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-gray-400"><T k="보험유형" /></span>
              <p className="font-medium text-gray-800">{selectedPatient.insuranceType === 'NHI' ? <T k="건강보험" /> : selectedPatient.insuranceType ?? '-'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-gray-400"><T k="증상/사유" /></span>
              <p className="font-medium text-gray-800">{reason || '-'}</p>
            </div>
          </div>
          {selectedDept && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg font-medium">{selectedDept}</span>
              {selectedDoctor && doctors.find((d: ClinicScheduleItem) => d.doctorId === selectedDoctor) && (
                <span className="text-gray-500">
                  {(() => { const d = doctors.find((doc: ClinicScheduleItem) => doc.doctorId === selectedDoctor); return d ? `${d.doctor?.familyName ?? d.doctorFamilyName ?? ''}${d.doctor?.givenName ?? d.doctorGivenName ?? ''} 선생님` : ''; })()}
                </span>
              )}
              <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg"><T k={visitType === 'INITIAL' ? '초진' : '재진'} /></span>
            </div>
          )}
          {/* 동의서 태블릿 전송 (FR) */}
          <Link href="/workstation/consent"
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <T k="동의서 태블릿 전송" /> →
          </Link>
        </div>
      )}
      </div>

      {/* Visit Type + Reason */}
      <div className="flex-shrink-0 flex flex-col max-h-[55%] bg-white rounded-2xl border border-gray-200 shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.12)]" data-walkin-actions>
        {/* 트리아지 결과·추가 질문이 길어지면 이 칸만 스크롤 — 접수 완료 버튼은 늘 보인다 */}
        <div className="min-h-0 overflow-y-auto px-5 pt-4 pb-3">
        {/* 🔴 종전 sm:grid-cols-2 + 사유 칸 flex-1(최소 폭 없음) + AI 버튼 nowrap → 중간 폭에서 버튼이 카드 밖으로 삐져나갔다(2026-09-29 스크린샷).
            두 칸은 lg 부터 나누고(사유 쪽을 넓게), 칸은 min-w-0 으로 줄어들 수 있게, 사유 줄은 모자라면 버튼이 아래로 접힌다. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-500 mb-2"><T k="접수 유형" /></label>
            <div className="flex gap-3">
              {[{ value: 'INITIAL', label: '초진' }, { value: 'FOLLOW_UP', label: '재진' }].map((vt) => (
                <button key={vt.value} onClick={() => setValue('visitType', vt.value as 'INITIAL' | 'FOLLOW_UP')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    visitType === vt.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}><T k={vt.label} /></button>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-500 mb-2"><T k="접수 사유 (증상)" /></label>
            <div className="flex flex-wrap gap-2" data-reason-row>
              <input type="text" {...register('reason', { onChange: () => setTriageResult(null) })}
                onKeyDown={(e) => { if (e.key === 'Enter' && reason.trim().length >= 2) handleTriage(); }}
                placeholder={tt('예: 기침, 발열, 두통...')}
                className="min-w-[12rem] flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              <button onClick={handleTriage} disabled={triageLoading || reason.trim().length < 2}
                className="shrink-0 px-3 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                {triageLoading ? <>{AI_ORIGIN_TEXT} <T k="분석중..." /></> : <>{AI_ORIGIN_TEXT} <T k="추천" /></>}
              </button>
            </div>
            {triageResult && (
              <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                {triageResult.emergency_warning && (
                  <div className="mb-2 px-3 py-2 bg-red-100 border border-red-300 rounded-lg text-sm font-bold text-red-800 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                    {triageResult.emergency_warning}
                  </div>
                )}
                <p className="text-[10px] font-semibold text-indigo-500 uppercase mb-2">{AI_ORIGIN_TEXT} <T k="진료과 추천" /></p>
                <div className="space-y-1.5">
                  {(triageResult.recommendations ?? []).map((rec: TriageRecommendation) => (
                    <button key={rec.rank} onClick={() => { const dept = rec.department_full || rec.department; setValue('departmentName', dept.replace(/\(.+\)/, '').trim()); }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-100 transition-colors flex items-center justify-between group">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${rec.rank === 1 ? 'bg-indigo-600 text-white' : 'bg-indigo-200 text-indigo-700'}`}>{rec.rank}</span>
                        <span className="text-sm font-medium text-gray-900">{rec.department}</span>
                        {rec.reason && <span className="text-xs text-gray-500">— {rec.reason}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${rec.confidence >= 0.8 ? 'text-indigo-700' : rec.confidence >= 0.5 ? 'text-amber-600' : 'text-gray-500'}`}>{Math.round(rec.confidence * 100)}<Unit>%</Unit></span>
                        <span className="text-[10px] text-indigo-400 group-hover:text-indigo-600"><T k="선택" /> →</span>
                      </div>
                    </button>
                  ))}
                </div>
                {(triageResult.symptom_analysis?.extracted_symptoms?.length ?? 0) > 0 && (
                  <div className="mt-2 pt-2 border-t border-indigo-200 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-indigo-400"><T k="감지된 증상" />:</span>
                    {triageResult.symptom_analysis?.extracted_symptoms?.map((s: string, i: number) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">{s}</span>
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-indigo-300 mt-2">{triageResult.disclaimer}</p>

                {/* 추가 질문 (Follow-up) */}
                <div className="mt-3 pt-3 border-t border-indigo-200">
                  <p className="text-[10px] font-semibold text-indigo-500 uppercase mb-2"><T k="증상 추가 설명" /></p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={followUpInput}
                      onChange={(e) => setFollowUpInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && followUpInput.trim().length >= 2) handleFollowUp(); }}
                      placeholder={tt('추가 증상을 설명하세요...')}
                      className="min-w-0 flex-1 px-3 py-1.5 border border-indigo-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none bg-white"
                    />
                    <button onClick={handleFollowUp} disabled={followUpLoading || followUpInput.trim().length < 2}
                      className="shrink-0 px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-[10px] font-medium hover:bg-indigo-600 disabled:opacity-50 whitespace-nowrap">
                      {followUpLoading ? <T k="분석중..." /> : <T k="추가 분석" />}
                    </button>
                  </div>
                </div>

                {/* Follow-up 결과 */}
                {followUpResult && (
                  <div className="mt-2 bg-violet-50 border border-violet-200 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-violet-500 uppercase mb-1"><T k="추가 분석 결과" /></p>
                    {followUpResult.additional_analysis && (
                      <p className="text-xs text-gray-700 mb-2">{followUpResult.additional_analysis}</p>
                    )}
                    {(followUpResult.updated_recommendations ?? []).length > 0 && (
                      <div className="space-y-1">
                        {followUpResult.updated_recommendations!.map((rec) => (
                          <button key={rec.rank} onClick={() => { const dept = rec.department_full || rec.department; setValue('departmentName', dept.replace(/\(.+\)/, '').trim()); }}
                            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-violet-100 transition-colors flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${rec.rank === 1 ? 'bg-violet-600 text-white' : 'bg-violet-200 text-violet-700'}`}>{rec.rank}</span>
                              <span className="font-medium text-gray-900">{rec.department}</span>
                            </div>
                            <span className="text-[10px] font-bold text-violet-600">{Math.round(rec.confidence * 100)}<Unit>%</Unit></span>
                          </button>
                        ))}
                      </div>
                    )}
                    {followUpResult.disclaimer && <p className="text-[9px] text-violet-300 mt-1">{followUpResult.disclaimer}</p>}
                  </div>
                )}
              </div>
            )}

            {/* 자주 묻는 증상 */}
            <div className="mt-2 flex items-center gap-2">
              <button onClick={handleFetchCommonSymptoms} disabled={commonSymptomsLoading}
                className="text-[10px] px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
                {commonSymptomsLoading ? <T k="로딩..." /> : <T k="자주 묻는 증상" />}
              </button>
            </div>
            {commonSymptomsOpen && commonSymptoms.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {commonSymptoms.map((cs, i) => (
                  <button key={i} onClick={() => { setValue('reason', cs.symptom); setTriageResult(null); setFollowUpResult(null); }}
                    className="text-[11px] px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full hover:bg-indigo-100 transition-colors border border-indigo-100">
                    {cs.symptom}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        </div>
        <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3">
        <button onClick={handleSubmit(onSubmit)} disabled={checkInMutation.isPending} aria-keyshortcuts={ariaKeyshortcuts('mod+Enter')} data-walkin-submit
          className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {checkInMutation.isPending ? <T k="접수 중..." /> : <T k="접수 완료" />}
          {!checkInMutation.isPending && <kbd className="ml-2 text-[10px] font-semibold bg-white/20 rounded px-1.5 py-0.5">{comboLabel('mod+Enter')}</kbd>}
        </button>
        </div>
      </div>
      </div>

      {/* 리사이즈 바 */}
      <div onMouseDown={handleMouseDown}
        className="w-1.5 flex-shrink-0 cursor-col-resize group relative hover:bg-indigo-200 bg-gray-200 rounded-full mx-1 transition-colors">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-8 rounded-full bg-gray-300 group-hover:bg-indigo-400 flex items-center justify-center transition-colors">
          <svg className="w-2.5 h-2.5 text-gray-500 group-hover:text-white" fill="currentColor" viewBox="0 0 6 16"><circle cx="1" cy="3" r="1"/><circle cx="5" cy="3" r="1"/><circle cx="1" cy="8" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="1" cy="13" r="1"/><circle cx="5" cy="13" r="1"/></svg>
        </div>
      </div>

      {/* 우측: WeRU.B 접수 어시스턴트 */}
      <div style={{ width: `${100 - leftWidth}%`, height: '100%' }} className="pl-3">
        <AiReceptionChat key={aiKey} autoInput={aiAuto}
          onPatientFound={(p: Record<string, unknown>) => { const pt = p as unknown as PatientSearchItem; setSelectedPatient(pt); setValue('patientId', pt.id); }}
          onSymptomDetected={(s: string) => { if (s && s.trim()) setValue('reason', s.trim()); }}
          onDeptSuggested={(d: string) => { if (!selectedDept && d) setValue('departmentName', d); }}
          onNewPatient={(name: string) => { const nm = name.trim(); onNewPatient?.({ familyName: nm.length >= 2 ? nm[0] : nm, givenName: nm.length >= 2 ? nm.slice(1) : '', reason: reason || undefined }); }} />
      </div>
      {verifyTarget && <EligibilityVerifyModal target={verifyTarget} onClose={() => setVerifyTarget(null)} />}
    </div>
  );
}
