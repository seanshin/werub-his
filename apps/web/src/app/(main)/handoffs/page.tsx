'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { NewHandoffForm } from './new-handoff-form';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';
import { HANDOFF_ILLNESS_LABEL, handoffIllnessOf, type HandoffKind, type VitalSignKey } from '@hospital-run/shared';

/** 인계 시 활력 스냅샷이 싣는 항목 */
const SNAPSHOT_VITAL_KEYS: readonly VitalSignKey[] = ['spo2', 'systolicBp', 'heartRate', 'temperature'];

interface Handoff {
  id: string;
  type: string;
  illness?: string;
  summary: string;
  patientSummary?: string;
  actionList?: { action: string; status?: string; deadline?: string }[];
  situationAwareness?: string;
  synthesis?: string;
  vitalSigns?: Record<string, number>;
  pendingItems?: { item: string; status?: string }[];
  acknowledgedAt?: string | null;
  /** 관리자 대리 확인(true) · 본인(false) · 모름(null — 확인자 기록 전 확인분) — 2026-10-26 서버 판정 */
  acknowledgedByProxy?: boolean | null;
  /** 인계 종류 판정(종류 + 보낸 사람 직종 · shared handoffKindOf) */
  kind?: HandoffKind;
  createdAt: string;
  // 🔴 서버가 관계를 include 하지 않으면 이 필드들이 통째로 없다 — 실제로 `toDoctor` 누락으로
  //    화면이 크래시했다(2026-08-12). **인계는 안전 화면이라 한 건의 결손이 전체를 죽이면 안 된다.**
  patient?: { id?: string; familyName?: string; givenName?: string; mrn?: string } | null;
  fromDoctor?: { familyName?: string; givenName?: string; department?: string } | null;
  toDoctor?: { familyName?: string; givenName?: string; department?: string } | null;
  admission?: { id: string; admitReason?: string };
}

// 라벨은 shared `HANDOFF_ILLNESS_LABEL` 정본(어휘·이름을 이 화면이 따로 갖지 않는다) — 여기는 색만
const ILLNESS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  CRITICAL: { label: HANDOFF_ILLNESS_LABEL.CRITICAL, color: 'text-red-700 bg-red-100', dot: 'bg-red-500' },
  UNSTABLE: { label: HANDOFF_ILLNESS_LABEL.UNSTABLE, color: 'text-orange-700 bg-orange-100', dot: 'bg-orange-400' },
  STABLE:   { label: HANDOFF_ILLNESS_LABEL.STABLE, color: 'text-green-700 bg-green-100', dot: 'bg-green-400' },
};

/**
 * 🔴 중증도가 없으면 '안정'이라고 말하지 않는다 — 미기재를 **가장 안전한 값**으로 표시하는 것은
 *    화면이 실제보다 안전하게 말하는 것이다(P1·P17). 종전 `ILLNESS_CONFIG[h.illness || 'STABLE']`
 *    때문에, DTO 가 값을 지워 NULL 로 저장된 인계까지 초록 '안정' 배지를 달고 있었다.
 */
const ILLNESS_UNKNOWN = { label: '중증도 미기재', color: 'text-gray-600 bg-gray-100', dot: 'bg-gray-400' };
/**
 * 🔴 (2026-10-04) 어휘 밖 저장값(시드의 '위중'·'주의' 등)을 "중증도 미기재"로 그렸다 — 적힌 값을 없다고 말한 것.
 *    어휘 밖이면 원문 그대로 + '어휘 밖'(지어낸 코드로 바꾸지 않는다).
 */
const illnessConfig = (v?: string) => {
  const iv = handoffIllnessOf(v);
  if (iv.code) return ILLNESS_CONFIG[iv.code];
  if (iv.offVocab) return { label: `${iv.raw} · 어휘 밖`, color: 'text-gray-700 bg-gray-100', dot: 'bg-gray-400' };
  return ILLNESS_UNKNOWN;
};

/**
 * 관계가 비어도 화면이 살아 있게 — 이름이 없으면 '(미지정)' 이라고 말한다.
 * 🔴 `toDoctor` 를 서버가 include 하지 않아 인수인계 화면이 통째로 크래시했다(2026-08-12).
 *    **인계는 안전 화면이라 한 건의 데이터 결손이 전체를 죽이면 안 된다.**
 */
function who(u?: { familyName?: string; givenName?: string } | null): string {
  return `${u?.familyName ?? ''}${u?.givenName ?? ''}`.trim() || '(미지정)';
}

export default function HandoffsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const { data: pendingData, isLoading: pendingLoading, isError, error, refetch } = useQuery({
    queryKey: ['handoffs-pending'],
    queryFn: () => apiClient.get<{ data: Handoff[] }>('/api/v1/handoffs/pending'),
    refetchInterval: pollMs('fast'),
  });

  const { data: recentData } = useQuery({
    queryKey: ['handoffs-recent'],
    queryFn: () => apiClient.get<{ data: Handoff[] }>('/api/v1/handoffs?limit=20'),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/handoffs/${id}/acknowledge`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['handoffs-pending'] });
      qc.invalidateQueries({ queryKey: ['handoffs-recent'] });
      toast.success('인수인계 확인 완료');
    },
    onError: () => toast.error('확인 실패'),
  });

  const rawPending = pendingData?.data;
  const pending: Handoff[] = Array.isArray(rawPending) ? rawPending : (rawPending as any)?.data ?? [];
  const rawRecent = recentData?.data;
  const recent: Handoff[] = Array.isArray(rawRecent) ? rawRecent : (rawRecent as any)?.data ?? [];
  const handoffs = tab === 'pending' ? pending.filter(h => !h.acknowledgedAt) : recent;
  const selected = handoffs.find(h => h.id === selectedId) || null;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← <T k="대시보드" /></Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1"><T k="인수인계 (I-PASS)" /></h1>
        </div>
        <div className="flex items-center gap-2">
          {/* 🔴 서버 `POST /handoffs` 는 있는데 이 화면은 확인만 할 수 있었다(사람 신고) */}
          <NewHandoffForm />
          <button onClick={() => setTab('pending')} className={`px-3 py-1.5 text-xs font-medium rounded-full ${tab === 'pending' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k="미확인" /> {pending.filter(h => !h.acknowledgedAt).length > 0 && `(${pending.filter(h => !h.acknowledgedAt).length})`}
          </button>
          <button onClick={() => setTab('all')} className={`px-3 py-1.5 text-xs font-medium rounded-full ${tab === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k="전체 이력" /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 목록 */}
        <div className="lg:col-span-2 space-y-2">
          {pendingLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : handoffs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-3xl mb-2">✓</p>
              <p><T k="대기 중인 인수인계가 없습니다" /></p>
            </div>
          ) : (
            handoffs.map(h => {
              const illCfg = illnessConfig(h.illness);
              return (
                <button
                  key={h.id}
                  onClick={() => setSelectedId(h.id)}
                  className={`w-full text-left p-3 rounded-xl border transition ${selectedId === h.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${illCfg.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${illCfg.dot}`} />{illCfg.label}
                      </span>
                      <span className="text-sm font-bold text-gray-900">{who(h.patient)}</span>
                    </div>
                    {!h.acknowledgedAt && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    {who(h.fromDoctor)} → {who(h.toDoctor)}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {kdate(h.createdAt, 'datetimeShort')}
                  </p>
                </button>
              );
            })
          )}
        </div>

        {/* I-PASS 상세 */}
        <div className="lg:col-span-3">
          {selected ? (
            <HandoffDetail handoff={selected} onAcknowledge={() => acknowledge.mutate(selected.id)} isPending={acknowledge.isPending} />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm"><T k="좌측에서 인수인계를 선택하세요" /></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HandoffDetail({ handoff: h, onAcknowledge, isPending }: { handoff: Handoff; onAcknowledge: () => void; isPending: boolean }) {
  const illCfg = illnessConfig(h.illness);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gray-50 px-5 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">{who(h.patient)}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {who(h.fromDoctor)} ({h.fromDoctor?.department || '당직'}) → {who(h.toDoctor)} ({h.toDoctor?.department || '주치의'})
            </p>
          </div>
          <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full ${illCfg.color}`}>
            <span className={`w-2 h-2 rounded-full ${illCfg.dot}`} />{illCfg.label}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">
          {kdate(h.createdAt, 'datetime')}
        </p>
      </div>

      {/* I-PASS 구조 */}
      <div className="p-5 space-y-4">
        {/* I - 중증도 */}
        <IPassSection letter="I" title={<T k="중증도 (Illness Severity)" />} color="text-red-600">
          <span className={`inline-flex items-center gap-1 text-sm font-bold px-3 py-1 rounded-full ${illCfg.color}`}>
            {illCfg.label}
          </span>
        </IPassSection>

        {/* P - 환자 요약 */}
        <IPassSection letter="P" title={<T k="환자 요약 (Patient Summary)" />} color="text-blue-600">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{h.patientSummary || h.summary || '-'}</p>
        </IPassSection>

        {/* A - 조치 목록 */}
        <IPassSection letter="A" title={<T k="조치 목록 (Action List)" />} color="text-emerald-600">
          {h.actionList && h.actionList.length > 0 ? (
            <ul className="space-y-1.5">
              {h.actionList.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold ${item.status === 'DONE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {item.status === 'DONE' ? '✓' : '☐'}
                  </span>
                  <span>{item.action}</span>
                  {item.deadline && <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">{item.deadline}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">-</p>
          )}
        </IPassSection>

        {/* S - 상황 인식 */}
        <IPassSection letter="S" title={<T k="상황 인식 (Situation Awareness)" />} color="text-amber-600">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{h.situationAwareness || '-'}</p>
        </IPassSection>

        {/* S - 종합 */}
        <IPassSection letter="S" title={<T k="종합 (Synthesis)" />} color="text-purple-600">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{h.synthesis || '-'}</p>
        </IPassSection>

        {/* 바이탈 */}
        {h.vitalSigns && Object.keys(h.vitalSigns).length > 0 && (
          <div className="bg-blue-50 rounded-xl p-3">
            <span className="text-[10px] font-bold text-blue-600 block mb-1"><T k="인계 시 바이탈" /></span>
            {/* 미측정 '—'(측정된 0 을 숨기던 truthy 검사·이완기 없을 때 "120/undefined" 회수) · 인계 스냅샷이 싣는 항목만 */}
            <VitalSignsStrip vitals={h.vitalSigns as Record<string, unknown>} keys={SNAPSHOT_VITAL_KEYS} className="text-gray-700" />
          </div>
        )}
      </div>

      {/* 하단 액션 */}
      <div className="px-5 py-4 border-t bg-gray-50">
        {h.acknowledgedAt ? (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium"><T k="확인 완료" /></span>
            <span className="text-xs text-gray-400">{kdate(h.acknowledgedAt, 'datetimeSec')}</span>
            {/* 🔴 관리자가 대신 확인한 것을 인수자 본인 확인처럼 그리지 않는다 */}
            {h.acknowledgedByProxy === true && <span className="text-xs font-semibold text-amber-700" data-handoff-ack-proxy><T k="관리자 대리 확인" /></span>}
          </div>
        ) : (
          <button
            onClick={onAcknowledge}
            disabled={isPending}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {isPending ? <T k="처리 중..." /> : <T k="인계 확인 완료 ✓" />}
          </button>
        )}
      </div>
    </div>
  );
}

function IPassSection({ letter, title, color, children }: { letter: string; title: React.ReactNode; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${color} bg-gray-100`}>{letter}</span>
        <span className="text-xs font-bold text-gray-600">{title}</span>
      </div>
      <div className="pl-8">{children}</div>
    </div>
  );
}
