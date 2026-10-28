'use client';

import { useDurationText } from '@/components/ui/display';

// 큰 화면 보기 전용 컴팩트 식별 바 — 전폭에서 공백 없이 한 줄로 정제.
// 좌: 식별(이름·성별/나이·혈액형·알러지·플래그·안전배지·MRN) / 우(ml-auto): 핵심 액션만.
// 넓은 board에서 기존 큰 헤더 카드 대신 사용(P-1/P-2 식별·알러지·안전신호는 유지, 버튼은 정리).

import { useState, useEffect } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { GENDER_LABEL } from '@hospital-run/shared';
import { usePatientTabStore } from '@/stores/patient-tab-store';
import { PatientFlagBar } from './PatientFlagBar';
import { PatientSafetyBar } from './PatientSafetyBar';
import { ForeignCareBadges } from './ForeignCareBadges';
import { AllergyStatusBadge } from '@/components/clinical/allergy-status';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

const BoardLayoutEditor = dynamic(() => import('./board/BoardLayoutEditor').then((m) => ({ default: m.BoardLayoutEditor })));

interface Props {
  patient: Record<string, any>;
  patientId: string;
  /** 🔴 나이 미상은 `null` — 0(신생아)과 다른 사실이다(정본 shared `ageOf`) */
  patientAge: number | null;
  allergies: string[];
}

export function BoardHeaderBar({ patient, patientId, patientAge, allergies }: Props) {
  const fmtDur = useDurationText();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const toggleBoard = usePatientTabStore((s) => s.toggleBoard);
  const boardRound = usePatientTabStore((s) => s.boardRound);
  const toggleBoardRound = usePatientTabStore((s) => s.toggleBoardRound);
  const [showEditor, setShowEditor] = useState(false);
  const qc = useQueryClient();
  const [refreshedAt, setRefreshedAt] = useState<number>(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30_000); // 경과 시간 표시 갱신
    return () => clearInterval(id);
  }, []);
  const refreshAll = () => {
    // 환자 스코프 쿼리 일괄 무효화(패널 데이터 최신화·P-3)
    qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && (q.queryKey as unknown[]).includes(patientId) });
    setRefreshedAt(Date.now());
  };
  const elapsed = (() => {
    const s = Math.floor((Date.now() - refreshedAt) / 1000);
    if (s < 60) return tAttr('방금');
    const m = Math.floor(s / 60);
    // 🔴 접미 '전' 을 호출부가 붙이면 영어에서 `5 hours 전` 이 된다 — 어순은 번역문이 정한다
    return tfAttr('{경과} 전@경과', { 경과: fmtDur(m, '-', true) });
  })();
  const stale = Date.now() - refreshedAt > 5 * 60 * 1000; // 5분 초과 → 주의색

  const name = `${patient.familyName}${patient.givenName}`;
  const accent = patient.isDeceased ? '#9ca3af' : allergies.length > 0 ? '#ef4444' : '#3b82f6';

  return (
    <>
    <div
      className="bg-white rounded-2xl border border-y-gray-100 border-r-gray-100 shadow-sm px-4 py-2.5 flex items-center gap-x-3 gap-y-1.5 flex-wrap"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0A17.9 17.9 0 0112 21.75c-2.7 0-5.2-.6-7.5-1.65z" />
        </svg>
      </div>

      <span className="text-base font-bold text-gray-900 whitespace-nowrap">{name}</span>
      <span className="text-xs text-gray-500 whitespace-nowrap">
        ({GENDER_LABEL[patient.gender] ?? patient.gender}{patientAge != null ? `, ${patientAge}세` : ', 나이 미상'})
      </span>
      {patient.bloodType && (
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 whitespace-nowrap">{patient.bloodType}</span>
      )}
      {/* 🔴 종전엔 `allergies.length === 0` 이면 초록 `NKDA` 를 달았다 — 평가한 적 없는 환자에게
          "물어봤고 없었다"는 임상적 단언을 한 것이다. 서버 4상태 정본을 그대로 말한다. */}
      <AllergyStatusBadge patientId={patientId} allergyCount={allergies.length} />
      <ForeignCareBadges patient={patient} />
      <PatientFlagBar patientId={patientId} />
      <PatientSafetyBar patientId={patientId} />
      <span className="text-xs font-mono text-gray-500 whitespace-nowrap">MRN: {patient.mrn}</span>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <button
          onClick={refreshAll}
          title={tAttr("모든 패널 새로고침")}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${stale ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.6" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M20.015 9.348a8.25 8.25 0 10.36 5.402" /></svg>
          {elapsed}
        </button>
        <button
          onClick={() => setShowEditor(true)}
          title={tAttr("큰 화면 패널 설정(표시·순서)")}
          aria-label={tAttr("패널 설정")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <T k="패널" />
        </button>
        <button
          onClick={toggleBoardRound}
          aria-pressed={boardRound}
          title={boardRound ? '보통 크기로' : '회진 모드(글자 크게) — 원거리 판독'}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${boardRound ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" /></svg>
          {boardRound ? '보통' : '회진'}
        </button>
        <Link
          href={`/patients/${patientId}/encounter/new?cockpit=1`}
          title={tAttr("진료 작성 + 참조 멀티패널(콕핏)")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          <T k="진료 시작" />
        </Link>
        <button
          onClick={toggleBoard}
          aria-pressed={true}
          title={tAttr("일반 화면으로 돌아가기")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <rect x="3.75" y="5.25" width="16.5" height="13.5" rx="2" strokeLinejoin="round" />
            <path strokeLinecap="round" d="M7.5 9.75h9M7.5 13h9M7.5 16.25h5.25" />
          </svg>
          <T k="일반 화면" />
        </button>
        <button
          onClick={() => sanctionedPrint()}
          title={tAttr("차트 인쇄")}
          className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-500 bg-white border border-gray-200 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.83c-.24.03-.48.06-.72.1m.72-.1a42.4 42.4 0 0110.56 0m-10.56 0L6.34 18m10.94-4.17c.24.03.48.06.72.1m-.72-.1L17.66 18m0 0l.23 2.52a1.13 1.13 0 01-1.12 1.23H7.23c-.66 0-1.18-.57-1.12-1.23L6.34 18m11.32 0h1.09A2.25 2.25 0 0021 15.75V9.46c0-1.08-.77-2.02-1.84-2.18a48 48 0 00-1.91-.24M6.34 18H5.25A2.25 2.25 0 013 15.75V9.46c0-1.08.77-2.02 1.84-2.18a48 48 0 011.91-.24m10.5 0a48.5 48.5 0 00-10.5 0m10.5 0V3.38c0-.62-.5-1.13-1.13-1.13h-8.25c-.62 0-1.12.5-1.12 1.13v3.66" /></svg>
          <T k="인쇄" />
        </button>
      </div>
    </div>
    {showEditor && <BoardLayoutEditor onClose={() => setShowEditor(false)} />}
    </>
  );
}
