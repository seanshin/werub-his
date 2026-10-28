'use client';

import { use } from 'react';
import { useEncounter } from '@/hooks/useEncounters';
import { safeFormat as format } from '@/lib/safe-date';
import SignedDocumentFooter from '@/components/signature/SignedDocumentFooter';

interface EncounterDiagnosis {
  diagnosisCode?: { code?: string; nameKo?: string };
}

export default function OpinionPrintPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = use(params);
  const { data, isLoading } = useEncounter(encounterId);

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">소견서를 불러오는 중...</p></div>;
  if (!data?.data) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">진료 기록을 찾을 수 없습니다.</p></div>;

  const enc = data.data;
  const patient = enc.patient;
  const doctor = enc.doctor;
  const diagnoses = enc.diagnoses ?? [];

  return (
    <div className="max-w-[800px] mx-auto p-8 bg-white min-h-screen print:p-4">
      {/* Print Button */}
      <div className="flex justify-end gap-2 mb-6 print:hidden">
        <button onClick={() => window.history.back()} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">뒤로</button>
        <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">인쇄</button>
      </div>

      {/* Header */}
      <div className="text-center border-b-2 border-gray-900 pb-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">소 견 서</h1>
        <p className="text-sm text-gray-500 mt-1">Medical Opinion Letter</p>
      </div>

      {/* Patient Info */}
      <div className="border border-gray-300 rounded-lg p-4 mb-6">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="font-medium text-gray-600 py-1 w-24">환자 성명</td>
              <td className="py-1 font-bold">{patient?.familyName}{patient?.givenName}</td>
              <td className="font-medium text-gray-600 py-1 w-24">등록번호</td>
              <td className="py-1">{patient?.mrn}</td>
            </tr>
            <tr>
              <td className="font-medium text-gray-600 py-1">생년월일</td>
              <td className="py-1">{patient?.dateOfBirth ? format(new Date(patient.dateOfBirth), 'yyyy년 MM월 dd일') : '-'}</td>
              <td className="font-medium text-gray-600 py-1">성별</td>
              <td className="py-1">{patient?.gender === 'MALE' ? '남' : patient?.gender === 'FEMALE' ? '여' : '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Diagnosis */}
      <div className="mb-6">
        <h3 className="font-bold text-gray-900 mb-2 border-b border-gray-200 pb-1">진단명</h3>
        {diagnoses.length > 0 ? (
          <ul className="list-disc list-inside text-sm space-y-1">
            {diagnoses.map((dx: EncounterDiagnosis, i: number) => (
              <li key={i}>{dx.diagnosisCode?.nameKo ?? dx.diagnosisCode?.code ?? '-'} ({dx.diagnosisCode?.code})</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">{enc.assessment || '-'}</p>
        )}
      </div>

      {/* Opinion */}
      <div className="mb-6">
        <h3 className="font-bold text-gray-900 mb-2 border-b border-gray-200 pb-1">소견</h3>
        <div className="text-sm leading-relaxed whitespace-pre-wrap min-h-[120px] border border-gray-200 rounded-lg p-4">
          {enc.subjective && <p className="mb-2"><strong>[증상]</strong> {enc.subjective}</p>}
          {enc.objective && <p className="mb-2"><strong>[소견]</strong> {enc.objective}</p>}
          {enc.assessment && <p className="mb-2"><strong>[진단]</strong> {enc.assessment}</p>}
          {enc.plan && <p><strong>[치료계획]</strong> {enc.plan}</p>}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center text-sm">
        <p className="mb-8">상기 환자에 대하여 위와 같이 소견합니다.</p>
        <p className="mb-4">{format(new Date(enc.createdAt), 'yyyy년 MM월 dd일')}</p>
        <div className="mt-8">
          <p className="font-medium">위루비병원 병원</p>
          <p className="mt-4">{typeof doctor?.department === 'object' ? doctor.department?.name : (doctor?.department ?? '')} {doctor?.familyName}{doctor?.givenName} (인)</p>
          <p className="text-xs text-gray-400 mt-1">의사 면허번호: _______________</p>
        </div>
      </div>

      <SignedDocumentFooter documentType="ENCOUNTER" documentId={encounterId} />

      <style jsx global>{`
        @media print {
          body { margin: 0; }
          .print\\:hidden { display: none !important; }
          .print\\:p-4 { padding: 16px !important; }
        }
      `}</style>
    </div>
  );
}
