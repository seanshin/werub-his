'use client';

import { useState, useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';
import { RegistrationConsentCollector, RequiredConsentBadge, useRegistrationConsentStatus, UnappliedSignaturesCard } from '@/components/consent/RegistrationConsentCollector';

/* ── 타입 ── */
interface PatientRef { id?: string; familyName?: string; givenName?: string; mrn?: string; phoneNumber?: string }
interface WsOrder {
  orderId: string; status: string; priority?: string;
  procedureName?: string; procedureCode?: string; createdAt?: string;
  patient?: PatientRef;
  departmentName?: string; doctorName?: string;
  appointmentTime?: string; visitType?: string; insuranceType?: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '대기',   cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수',   cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED:   { label: '완료',   cls: 'bg-emerald-100 text-emerald-700' },
};

const VISIT_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  FIRST:     { label: '초진', cls: 'bg-indigo-100 text-indigo-700' },
  RETURN:    { label: '재진', cls: 'bg-teal-100 text-teal-700' },
  REFERRAL:  { label: '의뢰', cls: 'bg-violet-100 text-violet-700' },
  EMERGENCY: { label: '응급', cls: 'bg-red-100 text-red-700' },
};

type FilterKey = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED';

export default function ReceptionWorkstationPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-reception-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/reception/queue'),
    refetchInterval: 8000,
  });
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;

  const allOrders: WsOrder[] = useMemo(() => {
    const raw = queueRes?.data;
    return Array.isArray(raw) ? raw : [];
  }, [queueRes]);

  const counts = useMemo(() => ({
    ALL: allOrders.length,
    ORDERED: allOrders.filter(o => o.status === 'ORDERED').length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED').length,
    COMPLETED: allOrders.filter(o => o.status === 'COMPLETED').length,
  }), [allOrders]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allOrders;
    if (filter === 'IN_PROGRESS') return allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED');
    return allOrders.filter(o => o.status === filter);
  }, [allOrders, filter]);

  const selectedOrder = allOrders.find(o => o.orderId === selectedId);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ws-reception-queue'] });
  const receive  = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`),  onSuccess: () => { invalidate(); toast.success('접수 완료'); } });
  const complete = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/complete`), onSuccess: () => { invalidate(); toast.success('처리 완료'); } });

  const stats = [
    { label: '대기', count: counts.ORDERED, cls: 'text-gray-600 bg-gray-50' },
    { label: '진행중', count: counts.IN_PROGRESS, cls: 'text-amber-700 bg-amber-50' },
    { label: '완료', count: counts.COMPLETED, cls: 'text-emerald-700 bg-emerald-50' },
  ];

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      <UnappliedSignaturesCard />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="접수 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="환자 확인 → 접수 → 진료 대기" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/reception" className="px-3 py-1.5 text-xs font-medium bg-sky-50 text-sky-700 rounded-lg hover:bg-sky-100"><T k="접수 메인" /></Link>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`rounded-xl p-3 ${s.cls}`}>
            <p className="text-[10px] font-medium opacity-70">{s.label}</p>
            <p className="text-2xl font-bold">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 워크플로우 */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium"><T k="도착" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium"><T k="접수@상태" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="진료 대기" /></span>
      </div>

      {/* 필터 */}
      <div className="flex gap-1.5">
        {([
          { key: 'ALL' as FilterKey, label: '전체' },
          { key: 'ORDERED' as FilterKey, label: '대기' },
          { key: 'IN_PROGRESS' as FilterKey, label: '진행중' },
          { key: 'COMPLETED' as FilterKey, label: '완료' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {f.label}
            {counts[f.key] > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="구분" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진료과" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당의" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[65px]"><T k="예약시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[100px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : isError ? (
                <tr><td colSpan={7}><QueryErrorFallback error={error} onRetry={refetch} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm"><T k="대기 중인 접수가 없습니다" /></td></tr>
              ) : filtered.map(o => {
                const isSelected = selectedId === o.orderId;
                const vt = o.visitType ? VISIT_TYPE_LABEL[o.visitType] : null;
                return (
                  <tr key={o.orderId} onClick={() => setSelectedId(o.orderId)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-sky-50' : 'hover:bg-gray-50/50'} ${o.priority === 'STAT' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      {o.priority === 'STAT' ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse whitespace-nowrap">STAT</span>
                      ) : vt ? (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${vt.cls}`}>{vt.label}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_MAP[o.status]?.cls ?? 'bg-gray-100'}`}>
                        {STATUS_MAP[o.status]?.label ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{o.patient?.familyName}{o.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{o.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{o.departmentName ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{o.doctorName ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {o.appointmentTime ?kdate(o.appointmentTime, 'time') :
                       o.createdAt ?kdate(o.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {o.status === 'ORDERED' && <button onClick={() => receive.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@버튼" /></button>}
                        {(o.status === 'RECEIVED' || o.status === 'IN_PROGRESS') && <button onClick={() => complete.mutate(o.orderId)} className="min-h-[44px] px-2.5 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>}
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
          {!selectedOrder ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              <p className="text-sm text-gray-400"><T k="환자를 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="접수 상세" /></h3>
                <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* 환자 정보 */}
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-blue-600 font-medium"><T k="환자" /></p>
                <p className="text-sm font-bold text-gray-900">{selectedOrder.patient?.familyName}{selectedOrder.patient?.givenName}</p>
                <p className="text-[10px] text-gray-500">MRN: {selectedOrder.patient?.mrn}</p>
                {selectedOrder.patient?.phoneNumber && (
                  <p className="text-[10px] text-gray-500 mt-1">연락처: {selectedOrder.patient.phoneNumber}</p>
                )}
              </div>

              {/* IPSG.1 환자 확인 */}
              <div className="bg-amber-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs font-semibold text-amber-700"><T k="IPSG.1 환자 확인" /></p>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="w-3.5 h-3.5 rounded border-amber-300 text-amber-600" />
                    <span><T k="이름 확인 (구두 확인)" /></span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="w-3.5 h-3.5 rounded border-amber-300 text-amber-600" />
                    <span><T k="MRN / 생년월일 확인 (2가지 식별자)" /></span>
                  </label>
                </div>
              </div>

              {/* 법정 동의서 (초진) */}
              {selectedOrder.patient?.id && <LegalConsentPanel patientId={selectedOrder.patient.id} />}

              {/* 접수 정보 */}
              <div className="bg-sky-50 rounded-xl p-3 space-y-2">
                <p className="text-xs text-sky-600 font-medium"><T k="접수 정보" /></p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-400"><T k="진료과:" /></span> <span className="font-medium">{selectedOrder.departmentName ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="담당의:" /></span> <span className="font-medium">{selectedOrder.doctorName ?? '-'}</span></div>
                  <div>
                    <span className="text-gray-400"><T k="보험:" /></span>{' '}
                    <span className={`font-medium px-1.5 py-0.5 rounded text-[10px] ${
                      selectedOrder.insuranceType === 'NHI' ? 'bg-blue-100 text-blue-700'
                      : selectedOrder.insuranceType === 'SELF' ? 'bg-gray-100 text-gray-700'
                      : selectedOrder.insuranceType === 'MEDICAL_AID' ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>
                      {selectedOrder.insuranceType === 'NHI' ? '건강보험'
                       : selectedOrder.insuranceType === 'SELF' ? '비급여'
                       : selectedOrder.insuranceType === 'MEDICAL_AID' ? '의료급여'
                       : selectedOrder.insuranceType ?? '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400"><T k="구분:" /></span>{' '}
                    {selectedOrder.visitType && VISIT_TYPE_LABEL[selectedOrder.visitType] ? (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${VISIT_TYPE_LABEL[selectedOrder.visitType].cls}`}>
                        {VISIT_TYPE_LABEL[selectedOrder.visitType].label}
                      </span>
                    ) : <span className="font-medium">-</span>}
                  </div>
                  <div><span className="text-gray-400"><T k="예약:" /></span> <span className="font-medium">
                    {selectedOrder.appointmentTime ?kdate(selectedOrder.appointmentTime, 'time') : '예약 없음 (Walk-in)'}
                  </span></div>
                </div>
              </div>

              {/* 대기번호 */}
              {selectedOrder.status !== 'ORDERED' && (
                <div className="bg-indigo-50 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-indigo-600 font-medium"><T k="대기번호" /></p>
                  {/* 🔴 종전엔 `orderId.charCodeAt(0) * 7 % 100` 으로 **화면이 번호를 지어냈다.**
                      `%100` 이라 환자끼리 충돌했고, 3xl 굵게 "대기번호"라 불렀지만 아무 근거가 없었다.
                      실측 결과 이 EP(`workstation/station/:id/queue`)는 `queueNumber` 를 **주지 않는다** —
                      없는 것을 만들어 내지 않고, 진짜 번호가 있는 곳(외래 접수 데스크)을 가리킨다.
                      (정본은 `WaitingQueue.queueNumber` 이고 `/front-desk` 가 그것을 쓴다.) */}
                  <p className="text-3xl font-black text-indigo-300 my-1">—</p>
                  <p className="text-[9px] text-indigo-400 leading-tight">
                    <T k="이 화면에서는 대기번호를 발급하지 않습니다" /><br /><T k="외래 접수(데스크)에서 확인하세요" />
                  </p>
                  <p className="text-[9px] text-indigo-400">{selectedOrder.departmentName ?? '진료과'} 대기</p>
                </div>
              )}

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selectedOrder.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(selectedOrder.orderId)} className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수 확인" /></button>
                )}
                {(selectedOrder.status === 'RECEIVED' || selectedOrder.status === 'IN_PROGRESS') && (
                  <button onClick={() => complete.mutate(selectedOrder.orderId)} className="min-h-[44px] flex-1 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="진료 대기 전환" /></button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 법정 동의서(초진 10종) 패널 — 원무과 접수 연계 ── */
/**
 * 🔴 종전(2026-10-03 이전): 포털 요청 버튼과 '동의서 워크스테이션'(수술·시술 동의서 화면) 링크뿐이라 **여기서 초진 동의를 받을 길이 없었고**,
 *    직원 체크박스로 들어온 동의(서명 증빙 없음)도 '필수 완료'로 셌다. 이제 수집 패널과 같은 현황 캐시를 읽고,
 *    직원 입력은 따로 말하며, 이 자리에서 태블릿·휴대폰·종이 스캔으로 받는다.
 */
function LegalConsentPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [collecting, setCollecting] = useState(false);
  const { data: st, isError, error, refetch } = useRegistrationConsentStatus(patientId);
  const consents = st?.consents ?? [];
  const requiredTotal = consents.filter(c => c.required).length;
  const requiredDone = consents.filter(c => c.required && c.agreed && !c.expired).length;

  const portalReq = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/patients/${patientId}/registration-consents/send-portal`, {}),
    // 🔴 HTTP 200 이라고 나간 것이 아니다 — 화면 실사용 점검 W8(2026-08-14).
    //    서버는 포털 계정이 없으면 아무 알림도 만들지 않고도 성공을 반환했고, 이 토스트가
    //    "보냈습니다"라고 말했다. 서버를 `success:false, reason:'NO_PORTAL_ACCOUNT'` 로 고쳤으니
    //    화면도 그 값을 읽어야 한다. **발송 시도 ≠ 도달.**
    onSuccess: (res: unknown) => {
      qc.invalidateQueries({ queryKey: ['registration-consent-collect', patientId] });
      const d = (res as { data?: { success?: boolean; message?: string } })?.data;
      if (d?.success === false) toast.error(d.message ?? '포털로 보내지 못했습니다 — 현장 서명으로 진행하세요');
      else toast.success('포털로 동의 요청을 보냈습니다');
    },
    onError: () => toast.error('포털 요청 실패'),
  });

  // 🔴 조회 실패를 "필수 0/0 미완료"로 말하지 않는다 — 동의 여부를 모르는 상태다
  if (isError) {
    return (
      <div className="rounded-xl p-3 space-y-2 bg-gray-50">
        <p className="text-xs font-semibold text-gray-700"><T k="법정 동의서 (초진)" /></p>
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      </div>
    );
  }
  const signedComplete = !!st?.requiredComplete && (st.requiredStaffEntered ?? 0) === 0;

  return (
    <div className={`rounded-xl p-3 space-y-2 ${!st ? 'bg-gray-50' : signedComplete ? 'bg-emerald-50' : 'bg-amber-50'}`} data-ws-legal-consent>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-xs font-semibold text-gray-800"><T k="법정 동의서 (초진)" /></p>
        {st ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500"><Tf k="필수 {완료}/{전체}" params={{ 완료: requiredDone, 전체: requiredTotal }} /></span>
            <RequiredConsentBadge status={st} />
          </span>
        ) : <span className="text-[10px] text-gray-400"><T k="불러오는 중…" /></span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setCollecting((v) => !v)} aria-expanded={collecting} data-ws-collect-toggle
          className="min-h-[44px] flex-1 py-1.5 bg-violet-600 text-white text-[11px] font-medium rounded-lg hover:bg-violet-700">
          {collecting ? <T k="닫기" /> : <T k="동의 받기(태블릿·휴대폰·종이)" />}
        </button>
        <button onClick={() => portalReq.mutate()} disabled={portalReq.isPending}
          className="min-h-[44px] flex-1 py-1.5 bg-blue-600 text-white text-[11px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k="📲 포털 동의 요청" /></button>
        <Link href={`/patients/${patientId}?tab=consent`} className="px-3 py-1.5 text-[11px] text-gray-600 border border-gray-200 rounded-lg hover:bg-white self-center"><T k="차트 동의서 탭" /></Link>
      </div>
      {collecting && <RegistrationConsentCollector patientId={patientId} />}
    </div>
  );
}
