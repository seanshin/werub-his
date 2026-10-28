'use client';

/** 환자별 확인 사항 목록 — 매트릭스·환자 드릴다운이 같은 부품(정본 shared `patientOrderNotes` · 기록에서 규칙으로 센 사실) */
import { ORDER_NOTE_LABEL, type OrderNote } from '@hospital-run/shared';
import { Duration } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

const NOTE_TONE: Record<OrderNote['level'], { dot: string; text: string; icon: string }> = {
  URGENT: { dot: 'bg-rose-500', text: 'text-rose-800', icon: '●' },
  ATTENTION: { dot: 'bg-amber-400', text: 'text-amber-900', icon: '▲' },
  INFO: { dot: 'bg-gray-300', text: 'text-gray-600', icon: 'ⓘ' },
};

export function NotesList({ notes }: { notes: OrderNote[] }) {
  if (!notes.length) return <p className="text-[11px] text-gray-300" data-track-notes="none"><T k="확인 사항 없음" /></p>;
  return (
    <ul className="space-y-1" data-track-notes>
      {notes.map((n) => (
        <li key={n.code} className={`flex items-start gap-1.5 text-[11px] leading-snug ${NOTE_TONE[n.level].text}`} data-track-note={n.code}>
          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${NOTE_TONE[n.level].dot}`} aria-hidden />
          <span>
            <Tf k={ORDER_NOTE_LABEL[n.code]} params={{ 수: n.count }} />
            {n.minutes != null && <span className="text-gray-500"> · <T k="가장 오래" /> <Duration minutes={n.minutes} dense /></span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

