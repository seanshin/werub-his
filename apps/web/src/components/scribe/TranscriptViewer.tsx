'use client';

import type { LabeledSegment, ScribeRole } from '@/lib/scribe-api';

const ROLE_META: Record<ScribeRole, { label: string; cls: string }> = {
  DOCTOR: { label: '의사', cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
  PATIENT: { label: '환자', cls: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300' },
  GUARDIAN: { label: '보호자', cls: 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300' },
  OTHER: { label: '기타', cls: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300' },
  UNKNOWN: { label: '미확정', cls: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400' },
};
const ROLES: ScribeRole[] = ['DOCTOR', 'PATIENT', 'GUARDIAN', 'OTHER'];

function ts(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 화자분리 전사 뷰어 — 역할 색 구분·✓(특정화자 인식 자동확정)·수동 라벨 확정(§8.2).
 * 자동 라벨은 보조이며 의사가 최종 확정(confident=false면 검토 유도).
 */
export default function TranscriptViewer({
  segments,
  onRelabel,
}: {
  segments: LabeledSegment[];
  onRelabel?: (index: number, role: ScribeRole) => void;
}) {
  if (!segments.length) {
    return <p className="text-xs text-neutral-500">전사가 아직 없습니다.</p>;
  }
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-neutral-200 p-2 text-sm dark:border-neutral-700">
      {segments.map((s, i) => {
        const meta = ROLE_META[s.role] ?? ROLE_META.UNKNOWN;
        return (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 font-mono text-[10px] text-neutral-400">{ts(s.start)}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}>
              {meta.label}
              {s.role === 'DOCTOR' && s.confident && <span title="특정화자 인식 자동확정"> ✓</span>}
            </span>
            <span className="flex-1 text-neutral-800 dark:text-neutral-200">{s.text}</span>
            {onRelabel && (
              <select
                aria-label="화자 라벨 수정"
                value={ROLES.includes(s.role) ? s.role : 'OTHER'}
                onChange={(e) => onRelabel(i, e.target.value as ScribeRole)}
                className="shrink-0 rounded border border-neutral-200 bg-transparent text-[11px] dark:border-neutral-700"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].label}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
