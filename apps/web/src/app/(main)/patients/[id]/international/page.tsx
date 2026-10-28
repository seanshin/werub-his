'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface PassportInfo {
  id: string;
  familyName: string;
  givenName: string;
  nameEn?: string;
  nationality?: string;
  passportNumber?: string;
  alienRegistrationNo?: string;
  /** 보관 상태 — 2026-07 UI 미노출 감사로 응답에 추가 */
  isActive?: boolean;
  archivedAt?: string | null;
  preferredLanguage?: string;
  patientSource?: string;
  travelInsurance?: { company: string; policyNo: string; contactNo: string };
  embassyContact?: string;
  interpreterNeeded: boolean;
  depositRequired: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  DOMESTIC: '내국인', FOREIGN_TOURIST: '외국인 관광객', FOREIGN_RESIDENT: '외국인 거주자',
  OVERSEAS_KOREAN: '재외동포', REMOTE_INTERNATIONAL: '원격 해외환자', TRANSFER_IN: '전원 수신', EMERGENCY_UNKNOWN: '응급 미확인',
};

const LANG_LABEL: Record<string, string> = {
  ko: '한국어', en: 'English', zh: '中文', ja: '日本語', vi: 'Tiếng Việt', ru: 'Русский',
};

export default function PatientInternationalPage() {
  const tAttr = useTAttr();
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['patient-passport', id],
    queryFn: () => apiClient.get<{ data: PassportInfo }>(`/api/v1/patients/${id}/passport`),
    enabled: !!id,
  });
  const info: PassportInfo | null = (data as any)?.data?.data ?? (data as any)?.data ?? null;

  if (isLoading) return <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>;
  if (!info) return <div className="py-12 text-center text-gray-400"><T k="환자 정보를 찾을 수 없습니다" /></div>;

  const isForeign = info.patientSource && info.patientSource !== 'DOMESTIC';

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="국제 환자 정보" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {info.familyName}{info.givenName} {info.nameEn && `(${info.nameEn})`}
            {/* 보관 상태 — 응답에 없어 화면에서 구분할 수 없던 값 */}
            {info.archivedAt && (
              <span
                className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 border border-gray-300"
                title={`보관 처리: ${String(info.archivedAt).slice(0, 10)}`}
              >
                <T k="보관됨" />
              </span>
            )}
          </p>
        </div>
        <Link href={`/patients/${id}`} className="text-sm text-blue-600 hover:underline">&larr; 환자 상세</Link>
      </div>

      {!isForeign && (
        <EmptyState icon="👤" title="내국인 환자입니다. 국제 환자 정보가 없습니다." className="bg-gray-50 rounded-2xl border" />
      )}

      {isForeign && (
        <>
          {/* 기본 정보 */}
          <div className="bg-white rounded-2xl border shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="환자 유형" /></h3>
            <span className="inline-block px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium">
              {SOURCE_LABEL[info.patientSource ?? ''] ?? info.patientSource}
            </span>
          </div>

          {/* 식별 정보 */}
          <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-900"><T k="식별 정보" /></h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500"><T k="국적" /></span><div className="font-medium mt-0.5">{info.nationality ?? '-'}</div></div>
              <div><span className="text-gray-500"><T k="선호 언어" /></span><div className="font-medium mt-0.5">{LANG_LABEL[info.preferredLanguage ?? ''] ?? info.preferredLanguage ?? '-'}</div></div>
              <div><span className="text-gray-500"><T k="여권번호" /></span><div className="font-medium mt-0.5 font-mono">{info.passportNumber ?? '-'}</div></div>
              <div><span className="text-gray-500"><T k="외국인등록번호" /></span><div className="font-medium mt-0.5 font-mono">{info.alienRegistrationNo ?? '-'}</div></div>
              <div><span className="text-gray-500"><T k="영문 성명" /></span><div className="font-medium mt-0.5">{info.nameEn ?? '-'}</div></div>
            </div>
          </div>

          {/* 보험/결제 */}
          <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-900"><T k="보험 / 결제" /></h3>
            <div className="flex gap-3">
              {info.depositRequired && (
                <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold whitespace-nowrap"><T k="예치금 필요" /></span>
              )}
              {info.interpreterNeeded && (
                <span className="text-[10px] px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full font-semibold whitespace-nowrap"><T k="통역 필요" /></span>
              )}
            </div>
            {info.travelInsurance && (
              <div className="bg-blue-50 rounded-xl p-3 space-y-1 text-sm">
                <div className="font-semibold text-blue-900"><T k="여행자 보험" /></div>
                <div className="text-blue-700">보험사: {info.travelInsurance.company}</div>
                <div className="text-blue-700">증권번호: {info.travelInsurance.policyNo}</div>
                <div className="text-blue-700">연락처: {info.travelInsurance.contactNo}</div>
              </div>
            )}
            {info.embassyContact && (
              <div className="bg-gray-50 rounded-xl p-3 text-sm">
                <span className="text-gray-500"><T k="대사관 연락처:" /></span> <span className="font-medium">{info.embassyContact}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
