'use client';

import { Term } from '@/components/ui/term';

import { use } from 'react';
import Link from 'next/link';
import { usePatient } from '@/hooks/usePatients';
import { usePatientEncounters } from '@/hooks/useEncounters';
import { safeFormat as format } from '@/lib/safe-date';
import { T } from '@/components/ui/i18n-text';

interface EncounterDoctor {
  familyName?: string;
  givenName?: string;
}

interface EncounterDiagnosis {
  id: string;
  diagnosisCode?: { code?: string; nameKo?: string; nameEn?: string | null };
}

interface EncounterItem {
  id: string;
  status: string;
  createdAt: string;
  subjective?: string;
  assessment?: string;
  plan?: string;
  prescriptions?: unknown[];
  diagnoses?: EncounterDiagnosis[];
  doctor?: EncounterDoctor;
}

// ENCOUNTER_STATUS_LABEL 정본 정렬 — 진료중/완료 누락(raw 코드)·서명완료/수정됨 문구 드리프트 봉합
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: '작성중', bg: 'bg-amber-50', text: 'text-amber-700' },
  IN_PROGRESS: { label: '진료중', bg: 'bg-indigo-50', text: 'text-indigo-700' },
  COMPLETED: { label: '완료', bg: 'bg-gray-50', text: 'text-gray-600' },
  SIGNED: { label: '서명', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  AMENDED: { label: '수정', bg: 'bg-blue-50', text: 'text-blue-700' },
};

export default function PatientEncountersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: patientData } = usePatient(id);
  const { data, isLoading } = usePatientEncounters(id);
  const _encRaw = data?.data;
  const encountersList: EncounterItem[] = Array.isArray(_encRaw) ? _encRaw : (_encRaw as unknown as Record<string, unknown>)?.data as EncounterItem[] ?? [];

  const patient = patientData?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="animate-spin h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span className="ml-2 text-gray-500 text-sm"><T k="로딩 중..." /></span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/patients/${id}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-gray-900"><T k="진료 이력" /></h2>
            {patient && (
              <p className="text-sm text-gray-500 mt-0.5">
                {patient.familyName}{patient.givenName} (MRN: {patient.mrn})
              </p>
            )}
          </div>
        </div>
        <Link
          href={`/patients/${id}/encounter/new`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <T k="새 진료" />
        </Link>
      </div>

      {/* Encounters List */}
      {!encountersList.length ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9.75m3 0h3m-10.125 0A2.625 2.625 0 018.25 18V6.375c0-1.036.84-1.875 1.875-1.875h3.375" />
          </svg>
          <p className="text-gray-400 mb-4"><T k="진료 기록이 없습니다." /></p>
          <Link
            href={`/patients/${id}/encounter/new`}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <T k="첫 진료 시작하기" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {encountersList.map((enc: EncounterItem) => {
            const status = STATUS_CONFIG[enc.status] ?? { label: enc.status, bg: 'bg-gray-50', text: 'text-gray-700' };
            const prescriptionCount = enc.prescriptions?.length ?? 0;

            return (
              <Link
                key={enc.id}
                href={`/patients/${id}/encounter/new?encounterId=${enc.id}`}
                className="block bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${status.bg} ${status.text}`}>
                      {status.label}
                    </span>
                    <span className="text-sm text-gray-500">
                      {format(new Date(enc.createdAt), 'yyyy-MM-dd HH:mm')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {prescriptionCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.187 3.187 0 01-2.283.866 3.187 3.187 0 01-2.283-.866L5 14.5" />
                        </svg>
                        처방 {prescriptionCount}건
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {enc.doctor?.familyName}{enc.doctor?.givenName}
                    </span>
                  </div>
                </div>

                {(enc.diagnoses?.length ?? 0) > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {enc.diagnoses?.map((d: EncounterDiagnosis) => (
                      <span key={d.id} className="text-[11px] bg-gray-100 text-gray-600 font-medium px-2 py-0.5 rounded-md">
                        {d.diagnosisCode?.code} <Term nameKo={d.diagnosisCode?.nameKo} nameEn={d.diagnosisCode?.nameEn} />
                      </span>
                    ))}
                  </div>
                )}

                {enc.subjective && (
                  <p className="text-sm text-gray-700 line-clamp-2">
                    <span className="font-medium text-gray-400">S:</span> {enc.subjective}
                  </p>
                )}
                {enc.assessment && (
                  <p className="text-sm text-gray-700 line-clamp-1 mt-1">
                    <span className="font-medium text-gray-400">A:</span> {enc.assessment}
                  </p>
                )}
                {enc.plan && (
                  <p className="text-sm text-gray-700 line-clamp-1 mt-1">
                    <span className="font-medium text-gray-400">P:</span> {enc.plan}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
