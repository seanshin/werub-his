'use client';

import { useMemo, useState } from 'react';
import { usePrintIssue } from '@/components/print/usePrintIssue';
import { dutyRosterPrintLines } from '@hospital-run/shared';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { DutyRosterPrint } from '@/components/print/DutyRosterPrint';

interface StaffMember { id: string; familyName: string; givenName: string; department: string }
interface ShiftItem { id: string; shift: string; staffId: string; staffName: string; role: string; department: string }
interface LeaveItem { userId: string; name: string; type: string }
interface UnderstaffedItem { shift: string; required: number; actual: number }
interface ScheduleDay { date: string; dayOfWeek: string; shifts: ShiftItem[]; leaves: LeaveItem[]; understaffed?: UnderstaffedItem[] }
interface ScheduleResp { schedules: ScheduleDay[]; month: string; department: string; totalEntries: number }

const SHIFT_LABEL: Record<string, string> = { DAY: '주간(D)', EVENING: '저녁(E)', NIGHT: '심야(N)' };
const SHIFT_COLOR: Record<string, string> = { DAY: 'bg-blue-100 text-blue-700', EVENING: 'bg-amber-100 text-amber-700', NIGHT: 'bg-gray-800 text-white' };
const LEAVE_LABEL: Record<string, string> = { ANNUAL: '연차', HALF: '반차', SICK: '병가', PERSONAL: '개인', MATERNITY: '출산', SPECIAL: '경조' };
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const TABS = [{ k: 'roster', l: '당직표' }, { k: 'oncall', l: '당직(on-call)' }, { k: 'staffing', l: '인력기준' }, { k: 'stats', l: '통계·공정성' }, { k: 'violations', l: '근무시간·위반' }] as const;
const CALL_LABEL: Record<string, string> = { FIRST: '1st call', SECOND: '2nd call', BACKUP: 'backup' };

function unwrap<T>(res: unknown): T {
  const r = res as { data?: { data?: T } | T };
  return ((r?.data as { data?: T })?.data ?? r?.data ?? r) as T;
}
function monthDays(year: number, month: number): Date[] {
  const days: Date[] = []; const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

export default function DutySchedulePage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const now = new Date();
  const [tab, setTab] = useState<(typeof TABS)[number]['k']>('roster');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [dept, setDept] = useState('전체');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ staffId: '', date: '', shift: 'DAY' });

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const days = monthDays(year, month);
  const today = now.toISOString().split('T')[0];
  const deptQs = dept !== '전체' ? `&department=${encodeURIComponent(dept)}` : '';

  const { data: staffData } = useQuery({ queryKey: ['hr-staff'], queryFn: () => apiClient.get('/api/v1/hr/staff') });
  const staffList = unwrap<StaffMember[]>(staffData) ?? [];
  const departments = ['전체', ...Array.from(new Set(staffList.map((s) => s.department).filter(Boolean)))];

  const { data: schedData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['duty-schedule', monthStr, dept],
    queryFn: () => apiClient.get(`/api/v1/duty/schedule?month=${monthStr}${deptQs}`),
  });
  const sched = unwrap<ScheduleResp>(schedData) ?? { schedules: [], month: monthStr, department: dept, totalEntries: 0 };
  const byDate = new Map<string, ScheduleDay>();
  for (const s of sched.schedules ?? []) byDate.set(s.date, s);
  /** 🔴 인쇄 = 서버 발급(당직표 · 발급 원장 동결·진위확인 QR) — 발급 실패·화면 줄 ≠ 서버 줄이면 인쇄하지 않는다 */
  const printLines = useMemo(() => dutyRosterPrintLines(sched.schedules ?? []), [sched.schedules]);
  const pr = usePrintIssue('DUTY_ROSTER', { month: monthStr, department: dept }, printLines, () => { void refetch(); });

  const { data: statsData } = useQuery({ queryKey: ['duty-stats', monthStr], queryFn: () => apiClient.get(`/api/v1/duty/stats?month=${monthStr}`), enabled: tab === 'stats' });
  const { data: fairData } = useQuery({ queryKey: ['duty-fairness', monthStr], queryFn: () => apiClient.get(`/api/v1/duty/fairness?month=${monthStr}`), enabled: tab === 'stats' });
  const { data: violData } = useQuery({ queryKey: ['duty-violations', monthStr], queryFn: () => apiClient.get(`/api/v1/duty/violations?month=${monthStr}`), enabled: tab === 'violations' });
  const { data: oncallData } = useQuery({ queryKey: ['duty-oncall', monthStr, dept], queryFn: () => apiClient.get(`/api/v1/duty/oncall-roster?month=${monthStr}${deptQs}`), enabled: tab === 'oncall' });
  const { data: staffingData } = useQuery({ queryKey: ['duty-staffing', dept], queryFn: () => apiClient.get(`/api/v1/duty/staffing-rules${dept !== '전체' ? `?department=${encodeURIComponent(dept)}` : ''}`), enabled: tab === 'staffing' });
  const oncall = unwrap<{ oncall?: { date: string; calls: { id: string; department: string; callLevel: string; staffName: string }[] }[] }>(oncallData)?.oncall ?? [];
  const staffingRules = unwrap<{ id: string; department: string; shift: string; dayType: string; minCount: number }[]>(staffingData) ?? [];

  const [oc, setOc] = useState({ date: '', department: '', callLevel: 'FIRST', staffId: '' });
  const [sr, setSr] = useState({ department: '', shift: 'DAY', dayType: 'ALL', minCount: 1 });
  const ocMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/duty/oncall-roster', oc),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['duty-oncall'] }); toast.success('당직 배정됨'); setOc({ ...oc, staffId: '' }); },
    onError: (e) => toast.error((e as { message?: string })?.message || '실패'),
  });
  const srMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/duty/staffing-rules', sr),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['duty-staffing'] }); toast.success('인력기준 저장됨'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '실패'),
  });
  const srDel = useMutation({ mutationFn: (id: string) => apiClient.del(`/api/v1/duty/staffing-rules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['duty-staffing'] }) });

  const exportCsv = () => {
    const rows = [['날짜', '요일', '근무', '직원', '부서']];
    for (const s of sched.schedules) for (const sh of s.shifts) rows.push([s.date, s.dayOfWeek, SHIFT_LABEL[sh.shift] ?? sh.shift, sh.staffName, sh.department]);
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `당직표_${monthStr}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const autoGen = useMutation({
    mutationFn: () => apiClient.post('/api/v1/duty/auto-generate', { month: monthStr, department: dept === '전체' ? '' : dept, constraints: { maxConsecutiveNights: 3, maxWeeklyHours: 52, minRestHours: 11 } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['duty-schedule'] }); toast.success('당직표가 자동 편성되었습니다(연속야간·주52h 제약 반영).'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '자동 편성 실패'),
  });
  const addMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/duty/assign', { date: addForm.date, shift: addForm.shift, staffId: addForm.staffId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['duty-schedule'] });
      const w = (res as { data?: { warnings?: string[]; error?: string } })?.data;
      if (w?.error) { toast.error(w.error); return; } // BLOCK
      setShowAdd(false); setAddForm({ staffId: '', date: '', shift: 'DAY' });
      if (w?.warnings?.length) toast.error(`배정됨 — 근무 규칙 경고: ${w.warnings.join(', ')}`); // WARN
      else toast.success('배정되었습니다.');
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '배정 실패'),
  });

  const prevMonth = () => (month === 1 ? (setYear(year - 1), setMonth(12)) : setMonth(month - 1));
  const nextMonth = () => (month === 12 ? (setYear(year + 1), setMonth(1)) : setMonth(month + 1));

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const stats = unwrap<{ byDepartment?: unknown[]; byStaff?: unknown[]; totalEntries?: number }>(statsData) ?? {};
  const fair = unwrap<{ fairnessIndex?: number; rating?: string; stdDeviation?: number; persons?: { name: string; department: string; role: string; total: number; night: number }[] }>(fairData) ?? {};
  const viol = unwrap<{ violations?: { staffName?: string; name?: string; department?: string; week?: string; hours?: number; limit?: number; type?: string }[] }>(violData) ?? {};
  const violations = viol.violations ?? [];

  return (
    <div className="p-1">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="당직·근무표 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="3교대 편성·통계·공정성·근로시간 위반 (휴가 통합 표시)" /></p>
        </div>
        <div className="flex items-center gap-2">
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="border rounded-lg px-2 py-2 text-sm">
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={() => { if (confirm(`${monthStr} ${dept === '전체' ? '전체' : dept} 당직을 자동 편성합니다.\n연속야간·주52h 제약이 반영되며 해당 부서 기존 배정이 재생성됩니다. 계속할까요?`)) autoGen.mutate(); }}
            disabled={autoGen.isPending}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {autoGen.isPending ? '편성 중…' : '⚙ 자동 편성'}
          </button>
          <button onClick={() => setShowAdd((v) => !v)} className="px-3 py-2 border rounded-lg text-sm"><T k="＋ 수동 배정" /></button>
          <button onClick={exportCsv} className="px-3 py-2 border rounded-lg text-sm" title={tAttr('당직표 CSV 내보내기')}>⬇ CSV</button>
          <button onClick={() => void pr.start()} disabled={pr.issuing} className="px-3 py-2 border rounded-lg text-sm disabled:opacity-60" title={tAttr('발급 후 인쇄')} data-print-issue-button>{pr.issuing ? '…' : '🖨'}</button>
        </div>
      </div>

      {pr.bar}
      {/* 탭 */}
      <div className="flex gap-1 border-b mb-4">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t.k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500'}`}>{t.l}</button>
        ))}
      </div>

      {showAdd && (
        <div className="bg-white border rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-gray-500"><T k="직원" /></label>
            <select value={addForm.staffId} onChange={(e) => setAddForm({ ...addForm, staffId: e.target.value })} className="mt-1 block border rounded-lg px-2 py-1.5 text-sm">
              <option value="">{tAttr('선택')}</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.familyName}{s.givenName} ({s.department})</option>)}
            </select>
          </div>
          <div><label className="text-xs text-gray-500"><T k="날짜" /></label>
            <input type="date" value={addForm.date} onChange={(e) => setAddForm({ ...addForm, date: e.target.value })} className="mt-1 block border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div><label className="text-xs text-gray-500"><T k="근무" /></label>
            <select value={addForm.shift} onChange={(e) => setAddForm({ ...addForm, shift: e.target.value })} className="mt-1 block border rounded-lg px-2 py-1.5 text-sm">
              {['DAY', 'EVENING', 'NIGHT'].map((s) => <option key={s} value={s}>{SHIFT_LABEL[s]}</option>)}
            </select>
          </div>
          <button onClick={() => addForm.staffId && addForm.date && addMut.mutate()} disabled={addMut.isPending || !addForm.staffId || !addForm.date} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"><T k="배정" /></button>
        </div>
      )}

      {tab === 'roster' && (
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="px-3 py-1 border rounded-lg text-sm"><T k="‹ 이전" /></button>
            <span className="font-semibold">{year}<Unit>년</Unit> {month}월 <span className="text-xs text-gray-400">({sched.totalEntries}<Unit>건</Unit> 배정)</span></span>
            <button onClick={nextMonth} className="px-3 py-1 border rounded-lg text-sm"><T k="다음 ›" /></button>
          </div>
          {isLoading ? <div className="text-gray-400 text-sm py-8 text-center"><T k="불러오는 중…" /></div> : (
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((d) => <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>)}
              {Array.from({ length: days[0].getDay() }).map((_, i) => <div key={`e${i}`} />)}
              {days.map((d) => {
                const ds = `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const day = byDate.get(ds);
                return (
                  <div key={ds} className={`min-h-[92px] border rounded-lg p-1 ${ds === today ? 'ring-2 ring-indigo-400' : ''} ${(day?.understaffed?.length ?? 0) > 0 ? 'bg-red-50/40' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{d.getDate()}</span>
                      {(day?.understaffed?.length ?? 0) > 0 && (
                        <span className="text-[9px] px-1 rounded bg-red-100 text-red-600" title={day?.understaffed?.map((u) => `${u.shift[0]} ${u.actual}/${u.required}`).join(', ')}><T k="인력부족" /></span>
                      )}
                    </div>
                    <div className="space-y-0.5 mt-0.5">
                      {(day?.shifts ?? []).map((s) => (
                        <div key={s.id} className={`text-[10px] px-1 rounded ${SHIFT_COLOR[s.shift] ?? 'bg-gray-100'}`} title={`${SHIFT_LABEL[s.shift]} · ${s.department}`}>
                          {s.shift[0]} {s.staffName}
                        </div>
                      ))}
                      {(day?.leaves ?? []).map((l) => (
                        <div key={l.userId} className="text-[10px] px-1 rounded bg-rose-50 text-rose-600" title={tAttr('휴가/OFF')}>
                          휴 {l.name}{LEAVE_LABEL[l.type] ? `·${LEAVE_LABEL[l.type]}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-2"><T k="공정성 리포트" /></h3>
            {fair.persons ? (
              <>
                <div className="flex items-center gap-4 text-sm mb-3">
                  <span><T k="공정성 지수" /> <b className="text-lg">{fair.fairnessIndex}</b></span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${(fair.fairnessIndex ?? 0) >= 70 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{fair.rating}</span>
                  <span className="text-xs text-gray-400">표준편차 {fair.stdDeviation}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1 pr-4"><T k="직원" /></th><th className="px-2"><T k="부서" /></th><th className="px-2"><T k="총 근무" /></th><th className="px-2"><T k="야간" /></th></tr></thead>
                    <tbody>
                      {fair.persons.map((p, i) => (
                        <tr key={i} className="border-b last:border-0"><td className="py-1 pr-4">{p.name}</td><td className="px-2">{p.department}</td><td className="px-2">{p.total}</td><td className="px-2">{p.night}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <div className="text-xs text-gray-300"><T k="데이터 없음" /></div>}
          </div>
          <div className="bg-white border rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-2">부서별 통계 <span className="text-xs text-gray-400">(총 {stats.totalEntries ?? 0}<Unit>건</Unit>)</span></h3>
            {Array.isArray(stats.byDepartment) && stats.byDepartment.length ? (
              <div className="overflow-x-auto"><pre className="text-[11px] text-gray-600 whitespace-pre-wrap">{JSON.stringify(stats.byDepartment, null, 1)}</pre></div>
            ) : <div className="text-xs text-gray-300"><T k="데이터 없음" /></div>}
          </div>
        </div>
      )}

      {tab === 'violations' && (
        <div className="bg-white border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-3"><T k="근로시간 위반 (주52/80h·초과근무 합산)" /></h3>
          {violations.length === 0 ? <div className="text-xs text-gray-300"><T k="위반 없음" /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1 pr-4"><T k="직원" /></th><th className="px-2"><T k="부서" /></th><th className="px-2"><T k="주" /></th><th className="px-2"><T k="근무시간" /></th><th className="px-2"><T k="한도" /></th></tr></thead>
                <tbody>
                  {violations.map((v, i) => (
                    <tr key={i} className="border-b last:border-0 text-red-600">
                      <td className="py-1 pr-4">{v.staffName ?? v.name}</td><td className="px-2">{v.department}</td><td className="px-2">{v.week}</td><td className="px-2 font-semibold">{v.hours}h</td><td className="px-2">{v.limit}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === 'oncall' && (
        <div className="bg-white border rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <input type="date" value={oc.date} onChange={(e) => setOc({ ...oc, date: e.target.value })} className="border rounded px-2 py-1.5 text-sm" />
            <select value={oc.department} onChange={(e) => setOc({ ...oc, department: e.target.value })} className="border rounded px-2 py-1.5 text-sm">
              <option value="">{tAttr('부서')}</option>
              {departments.filter((d) => d !== '전체').map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={oc.callLevel} onChange={(e) => setOc({ ...oc, callLevel: e.target.value })} className="border rounded px-2 py-1.5 text-sm">
              {['FIRST', 'SECOND', 'BACKUP'].map((c) => <option key={c} value={c}>{CALL_LABEL[c]}</option>)}
            </select>
            <select value={oc.staffId} onChange={(e) => setOc({ ...oc, staffId: e.target.value })} className="border rounded px-2 py-1.5 text-sm">
              <option value="">{tAttr('직원')}</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.familyName}{s.givenName}</option>)}
            </select>
            <button onClick={() => oc.date && oc.department && oc.staffId && ocMut.mutate()} disabled={ocMut.isPending} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm disabled:opacity-50"><T k="당직 배정" /></button>
          </div>
          {oncall.length === 0 ? <div className="text-xs text-gray-300"><T k="당직(on-call) 배정 없음" /></div> : (
            <div className="space-y-1">
              {oncall.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-sm border-b py-1">
                  <span className="w-24 text-gray-500 shrink-0">{d.date}</span>
                  <div className="flex flex-wrap gap-1">
                    {d.calls.map((c) => <span key={c.id} className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">{c.department} {CALL_LABEL[c.callLevel] ?? c.callLevel} · {c.staffName}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'staffing' && (
        <div className="bg-white border rounded-xl p-4 space-y-3">
          <p className="text-xs text-gray-500"><T k={"부서·근무·요일별 최소 인원. 당직표에서 미달 시 '인력부족' 경고가 표시됩니다."} /></p>
          <div className="flex flex-wrap items-end gap-2">
            <select value={sr.department} onChange={(e) => setSr({ ...sr, department: e.target.value })} className="border rounded px-2 py-1.5 text-sm">
              <option value="">{tAttr('부서')}</option>
              {departments.filter((d) => d !== '전체').map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={sr.shift} onChange={(e) => setSr({ ...sr, shift: e.target.value })} className="border rounded px-2 py-1.5 text-sm">
              {['DAY', 'EVENING', 'NIGHT'].map((s) => <option key={s} value={s}>{SHIFT_LABEL[s]}</option>)}
            </select>
            <select value={sr.dayType} onChange={(e) => setSr({ ...sr, dayType: e.target.value })} className="border rounded px-2 py-1.5 text-sm">
              {['ALL', 'WEEKDAY', 'WEEKEND'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" min={1} value={sr.minCount} onChange={(e) => setSr({ ...sr, minCount: Number(e.target.value) })} className="border rounded px-2 py-1.5 text-sm w-20" />
            <button onClick={() => sr.department && srMut.mutate()} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm"><T k="기준 저장" /></button>
          </div>
          {staffingRules.length === 0 ? <div className="text-xs text-gray-300"><T k="인력기준 없음" /></div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1 pr-4"><T k="부서" /></th><th className="px-2"><T k="근무" /></th><th className="px-2"><T k="요일" /></th><th className="px-2"><T k="최소인원" /></th><th /></tr></thead>
              <tbody>
                {staffingRules.map((r) => (
                  <tr key={r.id} className="border-b last:border-0"><td className="py-1 pr-4">{r.department}</td><td className="px-2">{SHIFT_LABEL[r.shift] ?? r.shift}</td><td className="px-2">{r.dayType}</td><td className="px-2">{r.minCount}</td><td className="px-2"><button onClick={() => srDel.mutate(r.id)} className="text-red-500 text-xs"><T k="삭제" /></button></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* 🔴 인쇄는 어느 탭에서든 당직표 인쇄본(가로 A4)으로(2026-10-12 — 종전엔 빈 종이) */}
      <DutyRosterPrint month={monthStr} department={dept} days={sched.schedules ?? []} loading={isLoading} leaveLabel={LEAVE_LABEL} {...pr.state} />
    </div>
  );
}
