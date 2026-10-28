'use client';

import { useMemo } from 'react';
import { DECISION_DOMAINS, decisionSubdomainOf, decisionSubdomainMeta, decisionPrintCanonLine, decisionPrintStateOf, sortDecisionsForRegister, type DecisionPrintState } from '@hospital-run/shared';
import { PrintPortal, PageQr, useDocHash as useDocHashText, CheckCell, SignOff, breakKey, IssueMark, type PrintIssueState } from '@/components/print/PrintSheet';
import { KDate } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';
import type { DecisionItem } from './types';
import { LAYER_TITLE_SHORT } from './types';

/**
 * 결정 인쇄본 — 2026-10-12 사용자 "인쇄 시에는 의사결정 표시가 명확한 구조로 만들어서, 다시 인식할 수 있는 형태로 구성".
 *
 * 🔴 종전 인쇄는 빈 종이였다 — 공용 문서 CSS 가 인쇄 때 body 의 직계 자식을 모두 숨겼고 이 화면은 인쇄 루트가 없었다.
 *    화면을 그대로 찍지 않고 **인쇄 전용 문서**를 body 직하(.doc-print-root)에 그린다.
 *
 * "다시 인식할 수 있는 형태":
 *  · 결정마다 **결정 키**(등록부 정본 식별자)와 **상태 코드**(REAL·SEED·OPEN)·**선택 값 코드**를 사람 글자와 함께 찍는다
 *    — 라벨이 바뀌거나 번역돼도 키·코드로 원장과 다시 맞출 수 있다
 *  · 행마다 **사람 확인 칸**(☐·서명) — 2026-10-12 사용자 결정: 행별 기계 코드(sha256 앞 8자리)는 사람이 보기에 부적합 → 검토자가 직접 체크·서명
 *    · 문서 끝 검토자·서명·일자 서명란
 *  · 문서 전체 **sha256 + QR**(종류·버전·기준 시각·건수·해시) — 어느 시점 무엇을 찍은 것인지 기계로 읽는다
 *  · 🔴 개발 시드는 실결정이 아니다 — 상태 칸이 SEED 로 따로 찍힌다(섞지 않는다)
 */

export type { DecisionPrintState };
export const PRINT_STATE_LABEL: Record<DecisionPrintState, string> = { REAL: '실결정', SEED: '개발 시드(실결정 아님)', OPEN: '미결' };
/** 표 칸용 짧은 라벨 — 긴 라벨이 옆 칸을 덮었다(2026-10-12 사용자 인쇄본). 뜻은 범례·머리 수치에 적는다 */
export const PRINT_STATE_SHORT: Record<DecisionPrintState, string> = { REAL: '실결정', SEED: '시드', OPEN: '미결' };
export { breakKey };

export const printStateOf = (i: DecisionItem): DecisionPrintState => decisionPrintStateOf(i);

/** 행 정본 문자열 — 🔴 shared 정본(서버 발급 스냅샷과 같은 함수 · 바꾸면 발급 원장과 대조가 깨진다 · v1) */
export const printCanonLine = (i: DecisionItem): string => decisionPrintCanonLine(i);
/** 대장 정렬 — shared 정본(세부 분류 → 키 코드 포인트 순 · 서버와 같다) */
export const sortForRegister = (items: DecisionItem[]) => sortDecisionsForRegister(items);
/** 발급 요청 전에 화면이 그릴 줄 — 서버 해시와 대조한다 */
export const registerLines = (items: DecisionItem[]) => sortForRegister(items).map(printCanonLine);

type IssueProps = PrintIssueState;

/** 문서 해시 — 진위 확인은 문서 하나로(머리 QR·sha256) */
const useDocHash = (items: DecisionItem[]) => useDocHashText(useMemo(() => items.map(printCanonLine).join('\n'), [items]));


const choiceLabelOf = (d: DecisionItem) => (d.record ? d.options.find((o) => o.value === d.record!.choice)?.label ?? d.record.choice : null);
const subOf = (i: DecisionItem) => (i.domain ? decisionSubdomainOf(i.key, i.track, i.layer, i.domain) : null) ?? 'OTHER';

/** 결정 대장 인쇄본 — 영역 › 세부 분류 순 · 한 결정 한 줄 */
export function DecisionRegisterPrint({ items, measuredAt, issued, unissued }: { items: DecisionItem[]; measuredAt: string } & IssueProps) {
  const sorted = useMemo(() => sortForRegister(items), [items]);
  const h = useDocHash(sorted);
  const n = { REAL: 0, SEED: 0, OPEN: 0 } as Record<DecisionPrintState, number>;
  for (const i of sorted) n[printStateOf(i)]++;
  const qr = { t: 'HIS-DECISION-REGISTER', v: 1, at: measuredAt, n: sorted.length, real: n.REAL, seed: n.SEED, open: n.OPEN };
  let no = 0;
  let lastSub = '';
  return (
    <PrintPortal>
      <div className="dps" data-decision-print="REGISTER">
        <div className="dps-head">
          <div>
            <p className="dps-note"><T k="결정 대장" /> · HIS-DECISION-REGISTER v1</p>
            <h1><T k="중요 결정 — 현재 효력과 경과" /></h1>
            <p><T k="자료 기준 시각" /> <KDate value={measuredAt} mode="datetime" /> · <T k="결정 대상" /> {sorted.length} · <T k="실결정" /> {n.REAL} · <T k="개발 시드(실결정 아님)" /> {n.SEED} · <T k="미결" /> {n.OPEN}</p>
            <p className="dps-mono" data-print-doc-hash>sha256 {h?.doc ?? <T k="계산 불가" />}</p>
            <IssueMark issued={issued} unissued={unissued} />
          </div>
        </div>
        <PageQr code={issued?.issueNo ?? 'HIS-DECISION-REGISTER v1'} payload={qr} hash={h} url={issued?.verifyUrl} unissued={unissued ? '미발급 — 진위확인 불가' : undefined} />
        <table>
          <colgroup><col style={{ width: '4%' }} /><col style={{ width: '41%' }} /><col style={{ width: '8%' }} /><col style={{ width: '27%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /></colgroup>
          <thead><tr>
            <th>No</th><th><T k="결정 사항" /> · <T k="결정 키" /></th><th><T k="상태" /></th><th><T k="선택(값 코드)" /></th><th><T k="결정일" /></th><th><T k="확인" /></th>
          </tr></thead>
          <tbody>
            {sorted.map((d) => {
              const sub = subOf(d);
              const st = printStateOf(d);
              const head = sub !== lastSub;
              lastSub = sub;
              const dom = d.domain ? DECISION_DOMAINS.find((x) => x.key === d.domain)?.label : null;
              const cl = choiceLabelOf(d);
              no++;
              return [
                head && (
                  <tr key={`g:${sub}`} className="dps-group" data-print-group={sub}>
                    <td colSpan={7}>{dom ? <T k={dom} /> : <T k="기타" />} › {decisionSubdomainMeta(sub) ? <T k={decisionSubdomainMeta(sub)!.label} /> : <T k="기타" />}</td>
                  </tr>
                ),
                <tr key={d.key} data-print-row={d.key} data-print-state={st}>
                  <td className="dps-mono">{no}</td>
                  <td>{d.title.replace(/\*\*/g, '')}<br /><span className="dps-key">{breakKey(d.key)}</span> <span className="dps-note">· <T k={LAYER_TITLE_SHORT[d.layer]} /></span></td>
                  <td className="dps-state">{st}<br /><span className="dps-note"><T k={PRINT_STATE_SHORT[st]} /></span></td>
                  <td>{cl ?? '—'}{d.record && <><br /><span className="dps-key">[{breakKey(d.record.choice)}]</span></>}</td>
                  <td className="dps-nowrap">{d.record ? <KDate value={d.record.decidedAt} mode="date" /> : '—'}</td>
                  <td data-print-check><CheckCell /></td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
        <p className="dps-note" style={{ marginTop: '6pt' }}>
          <T k="상태 코드: REAL 실결정 · SEED 개발 시드(실결정 아님) · OPEN 미결 · 확인 칸은 검토자가 직접 체크·서명합니다 · 문서 진위는 각 쪽 오른쪽 아래 QR(진위확인 주소)·발급번호로 확인합니다." />
        </p>
        <SignOff />
      </div>
    </PrintPortal>
  );
}

/** 결정 문서 인쇄본 — 한 결정의 의사결정서(선택지 전체 ☑/☐ · 값 코드) */
export function DecisionDocPrint({ item, measuredAt, issued, unissued }: { item: DecisionItem; measuredAt: string } & IssueProps) {
  const one = useMemo(() => [item], [item]);
  const h = useDocHash(one);
  const st = printStateOf(item);
  const dom = item.domain ? DECISION_DOMAINS.find((x) => x.key === item.domain)?.label : null;
  const sub = decisionSubdomainMeta(subOf(item));
  const qr = { t: 'HIS-DECISION', v: 1, key: item.key, state: st, choice: item.record?.choice ?? null, decidedAt: item.record?.decidedAt ?? null, at: measuredAt };
  const strip = (t: string) => t.replace(/\*\*/g, '');
  return (
    <PrintPortal>
      <div className="dps" data-decision-print="DOC">
        <div className="dps-head">
          <div>
            <p className="dps-note"><T k="의사결정서" /> · HIS-DECISION v1 · {dom ? <T k={dom} /> : null}{sub ? <> › <T k={sub.label} /></> : null}</p>
            <h1>{strip(item.title)}</h1>
            <p className="dps-mono" data-print-key>{item.key}</p>
            <IssueMark issued={issued} unissued={unissued} />
          </div>
        </div>
        <PageQr code={issued?.issueNo ?? 'HIS-DECISION v1'} payload={qr} hash={h} url={issued?.verifyUrl} unissued={unissued ? '미발급 — 진위확인 불가' : undefined} />
        <table>
          <colgroup><col style={{ width: '22%' }} /><col style={{ width: '78%' }} /></colgroup>
          <tbody>
            <tr><th><T k="상태" /></th><td className="dps-state" data-print-state={st}>{st} — <T k={PRINT_STATE_LABEL[st]} /></td></tr>
            <tr><th><T k="결정 층" /></th><td><T k={LAYER_TITLE_SHORT[item.layer]} /> · {item.authority}</td></tr>
            <tr><th><T k="근거" /></th><td>{item.record?.legalReviewRef ?? '—'}</td></tr>
            <tr><th><T k="권한" /></th><td>{item.record?.authorityClaim ?? '—'}</td></tr>
            <tr><th><T k="결정 시각" /></th><td>{item.record ? <KDate value={item.record.decidedAt} mode="datetime" /> : '—'}</td></tr>
            <tr><th><T k="자료 기준 시각" /></th><td><KDate value={measuredAt} mode="datetime" /> · <span className="dps-key" data-print-doc-hash>sha256 {h?.doc ?? <T k="계산 불가" />}</span></td></tr>
          </tbody>
        </table>
        <h2><T k="선택지" /></h2>
        <table>
          <colgroup><col style={{ width: '6%' }} /><col style={{ width: '22%' }} /><col style={{ width: '72%' }} /></colgroup>
          <tbody>
            {item.options.map((o) => {
              const chosen = item.record?.choice === o.value;
              return (
                <tr key={o.value} data-print-option={o.value} data-print-chosen={chosen ? 'Y' : 'N'}>
                  <td style={{ textAlign: 'center', fontSize: '11pt' }}>{chosen ? '☑' : '☐'}</td>
                  <td><b>{o.label}</b><br /><span className="dps-mono">[{o.value}]</span></td>
                  <td>{strip(o.effect)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2><T k="현재 상황(의사결정 이전)" /></h2>
        <div className="dps-box">{strip(item.statusQuo)}</div>
        <h2><T k="왜 결정이 필요한가" /></h2>
        <div className="dps-box">{strip(item.why)}</div>
        <p className="dps-note">
          <T k="상태 코드: REAL 실결정 · SEED 개발 시드(실결정 아님) · OPEN 미결 · ☑ 고른 선택지 · 문서 진위는 각 쪽 오른쪽 아래 QR(진위확인 주소)·발급번호로 확인합니다." />
        </p>
        <SignOff />
      </div>
    </PrintPortal>
  );
}
