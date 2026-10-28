'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { QrImage } from '@/components/ui/QrImage';
import Link from 'next/link';
import { KDate, PatientName } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { auditNewWindowPrint } from '@/components/print/PrintGuard';
import { extractErrorMessage } from '@/lib/error-utils';
import { useHasRole } from '@/hooks/use-admin-write';
import { pollMs } from '@/lib/ui-settings';

/**
 * 초진 등록 동의 수집(2026-10-02) — 태블릿 · 환자 휴대폰(전자동의) · 종이(출력 → 스캔 등록).
 *
 * 🔴 종전 초진 등록은 직원 체크박스였고 서버가 그것을 "환자 이름으로 서명됨"으로 기록했다. 태블릿·서명 링크·첨부 업로드는
 *    수술·시술 동의서에만 이어져 있었다. 여기서는 **환자가 직접** 항목별로 고르고 서명한 것만 서명으로 남는다.
 *  - 종이: 스캔본을 먼저 등록해야 옮겨 적기를 저장할 수 있다(증빙 없는 "종이로 받음"을 만들지 않는다)
 *  - 현황의 방식은 원장 그대로 — 직원 입력(HIS)은 "서명 증빙 없음"이라고 말한다
 */
interface ConsentRow {
  type: string; label: string; required: boolean; law: string;
  agreed: boolean; signedAt: string | null; signedBy: string | null; signMethod: string | null;
  evidenceConsentFormId: string | null; expired: boolean; consentId: string | null;
}
export type UnappliedAction = 'APPLY' | 'RECOLLECT';
export type UnappliedReason = 'NO_CHOICES' | 'NEWER_RECORDS' | null;
export interface UnappliedSigned { consentId: string; signedAt: string; signMode: string | null; action: UnappliedAction; reason: UnappliedReason }
export interface Status {
  consents: ConsentRow[]; requiredComplete: boolean; requiredStaffEntered?: number;
  openPackage: { id: string; createdAt: string; scans: number } | null;
  /** 서명은 됐는데 원장 10종에 없는 묶음(서명 저장 뒤 원장 기록 실패) — 없으면 null */
  unappliedSigned?: UnappliedSigned | null;
}

/** 다시 받아야 하는 이유 — 서버 어휘(UnappliedReason)와 1:1 */
export const RECOLLECT_REASON: Record<Exclude<UnappliedReason, null>, string> = {
  NO_CHOICES: '서명본에 항목별 선택이 남아 있지 않습니다(이전 방식 서명) — 무엇에 동의했는지 알 수 없어 다시 받아야 합니다.',
  NEWER_RECORDS: '서명 뒤에 바뀐 동의 기록(새 기록·철회)이 있어 서명본으로 덮지 않습니다 — 다시 받아주세요.',
};

/** 수집 현황 조회 — 수집 패널과 접수 화면 배지가 **같은 캐시**를 읽는다(한쪽에서 받으면 다른 쪽도 바뀐다) */
export function useRegistrationConsentStatus(patientId: string, refetchInterval: number | false = false) {
  return useQuery({
    queryKey: ['registration-consent-collect', patientId],
    queryFn: async () => unwrap<Status>(await apiClient.get(`/api/v1/patients/${patientId}/registration-consents/collect`)),
    enabled: !!patientId,
    refetchInterval,
  });
}

/**
 * 필수 동의 배지 — 🔴 직원 입력(HIS)만으로 채운 필수 동의를 서명 증빙과 같은 초록으로 그리지 않는다(2026-10-03).
 *    종전 접수 화면은 체크박스 두 개를 "환자 동의"로 세어 '필수 완료'를 그릴 수 있었다.
 */
export function RequiredConsentBadge({ status }: { status: Status }) {
  const staff = status.requiredStaffEntered ?? 0;
  if (!status.requiredComplete) {
    return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200" data-rc-required="incomplete"><T k="필수 동의 미완료" /></span>;
  }
  if (staff > 0) {
    return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300" data-rc-required="staff-entered"><Tf k="필수 동의 — 직원 입력 {수}건(서명 증빙 없음)" params={{ 수: staff }} /></span>;
  }
  return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200" data-rc-required="complete"><T k="필수 동의 완료" /></span>;
}
interface Device { id: string; name: string; location: string | null; status: string; online: boolean }

const METHOD_LABEL: Record<string, string> = {
  TABLET: '태블릿 서명', MOBILE: '휴대폰 서명', PAPER: '종이(스캔 첨부)', PORTAL: '포털 서명', HIS: '직원 입력(서명 증빙 없음)',
};

const unwrap = <X,>(r: unknown): X => ((r as { data?: X })?.data ?? (r as X));

type Method = 'tablet' | 'mobile' | 'paper';

export function RegistrationConsentCollector({ patientId, compact = false }: { patientId: string; compact?: boolean }) {
  const tt = useTAttr();
  const qc = useQueryClient();
  const base = `/api/v1/patients/${patientId}/registration-consents/collect`;
  const [method, setMethod] = useState<Method>('tablet');
  const [waiting, setWaiting] = useState(false); // 태블릿·휴대폰으로 보낸 뒤 서명을 기다리는 중
  // 서명을 기다리는 동안만 자주 다시 읽는다(서명이 들어오면 원장이 바뀐다)
  const statusQ = useRegistrationConsentStatus(patientId, waiting ? 3000 : false);
  const st = statusQ.data;
  const signedViaPatient = (st?.consents ?? []).some((c) => c.signMethod === 'TABLET' || c.signMethod === 'MOBILE');
  // 기다리던 서명이 들어오면 멈춘다
  const prevSigned = useRef(signedViaPatient);
  useEffect(() => {
    if (waiting && signedViaPatient && !prevSigned.current) { setWaiting(false); toast.success(tt('환자 서명이 들어왔습니다')); }
    prevSigned.current = signedViaPatient;
  }, [signedViaPatient, waiting, tt]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['registration-consent-collect', patientId] });
  // 🔴 서명은 들어왔는데 원장 기록이 실패하면 원장이 바뀌지 않아 '기다리는 중'이 끝나지 않았다 — 서명본이 보이면 멈춘다
  const unapplied = st?.unappliedSigned ?? null;
  useEffect(() => { if (waiting && unapplied) setWaiting(false); }, [waiting, unapplied]);

  if (statusQ.isError) return <QueryErrorFallback error={statusQ.error} onRetry={() => statusQ.refetch()} size="compact" />;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-registration-consent-collector>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-900"><T k="초진 동의서 받기" /></h3>
        {st && <RequiredConsentBadge status={st} />}
        {waiting && <span className="text-[11px] text-indigo-600" data-rc-waiting><T k="환자 서명을 기다리는 중…" /></span>}
      </div>

      {unapplied && <UnappliedSignedNotice base={base} item={unapplied} onDone={refresh} />}

      {/* 수집 방법 */}
      <div className="mb-3 grid grid-cols-3 gap-2" role="tablist">
        {([['tablet', '태블릿'], ['mobile', '환자 휴대폰(전자동의)'], ['paper', '종이 출력·스캔 등록']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={method === k} onClick={() => setMethod(k)} data-rc-method={k}
            className={`min-h-[44px] rounded-xl border-2 px-2 text-xs font-semibold ${method === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <T k={l} />
          </button>
        ))}
      </div>

      {method === 'tablet' && <TabletPanel base={base} onSent={() => { setWaiting(true); refresh(); }} />}
      {method === 'mobile' && <MobilePanel base={base} onIssued={() => { setWaiting(true); refresh(); }} />}
      {method === 'paper' && <PaperPanel patientId={patientId} base={base} status={st} onDone={() => { setWaiting(false); refresh(); }} />}

      {/* 현황 — 원장 10종 */}
      {!compact && st && (
        <table className="mt-4 w-full text-xs" data-rc-status>
          <thead><tr className="border-b border-gray-100 text-left text-gray-500">
            <th className="py-1 font-medium"><T k="동의 항목" /></th><th className="py-1 font-medium"><T k="상태" /></th>
            <th className="py-1 font-medium"><T k="방식" /></th><th className="py-1 font-medium"><T k="서명자" /></th><th className="py-1 text-right font-medium"><T k="일시" /></th>
          </tr></thead>
          <tbody>
            {st.consents.map((c) => (
              <tr key={c.type} className="border-b border-gray-50" data-rc-row={c.type}>
                <td className="py-1"><T k={c.label} />{c.required && <span className="ml-1 text-[10px] font-bold text-red-600"><T k="필수" /></span>}</td>
                <td className="py-1">
                  {c.signMethod == null ? <span className="text-gray-400"><T k="미수집" /></span>
                    : c.expired ? <span className="text-amber-700"><T k="만료" /></span>
                    : c.agreed ? <span className="font-semibold text-emerald-700"><T k="동의" /></span>
                    : <span className="font-semibold text-rose-600"><T k="미동의" /></span>}
                </td>
                <td className={`py-1 ${c.signMethod === 'HIS' ? 'text-amber-700' : 'text-gray-600'}`}>{c.signMethod ? <T k={METHOD_LABEL[c.signMethod] ?? c.signMethod} /> : '-'}</td>
                <td className="py-1 text-gray-600">{c.signedBy ?? '-'}</td>
                <td className="py-1 text-right text-gray-500">{c.signedAt ? <KDate value={c.signedAt} mode="datetime" /> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TabletPanel({ base, onSent }: { base: string; onSent: () => void }) {
  const tt = useTAttr();
  const devQ = useQuery({ queryKey: ['registration-consent-devices'], queryFn: async () => unwrap<Device[]>(await apiClient.get(`${base}/devices`)) });
  const [deviceId, setDeviceId] = useState('');
  const send = useMutation({
    mutationFn: () => apiClient.post(`${base}/tablet`, { deviceId }),
    onSuccess: () => { toast.success(tt('태블릿으로 보냈습니다 — 환자가 항목별로 고르고 서명합니다')); onSent(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tt('보내지 못했습니다')),
  });
  if (devQ.isError) return <QueryErrorFallback error={devQ.error} onRetry={() => devQ.refetch()} size="compact" />;
  const devices = devQ.data ?? [];
  return (
    <div className="space-y-2 text-xs" data-rc-panel="tablet">
      {devQ.isLoading ? <p className="text-gray-400">…</p>
        : devices.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800" data-rc-no-device>
            <T k="승인된 서명 태블릿이 없습니다 — 태블릿을 등록·승인하거나(동의서 워크스테이션) 환자 휴대폰·종이로 받으세요." />
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-2" aria-label={tt('서명 태블릿')}>
              <option value=""><T k="태블릿 선택" /></option>
              {devices.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.online}>
                  {d.name}{d.location ? ` · ${d.location}` : ''} — {tt(d.online ? (d.status === 'DISPATCHED' ? '서명 중' : '대기') : '오프라인')}
                </option>
              ))}
            </select>
            <button type="button" disabled={!deviceId || send.isPending} onClick={() => send.mutate()} data-rc-send-tablet
              className="min-h-[44px] rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-40"><T k="태블릿으로 보내기" /></button>
          </div>
        )}
      <p className="text-[11px] text-gray-400"><T k="서명 세션은 5분 동안 유효합니다. 환자가 서명하면 아래 현황이 바뀝니다." /></p>
    </div>
  );
}

function MobilePanel({ base, onIssued }: { base: string; onIssued: () => void }) {
  const tt = useTAttr();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const issue = useMutation({
    mutationFn: async () => unwrap<{ path: string; expiresAt: string }>(await apiClient.post(`${base}/mobile-link`, {})),
    // URL 은 이 화면의 오리진으로 만든다(서버가 호스트를 지어내지 않는다)
    onSuccess: (r) => { setLink({ url: `${window.location.origin}${r.path}`, expiresAt: r.expiresAt }); onIssued(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tt('링크를 만들지 못했습니다')),
  });
  return (
    <div className="space-y-2 text-xs" data-rc-panel="mobile">
      {!link ? (
        <button type="button" disabled={issue.isPending} onClick={() => issue.mutate()} data-rc-issue-link
          className="min-h-[44px] rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-40"><T k="서명 QR 만들기" /></button>
      ) : (
        <div className="flex flex-wrap items-center gap-4" data-rc-link>
          <QrImage value={link.url} size={168} alt={tt('환자 휴대폰 서명 QR')} />
          <div className="space-y-1">
            <p className="text-gray-700"><T k="환자 휴대폰 카메라로 QR 을 찍게 하세요 — 항목별로 고르고 서명합니다." /></p>
            <p className="text-gray-500"><T k="일회용 · 만료" /> <KDate value={link.expiresAt} mode="time" /></p>
            <button type="button" onClick={() => issue.mutate()} className="min-h-[36px] rounded-lg border border-gray-200 px-3 hover:bg-gray-50"><T k="새 QR 만들기" /></button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-gray-400"><T k="링크는 15분 동안 한 번만 쓸 수 있습니다. 문자·외부 메신저로 보내지 않습니다." /></p>
    </div>
  );
}

function PaperPanel({ patientId, base, status, onDone }: { patientId: string; base: string; status?: Status; onDone: () => void }) {
  const tt = useTAttr();
  const qc = useQueryClient();
  const items = status?.consents ?? [];
  const scans = status?.openPackage?.scans ?? 0;
  const [choices, setChoices] = useState<Record<string, boolean | undefined>>({});
  const [signedBy, setSignedBy] = useState('');
  const [printing, setPrinting] = useState(false);

  const print = async () => {
    setPrinting(true);
    try {
      // 🔴 종전 버튼은 `/api/v1/patients/new/...` 를 인증 없이 새 창으로 열었다(환자 ID 자리에 'new' · 401) — 인증해서 받아 연다
      const token = apiClient.getToken();
      const res = await fetch(`/api/v1/patients/${patientId}/registration-consents/print`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const html = await res.text();
      auditNewWindowPrint('registration-consent');
      const w = window.open('', '_blank');
      if (!w) { toast.error(tt('팝업이 막혀 출력 창을 열 수 없습니다')); return; }
      w.document.open(); w.document.write(html); w.document.close();
      w.focus(); w.print();
    } catch {
      toast.error(tt('동의서 출력본을 받지 못했습니다'));
    } finally { setPrinting(false); }
  };

  const upload = useMutation({
    mutationFn: async (file: File) => { const fd = new FormData(); fd.append('file', file); return apiClient.postForm(`${base}/paper-scan`, fd); },
    onSuccess: () => { toast.success(tt('스캔본을 등록했습니다')); qc.invalidateQueries({ queryKey: ['registration-consent-collect', patientId] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tt('스캔본을 등록하지 못했습니다')),
  });
  const save = useMutation({
    mutationFn: () => apiClient.post(`${base}/paper`, { choices, signedBy: signedBy.trim() }),
    onSuccess: () => { toast.success(tt('종이 동의서를 기록했습니다')); setChoices({}); onDone(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tt('기록하지 못했습니다')),
  });
  const allChosen = items.length > 0 && items.every((c) => typeof choices[c.type] === 'boolean');

  return (
    <div className="space-y-3 text-xs" data-rc-panel="paper">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-gray-700">①</span>
        <button type="button" onClick={print} disabled={printing} data-rc-print className="min-h-[44px] rounded-lg border border-gray-200 px-3 font-medium hover:bg-gray-50 disabled:opacity-40"><T k="동의서 출력" /></button>
        <span className="font-semibold text-gray-700">②</span>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-gray-200 px-3 font-medium hover:bg-gray-50">
          <T k="서명된 종이 스캔본 등록" />
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" data-rc-scan-input
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
        </label>
        <span className={scans > 0 ? 'text-emerald-700' : 'text-gray-400'} data-rc-scans={scans}><Tf k="등록된 스캔본 {수}건" params={{ 수: scans }} /></span>
      </div>

      <div className={scans === 0 ? 'pointer-events-none opacity-50' : ''} aria-disabled={scans === 0}>
        <p className="mb-1 font-semibold text-gray-700">③ <T k="종이에 표시된 대로 옮겨 적기" /></p>
        <div className="grid gap-1 sm:grid-cols-2">
          {items.map((c) => (
            <div key={c.type} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2 py-1" data-rc-choice={c.type}>
              <span className="truncate"><T k={c.label} />{c.required && <span className="ml-1 text-[10px] font-bold text-red-600"><T k="필수" /></span>}</span>
              <span className="flex shrink-0 gap-1">
                {([[true, '동의함'], [false, '동의하지 않음']] as const).map(([v, l]) => (
                  <button key={String(v)} type="button" onClick={() => setChoices((p) => ({ ...p, [c.type]: v }))}
                    className={`min-h-[32px] rounded px-2 ${choices[c.type] === v ? (v ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white') : 'bg-gray-100 text-gray-600'}`}><T k={l} /></button>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder={tt('종이에 서명한 사람 이름')} className="min-h-[44px] rounded-lg border border-gray-200 px-3" />
          <button type="button" disabled={scans === 0 || !allChosen || !signedBy.trim() || save.isPending} onClick={() => save.mutate()} data-rc-save-paper
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-40"><T k="종이 동의서 기록" /></button>
        </div>
        {scans === 0 && <p className="mt-1 text-[11px] text-amber-700"><T k="스캔본을 먼저 등록해야 기록할 수 있습니다 — 증빙 없이 기록하지 않습니다." /></p>}
      </div>
    </div>
  );
}

/**
 * 서명됐지만 원장에 없는 묶음(2026-10-03) — 서명 저장 뒤 원장 기록이 실패한 경우.
 * 서명본에 환자의 선택이 남아 있으면 그대로 옮겨 적는다(직원이 고르지 않는다). 아니면 다시 받는다(아래 방법으로).
 */
function UnappliedSignedNotice({ base, item, onDone }: { base: string; item: UnappliedSigned; onDone: () => void }) {
  const tt = useTAttr();
  const apply = useMutation({
    mutationFn: () => apiClient.post(`${base}/apply-signed`, { consentId: item.consentId }),
    onSuccess: () => { toast.success(tt('서명본대로 원장에 기록했습니다')); onDone(); },
    onError: (e) => { toast.error(extractErrorMessage(e) || tt('원장 기록에 실패했습니다')); onDone(); },
  });
  return (
    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-rc-unapplied={item.action}>
      <p className="font-semibold">
        <T k="환자 서명은 저장됐지만 항목별 동의가 원장에 기록되지 않았습니다." /> (<KDate value={item.signedAt} mode="datetime" /> · {item.signMode ? <T k={METHOD_LABEL[item.signMode] ?? item.signMode} /> : '-'})
      </p>
      {item.action === 'APPLY' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-rose-800"><T k="서명본에 환자가 고른 항목이 남아 있습니다 — 그대로 옮겨 적습니다(서명 시각 그대로)." /></span>
          <button type="button" onClick={() => apply.mutate()} disabled={apply.isPending} data-rc-apply-signed
            className="min-h-[44px] rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            <T k="서명본대로 원장에 기록" />
          </button>
        </div>
      ) : (
        <p className="mt-1 text-rose-800" data-rc-recollect-reason={item.reason ?? ''}><T k={item.reason ? RECOLLECT_REASON[item.reason] : '다시 받아주세요.'} /></p>
      )}
    </div>
  );
}

interface UnappliedListItem extends UnappliedSigned { patientId: string; patient: { familyName: string | null; givenName: string | null; mrn: string | null } }

/**
 * 재수집 목록(병원 전체) — 접수 워크스테이션. 줄어드는 목록이 정본이다(사라지는 알림이 아니라).
 * 0건이면 그리지 않는다(희소 축의 0 을 경보하지 않는다) · 조회 실패는 실패로.
 */
export function UnappliedSignaturesCard() {
  // 서버 COLLECT_ROLES(ADMIN·NURSE·RECEPTIONIST·DOCTOR)와 같다 — 권한 밖은 부르지 않는다(403 을 실패로 상시 띄우지 않게)
  const allowed = useHasRole('NURSE', 'RECEPTIONIST', 'DOCTOR');
  const q = useQuery({
    enabled: allowed,
    queryKey: ['registration-consent-unapplied'],
    queryFn: async () => unwrap<{ items: UnappliedListItem[]; total: number; limit: number }>(await apiClient.get('/api/v1/registration-consents/unapplied-signatures')),
    refetchInterval: pollMs('slow'),
  });
  if (!allowed) return null;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />;
  const d = q.data;
  if (!d || d.total === 0) return null;
  return (
    <section className="flex-shrink-0 rounded-2xl border border-rose-200 bg-rose-50/60 p-4" data-rc-unapplied-list={d.total}>
      <h2 className="text-sm font-bold text-rose-900"><Tf k="초진 동의 — 서명은 됐는데 원장에 없는 환자 {수}명" params={{ 수: d.total }} /></h2>
      <p className="mt-0.5 text-[11px] text-rose-800"><T k="서명 저장 뒤 항목별 동의 기록이 실패했습니다. 환자 동의서 탭에서 서명본대로 기록하거나 다시 받으세요." /></p>
      <ul className="mt-2 max-h-40 divide-y divide-rose-100 overflow-y-auto">
        {d.items.map((it) => (
          <li key={it.consentId} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs" data-rc-unapplied-row={it.action}>
            <span className="text-gray-800"><PatientName familyName={it.patient.familyName} givenName={it.patient.givenName} mrn={it.patient.mrn} /></span>
            <span className="flex items-center gap-2 text-gray-500">
              <KDate value={it.signedAt} mode="datetime" />
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${it.action === 'APPLY' ? 'bg-white text-rose-700 ring-1 ring-rose-200' : 'bg-amber-100 text-amber-800'}`}>
                <T k={it.action === 'APPLY' ? '서명본대로 기록 가능' : '다시 받아야 함'} />
              </span>
              <Link href={`/patients/${it.patientId}?tab=consent`} className="font-medium text-blue-600 hover:underline"><T k="동의서 탭" /></Link>
            </span>
          </li>
        ))}
      </ul>
      {d.total > d.items.length && <p className="mt-1 text-[10px] text-rose-700"><Tf k="{전체}명 중 {수}명 표시" params={{ 전체: d.total, 수: d.items.length }} /></p>}
    </section>
  );
}
