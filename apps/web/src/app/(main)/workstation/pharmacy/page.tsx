'use client';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';
import { kdate } from '@/lib/ui-settings';

import { useState, useMemo } from 'react';
import { Unit, DrugName } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import SmartSignButton from '@/components/signature/SmartSignButton';
import { AiSuggestionPanel } from '@/components/ai/AiSuggestionPanel';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { extractErrorMessage } from '@/lib/error-utils';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { usePatientNotifyConfirm, patientPushMessage } from '@/components/notification/PatientNotifyConfirm';
import { SecondCheckPicker, needsSecondCheck } from '@/components/pharmacy/SecondCheckPicker';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ── 타입 ── */
interface PatientRef { familyName?: string; givenName?: string; mrn?: string }
interface MedCodeRef { nameKo?: string; nameEn?: string | null; ingredient?: string | null; code?: string; controlSchedule?: string | null; highAlertFlag?: boolean | null }
interface PrescriptionRef {
  status?: string;
  dosage?: string; frequency?: string; route?: string; duration?: number; quantity?: number;
  priority?: string; dispensingType?: string;
  medicationCode?: MedCodeRef;
  encounter?: { id?: string; patient?: PatientRef };
  encounterId?: string;
}
interface WsOrder {
  orderId: string; status: string; priority?: string; procedureName?: string; procedureCode?: string;
  medicationName?: string; createdAt?: string; highAlert?: boolean;
  patient?: PatientRef; prescription?: PrescriptionRef;
  dispensingId?: string;
  /** 🔴 원외/원내 — 종전엔 이 큐가 `pharmacyType` 을 **필터도 응답 필드도** 갖지 않아
   *  원외 처방에 '조제' 버튼이 떴다(실측 대기 6건 중 4건이 EXTERNAL). */
  pharmacyType?: string;
  /** 처방이 취소됐는데 조제가 진행 중일 수 있다 — 이제 큐에 남으므로 화면이 사실을 말한다 */
  prescriptionStatus?: string;
  dischargeMed?: boolean;
}
interface DispenseDetail {
  id: string; orderId?: string; status: string; notes?: string;
  pharmacist?: { familyName?: string; givenName?: string };
  prescription?: PrescriptionRef;
  order?: { pharmacyType?: string; prescription?: PrescriptionRef };
  items?: { name?: string; medicationName?: string; quantity?: number; amount?: number; unit?: string }[];
}

/* ── 상수 ── */
// 🔴 label 은 표시 문자열이 아니라 **t() 키**다(유일 소비처가 `<T k=…>` — `@문맥` 은 ko 렌더에서 잘린다).
//    '접수'=nav Reception(창구)·'취소'=common Cancel(버튼)이 선점하므로 상태 어휘는 문맥 키로 가른다.
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '접수대기', cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수@상태', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '조제중',   cls: 'bg-amber-100 text-amber-700' },
  DISPENSED:   { label: '검수대기', cls: 'bg-emerald-100 text-emerald-700' },
  VERIFIED:    { label: '불출대기', cls: 'bg-violet-100 text-violet-700' },
  ISSUED:      { label: '불출완료', cls: 'bg-gray-200 text-gray-600' },
  COMPLETED:   { label: '완료',     cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:   { label: '취소@상태', cls: 'bg-red-100 text-red-700' },
};
const PRIORITY_CLS: Record<string, string> = { STAT: 'bg-red-600 text-white', URGENT: 'bg-orange-500 text-white', PRN: 'bg-violet-500 text-white' };
type FilterKey = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'DISPENSED' | 'VERIFIED' | 'COMPLETED';

export default function PharmacyWorkstationPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [scanResult, setScanResult] = useState<{ matched: boolean; message?: string; medicationCode?: MedCodeRef; isControlled?: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  // 🔴 2차 확인자 — 초기값은 **미선택**(쓰기 폼 규약). 자동으로 아무도 채우지 않는다.
  const [secondCheckBy, setSecondCheckBy] = useState('');

  /* ── 대기열 ── */
  const { data: queueRes, isLoading, isError, error, refetch: refetchQueue } = useQuery({
    queryKey: ['ws-pharmacy-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/pharmacy/queue'),
    refetchInterval: 8000,
  });
  const allOrders: WsOrder[] = useMemo(() => {
    const raw = queueRes?.data;
    return Array.isArray(raw) ? raw : [];
  }, [queueRes]);

  const counts = useMemo(() => ({
    ALL: allOrders.length,
    ORDERED: allOrders.filter(o => o.status === 'ORDERED').length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS').length,
    DISPENSED: allOrders.filter(o => o.status === 'DISPENSED').length,
    VERIFIED: allOrders.filter(o => o.status === 'VERIFIED').length,
    COMPLETED: allOrders.filter(o => o.status === 'COMPLETED' || o.status === 'ISSUED').length,
  }), [allOrders]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allOrders;
    if (filter === 'COMPLETED') return allOrders.filter(o => o.status === 'COMPLETED' || o.status === 'ISSUED');
    return allOrders.filter(o => o.status === filter);
  }, [allOrders, filter]);

  /* ── 상세 ── */
  const selectedOrder = allOrders.find(o => o.orderId === selectedId);
  const dispId = selectedOrder?.dispensingId;
  const { data: detailData } = useQuery({
    queryKey: ['pharmacy-detail', dispId],
    queryFn: () => apiClient.get<{ data: DispenseDetail }>(`/api/v1/pharmacy/dispense/${dispId}`),
    enabled: !!dispId,
  });
  const detail: DispenseDetail | null = detailData?.data
    ? ((detailData.data as { data?: DispenseDetail })?.data ?? detailData.data as DispenseDetail)
    : null;

  /**
   * 🔴 원외 판정은 **큐가 준 `pharmacyType`** 이 정본이다(v4.x 이전엔 응답에 없어서 판정 자체가 불가능했다).
   *    `prescription.dispensingType` 은 구형 응답 대비 보조 신호로만 본다.
   */
  const isExternal = (o: WsOrder) =>
    o.pharmacyType === 'EXTERNAL' || o.prescription?.dispensingType === 'EXTERNAL';
  /** 고위험약/마약류 — 서버 게이트와 같은 두 축(플래그 OR 마약류 등급)을 본다 */
  const isHighAlertRow = (o: WsOrder) =>
    !!o.highAlert || needsSecondCheck(o.prescription?.medicationCode);

  const selectedExternal = selectedOrder ? isExternal(selectedOrder) : false;
  const selectedMed = detail?.prescription?.medicationCode ?? selectedOrder?.prescription?.medicationCode;
  const selectedHighAlert = selectedOrder ? (isHighAlertRow(selectedOrder) || needsSecondCheck(selectedMed)) : false;
  const selectedHighAlertReason = [
    (selectedOrder?.highAlert || selectedMed?.highAlertFlag) ? 'ISMP 고위험 약물' : null,
    selectedMed?.controlSchedule ? `마약류/향정(${selectedMed.controlSchedule})` : null,
  ].filter(Boolean).join(' · ') || undefined;

  /* ── 뮤테이션 (워크스테이션 API) ── */
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['ws-pharmacy-queue'] }); qc.invalidateQueries({ queryKey: ['pharmacy-detail'] }); };
  // 접수는 워크스테이션 공통(ORDERED→RECEIVED). 조제/완료는 약국 도메인(SoT): startDispensing(Dispensing 생성·DUR게이트)·completeDispensing(재고 outbox·청구 이벤트).
  const receive  = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`), onSuccess: () => { invalidate(); toast.success('접수 완료'); }, onError: () => toast.error('접수 실패') });
  const start    = useMutation({ mutationFn: (orderId: string) => apiClient.post(`/api/v1/pharmacy/dispense/${orderId}`), onSuccess: () => { invalidate(); toast.success('조제 시작'); }, onError: (e) => toast.error((e as { message?: string })?.message || '조제 시작 실패') });
  // 🔴 고위험약/마약류 2차 확인자 — 종전엔 `complete` 를 **body 없이** 불러 `secondCheckBy` 가
  //    항상 undefined 였다(게이트 기본 BLOCK → 고위험약 조제는 영원히 409).
  //    필드명은 서버 DTO `CompleteDispensingDto.secondCheckBy` 와 명시 대조(스프레드 금지).
  const complete = useMutation({
    mutationFn: ({ dispensingId, secondCheckBy: sc }: { dispensingId: string; secondCheckBy?: string }) =>
      apiClient.patch(`/api/v1/pharmacy/dispense/${dispensingId}/complete`, sc ? { secondCheckBy: sc } : {}),
    onSuccess: () => { invalidate(); setSecondCheckBy(''); toast.success('조제 완료'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '조제 완료 실패'),
  });

  /* ── 약국 전용 뮤테이션 ── */
  // 🔴 조제 완료 알림은 대외 발신이다 — 명시 승인이 있어야 나간다(입원 조제는 병동 인계라 미해당)
  const notify = usePatientNotifyConfirm('검수 완료');
  const verifyMut = useMutation({
    mutationFn: ({ id, notifyPatient }: { id: string; notifyPatient: boolean }) =>
      apiClient.patch<{ data: { patientPush?: { sent?: boolean; reason?: string; pushChannel?: string | null } } }>(`/api/v1/pharmacy/dispense/${id}/verify`, { notifyPatient }),
    onSuccess: (res) => {
      invalidate();
      toast.success('검수 완료 — 불출 가능');
      const msg = patientPushMessage(res?.data?.patientPush);
      if (msg) toast.info(msg);
    },
    onError: () => toast.error('검수 실패'),
  });
  const verifyWithConsent = async (id: string) => {
    const yes = await notify.ask();
    if (yes === null) return;
    verifyMut.mutate({ id, notifyPatient: yes });
  };
  // 불출(교부) — 검수 완료 건의 실물 전달 확인. 수령자(환자/보호자/병동 인수자) 기록
  const issueMut = useMutation({
    mutationFn: ({ id, issuedTo }: { id: string; issuedTo?: string }) => apiClient.patch(`/api/v1/pharmacy/dispense/${id}/issue`, { issuedTo }),
    onSuccess: () => { invalidate(); toast.success('불출 완료'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '불출 실패'),
  });
  const handleIssue = (id: string) => {
    const issuedTo = window.prompt('수령 확인 — 수령자를 입력하세요 (외래: 환자/보호자명, 입원: 병동/인수자)');
    if (issuedTo === null) return; // 취소
    issueMut.mutate({ id, issuedTo: issuedTo.trim() || undefined });
  };
  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.patch(`/api/v1/pharmacy/dispense/${id}/cancel`, { reason }),
    onSuccess: () => { invalidate(); setShowCancel(false); setCancelReason(''); toast.success('조제 취소'); },
    onError: () => toast.error('취소 실패'),
  });

  /* ── 바코드 스캔 ── */
  const handleScan = async () => {
    if (!barcode.trim() || !dispId) return;
    setScanning(true);
    try {
      const res = await apiClient.post<{ data: typeof scanResult }>('/api/v1/pharmacy/scan', { barcode: barcode.trim(), dispensingId: dispId });
      setScanResult(res.data);
      if (res.data?.matched) setBarcode('');
    } catch { setScanResult({ matched: false, message: '스캔 처리 실패' }); }
    setScanning(false);
  };

  /* ── 통계 카드 ── */
  const stats = [
    { label: '접수대기', count: counts.ORDERED, cls: 'text-gray-600 bg-gray-50' },
    { label: '조제중', count: counts.IN_PROGRESS, cls: 'text-amber-700 bg-amber-50' },
    { label: '검수대기', count: counts.DISPENSED, cls: 'text-emerald-700 bg-emerald-50' },
    { label: '불출대기', count: counts.VERIFIED, cls: 'text-violet-700 bg-violet-50' },
  ];

  const patient = (o: WsOrder) => o.patient ?? o.prescription?.encounter?.patient;
  const drugName = (o: WsOrder) => o.medicationName ?? o.prescription?.medicationCode?.nameKo ?? o.procedureName ?? o.procedureCode ?? '-';
  const priority = (o: WsOrder) => o.priority ?? o.prescription?.priority ?? 'ROUTINE';

  return (
    <div className="space-y-5">
      {/* 🔴 승인 다이얼로그 — 렌더하지 않으면 물어보지 못하고, 물어보지 못하면 알림은 영원히 안 나간다 */}
      {notify.dialog}
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="약국 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="접수 → 조제 → 검수 → 불출" /></p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/pharmacy" className="px-3 py-1.5 text-xs font-medium bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100"><T k="약국 메인" /></a>
          <a href="/pharmacy/admin" className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="재고/ADR" /></a>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`rounded-xl p-3 ${s.cls}`}>
            <p className="text-[10px] font-medium opacity-70"><T k={s.label} /></p>
            <p className="text-2xl font-bold">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 워크플로우 단계 */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium"><T k="접수@오더" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium"><T k="조제" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="검수" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 font-medium"><T k="불출" /></span>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1.5">
        {([
          { key: 'ALL' as FilterKey, label: '전체' },
          { key: 'ORDERED' as FilterKey, label: '접수대기' },
          { key: 'IN_PROGRESS' as FilterKey, label: '조제중' },
          { key: 'DISPENSED' as FilterKey, label: '검수대기' },
          { key: 'VERIFIED' as FilterKey, label: '불출대기' },
          { key: 'COMPLETED' as FilterKey, label: '완료' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <T k={f.label} />
            {counts[f.key] > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* 대기열 테이블 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="약품" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="용법" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[55px]"><T k="시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[130px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : isError ? (
                <tr><td colSpan={7}><QueryErrorFallback error={error} onRetry={refetchQueue} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm"><T k="대기 중인 처방이 없습니다" /></td></tr>
              ) : filtered.map((o) => {
                const p = patient(o);
                const pri = priority(o);
                const isSelected = selectedId === o.orderId;
                return (
                  <tr key={o.orderId} onClick={() => setSelectedId(o.orderId)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-teal-50' : 'hover:bg-gray-50/50'} ${pri === 'STAT' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      {pri !== 'ROUTINE' && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${PRIORITY_CLS[pri] ?? ''}`}>{pri}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_MAP[o.status]?.cls ?? 'bg-gray-100'}`}>
                        <T k={STATUS_MAP[o.status]?.label ?? o.status} />
                      </span>
                      {/* 🔴 원외인지·처방이 취소됐는지는 상태 배지만으로는 알 수 없다 — 따로 말한다 */}
                      {isExternal(o) && (
                        <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 whitespace-nowrap"><T k="원외" /></span>
                      )}
                      {o.prescriptionStatus === 'CANCELLED' && (
                        <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap" title="처방이 취소됐지만 조제가 이미 시작돼 목록에 남아 있습니다"><T k="처방취소" /></span>
                      )}
                      {o.prescriptionStatus === 'DISCONTINUED' && (
                        <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap" data-rx-discontinued><T k="처방중단" /></span>
                      )}
                      {o.dischargeMed && (
                        <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 whitespace-nowrap" data-rx-discharge><T k="퇴원약" /></span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{p?.familyName}{p?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{p?.mrn}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-800 truncate max-w-[200px]">
                        {(o.highAlert || o.prescription?.medicationCode?.controlSchedule) && (
                          <span className="mr-1.5 inline-block text-[9px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded align-middle" title="ISMP 고위험 약물 — 조제·감사 주의">⛔고위험</span>
                        )}
                        {drugName(o)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {o.prescription?.dosage ?? ''} {o.prescription?.frequency ?? ''}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {o.createdAt ?kdate(o.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {o.status === 'ORDERED' && <button onClick={() => receive.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@오더" /></button>}
                        {/* 🔴 원외 처방은 원내 조제 대상이 아니다 — 버튼을 주지 않고 무엇인지 말한다
                            (숨기지 않는다: 원외 건에도 처방전 교부라는 할 일이 있다) */}
                        {o.status === 'RECEIVED' && (isExternal(o)
                          ? <span className="px-2 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-700 rounded whitespace-nowrap"><T k="원외 · 처방전 교부" /></span>
                          : <button onClick={() => start.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="조제" /></button>)}
                        {/* 고위험약/마약류는 2차 확인자가 필요하다 — 목록엔 고를 자리가 없으므로 상세로 보낸다 */}
                        {o.status === 'IN_PROGRESS' && o.dispensingId && (isHighAlertRow(o)
                          ? <button onClick={() => setSelectedId(o.orderId)} title="고위험약/마약류 — 2차 확인자를 지정해야 완료할 수 있습니다" className="px-2.5 py-1 text-[10px] font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">2인확인 후 완료</button>
                          : <button onClick={() => complete.mutate({ dispensingId: o.dispensingId! })} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>)}
                        {o.status === 'DISPENSED' && o.dispensingId && (
                          <SmartSignButton documentType="DISPENSING" documentId={o.dispensingId} documentTitle="조제 검수"
                            onSign={() => void verifyWithConsent(o.dispensingId!)} variant="small" label="검수" />
                        )}
                        {o.status === 'VERIFIED' && o.dispensingId && (
                          <button onClick={() => handleIssue(o.dispensingId!)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="불출" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 상세 패널 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedId ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p className="text-sm text-gray-400"><T k="처방을 선택하세요" /></p>
            </div>
          ) : !selectedOrder ? (
            <div className="text-center py-6"><p className="text-xs text-gray-400"><T k="주문을 찾을 수 없습니다" /></p></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="처방 상세" /></h3>
                <button onClick={() => { setSelectedId(null); setScanResult(null); setShowCancel(false); }} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* 환자 정보 */}
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-blue-600 font-medium"><T k="환자" /></p>
                <p className="text-sm font-bold text-gray-900">{patient(selectedOrder)?.familyName}{patient(selectedOrder)?.givenName}</p>
                <p className="text-[10px] text-gray-500">MRN: {patient(selectedOrder)?.mrn}</p>
              </div>

              {/* 약물 정보 */}
              <div className="bg-teal-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs text-teal-600 font-medium"><T k="처방 약물" /></p>
                <p className="text-sm font-bold text-gray-900">{drugName(selectedOrder)}</p>
                <p className="text-[10px] text-gray-500 font-mono">{selectedOrder.prescription?.medicationCode?.code ?? ''}</p>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div><span className="text-gray-400"><T k="용량" />:</span> <span className="font-medium">{selectedOrder.prescription?.dosage ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="투여" />:</span> <span className="font-medium">{selectedOrder.prescription?.route ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="횟수@용법" />:</span> <span className="font-medium">{selectedOrder.prescription?.frequency ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="일수" />:</span> <span className="font-medium">{selectedOrder.prescription?.duration ?? '-'}<Unit>일</Unit></span></div>
                  <div><span className="text-gray-400"><T k="총량" />:</span> <span className="font-medium">{selectedOrder.prescription?.quantity ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="구분" />:</span> <span className="font-medium"><T k={selectedOrder.prescription?.dispensingType === 'EXTERNAL' ? '원외' : '원내'} /></span></div>
                </div>
              </div>

              {/* 조제 상세 (pharmacy API) */}
              {detail && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 font-medium"><T k="조제 상태" /></p>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_MAP[detail.status]?.cls ?? 'bg-gray-100'}`}>
                      <T k={STATUS_MAP[detail.status]?.label ?? detail.status} />
                    </span>
                  </div>
                  {detail.pharmacist && (
                    <p className="text-[10px] text-gray-400"><T k="조제자" />: {detail.pharmacist.familyName}{detail.pharmacist.givenName}</p>
                  )}
                  {detail.notes && (
                    <p className="text-[10px] text-gray-500 bg-white p-2 rounded-lg">{detail.notes}</p>
                  )}
                  {detail.items && detail.items.length > 0 && (
                    <div className="space-y-1 mt-2">
                      <p className="text-[10px] text-gray-500 font-medium"><T k="조제 품목" /></p>
                      {detail.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-xs p-2 bg-white rounded-lg">
                          <span className="text-gray-800">{item.name ?? item.medicationName ?? '약물'}</span>
                          <span className="text-gray-500">{item.quantity ?? item.amount ?? ''} {item.unit ?? ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 바코드 스캔 (조제 중) */}
              {selectedOrder.status === 'IN_PROGRESS' && dispId && (
                <div className="bg-indigo-50 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-indigo-700"><T k="바코드 스캔" /></p>
                  <div className="flex gap-1.5">
                    <input value={barcode} onChange={e => setBarcode(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
                      placeholder={tAttr('바코드를 스캔하세요')}
                      className="flex-1 px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300 focus:outline-none"
                      autoFocus />
                    <button onClick={handleScan} disabled={scanning || !barcode.trim()}
                      className="px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                      {scanning ? '...' : <T k="확인" />}
                    </button>
                  </div>
                  {scanResult && (
                    <div className={`p-2 rounded-lg text-xs ${scanResult.matched ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
                      {scanResult.matched ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-600 font-bold">✓</span>
                          <span className="font-medium"><DrugName nameKo={scanResult.medicationCode?.nameKo} nameEn={scanResult.medicationCode?.nameEn} ingredient={scanResult.medicationCode?.ingredient} /></span>
                          <span className="text-emerald-500">일치</span>
                          {scanResult.isControlled && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[9px] font-bold ml-auto whitespace-nowrap">마약류 {scanResult.medicationCode?.controlSchedule}급</span>}
                        </div>
                      ) : <span>{scanResult.message}</span>}
                    </div>
                  )}
                  {scanResult?.isControlled && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                      <p className="text-[10px] text-red-700 font-semibold">⚠ 마약류 — 이중 확인 필요</p>
                    </div>
                  )}
                </div>
              )}

              {/* WeRU.B 약물 안전 검증 */}
              <AiDrugSafetyPanel drugName={selectedOrder.prescription?.medicationCode?.nameKo ?? selectedOrder.medicationName ?? ''} />

              {/* WeRU.B 처방 검토 + 복약지도 */}
              {dispId && <PharmacyAiPanel orderId={selectedOrder.orderId} />}

              {/* 🔴 원외 처방 — 원내 조제 대상이 아님을 그 자리에서 말한다 */}
              {selectedExternal && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <p className="text-xs font-semibold text-violet-800"><T k="원외 처방 — 원내 조제 대상이 아닙니다" /></p>
                  <p className="text-[11px] text-violet-700 mt-1">
                    환자가 처방전을 들고 원외 약국에서 조제받는 건입니다. 원내 조제가 필요하면
                    처방의가 처방을 원내로 다시 내야 합니다.
                  </p>
                </div>
              )}

              {/* 처방이 중단됨(2026-09-30) — 접수 이후라 남은 건. 이미 조제된 분량은 유효, 이후 분량은 멈춘다 */}
              {selectedOrder.prescriptionStatus === 'DISCONTINUED' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800"><T k="처방이 중단되었습니다" /></p>
                  <p className="text-[11px] text-amber-700 mt-1"><T k="의사가 이 처방을 중단했습니다 — 이미 조제·불출된 분량은 유효합니다. 아직 조제하지 않았다면 처방의에게 확인 후 진행하세요." /></p>
                </div>
              )}
              {/* 🔴 처방이 취소됐는데 조제가 진행 중 — 종전엔 큐에서 통지 없이 사라지던 건이다 */}
              {selectedOrder.prescriptionStatus === 'CANCELLED' && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-800"><T k="처방이 취소되었습니다" /></p>
                  <p className="text-[11px] text-red-700 mt-1">
                    조제가 이미 시작된 건이라 목록에 남아 있습니다. 조제 중이면 취소 처리하고,
                    이미 조제된 약은 원내 절차에 따라 반품·폐기하세요.
                  </p>
                </div>
              )}

              {/* 고위험약/마약류 2차 확인자 — 대상이 아니면 렌더되지 않는다 */}
              <SecondCheckPicker
                required={selectedOrder.status === 'IN_PROGRESS' && !!dispId && selectedHighAlert}
                value={secondCheckBy}
                onChange={setSecondCheckBy}
                reason={selectedHighAlertReason}
                compact
              />

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selectedOrder.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@오더" /></button>
                )}
                {selectedOrder.status === 'RECEIVED' && !selectedExternal && (
                  <button onClick={() => start.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="조제 시작" /></button>
                )}
                {/* 완료는 dispensingId 대상 — orderId를 넘겨 404가 나던 버그 수정 */}
                {selectedOrder.status === 'IN_PROGRESS' && dispId && (
                  <button onClick={() => complete.mutate({ dispensingId: dispId, secondCheckBy: secondCheckBy || undefined })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="조제 완료" /></button>
                )}
                {selectedOrder.status === 'DISPENSED' && dispId && (
                  <SmartSignButton documentType="DISPENSING" documentId={dispId} documentTitle="조제 검수"
                    onSign={() => void verifyWithConsent(dispId)} variant="small" label="검수 확인" />
                )}
                {selectedOrder.status === 'VERIFIED' && dispId && (
                  <button onClick={() => handleIssue(dispId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="불출 (수령 확인)" /></button>
                )}
                {(selectedOrder.status === 'IN_PROGRESS' || selectedOrder.status === 'ORDERED' || selectedOrder.status === 'RECEIVED') && dispId && (
                  <button onClick={() => setShowCancel(true)} className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600"><T k="취소" /></button>
                )}
              </div>

              {/* 취소 사유 */}
              {showCancel && dispId && (
                <div className="bg-red-50 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-medium text-red-700"><T k="취소 사유" /></p>
                  <ReasonInput domain="prescriptionCancel" required value={cancelReason} onChange={setCancelReason}
                    className="w-full px-3 py-1.5 border border-red-200 rounded-lg text-xs" placeholder="취소 사유를 입력하세요" />
                  <div className="flex gap-2">
                    <button onClick={() => { if (reasonFilled(cancelReason)) cancelMut.mutate({ id: dispId, reason: cancelReason.trim() }); }}
                      disabled={!reasonFilled(cancelReason)}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"><T k="취소 확인" /></button>
                    <button onClick={() => { setShowCancel(false); setCancelReason(''); }}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="돌아가기" /></button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── WeRU.B 약물 안전 검증 패널 ── */
interface DrugSafetyResult { error?: string; risk_level?: string; adverse_events?: { event?: string; drug?: string }[]; recommendations?: string[] }

function AiDrugSafetyPanel({ drugName }: { drugName: string }) {
  const [result, setResult] = useState<DrugSafetyResult | null>(null);
  const [loading, setLoading] = useState(false);

  if (!drugName) return null;

  const check = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post<{ data: DrugSafetyResult }>('/api/v1/ai/predict/adverse-drug', { drugs: [drugName] });
      setResult(res?.data ?? null);
    } catch { setResult({ error: `${AI_ORIGIN_TEXT} 검증 실패` }); }
    setLoading(false);
  };

  return (
    <div>
      <button onClick={check} disabled={loading}
        className="w-full px-3 py-2 bg-amber-50 text-amber-700 rounded-xl text-[11px] font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors">
        {loading ? `${AI_ORIGIN_TEXT} 약물 안전 검증 중...` : `${AI_ORIGIN_TEXT} 약물 부작용 예측`}
      </button>
      {result && !result.error && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-1">
          <p className="text-[10px] font-semibold text-amber-700">{AI_ORIGIN_TEXT} 부작용 예측 결과</p>
          {typeof result.risk_level === 'string' && (
            <p className="text-xs">
              위험도: <span className={`font-bold ${result.risk_level === 'HIGH' ? 'text-red-600' : result.risk_level === 'MODERATE' ? 'text-amber-600' : 'text-green-600'}`}>
                {result.risk_level === 'HIGH' ? '고위험' : result.risk_level === 'MODERATE' ? '주의' : '저위험' as string}
              </span>
            </p>
          )}
          {Array.isArray(result.adverse_events) && result.adverse_events.length > 0 && (
            <div className="text-[10px] text-amber-900 space-y-0.5">
              {result.adverse_events.slice(0, 5).map((e, i) => (
                <p key={i}>- {e.event ?? e.drug ?? '-'}</p>
              ))}
            </div>
          )}
          <p className="text-[11px] text-amber-500">{AI_ORIGIN_TEXT} 참고용 — 최종 판단은 약사에게 있습니다</p>
        </div>
      )}
    </div>
  );
}

/* ── WeRU.B 처방 검토 + 복약지도 패널 ── */
function PharmacyAiPanel({ orderId }: { orderId: string }) {
  const { data: reviewData, isLoading: reviewLoading, isError: reviewIsError, error: reviewError } = useQuery({
    queryKey: ['ai-pharmacy-review', orderId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/pharmacy/orders/${orderId}/ai-review`),
    staleTime: 5 * 60 * 1000,
  });
  const { data: guidanceData, isLoading: guidanceLoading, isError: guidanceIsError, error: guidanceError } = useQuery({
    queryKey: ['ai-pharmacy-guidance', orderId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/pharmacy/orders/${orderId}/ai-guidance`),
    staleTime: 5 * 60 * 1000,
  });

  const review = (reviewData?.data as { data?: Record<string, unknown> })?.data ?? reviewData?.data;
  const guidance = (guidanceData?.data as { data?: Record<string, unknown> })?.data ?? guidanceData?.data;

  // 🔴 조회 실패를 `null`(= 제안 없음)로 접지 않는다 — AiSuggestionPanel 의 error 상태로 넘긴다
  return (
    <div className="space-y-2">
      <AiSuggestionPanel title="처방 자동 검토" data={review} source={(review as Record<string, unknown>)?.source as string} isLoading={reviewLoading} error={reviewIsError ? extractErrorMessage(reviewError) : undefined} compact />
      <AiSuggestionPanel title="복약지도 초안" data={guidance} source={(guidance as Record<string, unknown>)?.source as string} isLoading={guidanceLoading} error={guidanceIsError ? extractErrorMessage(guidanceError) : undefined} compact />
    </div>
  );
}
