'use client';

import { useState } from 'react';
import { genderText, PatientName } from '@/components/ui/display';
import { sanctionedPrint, auditNewWindowPrint } from '@/components/print/PrintGuard';

import Link from 'next/link';
import { GENDER_LABEL, INSURANCE_LABEL, buildPatientQr } from '@hospital-run/shared';
import { TAG_COLORS, DEFAULT_TAG_COLOR, RELATIONSHIP_LABEL } from '@/lib/patient-constants';
import { apiClient } from '@/lib/api-client';
import { escapeHtml } from '@/lib/escape-html';
import { usePatientTabStore } from '@/stores/patient-tab-store';
import type { PatientContact } from '@/types/patient';
import { PatientFlagBar } from './PatientFlagBar';
import { ForeignCareBadges } from './ForeignCareBadges';
import { kdate } from '@/lib/ui-settings';
import { QuickVitalsModal, QuickNursingNoteModal } from './QuickClinicalEntry';
import { qrDataUrl } from '@/components/ui/QrImage';
import { AllergyStatusBadge, useAllergyStatus } from '@/components/clinical/allergy-status';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface PatientHeaderProps {
  patient: Record<string, any>;
  patientId: string;
  /** 진료 시작 노출 판단 — 진료 생성은 서버가 DOCTOR/ADMIN 전용(그 외 역할은 눌러야 403) */
  userRole?: string;
  /** 비의사 1차 행동 '차트 보기' — 진료 이력 탭으로 */
  onViewChart?: () => void;
  /** 약사 — 복약·처방 검토 탭 */
  onReviewMedications?: () => void;
  /** 임상병리사 — 검사 결과 탭 */
  onViewLabs?: () => void;
  /** 🔴 나이 미상은 `null` — 0(신생아)과 다른 사실이다(정본 shared `ageOf`) */
  patientAge: number | null;
  allergies: string[];
  patientTags: string[];
  primaryContact?: PatientContact;
  residentNumberMasked?: string;
  onEditClick: () => void;
  onDeceasedClick: () => void;
  /** 🔴 응급 미확인 환자 신원 확인(임시→실명) — EMERGENCY_UNKNOWN 일 때만 노출 */
  onIdentifyClick?: () => void;
  /** 우상단 도구(외부 앱·디지털 트윈·인쇄) — 이름 행 flex 에 편입(absolute 오버레이는 좁은 폭에서 배지와 겹친다·2026-08-04) */
  headerTools?: React.ReactNode;
}

export function PatientHeader({
  patient,
  patientId,
  userRole,
  onViewChart,
  onReviewMedications,
  onViewLabs,
  patientAge,
  allergies,
  patientTags,
  primaryContact,
  residentNumberMasked,
  onEditClick,
  onDeceasedClick,
  onIdentifyClick,
  headerTools,
}: PatientHeaderProps) {
  const tAttr = useTAttr();
  const [showVitals, setShowVitals] = useState(false);
  const [showNursingNote, setShowNursingNote] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // 🔴 팔찌에 알레르기 **확인 상태**를 찍기 위해 헤더 배지와 같은 정본을 읽는다
  const { data: allergyStatusRes } = useAllergyStatus(patientId);
  /**
   * 팔찌에 찍을 알레르기 줄.
   * 🔴 팔찌는 **투약 전에 확인하는 물건**이다(IPSG.1). 종전엔 알레르기가 0건이면 줄을 아예 안 찍어
   *    "확인했고 없음"과 "아무도 물어보지 않음"이 **똑같이 빈칸**이었다.
   */
  const wristbandAllergyLine = (): string => {
    if (allergies.length > 0) {
      return '<div class="warn">알레르기: ' + escapeHtml(allergies.join(', ')) + '</div>';
    }
    const st = allergyStatusRes?.data as { status?: string; assessedAt?: string | null } | undefined;
    if (st?.status === 'NO_KNOWN_ALLERGIES' && st?.assessedAt) {
      return '<div class="info">알레르기: 확인함 · 없음(NKDA)</div>';
    }
    // 🔴 모르면 모른다고 찍는다 — 빈칸은 "없음"으로 읽힌다
    return '<div class="warn">알레르기: 확인되지 않음 — 투약 전 확인 필요</div>';
  };

  /**
   * QR 팔찌 인쇄 — 원문 이관(더보기로 이동·escapeHtml XSS 방지 유지).
   *
   * 🔴 2026-08-18 봉합 2건:
   *  ① QR 이미지를 외부 `api.qrserver.com` 에서 받아왔다 — **MRN·성명·생년월일·성별이
   *     외부 서버의 URL 쿼리(접근 로그)로 유출**되고, 폐쇄망에서는 팔찌 QR 이 빈칸으로 인쇄됐다.
   *     → 로컬 생성(`qrDataUrl`)으로 전환. 내용은 브라우저 밖으로 나가지 않는다.
   *  ② 페이로드가 `{"t":"PATIENT","mrn":…}` JSON 이라 BCMA 소비측(MRN 완전일치)이
   *     **항상 `BCMA_PATIENT_MISMATCH`** 였다. → 발급 정본 `buildPatientQr`(MRN)로 통일.
   *     QR 에서 성명·생년월일·성별을 뺀다(PHI 최소화 — 두 번째 식별자는 팔찌 인쇄 텍스트가 담당).
   */
  const printWristband = async () => {
    auditNewWindowPrint(`wristband:${patientId}`); // 🔴 PHI 팔찌 — 새 창 인쇄 감사(가드 밖 경로)
    const qrData = buildPatientQr(patient.mrn);
              // 팝업은 클릭 제스처 안에서 먼저 연다(await 뒤에 열면 팝업 차단).
              const w = window.open('', '_blank', 'width=400,height=500');
              const qrUrl = await qrDataUrl(qrData, 150, 1);
              if (w) {
                if (!qrUrl) {
                  w.document.write('<html><body style="font-family:sans-serif;padding:20px;text-align:center;color:#dc2626">QR 생성에 실패했습니다. 팔찌를 인쇄하지 마세요.</body></html>');
                  return;
                }
                // 환자 유래 값은 전부 escapeHtml — 인쇄 팝업 document.write XSS 방지
                w.document.write(`<html><head><title>환자 팔찌</title><style>body{font-family:sans-serif;text-align:center;padding:15px;margin:0} .band{border:2px solid #333;padding:15px;display:inline-block;border-radius:12px;max-width:300px} .name{font-size:18px;font-weight:bold;margin:8px 0 2px} .info{font-size:12px;color:#666;margin:2px 0} .mrn{font-size:14px;font-weight:bold;color:#2563eb;margin:4px 0} .warn{font-size:10px;color:#dc2626;margin-top:8px;padding:4px 8px;background:#fef2f2;border-radius:4px;display:inline-block} @media print{body{margin:0}}</style></head><body><div class="band"><img src="${escapeHtml(qrUrl)}" width="150" height="150" /><div class="name">${escapeHtml(`${patient.familyName}${patient.givenName}`)}</div><div class="mrn">${escapeHtml(patient.mrn)}</div><div class="info">${patient.dateOfBirth ? kdate(patient.dateOfBirth) : ''} · ${genderText(patient.gender)}</div><div class="info">${patient.bloodType ? '혈액형: ' + escapeHtml(patient.bloodType) : ''}</div>${wristbandAllergyLine()}<div class="info" style="margin-top:10px;font-size:9px;color:#999">위루비병원 · JCI IPSG.1</div></div><script>setTimeout(()=>window.print(),500)</script></body></html>`);
              }
  };
  const boardEnabled = usePatientTabStore((s) => s.boardEnabled);
  const toggleBoard = usePatientTabStore((s) => s.toggleBoard);
  const borderColor = patient.isDeceased
    ? 'border-l-4 border-l-gray-400'
    : allergies.length > 0
      ? 'border-l-4 border-l-red-500'
      : 'border-l-4 border-l-blue-500';

  return (
    <div className={`bg-white rounded-2xl shadow-sm ${borderColor} border-y border-r border-gray-100 p-5`}>
      <div className="flex items-start gap-4">
        {patient.photoUrl ? (
          <img
            src={`${process.env.NEXT_PUBLIC_API_URL || ''}${patient.photoUrl}`}
            alt={`${patient.familyName}${patient.givenName}`}
            className="w-14 h-14 rounded-2xl object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {/* 이름 줄 + 알레르기 인라인 배지 */}
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-gray-900">
              {/* 외국인 — 원어 이름(띄어쓰기 정본)과 한국식 호칭을 함께 */}
              <PatientName familyName={patient.familyName} givenName={patient.givenName} koreanName={patient.koreanName} showMrn={false} />
            </h2>
            <span className="text-sm text-gray-500">
              ({GENDER_LABEL[patient.gender] ?? patient.gender}{patientAge != null ? `, ${patientAge}세` : ', 나이 미상'})
            </span>
            {patient.bloodType && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 whitespace-nowrap">
                {patient.bloodType}
              </span>
            )}
            {patient.isDeceased && (
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-200 text-gray-500 whitespace-nowrap"><T k="사망" /></span>
            )}
            {/* 🔴 서버 4상태 정본을 그대로 말한다. 종전엔 `allergies.length === 0` 을 초록 `NKDA`
                (= "물어봤고 없었다")로 단언했는데, 운영에서 평가를 받은 환자는 **0명**이었다
                — 874명 중 862명이 근거 없는 초록을 달고 있었다(2026-08-26). */}
            <AllergyStatusBadge patientId={patientId} allergyCount={allergies.length} />
            <ForeignCareBadges patient={patient} />
            <PatientFlagBar patientId={patientId} />
            {/* 우상단 도구 — 같은 flex 행의 ml-auto 라 좁아지면 겹치지 않고 다음 줄로 흐른다 */}
            {headerTools && <div className="ml-auto flex items-center gap-2 no-print">{headerTools}</div>}
          </div>

          {/* MRN · 보험 · 혈액형 · 주민번호 한 줄 */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="text-xs font-mono text-gray-500">MRN: {patient.mrn}</span>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-500 whitespace-nowrap">{INSURANCE_LABEL[patient.insuranceType] ?? patient.insuranceType}</span>
            {/* 소득분위 — 본인부담상한 산정 근거. 응답에 있으나 화면에 없던 값(2026-07) */}
            {patient.incomeDecile != null && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500" title={tAttr("본인부담상한제 산정에 사용되는 소득분위")}>
                  소득 {patient.incomeDecile}분위
                </span>
              </>
            )}
            {patient.bloodType && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500">혈액형: {patient.bloodType}</span>
              </>
            )}
            {residentNumberMasked && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-400 font-mono">{residentNumberMasked}</span>
              </>
            )}
          </div>

          {/* 알레르기 상세 목록 */}
          {allergies.length > 0 && (
            <div className="mt-2 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 flex items-center gap-2 flex-wrap">
              <svg className="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              {allergies.map((a, i) => (
                <span key={i} className="text-xs text-red-700 font-medium whitespace-nowrap">{a}{i < allergies.length - 1 ? ',' : ''}</span>
              ))}
            </div>
          )}

          {/* Tags */}
          {patientTags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {patientTags.map((tag) => {
                const color = TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
                return (
                  <span key={tag} className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap ${color.bg} ${color.text}`}>
                    {tag}
                  </span>
                );
              })}
            </div>
          )}

          {/* Primary contact */}
          {primaryContact && (
            <p className="text-xs text-gray-500 mt-2">
              <span className="text-gray-400"><T k="보호자:" /></span>{' '}
              {primaryContact.name} ({RELATIONSHIP_LABEL[primaryContact.relationship] ?? primaryContact.relationship}) {primaryContact.phone}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-start justify-between gap-2 mt-3 pt-3 border-t border-gray-50">
        {/* 좁아지면 버튼 단위로 줄바꿈 — nowrap 없이는 한글이 글자 단위로 세로 꺾인다(2026-08-03 제보) */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 진료 시작은 의사의 1차 행동 — 서버도 DOCTOR/ADMIN 전용이라 다른 역할에겐
              눌러야 403 인 버튼이었다. 간호사·약사 등의 1차 행동은 '차트 보기'(진료 이력 열람). */}
          {(userRole === 'DOCTOR' || userRole === 'ADMIN' || !userRole) ? (
            <Link
              href={`/patients/${patientId}/encounter/new`}
              className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-blue-600 text-white text-xs font-medium rounded-xl hover:bg-blue-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <T k="진료 시작" />
            </Link>
          ) : (
            /* 비의사 — 각자의 권한에 맞는 **작성** 진입(2026-08-03 결정). 서버 실권한과 1:1:
               NURSE=활력·외래 간호기록 직접 작성 / PHARMACIST=복약 검토(복약지도는 조제 단위 — 워크스테이션)
               / LAB_TECH=결과 열람(입력은 오더 단위 — 검사실). 차트 보기는 공통. */
            <>
              {userRole === 'NURSE' && (
                <>
                  <button onClick={() => setShowVitals(true)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-emerald-600 text-white text-xs font-medium rounded-xl hover:bg-emerald-700 transition-colors">
                    <T k="➕ 활력 입력" />
                  </button>
                  <button onClick={() => setShowNursingNote(true)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-xl hover:bg-emerald-100 transition-colors">
                    <T k="📝 간호기록" />
                  </button>
                </>
              )}
              {userRole === 'PHARMACIST' && (
                <button onClick={onReviewMedications}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-emerald-600 text-white text-xs font-medium rounded-xl hover:bg-emerald-700 transition-colors"
                  title={tAttr("활성 처방·상호작용 검토 — 복약지도 기록은 조제 단위(약국 워크스테이션)")}>
                  <T k="💊 복약·처방 검토" />
                </button>
              )}
              {userRole === 'LAB_TECH' && (
                <button onClick={onViewLabs}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-emerald-600 text-white text-xs font-medium rounded-xl hover:bg-emerald-700 transition-colors"
                  title={tAttr("검사 결과 열람 — 결과 입력은 오더 단위(검사실 워크스테이션)")}>
                  <T k="🧪 검사 결과" />
                </button>
              )}
              <button
                onClick={onViewChart}
                className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-blue-600 text-white text-xs font-medium rounded-xl hover:bg-blue-700 transition-colors"
                title={tAttr("의사 작성 진료 기록(SOAP·처방·진단) 열람 — 열람은 감사에 기록됩니다")}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                <T k="차트 보기" />
              </button>
            </>
          )}
          <Link
            href={`/schedule?patientId=${patientId}`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-xl hover:bg-gray-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <T k="예약" />
          </Link>
          <button
            onClick={() => {
              // 메모리의 살아있는 토큰 우선(refresh 로 갱신된 최신). localStorage 는 fallback.
              const t = apiClient.getToken() || localStorage.getItem('accessToken') || '';
              window.open(`/record-timeline/patient/${patientId}#auth=${encodeURIComponent(t)}`, 'record-timeline', 'width=1280,height=900,resizable=yes,scrollbars=yes');
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-xl hover:bg-indigo-100 transition-colors"
            title={tAttr("진료·간호·검사·영상·처방·활력·수술·입퇴원을 한 시간축에서 열람(새 창)")}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <T k="기록 시계열" />
          </button>
          {/* 외부 앱(SMART) 은 우상단 디지털 트윈 옆으로 이동(2026-08-04 요청) — page.tsx 클러스터 */}
          {/* 부가 도구는 더보기로 — 1열 과밀이 좁은 폭에서 버튼 글자를 세로로 꺾었다(2026-08-03 제보) */}
          <div className="relative">
            <button onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}
              className="inline-flex items-center gap-1 px-3 py-2 whitespace-nowrap bg-gray-100 text-gray-600 text-xs font-medium rounded-xl hover:bg-gray-200 transition-colors">
              <T k="더보기 ▾" />
            </button>
            {showMore && (
              <div className="absolute right-0 z-30 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg" onMouseLeave={() => setShowMore(false)}>
                <button onClick={() => { setShowMore(false); onEditClick(); }} className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"><T k="✏️ 환자정보 편집" /></button>
                <button onClick={() => { setShowMore(false); void printWristband(); }} className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"><T k="🏷 QR 팔찌 인쇄" /></button>
                <Link href={`/tablet/patients/${patientId}`} className="block px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"><T k="📱 타블렛 모드" /></Link>
                <button onClick={() => { setShowMore(false); toggleBoard(); }} className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">🖥 {boardEnabled ? '일반 화면으로' : '큰 화면(멀티패널)'}</button>
              </div>
            )}
          </div>

        </div>
        {/* 🔴 응급 미확인 → 신원 확인(임시→실명) — 등록 화면이 가리키던 버튼(종전 미배선) */}
        {patient.patientSource === 'EMERGENCY_UNKNOWN' && onIdentifyClick && (
          <button
            onClick={onIdentifyClick}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
            <T k="신원 확인" />
          </button>
        )}
        {/* 우측: 사망 처리 (특수 기능) */}
        {!patient.isDeceased && (
          <button
            onClick={onDeceasedClick}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[11px] text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            <T k="사망 처리" />
          </button>
        )}
      </div>
      {showVitals && <QuickVitalsModal patientId={patientId} onClose={() => setShowVitals(false)} />}
      {showNursingNote && <QuickNursingNoteModal patientId={patientId} onClose={() => setShowNursingNote(false)} />}
    </div>
  );
}
