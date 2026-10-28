'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { DEDICATED_RESULT_SCREEN, GENERIC_RESULT_TYPES, parseOrderResult, type OrderEntryType, type OrderResultEntry } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { uploadMultipart } from '@/lib/upload';
import { extractErrorMessage } from '@/lib/error-utils';
import { kdate } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useEntryScope } from '@/components/prescription/useEntryScope';

/**
 * 오더 결과·결과지·행위 종료 기록(2026-09-29 사람 요청) — 시행한 의료진이 자기 범위 안에서 남긴다.
 *
 *  - 치료·간호·활동·식이: 요약·소견·**실제 시행 시각** + (선택) 완료 처리. 정정은 **새 항목**(원래 기록은 남는다)
 *  - 검사·영상·약: 결과의 정본은 전용 원장(검사 결과·판독·조제/MAR) — 여기서 받지 않고 그 화면으로 안내한다(정본이 둘이 되지 않게)
 *  - 결과지(PDF·이미지)는 전 유형 첨부 · 지우지 않는다
 *  - 누가 기록할 수 있는지는 서버 정본(canExecuteOrder)이 정하고, 화면은 그 표(entry-scope/me `executes`)로 칸을 가린다
 *
 * 🔴 시스템 스탬프(접수·시작·완료 시각)는 '기록한 때'고 시행 시각은 '실제 한 때'다 — 둘을 한 칸에 섞지 않는다.
 */
export function OrderResultPanel({ orderId, type, status, result }: { orderId: string; type?: string; status: string; result: unknown }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const scope = useEntryScope();
  const t = type as OrderEntryType | undefined;
  const dedicated = t ? DEDICATED_RESULT_SCREEN[t] : undefined;
  const generic = !!t && GENERIC_RESULT_TYPES.includes(t);
  const canRecord = !!t && scope.data?.executes?.[t] === true && status !== 'CANCELLED';
  // 구 형식(문자열 등) 결과는 그대로 보여 준다 — 구조로 못 읽는다고 지우지 않는다
  const legacy = typeof result === 'string' && result.trim() ? result : null;
  const doc = parseOrderResult(result);

  const [summary, setSummary] = useState('');
  const [findings, setFindings] = useState('');
  const [performedAt, setPerformedAt] = useState('');
  const [complete, setComplete] = useState(status !== 'COMPLETED');
  const [amends, setAmends] = useState<OrderResultEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['orders'] }); void qc.invalidateQueries({ queryKey: ['my-orders'] }); };

  const submit = async () => {
    if (!summary.trim()) { toast.error(tAttr('결과 요약을 적으세요.')); return; }
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/orders/${orderId}/result`, {
        summary: summary.trim(),
        ...(findings.trim() ? { findings: findings.trim() } : {}),
        // datetime-local 은 로컬 시각 — ISO 로 바꿔 보낸다. 비우면 '기록 시각만 앎'(지어내지 않는다)
        ...(performedAt ? { performedAt: new Date(performedAt).toISOString() } : {}),
        ...(complete && status !== 'COMPLETED' && !amends ? { complete: true } : {}),
        ...(amends ? { amends: amends.id } : {}),
      });
      toast.success(tAttr(amends ? '정정을 덧붙였습니다 — 원래 기록은 남아 있습니다.' : '결과를 기록했습니다.'));
      setSummary(''); setFindings(''); setPerformedAt(''); setAmends(null);
      refresh();
    } catch (e) {
      toast.error(extractErrorMessage(e) || tAttr('결과 기록에 실패했습니다.'));
    }
    setBusy(false);
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadMultipart(`/api/v1/orders/${orderId}/result/attachments`, file);
      toast.success(tAttr('결과지를 첨부했습니다.'));
      refresh();
    } catch (e) {
      toast.error(extractErrorMessage(e) || tAttr('결과지 첨부에 실패했습니다 (jpeg/png/webp/pdf·10MB).'));
    }
    setUploading(false);
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-xs" data-order-result-panel>
      <p className="flex items-center gap-1.5 font-semibold text-gray-700">
        <span aria-hidden>📋</span> <T k="결과·시행 기록" />
      </p>

      {/* 전용 원장 유형 — 그 화면으로 */}
      {dedicated && (
        <p className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-blue-800" data-result-dedicated>
          <T k="이 유형의 결과는 전용 화면에서 기록합니다" /> — <Link href={dedicated.href} className="font-semibold underline"><T k={dedicated.label} /></Link>
        </p>
      )}

      {legacy && (
        <p className="whitespace-pre-wrap rounded-lg bg-gray-50 px-2.5 py-1.5 text-gray-800"><span className="font-semibold text-gray-500"><T k="수행 결과" /> · </span>{legacy}</p>
      )}

      {/* 기록 목록 — 지우지 않는다. 정정은 원래 항목을 가리킨다 */}
      {doc.entries.length > 0 ? (
        <ol className="space-y-1.5" data-result-entries>
          {doc.entries.map((e) => (
            <li key={e.id} className={`rounded-lg border px-2.5 py-1.5 ${e.kind === 'AMENDMENT' ? 'border-amber-200 bg-amber-50/60' : 'border-gray-100 bg-gray-50/60'}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                {e.kind === 'AMENDMENT' && <span className="rounded bg-amber-100 px-1 font-semibold text-amber-800"><T k="정정" /></span>}
                <span><T k="시행" />: <b className="text-gray-700">{e.performedAt ? kdate(e.performedAt, 'datetime') : tAttr('시각 미기록')}</b></span>
                <span>· <T k="기록" />: {kdate(e.recordedAt, 'datetime')}{e.recordedByName ? ` · ${e.recordedByName}` : ''}</span>
                {canRecord && generic && e.kind === 'RESULT' && (
                  <button type="button" onClick={() => { setAmends(e); setSummary(e.summary); setFindings(e.findings ?? ''); }} className="ml-auto text-blue-600 hover:underline" data-amend={e.id}><T k="정정" /></button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap font-medium text-gray-900">{e.summary}</p>
              {e.findings && <p className="mt-0.5 whitespace-pre-wrap text-gray-600">{e.findings}</p>}
            </li>
          ))}
        </ol>
      ) : generic && !legacy ? (
        <p className="text-gray-400"><T k="아직 기록된 결과가 없습니다." /></p>
      ) : null}

      {/* 결과지 */}
      {(doc.attachments.length > 0 || canRecord) && (
        <div className="space-y-1" data-result-attachments>
          {doc.attachments.map((a, i) => (
            <div key={`${a.url}-${i}`} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1">
              <span className="flex-1 truncate">📄 {a.fileName}</span>
              <span className="text-[10px] text-gray-400">{a.uploadedByName ?? ''} · {kdate(a.uploadedAt, 'datetime')}</span>
              <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 underline"><T k="열기" /></a>
            </div>
          ))}
          {canRecord && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-200">
              📎 {uploading ? tAttr('첨부 중…') : tAttr('결과지 첨부')} <span className="text-gray-400">(jpeg/png/webp/pdf·10MB)</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading} data-result-upload
                onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void upload(f); ev.target.value = ''; }} />
            </label>
          )}
        </div>
      )}

      {/* 기록 폼 — 범용 유형 · 시행 범위 안 */}
      {generic && canRecord && (
        <div className="space-y-1.5 border-t border-gray-100 pt-2" data-result-form>
          {amends && (
            <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              <T k="정정 — 원래 기록은 남고 새 항목으로 덧붙습니다" /> <button type="button" onClick={() => { setAmends(null); setSummary(''); setFindings(''); }} className="ml-1 underline"><T k="취소" /></button>
            </p>
          )}
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={2000} data-result-summary
            placeholder={tAttr('결과 요약(필수) — 무엇을 했고 어떤 반응이었는지')} aria-label={tAttr('결과 요약')}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          <textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={2} maxLength={8000}
            placeholder={tAttr('소견·세부(선택)')} aria-label={tAttr('소견')}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-gray-600">
              <T k="실제 시행 시각" />
              <input type="datetime-local" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} data-result-performed
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
              <span className="text-[10px] text-gray-400">(<T k="비우면 기록 시각만 남습니다" />)</span>
            </label>
            {status !== 'COMPLETED' && !amends && (
              <label className="flex items-center gap-1.5 text-gray-700">
                <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} data-result-complete />
                <T k="기록과 함께 행위 완료" />
              </label>
            )}
            <button type="button" onClick={() => void submit()} disabled={busy || !summary.trim()} data-result-submit
              className="ml-auto min-h-[36px] rounded-lg bg-emerald-600 px-3.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
              {busy ? <T k="기록 중…" /> : amends ? <T k="정정 덧붙이기" /> : <T k="결과 기록" />}
            </button>
          </div>
        </div>
      )}
      {generic && !canRecord && scope.isSuccess && status !== 'CANCELLED' && (
        <p className="text-[11px] text-gray-400"><T k="이 오더의 결과는 시행 직종이 기록합니다(내 직종 범위 밖)." /></p>
      )}
    </div>
  );
}
