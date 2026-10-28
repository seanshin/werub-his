'use client';

import { useEffect, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useParams } from 'next/navigation';
import { issuedDocumentTypeLabel, isServerBuiltDocumentType, parseDecisionPrintLine, type PrintDiffEntry } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';

interface VerifyData {
  valid: boolean;
  issueNo: string;
  /** CHECK_CODE 확인 코드 불일치 · NOT_FOUND 기록 없음 · VOID 무효 · SUPERSEDED 대체됨 */
  reason?: 'CHECK_CODE' | 'NOT_FOUND' | 'VOID' | 'SUPERSEDED';
  documentType?: string;
  issuedAt?: string;
  status?: string;
  hospital?: string | null;
  message?: string;
}

interface CompareData {
  issuedBy: string | null;
  hash: string;
  hashIntact: boolean;
  measuredAt: string | null;
  lines: number;
  compare: { state: 'MATCH' | 'CHANGED' | 'UNAVAILABLE'; changed: PrintDiffEntry[]; reason?: string };
}

/** 무효 사유 — 🔴 사유를 섞지 않는다(확인 코드 불일치 = 옮겨 적기 오류·위조 의심 / 기록 없음 / 취소 / 새 판으로 대체) */
const REASON_TEXT: Record<string, string> = {
  CHECK_CODE: '확인 코드가 맞지 않습니다 — QR 을 다시 찍거나 주소의 확인 코드(v=)를 확인하세요. 계속 맞지 않으면 위조를 의심하세요.',
  NOT_FOUND: '발급 기록을 찾을 수 없습니다',
  VOID: '무효(취소) 처리된 문서',
  SUPERSEDED: '내용이 바뀌어 새 판으로 대체된 문서',
};

const STATE_TEXT: Record<string, string> = { REAL: '실결정', SEED: '개발 시드', OPEN: '미결' };
/** 줄을 사람 글자로 — 결정 줄은 상태·선택값 · 그 밖(개시 항목·근무·보고서)은 키 뒤 칸을 그대로 */
const lineText = (l: string | null) => {
  if (l === null) return '없음';
  const raw = l.replace(/^D:/, '');
  if (/^[^|]+\|(REAL|SEED|OPEN)\|/.test(raw)) { const p = parseDecisionPrintLine(raw); return `${STATE_TEXT[p.state] ?? p.state}${p.choice ? ` · ${p.choice}` : ''}`; }
  return l.split('|').slice(1).filter(Boolean).join(' · ') || '(빈 값)';
};

/**
 * 발급 문서 공개 진위검증 페이지 (QR 대상) — PHI 미노출.
 * 2026-10-12 기획 `decision-print-remaining` P0-5:
 *  · 서버 생성 문서(결정 대장·의사결정서)는 QR 주소의 확인 코드(`v=`)를 함께 보낸다
 *  · 공개: 유효/무효/조회 실패 · 종류(shared 라벨 정본)·발급 시각·상태·기관 — 결정 내용 없음
 *  · 직원(로그인 · 관리자·경영진): 발급자·해시·**지금 원장과의 차이**(일치 / 이 판 이후 N건 바뀜 / 비교 불가)
 */
export default function VerifyDocumentPage() {
  const params = useParams();
  const issueNo = String(params?.issueNo ?? '');
  /** 확인 코드(QR 주소의 v=) — 주소창에서 읽는다(Suspense 경계 없이) · null = 아직 안 읽음 */
  const [v, setV] = useState<string | null>(null);
  useEffect(() => { setV(new URLSearchParams(window.location.search).get('v') ?? ''); }, []);
  const [data, setData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(true);
  /** 🔴 조회 실패는 "위조·무효"가 아니다 — 세 번째 상태로 분리한다(2026-09-02) */
  const [fetchFailed, setFetchFailed] = useState(false);
  /** 직원 대조 — null 아직 / 'NONE' 로그인 안 함·권한 밖(보이지 않음) / 'FAILED' 비교 불가 */
  const [cmp, setCmp] = useState<CompareData | 'NONE' | 'FAILED' | null>(null);

  useEffect(() => {
    if (!issueNo || v === null) return;
    fetch(`/api/v1/documents/verify/${encodeURIComponent(issueNo)}${v ? `?v=${encodeURIComponent(v)}` : ''}`)
      .then((r) => r.json())
      .then((j) => setData(j.data ?? null))
      /**
       * 🔴 종전엔 실패를 `{valid:false, message:'검증 실패'}` 로 만들어 넣었다 —
       *    화면은 그것을 **"유효하지 않은 문서입니다 / 무효(취소) 처리된 문서"** 로 그렸다.
       *    환자·보험사가 QR 을 찍었을 때 네트워크가 끊긴 것뿐인데 **병원이 취소한 문서**라고 읽는다.
       *    조회 실패는 문서에 대한 판정이 아니다.
       */
      .catch(() => setFetchFailed(true))
      .finally(() => setLoading(false));
  }, [issueNo, v]);

  // 직원 대조 — 서버 발급 인쇄본이 유효할 때만 · 로그인 토큰이 없으면 부르지 않는다(공개 방문자에게 로그인 흐름을 띄우지 않는다)
  useEffect(() => {
    if (!data?.valid || !isServerBuiltDocumentType(data.documentType)) return;
    if (!apiClient.getToken()) { setCmp('NONE'); return; }
    apiClient.get<{ data: CompareData }>(`/api/v1/print-issue/${encodeURIComponent(issueNo)}/compare`)
      .then((r) => setCmp(r.data))
      .catch((e: { code?: string }) => setCmp(e?.code === 'ERR_FORBIDDEN' || e?.code === 'UNAUTHORIZED' ? 'NONE' : 'FAILED'));
  }, [data, issueNo]);

  const typeLabel = (t?: string) => (t ? issuedDocumentTypeLabel(t) ?? `${t} (등록되지 않은 종류)` : '-');

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border p-8 text-center">
        <h1 className="text-lg font-bold text-gray-900 mb-1">문서 진위 검증</h1>
        <p className="text-xs text-gray-400 mb-6 break-all">발급번호 {issueNo}</p>

        {loading ? (
          <div className="py-10 text-gray-400 animate-pulse">검증 중…</div>
        ) : fetchFailed ? (
          <div className="py-6">
            <div className="text-5xl mb-3">⚠️</div>
            <p className="text-amber-700 font-bold">검증 서버에 연결하지 못했습니다</p>
            <p className="text-xs text-gray-500 mt-1">문서가 무효라는 뜻이 아닙니다. 잠시 후 다시 시도해 주세요.</p>
            <button
              onClick={() => { setFetchFailed(false); setLoading(true); location.reload(); }}
              className="mt-4 px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 min-h-[44px]"
            >
              다시 시도
            </button>
          </div>
        ) : !data || !data.valid ? (
          <div className="py-6" data-verify-reason={data?.reason ?? 'NONE'}>
            <div className="text-5xl mb-3">{data?.reason === 'CHECK_CODE' ? '⚠️' : '❌'}</div>
            <p className={`${data?.reason === 'CHECK_CODE' ? 'text-amber-700' : 'text-red-600'} font-bold`}>
              {data?.reason === 'CHECK_CODE' ? '확인 코드를 확인할 수 없습니다' : '유효하지 않은 문서입니다'}
            </p>
            {/* 🔴 종전 `{data?.message ?? data?.status === 'VOID' ? … : …}` 는 `??` 가 `?:` 보다 먼저 묶여
                **message 가 있기만 하면 무조건 "무효(취소) 처리된 문서"** 가 됐다(괄호로 못박는다). */}
            <p className="text-xs text-gray-500 mt-1">
              {(data?.reason && REASON_TEXT[data.reason])
                ?? (data?.status === 'VOID' ? REASON_TEXT.VOID : (data?.message ?? REASON_TEXT.NOT_FOUND))}
            </p>
          </div>
        ) : (
          <div className="py-2">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-emerald-600 font-bold mb-4">정상 발급된 문서입니다</p>
            <dl className="text-left text-sm divide-y divide-gray-100 border rounded-xl overflow-hidden">
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-gray-500 shrink-0">문서 종류</dt><dd className="font-medium text-right">{typeLabel(data.documentType)}</dd></div>
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-gray-500 shrink-0">발급 기관</dt><dd className="font-medium text-right">{data.hospital ?? '-'}</dd></div>
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-gray-500 shrink-0">발급 일시</dt><dd className="font-medium text-right">{data.issuedAt ? kdate(data.issuedAt, 'datetimeSec') : '-'}</dd></div>
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-gray-500 shrink-0">상태</dt><dd className="font-medium text-right">{data.status}</dd></div>
            </dl>
            <p className="text-[11px] text-gray-400 mt-4">※ 본 검증은 발급 사실·유효성만 확인하며, 진료정보·결정 내용은 표시하지 않습니다.</p>
            {isServerBuiltDocumentType(data.documentType) && <StaffCompare cmp={cmp} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** 직원 대조 — 🔴 바뀌었다고 무효가 아니다(그 시점의 진본) · 비교 못 하면 "일치"로 말하지 않는다 */
function StaffCompare({ cmp }: { cmp: CompareData | 'NONE' | 'FAILED' | null }) {
  if (cmp === null) return <p className="mt-4 text-[11px] text-gray-400" data-verify-compare="LOADING">지금 원장과 대조하는 중…</p>;
  if (cmp === 'NONE') return <p className="mt-4 text-[11px] text-gray-400" data-verify-compare="NONE">관리자·경영진으로 로그인하면 이 판과 지금 원장의 차이를 볼 수 있습니다.</p>;
  if (cmp === 'FAILED' || cmp.compare.state === 'UNAVAILABLE') {
    return <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[12px] text-amber-800" data-verify-compare="UNAVAILABLE">비교 불가 — 지금 원장을 읽지 못했습니다. 일치한다는 뜻이 아닙니다.</p>;
  }
  const { compare: c } = cmp;
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-gray-200 px-4 py-3 text-left text-[12px]" data-verify-compare={c.state}>
      <p className="font-bold text-gray-800">직원 대조</p>
      <p className="text-gray-600">발급자 {cmp.issuedBy ?? '확인 안 됨'} · 자료 기준 {cmp.measuredAt ? kdate(cmp.measuredAt, 'datetime') : '-'} · {cmp.lines}줄</p>
      <p className="break-all font-mono text-[10px] text-gray-500">sha256 {cmp.hash}</p>
      {!cmp.hashIntact && <p className="font-semibold text-red-700">원장에 동결된 줄과 해시가 맞지 않습니다 — 발급 원장 행이 바뀌었을 수 있습니다.</p>}
      {c.state === 'MATCH' ? (
        <p className="font-semibold text-emerald-700">지금 원장과 일치합니다.</p>
      ) : (
        <>
          <p className="font-semibold text-amber-800">이 판 이후 {c.changed.length}건 바뀜 — 이 종이는 발급 시점의 진본이지만 지금과 다릅니다.</p>
          <ul className="max-h-60 overflow-auto divide-y divide-gray-100 rounded-lg border border-gray-100">
            {c.changed.map((d) => (
              <li key={d.key} className="px-2 py-1.5">
                <span className="break-all font-mono text-[10px] text-gray-500">{d.key}</span>
                <span className="block text-gray-700">{lineText(d.before)} → {lineText(d.after)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
