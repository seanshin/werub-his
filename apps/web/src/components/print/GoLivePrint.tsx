'use client';

import { useMemo } from 'react';
import { RATIO_UNAVAILABLE, goLivePrintLines } from '@hospital-run/shared';
import { KDate } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';
import { PrintDoc, CheckCell, breakKey, useDocHash, type PrintIssueState } from '@/components/print/PrintSheet';
import type { GoLiveRollup } from '@/components/golive/GoLiveBriefing';
import type { DecisionItem } from '@/app/(main)/admin/decisions/types';

/**
 * 실서비스 개시 브리핑 인쇄본(2026-10-12) — 화면을 찍지 않고 회의용 문서로.
 *  · 준비도는 **두 근거를 갈라서**(시스템 확인 / 자가신고) · 분모가 비면 정본 문구(RATIO_UNAVAILABLE)
 *  · 개시를 막는 항목·필수 결정은 행마다 사람 확인 칸(☐·서명) — 행별 기계 코드는 넣지 않는다(사용자 결정)
 *  · 🔴 결정 등록부를 못 읽었으면 인쇄본에도 그렇게 적는다(필요한 결정이 없다는 뜻이 아니다)
 */
const DONE = new Set(['READY', 'DONE']);
const TYPE_KO: Record<string, string> = {
  CONFIG_GATE: '안전 게이트', APPROVAL: '승인', EXTERNAL: '외부 기관·업체',
  MANUAL: '수동 작업', HARDWARE: '하드웨어', SERVICE_FLAG: '개시 설정', DB_PROBE: 'DB 실측',
};
type DecState = 'REAL' | 'SEED' | 'OPEN';
const DEC_SHORT: Record<DecState, string> = { REAL: '실결정', SEED: '시드', OPEN: '미결' };
const decState = (d: DecisionItem): DecState => (d.decided ? 'REAL' : d.seeded ? 'SEED' : 'OPEN');

export function GoLivePrint({ rollup, decisions, decError, issued, unissued }: { rollup: GoLiveRollup; decisions: DecisionItem[] | undefined; decError: boolean } & PrintIssueState) {
  const r = rollup.readiness;
  const blocking = rollup.items.filter((i) => i.isBlocking && !DONE.has(i.status));
  const external = rollup.items.filter((i) => i.type === 'EXTERNAL' && !DONE.has(i.status));
  const required = (decisions ?? []).filter((d) => d.goLive === 'REQUIRED_BEFORE');
  const byOwner = [...blocking].sort((a, b) => (a.owner ?? '').localeCompare(b.owner ?? '', 'ko') || a.key.localeCompare(b.key));
  const at = useMemo(() => new Date().toISOString(), []);
  /** 정본 줄 — 🔴 shared 함수(서버 발급 스냅샷과 같다) */
  const text = useMemo(() => goLivePrintLines(rollup.items, decisions ?? []).join('\n'), [rollup.items, decisions]);
  const hash = useDocHash(text);
  return (
    <PrintDoc attr="GOLIVE" kind={<T k="실서비스 개시 브리핑" />} code="HIS-GOLIVE-BRIEFING v1"
      title={<T k="운영 전환 준비 현황" />}
      subtitle={<><T k="기준 시각" /> <KDate value={at} mode="datetime" /> · <T k="출처 go-live 레지스트리 · 결정 등록부" /></>}
      qr={{ t: 'HIS-GOLIVE-BRIEFING', v: 1, at, items: rollup.items.length, blocking: blocking.length, required: required.length }}
      hash={hash} issued={issued} unissued={unissued}
      legend={<T k="상태: 실결정 · 시드(개발 시드 — 실결정 아님) · 미결 · 확인 칸은 검토자가 직접 체크·서명합니다" />}>
      <h2>1. <T k="준비도 — 무엇을 근거로 센 숫자인가" /></h2>
      <table className="dps-kv" data-print-readiness>
        <tbody>
          {!r.computable || r.pct === null ? (
            <tr><th><T k="준비도" /></th><td><b>{RATIO_UNAVAILABLE}</b> — {r.basis}</td></tr>
          ) : (
            <>
              <tr><th><T k="개시 필수 항목" /></th><td>{r.ready} / {r.total} ({r.pct}%)</td></tr>
              <tr><th><T k="시스템이 직접 확인" /></th><td>{r.verifiedReady} / {r.total}</td></tr>
              <tr><th><T k="담당자 자가신고" /></th><td>{r.selfReportedReady} / {r.total} — <T k="시스템이 확인한 사실이 아닙니다" /></td></tr>
            </>
          )}
        </tbody>
      </table>

      <h2>2. <T k="개시를 막는 항목 — 누가 움직여야 하는가" /> ({blocking.length})</h2>
      {blocking.length === 0 ? (
        <p data-print-blocking-none><T k="개시를 막는 필수 항목이 없습니다" /> ({rollup.blockingReady}/{rollup.blockingTotal})</p>
      ) : (
        <table data-print-blocking>
          <colgroup><col style={{ width: '18%' }} /><col style={{ width: '44%' }} /><col style={{ width: '14%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /></colgroup>
          <thead><tr><th><T k="소관" /></th><th><T k="항목" /></th><th><T k="유형" /></th><th><T k="목표일" /></th><th><T k="확인" /></th></tr></thead>
          <tbody>
            {byOwner.map((i) => (
              <tr key={i.key} data-print-row={i.key}>
                <td>{i.owner?.trim() || <T k="(소관 미지정)" />}</td>
                <td>{i.title}{i.detail && <><br /><span className="dps-note">{i.detail}</span></>}<br /><span className="dps-key">{breakKey(i.key)}</span></td>
                <td><T k={TYPE_KO[i.type] ?? i.type} /></td>
                <td>{i.overdue ? <b><T k="경과" /></b> : '—'}</td>
                <td data-print-check><CheckCell /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>3. <T k="외부 기관·업체에 달린 것" /> ({external.length})</h2>
      {external.length === 0 ? (
        <p><T k="남아 있는 외부 의존 항목이 없습니다." /></p>
      ) : (
        <table data-print-external>
          <colgroup><col style={{ width: '62%' }} /><col style={{ width: '24%' }} /><col style={{ width: '14%' }} /></colgroup>
          <thead><tr><th><T k="항목" /></th><th><T k="소관" /></th><th><T k="확인" /></th></tr></thead>
          <tbody>
            {external.map((i) => (
              <tr key={i.key} data-print-row={i.key}>
                <td>{i.title}<br /><span className="dps-key">{breakKey(i.key)}</span></td>
                <td>{i.owner?.trim() || <T k="(소관 미지정)" />}</td>
                <td data-print-check><CheckCell /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>4. <T k="개시 전 반드시 필요한 사람 결정" /> ({decError ? '—' : required.length})</h2>
      {decError ? (
        <div className="dps-box" data-print-dec-error>
          <T k="결정 등록부를 불러오지 못했습니다 — 필요한 결정이 없다는 뜻이 아닙니다. 개시 판단 전에 반드시 다시 확인하십시오." />
        </div>
      ) : !decisions ? (
        <div className="dps-box" data-print-dec-loading><T k="결정 등록부를 아직 불러오는 중입니다 — 다 불러온 뒤 다시 인쇄하십시오." /></div>
      ) : required.length === 0 ? (
        <p><T k="개시 전 필수로 표시된 결정 항목이 없습니다." /></p>
      ) : (
        <table data-print-decisions>
          <colgroup><col style={{ width: '52%' }} /><col style={{ width: '10%' }} /><col style={{ width: '24%' }} /><col style={{ width: '14%' }} /></colgroup>
          <thead><tr><th><T k="결정 사항" /> · <T k="결정 키" /></th><th><T k="상태" /></th><th><T k="허가권" /></th><th><T k="확인" /></th></tr></thead>
          <tbody>
            {required.map((d) => {
              const st = decState(d);
              return (
                <tr key={d.key} data-print-row={d.key} data-print-state={st}>
                  <td>{d.title.replace(/\*\*/g, '')}<br /><span className="dps-key">{breakKey(d.key)}</span></td>
                  <td className="dps-state">{st}<br /><span className="dps-note"><T k={DEC_SHORT[st]} /></span></td>
                  <td>{d.authority}</td>
                  <td data-print-check><CheckCell /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="dps-box dps-note" data-print-caveat>
        <T k="이 문서는 레지스트리에 등재된 것만 셉니다 — 등재되지 않은 준비 사항은 여기 나오지 않습니다. 자가신고 항목은 시스템이 확인한 사실이 아닙니다. 운영 DB 는 현재 가상 병원 시드 데이터이며, 실환자 이관 전에는 모든 실측을 다시 확인해야 합니다." />
      </div>
    </PrintDoc>
  );
}
