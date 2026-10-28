'use client';

import Link from 'next/link';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { PrintRaw } from '@/components/print/PrintSheet';

interface PrintLayoutProps {
  title: string;
  docNumber?: string;
  children: React.ReactNode;
  backHref?: string;
}

/**
 * 🔴 (2026-10-12) 종전엔 화면을 그대로 찍었는데, 공용 문서 CSS 가 인쇄 루트 없이도 body 직계를 숨겨 **빈 종이**였다.
 *    양식(document)은 화면과 같은 것을 인쇄 루트(.doc-print-root)에 한 번 더 그린다 — 쪽 여백은 공용 named page(dps).
 *    전역 `@page`(여백 15mm)는 다른 문서의 쪽 규격을 덮어써 지웠다.
 */
export default function PrintLayout({ title, docNumber, children, backHref = '/' }: PrintLayoutProps) {
  const doc = (screen: boolean) => (
      <div className={screen ? 'max-w-[210mm] mx-auto bg-white p-10 min-h-screen' : 'bg-white'} style={{ fontFamily: 'serif' }}>
        {/* Document ID */}
        {docNumber && (
          <div className="flex justify-between text-[10px] text-gray-400 mb-2">
            <span className="font-mono font-semibold text-gray-600">{docNumber}</span>
            <span>위루비병원</span>
          </div>
        )}

        {/* Header */}
        <div className="text-center border-b-2 border-black pb-4 mb-6">
          <h1 className="text-2xl font-bold tracking-wide">{title}</h1>
          <p className="text-lg font-semibold mt-1">위루비병원</p>
          <p className="text-xs text-gray-600 mt-1">한국형 Enterprise 병원 정보 시스템</p>
        </div>

        {/* Content */}
        {children}

        {/* Footer */}
        <div className="mt-12 pt-4 border-t border-gray-300 text-center">
          <p className="text-xs text-gray-500">이 문서는 전자의무기록 시스템에서 생성되었습니다</p>
          <div className="flex justify-between text-[9px] text-gray-400 mt-2">
            <span>{docNumber}</span>
            <span>위루비병원 · {new Date().toLocaleDateString('ko')} 출력</span>
          </div>
        </div>
      </div>
  );
  return (
    <>

      {/* Toolbar */}
      <div className="no-print flex justify-end gap-2 p-4 sticky top-0 bg-white border-b z-10">
        <Link href={backHref} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
          목록으로
        </Link>
        <button onClick={() => sanctionedPrint()} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          인쇄 / PDF 저장
        </button>
      </div>

      {/* Document — 화면 */}
      {doc(true)}
      {/* 인쇄본 — 인쇄 루트에 같은 양식 */}
      <PrintRaw attr={docNumber ?? 'print-layout'}>{doc(false)}</PrintRaw>
    </>
  );
}

// 공통 환자 정보 테이블
interface PrintPatient {
  familyName?: string;
  givenName?: string;
  mrn?: string;
  dateOfBirth?: string;
  gender?: string;
}

export function PatientInfoTable({ patient }: { patient: PrintPatient | null | undefined }) {
  if (!patient) return null;
  return (
    <div className="border border-gray-300 rounded-lg mb-6">
      <div className="grid grid-cols-4 text-sm">
        <Cell label="환자명" value={`${patient.familyName ?? ''}${patient.givenName ?? ''}`} bold />
        <Cell label="등록번호" value={patient.mrn} mono />
        <Cell label="생년월일" value={patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString('ko') : '-'} />
        <Cell label="성별" value={patient.gender === 'MALE' ? '남' : patient.gender === 'FEMALE' ? '여' : '-'} last />
      </div>
    </div>
  );
}

function Cell({ label, value, bold, mono, last }: { label: string; value?: string; bold?: boolean; mono?: boolean; last?: boolean }) {
  return (
    <>
      <div className={`border-r ${last ? '' : 'border-b'} border-gray-300 bg-gray-50 px-3 py-2 font-medium text-gray-700 text-sm`}>{label}</div>
      <div className={`${last ? '' : 'border-b'} border-gray-300 px-3 py-2 text-sm ${bold ? 'font-bold' : ''} ${mono ? 'font-mono' : ''}`}>{value ?? '-'}</div>
    </>
  );
}

// 서명란
export function SignatureBlock({ label, name, date }: { label: string; name?: string; date?: string }) {
  return (
    <div className="text-center">
      <p className="text-gray-600 text-sm mb-1">{label}</p>
      <div className="mb-8" />
      <div className="border-b border-gray-400 w-40 mx-auto mb-1" />
      <p className="text-sm">{name ?? '____'} (인)</p>
      {date && <p className="text-xs text-gray-500 mt-0.5">{date}</p>}
    </div>
  );
}
