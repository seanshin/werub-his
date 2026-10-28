'use client';

import { useMemo } from 'react';
import { T } from '@/components/ui/i18n-text';
import { dutyRosterPrintLines } from '@hospital-run/shared';
import { PrintDoc, CheckCell, useDocHash, type PrintIssueState } from '@/components/print/PrintSheet';

/**
 * 당직표 인쇄본(2026-10-12) — 가로 A4 · 하루 한 줄(주간·저녁·심야·휴가·인력 미달) · 서명란.
 *  · 어느 탭에서 눌러도 당직표를 찍는다(인쇄 버튼은 머리에 하나)
 *  · 🔴 불러오는 중이면 빈 표가 아니라 "불러오는 중"을 찍는다(빈 표는 "배정 없음"으로 읽힌다)
 *  · 인력 미달은 짧은 글자 "D 필요2/실제1" · 날짜별 사람 확인 칸
 */
export interface DutyPrintShift { id: string; shift: string; staffName: string }
export interface DutyPrintDay { date: string; dayOfWeek: string; shifts: DutyPrintShift[]; leaves: { userId: string; name: string; type: string }[]; understaffed?: { shift: string; required: number; actual: number }[] }
const SHIFTS = ['DAY', 'EVENING', 'NIGHT'] as const;
const SHIFT_SHORT: Record<string, string> = { DAY: 'D', EVENING: 'E', NIGHT: 'N' };

export function DutyRosterPrint({ month, department, days, loading, leaveLabel, issued, unissued }: {
  month: string; department: string; days: DutyPrintDay[]; loading: boolean; leaveLabel: Record<string, string>;
} & PrintIssueState) {
  const at = useMemo(() => new Date().toISOString(), []);
  const sorted = useMemo(() => [...days].sort((a, b) => a.date.localeCompare(b.date)), [days]);
  const total = sorted.reduce((n, d) => n + d.shifts.length, 0);
  const short = sorted.filter((d) => (d.understaffed ?? []).some((u) => u.actual < u.required)).length;
  /** 정본 줄 — 🔴 shared 함수(서버 발급 스냅샷과 같다 · 배정 + 승인 휴가) */
  const text = useMemo(() => dutyRosterPrintLines(sorted).join('\n'), [sorted]);
  const hash = useDocHash(text);
  return (
    <PrintDoc attr="DUTY" landscape kind={<T k="당직·근무표" />} code="HIS-DUTY-ROSTER v1"
      title={<><T k="당직표" /> {month}</>}
      subtitle={<><T k="부서" /> {department} · <T k="배정" /> {total} · <T k="인력 미달 날" /> {short}</>}
      qr={{ t: 'HIS-DUTY-ROSTER', v: 1, at, month, department, days: sorted.length, entries: total }}
      hash={hash} issued={issued} unissued={unissued}
      legend={<T k="D 주간 · E 저녁 · N 심야 · 인력 미달은 근무별 필요/실제 인원 · 확인 칸은 부서장이 직접 체크·서명합니다" />}>
      {loading ? (
        <div className="dps-box" data-print-loading><T k="당직표를 아직 불러오는 중입니다 — 다 불러온 뒤 다시 인쇄하십시오." /></div>
      ) : sorted.length === 0 ? (
        <div className="dps-box" data-print-empty><T k="이 달·부서에 배정된 근무가 없습니다." /></div>
      ) : (
        <table data-print-roster>
          <colgroup><col style={{ width: '9%' }} /><col style={{ width: '4%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '12%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /></colgroup>
          <thead><tr>
            <th><T k="날짜" /></th><th><T k="요일" /></th><th>D <T k="주간" /></th><th>E <T k="저녁" /></th><th>N <T k="심야" /></th><th><T k="휴가" /></th><th><T k="인력 미달" /></th><th><T k="확인" /></th>
          </tr></thead>
          <tbody>
            {sorted.map((d) => {
              const under = (d.understaffed ?? []).filter((u) => u.actual < u.required);
              return (
                <tr key={d.date} data-print-row={d.date}>
                  <td className="dps-nowrap">{d.date}</td>
                  <td>{d.dayOfWeek}</td>
                  {SHIFTS.map((sh) => {
                    const names = d.shifts.filter((s) => s.shift === sh).map((s) => s.staffName);
                    return <td key={sh} data-print-shift={sh}>{names.length ? names.join(', ') : '—'}</td>;
                  })}
                  <td>{d.leaves.length ? d.leaves.map((l) => `${l.name}(${leaveLabel[l.type] ?? l.type})`).join(', ') : '—'}</td>
                  <td data-print-under>{under.length ? under.map((u) => `${SHIFT_SHORT[u.shift] ?? u.shift} ${u.actual}/${u.required}`).join(' · ') : '—'}</td>
                  <td data-print-check><CheckCell /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </PrintDoc>
  );
}
