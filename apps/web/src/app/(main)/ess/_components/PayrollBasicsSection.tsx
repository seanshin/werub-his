'use client';

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { HIS_MODE_META, type ErpReadFailure, type HisMode } from '@hospital-run/shared';
import { ErpFailureNote } from './ErpFailureNote';

interface Dependent { id: string; name: string; relation: string; birthDate?: string | null; isDependent: boolean; deductionType?: string | null; note?: string | null }
interface StaffDoc { id: string; category: string; fileName: string; sizeBytes?: number | null; status: string; createdAt: string }
interface PayrollStatus { relayEnabled: boolean; bankName?: string | null; bankAccountMask?: string | null; bankHolder?: string | null; bankRelayedAt?: string | null; residentIdMask?: string | null; residentRelayedAt?: string | null }

const DOC_CATS = [
  { v: 'BANKBOOK', l: '통장사본' }, { v: 'ID_CARD', l: '신분증' },
  { v: 'FAMILY_CERT', l: '가족관계증명' }, { v: 'RESIDENT_REG', l: '주민등록등본' }, { v: 'OTHER', l: '기타' },
];
const catLabel = (v: string) => DOC_CATS.find((c) => c.v === v)?.l ?? v;
const RELATIONS = ['배우자', '자녀', '부', '모', '형제자매', '조부모', '기타'];
/**
 * 관계 **표시** 키 — 🔴 `RELATIONS` 의 값은 곧 저장값(한국어)이라 바꾸지 않는다. 표시만 이 표를 거친다.
 * 한 글자 `부`·`모` 는 맨 키로 두면 다른 뜻(부서·부·모형 등)과 한 키를 나눠 쓰게 되어 문맥 키로 가른다.
 */
const RELATION_LABEL_KEY: Record<string, string> = { 부: '부@가족관계', 모: '모@가족관계' };
const relKey = (r: string) => RELATION_LABEL_KEY[r] ?? r;

export function PayrollBasicsSection() {
  const qc = useQueryClient();
  const deps = useQuery({ queryKey: ['ess-dependents'], queryFn: () => apiClient.get<{ data: Dependent[] }>('/api/v1/ess/dependents') });
  const docs = useQuery({ queryKey: ['ess-documents'], queryFn: () => apiClient.get<{ data: StaffDoc[] }>('/api/v1/ess/documents') });
  const pay = useQuery({ queryKey: ['ess-payroll-identity'], queryFn: () => apiClient.get<{ data: PayrollStatus }>('/api/v1/ess/payroll-identity') });

  return (
    <section className="rounded-xl border p-4 space-y-6">
      <div>
        <h2 className="font-semibold text-sm"><T k="급여 기초정보" /></h2>
        <p className="text-xs text-slate-400 mt-0.5"><T k="계좌·주민번호는 안전을 위해 HIS에 보관하지 않고 급여시스템(ERP)으로 전송됩니다." /></p>
      </div>
      <PayrollIdentityBlock status={pay.data?.data} onChange={() => qc.invalidateQueries({ queryKey: ['ess-payroll-identity'] })} />
      <DependentsBlock items={deps.data?.data ?? []} onChange={() => qc.invalidateQueries({ queryKey: ['ess-dependents'] })} />
      <DocumentsBlock items={docs.data?.data ?? []} onChange={() => qc.invalidateQueries({ queryKey: ['ess-documents'] })} />
    </section>
  );
}

// ── 계좌·주민번호 (ERP 릴레이·HIS 미보관) ──
/** 🔴 R59 — `registered:null`+`unavailable:true` = 못 물어봤다(`failure` 에 사유). `registered:false` 만이 "ERP 미등록"이다. */
interface ErpIdentity { registered?: boolean | null; unavailable?: boolean; failure?: ErpReadFailure; upstreamStatus?: number | null; bankName?: string | null; accountMasked?: string | null; holder?: string | null; residentMasked?: string | null; dependents?: number }
/** 릴레이 응답 — 🔴 `heldByMode` 는 실패가 아니라 **보류**(리얼이 아닌 모드에서는 ERP 로 보내지 않는다 · 전송 시각도 남지 않는다) */
interface RelayResp { relayed: boolean; heldByMode?: HisMode }
function PayrollIdentityBlock({ status, onChange }: { status?: PayrollStatus; onChange: () => void }) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [f, setF] = useState({ bankName: '', bankAccount: '', bankHolder: '', residentId: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = status?.relayEnabled ?? false;
  const erpQ = useQuery({ queryKey: ['ess-erp-payroll-identity'], queryFn: () => apiClient.get<{ data: ErpIdentity }>('/api/v1/ess/payroll-identity/erp').then((r) => r.data) });
  const erp = erpQ.data;

  const submit = async () => {
    setMsg(null); setBusy(true);
    try {
      const res = await apiClient.put<{ data: RelayResp }>('/api/v1/ess/payroll-identity', f);
      if (res.data?.heldByMode) {
        // 🔴 보내지 않았다(모드) — "전송되었습니다"도, 실패도 아니다. 입력은 지우지 않는다(리얼 전환 뒤 다시 제출한다).
        setMsg(tfAttr('{모드} 모드에서는 급여시스템(ERP)으로 보내지 않았습니다 — 계좌·주민번호는 전송되지 않았고 기록도 남지 않았습니다. 실운영 전환 후 다시 제출해 주세요.', { 모드: tAttr(HIS_MODE_META[res.data.heldByMode]?.label ?? res.data.heldByMode) }));
        return;
      }
      setF({ bankName: '', bankAccount: '', bankHolder: '', residentId: '' });
      setMsg(tAttr('전송되었습니다.'));
      onChange();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : tAttr('전송 실패'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-600"><T k="계좌 · 주민등록번호" /></h3>
      {/* 현재 상태(마스킹) */}
      <div className="text-xs text-slate-500 space-y-0.5">
        <div><T k="계좌:" /> {status?.bankAccountMask ? `${status.bankName ?? ''} ${status.bankAccountMask} (${status.bankHolder ?? ''})` : tAttr('미등록')} {status?.bankRelayedAt && <span className="text-emerald-500">· <Tf k="ERP 전송 {일자}" params={{ 일자: status.bankRelayedAt.slice(0, 10) }} /></span>}</div>
        <div><T k="주민번호:" /> {status?.residentIdMask ?? tAttr('미등록')} {status?.residentRelayedAt && <span className="text-emerald-500">· <Tf k="ERP 전송 {일자}" params={{ 일자: status.residentRelayedAt.slice(0, 10) }} /></span>}</div>
      </div>
      {/* ERP 등록 현황(R-4 readback) — 🔴 조회 실패를 'ERP 미등록'으로 말하지 않는다. 서버가 가른 사유(failure)를 그대로 읽는다 */}
      {erpQ.isError && <QueryErrorFallback error={erpQ.error} onRetry={() => erpQ.refetch()} size="compact" />}
      {!erpQ.isError && erp?.unavailable && (
        <ErpFailureNote failure={erp.failure} upstreamStatus={erp.upstreamStatus} onRetry={() => erpQ.refetch()} className="text-[11px] text-amber-600 border-l-2 border-amber-200 pl-2">
          <T k="급여시스템(ERP) 등록 현황을 확인할 수 없습니다" />
        </ErpFailureNote>
      )}
      {!erpQ.isError && erp && !erp.unavailable && (
        <div className="text-[11px] text-slate-400 border-l-2 border-emerald-200 pl-2">
          <T k="급여시스템(ERP) 등록:" /> {erp.registered
            ? <>{erp.bankName ?? ''} {erp.accountMasked ?? ''}{erp.residentMasked ? <> · <Tf k="주민 {번호}" params={{ 번호: erp.residentMasked }} /></> : ''}{typeof erp.dependents === 'number' ? <> · <Tf k="부양가족 {명}명" params={{ 명: erp.dependents }} /></> : ''}</>
            : tAttr('미등록')}
        </div>
      )}
      {enabled ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder={tAttr('은행명')} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
          <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder={tAttr('예금주')} value={f.bankHolder} onChange={(e) => setF({ ...f, bankHolder: e.target.value })} />
          <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder={tAttr('계좌번호(숫자)')} value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} />
          <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder={tAttr('주민등록번호(13자리)')} value={f.residentId} onChange={(e) => setF({ ...f, residentId: e.target.value })} />
          <div className="col-span-2 flex items-center gap-2">
            <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"><T k="ERP로 전송" /></button>
            {msg && <span className="text-xs text-slate-500">{msg}</span>}
          </div>
        </div>
      ) : (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2">
          <T k="ERP 급여 보안 연동 준비 중입니다. 지금은 아래" /> <b><T k="통장사본·신분증" /></b><T k="을 서류로 제출해 주세요. (연동 활성화 시 직접 입력으로 전환됩니다)" />
        </div>
      )}
    </div>
  );
}

// ── 부양가족 ──
interface DeductionCode { code: string; name: string }
function DependentsBlock({ items, onChange }: { items: Dependent[]; onChange: () => void }) {
  const tAttr = useTAttr();
  const [f, setF] = useState({ name: '', relation: '배우자', birthDate: '', deductionType: '', note: '' });
  // 🔴 R59 — `items: null` 은 "공제구분이 없는 회사"가 아니라 **못 받았다**(failure 에 사유). `?? []` 로 뭉개면 빈 셀렉트가 사실처럼 보인다.
  const codesQ = useQuery({ queryKey: ['ess-deduction-codes'], queryFn: () => apiClient.get<{ data: { items: DeductionCode[] | null; available?: boolean; failure?: ErpReadFailure; upstreamStatus?: number | null } }>('/api/v1/ess/deduction-codes').then((r) => r.data) });
  const codes = codesQ.data?.items ?? [];
  const codesDown = !codesQ.isLoading && !codesQ.isError && codesQ.data?.available === false;
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!f.name) return;
    setBusy(true);
    try {
      await apiClient.post('/api/v1/ess/dependents', { ...f, birthDate: f.birthDate || undefined, deductionType: f.deductionType || undefined, note: f.note || undefined });
      setF({ name: '', relation: '배우자', birthDate: '', deductionType: '', note: '' });
      onChange();
    } finally { setBusy(false); }
  };
  const del = async (id: string) => { await apiClient.del(`/api/v1/ess/dependents/${id}`); onChange(); };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-600"><T k="부양가족 (인적공제)" /></h3>
      <div className="text-xs text-slate-500 space-y-1">
        {items.map((d) => (
          <div key={d.id} className="flex items-center justify-between border-b border-slate-50 pb-1">
            <span>{d.name} · {tAttr(relKey(d.relation))}{d.birthDate ? ` · ${d.birthDate.slice(0, 10)}` : ''}{d.deductionType ? ` · ${d.deductionType}` : ''}{d.isDependent ? '' : ` · ${tAttr('공제제외')}`}</span>
            <button onClick={() => del(d.id)} className="text-red-400 hover:text-red-600 text-[11px]"><T k="삭제" /></button>
          </div>
        ))}
        {items.length === 0 && <span className="text-slate-400"><T k="등록된 부양가족 없음" /></span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder={tAttr('성명')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}>
          {/* 🔴 `value` 가 곧 저장값(한국어)이다 — 표시만 번역하고 값은 건드리지 않는다 */}
          {RELATIONS.map((r) => <option key={r} value={r}>{tAttr(relKey(r))}</option>)}
        </select>
        <input type="date" className="border rounded-lg px-2 py-1.5 text-sm" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} />
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={f.deductionType} onChange={(e) => setF({ ...f, deductionType: e.target.value })}>
          <option value="">{tAttr('공제구분(선택)')}</option>
          {codes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        {/* 🔴 공제구분 목록 조회 실패를 "선택지 없음"으로 접지 않는다 */}
        {codesQ.isError && <div className="sm:col-span-2"><QueryErrorFallback error={codesQ.error} onRetry={() => codesQ.refetch()} size="compact" /></div>}
        {codesDown && (
          <div className="sm:col-span-2">
            <ErpFailureNote failure={codesQ.data?.failure} upstreamStatus={codesQ.data?.upstreamStatus} onRetry={() => codesQ.refetch()} className="text-[11px] text-amber-600">
              <T k="공제구분 목록을 받지 못했습니다" />
            </ErpFailureNote>
          </div>
        )}
        <button onClick={add} disabled={busy || !f.name} className="col-span-2 px-3 py-1.5 rounded-lg border text-sm hover:bg-slate-50 disabled:opacity-50"><T k="부양가족 추가" /></button>
      </div>
    </div>
  );
}

// ── 입사/급여 서류(암호화 저장) ──
function DocumentsBlock({ items, onChange }: { items: StaffDoc[]; onChange: () => void }) {
  const tAttr = useTAttr();
  const [cat, setCat] = useState('BANKBOOK');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', cat);
      const res = await fetch('/api/v1/ess/documents', { method: 'POST', headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` }, body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? tAttr('업로드 실패'));
      onChange();
    } catch (e) {
      alert(e instanceof Error ? e.message : tAttr('업로드 실패'));
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const download = async (id: string, name: string) => {
    const res = await fetch(`/api/v1/ess/documents/${id}/file`, { headers: { Authorization: `Bearer ${apiClient.getToken() ?? ''}` } });
    if (!res.ok) { alert(tAttr('다운로드 실패')); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const del = async (id: string) => { await apiClient.del(`/api/v1/ess/documents/${id}`); onChange(); };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-600"><T k="입사 · 급여 서류" /> <span className="font-normal text-slate-400"><T k="(암호화 저장)" /></span></h3>
      <div className="text-xs text-slate-500 space-y-1">
        {items.map((d) => (
          <div key={d.id} className="flex items-center justify-between border-b border-slate-50 pb-1">
            <span>[<T k={catLabel(d.category)} />] {d.fileName} · {d.createdAt.slice(0, 10)}</span>
            <span className="flex gap-2">
              <button onClick={() => download(d.id, d.fileName)} className="text-blue-500 hover:text-blue-700 text-[11px]"><T k="받기" /></button>
              <button onClick={() => del(d.id)} className="text-red-400 hover:text-red-600 text-[11px]"><T k="삭제" /></button>
            </span>
          </div>
        ))}
        {items.length === 0 && <span className="text-slate-400"><T k="제출된 서류 없음" /></span>}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
          {DOC_CATS.map((c) => <option key={c.v} value={c.v}>{tAttr(c.l)}</option>)}
        </select>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf,image/heic" disabled={busy}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); }}
          className="text-xs flex-1" />
      </div>
    </div>
  );
}
