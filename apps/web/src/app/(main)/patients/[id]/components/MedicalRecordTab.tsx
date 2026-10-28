'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate, StaffName, Unit } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { extractErrorMessage } from '@/lib/error-utils';
import {
  HIM_DEFICIENCY_LABEL, ISSUED_DOC_TYPE_LABEL, ISSUED_DOC_STATUS_LABEL, DOC_REQUEST_TYPE_LABEL, DELIVERY_METHOD_LABEL, labelOf,
  AMENDMENT_RECORD_TYPE_LABEL, AMENDMENT_SOURCE_LABEL, AMENDED_FIELD_LABEL,
} from '@/lib/medical-record-labels';
import { DOC_ISSUANCE_STATUS_LABEL } from '@hospital-run/shared';

/**
 * 환자 차트 '의무기록' 탭(2026-10-02).
 *
 * 🔴 서버에는 다 있었는데 **환자 차트에서 볼 자리가 없었다**:
 *  ① 기록 완결(미비) — 퇴원요약 미비·미서명 진료/간호기록·상병 미입력 서명은 병원 전체 목록(/admin/him)뿐
 *  ② 발급 문서 — 이 환자에게 무엇이(진단서·사본…) 원본/사본/재발급/무효로 나갔는지
 *  ③ 발급 요청 — 사본 발급 요청이 어디까지 왔는지
 *  ④ 열람 이력 — 누가 언제 이 환자 기록을 봤는지(EP 는 있었지만 부르는 화면 0 · 50건에서 말없이 잘림 · 직원 IP 를 누구에게나)
 *  ⑤ 정정 이력(2026-10-03) — 🔴 진료기록·퇴원요약 정정은 서명본을 덮어써 정정 전 내용이 남지 않았다 → 서버가 정정 순간 직전 서명본을
 *     보존하고, 여기서 출처별로(보존본·미보존·간호 정정문·검사 수정) 나란히 보인다. 보존 이전 정정은 "미보존"이라 말한다.
 *  ⑥ 사본 발급 신청 접수(2026-10-03) — 직원 접수 EP 는 있었는데 의무기록 사본을 받는 화면이 없었다(증명서 창구는 진단서 등만)
 * 권한: 서버와 같다(관리자·의사·간호사·의무기록사) — 밖이면 **묻지 않고** 그 사실만 말한다(비어 있다는 뜻이 아니다).
 */
interface Deficiency { type: string; refId: string; responsibleName: string; since: string; overdueDays: number; detail: string }
interface RecordBundle {
  deficiencies: { items: Deficiency[]; counts: { total: number; overdue: number }; policy: { summaryDueDays: number; encounterDueDays: number; noteDueDays: number; lookbackDays: number } };
  issuedDocuments: { total: number; limit: number; items: Array<{ issueNo: string; documentType: string; status: string; reissueOf: string | null; issuedAt: string; issuedBy: { id: string; name: string | null } | null }> };
  documentRequests: { total: number; limit: number; items: Array<{ id: string; type: string; status: string; copies: number; purpose: string | null; deliveryMethod: string; createdAt: string; completedAt: string | null; issueNo: string | null }> };
  amendments?: { total: number; limit: number; preservedSince: string; items: AmendmentRow[] };
}
type Who = { id: string; name: string | null } | null;
export interface AmendmentRow {
  source: 'SIGNED_VERSION' | 'UNPRESERVED' | 'NURSING_ADDENDUM' | 'LAB_RESULT_AMENDMENT';
  recordType: string; recordId: string; at: string | null; by: Who;
  versionId?: string; priorSignedAt?: string | null; priorSignedBy?: Who; changedFields?: string[];
  resignPending?: boolean; addendumId?: string; reason?: string; previousStatus?: string;
}
interface VersionDetail {
  versionId: string; recordType: string; recordId: string; priorSignedAt: string | null; supersededAt: string;
  changedFields: string[]; prior: Record<string, unknown>; current: Record<string, unknown> | null; currentStatus: string | null; laterVersions: number;
}
interface AccessRow { id: string; action: string; resourceType: string | null; timestamp: string; ipAddress?: string | null; user: { id: string; familyName: string | null; givenName: string | null; role: string } | null }
interface AccessPage { total: number; limit: number; offset: number; networkVisible: boolean; items: AccessRow[] }

const ACTION_LABEL: Record<string, string> = { READ: '열람', CREATE: '작성', UPDATE: '수정', DELETE: '삭제', EXPORT: '반출', PRINT: '출력' };
const PAGE = 50;

const unwrap = <X,>(r: unknown): X => ((r as { data?: X })?.data ?? (r as X));

/** 미비 항목 → 그 기록으로 가는 길(있을 때만 — 지어내지 않는다) */
function deficiencyHref(patientId: string, d: Deficiency): string | null {
  if (d.type === 'UNSIGNED_ENCOUNTER' || d.type === 'MISSING_DIAGNOSIS') return `/patients/${patientId}/encounter/new?encounterId=${d.refId}`;
  if (d.type === 'DISCHARGE_SUMMARY') return `/inpatient/${d.refId}/discharge-summary`;
  return null;
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-bold text-slate-900"><T k={title} /></h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Truncated({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <p className="pt-1 text-[11px] text-gray-400" data-truncated><Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: total, 표시: shown }} /></p>;
}

export function MedicalRecordTab({ patientId }: { patientId: string }) {
  // 서버 @Roles 와 같다 — 밖이면 부르지 않는다(403 을 그리지 않는다)
  const allowed = useHasRole('ADMIN', 'DOCTOR', 'NURSE', 'MEDICAL_RECORDS');
  const bundleQ = useQuery({
    queryKey: ['patient-medical-record', patientId],
    queryFn: async () => unwrap<RecordBundle>(await apiClient.get(`/api/v1/patients/${patientId}/medical-record`)),
    enabled: allowed && !!patientId,
  });

  if (!allowed) {
    return (
      <p className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500" data-mr-gated>
        <T k="의무기록 관리 정보는 관리자·의사·간호사·의무기록사 화면입니다 — 비어 있다는 뜻이 아닙니다." />
      </p>
    );
  }

  return (
    <div className="space-y-4" data-medical-record-tab>
      {bundleQ.isError ? <QueryErrorFallback error={bundleQ.error} onRetry={() => bundleQ.refetch()} size="compact" />
        : !bundleQ.data ? <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />
        : <BundleView patientId={patientId} b={bundleQ.data} />}
      <AccessHistory patientId={patientId} />
    </div>
  );
}

function BundleView({ patientId, b }: { patientId: string; b: RecordBundle }) {
  const d = b.deficiencies;
  return (
    <>
      <Section title="기록 완결(미비 기록)" right={
        <span className="text-[11px] text-gray-500">
          <Tf k="최근 {일}일 · 기한 진료기록 {진료}일 · 간호기록 {간호}일 · 퇴원요약 {요약}일" params={{ 일: d.policy.lookbackDays, 진료: d.policy.encounterDueDays, 간호: d.policy.noteDueDays, 요약: d.policy.summaryDueDays }} />
        </span>
      }>
        {d.items.length === 0 ? (
          <p className="text-xs text-emerald-700" data-mr-deficiency-none><Tf k="이 기간 미비 기록 없음(최근 {일}일 기준)" params={{ 일: d.policy.lookbackDays }} /></p>
        ) : (
          <ul className="divide-y divide-gray-50 text-xs" data-mr-deficiencies={d.items.length}>
            {d.items.map((it) => {
              const href = deficiencyHref(patientId, it);
              const body = (
                <>
                  <span className="w-20 shrink-0 font-semibold text-slate-700"><T k={labelOf(HIM_DEFICIENCY_LABEL, it.type)} /></span>
                  <span className="min-w-0 flex-1 truncate text-gray-600"><T k={it.detail} /></span>
                  <span className="shrink-0 text-gray-500">{it.responsibleName}</span>
                  <KDate value={it.since} mode="monthDay" className="w-14 shrink-0 text-right text-gray-400" />
                  <span className={`w-20 shrink-0 text-right font-semibold ${it.overdueDays > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                    {it.overdueDays > 0 ? <Tf k="기한 {일}일 초과" params={{ 일: it.overdueDays }} /> : <T k="기한 안" />}
                  </span>
                </>
              );
              return (
                <li key={`${it.type}-${it.refId}`}>
                  {href ? <Link href={href} className="flex items-center gap-2 py-1.5 hover:bg-slate-50">{body}</Link>
                    : <div className="flex items-center gap-2 py-1.5">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="발급 문서" right={<span className="text-[11px] text-gray-500"><Tf k="전체 {수}건" params={{ 수: b.issuedDocuments.total }} /></span>}>
        {b.issuedDocuments.items.length === 0 ? <p className="text-xs text-gray-400"><T k="이 환자에게 발급된 문서 없음" /></p> : (
          <table className="w-full text-xs" data-mr-issued={b.issuedDocuments.items.length}>
            <thead><tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="py-1 font-medium"><T k="발급번호" /></th><th className="py-1 font-medium"><T k="문서" /></th>
              <th className="py-1 font-medium"><T k="구분" /></th><th className="py-1 font-medium"><T k="발급자" /></th><th className="py-1 text-right font-medium"><T k="발급일" /></th>
            </tr></thead>
            <tbody>
              {b.issuedDocuments.items.map((x) => (
                <tr key={x.issueNo} className={`border-b border-gray-50 ${x.status === 'VOID' ? 'text-gray-400 line-through' : ''}`}>
                  <td className="py-1 font-mono text-[11px]"><Link href={`/verify/document/${encodeURIComponent(x.issueNo)}`} className="text-blue-600 hover:underline">{x.issueNo}</Link></td>
                  <td className="py-1"><T k={labelOf(ISSUED_DOC_TYPE_LABEL, x.documentType)} /></td>
                  <td className="py-1"><T k={labelOf(ISSUED_DOC_STATUS_LABEL, x.status)} />{x.reissueOf ? <span className="ml-1 text-[10px] text-gray-400">← {x.reissueOf}</span> : null}</td>
                  {/* 발급자 이름을 모르면 기록 없음으로 — 지어내지 않는다 */}
                  <td className="py-1"><StaffName name={x.issuedBy?.name} /></td>
                  <td className="py-1 text-right"><KDate value={x.issuedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Truncated shown={b.issuedDocuments.items.length} total={b.issuedDocuments.total} />
      </Section>

      <Section title="발급 요청" right={<span className="text-[11px] text-gray-500"><Tf k="전체 {수}건" params={{ 수: b.documentRequests.total }} /></span>}>
        {b.documentRequests.items.length === 0 ? <p className="text-xs text-gray-400"><T k="이 환자의 서류 발급 요청 없음" /></p> : (
          <ul className="divide-y divide-gray-50 text-xs" data-mr-requests={b.documentRequests.items.length}>
            {b.documentRequests.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="font-semibold text-slate-700"><T k={labelOf(DOC_REQUEST_TYPE_LABEL, r.type)} /></span>
                <span className="text-gray-600"><T k={labelOf(DOC_ISSUANCE_STATUS_LABEL, r.status)} /></span>
                <span className="text-gray-400">{r.copies}<Unit>부</Unit> · <T k={labelOf(DELIVERY_METHOD_LABEL, r.deliveryMethod)} /></span>
                {r.purpose && <span className="truncate text-gray-500">{r.purpose}</span>}
                <span className="ml-auto text-gray-400"><T k="신청" /> <KDate value={r.createdAt} mode="monthDay" />{r.completedAt ? <> · <T k="완료" /> <KDate value={r.completedAt} mode="monthDay" /></> : null}</span>
              </li>
            ))}
          </ul>
        )}
        <Truncated shown={b.documentRequests.items.length} total={b.documentRequests.total} />
        <CopyRequestIntake patientId={patientId} />
        <p className="pt-1 text-[11px]">
          <Link href="/workstation/documents" className="text-blue-600 hover:underline"><T k="서류 발급 업무로" /></Link>
          <span className="mx-1 text-gray-300">·</span>
          <Link href={`/workstation/certificates?patientId=${patientId}`} className="text-blue-600 hover:underline" data-mr-cert-intake><T k="진단서·소견서 등 증명서 접수" /></Link>
        </p>
      </Section>

      {b.amendments && <AmendmentSection patientId={patientId} a={b.amendments} />}
    </>
  );
}

/**
 * 의무기록 사본 발급 신청 — 창구 접수(직원 접수 EP · 서버 역할 = 이 탭 역할).
 * 범위(기간·기록 종류)는 처리 단계(서류 발급 업무)에서 정한다 — 여기서 지어내지 않는다.
 * 🔴 신청인 신분·관계 확인은 창구의 대면 책임 — 시스템은 검증하지 않고 기록만 남긴다(그 사실을 그 자리에서 말한다).
 */
function CopyRequestIntake({ patientId }: { patientId: string }) {
  const tt = useTAttr();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState(1);
  const [purpose, setPurpose] = useState('');
  const [delivery, setDelivery] = useState('');
  const [relation, setRelation] = useState('');
  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/staff/document-requests', {
      patientId, type: 'MEDICAL_RECORD', copies, deliveryMethod: delivery,
      ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      ...(relation.trim() ? { requesterRelation: relation.trim() } : {}),
    }),
    onSuccess: () => {
      toast.success(tt('의무기록 사본 발급 신청을 접수했습니다 — 범위는 서류 발급 업무에서 정합니다'));
      setOpen(false); setPurpose(''); setRelation(''); setCopies(1); setDelivery('');
      qc.invalidateQueries({ queryKey: ['patient-medical-record', patientId] });
    },
    onError: (e) => toast.error(extractErrorMessage(e) || tt('접수하지 못했습니다')),
  });
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-mr-copy-intake-open
        className="mt-2 min-h-[36px] rounded-lg border border-gray-200 px-3 text-xs text-gray-700 hover:bg-gray-50">
        + <T k="의무기록 사본 발급 신청 접수" />
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" data-mr-copy-intake>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block"><span className="text-gray-500"><T k="부수" /></span>
          <input type="number" min={1} max={10} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5" data-mr-copy-copies />
        </label>
        <label className="block"><span className="text-gray-500"><T k="수령 방법" /></span>
          {/* 초기값은 미선택 — 고르지 않은 값을 저장하지 않는다 */}
          <select value={delivery} onChange={(e) => setDelivery(e.target.value)} className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5" data-mr-copy-delivery>
            <option value="">{tt('— 선택 —')}</option>
            {Object.entries(DELIVERY_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{tt(l)}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-gray-500"><T k="용도" /></span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5" />
        </label>
      </div>
      <label className="block"><span className="text-gray-500"><T k="신청인 관계(대리 신청 시)" /></span>
        <input value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={30} className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5" />
      </label>
      <p className="text-[11px] text-amber-700"><T k="신분·관계 확인은 창구의 대면 책임입니다 — 시스템은 검증하지 않고 기록만 남깁니다." /></p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-gray-700"><T k="취소" /></button>
        <button type="button" onClick={() => create.mutate()} disabled={!delivery || create.isPending} data-mr-copy-submit
          className="min-h-[44px] rounded-lg bg-slate-800 px-4 font-semibold text-white disabled:opacity-50"><T k="접수" /></button>
      </div>
    </div>
  );
}

/** 정정 이력 — 출처별 원장을 시각순으로(합치지 않고 출처를 밝힌다) */
function AmendmentSection({ patientId, a }: { patientId: string; a: NonNullable<RecordBundle['amendments']> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Section title="정정 이력" right={<span className="text-[11px] text-gray-500"><Tf k="전체 {수}건" params={{ 수: a.total }} /></span>}>
      <p className="mb-2 text-[11px] text-gray-500" data-mr-amend-since>
        <Tf k="진료기록·퇴원요약의 정정 전 서명본은 {날짜}부터 보존합니다 — 그 전 정정은 정정 전 내용이 남아 있지 않습니다." params={{ 날짜: a.preservedSince }} />
      </p>
      {a.items.length === 0 ? <p className="text-xs text-gray-400" data-mr-amend-none><T k="기록된 정정 없음" /></p> : (
        <ul className="divide-y divide-gray-50 text-xs" data-mr-amendments={a.items.length}>
          {a.items.map((r, i) => (
            <li key={`${r.source}-${r.versionId ?? r.addendumId ?? r.recordId}-${i}`} className="py-1.5" data-mr-amend-row={r.source}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-slate-700"><T k={labelOf(AMENDMENT_RECORD_TYPE_LABEL, r.recordType)} /></span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.source === 'UNPRESERVED' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                  <T k={labelOf(AMENDMENT_SOURCE_LABEL, r.source)} />
                </span>
                {r.resignPending && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200" data-mr-amend-resign><T k="재서명 대기" /></span>}
                {r.changedFields && r.changedFields.length > 0 && (
                  <span className="text-gray-600"><T k="바뀐 항목" />: {r.changedFields.map((f) => <span key={f} className="mr-1"><T k={labelOf(AMENDED_FIELD_LABEL, f)} /></span>)}</span>
                )}
                {r.reason && <span className="text-gray-600"><T k="사유" />: {r.reason}</span>}
                <span className="ml-auto text-gray-400">
                  {/* 미보존은 정정 시각을 모른다 — 마지막 변경 시각이라고 밝힌다 */}
                  {r.source === 'UNPRESERVED' ? <T k="마지막 변경" /> : <T k="정정" />} {r.at ? <KDate value={r.at} mode="datetime" /> : '-'}
                  {r.by && <> · <StaffName name={r.by.name} /></>}
                </span>
              </div>
              {r.source === 'SIGNED_VERSION' && r.versionId && (
                <div className="mt-0.5 text-[11px] text-gray-500">
                  <T k="이전 서명" /> {r.priorSignedAt ? <KDate value={r.priorSignedAt} mode="datetime" /> : <T k="시각 기록 없음" />}
                  {r.priorSignedBy && <> · <StaffName name={r.priorSignedBy.name} /></>}
                  <button type="button" onClick={() => setOpenId(openId === r.versionId ? null : r.versionId!)} aria-expanded={openId === r.versionId}
                    className="ml-2 text-blue-600 hover:underline" data-mr-amend-open={r.versionId}>
                    <T k={openId === r.versionId ? '접기' : '정정 전·후 보기'} />
                  </button>
                </div>
              )}
              {openId === r.versionId && r.versionId && <VersionCompare patientId={patientId} versionId={r.versionId} />}
            </li>
          ))}
        </ul>
      )}
      <Truncated shown={a.items.length} total={a.total} />
    </Section>
  );
}

const showValue = (v: unknown): string => {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === 'object' && 'code' in (x as Record<string, unknown>)
      ? `${(x as Record<string, unknown>).code ?? ''} ${(x as Record<string, unknown>).name ?? ''}${(x as Record<string, unknown>).type ? ` (${(x as Record<string, unknown>).type})` : ''}`.trim()
      : JSON.stringify(x))).join('\n');
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/** 정정 전(보존본) ↔ 지금 — 바뀐 항목만 나란히 */
function VersionCompare({ patientId, versionId }: { patientId: string; versionId: string }) {
  const q = useQuery({
    queryKey: ['patient-medical-record-version', patientId, versionId],
    queryFn: async () => unwrap<VersionDetail>(await apiClient.get(`/api/v1/patients/${patientId}/medical-record/versions/${versionId}`)),
  });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />;
  if (!q.data) return <div className="mt-1 h-16 animate-pulse rounded-lg bg-gray-100" />;
  const v = q.data;
  const fields = v.changedFields.length ? v.changedFields : Object.keys(v.prior);
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" data-mr-version={v.versionId}>
      {v.laterVersions > 0 && (
        <p className="text-[11px] text-amber-700" data-mr-version-later><Tf k="이 뒤에 {수}번 더 정정됐습니다 — ‘지금’은 그 사이 판을 건너뛴 현재 내용입니다." params={{ 수: v.laterVersions }} /></p>
      )}
      {v.current == null && <p className="text-[11px] text-amber-700"><T k="원 기록을 찾을 수 없어 지금 내용과 비교할 수 없습니다." /></p>}
      {fields.map((f) => (
        <div key={f} className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2" data-mr-version-field={f}>
          <div>
            <p className="mb-0.5 text-[10px] font-semibold text-gray-500"><T k={labelOf(AMENDED_FIELD_LABEL, f)} /> · <T k="정정 전(서명본)" /></p>
            <pre className="whitespace-pre-wrap rounded-lg bg-white p-2 font-sans text-gray-800 ring-1 ring-gray-200">{showValue(v.prior[f]) || '—'}</pre>
          </div>
          <div>
            <p className="mb-0.5 text-[10px] font-semibold text-gray-500"><T k={labelOf(AMENDED_FIELD_LABEL, f)} /> · <T k="지금" />{v.currentStatus === 'AMENDED' ? <> (<T k="재서명 대기" />)</> : null}</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-white p-2 font-sans text-gray-800 ring-1 ring-gray-200">{v.current ? showValue(v.current[f]) || '—' : '—'}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccessHistory({ patientId }: { patientId: string }) {
  const [pages, setPages] = useState(1);
  // 서버 @Roles(의사·간호사·관리자·의무기록사)와 같은 게이트 — 부모가 이미 막지만 호출 자리에서도 밝힌다
  const allowed = useHasRole('ADMIN', 'DOCTOR', 'NURSE', 'MEDICAL_RECORDS');
  const q = useQuery({
    queryKey: ['patient-access-history', patientId, pages],
    queryFn: async () => unwrap<AccessPage>(await apiClient.get(`/api/v1/patients/${patientId}/access-history?limit=${PAGE * pages}&offset=0`)),
    enabled: allowed,
  });
  const d = q.data;
  // 사람별 묶음 — "누가 몇 번" 이 먼저 읽혀야 한다(시간순 목록은 그 아래)
  const byUser = new Map<string, { name: string; role: string; n: number; last: string }>();
  for (const r of d?.items ?? []) {
    const k = r.user?.id ?? '-';
    const cur = byUser.get(k);
    const name = r.user ? `${r.user.familyName ?? ''}${r.user.givenName ?? ''}` : '';
    if (cur) cur.n += 1; else byUser.set(k, { name, role: r.user?.role ?? '', n: 1, last: r.timestamp });
  }
  return (
    <Section title="열람·기록 이력" right={
      <span className="text-[11px] text-gray-500">
        {d ? <Tf k="전체 {수}건 · 감사 원장 기준(이 화면을 연 것도 기록됩니다)" params={{ 수: d.total }} /> : null}
      </span>
    }>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : !d ? <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
        : d.items.length === 0 ? <p className="text-xs text-gray-400"><T k="기록된 열람·변경 없음" /></p>
        : (
          <div className="space-y-2 text-xs" data-mr-access={d.items.length}>
            <div className="flex flex-wrap gap-1.5" data-mr-access-users={byUser.size}>
              {[...byUser.values()].sort((a, b) => b.n - a.n).map((u, i) => (
                <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                  <StaffName name={u.name} /> <span className="text-slate-400">{u.role}</span> <b className="tabular-nums">{u.n}</b>
                </span>
              ))}
              {d.items.length < d.total && <span className="text-[11px] text-gray-400"><Tf k="(최근 {표시}건 기준)" params={{ 표시: d.items.length }} /></span>}
            </div>
            <ul className="max-h-80 divide-y divide-gray-50 overflow-y-auto">
              {d.items.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-1">
                  <KDate value={r.timestamp} mode="datetime" className="w-32 shrink-0 tabular-nums text-gray-500" />
                  <span className="w-10 shrink-0 font-semibold text-slate-700"><T k={labelOf(ACTION_LABEL, r.action)} /></span>
                  <span className="w-28 shrink-0 truncate font-mono text-[11px] text-gray-500">{r.resourceType ?? '-'}</span>
                  <span className="min-w-0 flex-1 truncate"><StaffName name={r.user ? `${r.user.familyName ?? ''}${r.user.givenName ?? ''}` : null} role={r.user?.role} /></span>
                  {/* IP 는 관리자에게만 서버가 싣는다 */}
                  {d.networkVisible && <span className="shrink-0 font-mono text-[10px] text-gray-400">{r.ipAddress ?? '-'}</span>}
                </li>
              ))}
            </ul>
            <Truncated shown={d.items.length} total={d.total} />
            {d.items.length < d.total && (
              <button type="button" onClick={() => setPages((p) => p + 1)} className="min-h-[36px] rounded-lg border border-gray-200 px-3 text-xs hover:bg-gray-50" data-mr-access-more>
                <Tf k="{수}건 더 보기" params={{ 수: Math.min(PAGE, d.total - d.items.length) }} />
              </button>
            )}
          </div>
        )}
    </Section>
  );
}
