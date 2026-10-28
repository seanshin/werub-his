'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';
import { KDate, EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { QuickVitalsModal, QuickNursingNoteModal } from './QuickClinicalEntry';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 임상 참조 레일 — 환자 상세의 우측 여백 활용(2026-08-03 제보 → 08-04 전 역할 일반화).
 *
 * 본문(max-w-5xl·가독 폭 유지) 오른쪽 빈 기둥에, **역할이 어느 탭에서든 곁눈으로 확인하는 것**을
 * 상주시킨다. 카드 구성은 서버 실권한과 1:1 — 활력 조회는 DOCTOR/NURSE/ADMIN 만이라
 * 약사·임상병리사 레일에 넣으면 403 이 뜬다(역할별 카드가 다른 이유).
 *
 *  - NURSE: 빠른 작성(활력·간호기록) + 알레르기 + 최근 활력 + 최근 간호기록
 *  - DOCTOR/ADMIN: 알레르기 + 최근 활력 + 활성 처방
 *  - PHARMACIST: 알레르기 + 활성 약처방(용량·용법)
 *  - LAB_TECH: 알레르기 + 최근 검사 이상치
 *
 * 초광폭(1600px+)에서만 — 좁은 화면에선 본문을 침범하지 않는 게 우선.
 */
interface VitalRow {
  id: string;
  /** 서버 정본 시각 필드 — PreVisitVitals.measuredAt (recordedAt 아님·브라우저 실측으로 발견) */
  measuredAt?: string;
  recordedAt?: string;
  createdAt?: string;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  spo2?: number | null;
}
interface NoteRow {
  id: string;
  createdAt: string;
  recordedAt?: string;
  noteType?: string;
  content?: string | null;
  assessment?: string | null;
}
interface RxRow {
  id: string;
  type?: string;
  dosage?: string | null;
  frequency?: string | null;
  instructions?: string | null;
  createdAt?: string;
  medicationCode?: { nameKo?: string } | null;
  procedureCode?: { nameKo?: string } | null;
}
interface LabResultRow {
  id: string;
  completedAt?: string | null;
  createdAt?: string;
  items?: { testName: string; value: string; unit: string; flag?: string | null }[];
}

const CARD = 'rounded-2xl border border-gray-100 bg-white shadow-sm p-3';
const CARD_TITLE = 'text-[11px] font-bold text-gray-500 mb-2';
const ROW = 'mb-2 last:mb-0 border-b border-gray-50 last:border-0 pb-2 last:pb-0';

export function ClinicalSideRail({ patientId, allergies, role }: {
  patientId: string;
  allergies: string[];
  role: string;
}) {
  const tAttr = useTAttr();
  const [showVitals, setShowVitals] = useState(false);
  const [showNote, setShowNote] = useState(false);

  const canSeeVitals = role === 'NURSE' || role === 'DOCTOR' || role === 'ADMIN';
  const canSeeRx = role !== 'LAB_TECH'; // active rx EP 는 LAB_TECH 미허용
  const isNurse = role === 'NURSE';
  const isLab = role === 'LAB_TECH';
  const wantRx = role === 'PHARMACIST' || role === 'DOCTOR' || role === 'ADMIN';

  const vitalsQ = useQuery({
    queryKey: ['rail-vitals', patientId],
    queryFn: () => apiClient.get<{ data: VitalRow[] }>(`/api/v1/vitals`, { patientId, limit: '3' }),
    enabled: canSeeVitals,
    staleTime: 30_000,
  });
  const notesQ = useQuery({
    queryKey: ['rail-nursing-notes', patientId],
    queryFn: () => apiClient.get<{ data: NoteRow[] }>(`/api/v1/nursing-notes`, { patientId }),
    enabled: isNurse,
    staleTime: 30_000,
  });
  const rxQ = useQuery({
    queryKey: ['rail-active-rx', patientId],
    queryFn: () => apiClient.get<{ data: RxRow[] }>(`/api/v1/prescriptions/patient/${patientId}/active`),
    enabled: wantRx && canSeeRx,
    staleTime: 30_000,
  });
  const labQ = useQuery({
    queryKey: ['rail-lab-abnormal', patientId],
    queryFn: () => apiClient.get<{ data: LabResultRow[] }>(`/api/v1/lab/patients/${patientId}/results`),
    enabled: isLab,
    staleTime: 30_000,
  });

  const vitals = vitalsQ.data?.data ?? [];
  const notes = (notesQ.data?.data ?? []).slice(0, 3);
  // 약사는 약처방만(치료·검사 유형 소음 제거) — 의사는 전 유형
  const rxAll = rxQ.data?.data ?? [];
  const rx = (role === 'PHARMACIST' ? rxAll.filter((r) => r.type === 'MEDICATION') : rxAll).slice(0, 5);
  // flag 는 'N'(정상)도 채워진다 — presence 판정이면 정상이 이상치로 둔갑한다(브라우저 실측으로 발견)
  const isAbnormalFlag = (f?: string | null) => !!f && !['N', 'NORMAL'].includes(f.toUpperCase());
  const abnormal = (labQ.data?.data ?? [])
    .flatMap((r) => (r.items ?? []).filter((i) => isAbnormalFlag(i.flag)).map((i) => ({ ...i, at: r.completedAt ?? r.createdAt })))
    .slice(0, 6);

  return (
    <>
    <aside
      aria-label={tAttr("임상 참조 패널")}
      className="no-print hidden min-[1600px]:block fixed right-6 top-40 bottom-6 z-20 w-80 overflow-y-auto space-y-3"
    >
      {/* 빠른 작성(간호) — 어느 탭에 있어도 손이 닿게(헤더까지 스크롤 복귀 불필요) */}
      {isNurse && (
        <div className="flex gap-2">
          <button onClick={() => setShowVitals(true)}
            className="flex-1 py-2 whitespace-nowrap bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700">
            <T k="➕ 활력 입력" />
          </button>
          <button onClick={() => setShowNote(true)}
            className="flex-1 py-2 whitespace-nowrap bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-xl hover:bg-emerald-100">
            <T k="📝 간호기록" />
          </button>
        </div>
      )}

      {allergies.length > 0 && (
        <div className="rounded-2xl border border-red-100 bg-red-50/60 px-3 py-2">
          <p className="text-[10px] font-bold text-red-500 mb-0.5"><T k="알레르기" /></p>
          <p className="text-xs text-red-700 font-medium">{allergies.join(', ')}</p>
        </div>
      )}

      {canSeeVitals && (
        <div className={CARD}>
          <p className={CARD_TITLE}><T k="최근 활력" /></p>
          {vitalsQ.isError ? (
            <QueryErrorFallback error={vitalsQ.error} onRetry={vitalsQ.refetch} size="compact" />
          ) : vitals.length === 0 ? (
            <EmptyState compact icon="🩺" title="활력 기록 없음" />
          ) : vitals.map((v) => (
            <div key={v.id} className={ROW}>
              <p className="text-[10px] text-gray-400"><KDate value={v.measuredAt ?? v.recordedAt ?? v.createdAt} mode="datetime" /></p>
              {/* 표준 순서·단위·미측정 '—'·이상 색(서버 임계) — 부품 정본(행 전체 원장을 넘긴다) */}
              <VitalSignsStrip vitals={v as unknown as Record<string, unknown>} />
            </div>
          ))}
        </div>
      )}

      {wantRx && (
        <div className={CARD}>
          <p className={CARD_TITLE}>{role === 'PHARMACIST' ? '활성 약처방' : '활성 처방'}</p>
          {rxQ.isError ? (
            <QueryErrorFallback error={rxQ.error} onRetry={rxQ.refetch} size="compact" />
          ) : rx.length === 0 ? (
            <EmptyState compact icon="💊" title="활성 처방 없음" />
          ) : rx.map((r) => (
            <div key={r.id} className={ROW}>
              <p className="text-xs font-medium text-gray-800 truncate">
                {/* 코드 미연결 시드는 instructions 에 실측 요약이 있다(2026-08-04 정리) — type 폴백은 최후 */}
                {r.medicationCode?.nameKo ?? r.procedureCode?.nameKo ?? r.instructions ?? r.type}
              </p>
              {(r.dosage || r.frequency) && (
                <p className="text-[10px] text-gray-500">{[r.dosage, r.frequency].filter(Boolean).join(' · ')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {isNurse && (
        <div className={CARD}>
          <p className={CARD_TITLE}><T k="최근 간호기록" /></p>
          {notesQ.isError ? (
            <QueryErrorFallback error={notesQ.error} onRetry={notesQ.refetch} size="compact" />
          ) : notes.length === 0 ? (
            <EmptyState compact icon="📝" title="간호기록 없음" />
          ) : notes.map((n) => (
            <div key={n.id} className={ROW}>
              <p className="text-[10px] text-gray-400">
                <KDate value={n.recordedAt ?? n.createdAt} mode="datetime" />
                {n.noteType && <span className="ml-1 text-indigo-400">{n.noteType}</span>}
              </p>
              <p className="text-xs text-gray-700 line-clamp-2">{n.content || n.assessment || '-'}</p>
            </div>
          ))}
        </div>
      )}

      {isLab && (
        <div className={CARD}>
          <p className={CARD_TITLE}><T k="최근 검사 이상치" /></p>
          {labQ.isError ? (
            <QueryErrorFallback error={labQ.error} onRetry={labQ.refetch} size="compact" />
          ) : abnormal.length === 0 ? (
            <EmptyState compact icon="🧪" title="이상치 없음" />
          ) : abnormal.map((i, idx) => (
            <div key={idx} className={ROW}>
              <p className="text-xs text-gray-800">
                <span className="font-medium"><LabTerm name={i.testName} /></span>
                <span className="ml-1.5 font-semibold tabular-nums text-rose-600">{i.value} {i.unit}</span>
                <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-rose-50 text-rose-700">{i.flag}</span>
              </p>
              <p className="text-[10px] text-gray-400"><KDate value={i.at} mode="date" /></p>
            </div>
          ))}
        </div>
      )}
    </aside>

      {/* 모달은 레일(fixed=스태킹 컨텍스트) 바깥에 — 안에 두면 백드롭이 레일을 못 덮는다 */}
      {showVitals && <QuickVitalsModal patientId={patientId} onClose={() => setShowVitals(false)} />}
      {showNote && <QuickNursingNoteModal patientId={patientId} onClose={() => setShowNote(false)} />}
    </>
  );
}

/** @deprecated 전 역할 일반화 — ClinicalSideRail 사용(호환 별칭) */
export const NurseSideRail = ClinicalSideRail;
