'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Program { id: string; code: string; name: string; category: string; price: number; isActive: boolean }
interface IssueResult {
  batchId: string; quantity: number; faceValue: number; merkleRoot: string; anchorId: string;
  activationCodes?: { serial: string; activationCode: string }[]; idempotent?: boolean; partial?: boolean; issued?: number;
  /**
   * 🔴 (2026-09-16 J4) 서버는 문장이 아니라 값을 준다 — 부분 발행을 "전량 발행"이라 말하던 자리다.
   *    `issued` 는 **실제 발행된 장수**이고 `quantity` 는 요청 수량이다(둘은 다를 수 있다).
   */
  issueState?: { code: 'PARTIAL' | 'RESUMED' | 'COMPLETE'; requested: number; issued: number; createdNow: number; codesNotReissued: number; codesWithheldBulk: boolean };
}
interface VerifyResult { serial: string; valid: boolean; reason?: string; status?: string; balance?: number; faceValue?: number; expiresAt?: string; anchored?: boolean; merkleRoot?: string | null }
// brokenAt 은 이벤트 UUID 다(서버 ledger) — number 로 선언해 `손상@e91dd1a2…` 로 렌더되던 것 정정
interface ChainResult { serial: string; valid: boolean; events?: number; brokenAt?: string }
interface Dealer { id: string; name: string; currency: string; status: string }
interface SendResult { quantity: number; emailedTo: string; channel: string; delivered?: boolean; pendingConfirmation?: boolean; idempotent?: boolean }

/**
 * 🔴 발송 결과 표기 — 배달 여부는 서버가 판정해 `delivered` 로 준다(정본 `isVoucherEmailDelivered`).
 * 종전엔 화면이 `channel === 'RESEND'` 를 스스로 판정하고, 그 밖은 전부 "시뮬레이션 기록"이라 부르며
 * **✅ 로 렌더했다** — 차단·실패로 딜러가 활성화코드를 못 받은 경우까지 성공으로 보였다.
 */
function sendTone(r: SendResult): { icon: string; box: string; label: string; note: string } {
  if (r.delivered) return { icon: '✅', box: 'text-violet-700 bg-violet-50 border-violet-100', label: '발송 완료', note: 'Resend 발송' };
  if (r.channel === 'SIMULATION') return { icon: '🧪', box: 'text-amber-800 bg-amber-50 border-amber-200', label: '모의 기록', note: '실제 메일은 나가지 않았습니다(email.provider 미설정)' };
  if (r.channel === 'BLOCKED') return { icon: '⛔', box: 'text-red-700 bg-red-50 border-red-200', label: '발송 차단', note: '목적지 검증에 걸려 나가지 않았습니다 — 재발송이 필요합니다' };
  return { icon: '⛔', box: 'text-red-700 bg-red-50 border-red-200', label: '발송 실패', note: '메일이 나가지 않았습니다 — 딜러는 활성화코드를 받지 못했습니다. 재발송이 필요합니다' };
}

const won = (n: number) => (n ?? 0).toLocaleString();

// 공개 검증 사유 한글화 — 구매자·딜러가 직접 보는 화면이라 영문 코드를 그대로 두지 않는다
const VERIFY_REASON: Record<string, string> = {
  INVALID_FORMAT: '검진권 번호 형식이 아닙니다',
  NOT_FOUND: '발행되지 않은 번호입니다',
  EXPIRED: '유효기간이 지났습니다',
  NO_BALANCE: '잔액이 없습니다(사용 완료)',
  'INVALID_STATE:REDEEMED': '이미 사용된 검진권입니다',
  'INVALID_STATE:REFUNDED': '환불 완료된 검진권입니다',
  'INVALID_STATE:REVOKED': '회수된 검진권입니다',
  'INVALID_STATE:EXPIRED': '만료 처리된 검진권입니다',
  'INVALID_STATE:ISSUED': '아직 활성화되지 않았습니다',
  'INVALID_STATE:ALLOCATED': '딜러 배정 상태로, 아직 판매·활성화 전입니다',
};

export default function VoucherIssuePage() {
  const tAttr = useTAttr();
  // 발행 폼
  const [form, setForm] = useState<'PROGRAM' | 'AMOUNT'>('PROGRAM');
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState('');
  const [faceValue, setFaceValue] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(10);
  const [supplyPrice, setSupplyPrice] = useState<number>(0);
  const [idemKey, setIdemKey] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);

  // 조회
  const [serial, setSerial] = useState('');
  const [looking, setLooking] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [chain, setChain] = useState<ChainResult | null>(null);

  // 딜러 발송(채널분리)
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [sendDealerId, setSendDealerId] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const newKey = () => setIdemKey(`batch-${crypto.randomUUID()}`);

  useEffect(() => {
    newKey();
    apiClient.get<{ data: Dealer[] }>('/api/v1/voucher/distributors?status=ACTIVE')
      .then((r) => setDealers((r.data ?? []).filter((d) => d.status === 'ACTIVE')))
      .catch(() => { /* 딜러 없으면 발송 비활성 */ });
    apiClient.get<{ data: Program[] }>('/api/v1/checkup/programs?isActive=true')
      .then((r) => setPrograms((r.data ?? []).filter((p) => p.isActive)))
      .catch(() => toast.error(tAttr('검진 프로그램 목록 실패')));
  }, []);

  // PROGRAM 선택 시 정가를 액면(표시용)으로만 — 공급단가(원가)는 관리자가 직접 입력(정가와 다름)
  const onPickProgram = (id: string) => {
    setProgramId(id);
    const p = programs.find((x) => x.id === id);
    if (p) setFaceValue(p.price);
  };

  const issue = async () => {
    if (form === 'PROGRAM' && !programId) { toast.error(tAttr('검진 프로그램을 선택하세요')); return; }
    if (form === 'AMOUNT' && faceValue <= 0) { toast.error(tAttr('액면가를 입력하세요')); return; }
    if (quantity < 1) { toast.error(tAttr('수량을 확인하세요')); return; }
    if (!idemKey) { newKey(); }
    setIssuing(true); setResult(null);
    try {
      const payload: Record<string, unknown> = {
        form, quantity, supplyPrice, idempotencyKey: idemKey,
        ...(form === 'PROGRAM' ? { programId } : { faceValue }),
      };
      const r = await apiClient.post<{ data: IssueResult }>('/api/v1/voucher/batches', payload);
      setResult(r.data);
      setSendResult(null); setSendDealerId(''); setRecipientEmail('');
      // 🔴 요청 수량이 아니라 **실제 발행된 장수**로 말한다(부분 발행을 완료라 말하지 않는다)
      const st = r.data.issueState;
      if (st?.code === 'PARTIAL') toast.error(`${tAttr('부분 발행')} — ${st.issued}/${st.requested}${tAttr('매')}`);
      else if (st?.code === 'RESUMED') toast.success(`${tAttr('재개 발행 완료')} — ${st.issued}/${st.requested}${tAttr('매')}`);
      else if (r.data.idempotent) toast.success(tAttr('이미 발행된 배치(멱등)'));
      else toast.success(`${tAttr('발행 완료')} — ${st?.issued ?? r.data.quantity}${tAttr('매')}`);
      newKey(); // 다음 발행용 새 멱등키
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? tAttr('발행 실패'));
    } finally { setIssuing(false); }
  };

  // 발행 배치를 딜러에 발송(배분 + 활성화코드 별도 이메일). 딜러가 수령확인해야 판매 가능.
  const sendToDealer = async () => {
    if (!result) return;
    if (!sendDealerId) { toast.error(tAttr('딜러를 선택하세요')); return; }
    setSending(true);
    try {
      const r = await apiClient.post<{ data: SendResult }>(`/api/v1/voucher/batches/${result.batchId}/send-to-dealer`, {
        distributorId: sendDealerId,
        supplyPrice: supplyPrice || undefined,
        recipientEmail: recipientEmail.trim() || undefined,
        idempotencyKey: `send-${result.batchId}-${sendDealerId}`,
      });
      setSendResult(r.data);
      toast.success(r.data.idempotent ? tAttr('이미 발송된 배치(멱등)') : `딜러 발송 — ${r.data.quantity}매 · 코드 이메일(${r.data.channel})`);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? tAttr('발송 실패'));
    } finally { setSending(false); }
  };

  const downloadCodes = () => {
    if (!result?.activationCodes?.length) return;
    const csv = ['serial,activationCode', ...result.activationCodes.map((c) => `${c.serial},${c.activationCode}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `voucher-activation-codes-${result.batchId.slice(0, 8)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const lookup = async () => {
    const s = serial.trim();
    if (!s) { toast.error(tAttr('시리얼을 입력하세요')); return; }
    setLooking(true); setVerify(null); setChain(null);
    try {
      const v = await apiClient.get<{ data: VerifyResult }>(`/api/v1/public/vouchers/${encodeURIComponent(s)}/verify`);
      setVerify(v.data);
    } catch { toast.error(tAttr('진위 조회 실패')); }
    try {
      const c = await apiClient.get<{ data: ChainResult }>(`/api/v1/voucher/vouchers/${encodeURIComponent(s)}/chain`);
      setChain(c.data);
    } catch { /* 체인은 미존재 시 무시 */ }
    setLooking(false);
  };

  const selectedProgram = programs.find((x) => x.id === programId);

  return (
    <div className="w-full p-4 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="검진권 발행·조회" /></h1>
        <p className="text-sm text-gray-500"><T k="배치 발행(시리얼·해시체인·앵커) 및 개별 검진권 진위·체인 조회" /></p>
      </div>

      {/* 발행 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-3"><T k="배치 발행" /></h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="유형" /></span>
            <select value={form} onChange={(e) => setForm(e.target.value as 'PROGRAM' | 'AMOUNT')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg">
              <option value="PROGRAM">{tAttr('프로그램형(상품권)')}</option>
              <option value="AMOUNT">{tAttr('금액권형')}</option>
            </select>
          </label>

          {form === 'PROGRAM' ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-400"><T k="검진 프로그램" /></span>
              <select value={programId} onChange={(e) => onPickProgram(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg min-w-[220px]">
                <option value="">{tAttr('선택…')}</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name} · {won(p.price)}<Unit><T k="원" /></Unit></option>)}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-400"><T k="액면가(원)" /></span>
              <input type="number" min={1} value={faceValue || ''} onChange={(e) => setFaceValue(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-36" />
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="수량" /></span>
            <input type="number" min={1} max={1000000} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-28" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="공급단가(원)" /></span>
            <input type="number" min={0} value={supplyPrice || ''} onChange={(e) => setSupplyPrice(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-32" />
          </label>

          <button onClick={issue} disabled={issuing} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <T k={issuing ? '발행 중…' : '발행@버튼'} />
          </button>
        </div>
        <div className="mt-2 text-[11px] text-gray-400">
          {form === 'PROGRAM' && selectedProgram ? `액면 ${won(selectedProgram.price)}원(정가 스냅샷) · ` : ''}
          <T k="멱등키" /> <code className="text-gray-500">{idemKey.slice(0, 22)}…</code>
          <button onClick={newKey} className="ml-2 text-blue-600 underline"><T k="새 키" /></button>
        </div>

        {result && (
          <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-emerald-700"><T k="발행 결과" /> · {result.issueState?.issued ?? result.quantity}매 · 액면 {won(result.faceValue)}<Unit>원</Unit></span>
              {result.activationCodes?.length ? (
                <button onClick={downloadCodes} className="text-[11px] text-emerald-700 border border-emerald-200 bg-white rounded-lg px-2 py-1"><T k="활성화코드 CSV" /></button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-gray-600">
              <div><T k="배치 ID:" /> <code>{result.batchId}</code></div>
              <div><T k="앵커 ID:" /> <code>{result.anchorId}</code></div>
              <div className="sm:col-span-2 break-all">Merkle Root: <code>{result.merkleRoot}</code></div>
            </div>
            {result.issueState?.code === 'PARTIAL' && (
              <div className="mt-2 text-[11px] text-red-600">
                ⚠ <T k="부분 발행 — 같은 멱등키로 다시 발행하면 나머지를 이어서 만듭니다." />{' '}
                {result.issueState.issued}/{result.issueState.requested}
              </div>
            )}
            {!!result.issueState?.codesNotReissued && (
              <div className="mt-2 text-[11px] text-amber-600">
                ⚠ <T k="앞서 발행된 장의 활성화코드는 다시 노출되지 않습니다 — 장수:" /> {result.issueState.codesNotReissued}
              </div>
            )}
            {result.issueState?.codesWithheldBulk && (
              <div className="mt-2 text-[11px] text-amber-600">⚠ <T k="대량 발행이라 활성화코드는 봉인 전달 시스템에서 발급됩니다." /></div>
            )}
            {result.activationCodes?.length ? (
              <div className="mt-3">
                <div className="text-[11px] text-red-500 mb-1">⚠ <T k="활성화코드는 발행 시 1회만 노출됩니다 — 딜러/구매자 전달용으로 즉시 보관하세요." /></div>
                <div className="max-h-48 overflow-auto rounded-lg border border-gray-100 bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-gray-50 text-gray-400"><tr><th className="text-left px-3 py-1.5"><T k="시리얼" /></th><th className="text-left px-3 py-1.5"><T k="활성화코드" /></th></tr></thead>
                    <tbody>
                      {result.activationCodes.map((c) => (
                        <tr key={c.serial} className="border-t border-gray-50"><td className="px-3 py-1 font-mono text-gray-600">{c.serial}</td><td className="px-3 py-1 font-mono font-bold text-gray-800">{c.activationCode}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* 딜러에게 발송(채널분리): 배분 + 활성화코드 별도 이메일 → 딜러 수령확인해야 판매 */}
            <div className="mt-4 pt-3 border-t border-emerald-100">
              <div className="text-sm font-bold text-gray-800 mb-2"><T k="딜러에게 발송" /></div>
              <p className="text-[11px] text-gray-500 mb-2">배치를 딜러에 배분하고 <b>활성화코드는 별도 이메일</b>로 전달합니다. 딜러가 포털에서 코드로 <b>수령확인(활성화)</b>해야 판매할 수 있습니다.</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-400"><T k="딜러" /></span>
                  <select value={sendDealerId} onChange={(e) => setSendDealerId(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg min-w-[200px]">
                    <option value="">{tAttr('선택…')}</option>
                    {dealers.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.currency})</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-400"><T k="수신 이메일(생략 시 딜러 계정)" /></span>
                  <input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="dealer@example.com" className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-56" />
                </label>
                <button onClick={sendToDealer} disabled={sending || !sendDealerId} className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50">
                  <T k={sending ? '발송 중…' : '딜러에 발송'} />
                </button>
              </div>
              {sendResult && (
                <div className={`mt-2 text-[12px] border rounded-lg px-3 py-2 ${sendTone(sendResult).box}`}>
                  {sendTone(sendResult).icon} {sendResult.quantity}매 배분 · 활성화코드 이메일 → <b>{sendResult.emailedTo}</b> · <b><T k={sendTone(sendResult).label} /></b>(<T k={sendTone(sendResult).note} />)
                  {sendResult.delivered ? <> · 딜러 <b><T k="수령확인 대기" /></b></> : <> · <b>배분은 확정</b>됐으므로 코드 전달을 별도로 처리해야 합니다</>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 조회 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-3"><T k="검진권 조회(시리얼)" /></h2>
        <div className="flex flex-wrap items-end gap-2">
          <input value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} placeholder="WGC-…" className="px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono min-w-[280px]" />
          <button onClick={lookup} disabled={looking} className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-lg hover:bg-gray-900 disabled:opacity-50"><T k={looking ? '조회 중…' : '조회'} /></button>
        </div>
        {verify && (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${verify.valid ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
              {verify.valid ? <T k="유효 (지금 사용 가능)" /> : <><T k="사용 불가" /> — <T k={VERIFY_REASON[verify.reason ?? ''] ?? verify.reason ?? '사유 미상'} /></>}
            </span>
            {verify.status && <span className="px-2.5 py-1 rounded-lg bg-gray-50 text-gray-600 text-xs"><T k="상태" /> {verify.status}</span>}
            {verify.balance !== undefined && <span className="px-2.5 py-1 rounded-lg bg-gray-50 text-gray-600 text-xs"><T k="잔액" /> {won(verify.balance)} / <T k="액면" /> {won(verify.faceValue ?? 0)}</span>}
            {verify.expiresAt && <span className="px-2.5 py-1 rounded-lg bg-gray-50 text-gray-600 text-xs"><T k="만료@일시" /> {verify.expiresAt.slice(0, 10)}</span>}
            {chain && <span className={`px-2.5 py-1 rounded-lg text-xs ${chain.valid ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'}`}><T k="체인" /> {chain.valid ? `정상(${chain.events ?? 0}건)` : `손상@${chain.brokenAt ?? '?'}`}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
