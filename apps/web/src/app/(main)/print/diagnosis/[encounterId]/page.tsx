'use client';

import { use } from 'react';
import { useEncounter } from '@/hooks/useEncounters';
import { safeFormat as format } from '@/lib/safe-date';
import PrintLayout, { PatientInfoTable, SignatureBlock } from '@/components/print/PrintLayout';
import SignedDocumentFooter from '@/components/signature/SignedDocumentFooter';

interface EncounterDiagnosis {
  id?: string;
  type?: string;
  certainty?: string; // CONFIRMED | PROVISIONAL(의증) | RULE_OUT(R/O) | EXCLUDED(배제)
  diagnosisCode?: { code?: string; nameKo?: string; nameEn?: string };
}

export default function DiagnosisPrintPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = use(params);
  const { data, isLoading, error } = useEncounter(encounterId);

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">진단서를 불러오는 중...</p></div>;
  if (error || !data?.data) return <div className="flex items-center justify-center min-h-screen"><p className="text-red-500">진단서를 불러올 수 없습니다.</p></div>;

  const encounter = data.data;
  const diagnoses = encounter.diagnoses ?? [];

  return (
    <PrintLayout title="진 단 서" docNumber="DOC-DX" backHref="/patients">
      <PatientInfoTable patient={encounter.patient} />

      <div className="mb-6">
        <h2 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2">진단명</h2>
        {diagnoses.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">진단 내역이 없습니다.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead><tr className="border-b-2 border-gray-800">
              <th className="text-left py-2 px-2 w-12">순번</th>
              <th className="text-left py-2 px-2 w-28">코드</th>
              <th className="text-left py-2 px-2">진단명</th>
              <th className="text-left py-2 px-2 w-16">유형</th>
            </tr></thead>
            <tbody>
              {diagnoses.map((d: EncounterDiagnosis, i: number) => (
                <tr key={d.id ?? i} className="border-b border-gray-300">
                  <td className="py-2 px-2">{i + 1}</td>
                  <td className="py-2 px-2 font-mono">{d.diagnosisCode?.code ?? '-'}</td>
                  <td className="py-2 px-2">
                    <span className={d.certainty === 'EXCLUDED' ? 'line-through text-gray-400' : ''}>{d.diagnosisCode?.nameKo ?? d.diagnosisCode?.nameEn ?? '-'}</span>
                    {d.certainty === 'PROVISIONAL' && <span className="text-gray-500"> 의증</span>}
                    {d.certainty === 'RULE_OUT' && <span className="text-gray-500"> (R/O)</span>}
                    {d.certainty === 'EXCLUDED' && <span className="text-gray-400"> (배제)</span>}
                  </td>
                  <td className="py-2 px-2 text-xs text-gray-500">{d.type === 'PRIMARY' ? '주' : d.type === 'DIFFERENTIAL' ? '감별' : '부'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {encounter.assessment && (
        <div className="mb-6">
          <h2 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2">소견</h2>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{encounter.assessment}</p>
        </div>
      )}

      <div className="mt-12 text-center text-base font-medium"><p>위와 같이 진단합니다.</p></div>
      <div className="mt-8 text-center text-sm mb-8">
        <p>{format(new Date(encounter.createdAt ?? new Date()), 'yyyy년 MM월 dd일')}</p>
      </div>
      <div className="flex justify-end mr-8">
        <SignatureBlock label="담당의사" name={encounter.doctor ? `${encounter.doctor.familyName}${encounter.doctor.givenName}` : undefined} />
      </div>

      <SignedDocumentFooter documentType="ENCOUNTER" documentId={encounterId} />
    </PrintLayout>
  );
}
