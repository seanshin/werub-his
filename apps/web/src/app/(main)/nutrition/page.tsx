'use client';

import { useState } from 'react';
import { dietTypeText } from '@hospital-run/shared';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import NutritionAdvanced from './components/NutritionAdvanced';
import { kstToday } from '@/lib/kst-today';

const MEAL_LABEL: Record<string, string> = { BREAKFAST: '조식', LUNCH: '중식', DINNER: '석식', SNACK: '간식' };
// 식이 라벨 정본은 shared `dietTypeText` — 이 화면의 로컬표는 7종뿐이라 고단백식 등이 영문으로 샜다
const STATUS_COLOR: Record<string, string> = {
  ORDERED: 'bg-blue-50 text-blue-700', PREPARING: 'bg-amber-50 text-amber-700',
  DELIVERED: 'bg-emerald-50 text-emerald-700', CANCELLED: 'bg-gray-100 text-gray-500',
};
const STATUS_LABEL: Record<string, string> = {
  ORDERED: '주문', PREPARING: '조리중', DELIVERED: '배식완료', CANCELLED: '취소',
};

interface MealItem {
  id: string;
  mealType: string;
  dietType: string;
  status: string;
  allergy?: string;
  patient?: { familyName: string; givenName: string };
  /** 배식 확인(5-Rights) — 없으면 null(확인 안 함과 기록 없음은 다른 사실이다) */
  deliveryCheck?: {
    patientVerified: boolean; dietVerified: boolean; allergyVerified: boolean; tempOk: boolean;
    deliveredAt: string; deliveredByName: string | null;
  } | null;
}

interface MealListResponse {
  data: MealItem[];
}

export default function NutritionPage() {
  const tAttr = useTAttr();
  const today = kstToday();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['meals', today],
    queryFn: () => apiClient.get<{ data: MealItem[] }>('/api/v1/nutrition/meals', { date: today }),
  });
  const _mealRaw = data?.data;
  const mealList = Array.isArray(_mealRaw) ? _mealRaw : (_mealRaw as MealListResponse | undefined)?.data ?? [];

  const census = useQuery({
    queryKey: ['meal-census', today],
    queryFn: () => apiClient.get<{ data: { total: number; lowIntakeTotal?: number; dietTotals: Record<string, number>; dietOrderGap?: { withoutOrder: number; admissions: number }; wards: Array<{ ward: string; total: number; byDiet: Record<string, number>; byStatus: Record<string, number>; avgIntake: number | null; lowIntake?: number }> } }>('/api/v1/nutrition/meals/census', { date: today }).then((r) => r.data),
  });

  interface Batch { id: string; mealType: string; dietType: string; plannedQty: number; producedQty?: number | null; allergyNote?: string | null; status: string; inspection?: { pass: boolean } | null; haccp?: { count: number; violation: boolean } }
  const production = useQuery({
    queryKey: ['production', today],
    queryFn: () => apiClient.get<{ data: Batch[] }>('/api/v1/nutrition/production', { date: today }).then((r) => r.data),
  });
  const genProd = useMutation({ mutationFn: () => apiClient.post('/api/v1/nutrition/production/generate', { date: today }), onSuccess: () => production.refetch() });
  const prodStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/nutrition/production/${id}/status`, { status }), onSuccess: () => production.refetch() });
  const inspectMut = useMutation({ mutationFn: ({ id, pass }: { id: string; pass: boolean }) => apiClient.post(`/api/v1/nutrition/production/${id}/inspect`, { pass }), onSuccess: () => production.refetch() });
  const [haccpFor, setHaccpFor] = useState<Batch | null>(null);
  /**
   * 🔴 종전엔 `{ ccpType, value }` 만 보냈다. 서버는 `correctiveAction` 을 받는데 화면이 보내지 않아
   *    **CCP 이탈 기록의 시정조치가 개통 이래 항상 null** 이었다 — HACCP 은 이탈 시 시정조치가
   *    기록되어야 의미가 있는 법정 기록이다.
   */
  const haccpMut = useMutation({
    mutationFn: ({ id, ccpType, value, correctiveAction }: { id: string; ccpType: string; value: number; correctiveAction?: string }) =>
      apiClient.post(`/api/v1/nutrition/production/${id}/haccp`, { ccpType, value, correctiveAction }),
    onSuccess: () => { production.refetch(); haccpLog.refetch(); setHaccpFor(null); },
  });

  /** 🔴 HACCP 일지 — 등록 EP 는 있었으나 **조회 화면이 없었다**(법정 기록을 확인할 수 없었다) */
  const haccpLog = useQuery({
    queryKey: ['haccp-log', today],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; ccpType: string; value: number | null; withinLimit: boolean; correctiveAction: string | null; mealType: string | null; checkedAt: string }> }>('/api/v1/nutrition/haccp', { date: today }).then((r) => r.data),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="영양/급식" /></h2>
        <p className="text-sm text-gray-500 mt-1">{today} <T k="식단 배식 현황" /></p>
      </div>

      {/* 🔴 식이 처방 없이 기본식으로 나가는 환자 — 당뇨·신장 환자가 일반식을 받아도
          종전에는 화면이 아무 말도 하지 않았다. 분모(오늘 급식 대상 환자)와 함께 낸다. */}
      {census.data?.dietOrderGap && census.data.dietOrderGap.admissions > 0 && (
        census.data.dietOrderGap.withoutOrder > 0 ? (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-bold text-amber-900">
              식이 처방 없이 <b>기본 일반식</b>으로 배식되는 환자 {census.data.dietOrderGap.withoutOrder}
              <span className="font-medium">/{census.data.dietOrderGap.admissions}</span>명
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              임상 정본은 <b>활성 식이 처방</b>입니다. 처방이 없으면 기본식이 나가며, 배식은 막지 않습니다 — 처방을 확인하십시오.
            </p>
          </div>
        ) : (
          <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-2.5">
            <p className="text-sm text-emerald-800">
              오늘 급식 대상 {census.data.dietOrderGap.admissions}명 전원이 <b>활성 식이 처방</b> 기준으로 배식됩니다.
            </p>
          </div>
        )
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        {['BREAKFAST', 'LUNCH', 'DINNER'].map((meal) => {
          const count = mealList.filter((m: MealItem) => m.mealType === meal).length ?? 0;
          return (
            <div key={meal} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 mb-1"><T k={MEAL_LABEL[meal]} /></p>
              <p className="text-xl font-bold text-gray-900">{count}<span className="text-sm font-normal text-gray-400 ml-1">식</span></p>
            </div>
          );
        })}
      </div>

      {/* 생산(조리지시서) — 급양과 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-gray-800"><T k="생산 · 조리지시서" /></h3>
          <button onClick={() => genProd.mutate()} disabled={genProd.isPending} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={genProd.isPending ? '산출 중…' : '생산량 산출(식수→배치)'} /></button>
        </div>
        {production.isError ? (
          <QueryErrorFallback error={production.error} onRetry={() => production.refetch()} size="compact" />
        ) : (production.data ?? []).length === 0 ? (
          <p className="text-xs text-gray-400"><T k='배치가 없습니다. "생산량 산출"로 당일 식수를 조리 배치로 전개하세요.' /></p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-100 text-gray-400"><th className="px-2 py-1.5 text-left"><T k="끼니" /></th><th className="px-2 py-1.5 text-left"><T k="식이유형" /></th><th className="px-2 py-1.5 text-right"><T k="생산량" /></th><th className="px-2 py-1.5 text-left"><T k="특이" /></th><th className="px-2 py-1.5 text-left"><T k="상태" /></th><th className="px-2 py-1.5" /></tr></thead>
              <tbody>
                {(production.data ?? []).map((b) => (
                  <tr key={b.id} className="border-b border-gray-50">
                    <td className="px-2 py-1.5"><T k={({ BREAKFAST: '조식', LUNCH: '중식', DINNER: '석식', SNACK: '간식' } as Record<string, string>)[b.mealType] ?? b.mealType} /></td>
                    <td className="px-2 py-1.5 text-gray-700">{b.dietType}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{b.plannedQty}{b.producedQty != null ? ` / ${b.producedQty}` : ''}</td>
                    <td className="px-2 py-1.5 text-red-500">{b.allergyNote ?? ''}</td>
                    <td className="px-2 py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.status === 'DONE' ? 'bg-emerald-100 text-emerald-600' : b.status === 'COOKING' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}><T k={({ PLANNED: '대기', COOKING: '조리중', DONE: '완료' } as Record<string, string>)[b.status] ?? b.status} /></span></td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <span className="flex gap-2 items-center justify-end">
                        {b.status === 'PLANNED' && <button onClick={() => prodStatus.mutate({ id: b.id, status: 'COOKING' })} className="min-h-[44px] px-3 py-2 text-xs font-medium text-blue-600"><T k="조리시작" /></button>}
                        {b.status === 'COOKING' && <button onClick={() => prodStatus.mutate({ id: b.id, status: 'DONE' })} className="min-h-[48px] px-3 py-3 text-sm font-semibold text-emerald-600"><T k="조리완료" /></button>}
                        {b.status === 'DONE' && (b.inspection ? <span className={`text-[10px] ${b.inspection.pass ? 'text-emerald-600' : 'text-red-600'}`}>{b.inspection.pass ? '✓' : '✗'} <T k={b.inspection.pass ? '검식적합' : '부적합'} /></span> : <><button onClick={() => inspectMut.mutate({ id: b.id, pass: true })} className="min-h-[44px] px-3 py-2 text-xs font-medium text-emerald-600"><T k="검식적합" /></button><button onClick={() => inspectMut.mutate({ id: b.id, pass: false })} className="min-h-[44px] px-3 py-2 text-xs font-medium text-red-500"><T k="부적합" /></button></>)}
                        {b.status !== 'PLANNED' && (b.haccp?.violation ? <span className="text-[10px] text-red-600" title={tAttr('CCP 이탈')}>⚠ HACCP</span> : b.haccp?.count ? <span className="text-[10px] text-gray-400">HACCP {b.haccp.count}</span> : null)}
                        {b.status !== 'PLANNED' && <button onClick={() => setHaccpFor(b)} className="text-[11px] text-gray-500">＋CCP</button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 병동별 식수 집계 */}
      {census.data && census.data.wards.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-gray-800"><T k="병동별 식수 집계" /></h3>
            <span className="text-xs text-gray-400"><T k="총" /> {census.data.total}식{census.data.lowIntakeTotal ? <span className="text-red-500 ml-2">· <T k="섭취부진" /> {census.data.lowIntakeTotal}</span> : null}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400">
                  <th className="px-2 py-1.5 text-left"><T k="병동" /></th>
                  <th className="px-2 py-1.5 text-right"><T k="식수" /></th>
                  <th className="px-2 py-1.5 text-left"><T k="식이유형" /></th>
                  <th className="px-2 py-1.5 text-left"><T k="배식 진행" /></th>
                  <th className="px-2 py-1.5 text-right"><T k="평균 섭취" /></th>
                </tr>
              </thead>
              <tbody>
                {census.data.wards.map((w) => (
                  <tr key={w.ward} className="border-b border-gray-50">
                    <td className="px-2 py-1.5 font-medium text-gray-700">{w.ward}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{w.total}</td>
                    <td className="px-2 py-1.5 text-gray-500">{Object.entries(w.byDiet).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d, c]) => `${d} ${c}`).join(' · ')}</td>
                    <td className="px-2 py-1.5 text-gray-500">{['DELIVERED', 'COMPLETED', 'PREPARED', 'ORDERED'].filter((s) => w.byStatus[s]).map((s) => `${({ ORDERED: '대기', PREPARED: '조리', DELIVERED: '배식', COMPLETED: '완료', PARTIAL: '일부', REFUSED: '거부' } as Record<string, string>)[s] ?? s} ${w.byStatus[s]}`).join(' · ')}</td>
                    <td className="px-2 py-1.5 text-right">{w.avgIntake != null ? `${w.avgIntake}%` : '-'}{w.lowIntake ? <span className="text-red-500 ml-1">·<T k="부진" /> {w.lowIntake}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="식이종류" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="끼니" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="알레르기" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              {/* 🔴 배식 확인(5-Rights)은 원장에 남는데 읽는 곳이 없었다(2026-09-02) — 여기서도 보인다 */}
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="배식 확인" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !mealList.length ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.38a48.474 48.474 0 00-6-.37c-2.032 0-4.034.126-6 .37m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.17c0 .62-.504 1.124-1.125 1.124H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265z" />
                  </svg>
                  <p className="text-sm text-gray-400"><T k="오늘 급식 주문이 없습니다" /></p>
                </td>
              </tr>
            ) : (
              mealList.map((m: MealItem) => (
                <tr key={m.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="px-5 py-4 font-medium text-gray-900">{m.patient?.familyName}{m.patient?.givenName}</td>
                  <td className="px-5 py-4 text-gray-700">{dietTypeText(m.dietType)}</td>
                  <td className="px-5 py-4 text-gray-600"><T k={MEAL_LABEL[m.mealType] ?? m.mealType} /></td>
                  <td className="px-5 py-4 text-gray-500 text-xs">{m.allergy || '-'}</td>
                  <td className="px-5 py-4">
                    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[m.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      <T k={STATUS_LABEL[m.status] ?? m.status} />
                    </span>
                  </td>
                  <td className="px-5 py-4"><DeliveryCheckCell c={m.deliveryCheck} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <HaccpLog rows={haccpLog.data} isLoading={haccpLog.isLoading} isError={haccpLog.isError} onRetry={() => haccpLog.refetch()} />

      <NutritionAdvanced />
      {haccpFor && <HaccpModal batch={haccpFor} onClose={() => setHaccpFor(null)}
        onSubmit={(ccpType, value, correctiveAction) => haccpMut.mutate({ id: haccpFor.id, ccpType, value, correctiveAction })}
        busy={haccpMut.isPending} />}
    </div>
  );
}

const CCP_TYPES: { key: string; label: string; unit: string; hint: string }[] = [
  { key: 'HEATING', label: '가열 중심온도', unit: '℃', hint: '기준 ≥75℃' },
  { key: 'HOT', label: '온장 보관', unit: '℃', hint: '기준 ≥57℃' },
  { key: 'COLD', label: '냉장 보관', unit: '℃', hint: '기준 ≤5℃' },
  { key: 'TIME', label: '조리→배식 소요', unit: '분', hint: '기준 ≤120분' },
];
function HaccpModal({ batch, onClose, onSubmit, busy }: { batch: { mealType: string; dietType: string }; onClose: () => void; onSubmit: (ccpType: string, value: number, correctiveAction?: string) => void; busy: boolean }) {
  const tAttr = useTAttr();
  const [ccpType, setCcpType] = useState('HEATING');
  const [value, setValue] = useState('');
  const [action, setAction] = useState('');
  const ccp = CCP_TYPES.find((c) => c.key === ccpType)!;
  const num = parseFloat(value);
  const ok = ccpType === 'HEATING' ? num >= 75 : ccpType === 'HOT' ? num >= 57 : ccpType === 'COLD' ? num <= 5 : num <= 120;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1"><T k="HACCP CCP 기록" /></h3>
        <p className="text-xs text-gray-400 mb-3"><T k={({ BREAKFAST: '조식', LUNCH: '중식', DINNER: '석식', SNACK: '간식' } as Record<string, string>)[batch.mealType] ?? batch.mealType} /> · {batch.dietType}</p>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {CCP_TYPES.map((c) => (
            <button key={c.key} onClick={() => setCcpType(c.key)} className={`py-2 rounded-lg text-xs font-medium ${ccpType === c.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k={c.label} /></button>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-1">
          <input type="number" step="0.1" value={value} onChange={(e) => setValue(e.target.value)} placeholder={tAttr('측정값')} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <span className="text-sm text-gray-500">{ccp.unit}</span>
        </div>
        <p className={`text-[11px] mb-3 ${value === '' ? 'text-gray-400' : ok ? 'text-emerald-600' : 'text-red-600'}`}><T k={ccp.hint} />{value !== '' && <> · <T k={ok ? '적합' : '이탈(시정조치 필요)'} /></>}</p>

        {/* 🔴 이탈이면 시정조치를 받는다. 비어 있어도 저장은 막지 않되(막으면 아무 값이나 넣는다)
            일지에 '시정조치 미기록'으로 **드러나게** 남긴다. */}
        {value !== '' && !Number.isNaN(num) && !ok && (
          <div className="mb-3">
            <label className="block text-[11px] font-medium text-red-700 mb-1"><T k="시정조치 (HACCP 이탈 시 기록 대상)" /></label>
            <textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)}
              placeholder={tAttr('예: 재가열 후 중심온도 78℃ 확인, 해당 배치 폐기')}
              className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm" />
            {!action.trim() && <p className="text-[11px] text-red-600 mt-1">비워 두면 일지에 <b>시정조치 미기록</b>으로 남습니다.</p>}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => onSubmit(ccpType, num, action.trim() || undefined)} disabled={busy || value === '' || Number.isNaN(num)} className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-blue-600 text-white font-medium disabled:opacity-50"><T k={busy ? '기록 중…' : '기록@버튼'} /></button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600"><T k="닫기" /></button>
        </div>
      </div>
    </div>
  );
}

/**
 * HACCP 일지 — 🔴 등록 EP(`POST production/:id/haccp`)와 조회 EP(`GET nutrition/haccp`)는 있었는데
 * **조회 화면이 어디에도 없었다**(2026-08-21 실측: 호출부 0). 급양과가 법정 기록을 확인할 수 없었다.
 * 이탈과 **시정조치 미기록**을 각각 드러낸다 — 이탈만 세면 "기록은 했다"로 읽힌다.
 */
/**
 * 배식 확인(5-Rights) 셀 — 확인한 것과 **확인하지 않은 것**을 함께 보인다.
 * 🔴 기록이 아예 없는 것(`null`)과 확인하지 않은 것(`false`)은 다른 사실이라 다르게 그린다.
 */
function DeliveryCheckCell({ c }: { c: MealItem['deliveryCheck'] }) {
  const tAttrCell = useTAttr();
  if (!c) return <span className="text-xs text-gray-300"><T k="기록 없음" /></span>;
  const ITEMS: [boolean, string][] = [
    [c.patientVerified, '본인'], [c.dietVerified, '식이'], [c.allergyVerified, '알레르기'], [c.tempOk, '온도'],
  ];
  return (
    <div className="text-[11px] leading-tight">
      <div className="flex flex-wrap gap-x-1.5">
        {ITEMS.map(([ok, label]) => (
          <span key={label} className={ok ? 'text-emerald-600' : 'text-gray-400 line-through'}>{ok ? '✓' : '✗'}<T k={label} /></span>
        ))}
      </div>
      {/* 🔴 시각 표시는 정본(KDate) — raw toLocaleTimeString 은 구조 가드가 기준선으로 막는다 */}
      <div className="text-gray-400 mt-0.5">
        {c.deliveredByName ?? <T k="배식자 미상" />} · <KDate value={c.deliveredAt} mode="time" fallback={tAttrCell('시각 미상')} />
      </div>
    </div>
  );
}

function HaccpLog({ rows, isLoading, isError, onRetry }: {
  rows?: Array<{ id: string; ccpType: string; value: number | null; withinLimit: boolean; correctiveAction: string | null; mealType: string | null; checkedAt: string }>;
  isLoading: boolean; isError: boolean; onRetry: () => void;
}) {
  const tAttr = useTAttr();
  const CCP_LABEL: Record<string, { label: string; unit: string }> = {
    HEATING: { label: '가열 중심온도', unit: '℃' },
    HOT: { label: '온장 보관', unit: '℃' },
    COLD: { label: '냉장 보관', unit: '℃' },
    TIME: { label: '조리→배식 소요', unit: '분' },
  };
  const list = rows ?? [];
  const violations = list.filter((r) => !r.withinLimit);
  const unresolved = violations.filter((r) => !r.correctiveAction?.trim());

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 mt-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h2 className="text-sm font-bold text-gray-900"><T k="HACCP 일지 (오늘)" /></h2>
        {!isLoading && !isError && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"><T k="기록@명사" /> {list.length}건</span>
            <span className={`px-2 py-0.5 rounded-full ${violations.length ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              <T k="이탈" /> {violations.length}/{list.length}
            </span>
            {unresolved.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold" title={tAttr('이탈했는데 시정조치가 기록되지 않았습니다')}>
                <T k="시정조치 미기록" /> {unresolved.length}
              </span>
            )}
          </div>
        )}
      </div>

      {isError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-amber-900">HACCP 일지를 불러오지 못했습니다 — <b>기록이 없다는 뜻이 아닙니다.</b></p>
          <button onClick={onRetry} className="mt-1.5 px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-[11px] text-amber-800"><T k="다시 시도" /></button>
        </div>
      ) : isLoading ? (
        <p className="text-xs text-gray-400 py-3"><T k="불러오는 중…" /></p>
      ) : list.length === 0 ? (
        <p className="text-xs text-gray-400 py-3"><T k="오늘 기록된 CCP 측정이 없습니다." /></p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-gray-400">
            <tr className="border-b border-gray-100">
              <th className="text-left py-1.5"><T k="시각" /></th><th className="text-left">CCP</th>
              <th className="text-right"><T k="측정값" /></th><th className="text-left pl-3"><T k="판정" /></th>
              <th className="text-left"><T k="시정조치" /></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const c = CCP_LABEL[r.ccpType] ?? { label: r.ccpType, unit: '' };
              return (
                <tr key={r.id} className={`border-b border-gray-50 ${!r.withinLimit ? 'bg-red-50/40' : ''}`}>
                  {/* 🔴 날짜·시각 표기는 정본(`KDate`)으로 — 화면마다 포맷을 직접 부르면 표기가 갈라진다 */}
                  <td className="py-1.5 text-gray-500 tabular-nums"><KDate value={r.checkedAt} mode="time" /></td>
                  <td className="text-gray-800"><T k={c.label} /></td>
                  <td className="text-right tabular-nums text-gray-900 font-medium">{r.value ?? '-'}{r.value != null && c.unit}</td>
                  <td className="pl-3">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${r.withinLimit ? 'bg-emerald-50 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      <T k={r.withinLimit ? '적합' : '이탈'} />
                    </span>
                  </td>
                  <td className="text-gray-700">
                    {r.withinLimit ? <span className="text-gray-300">-</span>
                      : r.correctiveAction?.trim() ? r.correctiveAction
                      : <span className="text-amber-700 font-semibold"><T k="미기록" /></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
