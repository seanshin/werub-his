/**
 * 서류 한 건의 단계(2026-10-10) — 접수 → 작성·동결 → 발급 → 수령. 반려면 거기서 끝난다.
 * 🔴 상태 문자열만이 아니라 **원장에 남은 사실**(동결본·서명·발급번호·수령 시각)로 판정한다 — 상태만 보면 단계를 건너뛴 것처럼 보이는 행을 놓친다.
 */
export type StageState = 'DONE' | 'CURRENT' | 'TODO' | 'STOPPED';
export interface IssuanceStage { key: 'RECEIVED' | 'PREPARED' | 'ISSUED' | 'DELIVERED'; label: string; state: StageState }

export function issuanceStages(r: {
  status: string; issuedDocumentId?: string | null; deliveredAt?: string | null;
  artifacts?: Array<{ signedAt?: string | null }>; isCertificate: boolean;
}): { stages: IssuanceStage[]; rejected: boolean } {
  const rejected = r.status === 'REJECTED';
  const prepared = r.isCertificate ? !!r.artifacts?.some((a) => !!a.signedAt) : !!r.artifacts?.length;
  const issued = !!r.issuedDocumentId;
  const delivered = r.status === 'DELIVERED' || !!r.deliveredAt;
  const done = [true, prepared || issued, issued, delivered];
  const labels: Array<[IssuanceStage['key'], string]> = [
    ['RECEIVED', '접수'], ['PREPARED', r.isCertificate ? '작성·서명' : '기록 동결'], ['ISSUED', '발급'], ['DELIVERED', '수령'],
  ];
  const firstTodo = done.findIndex((d) => !d);
  return {
    rejected,
    stages: labels.map(([key, label], i) => ({
      key, label,
      state: done[i] ? 'DONE' : rejected ? (i === firstTodo ? 'STOPPED' : 'TODO') : i === firstTodo ? 'CURRENT' : 'TODO',
    })),
  };
}

/** CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 감싸고, 수식으로 읽힐 첫 글자(= + - @)는 앞에 ' 를 붙인다(CSV 주입 방지) */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
