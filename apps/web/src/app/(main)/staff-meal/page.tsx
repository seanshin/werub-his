'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { money } from '@/lib/ui-settings';
import { Money } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kstToday } from '@/lib/kst-today';

const MEAL_LABEL: Record<string, string> = { BREAKFAST: '조식', LUNCH: '중식', DINNER: '석식' };
const MEAL_TIME: Record<string, string> = { BREAKFAST: '07:00~09:00', LUNCH: '11:30~14:00', DINNER: '17:00~19:00' };
const COURSE_LABEL: Record<string, string> = { A: 'A코스 (한식)', B: 'B코스 (양식)', C: 'C코스 (면류)', SPECIAL: '특식' };
const COURSE_COLOR: Record<string, string> = { A: 'bg-amber-50 border-amber-200', B: 'bg-blue-50 border-blue-200', C: 'bg-emerald-50 border-emerald-200', SPECIAL: 'bg-rose-50 border-rose-200' };
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

interface MenuEntry {
  id: string; date: string; mealType: string; courseType: string;
  menuName: string; description?: string; price: number; calories?: number;
  allergens?: string; isSpecial: boolean;
}

interface MealRequest {
  id: string; date: string; mealType: string; courseType: string; status: string;
}

function getWeekStart(d: Date) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function formatDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function StaffMealPage() {
  const qc = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);

  const today = new Date();
  const weekStart = getWeekStart(today);
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const weekStr = formatDate(weekStart);

  // 주간 메뉴
  const { data: menuRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['staff-menu', weekStr],
    queryFn: () => apiClient.get<{ data: MenuEntry[] }>(`/api/v1/nutrition/staff-menu?week=${weekStr}`),
  });
  const menus: MenuEntry[] = Array.isArray(menuRes?.data) ? menuRes.data : (menuRes?.data as any)?.data ?? [];

  // 내 식수 신청
  const { data: myReqRes } = useQuery({
    queryKey: ['my-meal-requests', weekStr],
    queryFn: () => apiClient.get<{ data: MealRequest[] }>(`/api/v1/nutrition/staff-meal/my?week=${weekStr}`),
  });
  const myRequests: MealRequest[] = Array.isArray(myReqRes?.data) ? myReqRes.data : (myReqRes?.data as any)?.data ?? [];

  const requestMut = useMutation({
    mutationFn: (d: { date: string; mealType: string; courseType: string }) =>
      apiClient.post('/api/v1/nutrition/staff-meal/request', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-meal-requests'] }); toast.success('식수 신청 완료'); },
    onError: () => toast.error('신청 실패'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/nutrition/staff-meal/${id}/cancel`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-meal-requests'] }); toast.success('취소 완료'); },
  });

  const getMenusForDateMeal = (date: string, mealType: string) =>
    menus.filter(m => m.date?.slice(0, 10) === date && m.mealType === mealType);

  const getMyRequest = (date: string, mealType: string) =>
    myRequests.find(r => r.date?.slice(0, 10) === date && r.mealType === mealType);

  const todayStr = formatDate(today);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="직원 식단표" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k='B1 구내식당 "한우리" · 직원식 4,500원 (사번확인)' /></p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">&larr; <T k="이전주" /></button>
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium"><T k="이번주" /></button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200"><T k="다음주" /> &rarr;</button>
        </div>
      </div>

      {isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-20 p-2 text-xs font-medium text-gray-500 border border-gray-100 bg-gray-50"></th>
                {weekDates.map(d => {
                  const ds = formatDate(d);
                  const isToday = ds === todayStr;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <th key={ds} className={`p-2 text-center border border-gray-100 ${isToday ? 'bg-blue-50' : isWeekend ? 'bg-gray-50' : 'bg-white'}`}>
                      <div className={`text-xs font-bold ${isToday ? 'text-blue-700' : isWeekend ? 'text-red-400' : 'text-gray-700'}`}>
                        {d.getMonth() + 1}/{d.getDate()} ({DAY_NAMES[d.getDay()]})
                      </div>
                      {isToday && <div className="text-[9px] text-blue-500 font-medium"><T k="오늘" /></div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(['BREAKFAST', 'LUNCH', 'DINNER'] as const).map(meal => (
                <tr key={meal}>
                  <td className="p-2 border border-gray-100 bg-gray-50 text-center">
                    <div className="text-xs font-bold text-gray-700"><T k={MEAL_LABEL[meal]} /></div>
                    <div className="text-[9px] text-gray-400">{MEAL_TIME[meal]}</div>
                  </td>
                  {weekDates.map(d => {
                    const ds = formatDate(d);
                    const dayMenus = getMenusForDateMeal(ds, meal);
                    const myReq = getMyRequest(ds, meal);
                    const isToday = ds === todayStr;
                    const isPast = d < today && !isToday;

                    return (
                      <td key={ds} className={`p-1.5 border border-gray-100 align-top ${isToday ? 'bg-blue-50/30' : ''}`} style={{ minWidth: 140 }}>
                        {dayMenus.length > 0 ? (
                          <div className="space-y-1">
                            {dayMenus.map(m => (
                              <div key={m.id} className={`p-1.5 rounded-lg border text-[10px] ${COURSE_COLOR[m.courseType] ?? 'bg-gray-50 border-gray-200'}`}>
                                <div className="font-bold text-gray-800"><T k={COURSE_LABEL[m.courseType] ?? m.courseType} /></div>
                                <div className="text-gray-700 font-medium mt-0.5">{m.menuName}</div>
                                {m.description && <div className="text-gray-500 mt-0.5">{m.description}</div>}
                                <div className="flex items-center gap-2 mt-1 text-gray-400">
                                  {m.price > 0 && <span><Money value={m.price} /></span>}
                                  {m.calories && <span>{m.calories}kcal</span>}
                                </div>
                                {m.allergens && <div className="text-orange-500 mt-0.5"><T k="알레르기" />: {m.allergens}</div>}

                                {/* 식수 신청 버튼 */}
                                {!isPast && (
                                  myReq && myReq.courseType === m.courseType ? (
                                    <button onClick={() => cancelMut.mutate(myReq.id)}
                                      className="mt-1 w-full py-1 bg-emerald-100 text-emerald-700 rounded text-[9px] font-bold hover:bg-red-100 hover:text-red-600 transition">
                                      <T k="신청됨 (취소)" />
                                    </button>
                                  ) : (
                                    <button onClick={() => requestMut.mutate({ date: ds, mealType: meal, courseType: m.courseType })}
                                      className="mt-1 w-full py-1 bg-white border border-gray-200 text-gray-500 rounded text-[9px] hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition">
                                      <T k="신청" />
                                    </button>
                                  )
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] text-gray-300 text-center py-3">
                            <T k={d.getDay() === 0 ? '휴무' : '미등록@메뉴'} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 안내 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
          <p className="text-xs font-bold text-amber-700 mb-1"><T k="A코스 (한식)" /></p>
          <p className="text-[11px] text-amber-600"><T k="된장찌개/불고기 등 + 3찬 + 밥" /></p>
          <p className="text-[11px] text-amber-500 mt-1"><T k="6,000원 (직원 4,500원)" /></p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <p className="text-xs font-bold text-blue-700 mb-1"><T k="B코스 (양식)" /></p>
          <p className="text-[11px] text-blue-600"><T k="돈까스/함박 + 샐러드 + 수프" /></p>
          <p className="text-[11px] text-blue-500 mt-1"><T k="7,000원 (직원 4,500원)" /></p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
          <p className="text-xs font-bold text-emerald-700 mb-1"><T k="C코스 (면류)" /></p>
          <p className="text-[11px] text-emerald-600"><T k="잔치국수/비빔국수/우동" /></p>
          <p className="text-[11px] text-emerald-500 mt-1"><T k="5,000원 (직원 4,500원)" /></p>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
        <p><T k='B1 구내식당 "한우리" · 조식 07:00~09:00 / 중식 11:30~14:00 / 석식 17:00~19:00' /></p>
        <p><T k="B1 푸드코트: 분식(4,000원~) / 중식(6,000원~) / 죽(6,000원~) · 10:00~20:00" /></p>
        <p><T k="1층 카페 메디치노: 아메리카노 3,500원 / 카페라떼 4,500원 · 07:00~20:00" /></p>
        <p><T k="식수 신청 마감: 전일 18:00 (당일 신청은 급양과 확인 필요)" /></p>
      </div>

      {/* 급양과 관리 — 메뉴 등록 */}
      <MenuAdminSection weekDates={weekDates} onSaved={() => qc.invalidateQueries({ queryKey: ['staff-menu'] })} />

      {/* 급양과 — 식대 정산 (ADMIN) */}
      <StaffMealSettlementSection />
    </div>
  );
}

// ── 급양과 — 월별 식대 정산 (ADMIN 전용·비권한 시 자동 숨김) ──
function StaffMealSettlementSection() {
  const month = new Date().toISOString().slice(0, 7);
  const today = kstToday();
  const [msg, setMsg] = useState('');
  const settle = useQuery({
    queryKey: ['staff-meal-settlement', month],
    queryFn: () => apiClient.get<{ data: { month: string; totalMeals: number; totalAmount: number; rows: Array<{ userId: string; name: string; count: number; amount: number }> } }>(`/api/v1/nutrition/staff-meal/settlement?month=${month}`).then((r) => r.data),
  });
  const d = settle.data;
  // 권한 없음(ADMIN 전용)은 설계대로 조용히 숨긴다. 그 외 조회 실패는 실패라고 말한다.
  const settleDenied = settle.error instanceof ApiError && (settle.error.code === 'FORBIDDEN' || settle.error.code === 'UNAUTHORIZED');
  if (settle.isError && !settleDenied) {
    return (
      <div className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-lg font-bold text-gray-900 mb-3"><T k="식대 정산" /> <span className="text-sm font-normal text-gray-400">{month}</span></h2>
        <QueryErrorFallback error={settle.error} onRetry={() => settle.refetch()} size="compact" />
      </div>
    );
  }
  if (!d) return null;
  const confirm = async () => {
    try { const r = await apiClient.post<{ data: { confirmed: number } }>('/api/v1/nutrition/staff-meal/confirm', { date: today }); setMsg(`오늘 식수 ${r.data.confirmed}건 마감 확정`); settle.refetch(); }
    catch { setMsg('마감 확정 실패'); }
  };
  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-900"><T k="식대 정산" /> <span className="text-sm font-normal text-gray-400">{month}</span></h2>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-emerald-600">{msg}</span>}
          <button onClick={confirm} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="오늘 식수 마감확정" /></button>
        </div>
      </div>
      <p className="text-sm text-gray-600 mb-3">이번 달 총 <b>{d.totalMeals}</b>식 · <b><Money value={d.totalAmount} /></b> <span className="text-xs text-gray-400">(<T k="급여공제 연계" />)</span></p>
      <div className="overflow-x-auto max-h-72 overflow-y-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-100 text-gray-400"><th className="px-2 py-1.5 text-left"><T k="직원" /></th><th className="px-2 py-1.5 text-right"><T k="식수" /></th><th className="px-2 py-1.5 text-right"><T k="식대" /></th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.userId} className="border-b border-gray-50"><td className="px-2 py-1.5 text-gray-700">{r.name}</td><td className="px-2 py-1.5 text-right">{r.count}</td><td className="px-2 py-1.5 text-right font-medium"><Money value={r.amount} /></td></tr>
            ))}
            {d.rows.length === 0 && <tr><td colSpan={3} className="px-2 py-4 text-center text-gray-400"><T k="신청 내역 없음" /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 급양과 관리 섹션 ──
function MenuAdminSection({ weekDates, onSaved }: { weekDates: Date[]; onSaved: () => void }) {
  const tAttrMgr = useTAttr();
  /**
   * 🔴 식단 등록·삭제와 식수 마감 확정은 **급양과 업무**다(서버 `@Roles(ADMIN, NUTRITION)`).
   *    직원 식사 화면은 전 직원에게 열려 있어(복리후생) 이 구획만 급양과에 보인다 —
   *    종전에는 전 직원에게 등록 폼이 보이고 저장하면 403 이었다.
   */
  const canManageMenu = useHasRole('NUTRITION');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    date: kstToday(),
    mealType: 'LUNCH',
    courseType: 'A',
    menuName: '',
    description: '',
    price: '6000',
    calories: '',
    allergens: '',
  });

  const saveMut = useMutation({
    mutationFn: (d: typeof form) => apiClient.post('/api/v1/nutrition/staff-menu', {
      ...d, price: parseInt(d.price) || 0, calories: d.calories ? parseInt(d.calories) : undefined,
      allergens: d.allergens || undefined,
    }),
    onSuccess: () => {
      toast.success('메뉴 등록 완료');
      onSaved();
      setForm(f => ({ ...f, menuName: '', description: '', calories: '', allergens: '' }));
    },
    onError: () => toast.error('등록 실패'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.fetch(`/api/v1/nutrition/staff-menu/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('삭제 완료'); onSaved(); },
    onError: () => toast.error('삭제 실패'),
  });

  if (!canManageMenu) return null;

  return (
    <div className="border-t border-gray-200 pt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900"><T k="급양과 메뉴 관리" /></h2>
        <button onClick={() => setShowForm(!showForm)}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition ${showForm ? 'bg-gray-100 text-gray-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
          {showForm ? <T k="닫기" /> : <>+ <T k="메뉴 등록" /></>}
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 mb-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="날짜" /></label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="끼니" /></label>
              <select value={form.mealType} onChange={e => setForm(f => ({ ...f, mealType: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="BREAKFAST">{tAttrMgr('조식')}</option>
                <option value="LUNCH">{tAttrMgr('중식')}</option>
                <option value="DINNER">{tAttrMgr('석식')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="코스" /></label>
              <select value={form.courseType} onChange={e => setForm(f => ({ ...f, courseType: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="A">{tAttrMgr('A코스 (한식)')}</option>
                <option value="B">{tAttrMgr('B코스 (양식)')}</option>
                <option value="C">{tAttrMgr('C코스 (면류)')}</option>
                <option value="SPECIAL">{tAttrMgr('특식')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="가격 (원)" /></label>
              <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="메뉴명" /> *</label>
              <input value={form.menuName} onChange={e => setForm(f => ({ ...f, menuName: e.target.value }))}
                placeholder={tAttrMgr('예: 된장찌개 정식')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="상세 (반찬 등)" /></label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={tAttrMgr('예: 된장찌개+불고기+3찬+밥')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="칼로리 (kcal)" /></label>
              <input type="number" value={form.calories} onChange={e => setForm(f => ({ ...f, calories: e.target.value }))}
                placeholder="700" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="알레르기 유발식품" /></label>
              <input value={form.allergens} onChange={e => setForm(f => ({ ...f, allergens: e.target.value }))}
                placeholder={tAttrMgr('대두, 밀, 우유')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <button onClick={() => { if (form.menuName) saveMut.mutate(form); else toast.warning('메뉴명을 입력하세요'); }}
            disabled={saveMut.isPending}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            <T k={saveMut.isPending ? '등록 중...' : '등록 / 수정'} />
          </button>
          <p className="text-[10px] text-gray-400"><T k="같은 날짜+끼니+코스가 있으면 자동 수정됩니다 (upsert)" /></p>
        </div>
      )}
    </div>
  );
}
