'use client';

import { Term } from '@/components/ui/term';
import { kdate } from '@/lib/ui-settings';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { extractErrorMessage } from '@/lib/error-utils';

import { EmptyState, DrugName } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface CodeItem { id: string; code: string; nameKo: string; nameEn?: string | null; ingredient?: string | null; dosageForm?: string }
interface DurWarning { severity?: string; type?: string; message?: string }
interface PreOrderItem {
  id: string;
  type: string;
  status: string;
  dosage?: string; frequency?: string; duration?: number; quantity?: number; route?: string;
  reason?: string;
  scheduledDate?: string;
  expiresAt?: string;
  createdAt: string;
  source?: string; // MANUAL | LIS_REFLEX
  instructions?: string;
  activationMode?: string; // ON_APPROVAL | ON_CHECKIN
  recurringGroupId?: string | null; // 반복 그룹
  appointment?: { id: string; scheduledAt: string; status: string } | null;
  durSnapshot?: DurWarning[] | null;
  doctor?: { familyName?: string; givenName?: string };
  medicationCode?: { code?: string; nameKo?: string; nameEn?: string | null; ingredient?: string | null };
  procedureCode?: { code?: string; nameKo?: string };
}

const TYPE_LABEL: Record<string, string> = { MEDICATION: '약처방', LAB: '검사', IMAGING: '영상', THERAPY: '치료', DIET: '식이', ACTIVITY: '활동', NURSING: '간호' };
const CODE_SEARCH_TYPES = new Set(['MEDICATION', 'LAB', 'IMAGING', 'THERAPY']); // 코드 검색 필수 — 식이/활동/간호는 지시 텍스트
const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '대기', cls: 'bg-blue-50 text-blue-700' },
  MODIFIED: { label: '수정됨', cls: 'bg-amber-50 text-amber-700' },
  APPROVED: { label: '승인(처방 전환)', cls: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { label: '취소', cls: 'bg-gray-100 text-gray-500' },
  EXPIRED: { label: '만료', cls: 'bg-red-50 text-red-500' },
};

/**
 * 승인할 진료 — `patients/:id/order-encounter`(재원 입원 → 오늘 진료) 정본.
 * 🔴 (2026-10-07) 의사 할 일함의 "차트에서 승인"이 이 탭으로 오는데 **여기엔 승인이 없었다**(작성·취소만) — 막다른 길.
 *    승인은 진료에 묶여 처방이 생긴다(`approve {encounterId}`) → 진행 중 진료가 있을 때만 승인하고, 어디에 붙는지 말한다.
 */
type OrderEncounter = { encounterId: string | null; context: 'ADMISSION' | 'TODAY' | null; doctorName: string | null };

export function PreOrderTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  // 승인 EP 는 의사·관리자(서버 @Roles) — 그 밖 역할은 진행 중 진료도 부르지 않는다
  const canApprove = useHasRole('DOCTOR');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pre-orders', patientId],
    queryFn: () => apiClient.get<{ data: { data?: PreOrderItem[] } | PreOrderItem[] }>(`/api/v1/pre-orders`, { patientId }),
  });
  // 서비스가 {data:[...]}를 반환하고 컨트롤러가 한 번 더 감싸는 이중 래핑 언랩
  const raw = data?.data as unknown;
  const items: PreOrderItem[] = Array.isArray(raw)
    ? raw as PreOrderItem[]
    : ((raw as { data?: PreOrderItem[] })?.data ?? []);

  const cancelMut = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: string }) =>
      apiClient.patch(`/api/v1/pre-orders/${id}/cancel${scope ? `?scope=${scope}` : ''}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pre-orders', patientId] }); toast.success('사전처방을 취소했습니다'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '취소 실패'),
  });
  const handleCancel = (it: PreOrderItem) => {
    // 반복 그룹이면 범위 확인 — 확인=그룹 미결 전체, 취소=이 회차만
    const scope = it.recurringGroupId && window.confirm('반복 사전처방입니다. 그룹의 미결 회차를 전부 취소할까요?\n(취소를 누르면 이 회차만 취소)')
      ? 'group' : undefined;
    cancelMut.mutate({ id: it.id, scope });
  };

  const hasPending = items.some((it) => it.status === 'PENDING' || it.status === 'MODIFIED');
  const enc = useQuery({
    queryKey: ['order-encounter', patientId],
    queryFn: async () => {
      const r = await apiClient.get<{ data: OrderEncounter }>(`/api/v1/patients/${patientId}/order-encounter`);
      return ((r?.data as unknown as { data?: OrderEncounter })?.data ?? r?.data) as OrderEncounter;
    },
    enabled: canApprove && hasPending,
  });
  const approveMut = useMutation({
    mutationFn: (id: string) => apiClient.patch<{ data?: { data?: { durCheck?: { status?: string } }; durCheck?: { status?: string } } }>(`/api/v1/pre-orders/${id}/approve`, { encounterId: enc.data?.encounterId }),
    onSuccess: (res) => {
      toast.success(tAttr('사전처방을 승인했습니다 — 처방이 생겼습니다'));
      // 승인 시점 DUR 재검증 실패는 서버가 막지 않고 FAILED 로 남긴다 — "경고 없음"으로 보이지 않게(진료 화면 배너와 같은 처리)
      const durStatus = res?.data?.data?.durCheck?.status ?? res?.data?.durCheck?.status;
      if (durStatus === 'FAILED') toast.warning(tAttr('DUR 재검증을 하지 못한 채 승인되었습니다 — 처방 화면에서 DUR 을 다시 확인하세요'));
      qc.invalidateQueries({ queryKey: ['pre-orders', patientId] });
      qc.invalidateQueries({ queryKey: ['my-pre-orders-pending'] });
    },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('사전처방 승인 실패')),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />;

  // 약품은 <DrugName>(영문 모드: 상품명→라틴 성분명→한글+미등록 티). 비약품(ProcedureCode)은 영문명 필드가
  // 없어 한글 그대로 — 지어내지 않는다.
  const codeName = (it: PreOrderItem) => it.medicationCode
    ? <DrugName nameKo={it.medicationCode.nameKo} nameEn={it.medicationCode.nameEn} ingredient={it.medicationCode.ingredient} code={it.medicationCode.code} />
    : (it.procedureCode?.nameKo ?? '-');

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900"><T k="사전처방 (Pre-Order)" /></h3>
          <p className="text-[11px] text-gray-400 mt-0.5"><T k="차기 진료·검사를 대비해 미리 작성 — 발효는 진료 중 의사 승인 시(DUR 재검증)" /></p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="+ 사전처방 작성" /></button>
      </div>

      {canApprove && hasPending && (
        <p className={`rounded-lg px-3 py-2 text-xs ${enc.data?.encounterId ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`} data-preorder-approve-target={enc.data?.context ?? (enc.isError ? 'ERROR' : enc.isLoading ? 'LOADING' : 'NONE')}>
          {enc.isLoading ? <T k="승인할 진행 중 진료를 확인하는 중…" />
            : enc.isError ? <T k="진행 중 진료를 확인하지 못했습니다 — 승인할 수 없습니다" />
              : enc.data?.encounterId
                ? <><T k={enc.data.context === 'ADMISSION' ? '승인하면 재원 중인 입원 진료에 처방이 생깁니다' : '승인하면 오늘 진료에 처방이 생깁니다'} />{enc.data.doctorName ? <> · <T k="담당" /> {enc.data.doctorName}</> : null}</>
                : <T k="진행 중인 진료가 없어 승인할 수 없습니다 — 입원 중이 아니고 오늘 진료도 없습니다. 진료를 연 뒤 승인하세요." />}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState icon="💊" title="사전처방이 없습니다." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs text-gray-400 pb-2 w-[70px]"><T k="유형" /></th>
              <th className="text-left text-xs text-gray-400 pb-2"><T k="항목" /></th>
              <th className="text-left text-xs text-gray-400 pb-2 w-[90px]"><T k="예정일" /></th>
              <th className="text-left text-xs text-gray-400 pb-2 w-[110px]"><T k="상태" /></th>
              <th className="text-left text-xs text-gray-400 pb-2 w-[90px]">작성의</th>
              <th className="text-right text-xs text-gray-400 pb-2 w-[110px]"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => {
              const sm = STATUS_META[it.status] ?? { label: it.status, cls: 'bg-gray-100 text-gray-600' };
              const durWarn = (it.durSnapshot ?? []).length;
              return (
                <tr key={it.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{TYPE_LABEL[it.type] ?? it.type}</td>
                  <td className="py-2">
                    <p className="font-medium text-gray-900">{codeName(it)}
                      {it.source === 'LIS_REFLEX' && <span className="ml-1.5 text-[10px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded" title={tAttr("LIS reflex 발신 오더 — 승인 시 정식 처방 전환")}>LIS</span>}
                      {it.activationMode === 'ON_CHECKIN' && <span className="ml-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded" title={tAttr("접수 시 자동 시행 (검사 선행)")}><T k="자동" /></span>}
                      {it.recurringGroupId && <span className="ml-1.5 text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded" title={tAttr("반복 사전처방 — 취소 시 그룹 일괄 취소 선택 가능")}><T k="↻ 반복" /></span>}
                      {durWarn > 0 && <span className="ml-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded" title={tAttr("작성 시점 DUR 경고 — 승인 시 재검증")}>DUR {durWarn}</span>}
                    </p>
                    {it.type === 'MEDICATION' && (
                      <p className="text-[11px] text-gray-400">{it.dosage ?? ''} {it.frequency ?? ''}{it.duration ? ` · ${it.duration}일` : ''}</p>
                    )}
                    {it.reason && <p className="text-[11px] text-gray-400">사유: {it.reason}</p>}
                  </td>
                  <td className="py-2 text-xs text-gray-500 whitespace-nowrap">
                    {it.appointment
                      ? <span className="text-blue-600" title={tAttr("연계 예약에서 시행")}>📅 {it.appointment.scheduledAt.slice(0, 10)}</span>
                      : <span className="font-mono">{it.scheduledDate ? it.scheduledDate.slice(0, 10) : '-'}</span>}
                  </td>
                  <td className="py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${sm.cls}`}>{sm.label}</span></td>
                  <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{it.doctor ? `${it.doctor.familyName ?? ''}${it.doctor.givenName ?? ''}` : '-'}</td>
                  <td className="py-2 text-right">
                    {(it.status === 'PENDING' || it.status === 'MODIFIED') && canApprove && (
                      <button onClick={() => approveMut.mutate(it.id)} disabled={!enc.data?.encounterId || approveMut.isPending} data-preorder-approve={it.id}
                        className="mr-1 min-h-[44px] text-[11px] px-3 py-1 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-40"><T k="승인" /></button>
                    )}
                    {(it.status === 'PENDING' || it.status === 'MODIFIED') && (
                      <button onClick={() => handleCancel(it)}
                        className="text-[11px] px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600"><T k="취소" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showCreate && (
        <PreOrderCreateModal patientId={patientId} onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['pre-orders', patientId] }); }} />
      )}
    </div>
  );
}

export function PreOrderCreateModal({ patientId, onClose, onCreated }: { patientId: string; onClose: () => void; onCreated: () => void }) {
  const tAttr = useTAttr();
  const [type, setType] = useState<string>('LAB');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeItem[]>([]);
  const [selected, setSelected] = useState<CodeItem | null>(null);
  const [instructions, setInstructions] = useState(''); // 식이/활동/간호 — 지시 텍스트
  const [med, setMed] = useState({ dosage: '', frequency: '1일 3회', duration: 5, quantity: 15, route: '경구' });
  const [scheduledDate, setScheduledDate] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [onCheckin, setOnCheckin] = useState(false); // 접수 시 자동 시행 (비약물+연계예약 시)
  const [recurEvery, setRecurEvery] = useState(''); // P3 반복 — 매 N일
  const [recurCount, setRecurCount] = useState(''); // P3 반복 — 총 M회
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const needsCode = CODE_SEARCH_TYPES.has(type);

  // 연계 가능한 예정 예약 ("이 재진에서 시행")
  const { data: apptData } = useQuery({
    queryKey: ['patient-upcoming-appts', patientId],
    queryFn: () => apiClient.get<{ data: { id: string; scheduledAt: string; status: string; doctor?: { familyName?: string; givenName?: string } }[] }>(
      '/api/v1/appointments', { patientId }),
  });
  const apptRaw = apptData?.data as unknown;
  const upcomingAppts = (Array.isArray(apptRaw) ? apptRaw : (apptRaw as { data?: unknown[] })?.data ?? [])
    .filter((a): a is { id: string; scheduledAt: string; status: string; doctor?: { familyName?: string; givenName?: string } } => {
      const appt = a as { scheduledAt?: string; status?: string };
      return !!appt.scheduledAt && new Date(appt.scheduledAt).getTime() > Date.now() && ['SCHEDULED', 'CONFIRMED'].includes(appt.status ?? '');
    })
    .slice(0, 10);

  const search = (q: string) => {
    setQuery(q);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const endpoint = type === 'MEDICATION' ? '/api/v1/codes/medication' : '/api/v1/codes/procedure';
        const res = await apiClient.get<{ data: CodeItem[] }>(endpoint, { q: q.trim() });
        const raw = res.data as unknown;
        setResults(Array.isArray(raw) ? raw as CodeItem[] : (raw as { data?: CodeItem[] })?.data ?? []);
      } catch { setResults([]); }
    }, 300);
  };

  const submit = async () => {
    if (needsCode && !selected) { toast.error('항목 코드를 선택하세요'); return; }
    if (!needsCode && !instructions.trim()) { toast.error('지시 내용을 입력하세요'); return; }
    setSaving(true);
    try {
      const res = await apiClient.post<{ data: { data?: { durSnapshot?: DurWarning[] } } }>('/api/v1/pre-orders', {
        patientId,
        type,
        ...(type === 'MEDICATION'
          ? { medicationCodeId: selected!.id, ...med }
          : needsCode
            ? { procedureCodeId: selected!.id }
            : { instructions: instructions.trim() }),
        ...(scheduledDate ? { scheduledDate } : {}),
        ...(appointmentId ? { appointmentId } : {}),
        ...(onCheckin && appointmentId && (type === 'LAB' || type === 'IMAGING') ? { activationMode: 'ON_CHECKIN' } : {}),
        ...(scheduledDate && Number(recurEvery) > 0 && Number(recurCount) > 1 && !onCheckin
          ? { recurEvery: Number(recurEvery), recurCount: Number(recurCount) } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      const created = (res.data as { data?: { durSnapshot?: DurWarning[] } })?.data ?? res.data as { durSnapshot?: DurWarning[] };
      const warns = (created?.durSnapshot ?? []) as DurWarning[];
      toast.success('사전처방을 작성했습니다');
      if (warns.length) toast.error(`DUR 경고 ${warns.length}건 — 승인 시 재검증됩니다: ${warns.slice(0, 2).map(w => w.message).join(' / ')}`);
      onCreated();
    } catch (e) { toast.error((e as { message?: string })?.message || '작성 실패'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900"><T k="사전처방 작성" /></h3>

        <div className="flex gap-1.5 flex-wrap">
          {(['LAB', 'IMAGING', 'THERAPY', 'MEDICATION', 'DIET', 'ACTIVITY', 'NURSING'] as const).map(t => (
            <button key={t} onClick={() => { setType(t); setQuery(''); setResults([]); setSelected(null); setInstructions(''); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg ${type === t ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        {needsCode ? (
        <div className="space-y-1">
          <label className="text-xs text-gray-500"><T k="항목 검색" /></label>
          <input value={selected ? `${selected.nameKo} (${selected.code})` : query} onChange={e => search(e.target.value)}
            placeholder={type === 'MEDICATION' ? '약품명 검색 (2자 이상)' : '검사/영상/치료 항목명 검색 (2자 이상)'}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-300 focus:outline-none" />
          {!selected && results.length > 0 && (
            <div className="border border-gray-100 rounded-lg max-h-44 overflow-y-auto divide-y divide-gray-50">
              {results.slice(0, 8).map(c => (
                <button key={c.id} onClick={() => { setSelected(c); setResults([]); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-violet-50">
                  {/* 🔴 약품은 <DrugName> — <Term> 은 성분명 폴백이 없어 영문 모드에서 약 99.8% 가 'EN×' 였다
                      (상품명 nameEn 0.2%·성분 98.2%). 검사/영상/치료(ProcedureCode)는 영문명이 없어 <Term> 그대로. */}
                  <span className="font-medium text-gray-900">{type === 'MEDICATION'
                    ? <DrugName nameKo={c.nameKo} nameEn={c.nameEn} ingredient={c.ingredient} code={c.code} />
                    : <Term nameKo={c.nameKo} nameEn={c.nameEn} />}</span>
                  <span className="ml-2 font-mono text-gray-400">{c.code}</span>
                  {c.dosageForm && <span className="ml-1 text-gray-400">{c.dosageForm}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        ) : (
        <div className="space-y-1">
          <label className="text-xs text-gray-500">지시 내용 ({TYPE_LABEL[type]})</label>
          <input value={instructions} onChange={e => setInstructions(e.target.value)}
            placeholder={type === 'DIET' ? '예: 당뇨식이 1800kcal' : type === 'ACTIVITY' ? '예: 절대안정' : '예: 낙상주의 간호'}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-300 focus:outline-none" />
        </div>
        )}

        {upcomingAppts.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-gray-500"><T k="연계 예약 (선택 — 이 재진에서 시행)" /></label>
            <select value={appointmentId} onChange={e => setAppointmentId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value=""><T k="연계 안 함" /></option>
              {upcomingAppts.map(a => (
                <option key={a.id} value={a.id}>
                  {kdate(a.scheduledAt, 'datetimeShort')}
                  {a.doctor ? ` — ${a.doctor.familyName ?? ''}${a.doctor.givenName ?? ''}` : ''}
                </option>
              ))}
            </select>
            {appointmentId && (type === 'LAB' || type === 'IMAGING') && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer pt-1">
                <input type="checkbox" checked={onCheckin} onChange={e => setOnCheckin(e.target.checked)} />
                <T k="접수 시 자동 시행 (검사 선행) — 예약 접수되면 승인 없이 검사 오더로 전환" />
                <span className="text-gray-400"><T k="(비약물 한정·기능 게이트 필요)" /></span>
              </label>
            )}
          </div>
        )}

        {type === 'MEDICATION' && (
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-gray-500"><T k="용량" /></label>
              <input value={med.dosage} onChange={e => setMed({ ...med, dosage: e.target.value })} placeholder={tAttr("예: 500mg")}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
            <div><label className="text-xs text-gray-500"><T k="횟수" /></label>
              <input value={med.frequency} onChange={e => setMed({ ...med, frequency: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
            <div><label className="text-xs text-gray-500"><T k="일수" /></label>
              <input type="number" value={med.duration} onChange={e => setMed({ ...med, duration: Number(e.target.value) })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
            <div><label className="text-xs text-gray-500"><T k="투여" /></label>
              <input value={med.route} onChange={e => setMed({ ...med, route: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500"><T k="예정일 (선택)" /></label>
            <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
          <div><label className="text-xs text-gray-500"><T k="사유 (선택)" /></label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder={tAttr("예: 재진 시 추적검사")}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm" /></div>
        </div>

        {scheduledDate && !onCheckin && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500"><T k="↻ 반복 (선택)" /></label>
            <span className="text-[11px] text-gray-400">매</span>
            <input type="number" value={recurEvery} onChange={e => setRecurEvery(e.target.value)} placeholder="N"
              min={1} max={90} className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
            <span className="text-[11px] text-gray-400">일 ×</span>
            <input type="number" value={recurCount} onChange={e => setRecurCount(e.target.value)} placeholder="M"
              min={2} max={12} className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
            <span className="text-[11px] text-gray-400">회 — 예정일부터 회차별 생성 (매 회차 의사 승인)</span>
          </div>
        )}

        <p className="text-[11px] text-gray-400 bg-gray-50 rounded-lg p-2">
          <T k="사전처방은 즉시 발효되지 않습니다 — 차기 진료 중 의사 승인 시 처방·오더로 전환되며, 승인 시점에 DUR을 재검증합니다. 미승인 건은 90일 후 자동 만료." />
        </p>

        <div className="flex gap-2 justify-end pt-1 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="닫기" /></button>
          <button onClick={submit} disabled={saving || (needsCode ? !selected : !instructions.trim())}
            className="px-4 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
            {saving ? '저장 중...' : '작성'}
          </button>
        </div>
      </div>
    </div>
  );
}
