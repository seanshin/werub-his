'use client';

import { useMemo } from 'react';
import { T } from '@/components/ui/i18n-text';
import { PrintDoc, useDocHash } from '@/components/print/PrintSheet';
import type { ScreenEntry } from '@/components/layout/Sidebar';

/**
 * 단축키·화면번호 인쇄본(2026-10-12) — 화면의 3단 격자를 그대로 찍지 않고 **한 표**로(나란히 두면 칸이 좁아져 글자가 꺾인다).
 * 사람 확인이 필요한 행이 아니라 서명란은 두지 않는다. 목록은 사이드바 노출 기준이다(서버 권한과 다를 수 있다).
 */
export function ShortcutsPrint({ globalKeys, actionKeys, grouped, role, who }: {
  globalKeys: Array<[string, string]>; actionKeys: Array<[string, string]>;
  grouped: Array<[string, ScreenEntry[]]>; role: string; who: string;
}) {
  const at = useMemo(() => new Date().toISOString(), []);
  const count = grouped.reduce((n, [, l]) => n + l.length, 0);
  const text = useMemo(() => grouped.flatMap(([s, l]) => l.map((e) => `${s}|${e.code}|${e.href}`)).join('\n'), [grouped]);
  const hash = useDocHash(text);
  const keyTable = (title: string, rows: Array<[string, string]>, attr: string) => (
    <>
      <h2><T k={title} /></h2>
      <table data-print-keys={attr}>
        <colgroup><col style={{ width: '22%' }} /><col style={{ width: '78%' }} /></colgroup>
        <thead><tr><th><T k="단축키" /></th><th><T k="설명" /></th></tr></thead>
        <tbody>{rows.map(([k, d]) => <tr key={k} data-print-row={k}><td className="dps-mono dps-nowrap">{k}</td><td><T k={d} /></td></tr>)}</tbody>
      </table>
    </>
  );
  return (
    <PrintDoc attr="SHORTCUTS" kind={<T k="단축키 · 화면번호 치트시트" />} code="HIS-SHORTCUTS v1" signOff={false}
      title={<T k="단축키 · 화면번호 치트시트" />}
      subtitle={<>{who} · <T k="사이드바에 보이는 화면" /> {count}</>}
      qr={{ t: 'HIS-SHORTCUTS', v: 1, at, role, screens: count }}
      hash={hash} unissued="NOT_ISSUED"
      legend={<T k="화면번호로 이동: g → 번호 입력 → Enter. 이 목록은 사이드바 노출 기준이며, 화면 안의 기능별 권한은 서버(API)가 별도로 판단합니다." />}>
      {keyTable('전역 단축키', globalKeys, 'GLOBAL')}
      {keyTable('화면 내 액션 단축키', actionKeys, 'ACTION')}
      <h2><T k="화면번호" /> ({count})</h2>
      {count === 0 ? (
        <p data-print-screens-none><T k="현재 역할로 사이드바에 노출되는 화면이 없습니다." /></p>
      ) : (
        <table data-print-screens>
          <colgroup><col style={{ width: '12%' }} /><col style={{ width: '88%' }} /></colgroup>
          <thead><tr><th><T k="번호" /></th><th><T k="화면" /></th></tr></thead>
          <tbody>
            {grouped.flatMap(([section, list]) => [
              <tr key={`g:${section}`} className="dps-group" data-print-group={section}><td colSpan={2}><T k={section} /> <span className="dps-note">{list.length}</span></td></tr>,
              ...list.map((e) => <tr key={e.code} data-print-row={e.code}><td className="dps-mono dps-nowrap">{e.code}</td><td><T k={e.label} /></td></tr>),
            ])}
          </tbody>
        </table>
      )}
    </PrintDoc>
  );
}
