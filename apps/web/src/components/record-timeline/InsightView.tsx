'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { ServerMessage } from '@hospital-run/shared';
import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { ServerText } from '@/components/ui/server-text';
import { TRACK_UI, type TrackType } from './record-card';

/**
 * 의미찾기 — 시간순 목록을 **의미 단위로 자동 배치**한 뷰.
 *
 * 시계열이 "언제 무엇이" 라면 여기는 "지금 확인할 것 · 진단이 어떻게 바뀌었나 · 약이 언제 달라졌나 ·
 * 수치가 좋아지나 · 마무리 안 된 것 · 이번 입원에 무슨 일이" 에 답한다.
 * 배치는 서버 규칙(record-insights)이 하고, 화면은 **왜 묶였는지**를 함께 보여준다.
 *
 * 🔴 서버 문장은 `*Msg`(키+값)를 `<ServerText>` 로 조립한다(2026-09-15 I3) — 종전 문자열(`label`·`detail`…)은
 *    구 응답·`*Msg` 없는 항목(ATTENTION 의 이슈 문구 · 진단명 같은 기록 값)의 폴백일 뿐이다.
 */
export interface InsightItemRef {
  type: string;
  id: string;
  at: string;
  label: string;
  detail?: string;
  labelMsg?: ServerMessage;
  detailMsg?: ServerMessage;
  level?: 'ALERT' | 'WARN' | 'NONE';
}

export interface InsightGroup {
  key: 'ATTENTION' | 'DIAGNOSIS' | 'MEDICATION' | 'TREND' | 'PENDING' | 'EPISODE';
  title: string;
  titleMsg?: ServerMessage;
  hint: string;
  hintMsg?: ServerMessage;
  note?: string;
  noteMsg?: ServerMessage;
  level: 'ALERT' | 'INFO';
  items: InsightItemRef[];
}

const GROUP_ICON: Record<InsightGroup['key'], string> = {
  ATTENTION: '❗',
  PENDING: '⏳',
  DIAGNOSIS: '🩺',
  MEDICATION: '💊',
  TREND: '📈',
  EPISODE: '🏥',
};

const LEVEL_RAIL: Record<string, string> = {
  ALERT: 'bg-rose-500',
  WARN: 'bg-amber-400',
  NONE: 'bg-gray-200',
};

const dayLabel = (iso: string) => {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '';
  }
};

export function InsightView({
  patientId,
  months,
  admissionId,
  onOpenDetail,
}: {
  patientId: string;
  months: number | null;
  admissionId?: string;
  /** 원본 기록 열기 — 시계열 카드와 같은 동선(별도 창) */
  onOpenDetail?: (ref: { type: string; id: string }) => void;
}) {
  const [groups, setGroups] = useState<InsightGroup[] | null>(null);
  const [meta, setMeta] = useState<{ itemCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const tAttr = useTAttr();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams();
    if (months) qs.set('from', new Date(Date.now() - months * 30 * 86400000).toISOString());
    if (admissionId) qs.set('admissionId', admissionId);
    apiClient
      .get<{ data: { groups: InsightGroup[]; itemCount: number } }>(
        `/api/v1/patients/${patientId}/record-timeline/insights?${qs.toString()}`,
      )
      .then((r) => {
        if (!alive) return;
        setGroups(r.data.groups ?? []);
        setMeta({ itemCount: r.data.itemCount ?? 0 });
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [patientId, months, admissionId]);

  if (loading) return <div className="py-6 text-sm text-gray-400"><T k="기록을 묶는 중…" /></div>;
  if (error) return <p className="py-6 text-sm text-rose-600"><T k="의미찾기를 불러오지 못했습니다." /></p>;
  if (!groups?.length) {
    return (
      <EmptyState
        icon="🔎"
        title="묶을 만한 기록이 아직 없습니다"
        hint="진단·처방·검사가 쌓이면 진단 경과·약물 변화·수치 추세로 자동 배치됩니다"
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-400">
        <Tf k="기록 {건수}건을 의미 단위로 자동 배치했습니다 — 근거가 없는 묶음은 만들지 않습니다." params={{ 건수: meta?.itemCount ?? 0 }} />
      </p>

      {/* 2열 배치: 좁으면 1열 — 묶음 수가 적을 때도 빈 칸이 크게 남지 않게 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groups.map((g) => (
          <section
            key={g.key}
            className={`rounded-xl border bg-white p-3 shadow-sm ${g.level === 'ALERT' ? 'border-rose-200' : 'border-gray-200/80'}`}
          >
            <header className="mb-2 flex items-baseline gap-2">
              <span aria-hidden>{GROUP_ICON[g.key]}</span>
              <h3 className="text-xs font-semibold text-gray-900"><ServerText msg={g.titleMsg} fallback={g.title} /></h3>
              {g.note && (
                <span className={`text-[10px] tabular-nums ${g.level === 'ALERT' ? 'font-semibold text-rose-600' : 'text-gray-400'}`}>
                  <ServerText msg={g.noteMsg} fallback={g.note} />
                </span>
              )}
              <span className="ml-auto text-[10px] tabular-nums text-gray-300">{g.items.length}</span>
            </header>

            {/* 왜 묶였는지 — 묶음의 판정 근거를 문장으로(강조만 하고 이유를 빼면 판단에 못 쓴다) */}
            <p className="mb-2 text-[10.5px] leading-relaxed text-gray-500"><ServerText msg={g.hintMsg} fallback={g.hint} /></p>

            <ul className="space-y-1">
              {g.items.slice(0, 8).map((it, i) => {
                const ui = TRACK_UI[it.type as TrackType];
                return (
                  <li key={`${it.type}-${it.id}-${i}`}>
                    <button
                      type="button"
                      onClick={() => onOpenDetail?.({ type: it.type, id: it.id })}
                      title={onOpenDetail ? tAttr('원본 기록 열기') : undefined}
                      className="group relative flex w-full items-baseline gap-2 rounded-lg py-1 pl-2.5 pr-1 text-left transition-colors hover:bg-gray-50"
                    >
                      <span className={`absolute inset-y-1 left-0 w-[3px] rounded-full ${LEVEL_RAIL[it.level ?? 'NONE']}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-gray-900"><ServerText msg={it.labelMsg} fallback={it.label} /></span>
                        {(it.detailMsg || it.detail) && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-500"><ServerText msg={it.detailMsg} fallback={it.detail} /></span>}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-gray-400">{dayLabel(it.at)}</span>
                      {ui && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ui.dot}`} title={tAttr(ui.label)} />}
                    </button>
                  </li>
                );
              })}
            </ul>

            {g.items.length > 8 && (
              <p className="mt-1.5 text-[10px] text-gray-400"><Tf k="외 {건수}건 — 기간을 좁히면 더 또렷해집니다" params={{ 건수: g.items.length - 8 }} /></p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
