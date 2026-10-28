'use client';

import { useMemo } from 'react';
import { genderText, joinPatientName, allergyStatusMeta, allergyStatusIsReassuring, canReadAllergyStatus } from '@hospital-run/shared';
import { PrintDoc, useDocHash, breakKey, CheckCell } from '@/components/print/PrintSheet';
import { KDate } from '@/components/ui/display';
import { useAllergyStatus, type AllergyStatusResult } from '@/components/clinical/allergy-status';
import { useAuthStore } from '@/stores/auth-store';
import { T } from '@/components/ui/i18n-text';
import type { EncounterListItem } from './types';
import { STATUS_CONFIG } from './types';

/**
 * 환자 차트 인쇄본(2026-10-12) — 차트 머리·큰 화면 보기의 '인쇄' 단추가 찍는 문서.
 *
 * 🔴 종전엔 빈 종이였다(공용 문서 CSS 가 인쇄 루트 없이도 body 직계를 숨겼다) → 화면을 찍지 않고 인쇄 전용 문서로.
 * 이 문서가 지키는 것:
 *  · 화면이 이미 읽은 것만 싣는다(새 조회 없음) — 싣지 않은 것은 "이 인쇄본에 싣지 않음"이라 말한다
 *  · 🔴 모르는 것을 "없음"·0 으로 찍지 않는다 — 나이 미상·조회 실패·확인 불가를 그대로
 *  · 알레르기: **확인 상태는 4상태 정본**(`useAllergyStatus` — 차트 머리가 이미 읽은 같은 키) + 환자 정보에 적힌 목록
 *    — 목록이 비어도 '없다'로 찍지 않는다 · 권한 밖·조회 실패·확인 중을 그대로
 *  · 문서 QR 에는 PHI(이름·등록번호·생년월일)를 넣지 않는다 — 종류·버전·환자 UUID·시각·건수만
 */

export interface PatientChartPrintPatient {
  familyName?: string | null; givenName?: string | null; mrn?: string | null;
  dateOfBirth?: string | null; gender?: string | null; bloodType?: string | null; deceasedAt?: string | null;
}

export interface PatientChartPrintProps {
  patientId: string;
  patient: PatientChartPrintPatient;
  /** shared `ageOf` 결과 — null = 나이 미상(0 이 아니다) */
  patientAge: number | null;
  allergies: string[];
  /** 내용 있는 진료 기록(빈 임시 기록 제외) · null = 조회 실패 */
  encounters: EncounterListItem[] | null;
  /** 빈 임시 기록 수 — 표에서 뺀 수 */
  emptyDraftCount: number;
  /** 활성 처방·오더 수 — 서버 요약 · undefined = 확인 불가 */
  activeRxCount?: number;
  orderCount?: number;
  printedAt?: string;
}

const MAX_ROWS = 20;

/** 문서 QR — 🔴 PHI 없음(테스트가 대조) */
export function patientChartQrPayload(p: { patientId: string; at: string; encounters: number | null; allergies: number }) {
  return { t: 'HIS-PATIENT-CHART', v: 1, patient: p.patientId, at: p.at, encounters: p.encounters, allergies: p.allergies };
}

/** 문서 해시 정본 문자열 — 환자 UUID·진료 기록 id·상태 */
export function patientChartCanon(patientId: string, encounters: EncounterListItem[] | null): string {
  return [patientId, ...(encounters ?? []).map((e) => `${e.id}|${e.status}|${e.createdAt}`)].join('\n');
}

const unknown = (k = '확인 불가') => <span data-print-unknown><T k={k} /></span>;

export function PatientChartPrint(props: PatientChartPrintProps) {
  const { patientId, patient, patientAge, allergies, encounters, emptyDraftCount, activeRxCount, orderCount } = props;
  const at = useMemo(() => props.printedAt ?? new Date().toISOString(), [props.printedAt]);
  const hash = useDocHash(useMemo(() => patientChartCanon(patientId, encounters), [patientId, encounters]));
  const name = joinPatientName(patient.familyName, patient.givenName);
  const rows = (encounters ?? []).slice(0, MAX_ROWS);
  // 알레르기 확인 상태 — 4상태 정본(권한 밖이면 부르지 않는다 · 실패를 안전으로 접지 않는다)
  const role = useAuthStore((st) => st.user?.role);
  const allowed = canReadAllergyStatus(role);
  const aq = useAllergyStatus(patientId, allowed);
  const ares = aq.data?.data as AllergyStatusResult | undefined;
  const allergyState: { key: string; text: React.ReactNode } = !allowed
    ? { key: 'NO_PERMISSION', text: <T k="이 역할로는 확인 상태를 볼 수 없습니다 — 아래 목록만 실었습니다." /> }
    : aq.isError ? { key: 'FAILED', text: <T k="확인 상태를 불러오지 못했습니다 — 없다는 뜻이 아닙니다." /> }
    : !ares ? { key: 'LOADING', text: <T k="확인 중" /> }
    : { key: ares.status, text: <><T k={allergyStatusMeta(ares.status).label} />{allergyStatusIsReassuring(ares.status, ares.assessedAt) && ares.assessedAt
        ? <> · <KDate value={ares.assessedAt} mode="date" /></>
        : ares.status === 'NO_KNOWN_ALLERGIES' ? <> · <T k="평가 기록 없음" /></> : null}</> };
  const qr = patientChartQrPayload({ patientId, at, encounters: encounters ? encounters.length : null, allergies: allergies.length });

  return (
    <PrintDoc
      attr="PATIENT_CHART"
      kind={<T k="환자 차트 요약" />}
      code="HIS-PATIENT-CHART v1"
      title={<>{name || <T k="이름 미상" />} {patient.mrn && <span className="dps-key">({patient.mrn})</span>}</>}
      subtitle={<><T k="출력 시각" /> <KDate value={at} mode="datetime" /></>}
      idLine={breakKey(patientId)}
      qr={qr}
      hash={hash} unissued="PENDING_D2"
      legend={<T k="화면이 이미 읽은 내용만 실었습니다 — 처방·검사·간호 기록 전체는 각 탭과 기록 시계열에서 확인합니다. 확인 칸은 검토자가 직접 체크·서명합니다." />}
    >
      <h2><T k="환자 식별" /></h2>
      <table className="dps-kv" data-print-section="IDENTITY">
        <tbody>
          <tr><th><T k="이름" /></th><td>{name || unknown('이름 미상')}</td><th><T k="등록번호" /></th><td className="dps-mono">{patient.mrn || unknown()}</td></tr>
          <tr>
            <th><T k="생년월일" /></th><td>{patient.dateOfBirth ? <KDate value={patient.dateOfBirth} mode="date" /> : unknown()}</td>
            <th><T k="나이" /></th><td data-print-age>{patientAge == null ? unknown('나이 미상') : <>{patientAge}<T k="세" /></>}</td>
          </tr>
          <tr>
            <th><T k="성별" /></th><td><T k={genderText(patient.gender, '미상')} /></td>
            <th><T k="혈액형" /></th><td>{patient.bloodType || unknown('기록 없음')}</td>
          </tr>
          {patient.deceasedAt && <tr><th><T k="사망" /></th><td colSpan={3}><KDate value={patient.deceasedAt} mode="datetime" /></td></tr>}
        </tbody>
      </table>

      <h2><T k="알레르기·주의" /></h2>
      <div className="dps-box" data-print-section="ALLERGY">
        <p data-print-allergy-status={allergyState.key}><b><T k="확인 상태" /></b> — {allergyState.text}</p>
        <p data-print-allergy-list>
          <b><T k="기록된 알레르기" /></b> — {allergies.length > 0 ? allergies.join(' · ') : <span data-print-allergy-unknown><T k="환자 정보에 적힌 항목 없음(확인 상태를 함께 보십시오)" /></span>}
        </p>
        <p className="dps-note"><T k="반응·확인 일시 등 평가 기록 전체는 알레르기 탭에 있습니다." /></p>
      </div>

      <h2><T k="요약" /></h2>
      <table className="dps-kv" data-print-section="SUMMARY">
        <tbody>
          <tr>
            <th><T k="진료 기록" /></th><td>{encounters ? <>{encounters.length}<T k="건" /></> : unknown('조회 실패')}{emptyDraftCount > 0 && <span className="dps-note"> (<T k="빈 임시 기록 제외" /> {emptyDraftCount})</span>}</td>
            <th><T k="활성 처방" /></th><td data-print-rx>{activeRxCount == null ? unknown() : <>{activeRxCount}<T k="건" /></>}</td>
          </tr>
          <tr><th><T k="오더" /></th><td colSpan={3} data-print-orders>{orderCount == null ? unknown() : <>{orderCount}<T k="건" /></>}</td></tr>
        </tbody>
      </table>

      <h2><T k="최근 진료" /></h2>
      {encounters == null ? (
        <p className="dps-box" data-print-encounters-failed><T k="진료 기록을 불러오지 못했습니다 — 기록이 없다는 뜻이 아닙니다." /></p>
      ) : rows.length === 0 ? (
        <p className="dps-box"><T k="내용 있는 진료 기록이 없습니다." /></p>
      ) : (
        <table data-print-section="ENCOUNTERS">
          <colgroup><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: '48%' }} /><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /></colgroup>
          <thead><tr><th><T k="일자" /></th><th><T k="진료의" /></th><th><T k="진단" /></th><th><T k="상태" /></th><th><T k="확인" /></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} data-print-encounter={e.id}>
                <td className="dps-nowrap"><KDate value={e.createdAt} mode="date" /></td>
                <td>{e.doctor ? joinPatientName(e.doctor.familyName, e.doctor.givenName) : '—'}</td>
                <td>{e.diagnoses?.length
                  ? e.diagnoses.map((d, i) => <span key={d.id}>{i > 0 && ' · '}{d.diagnosisCode?.nameKo ?? '—'} <span className="dps-key">{d.diagnosisCode?.code}</span></span>)
                  : <span className="dps-note"><T k="진단 미기재" /></span>}</td>
                <td><T k={STATUS_CONFIG[e.status]?.label ?? e.status} /></td>
                <td><CheckCell /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {encounters && encounters.length > MAX_ROWS && (
        <p className="dps-note" data-print-truncated><T k="최근 진료" /> {MAX_ROWS} / {encounters.length} — <T k="나머지는 진료 이력 탭에서 확인합니다." /></p>
      )}
    </PrintDoc>
  );
}
