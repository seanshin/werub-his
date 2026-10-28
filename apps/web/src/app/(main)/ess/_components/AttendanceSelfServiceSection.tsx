'use client';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';
import { kdate } from '@/lib/ui-settings';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import StatusBadge from '@/components/ui/StatusBadge';

// 근태 정정·초과근무 신청 (P1) — 결재 상신 후 상태 추적
const unwrap = <T,>(r: unknown): T => {
  const raw = (r as { data?: unknown })?.data as { data?: T } | T | undefined;
  return ((raw as { data?: T })?.data ?? raw) as T;
};
// 🔴 (2026-09-14 Q5) 로컬 STATUS_KO·STATUS_CLS 를 지웠다 — 결재함과 같은 shared `HR_REQUEST_STATUS_LABEL` + `<StatusBadge domain="hrRequest">`
//    (같은 신청의 상태를 결재함과 ESS 가 각자 표로 그리면 갈라진다).
const OT_KO: Record<string, string> = { EXTENDED: '연장', NIGHT: '야간', HOLIDAY: '휴일' };

export default function AttendanceSelfServiceSection() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [openForm, setOpenForm] = useState<'correction' | 'overtime' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [corr, setCorr] = useState({ workDate: kstToday(), correctedType: 'CLOCK_OUT', correctedTime: '18:00', reason: '' });
  const [ot, setOt] = useState({ workDate: kstToday(), otType: 'EXTENDED', startTime: '18:00', endTime: '20:00', reason: '' });

  const corrections = useQuery({
    queryKey: ['ess-corrections'],
    queryFn: () => apiClient.get('/api/v1/ess/attendance/corrections').then((r) => unwrap<any[]>(r) ?? []),
  });
  const overtimes = useQuery({
    queryKey: ['ess-overtimes'],
    queryFn: () => apiClient.get('/api/v1/ess/overtime').then((r) => unwrap<any[]>(r) ?? []),
  });

  const submitCorr = useMutation({
    mutationFn: () => apiClient.post('/api/v1/ess/attendance/corrections', {
      workDate: corr.workDate,
      correctedType: corr.correctedType,
      correctedAt: `${corr.workDate}T${corr.correctedTime}:00+09:00`,
      reason: corr.reason,
    }),
    onSuccess: (r) => {
      const d = unwrap<any>(r);
      // 🔴 성공 메시지도 로케일을 탄다 — 실패(`신청 실패`)만 배선돼 성공/실패가 서로 다른 언어로 뜨던 자리(§12-B)
      setMsg(d?.simulated ? tAttr('정정이 자동 승인되었습니다(데모)')
        : d?.approver ? tfAttr('정정 결재 상신 완료 — 결재자: {결재자}', { 결재자: String(d.approver) })
        : tAttr('정정 결재 상신 완료'));
      setOpenForm(null); setCorr({ ...corr, reason: '' });
      qc.invalidateQueries({ queryKey: ['ess-corrections'] });
      qc.invalidateQueries({ queryKey: ['ess-attendance'] });
    },
    onError: (e) => setMsg((e as { message?: string })?.message || tAttr('신청 실패')),
  });
  const submitOt = useMutation({
    mutationFn: () => apiClient.post('/api/v1/ess/overtime', {
      workDate: ot.workDate,
      otType: ot.otType,
      startAt: `${ot.workDate}T${ot.startTime}:00+09:00`,
      endAt: `${ot.workDate}T${ot.endTime}:00+09:00`,
      reason: ot.reason,
    }),
    onSuccess: (r) => {
      const d = unwrap<any>(r);
      // 경고문(`warning`)은 서버가 조립한 문장이라 그대로 싣는다(§12-G 축) — 번역하지 않는다
      const warn = d?.warning ? ` ⚠️${d.warning}` : '';
      setMsg(d?.approver
        ? tfAttr('초과근무 {시간}h 상신 완료{경고} — 결재자: {결재자}', { 시간: String(d?.hours), 경고: warn, 결재자: String(d.approver) })
        : tfAttr('초과근무 {시간}h 상신 완료{경고}', { 시간: String(d?.hours), 경고: warn }));
      setOpenForm(null); setOt({ ...ot, reason: '' });
      qc.invalidateQueries({ queryKey: ['ess-overtimes'] });
    },
    onError: (e) => setMsg((e as { message?: string })?.message || tAttr('신청 실패')),
  });

  const inputCls = 'px-2 py-1.5 text-xs border border-slate-200 rounded-lg';

  return (
    <section className="rounded-xl border p-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-sm"><T k="근태 정정 · 초과근무" /> <span className="font-normal text-slate-400 text-xs"><T k="(전자결재)" /></span></h2>
        <div className="flex gap-1.5">
          <button onClick={() => { setOpenForm(openForm === 'correction' ? null : 'correction'); setMsg(null); }}
            className="px-2 py-1 text-[11px] rounded-lg border border-slate-200 hover:bg-slate-50"><T k="정정 신청" /></button>
          <button onClick={() => { setOpenForm(openForm === 'overtime' ? null : 'overtime'); setMsg(null); }}
            className="px-2 py-1 text-[11px] rounded-lg border border-slate-200 hover:bg-slate-50"><T k="초과근무 신청" /></button>
        </div>
      </div>
      {msg && <div className="mb-2 rounded-lg bg-blue-50 px-3 py-1.5 text-[11px] text-blue-700">{msg}</div>}

      {openForm === 'correction' && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input type="date" value={corr.workDate} onChange={(e) => setCorr({ ...corr, workDate: e.target.value })} className={inputCls} />
            <select value={corr.correctedType} onChange={(e) => setCorr({ ...corr, correctedType: e.target.value })} className={inputCls}>
              <option value="CLOCK_IN">{tAttr('출근')}</option><option value="CLOCK_OUT">{tAttr('퇴근')}</option>
            </select>
            <input type="time" value={corr.correctedTime} onChange={(e) => setCorr({ ...corr, correctedTime: e.target.value })} className={inputCls} />
          </div>
          <ReasonInput domain="attendanceCorrection" required value={corr.reason} onChange={(v) => setCorr({ ...corr, reason: v })} placeholder={tAttr('사유(필수 — 자동마감 건은 10자 이상 소명)')} className={`${inputCls} w-full`} />
          <button disabled={!reasonFilled(corr.reason) || submitCorr.isPending} onClick={() => submitCorr.mutate()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs disabled:opacity-40"><T k="결재 상신" /></button>
        </div>
      )}

      {openForm === 'overtime' && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input type="date" value={ot.workDate} onChange={(e) => setOt({ ...ot, workDate: e.target.value })} className={inputCls} />
            <select value={ot.otType} onChange={(e) => setOt({ ...ot, otType: e.target.value })} className={inputCls}>
              <option value="EXTENDED">{tAttr('연장')}</option><option value="NIGHT">{tAttr('야간')}</option><option value="HOLIDAY">{tAttr('휴일')}</option>
            </select>
            <input type="time" value={ot.startTime} onChange={(e) => setOt({ ...ot, startTime: e.target.value })} className={inputCls} />
            <span className="text-xs text-slate-400 self-center">~</span>
            <input type="time" value={ot.endTime} onChange={(e) => setOt({ ...ot, endTime: e.target.value })} className={inputCls} />
          </div>
          <ReasonInput domain="overtime" required value={ot.reason} onChange={(v) => setOt({ ...ot, reason: v })} placeholder={tAttr('사유(필수)')} className={`${inputCls} w-full`} />
          <button disabled={!reasonFilled(ot.reason) || submitOt.isPending} onClick={() => submitOt.mutate()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs disabled:opacity-40"><T k="결재 상신" /></button>
        </div>
      )}

      <div className="text-xs text-slate-500 space-y-1 max-h-36 overflow-y-auto">
        {(corrections.data ?? []).slice(0, 4).map((c: any) => (
          <div key={c.id} className="flex justify-between">
            <span><T k="정정" /> {String(c.workDate).slice(0, 10)} {c.correctedType === 'CLOCK_IN' ? tAttr('출근') : tAttr('퇴근')} → {kdate(c.correctedAt, 'time')}</span>
            <StatusBadge domain="hrRequest" status={c.status} className="text-[10px]" />
          </div>
        ))}
        {(overtimes.data ?? []).slice(0, 4).map((o: any) => (
          <div key={o.id} className="flex justify-between">
            <span><T k="초과근무" /> {String(o.workDate).slice(0, 10)} <T k={OT_KO[o.otType] ?? o.otType} /> {o.hours}h{o.isPostFacto ? <> <T k="(사후)" /></> : ''}</span>
            <StatusBadge domain="hrRequest" status={o.status} className="text-[10px]" />
          </div>
        ))}
        {(corrections.data ?? []).length === 0 && (overtimes.data ?? []).length === 0 && <span className="text-slate-400"><T k="신청 이력 없음" /></span>}
      </div>
    </section>
  );
}
