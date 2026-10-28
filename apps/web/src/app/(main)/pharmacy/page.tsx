'use client';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';
import { kdate } from '@/lib/ui-settings';

import { useState } from 'react';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { Unit, DrugName } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pharmacyStageOf } from '@/lib/widget-summaries';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import SmartSignButton from '@/components/signature/SmartSignButton';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import StatusBadge from '@/components/ui/StatusBadge';
import { AiSuggestionPanel } from '@/components/ai/AiSuggestionPanel';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { usePatientNotifyConfirm, patientPushMessage } from '@/components/notification/PatientNotifyConfirm';
import { SecondCheckPicker, needsSecondCheck } from '@/components/pharmacy/SecondCheckPicker';

interface PharmacyPatientRef {
  familyName?: string;
  givenName?: string;
  mrn?: string;
}

interface MedicationCodeRef {
  nameKo?: string;
  nameEn?: string | null;
  ingredient?: string | null;
  code?: string;
  highAlertFlag?: boolean;
  /** 마약류/향정 등급 — 고위험 플래그와 **별개로** 2인확인 대상이다(서버 게이트와 같은 판정) */
  controlSchedule?: string | null;
}

interface PharmacyPrescription {
  status?: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  duration?: number;
  quantity?: number;
  priority?: string;
  dispensingType?: string;
  procedureCode?: Record<string, unknown>;
  medicationCode?: MedicationCodeRef;
  encounter?: { id?: string; patient?: PharmacyPatientRef };
  encounterId?: string;
}

interface PharmacyOrder {
  id: string;
  dispensingId?: string;
  dispensing?: { id: string; status?: string };
  status: string;
  priority?: string;
  createdAt?: string;
  prescription?: PharmacyPrescription;
}

interface PharmacyDispenseItem {
  // 서버 정본 필드(dispensing.items include medicationCode) — name/quantity 류는 과거 오키(항상 undefined)
  medicationCode?: { nameKo?: string; code?: string };
  prescribedQty?: number;
  dispensedQty?: number;
  name?: string;
  medicationName?: string;
  quantity?: number;
  amount?: number;
  unit?: string;
}

interface PharmacyDispenseDetail {
  id: string;
  orderId?: string;
  status: string;
  notes?: string;
  pharmacist?: { familyName?: string; givenName?: string };
  prescription?: PharmacyPrescription;
  /** 원외 여부·처방 상태의 정본 — 화면 모드가 아니라 이 응답이 판정한다 */
  order?: { pharmacyType?: string; prescription?: PharmacyPrescription };
  items?: PharmacyDispenseItem[];
}

// 상태 라벨/색 — shared PHARMACY_ORDER_STATUS_LABEL + StatusBadge(domain='pharmacyOrder')로 일원화(UX P1 마이그레이션)
const PRIORITY_BADGE: Record<string, string> = { STAT: 'bg-red-600 text-white', URGENT: 'bg-orange-500 text-white', PRN: 'bg-violet-500 text-white', ROUTINE: '' };

type FilterStatus = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'DISPENSED' | 'VERIFIED';

export default function PharmacyPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const tAttr = useTAttr();
  const [pharmacyMode, setPharmacyMode] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  // 보드·관제에서 특정 단계로 바로 오게 한다(?status=DISPENSED 등).
  // 🔴 숫자만 보여주고 그 목록으로 가는 길이 없으면 조치가 끊긴다(워크리스트 딥링크 규약).
  const initialStatus = ((): FilterStatus => {
    if (typeof window === 'undefined') return 'ALL';
    const q = new URLSearchParams(window.location.search).get('status');
    return q === 'ORDERED' || q === 'IN_PROGRESS' || q === 'DISPENSED' || q === 'VERIFIED' ? q : 'ALL';
  })();
  const [filter, setFilter] = useState<FilterStatus>(initialStatus);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pharmacy-queue', pharmacyMode],
    queryFn: () => apiClient.get<{ data: PharmacyOrder[] | { data: PharmacyOrder[] } }>(`/api/v1/pharmacy/queue?pharmacyType=${pharmacyMode}`),
    refetchInterval: 8000,
  });

  const { data: detailData } = useQuery({
    queryKey: ['pharmacy-detail', selectedId],
    queryFn: () => apiClient.get<{ data: PharmacyDispenseDetail | { data: PharmacyDispenseDetail } }>(`/api/v1/pharmacy/dispense/${selectedId}`),
    enabled: !!selectedId,
  });

  const dispenseMut = useMutation({
    mutationFn: (vars: { orderId: string; durOverrideReason?: string }) =>
      apiClient.post(`/api/v1/pharmacy/dispense/${vars.orderId}`, vars.durOverrideReason ? { durOverrideReason: vars.durOverrideReason } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-queue'] }); toast.success('조제를 시작합니다.'); },
    onError: (e: unknown, vars) => {
      const msg = (e as { message?: string })?.message ?? '';
      // DUR 강제 게이트 차단 → 오버라이드 사유 입력 후 재시도
      if (/DUR/.test(msg) && !vars.durOverrideReason) {
        const reason = window.prompt('DUR 경고가 확인되지 않았습니다. 경고를 검토했다면 조제 진행 사유(오버라이드)를 입력하세요:');
        if (reason?.trim()) { dispenseMut.mutate({ orderId: vars.orderId, durOverrideReason: reason.trim() }); return; }
      }
      toast.error(msg || '조제 시작 실패');
    },
  });

  // 🔴 고위험약/마약류 2차 확인자 — 종전엔 이 화면이 `complete` 를 **body 없이** 불러
  //    `secondCheckBy` 가 항상 undefined 였다(게이트 기본 BLOCK → 고위험약은 영원히 완료 불가).
  //    초기값은 미선택. 값은 서버 DTO 필드명 `secondCheckBy` 로 **명시 전송**한다
  //    (스프레드 payload 를 쓰면 whitelist 가 조용히 지운다).
  const [secondCheckBy, setSecondCheckBy] = useState('');
  const completeMut = useMutation({
    mutationFn: ({ id, secondCheckBy: sc }: { id: string; secondCheckBy?: string }) =>
      apiClient.patch(`/api/v1/pharmacy/dispense/${id}/complete`, sc ? { secondCheckBy: sc } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-queue'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-detail'] });
      setSecondCheckBy('');
      toast.success('조제가 완료되었습니다.');
    },
    // 🔴 종전은 `() => toast.error('조제 완료 실패')` — 서버가 보낸 **이유를 버렸다.**
    //    2인확인이 필요하다는 사실도, DUR 도, 무엇 때문인지 약사가 알 방법이 없었다.
    onError: (e) => toast.error((e as { message?: string })?.message || '조제 완료 실패'),
  });

  // 🔴 조제 완료 알림은 대외 발신이다 — 명시 승인이 있어야 나간다(입원 조제는 병동 인계라 미해당)
  const notify = usePatientNotifyConfirm('검수 완료');
  const verifyMut = useMutation({
    mutationFn: ({ id, notifyPatient }: { id: string; notifyPatient: boolean }) =>
      apiClient.patch<{ data: { patientPush?: { sent?: boolean; reason?: string; pushChannel?: string | null } } }>(`/api/v1/pharmacy/dispense/${id}/verify`, { notifyPatient }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['pharmacy-queue'] }); qc.invalidateQueries({ queryKey: ['pharmacy-detail'] });
      toast.success('검수가 완료되었습니다. 불출 가능.');
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

  // 불출(교부) — 검수 완료 건의 실물 전달 확인(수령자 기록)
  const issueMut = useMutation({
    mutationFn: ({ id, issuedTo }: { id: string; issuedTo?: string }) => apiClient.patch(`/api/v1/pharmacy/dispense/${id}/issue`, { issuedTo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-queue'] }); qc.invalidateQueries({ queryKey: ['pharmacy-detail'] }); toast.success('불출이 완료되었습니다.'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '불출 실패'),
  });
  const handleIssue = (id: string) => {
    const issuedTo = window.prompt('수령 확인 — 수령자를 입력하세요 (외래: 환자/보호자명, 입원: 병동/인수자)');
    if (issuedTo === null) return;
    issueMut.mutate({ id, issuedTo: issuedTo.trim() || undefined });
  };

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.patch(`/api/v1/pharmacy/dispense/${id}/cancel`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-queue'] }); setShowCancel(false); setCancelReason(''); toast.success('조제가 취소되었습니다.'); },
    onError: () => toast.error('취소 실패'),
  });

  const _raw = data?.data;
  const allOrders: PharmacyOrder[] = Array.isArray(_raw) ? _raw : (_raw as { data: PharmacyOrder[] })?.data ?? [];
  // 🔴 검수 대기는 **조제 상태**로 판정한다 — 조제가 끝나면 오더는 COMPLETED 라
  //    `o.status === 'DISPENSED'` 로는 한 건도 안 잡힌다(탭이 영원히 0이던 원인).
  //    판정 정본은 `pharmacyStageOf`(lib/widget-summaries) — 대시보드 약사 패널도 같은 함수를 쓴다(2026-10-02).
  const isVerifyWait = (o: PharmacyOrder) => pharmacyStageOf(o) === 'VERIFY_WAIT';
  // 불출 대기도 조제 상태로 판정한다(검수 확인 후에도 오더는 COMPLETED 그대로).
  // 종전엔 검수 확인 즉시 행이 사라져 불출(수령 확인) 버튼에 도달할 수 없었다.
  const isIssueWait = (o: PharmacyOrder) => pharmacyStageOf(o) === 'ISSUE_WAIT';
  const filtered = filter === 'ALL' ? allOrders
    : filter === 'DISPENSED' ? allOrders.filter(isVerifyWait)
    : filter === 'VERIFIED' ? allOrders.filter(isIssueWait)
    : allOrders.filter(o => o.status === filter && !isVerifyWait(o) && !isIssueWait(o));

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const counts = {
    ALL: allOrders.length,
    ORDERED: allOrders.filter(o => o.status === 'ORDERED').length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS').length,
    DISPENSED: allOrders.filter(isVerifyWait).length,
    VERIFIED: allOrders.filter(isIssueWait).length,
  };

  const detail: PharmacyDispenseDetail | null = detailData?.data
    ? ((detailData.data as { data: PharmacyDispenseDetail })?.data ?? detailData.data) as PharmacyDispenseDetail
    : null;

  // 🔴 판정은 **응답이 말하는 것**으로 한다 — 화면 모드(`pharmacyMode`)는 사용자가 보고 있는
  //    탭일 뿐, 이 건이 원외인지는 오더가 안다(모드로 판정하면 딥링크·필터에서 어긋난다).
  const detailMed = detail?.prescription?.medicationCode ?? detail?.order?.prescription?.medicationCode;
  const isExternalDetail =
    detail?.order?.pharmacyType === 'EXTERNAL' || detail?.prescription?.dispensingType === 'EXTERNAL';
  const detailRxCancelled =
    (detail?.prescription?.status ?? detail?.order?.prescription?.status) === 'CANCELLED';
  const detailHighAlert = needsSecondCheck(detailMed);
  const detailHighAlertReason = detailMed
    ? [detailMed.highAlertFlag ? 'ISMP 고위험 약물' : null, detailMed.controlSchedule ? `마약류/향정(${detailMed.controlSchedule})` : null]
        .filter(Boolean).join(' · ')
    : undefined;

  return (
    <div>
      {/* 🔴 승인 다이얼로그 — 렌더하지 않으면 물어보지 못하고, 물어보지 못하면 알림은 영원히 안 나간다 */}
      {notify.dialog}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="약국 조제" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="처방 접수 → 조제 → 검수 → 불출" /></p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/pharmacy/admin" className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="재고/ADR 관리" /></a>
          <span className="text-xs text-gray-400"><T k="자동 새로고침 8초" /></span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>
      </div>

      {/* 원내/원외 탭 */}
      <div className="flex gap-2 mb-5">
        <button onClick={() => { setPharmacyMode('INTERNAL'); setSelectedId(null); setFilter('ALL'); }}
          className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${pharmacyMode === 'INTERNAL' ? 'bg-teal-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
          💊 <T k="원내 조제" />
        </button>
        <button onClick={() => { setPharmacyMode('EXTERNAL'); setSelectedId(null); setFilter('ALL'); }}
          className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${pharmacyMode === 'EXTERNAL' ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
          📋 <T k="원외 처방전" />
        </button>
      </div>

      {/* 워크플로우 단계 표시 (원내만) */}
      {pharmacyMode === 'INTERNAL' && (
      <div className="flex items-center gap-1 mb-5 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium"><T k="접수@상태" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium"><T k="조제" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="검수" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 font-medium"><T k="불출" /></span>
      </div>
      )}

      {/* 원외 처방전 안내 */}
      {pharmacyMode === 'EXTERNAL' && (
      <div className="flex items-center gap-1 mb-5 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 font-medium"><T k="처방전 발행" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 font-medium"><T k="출력/전송" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 font-medium"><T k="완료" /></span>
      </div>
      )}

      {/* 필터 탭 */}
      <div className="flex gap-1.5 mb-4">
        {([
          { key: 'ALL' as FilterStatus, label: '전체', count: counts.ALL },
          { key: 'ORDERED' as FilterStatus, label: '접수 대기', count: counts.ORDERED },
          { key: 'IN_PROGRESS' as FilterStatus, label: '조제 중', count: counts.IN_PROGRESS },
          { key: 'DISPENSED' as FilterStatus, label: '검수 대기', count: counts.DISPENSED },
          { key: 'VERIFIED' as FilterStatus, label: '불출 대기', count: counts.VERIFIED },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <T k={f.label} />
            {f.count > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{f.count}</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* 대기열 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="우선순위" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="약품" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="용법" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="시간@시각" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[120px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm"><T k="대기 중인 처방이 없습니다" /></td></tr>
              ) : filtered.map((order: PharmacyOrder) => {
                const patient = order.prescription?.encounter?.patient;
                const drug = order.prescription?.medicationCode;
                const priority = order.prescription?.priority ?? order.priority ?? 'ROUTINE';
                const isSelected = selectedId === (order.dispensing?.id ?? order.dispensingId ?? order.id);
                return (
                  <tr key={order.id} onClick={() => setSelectedId(order.dispensing?.id ?? order.dispensingId ?? order.id)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-teal-50' : 'hover:bg-gray-50/50'}`}>
                    <td className="px-4 py-3">
                      {priority !== 'ROUTINE' && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_BADGE[priority]}`}>{priority}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {/* 검수·불출 대기 건은 오더가 COMPLETED 라 조제 상태로 말한다 — '완료' 배지가 대기 탭에 서 있던 결함 */}
                      <StatusBadge domain="pharmacyOrder" status={isVerifyWait(order) || isIssueWait(order) ? order.dispensing!.status! : order.status} className="text-[10px] font-bold" />
                      {/* 🔴 처방이 취소됐는데 조제가 진행 중이라 목록에 남은 건 — 종전엔 통지 없이 사라졌다 */}
                      {order.prescription?.status === 'CANCELLED' && (
                        <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap" title={tAttr('처방이 취소됐지만 조제가 이미 시작돼 목록에 남아 있습니다')}><T k="처방취소" /></span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{patient?.familyName}{patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-800">
                        {drug?.nameKo ?? '약물'}
                        {drug?.highAlertFlag && <span className="ml-1.5 text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold align-middle whitespace-nowrap" title={tAttr('ISMP 고위험 약물 — 조제·투약 시 2인 확인(Two-person check)')}>⛔<T k="고위험" /></span>}
                      </p>
                      <p className="text-[10px] text-gray-400">{drug?.code ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{order.prescription?.dosage ?? ''} {order.prescription?.frequency ?? ''}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {order.createdAt ?kdate(order.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        {pharmacyMode === 'EXTERNAL' ? (
                          <button onClick={(e) => { e.stopPropagation(); const eid = order.prescription?.encounter?.id ?? order.prescription?.encounterId; if (eid) router.push(`/print/prescription/${eid}`); else toast.error('진료 기록을 찾을 수 없습니다.'); }}
                            className="px-2.5 py-1 text-[10px] font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="처방전 출력" /></button>
                        ) : (<>
                        {order.status === 'ORDERED' && (
                          <button onClick={(e) => { e.stopPropagation(); dispenseMut.mutate({ orderId: order.id }); }}
                            className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="조제@버튼" /></button>
                        )}
                        {order.status === 'IN_PROGRESS' && (
                          // 🔴 고위험약/마약류는 2차 확인자가 필요하다 — 목록 행에는 고를 자리가 없으므로
                          //    상세 패널로 보낸다(여기서 body 없이 완료하면 서버가 409 로 막는다).
                          needsSecondCheck(drug) ? (
                            <button onClick={(e) => { e.stopPropagation(); setSelectedId(order.dispensing?.id ?? order.dispensingId ?? order.id); }}
                              title={tAttr('고위험약/마약류 — 2차 확인자를 지정해야 완료할 수 있습니다')}
                              className="px-2.5 py-1 text-[10px] font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"><T k="2인확인 후 완료" /></button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); completeMut.mutate({ id: order.dispensing?.id ?? order.dispensingId ?? order.id }); }}
                              className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>
                          )
                        )}
                        {/* 🔴 판정은 조제 상태로 — order.status 는 조제 완료 후 'DISPENSED' 가 아니라 COMPLETED 다
                            (OrderStatus enum 에 DISPENSED 없음). 종전 조건은 영원히 거짓이라 검수 버튼이 안 떴다. */}
                        {isVerifyWait(order) && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <SmartSignButton
                              documentType="DISPENSING"
                              documentId={order.dispensing?.id ?? order.dispensingId ?? order.id}
                              documentTitle="조제 검수"
                              onSign={() => void verifyWithConsent(order.dispensing?.id ?? order.dispensingId ?? order.id)}
                              variant="small"
                              label={tAttr('검수')}
                            />
                          </span>
                        )}
                        {isIssueWait(order) && (
                          <button onClick={(e) => { e.stopPropagation(); handleIssue(order.dispensing?.id ?? order.dispensingId ?? order.id); }}
                            className="px-2.5 py-1 text-[10px] font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="불출@버튼" /></button>
                        )}
                        </>)}
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
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
              <p className="text-sm text-gray-400"><T k="처방을 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="처방 상세" /></h3>
                <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {detail ? (
                <>
                  {/* 환자 정보 */}
                  <div className="bg-blue-50 rounded-xl p-3">
                    <p className="text-xs text-blue-600 font-medium"><T k="환자" /></p>
                    <p className="text-sm font-bold text-gray-900">
                      {detail.prescription?.encounter?.patient?.familyName}{detail.prescription?.encounter?.patient?.givenName}
                    </p>
                    <p className="text-[10px] text-gray-500">MRN: {detail.prescription?.encounter?.patient?.mrn}</p>
                  </div>

                  {/* 약물 정보 */}
                  <div className="bg-teal-50 rounded-xl p-3 space-y-1.5">
                    <p className="text-xs text-teal-600 font-medium"><T k="처방 약물" /></p>
                    <p className="text-sm font-bold text-gray-900"><DrugName nameKo={detail.prescription?.medicationCode?.nameKo} nameEn={detail.prescription?.medicationCode?.nameEn} ingredient={detail.prescription?.medicationCode?.ingredient} /></p>
                    <p className="text-[10px] text-gray-500 font-mono">{detail.prescription?.medicationCode?.code}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                      <div><span className="text-gray-400"><T k="용량" />:</span> <span className="font-medium">{detail.prescription?.dosage ?? '-'}</span></div>
                      <div><span className="text-gray-400"><T k="투여" />:</span> <span className="font-medium">{detail.prescription?.route ?? '-'}</span></div>
                      <div><span className="text-gray-400"><T k="횟수@용법" />:</span> <span className="font-medium">{detail.prescription?.frequency ?? '-'}</span></div>
                      <div><span className="text-gray-400"><T k="일수" />:</span> <span className="font-medium">{detail.prescription?.duration ?? '-'}<Unit>일</Unit></span></div>
                      <div><span className="text-gray-400"><T k="총량" />:</span> <span className="font-medium">{detail.prescription?.quantity ?? '-'}</span></div>
                      <div><span className="text-gray-400"><T k="우선" />:</span> <span className="font-medium">{detail.prescription?.priority ?? 'ROUTINE'}</span></div>
                    </div>
                  </div>

                  {/* 조제 상태 */}
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500 font-medium mb-1"><T k="조제 상태" /></p>
                    <StatusBadge domain="pharmacyOrder" status={detail.status} className="text-xs font-bold px-2.5 py-1" />
                    {detail.pharmacist && (
                      <p className="text-[10px] text-gray-400 mt-1.5"><T k="조제자" />: {detail.pharmacist.familyName}{detail.pharmacist.givenName}</p>
                    )}
                    {detail.notes && (
                      <p className="text-[10px] text-gray-500 mt-1 bg-white p-2 rounded-lg">{detail.notes}</p>
                    )}
                  </div>

                  {/* 조제 품목 */}
                  {detail.items && detail.items.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-1.5"><T k="조제 품목" /></p>
                      <div className="space-y-1">
                        {detail.items.map((item: PharmacyDispenseItem, i: number) => (
                          <div key={i} className="flex justify-between text-xs p-2 bg-gray-50 rounded-lg">
                            {/* 서버 item 정본은 medicationCode.nameKo·prescribedQty/dispensedQty — 종전 오키는 전부 undefined 라 "약물"·공백 */}
                            <span className="text-gray-800">{item.medicationCode?.nameKo ?? item.name ?? item.medicationName ?? '약물'}</span>
                            <span className="text-gray-500">{item.dispensedQty ?? item.prescribedQty ?? item.quantity ?? item.amount ?? ''} {item.unit ?? ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* WeRU.B 약물 안전 검증 */}
                  <AiDrugSafetyPanel
                    drugName={detail.prescription?.medicationCode?.nameKo ?? ''}
                  />

                  {/* WeRU.B 처방 검토 + 복약지도 */}
                  <PharmacyAiPanel orderId={detail.orderId ?? detail.id} />

                  {/* 바코드 스캔 (조제 중일 때) */}
                  {(detail.status === 'IN_PROGRESS' || detail.status === 'PENDING') && pharmacyMode === 'INTERNAL' && (
                    <BarcodeScanPanel dispensingId={detail.id} />
                  )}

                  {/* 🔴 **원외 처방은 원내 조제 대상이 아니다.** 종전엔 목록 행만 EXTERNAL 을 막고
                      상세 패널의 '조제 시작' 은 모드로 막지 않아, 행을 클릭하면 원외 건을 그대로
                      조제할 수 있었다(실측 EXTERNAL 조제 1건 존재·비시드 UUID).
                      🔴 숨기지 않는다 — 해야 할 일(처방전 교부)을 그 자리에서 말한다. */}
                  {isExternalDetail && (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 space-y-2">
                      <p className="text-xs font-semibold text-violet-800"><T k="원외 처방 — 원내 조제 대상이 아닙니다" /></p>
                      <p className="text-[11px] text-violet-700">
                        <T k="환자가 처방전을 들고 원외 약국에서 조제받는 건입니다. 처방전을 출력해 교부하세요. 원내 조제가 필요하면 처방의가 처방을 원내로 다시 내야 합니다." />
                      </p>
                      <button
                        onClick={() => { const eid = detail.prescription?.encounter?.id ?? detail.prescription?.encounterId; if (eid) router.push(`/print/prescription/${eid}`); else toast.error('진료 기록을 찾을 수 없습니다.'); }}
                        className="px-3 py-1.5 text-[11px] font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="처방전 출력" /></button>
                    </div>
                  )}

                  {/* 🔴 처방이 취소됐는데 조제가 진행 중이다 — 종전엔 이 건이 큐에서 **통지 없이 사라졌다**.
                      이제 목록에 남으므로, 왜 남아 있는지를 화면이 말한다. */}
                  {detailRxCancelled && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-semibold text-red-800"><T k="처방이 취소되었습니다" /></p>
                      <p className="text-[11px] text-red-700 mt-1">
                        <T k="조제가 이미 시작된 건이라 목록에 남아 있습니다. 조제 중이면 취소 처리하고, 이미 조제된 약은 원내 절차에 따라 반품·폐기하세요." />
                      </p>
                    </div>
                  )}

                  {/* 고위험약/마약류 2차 확인자 — 대상이 아니면 렌더되지 않는다 */}
                  <SecondCheckPicker
                    required={(detail.status === 'IN_PROGRESS' || detail.status === 'PENDING') && detailHighAlert}
                    value={secondCheckBy}
                    onChange={setSecondCheckBy}
                    reason={detailHighAlertReason}
                    compact
                  />

                  {/* 액션 버튼 */}
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    {detail.status === 'ORDERED' && !isExternalDetail && (
                      <button onClick={() => dispenseMut.mutate({ orderId: detail.orderId ?? detail.id })}
                        className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="조제 시작" /></button>
                    )}
                    {/* dispensing 경로의 status 는 DispensingStatus(조제중=PENDING) — IN_PROGRESS 만 보면 버튼이 영원히 안 뜬다 */}
                    {(detail.status === 'IN_PROGRESS' || detail.status === 'PENDING') && (
                      <button onClick={() => completeMut.mutate({ id: detail.id, secondCheckBy: secondCheckBy || undefined })}
                        className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="조제 완료" /></button>
                    )}
                    {detail.status === 'DISPENSED' && (
                      <SmartSignButton
                        documentType="DISPENSING"
                        documentId={detail.id}
                        documentTitle="조제 검수"
                        onSign={() => void verifyWithConsent(detail.id)}
                        variant="small"
                        label={tAttr('검수 확인')}
                      />
                    )}
                    {detail.status === 'VERIFIED' && (
                      <button onClick={() => handleIssue(detail.id)}
                        className="flex-1 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="불출 (수령 확인)" /></button>
                    )}
                    {(detail.status === 'IN_PROGRESS' || detail.status === 'ORDERED' || detail.status === 'PENDING') && (
                      <button onClick={() => setShowCancel(true)}
                        className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600"><T k="취소" /></button>
                    )}
                  </div>

                  {/* 취소 사유 */}
                  {showCancel && (
                    <div className="bg-red-50 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-medium text-red-700"><T k="취소 사유" /></p>
                      <ReasonInput domain="prescriptionCancel" required value={cancelReason} onChange={setCancelReason}
                        className="w-full px-3 py-1.5 border border-red-200 rounded-lg text-xs" placeholder={tAttr('취소 사유를 입력하세요')} />
                      <div className="flex gap-2">
                        <button onClick={() => { if (reasonFilled(cancelReason)) cancelMut.mutate({ id: detail.id, reason: cancelReason.trim() }); }}
                          disabled={!reasonFilled(cancelReason)}
                          className="min-h-[44px] flex-1 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"><T k="취소 확인" /></button>
                        <button onClick={() => { setShowCancel(false); setCancelReason(''); }}
                          className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="돌아가기" /></button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-xs text-gray-400"><T k="상세 정보를 불러오는 중..." /></p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 바코드 스캔 패널 ──

function BarcodeScanPanel({ dispensingId }: { dispensingId: string }) {
  const tAttr = useTAttr();
  const [barcode, setBarcode] = useState('');
  const [result, setResult] = useState<{ matched: boolean; message?: string; medicationCode?: { nameKo?: string; nameEn?: string | null; ingredient?: string | null; code?: string; controlSchedule?: string }; isControlled?: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    if (!barcode.trim()) return;
    setScanning(true);
    try {
      const res = await apiClient.post<{ data: { matched: boolean; message?: string; medicationCode?: { nameKo?: string; nameEn?: string | null; ingredient?: string | null; code?: string; controlSchedule?: string }; isControlled?: boolean } }>('/api/v1/pharmacy/scan', { barcode: barcode.trim(), dispensingId });
      setResult(res.data);
      if (res.data.matched) setBarcode('');
    } catch { setResult({ matched: false, message: '스캔 처리에 실패했습니다.' }); }
    setScanning(false);
  };

  return (
    <div className="bg-indigo-50 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" /></svg>
        <T k="바코드 스캔" />
      </p>
      <div className="flex gap-1.5">
        <input
          value={barcode}
          onChange={e => setBarcode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
          placeholder={tAttr('바코드를 스캔하세요')}
          className="flex-1 px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300 focus:outline-none"
          autoFocus
        />
        <button onClick={handleScan} disabled={scanning || !barcode.trim()}
          className="px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
          {scanning ? '...' : <T k="확인" />}
        </button>
      </div>
      {result && (
        <div className={`p-2 rounded-lg text-xs ${result.matched ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
          {result.matched ? (
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-600 font-bold">✓</span>
              <span className="font-medium"><DrugName nameKo={result.medicationCode?.nameKo} nameEn={result.medicationCode?.nameEn} ingredient={result.medicationCode?.ingredient} /></span>
              <span className="text-emerald-500"><T k="일치" /></span>
              {result.isControlled && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[9px] font-bold ml-auto whitespace-nowrap">마약류 {result.medicationCode?.controlSchedule}급</span>}
            </div>
          ) : (
            <span>{result.message}</span>
          )}
        </div>
      )}
      {result?.isControlled && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2">
          <p className="text-[10px] text-red-700 font-semibold">⚠ <T k="마약류 — 이중 확인이 필요합니다" /></p>
          <p className="text-[10px] text-red-600"><T k="다른 약사의 확인을 받으세요." /></p>
        </div>
      )}
    </div>
  );
}

/* ── WeRU.B 약물 안전 검증 패널 ── */
function AiDrugSafetyPanel({ drugName, patientId }: { drugName: string; patientId?: string }) {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  if (!drugName) return null;

  const check = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post<any>('/api/v1/ai/predict/adverse-drug', {
        drugs: [drugName],
        ...(patientId ? {} : {}),
      });
      setResult(res?.data);
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
          <p className="text-[10px] font-semibold text-amber-700">{AI_ORIGIN_TEXT} <T k="부작용 예측 결과" /></p>
          {result.risk_level && (
            <p className="text-xs">
              <T k="위험도" />: <span className={`font-bold ${result.risk_level === 'HIGH' ? 'text-red-600' : result.risk_level === 'MODERATE' ? 'text-amber-600' : 'text-green-600'}`}>
                {result.risk_level === 'HIGH' ? <T k="고위험" /> : result.risk_level === 'MODERATE' ? <T k="주의" /> : <T k="저위험" />}
              </span>
            </p>
          )}
          {result.adverse_events?.length > 0 && (
            <div className="text-[10px] text-amber-900 space-y-0.5">
              {result.adverse_events.slice(0, 5).map((e: any, i: number) => (
                <p key={i}>- {e.event ?? e.drug ?? JSON.stringify(e)}</p>
              ))}
            </div>
          )}
          {result.recommendations?.length > 0 && (
            <p className="text-[10px] text-amber-600"><T k="권고" />: {result.recommendations.join(', ')}</p>
          )}
          <p className="text-[11px] text-amber-500">{AI_ORIGIN_TEXT} <T k="참고용 — 최종 판단은 약사에게 있습니다" /></p>
        </div>
      )}
    </div>
  );
}

/** 약국 WeRU.B 패널 — 처방 검토 + 복약지도 */
function PharmacyAiPanel({ orderId }: { orderId: string }) {
  const tAttr = useTAttr();
  const { data: reviewData, isLoading: reviewLoading, isError: reviewIsError, error: reviewError, refetch: refetchReview } = useQuery({
    queryKey: ['ai-pharmacy-review', orderId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/pharmacy/orders/${orderId}/ai-review`),
    staleTime: 5 * 60 * 1000,
  });
  const { data: guidanceData, isLoading: guidanceLoading, isError: guidanceIsError, error: guidanceError, refetch: refetchGuidance } = useQuery({
    queryKey: ['ai-pharmacy-guidance', orderId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/pharmacy/orders/${orderId}/ai-guidance`),
    staleTime: 5 * 60 * 1000,
  });

  const review = (reviewData?.data as { data?: Record<string, unknown> })?.data ?? reviewData?.data;
  const guidance = (guidanceData?.data as { data?: Record<string, unknown> })?.data ?? guidanceData?.data;

  return (
    <div className="space-y-2">
      {/* 🔴 호출 실패를 "검토 결과 없음"으로 조용히 넘기지 않는다(검토가 돌지 않은 것이다) */}
      {reviewIsError
        ? <QueryErrorFallback error={reviewError} onRetry={refetchReview} size="compact" />
        : <AiSuggestionPanel title={tAttr('처방 자동 검토')} data={review} source={(review as Record<string, unknown>)?.source as string} isLoading={reviewLoading} compact />}
      {guidanceIsError
        ? <QueryErrorFallback error={guidanceError} onRetry={refetchGuidance} size="compact" />
        : <AiSuggestionPanel title={tAttr('복약지도 초안')} data={guidance} source={(guidance as Record<string, unknown>)?.source as string} isLoading={guidanceLoading} compact />}
    </div>
  );
}
