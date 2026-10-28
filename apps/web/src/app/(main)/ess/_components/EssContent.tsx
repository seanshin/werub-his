'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';
import { kdate } from '@/lib/ui-settings';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import AttendanceSelfServiceSection from './AttendanceSelfServiceSection';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import type { ErpReadFailure } from '@hospital-run/shared';
import { ErpFailureNote } from './ErpFailureNote';

/** 🔴 R59 — ERP 목록 응답의 3상태: `items` 배열(있음/0건) · `items:null`+`failure`(못 받음). `?? []` 로 뭉개면 실패가 "0건"이 된다. */
interface ErpList<T> { items: T[] | null; available?: boolean; failure?: ErpReadFailure; upstreamStatus?: number | null }
/** 연차 잔여 응답 meta — 못 물어본 출처(항목이 0개여도 실패는 여기 남는다) */
interface BalanceMeta { unavailableSources?: { source: string; failure: ErpReadFailure; upstreamStatus: number | null }[] }

// 근태 인증수단 표기 — 서버가 기록한 값 그대로. 🔴 화면이 수단을 정하지 않는다(P16).
//   WEB=화면 버튼(로그인 세션) · QR=단말 QR · PIN=단말 PIN · BIO=생체 · AUTO=자동마감 · MANUAL=결재 정정
const CLOCK_METHOD_KO: Record<string, string> = {
  WEB: '화면', QR: 'QR', PIN: 'PIN', BIO: '생체', AUTO: '자동마감', MANUAL: '정정',
};

// 연차 잔여 출처 라벨 — 정본이 둘이라 화면이 어느 쪽인지 말해야 한다(P12)
const BALANCE_SOURCE_KO: Record<string, string> = { ERP: '급여시스템(ERP)', HIS_LEDGER: 'HIS 연차원장' };

// 내 행정(ESS) 공용 콘텐츠 — 데스크톱(/ess)·모바일(/staff/ess) 양쪽에서 재사용.
export function EssContent({ showTitle = true }: { showTitle?: boolean }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ['ess-me'], queryFn: () => apiClient.get<{ data: any }>('/api/v1/hr/me') });
  const attendance = useQuery({ queryKey: ['ess-attendance'], queryFn: () => apiClient.get<{ data: any[] }>('/api/v1/ess/attendance') });
  const leaves = useQuery({ queryKey: ['ess-leaves'], queryFn: () => apiClient.get<{ data: any[] }>('/api/v1/ess/leave') });
  const balance = useQuery({ queryKey: ['ess-balance'], queryFn: () => apiClient.get<{ data: any[]; meta?: BalanceMeta }>('/api/v1/ess/leave/balance') });
  const erpCerts = useQuery({ queryKey: ['ess-erp-certs'], queryFn: () => apiClient.get<{ data: ErpList<any> }>('/api/v1/ess/erp-certificates').then((r) => r.data) });
  const certItems = erpCerts.data?.items ?? [];
  const certsDown = !erpCerts.isLoading && !erpCerts.isError && erpCerts.data?.available === false;
  const quals = useQuery({ queryKey: ['ess-quals'], queryFn: () => apiClient.get<{ data: { credentials: any[]; educations: any[] } }>('/api/v1/ess/qualifications') });

  // 🔴 하지 않은 인증을 기록하지 않는다(P16) — 이 화면에는 생체 절차가 전혀 없는데
  //    구 코드는 method:'BIO' 를 하드코딩해 보냈고, 근태(법정 기록) 이력에 "생체"로 남았다.
  //    수단 결정은 서버가 한다(clockFromClient → WEB). body 로 수단을 선언하지 않는다.
  const clockMut = useMutation({
    mutationFn: (type: string) => apiClient.post('/api/v1/ess/attendance/clock', { type }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ess-attendance'] }),
  });
  const downloadCert = async (id: string, name: string) => {
    const res = await fetch(`/api/v1/ess/erp-certificates/${id}/pdf`, { headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` } });
    if (!res.ok) { alert(tAttr('다운로드 실패')); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `${name || tAttr('증명서')}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const staff = me.data?.data;

  return (
    <div className="space-y-5">
      {showTitle && (
        <div>
          <h1 className="text-xl font-bold"><T k="내 행정 (ESS)" /></h1>
          <p className="text-sm text-slate-500">{staff ? `${staff.familyName}${staff.givenName} · ${staff.department ?? ''} ${staff.position ?? ''}` : tAttr('근태·휴가·증명서·내 정보')}</p>
          {me.isError && <QueryErrorFallback error={me.error} onRetry={me.refetch} size="compact" className="mt-2" />}
        </div>
      )}

      {/* 출퇴근 */}
      <section className="rounded-xl border p-4 bg-white">
        <h2 className="font-semibold text-sm mb-3"><T k="출퇴근" /></h2>
        <div className="flex gap-2">
          <button onClick={() => clockMut.mutate('CLOCK_IN')} disabled={clockMut.isPending} className="flex-1 px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"><T k="출근" /></button>
          <button onClick={() => clockMut.mutate('CLOCK_OUT')} disabled={clockMut.isPending} className="flex-1 px-4 py-3 rounded-lg bg-slate-700 text-white text-sm font-medium disabled:opacity-50"><T k="퇴근" /></button>
        </div>
        <div className="mt-3 text-xs text-slate-500 space-y-1 max-h-32 overflow-y-auto">
          {(attendance.data?.data ?? []).slice(0, 6).map((a) => (
            <div key={a.id} className="flex justify-between">
              <span><T k={a.type === 'CLOCK_IN' ? '출근' : '퇴근'} /> (<T k={CLOCK_METHOD_KO[a.method] ?? a.method} />)</span>
              <span>{kdate(a.at, 'datetimeSec')}</span>
            </div>
          ))}
          {(attendance.data?.data ?? []).length === 0 && <span className="text-slate-400"><T k="기록 없음" /></span>}
        </div>
      </section>

      {/* 근태 정정·초과근무 (P1) */}
      <AttendanceSelfServiceSection />

      {/* 휴가 */}
      <LeaveSection balance={balance.data?.data ?? []} unavailableSources={balance.data?.meta?.unavailableSources ?? []} leaves={leaves.data?.data ?? []} onSubmitted={() => { qc.invalidateQueries({ queryKey: ['ess-leaves'] }); }} />

      {/* 증명서 (ERP 정본) */}
      <section className="rounded-xl border p-4 bg-white">
        <h2 className="font-semibold text-sm mb-1"><T k="증명서" /> <span className="font-normal text-slate-400 text-xs"><T k="(재직·경력·ERP 발급)" /></span></h2>
        <div className="mt-2 text-xs text-slate-500 space-y-1">
          {certItems.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between border-b border-slate-50 pb-1">
              <span>{c.typeName ?? c.type ?? tAttr('증명서')}{c.issuedAt ? ` · ${String(c.issuedAt).slice(0, 10)}` : ''}</span>
              <button onClick={() => downloadCert(c.id, c.typeName ?? c.type)} className="text-blue-500 hover:text-blue-700 text-[11px]"><T k="PDF 받기" /></button>
            </div>
          ))}
          {/* 🔴 ERP 조회 실패를 "발급된 증명서가 없습니다"로 말하지 않는다 — 서버가 가른 사유(failure)를 읽는다 */}
          {erpCerts.isError && <QueryErrorFallback error={erpCerts.error} onRetry={erpCerts.refetch} size="compact" />}
          {certsDown && (
            <ErpFailureNote failure={erpCerts.data?.failure} upstreamStatus={erpCerts.data?.upstreamStatus} onRetry={() => void erpCerts.refetch()}><T k="증명서 목록을 확인할 수 없습니다" /></ErpFailureNote>
          )}
          {!erpCerts.isError && !certsDown && !erpCerts.isLoading && certItems.length === 0 && <span className="text-slate-400"><T k="발급된 증명서가 없습니다. 필요 시 인사팀에 발급을 요청하세요." /></span>}
        </div>
      </section>

      {/* 자격·교육 */}
      <section className="rounded-xl border p-4 bg-white">
        <h2 className="font-semibold text-sm mb-3"><T k="면허·자격 / 의무교육" /></h2>
        <div className="text-xs text-slate-500 space-y-1 max-h-40 overflow-y-auto">
          {(quals.data?.data?.credentials ?? []).map((c) => (
            <div key={c.id} className="flex justify-between">
              <span>{c.name} ({c.type})</span>
              <span className="whitespace-nowrap">{c.expiresAt ? `~${c.expiresAt.slice(0, 10)}` : tAttr('무기한')} · {c.status}</span>
            </div>
          ))}
          {(quals.data?.data?.educations ?? []).map((e) => (
            <div key={e.id} className="flex justify-between">
              <span>{e.courseName} ({e.category})</span>
              <span className="whitespace-nowrap">{e.completedAt ? tfAttr('이수 {일자}', { 일자: e.completedAt.slice(0, 10) }) : tAttr('미이수')}</span>
            </div>
          ))}
          {(quals.data?.data?.credentials ?? []).length === 0 && (quals.data?.data?.educations ?? []).length === 0 && (
            <span className="text-slate-400"><T k="등록된 자격·교육 없음" /></span>
          )}
        </div>
      </section>
    </div>
  );
}

function LeaveSection({ balance, unavailableSources, leaves, onSubmitted }: { balance: any[]; unavailableSources: NonNullable<BalanceMeta['unavailableSources']>; leaves: any[]; onSubmitted: () => void }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [f, setF] = useState({ type: 'ANNUAL', fromDate: '', toDate: '', days: 1, reason: '' });
  // 🔴 서버가 잔여 초과로 400 을 내도 화면이 아무 말도 하지 않아 "왜 안 되지"로 끝나던 것 —
  //    서버 판단(차단 사유·잔여 불일치 경고)을 그대로 되비친다.
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const mut = useMutation({
    mutationFn: (body: any) => apiClient.post('/api/v1/ess/leave', body),
    onSuccess: (r: any) => {
      const d = r?.data ?? r;
      // 경고문(`warning`)은 서버가 조립한 문장이라 그대로 싣는다(§12-G 축) — 앞 머리만 로케일을 탄다
      setMsg(d?.warning ? { kind: 'warn', text: tfAttr('신청 접수 — {경고}', { 경고: String(d.warning) }) } : { kind: 'ok', text: tAttr('휴가 신청이 접수되었습니다') });
      onSubmitted(); qc.invalidateQueries({ queryKey: ['ess-leaves'] }); qc.invalidateQueries({ queryKey: ['ess-balance'] });
      setF({ type: 'ANNUAL', fromDate: '', toDate: '', days: 1, reason: '' });
    },
    onError: (e: any) => setMsg({ kind: 'err', text: e?.message || tAttr('휴가 신청에 실패했습니다') }),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/ess/leave/${id}/cancel`, { reason: '개인 사정으로 휴가 취소' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ess-leaves'] }); onSubmitted(); },
  });
  const annual = balance.find((b) => b.type === 'ANNUAL');
  // 🔴 P12(정본이 둘) — 연차 잔여는 ERP 와 HIS 원장이 서로 다른 값을 말한다(실측 17 vs 12).
  //    구 화면은 "연차 잔여 17일" 하나만 보여줘 어느 기록인지도, 5일 차이가 있다는 것도 숨겼다.
  //    표시 정본은 출처와 함께 말하고, 다른 출처와 '실제 승인 한도'를 그 아래에 그대로 드러낸다.
  const altSources: any[] = annual?.alternates ?? [];
  const showDiscrepancy = !!annual?.discrepancy;

  return (
    <section className="rounded-xl border p-4 bg-white">
      <div className="flex items-start justify-between mb-3 gap-3">
        <h2 className="font-semibold text-sm"><T k="휴가" /></h2>
        {annual && (
          <div className="text-right">
            <span className="text-xs text-slate-500">
              <T k="연차 잔여" /> {annual.remaining ?? '-'}<Unit>일</Unit>
              {annual.source && <span className="text-slate-400"> · <T k={BALANCE_SOURCE_KO[annual.source] ?? annual.source} /> <T k="기준" /></span>}
            </span>
            {showDiscrepancy && (
              <p className="mt-0.5 text-[11px] text-amber-600">
                {/* 🔴 숫자가 문장 가운데 끼는 자리 — 조각(`신청은`+N+`까지만…`)은 어순이 언어마다 뒤집혀 보간으로 합쳤다 */}
                ⚠ <Tf k="{출처목록} — 기록이 서로 다릅니다." params={{ 출처목록: altSources.map((s) => tfAttr('{출처} {일수}일', { 출처: tAttr(BALANCE_SOURCE_KO[s.source] ?? s.source), 일수: String(s.remaining) })).join(' · ') }} />
                <Tf k="신청은 {일수}일까지만 승인됩니다(인사팀 확인 필요)" params={{ 일수: annual.enforceRemaining ?? '' }} />
              </p>
            )}
            {!showDiscrepancy && annual.enforceRemaining == null && (
              <p className="mt-0.5 text-[11px] text-slate-400"><T k="연차 부여 정보가 없어 잔여 검증 없이 접수됩니다" /></p>
            )}
          </div>
        )}
        {!annual && <span className="text-xs text-slate-400"><T k="연차 잔여 정보 없음" /></span>}
      </div>
      {/* 🔴 R59 — ERP 를 **못 물어본** 사실은 항목이 아니라 meta 로 온다(항목 0개여도 남는다).
          이것이 없으면 HIS 원장 하나만 보고 "출처가 일치한다"·"정보 없음"으로 읽힌다. */}
      {unavailableSources.map((u) => (
        <ErpFailureNote key={u.source} failure={u.failure} upstreamStatus={u.upstreamStatus} className="mb-3 text-[11px] text-amber-600">
          <Tf k="{출처} 연차 잔여를 확인하지 못했습니다(표시된 값은 나머지 출처 기준)" params={{ 출처: <T k={BALANCE_SOURCE_KO[u.source] ?? u.source} /> }} />
        </ErpFailureNote>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="ANNUAL">{tAttr('연차')}</option><option value="HALF">{tAttr('반차')}</option><option value="SICK">{tAttr('병가')}</option><option value="BEREAVEMENT">{tAttr('경조')}</option><option value="OUTING">{tAttr('외출')}</option>
        </select>
        <input type="number" min={0.5} step={0.5} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} className="border rounded-lg px-2 py-1.5 text-sm" placeholder={tAttr('일수')} />
        <input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} className="border rounded-lg px-2 py-1.5 text-sm" />
        <input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} className="border rounded-lg px-2 py-1.5 text-sm" />
        <div className="col-span-2"><ReasonInput domain="essLeave" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} placeholder={tAttr('사유(선택)')} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
        <button onClick={() => { setMsg(null); mut.mutate({ ...f, fromDate: f.fromDate || undefined, toDate: f.toDate || f.fromDate || undefined }); }} disabled={mut.isPending || !f.fromDate} className="col-span-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"><T k="휴가 신청" /></button>
      </div>
      {msg && (
        <div className={`mt-2 rounded-lg px-3 py-1.5 text-[11px] ${msg.kind === 'err' ? 'bg-red-50 text-red-700' : msg.kind === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
          {msg.text}
        </div>
      )}
      <div className="mt-3 text-xs text-slate-500 space-y-1 max-h-32 overflow-y-auto">
        {leaves.map((l) => (
          <div key={l.id} className="flex justify-between items-center">
            <span>{l.type} {l.fromDate?.slice(5, 10)}{l.toDate && l.toDate !== l.fromDate ? `~${l.toDate.slice(5, 10)}` : ''} ({l.days}<Unit>일</Unit>)</span>
            <span className="flex items-center gap-1.5">
              <span className={l.status === 'APPROVED' ? 'text-emerald-600' : l.status === 'REJECTED' ? 'text-red-500' : l.status === 'WITHDRAWN' ? 'text-slate-400' : 'text-amber-600'}>{l.status}</span>
              {l.status === 'APPROVED' && (
                <button onClick={() => cancelMut.mutate(l.id)} disabled={cancelMut.isPending}
                  className="text-[10px] text-red-500 border border-red-200 rounded px-1 py-0.5 hover:bg-red-50 disabled:opacity-40"><T k="취소" /></button>
              )}
            </span>
          </div>
        ))}
        {leaves.length === 0 && <span className="text-slate-400"><T k="신청 내역 없음" /></span>}
      </div>
    </section>
  );
}
