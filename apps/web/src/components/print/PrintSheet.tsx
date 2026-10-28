'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { qrDataUrl } from '@/components/ui/QrImage';
import { UNISSUED_PRINT_TEXT, type UnissuedPrintReason } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';
import type { IssuedPrint } from '@/components/print/usePrintIssue';

/**
 * 인쇄 전용 문서 공용 부품(2026-10-12) — 화면을 그대로 찍지 않고 **인쇄 전용 문서**를 body 직하(.doc-print-root)에 그린다.
 *
 * 🔴 종전 허용 인쇄(sanctionedPrint) 12곳이 빈 종이였다 — 공용 문서 CSS 가 인쇄 루트 없이도 body 직계를 숨겼다.
 * 이 부품이 지키는 것(사용자 결정 2026-10-12):
 *  · 칸에는 **짧은 사람 글자** — 긴 뜻은 머리·범례에 · 식별자(키·코드)는 작은 고정폭 보조 글자(점 뒤에서만 줄바꿈)
 *  · 행 확인은 **사람 확인 칸(☐·서명)** · 문서 끝 **검토자·서명·일자** — 행별 기계 코드(해시)는 넣지 않는다
 *  · 기계 재인식·진위는 **문서 하나**로 — 각 쪽 오른쪽 아래 QR + sha256
 *  · 쪽 규격은 named page(`dps`·`dps-land`) — 다른 문서의 @page(여백 0)와 갈라 쓴다
 */

export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // 🔴 계산 못 하면 "계산 불가" — 빈 값을 코드인 척하지 않는다
  }
}


/** 문서 해시 — 정본 문자열(행을 줄바꿈으로 이은 것)의 sha256 · 계산 못 하면 null(빈 값을 코드인 척하지 않는다) */
export function useDocHash(text: string) {
  const [h, setH] = useState<{ doc: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    sha256Hex(text).then((doc) => { if (alive) setH({ doc }); });
    return () => { alive = false; };
  }, [text]);
  return h;
}

/** 식별자를 점(.)·밑줄(_)·하이픈 뒤에서만 줄바꿈 — 글자 중간에서 끊기지 않게 */
export const breakKey = (k: string) => k.split(/(?<=[._-])/).flatMap((p, i, a) => (i < a.length - 1 ? [p, <wbr key={i} />] : [p]));

/** 사람 확인 칸 — ☐ + 서명 줄 */
export const CheckCell = () => <span className="dps-check" aria-label="확인">☐ <span className="dps-sign" /></span>;
/** 문서 끝 서명란 */
export function SignOff() {
  return (
    <table className="dps-signoff" data-print-signoff>
      <tbody><tr>
        <th><T k="검토자" /></th><td />
        <th><T k="서명" /></th><td />
        <th><T k="일자" /></th><td />
      </tr></tbody>
    </table>
  );
}


/** 인쇄 전용 쪽 규격 — 다른 문서의 @page(여백 0)와 갈라 쓴다(named page) */
const PRINT_CSS = `
.dps, .dps-raw { display: none; }
@media print {
  .dps { display: block; page: dps; font-family: 'Pretendard', 'Noto Sans KR', -apple-system, sans-serif; color: #111; font-size: 8.5pt; line-height: 1.4; }
  .dps table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .dps th, .dps td { border: 0.6pt solid #444; padding: 2pt 4pt; vertical-align: top; word-break: keep-all; overflow-wrap: break-word; }
  .dps .dps-nowrap { white-space: nowrap; }
  .dps thead th { background: #eee; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .dps tr { break-inside: avoid; }
  .dps .dps-group td { background: #f3f3f3; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .dps .dps-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 7.5pt; }
  .dps .dps-state { font-weight: 700; }
  .dps .dps-check { white-space: nowrap; font-size: 10pt; }
  .dps .dps-sign { display: inline-block; width: 70%; border-bottom: 0.6pt solid #666; vertical-align: -2pt; }
  .dps .dps-signoff { margin-top: 12pt; }
  .dps .dps-signoff th { width: 10%; background: #eee; }
  .dps .dps-signoff td { width: 23%; height: 22pt; }
  .dps .dps-key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 7pt; color: #444; }
  .dps .dps-head { display: flex; justify-content: space-between; gap: 12pt; border-bottom: 1.2pt solid #111; padding-bottom: 6pt; margin-bottom: 8pt; }
  .dps h1 { font-size: 15pt; font-weight: 800; margin: 0 0 3pt; }
  .dps h2 { font-size: 10.5pt; font-weight: 800; margin: 10pt 0 4pt; }
  .dps .dps-box { border: 0.8pt solid #111; padding: 6pt 8pt; margin: 6pt 0; break-inside: avoid; }
  .dps .dps-note { font-size: 7.5pt; color: #333; }
  .dps.dps-land { page: dps-land; }
  .dps-raw { display: block; page: dps; color: #111; }
  .dps .dps-kv th { width: 18%; background: #eee; text-align: left; }
  .dps .dps-pre { white-space: pre-wrap; }
  .dps .dps-unissued { display: inline-block; border: 1.5pt solid #111; padding: 2pt 8pt; margin-top: 4pt; font-size: 11pt; font-weight: 800; letter-spacing: 0.5pt; }
}
@page dps { size: A4; margin: 12mm 10mm 30mm; }
@page dps-land { size: A4 landscape; margin: 10mm 10mm 28mm; }
`;

export function PrintPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="doc-print-root">
      <style>{PRINT_CSS}</style>
      {children}
    </div>,
    document.body,
  );
}


/**
 * 🔴 쪽마다 QR(2026-10-12 사용자 "페이지마다 보안 인증해야 하니 QR코드 명시").
 *  · @page 여백 상자에 그린다 — 오른쪽 아래 문서 QR, 왼쪽 아래 문서 코드·sha256 앞 16자·쪽 n / N
 *  · 본문과 겹치지 않는다(position:fixed 는 크롬 인쇄에서 본문 위에 겹치거나 엉뚱한 자리에 찍혔다)
 *  · 여백 상자 위쪽(본문 쪽)에 붙인다 — 종이 끝은 프린터가 못 찍는 자리라 QR 이 잘린다
 *  · 한 장만 빠져 나가도 그 장에서 어느 문서·어느 판인지 확인한다 · QR 은 모든 쪽이 같다(문서 단위) — 쪽 번호는 글자로
 *  · 생성 실패를 숨기지 않는다 — QR 자리에 "QR 생성 실패"
 */
export function PageQr({ code, payload, hash, url: verifyUrl, unissued }: {
  code: string; payload: Record<string, unknown>;
  /** undefined = 해시가 없는 양식(진단서 등) — 해시 칸을 적지 않는다 */
  hash?: { doc: string | null } | null;
  /** 🔴 발급 원장에 올라간 문서 — QR 에 JSON 대신 **진위확인 주소**(확인 코드 포함)를 싣는다(2026-10-12 기획 P0-6) */
  url?: string;
  /** QR 을 싣지 않는다 — true 미발급 미리보기 · 문자열은 그 자리에 적을 사유(발급 대상 아님·원장 미등재) */
  unissued?: boolean | string;
}) {
  const tAttr = useTAttr();
  const value = verifyUrl ?? JSON.stringify(hash === undefined ? payload : { ...payload, sha256: hash?.doc ?? null });
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null); setFailed(false);
    if (unissued) return () => { alive = false; };
    qrDataUrl(value, 72, 1).then((u) => { if (!alive) return; if (u) setUrl(u); else setFailed(true); });
    return () => { alive = false; };
  }, [value, unissued]);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const left = hash === undefined
    ? `${code} · ${tAttr('쪽')} `
    : `${code} · sha256 ${hash?.doc ? hash.doc.slice(0, 16) : tAttr('계산 불가')} · ${tAttr('쪽')} `;
  const right = unissued ? `"${esc(tAttr(typeof unissued === 'string' ? unissued : '미발급 — 진위확인 불가'))}"` : url ? `url(${url})` : `"${esc(tAttr(failed ? 'QR 생성 실패' : 'QR 생성 중'))}"`;
  const box = (name: string) =>
    `@page ${name} { @bottom-left { content: "${esc(left)}" counter(page) " / " counter(pages); font-size: 7pt; color: #333; vertical-align: top; padding-top: 3mm; } @bottom-right { content: ${right}; vertical-align: top; padding-top: 2mm; font-size: 7pt; } }`;
  return <style data-print-page-qr={unissued ? 'none' : url ? 'ready' : failed ? 'failed' : 'pending'}>{box('dps') + box('dps-land')}</style>;
}

/**
 * 자체 양식이 있는 문서(진단서 등 PrintLayout) — 양식은 그대로, 인쇄 루트·쪽 규격만 맡는다.
 */
export function PrintRaw({ children, attr }: { children: React.ReactNode; attr: string }) {
  // 🔴 (2026-10-12 기획 P1) 이 양식(진단서 등 빠른 인쇄)은 발급 원장에 오르지 않는다 — 대조할 곳 없는 QR 을 싣지 않고 그 사실을 적는다.
  //    발급이 필요한 서식은 서류 발급 경로(발급번호·진위확인 QR)를 쓴다.
  return (
    <PrintPortal>
      <div className="dps-raw" data-print-doc={attr}>{children}</div>
      <PageQr code={attr} payload={{}} unissued={UNISSUED_PRINT_TEXT.PENDING_D2} />
    </PrintPortal>
  );
}

/**
 * 인쇄 문서 틀 — 머리(종류·문서 코드·제목·부제·식별 줄·QR·sha256) + 본문 + 범례 + 서명란.
 * `qr` 에는 PHI 를 넣지 않는다(종류·버전·식별 id·시각·해시만 · QR 은 브라우저 안에서 만든다).
 */
/**
 * 발급 상태 — 인쇄본 진위를 무엇으로 확인하는가(2026-10-12 기획 P1).
 *  · `issued` 서버 발급 — 쪽 QR = 진위확인 주소 · 쪽 글자 = 발급번호
 *  · `'PREVIEW'` 발급 실패 뒤 미발급 미리보기 · `'NOT_ISSUED'` 발급 대상 아님 · `'PENDING_D2'` 환자 정보 인쇄본(원장 미등재)
 *    — 셋 다 QR 을 싣지 않는다(🔴 대조할 곳이 없는 QR 은 인증인 척이다 · G4)
 */
export type PrintIssueState = { issued?: IssuedPrint | null; unissued?: 'PREVIEW' | UnissuedPrintReason | null };
const unissuedText = (u: PrintIssueState['unissued']) => (!u ? null : u === 'PREVIEW' ? '미발급 — 진위확인 불가' : UNISSUED_PRINT_TEXT[u]);

/** 머리의 발급 표시 — 발급번호·진위확인 주소 / 미발급 사유 */
export function IssueMark({ issued, unissued }: PrintIssueState) {
  if (issued) return <p className="dps-mono" data-print-issue-no>{issued.issueNo} · <T k="진위확인" /> {issued.verifyUrl}</p>;
  const t = unissuedText(unissued);
  if (t) return <p className="dps-unissued" data-print-unissued={unissued!}><T k={t} /></p>;
  return null;
}

/** 범례 끝 진위 문구 — 발급 상태에 맞춰 한 곳에서(문서마다 "QR·sha256 으로 확인"을 따로 적으면 사실과 갈라진다) */
function AuthLine({ issued, unissued }: PrintIssueState) {
  if (issued) return <T k="문서 진위는 각 쪽 오른쪽 아래 QR(진위확인 주소)·발급번호로 확인합니다." />;
  if (unissued) return <T k="이 인쇄본은 발급 원장에 올라가지 않았습니다 — QR 이 없고 진위확인을 할 수 없습니다." />;
  return <T k="문서 진위는 각 쪽 오른쪽 아래 QR·sha256 으로 확인합니다." />;
}

export function PrintDoc({ kind, code, title, subtitle, idLine, qr, hash, landscape, legend, signOff = true, children, attr, issued, unissued }: {
  kind: React.ReactNode; code: string; title: React.ReactNode; subtitle?: React.ReactNode; idLine?: React.ReactNode;
  qr: Record<string, unknown>; hash: { doc: string | null } | null; landscape?: boolean; legend?: React.ReactNode; signOff?: boolean;
  children: React.ReactNode; attr: string;
} & PrintIssueState) {
  const u = unissuedText(unissued);
  return (
    <PrintPortal>
      <div className={`dps${landscape ? ' dps-land' : ''}`} data-print-doc={attr}>
        <div className="dps-head">
          <div>
            <p className="dps-note">{kind} · {code}</p>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
            {idLine && <p className="dps-key">{idLine}</p>}
            <p className="dps-key" data-print-doc-hash>sha256 {hash?.doc ?? <T k="계산 불가" />}</p>
            <IssueMark issued={issued} unissued={unissued} />
          </div>
        </div>
        <PageQr code={issued?.issueNo ?? code} payload={qr} hash={issued ? { doc: issued.hash } : hash} url={issued?.verifyUrl} unissued={u ?? undefined} />
        {children}
        <p className="dps-note" style={{ marginTop: '6pt' }} data-print-legend>{legend}{legend ? ' · ' : null}<AuthLine issued={issued} unissued={unissued} /></p>
        {signOff && <SignOff />}
      </div>
    </PrintPortal>
  );
}
