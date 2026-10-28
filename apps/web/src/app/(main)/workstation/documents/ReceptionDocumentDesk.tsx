'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DOC_ISSUANCE_STATUS_LABEL } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import StatusBadge from '@/components/ui/StatusBadge';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { kdate, money } from '@/lib/ui-settings';
import { FeeBillingBadge, FEE_BILLING_LABEL, type FeeBilling } from './FeeBillingBadge';

/**
 * 원무 창구 — 서류 발급 접수 + 대기 목록(2026-10-10 사용자 결정: 원무에게 **접수와 대기 목록만**).
 *  · 상세·작성·발급·거절·수령은 의무기록사·의료진 몫 — 이 화면은 그 EP 를 부르지 않는다(서버도 막는다)
 *  · 🔴 신청인 신분·관계 확인은 창구의 대면 책임 — 시스템은 검증하지 않고 기록만 남긴다(화면이 그렇게 말한다)
 *  · 쓰기 폼은 미선택으로 시작한다
 */
export const RECEPTION_DOC_TYPES: [string, string][] = [
  ['MEDICAL_RECORD', '의무기록 사본'], ['DIAGNOSIS_CERT', '진단서'], ['OPINION', '소견서'], ['ADMISSION_CERT', '입퇴원확인서'], ['DEATH_CERT', '사망진단서'], ['BIRTH_CERT', '출생증명서'],
];
const TYPE_LABEL = Object.fromEntries(RECEPTION_DOC_TYPES);
const LEGAL_BASIS: [string, string][] = [['SELF', '본인'], ['LEGAL_GUARDIAN', '법정대리인'], ['DELEGATED', '위임'], ['BEREAVED', '유족']];

type QueueItem = {
  id: string; receiptNumber?: string; type: string; status: string; copies: number; createdAt: string; slaDueAt?: string | null;
  deliveryMethod?: string; deliveryDestination?: string | null; legalBasis?: string | null; proxyVerifyStatus?: string | null;
  patient: { mrn?: string; name: string };
  feeBilling?: FeeBilling | null;
};
type Queue = { items: QueueItem[]; stats: Record<string, number>; total?: number; truncated?: boolean };
/** 접수 응답 — 접수증에 쓰는 값만 */
type Receipt = {
  id: string; type: string; copies: number; fee: number | null; deliveryMethod: string; deliveryDestination: string | null;
  slaDueAt: string | null; createdAt: string; legalBasis: string | null; proxyVerifyStatus: string | null;
  patient: { mrn: string | null; name: string }; receipt: { number: string; feeIsEstimate: boolean };
  feeBilling?: FeeBilling | null;
};

/** 수령 방법 — 포털은 환자 계정에서 내려받기 */
export const RECEPTION_DELIVERY: [string, string][] = [['VISIT', '방문 수령'], ['MAIL', '우편'], ['FAX', '팩스'], ['PORTAL', '포털 다운로드']];
const DELIVERY_LABEL = Object.fromEntries(RECEPTION_DELIVERY);
const BASIS_LABEL = Object.fromEntries(LEGAL_BASIS);
/** 팩스 번호 — 서버와 같은 규칙(숫자·하이픈 7~20자) */
const FAX_RE = /^[0-9][0-9-]{6,19}$/;

/** 쓰기 폼 검사 — 고르지 않은 칸·보낼 곳 누락을 이유로 돌려준다(버튼 옆에 그대로 말한다) */
export function intakeBlockers(f: { patientId: string; type: string; legalBasis: string; deliveryMethod: string; destination: string; copies: string }): string[] {
  const out: string[] = [];
  if (!f.patientId) out.push('대상 환자');
  if (!f.type) out.push('서류 종류');
  if (!f.legalBasis) out.push('신청 자격');
  if (!f.deliveryMethod) out.push('수령 방법');
  if (f.deliveryMethod === 'MAIL' && f.destination.trim().length < 5) out.push('우편 주소');
  if (f.deliveryMethod === 'FAX' && !FAX_RE.test(f.destination.trim())) out.push('팩스 번호');
  const n = Number(f.copies);
  if (!Number.isInteger(n) || n < 1 || n > 10) out.push('부수(1~10)');
  return out;
}

/**
 * 접수증 인쇄 — 화면 밖 iframe 에 **텍스트 노드로만** 그려 인쇄한다(HTML 문자열을 끼워 넣지 않는다).
 * 브라우저 인쇄 창을 여는 것이지 프린터로 보낸 것이 아니다(전송 흉내 없음).
 */
function printReceipt(title: string, rows: [string, string][], footer: string) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed'; frame.style.right = '0'; frame.style.bottom = '0'; frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  const h = doc.createElement('h2'); h.textContent = title; h.style.fontFamily = 'sans-serif';
  const table = doc.createElement('table'); table.style.fontFamily = 'sans-serif'; table.style.fontSize = '13px'; table.style.borderCollapse = 'collapse';
  for (const [k, v] of rows) {
    const tr = doc.createElement('tr');
    const th = doc.createElement('th'); th.textContent = k; th.style.textAlign = 'left'; th.style.padding = '4px 12px 4px 0';
    const td = doc.createElement('td'); td.textContent = v; td.style.padding = '4px 0';
    tr.append(th, td); table.appendChild(tr);
  }
  const p = doc.createElement('p'); p.textContent = footer; p.style.fontFamily = 'sans-serif'; p.style.fontSize = '11px'; p.style.color = '#555';
  doc.body.append(h, table, p);
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 1000);
}

const EMPTY = { patientId: '', type: '', purpose: '', copies: '1', relation: '', legalBasis: '', deliveryMethod: '', destination: '', identityChecked: false };

export function ReceptionDocumentDesk() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const [search, setSearch] = useState('');
  const term = search.trim();
  const q = useQuery({
    queryKey: ['reception-doc-queue', status, term],
    queryFn: async () => {
      const qs = new URLSearchParams({ status, ...(term ? { q: term } : {}) });
      const r = await apiClient.get<{ data: Queue }>(`/api/v1/staff/document-requests?${qs.toString()}`);
      const d = (r as { data?: unknown })?.data as Queue | { data: Queue };
      return ('items' in (d as object) ? d : (d as { data: Queue }).data) as Queue;
    },
  });
  const [form, setForm] = useState(EMPTY);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const isProxy = !!form.legalBasis && form.legalBasis !== 'SELF';
  const blockers = intakeBlockers(form);
  const submit = useMutation({
    mutationFn: async () => {
      const r = await apiClient.post<{ data: Receipt }>('/api/v1/staff/document-requests', {
        patientId: form.patientId, type: form.type, copies: Number(form.copies), legalBasis: form.legalBasis, deliveryMethod: form.deliveryMethod,
        ...(form.deliveryMethod === 'MAIL' || form.deliveryMethod === 'FAX' ? { deliveryDestination: form.destination.trim() } : {}),
        ...(form.purpose.trim() ? { purpose: form.purpose.trim() } : {}),
        ...(form.relation.trim() ? { requesterRelation: form.relation.trim() } : {}),
        ...(isProxy ? { identityChecked: form.identityChecked } : {}),
      });
      const d = (r as { data?: unknown })?.data as Receipt | { data: Receipt };
      return ('receipt' in (d as object) ? d : (d as { data: Receipt }).data) as Receipt;
    },
    onSuccess: (r) => {
      toast.success(tAttr('접수했습니다 — 작성·발급은 의무기록 담당이 진행합니다.'));
      setReceipt(r ?? null);
      setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ['reception-doc-queue'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('접수하지 못했습니다.')),
  });

  const receiptRows = (r: Receipt): [string, string][] => [
    [tAttr('접수번호'), r.receipt.number],
    [tAttr('환자'), `${r.patient.name} ${r.patient.mrn ?? ''}`.trim()],
    [tAttr('서류'), tAttr(TYPE_LABEL[r.type] ?? r.type)],
    [tAttr('부수'), String(r.copies)],
    [tAttr('신청 자격'), r.legalBasis ? tAttr(BASIS_LABEL[r.legalBasis] ?? r.legalBasis) : '—'],
    [tAttr('수령 방법'), tAttr(DELIVERY_LABEL[r.deliveryMethod] ?? r.deliveryMethod) + (r.deliveryDestination ? ` · ${r.deliveryDestination}` : '')],
    [tAttr('예상 수수료'), r.fee != null ? money(r.fee) : '—'],
    // 수납 연결(결정 documents.fee.billingLink) — 서버 파생 상태 그대로 · 없으면 모름
    [tAttr('수납'), r.feeBilling ? tAttr(FEE_BILLING_LABEL[r.feeBilling.state] ?? FEE_BILLING_LABEL.OTHER) : tAttr('수납 연결 상태 모름')],
    [tAttr('처리 기한'), kdate(r.slaDueAt, 'date', '—')],
    [tAttr('접수 시각'), kdate(r.createdAt, 'datetime', '—')],
  ];

  return (
    <div className="space-y-4" data-reception-doc-desk>
      <header>
        <h1 className="text-xl font-bold text-gray-900"><T k="서류 발급 창구 접수" /></h1>
        <p className="mt-1 text-sm text-gray-500"><T k="원무 창구는 접수와 대기 목록만 다룹니다. 작성·발급·거절은 의무기록 담당·의료진이 합니다." /></p>
      </header>

      {receipt && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4" data-reception-doc-receipt={receipt.receipt.number}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-emerald-900"><T k="접수증" /> · {receipt.receipt.number}</h2>
            <button type="button" className="ml-auto min-h-[44px] rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white" data-reception-doc-print
              onClick={() => printReceipt(tAttr('서류 발급 접수증'), receiptRows(receipt), [tAttr('수수료는 견적입니다 — 발급할 때 장수·부수로 다시 계산합니다.'), receipt.proxyVerifyStatus === 'VERIFIED' ? tAttr('창구 대면 확인 기록 있음(서류 진위는 시스템이 검증하지 않음)') : receipt.proxyVerifyStatus === 'PENDING' ? tAttr('대면 확인 안 함') : ''].filter(Boolean).join(' '))}>
              <T k="접수증 인쇄" />
            </button>
            <button type="button" className="min-h-[44px] rounded-xl border px-3 text-sm text-gray-700" onClick={() => setReceipt(null)}><T k="닫기" /></button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {receiptRows(receipt).map(([k, v]) => <div key={k}><dt className="text-[11px] text-gray-500">{k}</dt><dd className="font-medium text-gray-900">{v}</dd></div>)}
          </dl>
          <p className="mt-2 text-[11px] text-gray-600"><T k="수수료는 견적입니다 — 발급할 때 장수·부수로 다시 계산합니다." /></p>
        </section>
      )}

      <section className="rounded-2xl border bg-white p-4" data-reception-doc-form>
        <h2 className="mb-2 text-sm font-bold text-gray-800"><T k="새 접수" /></h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="대상 환자" /> *</label>
            <PatientSelector value={form.patientId} onChange={(id) => setForm({ ...form, patientId: id })} />
          </div>
          <label className="text-xs font-semibold text-gray-500"><T k="서류 종류" /> *
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-normal" data-reception-doc-type>
              <option value="">{tAttr('— 선택 —')}</option>
              {RECEPTION_DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-gray-500"><T k="신청 자격" /> *
            <select value={form.legalBasis} onChange={(e) => setForm({ ...form, legalBasis: e.target.value, identityChecked: false })} className="mt-1 w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-normal" data-reception-doc-basis>
              <option value="">{tAttr('— 선택 —')}</option>
              {LEGAL_BASIS.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-gray-500"><T k="수령 방법" /> *
            <select value={form.deliveryMethod} onChange={(e) => setForm({ ...form, deliveryMethod: e.target.value, destination: '' })} className="mt-1 w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-normal" data-reception-doc-delivery>
              <option value="">{tAttr('— 선택 —')}</option>
              {RECEPTION_DELIVERY.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
            </select>
          </label>
          {(form.deliveryMethod === 'MAIL' || form.deliveryMethod === 'FAX') && (
            <label className="text-xs font-semibold text-gray-500"><T k={form.deliveryMethod === 'MAIL' ? '우편 주소' : '팩스 번호'} /> *
              <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} inputMode={form.deliveryMethod === 'FAX' ? 'tel' : 'text'} data-reception-doc-destination
                className="mt-1 w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-normal" />
            </label>
          )}
          {form.deliveryMethod === 'PORTAL' && <p className="self-end text-[11px] text-gray-600 sm:col-span-1"><T k="환자 계정의 포털에서 내려받습니다 — 환자가 포털에 가입돼 있어야 합니다." /></p>}
          <label className="text-xs font-semibold text-gray-500"><T k="신청인 관계(대리 신청 시)" />
            <input value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} className="mt-1 w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-gray-500"><T k="용도" />
            <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="mt-1 w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-gray-500"><T k="부수" />
            <input value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value })} inputMode="numeric" className="mt-1 w-24 min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-normal" />
          </label>
          {isProxy && (
            <label className="flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-50 px-3 text-sm text-amber-900 sm:col-span-2" data-reception-doc-identity>
              <input type="checkbox" checked={form.identityChecked} onChange={(e) => setForm({ ...form, identityChecked: e.target.checked })} className="h-5 w-5" />
              <T k="신분증·관계(위임) 서류를 대면으로 확인했습니다" />
            </label>
          )}
        </div>
        <p className="mt-2 text-[11px] text-amber-700"><T k="신청인 신분·관계 확인은 창구의 대면 책임입니다 — 시스템은 검증하지 않고 기록만 남깁니다." /></p>
        {isProxy && !form.identityChecked && <p className="mt-1 text-[11px] text-gray-600" data-reception-doc-identity-pending><T k="확인하지 않고 접수하면 '대면 확인 안 함'으로 남고, 처리 화면에 그렇게 보입니다." /></p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={blockers.length > 0 || submit.isPending} onClick={() => submit.mutate()} data-reception-doc-submit
            className="min-h-[44px] rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-40">
            <T k="접수" />
          </button>
          {blockers.length > 0 && (
            <span className="text-[11px] text-gray-500" data-reception-doc-blockers={blockers.length}>
              <T k="남은 칸" />: {blockers.map((b, i) => <span key={b}>{i > 0 && ' · '}<T k={b} /></span>)}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4" data-reception-doc-queue>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-gray-800"><T k="대기 목록" /></h2>
          {Object.keys(DOC_ISSUANCE_STATUS_LABEL).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
              className={`min-h-[36px] rounded-lg px-2 text-xs ${status === s ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700'}`}>
              <T k={DOC_ISSUANCE_STATUS_LABEL[s]} /> {q.data?.stats?.[s] ?? ''}
            </button>
          ))}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tAttr('환자 이름·등록번호·접수번호')} aria-label={tAttr('대기 목록 찾기')} data-reception-doc-search
            className="ml-auto min-h-[36px] w-56 rounded-lg border border-gray-200 px-2 text-xs" />
        </div>
        {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
          : q.isLoading || !q.data ? <div className="h-20 animate-pulse rounded-xl bg-gray-50" />
          : q.data.items.length === 0 ? <EmptyState icon="📄" title={term ? '찾는 접수가 이 상태에 없습니다' : '이 상태의 접수가 없습니다'} compact />
          : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-1"><T k="접수번호" /></th><th><T k="접수 시각" /></th><th><T k="환자" /></th><th><T k="서류" /></th><th><T k="부수" /></th><th><T k="수령 방법" /></th><th><T k="상태" /></th><th><T k="처리 기한" /></th><th><T k="수납" /></th>
                  </tr></thead>
                  <tbody>
                    {q.data.items.map((i) => (
                      <tr key={i.id} className="border-b last:border-0" data-reception-doc-row={i.id}>
                        <td className="py-1.5 font-mono text-xs">{i.receiptNumber ?? '—'}</td>
                        <td><KDate value={i.createdAt} mode="datetime" /></td>
                        <td>{i.patient.name} <span className="text-xs text-gray-500">{i.patient.mrn}</span></td>
                        <td><T k={TYPE_LABEL[i.type] ?? i.type} /></td>
                        <td>{i.copies}</td>
                        <td className="text-xs">{i.deliveryMethod ? <T k={DELIVERY_LABEL[i.deliveryMethod] ?? i.deliveryMethod} /> : '—'}
                          {i.proxyVerifyStatus === 'PENDING' && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800" data-reception-doc-proxy-pending><T k="대면 확인 안 함" /></span>}</td>
                        <td><StatusBadge domain="docIssuance" status={i.status} /></td>
                        <td>{i.slaDueAt ? <KDate value={i.slaDueAt} /> : '—'}</td>
                        <td data-reception-doc-fee-billing><FeeBillingBadge value={i.feeBilling} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {q.data.truncated && <p className="mt-1 text-[11px] text-amber-700" data-reception-doc-truncated><Tf k="오래된 순 {shown}건만 보입니다(전체 {total}건)" params={{ shown: q.data.items.length, total: q.data.total ?? q.data.items.length }} /></p>}
            </>
          )}
      </section>
    </div>
  );
}
