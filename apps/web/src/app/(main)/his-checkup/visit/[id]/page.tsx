'use client';

import { use, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { genderText } from '@/components/ui/display';
import { ageOf, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import Link from 'next/link';
import { T, useTAttr } from '@/components/ui/i18n-text';

const STATUS_LABELS: Record<string, string> = {
  RESERVED: '예약', CHECKED_IN: '접수', IN_PROGRESS: '진행중',
  EXAM_COMPLETE: '검사완료', PARTIAL_COMPLETE: '부분완료', REVIEW: '소견대기',
  COMPLETED: '완료', DELIVERED: '전달', CANCELLED: '취소', NO_SHOW: '미방문',
};
const FINDING_LABELS: Record<string, { icon: string; label: string; cls: string }> = {
  NORMAL: { icon: '●', label: '정상', cls: 'text-emerald-500' },
  ABNORMAL: { icon: '▲', label: '이상', cls: 'text-amber-500' },
  CRITICAL: { icon: '■', label: '위험', cls: 'text-red-500' },
  PENDING: { icon: '○', label: '대기', cls: 'text-gray-300' },
  NOT_APPLICABLE: { icon: '━', label: '스킵', cls: 'text-gray-400' },
};
const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700', B: 'bg-yellow-100 text-yellow-700',
  C1: 'bg-orange-100 text-orange-700', C2: 'bg-red-100 text-red-700',
  D1: 'bg-red-200 text-red-800', D2: 'bg-blue-100 text-blue-700',
};
const GRADE_LABELS: Record<string, string> = {
  A: '정상', B: '경미한 이상', C1: '요관찰', C2: '요치료', D1: '정밀검사', D2: '치료중',
};

export default function CheckupVisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [resultModal, setResultModal] = useState<any>(null);
  const [followUpModal, setFollowUpModal] = useState(false);
  const [referralModal, setReferralModal] = useState(false);
  const [resultForm, setResultForm] = useState({ value: '', unit: '', referenceRange: '', finding: '', note: '' });
  const [panelValues, setPanelValues] = useState<Record<string, string>>({});
  const [followUpForm, setFollowUpForm] = useState({ followUpType: 'RECHECK', description: '', dueDate: '' });
  const [referralForm, setReferralForm] = useState({ toDepartment: '', reason: '', urgency: 'ROUTINE' });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['checkup-visit', id] });
    queryClient.invalidateQueries({ queryKey: ['checkup-route', id] });
  };

  const { data: visitRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup-visit', id],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/visits/${id}`),
  });
  const visit = visitRes?.data;

  const { data: routeRes } = useQuery({
    queryKey: ['checkup-route', id],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/visits/${id}/route-sheet`),
    enabled: !!visit,
  });
  const routeSheet = routeRes?.data ?? [];

  const updateStatus = useMutation({
    mutationFn: (status: string) => apiClient.patch(`/api/v1/checkup/visits/${id}/status`, { status }),
    onSuccess: () => { invalidateAll(); toast.success('상태 변경 완료'); },
  });
  const addResult = useMutation({
    mutationFn: (body: any) => apiClient.post(`/api/v1/checkup/visits/${id}/results`, body),
    onSuccess: () => { invalidateAll(); setResultModal(null); toast.success('결과 입력 완료'); },
  });
  const addPanel = useMutation({
    mutationFn: (body: any) => apiClient.post(`/api/v1/checkup/visits/${id}/results/panel`, body),
    onSuccess: (res: any) => { invalidateAll(); setResultModal(null); toast.success(`패널 ${res?.data?.created ?? 0}항목 입력·자동판정 완료`); },
    onError: (e: any) => toast.error(e?.message ?? '패널 입력 실패'),
  });
  const autoCollect = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/checkup/visits/${id}/auto-collect`),
    onSuccess: (res: any) => {
      invalidateAll();
      const d = res?.data ?? {};
      // 🔴 "0건 수집 완료"는 성과처럼 읽힌다. 자동수집은 원자료 연결(sourceType/sourceId)이 있어야
      //    돌아가는데 현재 그 연결을 만드는 경로가 없다 — 그 사실을 그 자리에서 말한다.
      if ((d.collected ?? 0) > 0) { toast.success(`${d.collected}건 수집 완료`); return; }
      if ((d.linkedPending ?? 0) === 0 && (d.unlinkedPending ?? 0) > 0) {
        toast.warning(`자동수집 대상 없음 — 대기 ${d.unlinkedPending}항목이 검사·영상 원자료에 연결되어 있지 않습니다(수동 입력 필요)`);
        return;
      }
      toast.info(`수집된 결과 없음 (대기 ${d.total ?? 0}항목 · 연결됨 ${d.linkedPending ?? 0})`);
    },
  });
  const createFollowUp = useMutation({
    mutationFn: (body: any) => apiClient.post(`/api/v1/checkup/visits/${id}/follow-ups`, body),
    onSuccess: () => { invalidateAll(); setFollowUpModal(false); toast.success('추적 등록 완료'); },
  });
  const createReferral = useMutation({
    mutationFn: (body: any) => apiClient.post(`/api/v1/checkup/visits/${id}/referrals`, body),
    onSuccess: () => { invalidateAll(); setReferralModal(false); toast.success('의뢰 생성 완료'); },
  });

  // hooks(useMutation)는 조건부 return보다 먼저 — hooks 규칙(React #300)
  const cancelVisit = useMutation({
    mutationFn: (reason: string) => apiClient.patch(`/api/v1/checkup/visits/${id}/cancel`, { reason }),
    onSuccess: () => { invalidateAll(); toast.success('예약 취소 완료'); },
    onError: (e: any) => toast.error(e?.message ?? '취소 실패'),
  });
  const skipItem = useMutation({
    mutationFn: (body: { testName: string; reason: string }) => apiClient.patch(`/api/v1/checkup/visits/${id}/skip-item`, body),
    onSuccess: () => { invalidateAll(); toast.success('항목 스킵 처리 완료'); },
  });

  if (isLoading || !visit) {
    return <div className="py-16 text-center text-gray-400"><div className="animate-pulse text-3xl mb-2">🏥</div><T k="로딩 중..." /></div>;
  }
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const patient = visit.patient;
  const program = visit.program;
  const items = visit.items ?? [];
  const summary = visit.summary;
  const completedCount = items.filter((i: any) => i.finding !== 'PENDING').length;
  const totalItems = routeSheet.length || (Array.isArray(program.items) ? program.items.length : 0);
  const pct = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;
  const formatPrice = (n: number) => new Intl.NumberFormat('ko-KR').format(n) + '원';
  const age = patient.dateOfBirth ? (ageOf(patient.dateOfBirth) ?? 0) : null;
  const nextStatus: Record<string, string> = { CHECKED_IN: 'IN_PROGRESS', IN_PROGRESS: 'EXAM_COMPLETE', EXAM_COMPLETE: 'REVIEW', PARTIAL_COMPLETE: 'REVIEW' };

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/his-checkup" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">←</Link>
          <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-bold">
            {patient.familyName}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {patient.familyName}{patient.givenName}
              <span className="ml-2 text-sm font-normal text-gray-400">
                {genderText(patient.gender)} · {age}세 · {patient.mrn}
              </span>
            </h1>
            <p className="text-sm text-gray-500">{program.name} ({program.code})</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
            STATUS_LABELS[visit.status] ? 'bg-gray-100 text-gray-700' : ''
          }`}><T k={STATUS_LABELS[visit.status]} /></span>
          {visit.status === 'RESERVED' && (
            <button onClick={() => { if (confirm('예약을 취소하시겠습니까?')) cancelVisit.mutate('관리자 취소'); }}
              className="min-h-[44px] px-3 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-medium hover:bg-red-100">
              <T k="예약 취소" />
            </button>
          )}
          {nextStatus[visit.status] && (
            <button onClick={() => updateStatus.mutate(nextStatus[visit.status])}
              className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 shadow-sm">
              {STATUS_LABELS[nextStatus[visit.status]]}로 변경
            </button>
          )}
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '검진일', value: visit.scheduledDate?.slice(0, 10), icon: '📅' },
          { label: '금액', value: formatPrice(visit.totalPrice), icon: '💰' },
          { label: '검사 항목', value: `${completedCount}/${totalItems}`, icon: '🔬' },
          { label: '진행률', value: `${pct}%`, icon: '📊' },
        ].map((c) => (
          <div key={c.label} className="bg-white border rounded-xl p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400"><T k={c.label} /></span>
              <span className="text-sm">{c.icon}</span>
            </div>
            <div className="text-lg font-bold text-gray-900 mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      {/* 진행률 바 */}
      <div className="bg-white border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700"><T k="전체 진행률" /></span>
          <div className="flex gap-2">
            <button onClick={() => autoCollect.mutate()}
              className="min-h-[44px] px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100">
              <T k="결과 자동수집" />
            </button>
          </div>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* 검사 순서표 */}
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="px-5 py-3.5 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-800"><T k="검사 순서표" /></h2>
          <div className="flex items-center gap-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />LAB</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400" />IMAGING</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />DIAGNOSTIC</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" />PHYSICAL</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {routeSheet.map((item: any) => {
            const f = FINDING_LABELS[item.finding] ?? FINDING_LABELS.PENDING;
            const statusBg = item.status === 'COMPLETED' ? 'bg-emerald-50/50' : item.status === 'IN_PROGRESS' ? 'bg-amber-50/50' : '';
            const catColor: Record<string, string> = {
              LAB: 'bg-blue-400', IMAGING: 'bg-indigo-400', DIAGNOSTIC: 'bg-amber-400',
              PHYSICAL: 'bg-emerald-400', CONSULT: 'bg-gray-300', AI: 'bg-purple-400',
            };
            return (
              <div key={item.seq} className={`flex items-center px-5 py-3 ${statusBg} hover:bg-blue-50/30 transition-colors group`}>
                {/* 순서 + 카테고리 도트 */}
                <div className="w-7 text-center">
                  <span className={`inline-block w-5 h-5 rounded-full text-[10px] font-bold leading-5 text-white ${catColor[item.category] ?? 'bg-gray-300'}`}>
                    {item.seq}
                  </span>
                </div>
                {/* 검사명 + 판독과 + 위치 */}
                <div className="flex-1 ml-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{item.name}</span>
                    {item.interpretDept && (
                      <span className="px-1.5 py-0.5 bg-violet-50 text-violet-500 text-[10px] rounded font-medium">{item.interpretDept}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400">{item.category}</span>
                </div>
                {/* 결과값 */}
                <div className="w-24 text-right text-sm text-gray-600 font-mono">
                  {item.value ?? ''}
                  {item.unit && <span className="text-gray-400 text-xs ml-0.5">{item.unit}</span>}
                </div>
                {/* 판정 */}
                <div className={`w-14 text-center text-xs font-bold ${f.cls}`}>
                  {f.icon} <T k={item.status === 'COMPLETED' ? f.label : ''} />
                </div>
                {/* 링크 + 입력 버튼 */}
                <div className="w-24 flex items-center justify-end gap-1.5">
                  {/* IMAGING → PACS 뷰어 링크 */}
                  {item.category === 'IMAGING' && (
                    <Link href={`/imaging?patientId=${patient.id}`} target="_blank"
                      className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-medium hover:bg-indigo-100 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      <T k="영상" />
                    </Link>
                  )}
                  {/* LAB → 검사결과 링크 */}
                  {item.category === 'LAB' && (
                    <Link href={`/patients/${patient.id}?tab=labresults`} target="_blank"
                      className="px-2 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-medium hover:bg-blue-100 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      <T k="결과지" />
                    </Link>
                  )}
                  {/* DIAGNOSTIC → 기초검사 링크 */}
                  {item.category === 'DIAGNOSTIC' && (
                    <Link href={`/diagnostics?patientId=${patient.id}`} target="_blank"
                      className="px-2 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-medium hover:bg-amber-100 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      <T k="상세" />
                    </Link>
                  )}
                  {/* 스킵 버튼 */}
                  {item.finding === 'PENDING' && item.category !== 'CONSULT' && (
                    <button title={tAttr('스킵 사유를 입력받아 원장에 남깁니다(고정 사유 금지)')} onClick={() => { const reason = window.prompt(`"${item.name}" 스킵 사유를 입력하세요(원장에 남습니다)`)?.trim(); if (reason) skipItem.mutate({ testName: item.name, reason }); }}
                      className="min-h-[44px] px-3 py-2 bg-gray-50 text-gray-400 rounded-lg text-xs font-medium hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      <T k="스킵" />
                    </button>
                  )}
                  {/* 입력 버튼 */}
                  {item.status !== 'COMPLETED' && item.finding !== 'NOT_APPLICABLE' && item.category !== 'CONSULT' && (
                    <button onClick={() => { setResultModal(item); setResultForm({ value: '', unit: '', referenceRange: '', finding: '', note: '' }); setPanelValues({}); }}
                      className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-medium hover:bg-blue-700">
                      <T k="입력" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 문진 응답 */}
      <QuestionnaireViewer visitId={id} />

      {/* 종합소견 — 작성 또는 표시 */}
      {!summary && ['EXAM_COMPLETE', 'PARTIAL_COMPLETE', 'REVIEW'].includes(visit.status) && (
        <>
          <AiCheckupSummaryButton visitId={id} results={visit.results ?? []} />
          <SummaryCreateForm visitId={id} />
        </>
      )}
      {summary && <SummaryDisplay summary={summary} />}

      {/* 추적 관리 + 외래 의뢰 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 추적 */}
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 text-sm"><T k="추적 관리" /></h3>
            <button onClick={() => { setFollowUpModal(true); setFollowUpForm({ followUpType: 'RECHECK', description: '', dueDate: '' }); }}
              className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200">+ <T k="등록" /></button>
          </div>
          {(visit.followUps ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center"><T k="등록된 추적 항목 없음" /></p>
          ) : (
            <div className="space-y-1.5">
              {(visit.followUps as any[]).map((fu: any) => (
                <div key={fu.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg text-xs">
                  <span className="font-medium text-gray-700">{fu.description}</span>
                  <span className="text-gray-400 whitespace-nowrap">{fu.dueDate?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 의뢰 */}
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 text-sm"><T k="외래 의뢰" /></h3>
            <button onClick={() => { setReferralModal(true); setReferralForm({ toDepartment: '', reason: '', urgency: 'ROUTINE' }); }}
              className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200">+ <T k="의뢰" /></button>
          </div>
          {(visit.referrals ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center"><T k="등록된 의뢰 없음" /></p>
          ) : (
            <div className="space-y-1.5">
              {(visit.referrals as any[]).map((ref: any) => (
                <div key={ref.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg text-xs">
                  <div>
                    <span className="font-medium text-gray-700">{ref.toDepartment}</span>
                    <span className="text-gray-400 ml-1.5">{ref.reason}</span>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${
                    ref.urgency === 'URGENT' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                  }`}><T k={ref.urgency === 'URGENT' ? '긴급' : '일반'} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 결과 입력 모달 ── */}
      {resultModal && (() => {
        // 🔴 분해 입력 가능 여부는 **서버가 검사코드로** 정한 `analytes` 로 판단한다.
        //    종전에는 `항목명.startsWith(패널 힌트)` 로 짐작했는데, 접수가 만드는 항목 이름은
        //    프로그램의 묶음 이름('혈액검사 (종합)')이라 운영 38종 중 **한 번도 맞은 적이 없었다**.
        //    그 결과 이 창이 열리지 않아 `testCode` 가 저장되지 않았고, 판정룰이 전부 무발동이었다.
        const analytes: { code: string; name: string; unit?: string }[] = Array.isArray(resultModal.analytes) ? resultModal.analytes : [];
        if (analytes.length > 1) {
          return (
            <Modal title={`분석물 결과 입력 — ${resultModal.name}`} onClose={() => setResultModal(null)}>
              <p className="text-xs text-gray-500 mb-3">분석물별 값을 입력하면 프로토콜 판정룰로 <b>등급이 자동 산정</b>됩니다(빈 칸은 건너뜀 — 입력하지 않은 항목은 판정되지 않습니다).</p>
              <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                {analytes.map((a) => (
                  <div key={a.code} className="flex items-center gap-2">
                    <span className="w-36 text-sm text-gray-700 shrink-0">{a.name}<span className="text-[10px] text-gray-400 ml-1 font-mono">{a.code}</span></span>
                    <input className="flex-1 border rounded-lg px-3 py-1.5 text-sm" placeholder={tAttr('값')}
                      value={panelValues[a.code] ?? ''} onChange={(e) => setPanelValues({ ...panelValues, [a.code]: e.target.value })} />
                    {a.unit && <span className="text-xs text-gray-400 w-14 shrink-0">{a.unit}</span>}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setResultModal(null)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
                <button onClick={() => addPanel.mutate({ category: resultModal.category, parentTestName: resultModal.name, values: Object.fromEntries(Object.entries(panelValues).filter(([, v]) => v?.trim())) })}
                  disabled={addPanel.isPending || !Object.values(panelValues).some((v) => v?.trim())} className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium disabled:opacity-50"><T k="저장·자동판정" /></button>
              </div>
            </Modal>
          );
        }
        return (
        <Modal title={`결과 입력 — ${resultModal.name}`} onClose={() => setResultModal(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="결과값" /></label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('예: 120, 정상')} autoFocus
                  value={resultForm.value} onChange={(e) => setResultForm({ ...resultForm, value: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="단위" /></label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('예: mg/dL, /μL')}
                  value={resultForm.unit} onChange={(e) => setResultForm({ ...resultForm, unit: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="참고 범위" /></label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('예: 70-110, ~40')}
                value={resultForm.referenceRange} onChange={(e) => setResultForm({ ...resultForm, referenceRange: e.target.value })} />
            </div>
            <div>
              {/* 🔴 쓰기 폼의 초기값은 '미선택' — '정상'으로 시작하면 아무도 판정하지 않은 값이
                  결과지·추적 등록의 입력으로 남는다(2026-09-02). 미선택이면 저장을 막는다. */}
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">
                <T k="판정" /> {!resultForm.finding && <span className="text-red-500">· <T k="미선택" /></span>}
              </label>
              <div className="flex gap-2">
                {(['NORMAL', 'ABNORMAL', 'CRITICAL'] as const).map((f) => (
                  <button key={f} onClick={() => setResultForm({ ...resultForm, finding: f })}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                      resultForm.finding === f
                        ? f === 'NORMAL' ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                          : f === 'ABNORMAL' ? 'bg-amber-100 border-amber-300 text-amber-700'
                          : 'bg-red-100 border-red-300 text-red-700'
                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}>
                    <T k={FINDING_LABELS[f].label} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="비고" /></label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('선택 사항')}
                value={resultForm.note} onChange={(e) => setResultForm({ ...resultForm, note: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setResultModal(null)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
            {/* 단일 검사 항목은 그 검사코드를 함께 보낸다 — 서버가 프로토콜 판정룰로 등급을 산정한다 */}
            <button onClick={() => addResult.mutate({ category: resultModal.category, testName: resultModal.name, ...(analytes.length === 1 ? { testCode: analytes[0].code } : {}), ...resultForm })}
              disabled={!resultForm.value || !resultForm.finding}
              title={!resultForm.finding ? tAttr('판정을 선택해야 저장할 수 있습니다') : undefined}
              className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium disabled:opacity-50"><T k="저장" /></button>
          </div>
        </Modal>
        );
      })()}

      {/* ── 추적 등록 모달 ── */}
      {followUpModal && (
        <Modal title={tAttr('추적 관리 등록')} onClose={() => setFollowUpModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block"><T k="유형" /></label>
              <div className="flex gap-2">
                {[{ key: 'RECHECK', label: '재검' }, { key: 'OUTPATIENT', label: '외래' }, { key: 'SCREENING', label: '검진' }].map((t) => (
                  <button key={t.key} onClick={() => setFollowUpForm({ ...followUpForm, followUpType: t.key })}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                      followUpForm.followUpType === t.key ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
                    }`}><T k={t.label} /></button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="내용" /></label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={tAttr('예: 6개월 후 위내시경 추적검사')}
                value={followUpForm.description} onChange={(e) => setFollowUpForm({ ...followUpForm, description: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="예정일" /></label>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                value={followUpForm.dueDate} onChange={(e) => setFollowUpForm({ ...followUpForm, dueDate: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setFollowUpModal(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
            <button onClick={() => createFollowUp.mutate(followUpForm)}
              disabled={!followUpForm.description || !followUpForm.dueDate} className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium disabled:opacity-50"><T k="등록" /></button>
          </div>
        </Modal>
      )}

      {/* ── 외래 의뢰 모달 ── */}
      {referralModal && (
        <Modal title={tAttr('외래 의뢰 생성')} onClose={() => setReferralModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="의뢰과" /></label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={referralForm.toDepartment}
                onChange={(e) => setReferralForm({ ...referralForm, toDepartment: e.target.value })}>
                <option value="">{tAttr('선택')}</option>
                {['소화기내과','순환기내과','호흡기내과','내분비내과','신장내과','외과','정형외과','신경외과',
                  '산부인과','안과','이비인후과','피부과','비뇨의학과','영상의학과','정신건강의학과'].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="의뢰 사유" /></label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} placeholder={tAttr('검진 결과에서 발견된 이상 소견...')}
                value={referralForm.reason} onChange={(e) => setReferralForm({ ...referralForm, reason: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block"><T k="긴급도" /></label>
              <div className="flex gap-2">
                {[{ key: 'ROUTINE', label: '일반' }, { key: 'URGENT', label: '긴급' }].map((u) => (
                  <button key={u.key} onClick={() => setReferralForm({ ...referralForm, urgency: u.key })}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                      referralForm.urgency === u.key
                        ? u.key === 'URGENT' ? 'bg-red-100 border-red-300 text-red-700' : 'bg-blue-100 border-blue-300 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-500'
                    }`}><T k={u.label} /></button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setReferralModal(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
            <button onClick={() => createReferral.mutate(referralForm)}
              disabled={!referralForm.toDepartment || !referralForm.reason}
              className="min-h-[44px] px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium disabled:opacity-50"><T k="의뢰 생성" /></button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── 공통 모달 ──
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── 종합소견 표시 ──
/**
 * 🔴 (2026-09-12) 검진 결과서 버튼 두 개가 `<a href="/api/v1/...">` 였다 — JWT 는 **Authorization 헤더로만** 추출되므로
 *    브라우저가 그냥 여는 이 링크는 토큰을 싣지 않아 **개통 이래 401**이었다(화면은 계속 눌러보라고 했다).
 *    게다가 PDF 경로는 서버에 한글 글꼴이 없어 한글 이름·진단이면 501(종전 500)이다 — 원문 JSON 이 그대로 보이던 자리다.
 *    → 토큰을 실어 부르고, 실패는 **서버가 말한 사유 그대로** 토스트로 말한다(미리보기로 갈 수 있다는 것도 함께).
 */
async function openCheckupResult(visitId: string, format: 'html' | 'pdf', tAttr: (k: string) => string): Promise<void> {
  const token = apiClient.getToken();
  const url = `${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/checkup/visits/${visitId}/result-pdf${format === 'pdf' ? '?format=pdf' : ''}`;
  try {
    const res = await fetch(url, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      // 🔴 실패를 '없음'으로 접지 않는다 — 서버 사유를 그대로 보여준다(501 한글 글꼴 미탑재 등)
      const body = await res.json().catch(() => null);
      const msg = (body as { error?: { message?: string } } | null)?.error?.message;
      toast.error(msg || `${tAttr('결과서를 불러오지 못했습니다')} (HTTP ${res.status})`);
      return;
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    if (format === 'pdf') {
      const a = document.createElement('a');
      a.href = href; a.download = `checkup-result-${visitId.slice(0, 8)}.pdf`; a.click();
    } else {
      window.open(href, '_blank', 'noopener');
    }
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch (e) {
    toast.error((e as Error)?.message || tAttr('결과서를 불러오지 못했습니다'));
  }
}

function SummaryDisplay({ summary }: { summary: any }) {
  const tAttr = useTAttr();
  return (
    <div className="bg-white border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800"><T k="종합소견" /></h2>
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${GRADE_COLORS[summary.overallGrade] ?? 'bg-gray-100 text-gray-500'}`}>
          {summary.overallGrade ? `${summary.overallGrade} · ${GRADE_LABELS[summary.overallGrade] ?? ''}` : <T k="판정 불가(미검사)" />}
        </span>
      </div>
      {summary.sections && (
        <div className="grid grid-cols-4 gap-2">
          {(summary.sections as any[]).map((sec: any, idx: number) => (
            <div key={idx} className={`p-2.5 rounded-lg text-xs ${GRADE_COLORS[sec.grade] ?? 'bg-gray-50 text-gray-500'}`}>
              <div className="font-medium">{sec.area}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-bold"><T k={sec.grade ?? '미판정'} /></span>
                <span className="truncate ml-1 opacity-70 text-[10px]">{sec.findings}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {summary.doctorOpinion && (
        <div className="bg-gray-50 rounded-lg p-3.5">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{summary.doctorOpinion}</p>
        </div>
      )}
      {summary.recommendations && (summary.recommendations as string[]).length > 0 && (
        <div className="bg-blue-50 rounded-lg p-3.5">
          <ul className="list-disc list-inside text-sm text-blue-800 space-y-0.5">
            {(summary.recommendations as string[]).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      {summary.signedAt && summary.doctor && (
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span><T k="서명" />: {summary.doctor.familyName}{summary.doctor.givenName} · {kdate(summary.signedAt, 'datetimeSec')}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => void openCheckupResult(summary.visitId, 'html', tAttr)}
              className="min-h-[44px] px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 font-medium">
              <T k="인쇄 미리보기" />
            </button>
            <button type="button" onClick={() => void openCheckupResult(summary.visitId, 'pdf', tAttr)}
              className="min-h-[44px] px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 font-medium">
              <T k="PDF 다운로드" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 종합소견 작성 폼 ──
function SummaryCreateForm({ visitId }: { visitId: string }) {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [grade, setGrade] = useState('A');
  const [opinion, setOpinion] = useState('');
  const [recommendations, setRecommendations] = useState('');

  const { data: gradeRes } = useQuery({
    queryKey: ['checkup-grade', visitId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/visits/${visitId}/grade-summary`),
  });
  const autoGrade = gradeRes?.data;

  const submit = useMutation({
    mutationFn: (body: any) => apiClient.post(`/api/v1/checkup/visits/${visitId}/summary`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkup-visit', visitId] }); toast.success('소견 저장 완료'); },
  });
  const sign = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/checkup/visits/${visitId}/sign`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkup-visit', visitId] }); toast.success('서명 완료'); },
  });

  const GRADES = ['A', 'B', 'C1', 'C2', 'D1', 'D2'];
  const buildPayload = () => ({
    overallGrade: grade,
    sections: autoGrade?.sections ?? [],
    doctorOpinion: opinion,
    recommendations: recommendations.split('\n').map((s) => s.trim()).filter(Boolean),
  });

  return (
    <div className="bg-white border-2 border-violet-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-violet-700"><T k="종합소견 작성" /></h2>
        {autoGrade && (
          <button onClick={() => setGrade(autoGrade.overallGrade)} disabled={!autoGrade.overallGrade}
            title={!autoGrade.overallGrade ? tAttr('검사 결과가 없어 자동 판정할 수 없습니다') : undefined}
            className="px-3 py-1 bg-violet-50 text-violet-600 rounded-lg text-xs font-medium hover:bg-violet-100">
            {autoGrade.overallGrade ? `자동판정 적용 (${autoGrade.overallGrade})` : <T k="자동판정 불가 — 검사 결과 없음" />}
          </button>
        )}
      </div>
      {autoGrade?.sections && (
        <div className="grid grid-cols-4 gap-2">
          {(autoGrade.sections as any[]).map((sec: any, idx: number) => (
            <div key={idx} className={`p-2 rounded-lg text-xs ${GRADE_COLORS[sec.grade] ?? 'bg-gray-50 text-gray-500'}`}>
              <div className="font-medium">{sec.area}</div>
              <div className="flex justify-between mt-0.5"><span className="font-bold"><T k={sec.grade ?? '미판정'} /></span><span className="truncate ml-1 opacity-70">{sec.findings}{sec.pendingCount > 0 ? ` · 미검사 ${sec.pendingCount}` : ''}</span></div>
            </div>
          ))}
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1.5 block"><T k="종합 등급" /></label>
        <div className="flex gap-1.5">
          {GRADES.map((g) => (
            <button key={g} onClick={() => setGrade(g)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                grade === g ? (GRADE_COLORS[g] ?? '') + ' ring-1 ring-gray-300' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="의사 소견" /></label>
        <textarea className="w-full border rounded-lg p-3 text-sm" rows={3} placeholder={tAttr('종합 소견...')}
          value={opinion} onChange={(e) => setOpinion(e.target.value)} />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="추천사항 (줄바꿈 구분)" /></label>
        <textarea className="w-full border rounded-lg p-3 text-sm" rows={2} placeholder="식이요법&#10;주 3회 운동&#10;6개월 후 재검"
          value={recommendations} onChange={(e) => setRecommendations(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => submit.mutate(buildPayload())}
          className="min-h-[44px] px-3 py-2 bg-violet-600 text-white rounded-xl text-xs font-medium hover:bg-violet-700"><T k="소견 저장" /></button>
        <button onClick={() => submit.mutate(buildPayload(), { onSuccess: () => sign.mutate() })}
          className="min-h-[48px] px-4 py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700"><T k="저장 + 서명" /></button>
      </div>
    </div>
  );
}

/* ── WeRU.B 검진 소견 초안 ── */
function AiCheckupSummaryButton({ visitId, results }: { visitId: string; results: any[] }) {
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      /**
       * 🔴 **AI 에게 사실을 지어내 보내지 않는다**(2026-09-02).
       *    종전 `finding === 'ABNORMAL' ? '이상' : '정상'` 은 `CRITICAL`(위험)·`PENDING`(미검사)·
       *    `NOT_APPLICABLE`(해당없음)을 **전부 '정상'** 으로 바꿔 보냈다 — 위험 판정이 정반대로 뒤집힌다.
       *    판정 어휘는 화면이 이미 쓰는 정본 라벨을 그대로 쓴다.
       */
      const text = results.map((r: any) => {
        const label = FINDING_LABELS[r.finding as keyof typeof FINDING_LABELS]?.label ?? '미판정';
        return `${r.testName ?? r.name}: ${r.value ?? ''} ${r.unit ?? ''} (${label})`;
      }).join('\n');
      const res = await apiClient.post<any>('/api/v1/ai/summarize', { text: `건강검진 결과:\n${text}`, specialty: '건강검진' });
      const s = res?.data?.summary;
      setAiSummary(s ? `소견: ${s.assessment ?? ''}\n계획: ${s.plan ?? ''}` : JSON.stringify(res?.data));
    } catch { setAiSummary(`${AI_ORIGIN_TEXT} 소견 생성 실패`); }
    setLoading(false);
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-indigo-700">{AI_ORIGIN_TEXT} <T k="소견 초안 생성" /></p>
        <button onClick={generate} disabled={loading || results.length === 0}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-medium hover:bg-indigo-700 disabled:opacity-50">
          {loading ? <T k="생성 중..." /> : <>{AI_ORIGIN_TEXT} <T k="소견 생성" /></>}
        </button>
      </div>
      {results.length === 0 && <p className="text-[10px] text-indigo-400">결과 데이터가 없어 {AI_ORIGIN_TEXT} 소견을 생성할 수 없습니다</p>}
      {aiSummary && (
        <div className="mt-2 bg-white rounded-lg p-3 text-xs text-indigo-900 whitespace-pre-wrap border border-indigo-100">
          {aiSummary}
          <p className="text-[11px] text-indigo-500 mt-2">{AI_ORIGIN_TEXT} <T k="참고 초안 — 의사가 검토 후 수정하여 사용하세요" /></p>
        </div>
      )}
    </div>
  );
}

/* ── 문진 응답 뷰어 ── */
function QuestionnaireViewer({ visitId }: { visitId: string }) {
  const { data: res } = useQuery({
    queryKey: ['ck-visit-questionnaire', visitId],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/visits/${visitId}/questionnaire`),
  });
  const template = res?.data?.template;
  const response = res?.data?.response;
  if (!response) return null;

  const answers = (response.answers ?? {}) as Record<string, unknown>;
  const sections = (template?.sections ?? response.questionnaire?.sections ?? []) as any[];

  return (
    <div className="bg-white border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800"><T k="사전 문진 응답" /></h2>
        <span className="text-xs text-gray-400">
          {response.completedAt ? kdate(response.completedAt, 'datetimeSec') : <T k="작성중" />}
        </span>
      </div>
      {sections.map((sec: any, si: number) => (
        <div key={si}>
          <h4 className="text-xs font-semibold text-gray-500 mb-1">{sec.title}</h4>
          <div className="space-y-1">
            {(sec.questions ?? []).map((q: any) => {
              const answer = answers[q.id];
              if (answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0)) return null;
              return (
                <div key={q.id} className="flex items-start gap-2 text-sm">
                  <span className="text-gray-500 min-w-[120px] shrink-0">{q.label}</span>
                  <span className="text-gray-900 font-medium">
                    {Array.isArray(answer) ? (answer as string[]).join(', ')
                      : answer === true ? <T k="예@응답" /> : answer === false ? <T k="아니오" /> : String(answer)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
