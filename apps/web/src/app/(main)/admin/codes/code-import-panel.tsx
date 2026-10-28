'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import type { ServerMessage } from '@hospital-run/shared';
import { ServerText } from '@/components/ui/server-text';

type Kind = 'diagnosis' | 'procedure' | 'medication';
type Verdict = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'RETIRED' | 'ERROR';

/** `*Msg` 가 정본(서버 `{ k, params }` · 화면이 조립) — 문자열은 구 응답용 한국어 파생 */
interface PreviewRow { line: number; code: string; verdict: Verdict; changes?: string[]; changesMsg?: ServerMessage[]; error?: string; errorMsg?: ServerMessage }
interface Preview {
  kind: Kind; effectiveDate: string; versioned: boolean; totalLines: number;
  counts: Record<Verdict, number>; rows: PreviewRow[]; missingInFile: number;
  /** 🔴 파일에 없는 것 중 원내 등록분 — 고시 파일에 없는 것이 정상이다 */
  localCount?: number; notes: string[]; notesMsg?: ServerMessage[];
}

/** 라벨 값은 i18n 키 — 저장·전송값은 `Kind` 코드(diagnosis…)이고 라벨은 표시에만 쓴다 */
const KIND_LABEL: Record<Kind, string> = { diagnosis: '진단코드', procedure: '수가코드 (EDI)', medication: '약품코드' };
const VERDICT_LABEL: Record<Verdict, string> = {
  NEW: '신설', CHANGED: '변경', UNCHANGED: '동일', RETIRED: '폐지', ERROR: '오류',
};
const VERDICT_TONE: Record<Verdict, string> = {
  NEW: 'bg-emerald-50 text-emerald-700',
  CHANGED: 'bg-amber-50 text-amber-700',
  UNCHANGED: 'bg-gray-50 text-gray-500',
  RETIRED: 'bg-slate-50 text-slate-600',
  ERROR: 'bg-red-50 text-red-700',
};

/**
 * 고시 개정 일괄 반영 화면.
 *
 * 🔴 **올리면 바로 반영하지 않는다.** 차이를 먼저 보여주고, 사람이 [적용]을 눌러야 반영된다.
 *    잘못된 파일 하나로 수가 166,744건이 망가질 수 있다.
 * 🔴 **덮어쓰는 종류는 그렇다고 말한다** — 진단·약품은 코드당 1행이라 이력이 남지 않는다.
 */
export default function CodeImportPanel() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('procedure');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();

  const previewMut = useMutation({
    mutationFn: () => apiClient.post<{ data: Preview }>('/api/v1/codes/import/preview', { kind, content, effectiveDate }),
    onSuccess: (r) => setPreview(r.data),
    onError: (e: unknown) => { setPreview(null); toast.error((e as Error)?.message || tAttr('차이를 계산하지 못했습니다')); },
  });

  const applyMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { created: number; updated: number; versioned: number } }>(
      '/api/v1/codes/import/apply', { kind, content, effectiveDate },
    ),
    onSuccess: (r) => {
      const d = r.data;
      toast.success(tfAttr('반영 완료 — 신설 {신설} · 갱신 {갱신} · 새 버전 {새버전}', { 신설: d.created, 갱신: d.updated, 새버전: d.versioned }));
      setPreview(null); setContent('');
      qc.invalidateQueries({ queryKey: ['codes'] });
    },
    onError: (e: unknown) => toast.error((e as Error)?.message || tAttr('반영에 실패했습니다')),
  });

  const canPreview = content.trim().length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate);
  const hasErrors = (preview?.counts.ERROR ?? 0) > 0;
  const willChange = (preview?.counts.NEW ?? 0) + (preview?.counts.CHANGED ?? 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-gray-900"><T k="고시 개정 일괄 반영" /></h3>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          <Tf k="개정 파일(CSV/TSV)을 붙여넣고 {강조}합니다. 확인 전에는 아무것도 반영되지 않습니다." params={{ 강조: <b><T k="차이를 먼저 확인" /></b> }} />
          <br />
          {/* 열 이름(code·nameKo…)은 파일 형식 그 자체라 번역하지 않는다 */}
          <Tf
            k="필수 열: {필수} · 선택: {선택}"
            params={{
              필수: <><code className="rounded bg-gray-100 px-1">code</code>, <code className="rounded bg-gray-100 px-1">nameKo</code></>,
              선택: <><code className="rounded bg-gray-100 px-1">category</code>{kind !== 'diagnosis' && <>, <code className="rounded bg-gray-100 px-1">unitPrice</code></>}</>,
            }}
          />
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-gray-600">
          <T k="코드 종류" />
          <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); }}
            className="ml-2 rounded-lg border px-2 py-1.5 text-xs">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{tAttr(KIND_LABEL[k])}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          <T k="시행일@고시" />
          <input type="date" value={effectiveDate} onChange={(e) => { setEffectiveDate(e.target.value); setPreview(null); }}
            className="ml-2 rounded-lg border px-2 py-1.5 text-xs" />
        </label>
        {kind !== 'procedure' && (
          // 🔴 미리 밝힌다 — 누르고 나서 알면 늦다
          <span className="text-[11px] text-amber-600">
            <Tf k="이 종류는 코드당 1행이라 {강조}(이력 없음)" params={{ 강조: <b><T k="현재 값을 덮어씁니다" /></b> }} />
          </span>
        )}
      </div>

      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setPreview(null); }}
        rows={8}
        placeholder={'code,nameKo,unitPrice\nAA100,흉부방사선촬영,12340'}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs"
      />

      <div className="flex items-center gap-2">
        <button onClick={() => previewMut.mutate()} disabled={!canPreview || previewMut.isPending}
          className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
          <T k={previewMut.isPending ? '계산 중…' : '차이 보기'} />
        </button>
        {!canPreview && <span className="text-[11px] text-gray-400"><T k="시행일과 내용을 채우면 확인할 수 있습니다" /></span>}
      </div>

      {preview && (
        <div className="rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
              <div key={v} className={`rounded-lg p-2 text-center ${VERDICT_TONE[v]}`}>
                <div className="text-base font-bold">{preview.counts[v] ?? 0}</div>
                <div className="text-[10px]"><T k={VERDICT_LABEL[v]} /></div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500">
            <Tf k="파일 {행수}행 · 시행일 {시행일}" params={{ 행수: preview.totalLines, 시행일: preview.effectiveDate }} />
          </p>

          {preview.notes.map((n, i) => (
            <p key={i} className="text-[11px] leading-relaxed text-amber-700"><ServerText msg={preview.notesMsg?.[i]} fallback={n} /></p>
          ))}

          {/* 무엇이 달라지는지 — 숫자만 보고 적용하지 않게 */}
          <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100">
            {preview.rows.filter((r) => r.verdict !== 'UNCHANGED').slice(0, 200).map((r) => (
              <div key={r.line} className="flex items-start gap-2 border-b border-gray-50 px-2 py-1.5 text-[11px] last:border-0">
                <span className={`shrink-0 rounded px-1.5 py-0.5 ${VERDICT_TONE[r.verdict]}`}><T k={VERDICT_LABEL[r.verdict]} /></span>
                <span className="shrink-0 font-mono text-gray-700">{r.code || <Tf k="{행}행" params={{ 행: r.line }} />}</span>
                <span className="text-gray-500">
                  {r.error != null || r.errorMsg
                    ? <ServerText msg={r.errorMsg} fallback={r.error} />
                    : r.changes?.map((c, ci) => (
                      <Fragment key={ci}>{ci > 0 && ' · '}<ServerText msg={r.changesMsg?.[ci]} fallback={c} /></Fragment>
                    ))}
                </span>
              </div>
            ))}
            {preview.rows.filter((r) => r.verdict !== 'UNCHANGED').length > 200 && (
              // 🔴 자르면 잘랐다고 말한다
              <p className="px-2 py-1.5 text-[11px] text-gray-400">
                <Tf k="앞 200건만 표시했습니다 — 전체 {전체}건" params={{ 전체: preview.rows.filter((r) => r.verdict !== 'UNCHANGED').length }} />
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => {
                if (!window.confirm(tfAttr('{종류} {수}건을 시행일 {시행일} 로 반영합니다. 진행할까요?', { 종류: tAttr(KIND_LABEL[kind]), 수: willChange, 시행일: effectiveDate }))) return;
                applyMut.mutate();
              }}
              disabled={hasErrors || willChange === 0 || applyMut.isPending}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              {applyMut.isPending ? <T k="반영 중…" /> : <Tf k="적용 ({수}건)" params={{ 수: willChange }} />}
            </button>
            {hasErrors && (
              <span className="text-[11px] text-red-600"><Tf k="오류 {수}건을 고친 뒤 다시 올리세요 — 오류가 있으면 반영하지 않습니다" params={{ 수: preview.counts.ERROR }} /></span>
            )}
            {!hasErrors && willChange === 0 && (
              <span className="text-[11px] text-gray-400"><T k="바뀌는 것이 없습니다" /></span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
