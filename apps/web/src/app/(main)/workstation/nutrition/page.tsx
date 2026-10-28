'use client';

import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import { kdate } from '@/lib/ui-settings';
import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

// ─── 인터페이스 정의 ───────────────────────────────────────────────
interface WsPatient {
  mrn: string;
  familyName: string;
  givenName: string;
  birthDate?: string;
  gender?: string;
}

/**
 * 🔴 급식 큐의 id 는 `MealOrder.id` 다 — **임상 `Order` 가 아니다.**
 *    종전 이 화면은 `orderId` 라는 이름만 보고 `/workstation/order/:id/{receive,start,complete}`
 *    를 불렀고, 그 EP 는 `Order` 를 조회하므로 **모든 버튼이 404** 였다(운영 24건 중 일치 0건).
 *    상태 어휘도 임상 것(`RECEIVED`/`IN_PROGRESS`)이라 조리·배식 상태에는 **버튼 자체가 안 떴다.**
 *    급식 상태 정본 = `PATCH /api/v1/nutrition/meals/:id/status`.
 */
type MealStatus = 'ORDERED' | 'PREPARED' | 'DELIVERED' | 'UNDELIVERED';

interface WsOrder {
  mealOrderId: string;
  status: MealStatus;
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
  procedureCode?: string;
  procedureName?: string;
  patient?: WsPatient;
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  ward?: string;
  roomNo?: string;
  bedNo?: string;
  mealType?: string;
  allergyNote?: string;
  specialNote?: string;
}

// ─── 상수 ────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '조리 대기', cls: 'bg-gray-100 text-gray-600' },
  PREPARED:    { label: '배식 대기', cls: 'bg-amber-100 text-amber-700' },
  DELIVERED:   { label: '배식 완료', cls: 'bg-green-100 text-green-700' },
  UNDELIVERED: { label: '미배식',    cls: 'bg-rose-100 text-rose-700' },
};

const WORKFLOW_STEPS = ['조리 대기', '배식 대기', '배식 완료'];

/** 서버 정본이 요구하는 미배식 사유 — 어휘를 지어내지 않는다(§규약 4) */
const UNDELIVERED_REASONS = ['NPO', '검사', '부재', '거부', '퇴원', '기타'];

const MEAL_TYPE_LABEL: Record<string, string> = {
  REGULAR: '일반식',
  SOFT:    '연식',
  LIQUID:  '유동식',
  DIABETIC:'당뇨식',
  LOW_SALT:'저염식',
  TPN:     'TPN',
  OTHER:   '기타',
};

const CHECKLIST_ITEMS = [
  '환자확인',
  '식사유형확인',
  '알레르기확인',
  '배식준비',
  '배식완료',
];

// ─── 유틸 ────────────────────────────────────────────────────────
function FormatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return kdate(d, 'time');
}

function WorkflowStep({ status }: { status: string }) {
  const idx =
    status === 'ORDERED'  ? 0 :
    status === 'PREPARED' ? 1 : 2;

  return (
    <div className="flex items-center gap-1">
      {WORKFLOW_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
            i < idx  ? 'bg-emerald-500 text-white' :
            i === idx ? 'bg-emerald-600 text-white ring-2 ring-emerald-200' :
            'bg-gray-100 text-gray-400'
          }`}>
            {i < idx ? '✓' : i + 1}
          </div>
          <span className={`text-[10px] font-medium ${i === idx ? 'text-emerald-700' : i < idx ? 'text-emerald-500' : 'text-gray-400'}`}>
            {step}
          </span>
          {i < WORKFLOW_STEPS.length - 1 && (
            <div className={`w-4 h-0.5 ${i < idx ? 'bg-emerald-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 상세 패널 ────────────────────────────────────────────────────
function DetailPanel({
  order,
  checklist,
  onChecklistChange,
  onPrepared,
  onDelivered,
  onUndelivered,
  onClose,
}: {
  order: WsOrder;
  checklist: Record<string, boolean>;
  onChecklistChange: (item: string, val: boolean) => void;
  onPrepared: () => void;
  onDelivered: () => void;
  onUndelivered: (reason: string) => void;
  onClose: () => void;
}) {
  const tAttr = useTAttr();
  const fullName = `${order.patient?.familyName ?? ''}${order.patient?.givenName ?? ''}`;
  const [undeliveredReason, setUndeliveredReason] = useState('');
  const checkedCount = CHECKLIST_ITEMS.filter(it => checklist[it]).length;
  const allChecked = checkedCount === CHECKLIST_ITEMS.length;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-96 bg-white border-l shadow-2xl flex flex-col overflow-y-auto">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-emerald-600 px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-emerald-100"><T k="영양 업무 상세" /></p>
          <p className="text-lg font-bold text-white">{fullName}</p>
        </div>
        <button onClick={onClose} className="text-emerald-100 hover:text-white text-xl font-bold leading-none">×</button>
      </div>

      <div className="flex-1 p-5 space-y-5">
        {/* 환자 정보 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="환자 정보" /></h3>
          <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500"><T k="환자번호" /></span>
            <span className="font-medium text-gray-800">{order.patient?.mrn ?? '-'}</span>
            <span className="text-gray-500"><T k="성명" /></span>
            <span className="font-medium text-gray-800">{fullName || '-'}</span>
            <span className="text-gray-500"><T k="병동" /></span>
            <span className="font-medium text-gray-800">{order.ward ?? '-'}</span>
            <span className="text-gray-500"><T k="병실 / 침대" /></span>
            <span className="font-medium text-gray-800">
              {order.roomNo ?? '-'} / {order.bedNo ?? '-'}
            </span>
          </div>
        </section>

        {/* 업무 정보 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="업무 정보" /></h3>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="업무명" /></span>
              <span className="font-medium text-gray-800">{order.procedureName || order.procedureCode || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="식사유형" /></span>
              <span className="font-medium text-emerald-700">
                {MEAL_TYPE_LABEL[order.mealType ?? ''] ?? order.mealType ?? '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="접수시각" /></span>
              <span className="font-medium text-gray-800">{FormatTime(order.requestedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="우선순위" /></span>
              <span className={`font-semibold whitespace-nowrap ${order.priority === 'STAT' ? 'text-red-600' : order.priority === 'URGENT' ? 'text-amber-600' : 'text-gray-600'}`}>
                {order.priority === 'STAT' ? 'STAT' : order.priority === 'URGENT' ? '긴급' : '일반'}
              </span>
            </div>
          </div>
        </section>

        {/* 알레르기 / 특이사항 */}
        {(order.allergyNote || order.specialNote) && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="알레르기 / 특이사항" /></h3>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2 text-sm">
              {order.allergyNote && (
                <div>
                  <p className="text-xs text-amber-600 font-semibold mb-0.5"><T k="알레르기" /></p>
                  <p className="text-amber-900">{order.allergyNote}</p>
                </div>
              )}
              {order.specialNote && (
                <div>
                  <p className="text-xs text-amber-600 font-semibold mb-0.5"><T k="특이사항" /></p>
                  <p className="text-amber-900">{order.specialNote}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 워크플로우 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="진행 단계" /></h3>
          <div className="bg-gray-50 rounded-xl p-4">
            <WorkflowStep status={order.status} />
          </div>
        </section>

        {/* 체크리스트 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            체크리스트 ({checkedCount}/{CHECKLIST_ITEMS.length})
          </h3>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <LocalChecklistNotice className="mb-1.5" />
            {CHECKLIST_ITEMS.map(item => (
              <label key={item} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={!!checklist[item]}
                  onChange={e => onChecklistChange(item, e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className={`text-sm transition-colors ${checklist[item] ? 'text-emerald-700 line-through' : 'text-gray-700 group-hover:text-gray-900'}`}>
                  {item}
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>

      {/* 액션 버튼 */}
      <div className="sticky bottom-0 bg-white border-t p-4 space-y-2">
        {order.status === 'ORDERED' && (
          <button
            onClick={onPrepared}
            className="w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors"
          >
            <T k="조리 완료" />
          </button>
        )}
        {order.status === 'PREPARED' && (
          <div className="space-y-2">
            <button
              onClick={onDelivered}
              disabled={false} /* 🔴 가짜 게이트 제거 — 서버에 남지 않는 체크로 업무를 막지 않는다 */
              className="w-full py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              배식 완료 {!allChecked && `(${checkedCount}/${CHECKLIST_ITEMS.length})`}
            </button>
            {/* 🔴 미배식은 사유가 있어야 한다(서버 정본이 사유 없는 UNDELIVERED 를 거부한다).
                NPO·검사 중인 환자에게 배식이 나가지 않게 하는 자리라 배식과 같은 층에 둔다. */}
            <div className="flex gap-2">
              <select
                value={undeliveredReason}
                onChange={e => setUndeliveredReason(e.target.value)}
                className="flex-1 min-w-0 border border-gray-300 rounded-xl px-2 py-2 text-sm"
              >
                <option value="">{tAttr('미배식 사유 선택…')}</option>
                {UNDELIVERED_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button
                onClick={() => onUndelivered(undeliveredReason)}
                disabled={!undeliveredReason}
                className="px-3 py-2 border border-rose-300 text-rose-700 rounded-xl text-sm font-semibold hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <T k="미배식" />
              </button>
            </div>
          </div>
        )}
        <Link href="/nutrition" className="block w-full py-2 border border-emerald-300 text-emerald-700 rounded-xl text-sm font-medium text-center hover:bg-emerald-50 transition-colors">
          <T k="급양관리 메인 바로가기" />
        </Link>
      </div>
    </div>
  );
}

// ─── 메인 페이지 ─────────────────────────────────────────────────
export default function NutritionWorkstationPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'ALL' | 'ORDERED' | 'PREPARED' | 'DONE'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklists, setChecklists] = useState<Record<string, Record<string, boolean>>>({});

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-nutrition-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/nutrition/queue'),
    refetchInterval: 8000,
  });

  const allOrders: WsOrder[] = queueRes?.data ?? [];
  const waiting    = allOrders.filter(o => o.status === 'ORDERED');
  const prepared   = allOrders.filter(o => o.status === 'PREPARED');
  const done       = allOrders.filter(o => o.status === 'DELIVERED' || o.status === 'UNDELIVERED');

  const filtered =
    tab === 'ALL'      ? allOrders :
    tab === 'ORDERED'  ? waiting :
    tab === 'PREPARED' ? prepared :
                         done;

  const selectedOrder = allOrders.find(o => o.mealOrderId === selectedId) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['ws-nutrition-queue'] });

  /** 급식 상태 정본 하나로만 전이한다 — 임상 오더 EP 를 부르지 않는다 */
  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: MealStatus; reason?: string }) =>
      apiClient.patch(`/api/v1/nutrition/meals/${id}/status`, { status, undeliveredReason: reason }),
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.status === 'PREPARED' ? '조리 완료' : v.status === 'DELIVERED' ? '배식 완료' : '미배식 기록');
      if (v.status !== 'PREPARED') setSelectedId(null);
    },
  });

  function HandleChecklistChange(orderId: string, item: string, val: boolean) {
    setChecklists(prev => ({
      ...prev,
      [orderId]: { ...(prev[orderId] ?? {}), [item]: val },
    }));
  }

  const TABS = [
    { key: 'ALL',         label: '전체',   count: allOrders.length },
    { key: 'ORDERED',  label: '조리 대기', count: waiting.length },
    { key: 'PREPARED', label: '배식 대기', count: prepared.length },
    { key: 'DONE',     label: '배식 완료', count: done.length },
  ] as const;

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="영양 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">8초 자동 갱신 · 오늘 총 {allOrders.length}<Unit>건</Unit></p>
        </div>
        <Link href="/nutrition" className="px-3 py-1.5 text-xs font-medium border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors whitespace-nowrap">
          <T k="급양관리 메인" />
        </Link>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-medium"><T k="대기" /></span>
          <span className="text-3xl font-bold text-gray-700">{waiting.length}</span>
          <span className="text-xs text-gray-400">건</span>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-amber-600 font-medium"><T k="배식 대기" /></span>
          <span className="text-3xl font-bold text-amber-600">{prepared.length}</span>
          <span className="text-xs text-amber-400">건</span>
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-emerald-600 font-medium"><T k="배식 완료" /></span>
          <span className="text-3xl font-bold text-emerald-600">{done.length}</span>
          <span className="text-xs text-emerald-400">건</span>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 border-b border-gray-100">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs font-semibold rounded-t transition-colors ${
              tab === t.key
                ? 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-600'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <div className="py-20 text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <T k="로딩 중..." />
        </div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-gray-400">
          <div className="text-4xl mb-3">🍽</div>
          <p><T k="해당 업무가 없습니다" /></p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="업무" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="식사유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="병실/침대" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="시간" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(item => (
                <tr
                  key={item.mealOrderId}
                  onClick={() => setSelectedId(item.mealOrderId === selectedId ? null : item.mealOrderId)}
                  className={`cursor-pointer hover:bg-emerald-50/40 transition-colors ${
                    item.priority === 'STAT' ? 'bg-red-50/40' :
                    selectedId === item.mealOrderId ? 'bg-emerald-50' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    {item.priority === 'STAT' && (
                      <span className="px-1.5 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded animate-pulse whitespace-nowrap">STAT</span>
                    )}
                    {item.priority === 'URGENT' && (
                      <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded whitespace-nowrap"><T k="긴급" /></span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATUS_BADGE[item.status]?.cls ?? 'bg-gray-100'}`}>
                      {STATUS_BADGE[item.status]?.label ?? item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">
                      {item.patient?.familyName}{item.patient?.givenName}
                    </p>
                    <p className="text-xs text-gray-400">{item.patient?.mrn}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.procedureName || item.procedureCode || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {MEAL_TYPE_LABEL[item.mealType ?? ''] ?? item.mealType ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {item.roomNo ?? '-'} / {item.bedNo ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {FormatTime(item.requestedAt)}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      {item.status === 'ORDERED' && (
                        <button
                          onClick={() => setStatus.mutate({ id: item.mealOrderId, status: 'PREPARED' })}
                          className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <T k="조리 완료" />
                        </button>
                      )}
                      {item.status === 'PREPARED' && (
                        <button
                          onClick={() => setSelectedId(item.mealOrderId)}
                          className="px-2.5 py-1 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 whitespace-nowrap"
                        >
                          <T k="배식 처리" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 상세 패널 */}
      {selectedOrder && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setSelectedId(null)} />
          <DetailPanel
            order={selectedOrder}
            checklist={checklists[selectedOrder.mealOrderId] ?? {}}
            onChecklistChange={(item, val) => HandleChecklistChange(selectedOrder.mealOrderId, item, val)}
            onPrepared={() => setStatus.mutate({ id: selectedOrder.mealOrderId, status: 'PREPARED' })}
            onDelivered={() => setStatus.mutate({ id: selectedOrder.mealOrderId, status: 'DELIVERED' })}
            onUndelivered={(reason) => setStatus.mutate({ id: selectedOrder.mealOrderId, status: 'UNDELIVERED', reason })}
            onClose={() => setSelectedId(null)}
          />
        </>
      )}
    </div>
  );
}
