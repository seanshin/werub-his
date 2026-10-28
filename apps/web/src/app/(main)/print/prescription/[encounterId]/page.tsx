'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEncounter } from '@/hooks/useEncounters';
import { apiClient } from '@/lib/api-client';
import { format, addDays } from 'date-fns';
import { GENDER_LABEL, INSURANCE_LABEL } from '@hospital-run/shared';
import SignedDocumentFooter from '@/components/signature/SignedDocumentFooter';
import { DrugName } from '@/components/ui/display';

interface PrintDiagnosis {
  id?: string;
  code?: string;
  nameKo?: string;
  diagnosisCode?: { code?: string; nameKo?: string; nameEn?: string };
}

interface PrintPrescription {
  id?: string;
  medicationId?: string;
  medication?: { nameKo?: string; nameEn?: string };
  medicationCode?: { nameKo?: string; nameEn?: string; code?: string };
  procedureCode?: { nameKo?: string; code?: string };
  drugName?: string;
  dosage?: string;
  frequency?: string;
  duration?: number;
  quantity?: number;
  route?: string;
  instructions?: string;
  type?: string;
  status?: string;
  dispensingType?: string;
}

interface RxIssue {
  issueNo: string; dateKey: string | null; seq: number | null; issuedAt: string; status: string;
  qrUrl: string; qrDataUrl?: string; reused: boolean; superseded: string[]; itemCount: number;
  /** 발급된 판(서버 스냅샷) — 종이는 이것을 그린다(B2) */
  snapshot?: {
    scope: 'EXTERNAL' | 'ALL';
    diagnoses: Array<{ code: string | null; name: string | null }>;
    items: Array<{ prescriptionId: string; code: string | null; name: string | null; nameEn: string | null; dosage: string | null; frequency: string | null; duration: number | null; quantity: number | null; route: string | null; instructions: string | null; dispensingType: string | null }>;
  };
  transmission: { channel: string; implemented: boolean; transmitted: false; transmittedAt: null; reason: string };
}

/** 교부번호 — 발급 원장의 날짜·일련번호(서식의 '년 월 일 제 호') */
function issueNoLabel(i: RxIssue | undefined): string | null {
  if (!i?.dateKey || i.seq == null) return null;
  return `${i.dateKey.slice(0, 4)}년 ${i.dateKey.slice(4, 6)}월 ${i.dateKey.slice(6, 8)}일 제 ${String(i.seq).padStart(5, '0')}호`;
}

const ROUTE_LABEL: Record<string, string> = {
  ORAL: '경구', IV: '정맥주사', IM: '근육주사', SC: '피하주사', TOPICAL: '외용', INHALE: '흡입', EYE: '점안', EAR: '점이',
};

export default function PrescriptionPrintPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = use(params);
  const { data, isLoading, error } = useEncounter(encounterId);
  // 🔴 조회 실패를 '병원'·'-' 같은 기본값으로 찍지 않는다(법정 서식) — 실패는 '확인 불가', 행이 없으면 '미설정'
  const { data: cfgData, isError: cfgIsError } = useQuery({
    queryKey: ['rx-hospital-config'],
    queryFn: () => apiClient.get<Record<string, unknown>>('/api/v1/config'),
  });
  const cfgList = (Array.isArray(cfgData?.data) ? cfgData.data : ((cfgData?.data as Record<string, unknown>)?.data ?? [])) as { key: string; value: unknown }[];
  const cfg: Record<string, unknown> = {};
  cfgList.forEach((c) => { cfg[c.key] = c.value; });
  // 🔴 처방전 발급(2026-09-30) — 교부번호를 인쇄할 때 계산만 하던 것을 **발급 원장**에 남기고(같은 내용이면 같은 번호),
  //    진위 확인 QR 을 싣는다. 약국으로 전자 전송은 하지 않는다(채널 미구현 — 서버 응답이 말한다).
  //    서명 전 진료는 발급하지 않는다(서버 409) — 번호를 지어내지 않는다.
  const issueQ = useQuery({
    queryKey: ['rx-issue', encounterId],
    queryFn: () => apiClient.post<{ data: RxIssue }>(`/api/v1/encounters/${encounterId}/prescription-issue`, {}).then((r) => r.data),
    enabled: !!data?.data && data.data.status !== 'DRAFT',
    retry: false,
    staleTime: Infinity,
  });
  const cfgText = (k: string) => (cfgIsError ? '확인 불가' : cfg[k] != null && String(cfg[k]).trim() ? String(cfg[k]) : '미설정');
  const hospital = {
    name: cfgText('hospital.name'),
    code: cfgText('hospital.code'),
    phone: cfgText('hospital.phone'),
    address: cfgText('hospital.address'),
    bizNo: cfgText('hospital.bizNo'),
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">처방전을 불러오는 중...</p>
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-500">처방전 데이터를 불러올 수 없습니다.</p>
        <Link href="/" className="text-blue-600 hover:underline text-sm">돌아가기</Link>
      </div>
    );
  }

  const encounter = data.data;
  const patient = encounter.patient;
  const doctor = encounter.doctor;
  // 🔴 (2026-10-13 결함 발굴 B2) 발급됐으면 **발급된 판**(서버 스냅샷 — 해시 대상)을 그린다. 종전엔 발급 뒤에도 실시간 조회로
  //    그려 지시사항·진단이 발급 원장에 묶이지 않았다(지시사항만 바꾼 처방전이 같은 교부번호·진위 "유효").
  const issuedSnap = issueQ.data?.snapshot;
  const diagnoses: PrintDiagnosis[] = issuedSnap
    ? issuedSnap.diagnoses.map((d) => ({ code: d.code ?? undefined, nameKo: d.name ?? undefined }))
    : (encounter.diagnoses ?? []);
  const allPrescriptions = encounter.prescriptions ?? [];
  // 🔴 취소·중단된 처방을 처방전에 찍지 않는다(종전엔 상태 필터가 없어 취소한 약도 인쇄됐다)
  const activeMeds = allPrescriptions.filter((rx: PrintPrescription) =>
    (rx.type === 'MEDICATION' || rx.medicationCode || rx.medication) && rx.status !== 'CANCELLED' && rx.status !== 'DISCONTINUED');
  // 조제구분은 처방에 기록된 값(dispensingType)으로 — 원외 항목이 있으면 원외처방전에는 원외 항목만 싣는다.
  // 종전엔 '☑ 원외처방'이 고정이라 원내 조제 약이 원외처방전으로 나갔다.
  const externalMeds = activeMeds.filter((rx: PrintPrescription) => rx.dispensingType === 'EXTERNAL');
  const isExternal = issueQ.data?.snapshot ? issueQ.data.snapshot.scope === 'EXTERNAL' : externalMeds.length > 0;
  const prescriptions: PrintPrescription[] = issuedSnap
    ? issuedSnap.items.map((it) => ({
        id: it.prescriptionId, medicationCode: { nameKo: it.name ?? undefined, nameEn: it.nameEn ?? undefined, code: it.code ?? undefined },
        dosage: it.dosage ?? undefined, frequency: it.frequency ?? undefined, duration: it.duration ?? undefined, quantity: it.quantity ?? undefined,
        route: it.route ?? undefined, instructions: it.instructions ?? undefined, dispensingType: it.dispensingType ?? undefined,
      }))
    : (isExternal ? externalMeds : activeMeds);
  const internalOmitted = isExternal ? activeMeds.length - externalMeds.length : 0;
  const isDraft = encounter.status === 'DRAFT';

  return (
    <>
      <style jsx global>{`
        @media print {
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>

      {/* Action buttons */}
      <div className="no-print flex justify-end gap-2 mb-4 max-w-[210mm] mx-auto px-8">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          인쇄
        </button>
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
        >
          돌아가기
        </button>
      </div>

      {/* Print content */}
      <div className="max-w-[210mm] mx-auto bg-white p-8 min-h-screen" style={{ fontFamily: 'serif' }}>
        {/* 서명 전 진료의 처방전은 효력이 없다 — 인쇄물에도 그렇게 찍는다 */}
        {isDraft && (
          <p className="mb-4 rounded border-2 border-red-400 px-3 py-2 text-center text-sm font-bold text-red-600" data-rx-draft>
            서명 전 초안 — 진료 서명 전에는 처방전으로 사용할 수 없습니다
          </p>
        )}
        {/* Hospital Header (의료법 시행규칙 별지 제9호) */}
        <div className="text-center border-b-2 border-black pb-4 mb-4">
          <h1 className="text-2xl font-bold tracking-wide">처 방 전</h1>
          <p className="text-xs text-gray-500 mt-1">[ ✔ 환자보관용 ] [ 약국제출용 ]</p>
          <p className="text-lg font-semibold mt-1">{hospital.name}</p>
          <p className="text-xs text-gray-600 mt-1">
            {hospital.address} | Tel: {hospital.phone}
          </p>
        </div>

        {/* 교부 정보 */}
        <div className="grid grid-cols-3 gap-2 text-xs mb-4 border border-gray-300 rounded p-2">
          <div><span className="text-gray-500">요양기관기호: </span>{hospital.code}</div>
          {/* 🔴 종전: 인쇄할 때 진료 id 로 계산한 번호(RX-…)를 찍었다 — 어디에도 기록되지 않아 확인할 수 없는 번호였다 */}
          <div data-rx-issue-no>
            <span className="text-gray-500">교부번호: </span>
            {isDraft ? '서명 전 — 발급 안 함'
              : issueQ.isLoading ? '발급 중…'
              : issueQ.isError ? '발급 기록 실패 — 교부번호 없음'
              : issueNoLabel(issueQ.data) ?? '확인 불가'}
          </div>
          {/* 교부일 = 발급 원장의 발급 시각(교부번호와 같은 날) · 발급 전에는 진료일 */}
          <div><span className="text-gray-500">교부일: </span>{format(new Date(issueQ.data?.issuedAt ?? encounter.createdAt ?? new Date()), 'yyyy-MM-dd')}</div>
          <div className="col-span-2"><span className="text-gray-500">사용기간: </span>교부일로부터 <strong>3일간</strong> (~{format(addDays(new Date(issueQ.data?.issuedAt ?? encounter.createdAt ?? new Date()), 3), 'yyyy-MM-dd')})</div>
          <div><span className="text-gray-500">사업자번호: </span>{hospital.bizNo}</div>
        </div>

        {/* Patient & Doctor Info */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <h2 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2">환자 정보</h2>
            <table className="text-sm w-full">
              <tbody>
                <tr>
                  <td className="text-gray-600 w-20 py-0.5">성명</td>
                  <td className="font-medium">{patient?.familyName}{patient?.givenName}</td>
                </tr>
                <tr>
                  <td className="text-gray-600 py-0.5">등록번호</td>
                  <td>{patient?.mrn}</td>
                </tr>
                <tr>
                  <td className="text-gray-600 py-0.5">생년월일</td>
                  <td>{patient?.dateOfBirth ? format(new Date(patient.dateOfBirth), 'yyyy-MM-dd') : '-'}</td>
                </tr>
                <tr>
                  <td className="text-gray-600 py-0.5">성별</td>
                  <td>{patient?.gender ? (GENDER_LABEL[patient.gender] ?? patient.gender) : '-'}</td>
                </tr>
                <tr>
                  <td className="text-gray-600 py-0.5">보험</td>
                  <td>{patient?.insuranceType ? (INSURANCE_LABEL[patient.insuranceType] ?? patient.insuranceType) : '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2">의사 정보</h2>
            <table className="text-sm w-full">
              <tbody>
                <tr>
                  <td className="text-gray-600 w-20 py-0.5">성명</td>
                  <td className="font-medium">{doctor?.familyName}{doctor?.givenName}</td>
                </tr>
                <tr>
                  <td className="text-gray-600 py-0.5">진료과</td>
                  <td>{typeof doctor?.department === 'object' ? doctor.department?.name : (doctor?.department ?? '-')}</td>
                </tr>
                <tr>
                  <td className="text-gray-600 py-0.5">면허종류</td>
                  <td>의사</td>
                </tr>
                <tr>
                  <td className="text-gray-600 py-0.5">면허번호</td>
                  <td>{doctor?.licenseNumber ?? '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Diagnosis List — 질병분류기호(KCD) */}
        {diagnoses.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2">질병분류기호 (KCD)</h2>
            <ul className="text-sm space-y-1">
              {diagnoses.map((d: PrintDiagnosis, i: number) => (
                <li key={d.id ?? i}>
                  <span className="font-medium">{d.diagnosisCode?.code ?? d.code}</span>
                  {' '}
                  <span>{d.diagnosisCode?.nameKo ?? d.nameKo ?? d.diagnosisCode?.nameEn ?? ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Prescription Table */}
        <div className="mb-6">
          <h2 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2">처방 내역</h2>
          {prescriptions.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">처방 내역이 없습니다.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="text-left py-2 px-2 font-semibold">약품명</th>
                  <th className="text-center py-2 px-2 font-semibold">용량</th>
                  <th className="text-center py-2 px-2 font-semibold">횟수</th>
                  <th className="text-center py-2 px-2 font-semibold">일수</th>
                  <th className="text-center py-2 px-2 font-semibold">총량</th>
                  <th className="text-center py-2 px-2 font-semibold">투여경로</th>
                  <th className="text-left py-2 px-2 font-semibold">지시사항</th>
                </tr>
              </thead>
              <tbody>
                {prescriptions.map((rx: PrintPrescription, i: number) => (
                  <tr key={rx.id ?? i} className="border-b border-gray-300">
                    <td className="py-2 px-2">
                      <DrugName bilingual nameKo={rx.medicationCode?.nameKo ?? rx.medication?.nameKo ?? rx.procedureCode?.nameKo ?? rx.drugName} nameEn={rx.medicationCode?.nameEn ?? rx.medication?.nameEn} />
                    </td>
                    <td className="py-2 px-2 text-center">{rx.dosage ?? '-'}</td>
                    <td className="py-2 px-2 text-center">{rx.frequency ?? '-'}</td>
                    <td className="py-2 px-2 text-center">{rx.duration ? `${rx.duration}일` : '-'}</td>
                    <td className="py-2 px-2 text-center">{rx.quantity ?? '-'}</td>
                    <td className="py-2 px-2 text-center">{(rx.route ? ROUTE_LABEL[rx.route] : undefined) ?? rx.route ?? '-'}</td>
                    <td className="py-2 px-2 text-gray-600">{rx.instructions ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 대체조제 / 조제 시 참고사항 (의약분업) */}
        <div className="mb-6 text-xs border border-gray-300 rounded p-2 space-y-1">
          {/* 대체조제 불가는 처방의가 약마다 정하는 것인데 기록하는 칸이 없다 — 고정 체크하지 않는다 */}
          <p><span className="font-semibold">대체조제: </span>□ 가능　 □ 불가(처방의 동의 필요)　 <span className="text-gray-500">※ 대체조제 시 약사는 처방의에게 통보</span></p>
          <p><span className="font-semibold">조제구분: </span>{isExternal ? '☑ 원외처방　 □ 원내조제' : '□ 원외처방　 ☑ 원내조제'}</p>
          {internalOmitted > 0 && <p className="text-gray-500">※ 원내 조제 약 {internalOmitted}건은 이 처방전에 싣지 않았습니다(원내 약국에서 조제).</p>}
        </div>

        {/* 약국 기재란 (약국제출용) */}
        <div className="mb-6 text-xs border border-gray-400 rounded">
          <div className="bg-gray-100 px-2 py-1 font-semibold border-b border-gray-300">약국 기재란 (조제 약사)</div>
          <div className="grid grid-cols-3 gap-2 p-2">
            <div>조제기관 명칭: ___________</div>
            <div>조제약사 성명: ___________ (인)</div>
            <div>조제일: ___________</div>
          </div>
        </div>

        {/* Date & Signature */}
        <div className="mt-12 text-sm">
          <div className="text-center mb-8">
            <p>
              {format(new Date(encounter.createdAt ?? new Date()), 'yyyy년 MM월 dd일')}
            </p>
          </div>
          <div className="flex justify-end items-end gap-12 mr-8">
            <div className="text-center">
              <p className="mb-8">처방의사</p>
              <div className="border-b border-gray-400 w-40 mb-1" />
              <p>{doctor?.familyName}{doctor?.givenName} (인)</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-4 border-t border-gray-300 text-center">
          {/* 🔴 종전 문구 "이 처방전은 전자처방전입니다 · 하단 QR로 검증하십시오" — QR 도 없었고 약국 전송도 없었다(거짓). */}
          {issueQ.data ? (
            <div className="flex items-center justify-center gap-4" data-rx-verify>
              {issueQ.data.qrDataUrl && <img src={issueQ.data.qrDataUrl} alt="진위 확인 QR" className="h-24 w-24" />}
              <div className="text-left text-[11px] text-gray-600">
                <p>진위 확인: QR 또는 {issueQ.data.qrUrl}</p>
                <p>발급번호 {issueQ.data.issueNo}</p>
                {/* 전송하지 않았으면 그렇다고 적는다 — 약국은 이 종이와 진위 확인으로 받는다 */}
                {!issueQ.data.transmission.transmitted && <p data-rx-not-transmitted>종이 처방전 — 약국으로 전자 전송되지 않았습니다</p>}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500" data-rx-no-verify>
              {isDraft ? '서명 전 초안 — 진위 확인 번호가 없습니다' : issueQ.isError ? '발급 기록에 실패해 진위 확인 번호가 없습니다' : '발급 확인 중…'}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">{hospital.name}</p>
        </div>

        {/* 🔴 (P1) 처방 서명은 **처방 id** 로 기록된다(prescription.service recordBlockchainSignature documentId=prescription.id).
            종전엔 진료 id 로 물어 인쇄물 서명 정보가 늘 미서명이었다 — 처방 건별로 묻는다. */}
        {prescriptions.filter((rx: PrintPrescription) => !!rx.id).map((rx: PrintPrescription, i: number, arr: PrintPrescription[]) => (
          <SignedDocumentFooter
            key={rx.id}
            documentType="PRESCRIPTION"
            documentId={rx.id!}
            caption={arr.length > 1 ? `처방 ${i + 1}/${arr.length}` : undefined}
          />
        ))}
      </div>
    </>
  );
}
