'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { KDate, useDurationText } from '@/components/ui/display';

/**
 * 지연 **확인·조치 기록**.
 *
 * 🔴 관제는 지연을 보여줬지만 **무엇을 했는지 남는 자리가 없었다.** 같은 카드가 교대 내내
 *    빨갛게 떠 있고, 다음 근무자는 앞 사람이 이미 연락했는지 알 수 없었다.
 *
 * 🔴 **확인이 지연을 숨기지 않는다.** 카드는 그대로 지연이고 확인 사실이 덧붙는다 —
 *    숨기는 방향으로는 자동이 없다.
 * 🔴 **확인은 만료된다.** 그 지연을 판정한 임계와 같은 시간만 유효하다.
 * 🔴 **보기는 보기일 뿐이다.** 무엇을 적을지 어휘를 강제하지 않는다(자유 입력·비어 있으면 안 됨).
 */
const SUGGESTIONS = [
  '환자에게 연락함',
  '검사 결과 대기 중',
  '진료실에 전달함',
  '환자 자리 비움 — 재호출 예정',
  '보호자 동행 대기',
];

export function DelayAck({
  patientId,
  track,
  stage,
  flags,
  ack,
}: {
  patientId: string;
  track: string;
  stage: string;
  flags: string[];
  ack?: { note: string; ackedByName: string | null; ackedAt: string; expiresAt: string };
}) {
  const fmtDur = useDurationText();
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  if (flags.length === 0) return null;

  const submit = async () => {
    const text = note.trim();
    if (!text) return;
    setState('busy');
    setMsg(null);
    try {
      const r = await apiClient.post<{ data: { validForMinutes: number; notice: string } }>(
        '/api/v1/journey-console/ack',
        { patientId, track, stage, flags, note: text },
      );
      // 🔴 시간 표기는 표시 정본(`useDurationText`)을 통한다 — 화면마다 다른 규칙으로 그리면 갈라진다
      setMsg(`${r.data.notice} (${fmtDur(r.data.validForMinutes)} 뒤 다시 미확인으로 돌아옵니다)`);
      setNote('');
      setState('idle');
      qc.invalidateQueries({ queryKey: ['jc-board'] });
    } catch (e) {
      // 🔴 실패를 성공으로 접지 않는다 — 기록되지 않았는데 기록된 줄 알면 아무도 다시 하지 않는다
      setState('error');
      setMsg(e instanceof Error ? e.message : '확인 기록에 실패했습니다');
    }
  };

  return (
    <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-gray-700"><T k="지연 확인·조치" /></span>
        {ack && (
          <span className="text-[11px] text-sky-700">
            {ack.ackedByName ?? '누군가'} · <KDate value={ack.ackedAt} mode="time" /> <T k="확인" />
          </span>
        )}
      </div>

      {ack && (
        <div className="mb-2 rounded-lg bg-white px-2 py-1.5 text-[11px] text-gray-600">
          <div>{ack.note}</div>
          <div className="mt-0.5 text-gray-400">
            <KDate value={ack.expiresAt} mode="time" /> <T k="까지 유효 — 그 뒤에는 다시 미확인으로 뜹니다" />
          </div>
        </div>
      )}

      <div className="mb-1.5 flex flex-wrap gap-1">
        {SUGGESTIONS.map((sug) => (
          <button
            key={sug}
            type="button"
            onClick={() => setNote(sug)}
            className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:border-sky-300"
          >
            {sug}
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={300}
        placeholder={tAttr('무엇을 확인·조치했는지 (예: 환자에게 연락함)')}
        aria-label={tAttr('지연 확인 내용')}
        className="w-full resize-none rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-300"
      />
      <button
        type="button"
        onClick={submit}
        disabled={state === 'busy' || !note.trim()}
        className="mt-1.5 w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        <T k={state === 'busy' ? '기록 중…' : ack ? '다시 확인 기록' : '확인 기록'} />
      </button>
      {/* 🔴 확인해도 지연 표시는 그대로라는 것을 그 자리에서 말한다 */}
      <p className="mt-1 text-[11px] text-gray-400">
        <T k="확인을 기록해도" /> <b><T k="지연 표시는 사라지지 않습니다" /></b> <T k="— 조치가 끝나야 사라집니다." />
      </p>
      {msg && (
        <p className={`mt-1 text-[11px] ${state === 'error' ? 'text-rose-600' : 'text-sky-700'}`}>{msg}</p>
      )}
    </div>
  );
}
