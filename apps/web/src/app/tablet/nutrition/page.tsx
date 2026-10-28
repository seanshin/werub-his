'use client';

import { useEffect, useState } from 'react';
import { mealOrderStatusText, MEAL_UNDELIVERED_REASON_PRESET } from '@hospital-run/shared';
import { KDate, Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';
import { kstToday } from '@/lib/kst-today';

interface Meal {
  id: string; admissionId: string; patientId: string; mealType: string; dietType: string;
  allergies?: string | null; status: string; wardName?: string | null; intakePercent?: number | null;
  patient?: { familyName?: string; givenName?: string };
  /** 배식 확인(5-Rights) 기록 — 없으면 null(확인 안 한 것과 기록이 아예 없는 것을 구분한다) */
  deliveryCheck?: {
    patientVerified: boolean; dietVerified: boolean; allergyVerified: boolean; tempOk: boolean;
    deliveredAt: string; deliveredByName: string | null;
  } | null;
}

const MEAL_LABEL: Record<string, string> = { BREAKFAST: '조식', LUNCH: '중식', DINNER: '석식', SNACK: '간식' };
/**
 * 🔴 라벨은 shared 정본(`MEAL_ORDER_STATUS_LABEL`)에서 온다 — 화면이 다시 적으면 조용히 드리프트한다
 *    (UX 규약: 상태 라벨/색 로컬 Record 재정의 금지). 색만 이 화면의 표현 관심사로 남긴다.
 */
const STATUS_CLS: Record<string, string> = {
  ORDERED: 'bg-gray-100 text-gray-600',
  PREPARED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  PARTIAL: 'bg-teal-100 text-teal-700',
  REFUSED: 'bg-red-100 text-red-600',
  UNDELIVERED: 'bg-gray-200 text-gray-500',
};
const statusOf = (s: string) => ({ label: mealOrderStatusText(s), cls: STATUS_CLS[s] ?? 'bg-gray-100 text-gray-600' });
const UNDELIVER_REASONS = MEAL_UNDELIVERED_REASON_PRESET;

export default function TabletNutritionPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, isAuthenticated, loadProfile } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [mealType, setMealType] = useState('BREAKFAST');
  const [intakeFor, setIntakeFor] = useState<Meal | null>(null);
  const [undeliverFor, setUndeliverFor] = useState<Meal | null>(null);
  const [deliverFor, setDeliverFor] = useState<Meal | null>(null);

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/staff/login'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/staff/login'); return; } }
      setReady(true);
    })();
  }, [isAuthenticated, user, loadProfile, router]);

  const today = kstToday();
  const q = useQuery({
    queryKey: ['tablet-meals', today],
    queryFn: () => apiClient.get<{ data: Meal[] | { data: Meal[] } }>(`/api/v1/nutrition/meals?date=${today}`).then((r) => { const d = r.data; return Array.isArray(d) ? d : (d?.data ?? []); }),
    enabled: ready,
    refetchInterval: 15000,
  });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/nutrition/meals/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tablet-meals', today] }),
  });
  const deliverMut = useMutation({
    // 🔴 종전엔 `patientVerified: true, dietVerified: true, tempOk: true` 를 **하드코딩**해서,
    //    아무도 확인하지 않았는데 원장에는 "확인함"이 남았다(v4.5.0 "복창이 항상 true"와 같은 구조 —
    //    지표가 구조적으로 영원히 100%가 된다). 이제 **체크한 것만** 보낸다.
    mutationFn: ({ id, checks }: { id: string; checks: Record<string, boolean> }) =>
      apiClient.post(`/api/v1/nutrition/meals/${id}/deliver`, checks),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tablet-meals', today] }),
  });

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-gray-400">로딩 중…</div>;
  const meals = (q.data ?? []).filter((m) => m.mealType === mealType);

  return (
    <div className="min-h-[100dvh] bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <button onClick={() => router.push('/staff')} aria-label="내부포털로" className="p-1 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="font-bold text-gray-800">배식 · 섭취</span>
          <span className="ml-auto text-xs text-gray-400">{q.isError ? '조회 실패' : `${meals.length}식`}</span>
        </div>
        <div className="px-2 pb-2 flex gap-1.5">
          {['BREAKFAST', 'LUNCH', 'DINNER'].map((m) => (
            <button key={m} onClick={() => setMealType(m)} className={`flex-1 py-1.5 rounded-full text-sm ${mealType === m ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{MEAL_LABEL[m]}</button>
          ))}
        </div>
      </header>

      <main className="p-3 space-y-2">
        {/* 🔴 조회 실패를 "해당 끼니 식단이 없습니다"로 말하지 않는다 */}
        {q.isError && <QueryErrorFallback error={q.error} onRetry={q.refetch} />}
        {!q.isError && meals.length === 0 && <p className="text-center text-gray-400 text-sm py-10">해당 끼니 식단이 없습니다.</p>}
        {!q.isError && meals.map((m) => (
          <div key={m.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-semibold text-gray-800">{m.patient?.familyName}{m.patient?.givenName}</span>
                <p className="text-xs text-gray-500 truncate">{m.dietType}{m.wardName ? ` · ${m.wardName}` : ''}{m.intakePercent != null ? ` · 섭취 ${m.intakePercent}%` : ''}</p>
                {m.allergies && <p className="text-[11px] text-red-500 truncate">⚠️ {m.allergies}</p>}
                {/* 🔴 배식 확인(5-Rights)은 쓰기만 되고 읽는 곳이 없었다(2026-09-02) — 확인한 것과
                    확인하지 않은 것을 **둘 다** 보인다. 안 보이면 미확인이 사라진다. */}
                {m.deliveryCheck && <DeliveryCheckLine c={m.deliveryCheck} />}
              </div>
              <span className={`flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full ${statusOf(m.status).cls ?? 'bg-gray-100'}`}>{statusOf(m.status).label ?? m.status}</span>
            </div>
            <div className="mt-2 flex gap-2">
              {m.status === 'ORDERED' && <button onClick={() => statusMut.mutate({ id: m.id, status: 'PREPARED' })} className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium">조리완료</button>}
              {m.status === 'PREPARED' && <button onClick={() => setDeliverFor(m)} className="flex-1 min-h-[44px] py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">배식완료{m.allergies ? ' ⚠️' : ''}</button>}
              {(m.status === 'DELIVERED' || m.status === 'PARTIAL') && <button onClick={() => setIntakeFor(m)} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium">섭취 입력</button>}
              {(m.status === 'ORDERED' || m.status === 'PREPARED') && <button onClick={() => setUndeliverFor(m)} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-500 text-sm">미배식</button>}
            </div>
          </div>
        ))}
      </main>

      {deliverFor && <DeliverCheckSheet meal={deliverFor} onClose={() => setDeliverFor(null)} onConfirm={(checks) => { deliverMut.mutate({ id: deliverFor.id, checks }); setDeliverFor(null); }} />}
      {intakeFor && <IntakeSheet meal={intakeFor} today={today} onClose={() => setIntakeFor(null)} onDone={() => { setIntakeFor(null); qc.invalidateQueries({ queryKey: ['tablet-meals', today] }); }} />}
      {undeliverFor && <UndeliverSheet meal={undeliverFor} onClose={() => setUndeliverFor(null)} onDone={() => { setUndeliverFor(null); qc.invalidateQueries({ queryKey: ['tablet-meals', today] }); }} />}
    </div>
  );
}

/**
 * 배식 확인 기록 표시 — 확인한 항목과 **확인하지 않은 항목**을 함께 보인다.
 * 🔴 확인된 것만 보이면 미확인이 화면에서 사라져, 원장에 남은 사실과 화면이 다른 말을 한다.
 */
function DeliveryCheckLine({ c }: { c: NonNullable<Meal['deliveryCheck']> }) {
  const ITEMS: [boolean, string][] = [
    [c.patientVerified, '본인'], [c.dietVerified, '식이'], [c.allergyVerified, '알레르기'], [c.tempOk, '온도'],
  ];
  return (
    <p className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-1.5">
      <span className="text-gray-400">배식 확인</span>
      {ITEMS.map(([ok, label]) => (
        <span key={label} className={ok ? 'text-emerald-600' : 'text-gray-400 line-through'}>{ok ? '✓' : '✗'}{label}</span>
      ))}
      {/* 🔴 시각은 정본(KDate) — 화면마다 포맷을 다시 적으면 표현이 갈라진다 */}
      <span className="text-gray-400">· {c.deliveredByName ?? '배식자 미상'} <KDate value={c.deliveredAt} mode="time" fallback="시각 미상" /></span>
    </p>
  );
}

/**
 * 배식 전 확인 — 🔴 **체크하지 않은 것은 체크하지 않은 대로 보낸다.**
 * 강제하지 않는다(강제하면 아무 칸이나 눌러 통과한다). 대신 미확인이 원장에 남아 지표의 분모가 산다.
 */
function DeliverCheckSheet({ meal, onClose, onConfirm }: { meal: Meal; onClose: () => void; onConfirm: (checks: Record<string, boolean>) => void }) {
  const [v, setV] = useState({ patientVerified: false, dietVerified: false, allergyVerified: false, tempOk: false });
  const set = (k: keyof typeof v) => setV((p) => ({ ...p, [k]: !p[k] }));
  const ITEMS: { k: keyof typeof v; label: string; hint?: string }[] = [
    { k: 'patientVerified', label: '환자 확인', hint: '이름·등록번호 2가지로 대조' },
    { k: 'dietVerified', label: '식이 유형 확인', hint: meal.dietType },
    { k: 'allergyVerified', label: '알레르기 확인', hint: meal.allergies || '기록 없음 — 없다는 뜻은 아니다' },
    { k: 'tempOk', label: '온도 확인' },
  ];
  const none = !Object.values(v).some(Boolean);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1">배식 전 확인 · {meal.patient?.familyName}{meal.patient?.givenName}</h3>
        {meal.allergies && <p className="text-xs text-red-600 font-semibold mb-2">⚠️ 알레르기: {meal.allergies}</p>}
        <div className="space-y-1.5 mb-3">
          {ITEMS.map((it) => (
            <label key={it.k} className="flex items-start gap-2 min-h-[44px] px-2 py-2 rounded-xl bg-gray-50">
              <input type="checkbox" checked={v[it.k]} onChange={() => set(it.k)} className="mt-1 w-5 h-5" />
              <span className="text-sm text-gray-800">{it.label}
                {it.hint && <span className="block text-[11px] text-gray-400">{it.hint}</span>}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mb-2">확인하지 않은 항목은 체크하지 마세요 — 그대로 기록됩니다.</p>
        <button onClick={() => onConfirm(v)} className="w-full min-h-[48px] rounded-xl bg-amber-500 text-white text-sm font-bold">
          {none ? '확인 없이 배식 완료로 기록' : '배식 완료'}
        </button>
        <button onClick={onClose} className="w-full mt-2 min-h-[44px] rounded-xl bg-white border border-gray-200 text-gray-500 text-sm">취소</button>
      </div>
    </div>
  );
}

function UndeliverSheet({ meal, onClose, onDone }: { meal: Meal; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async (reason: string) => {
    setBusy(true);
    try {
      await apiClient.patch(`/api/v1/nutrition/meals/${meal.id}/status`, { status: 'UNDELIVERED', undeliveredReason: reason });
      onDone();
    } catch (e) { alert(e instanceof Error ? e.message : '저장 실패'); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1">미배식 사유 · {meal.patient?.familyName}{meal.patient?.givenName}</h3>
        <p className="text-xs text-gray-400 mb-3">{MEAL_LABEL[meal.mealType]} · {meal.dietType}</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {UNDELIVER_REASONS.map((r) => (
            <button key={r} disabled={busy} onClick={() => submit(r)} className="py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium disabled:opacity-50">{r}</button>
          ))}
        </div>
        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-white border border-gray-200 text-gray-500 text-sm">닫기</button>
      </div>
    </div>
  );
}

const REFUSAL_REASONS = ['입맛 없음', '메스꺼움/구토', '통증', '검사/금식', '기호 불일치'];
function IntakeSheet({ meal, today, onClose, onDone }: { meal: Meal; today: string; onClose: () => void; onDone: () => void }) {
  const [pct, setPct] = useState(75);
  const [collected, setCollected] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await apiClient.post('/api/v1/nutrition/meal-intake', {
        admissionId: meal.admissionId, patientId: meal.patientId, mealOrderId: meal.id, mealType: meal.mealType, date: today,
        intakePercent: pct, leftoverPercent: 100 - pct, trayCollected: collected,
        refusalReason: pct <= 25 && reason ? reason : undefined,
      });
      onDone();
    } catch (e) { alert(e instanceof Error ? e.message : '저장 실패'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1">섭취량 · {meal.patient?.familyName}{meal.patient?.givenName}</h3>
        <p className="text-xs text-gray-400 mb-3">{MEAL_LABEL[meal.mealType]} · {meal.dietType}</p>
        <div className="grid grid-cols-5 gap-1.5 mb-3">
          {[0, 25, 50, 75, 100].map((v) => (
            <button key={v} onClick={() => setPct(v)} className={`py-2 rounded-lg text-sm font-medium ${pct === v ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{v}<Unit>%</Unit></button>
          ))}
        </div>
        <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full mb-2" />
        <p className="text-center text-sm text-gray-500 mb-3">섭취 {pct}<Unit>%</Unit> · 잔반 {100 - pct}<Unit>%</Unit></p>
        {pct <= 25 && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1.5">섭취 부진 사유</p>
            <div className="flex flex-wrap gap-1.5">
              {REFUSAL_REASONS.map((r) => (
                <button key={r} onClick={() => setReason(reason === r ? '' : r)} className={`px-2.5 py-1 rounded-full text-xs ${reason === r ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{r}</button>
              ))}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 mb-3 text-sm text-gray-700">
          <input type="checkbox" checked={collected} onChange={(e) => setCollected(e.target.checked)} className="w-4 h-4" />
          트레이 회수 완료
        </label>
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50">{busy ? '저장 중…' : '섭취 기록'}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600">닫기</button>
        </div>
      </div>
    </div>
  );
}
