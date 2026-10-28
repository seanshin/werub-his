'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { format } from 'date-fns';
import Link from 'next/link';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { nursingNoteSections, BRADEN_RISK_BOUNDS } from '@hospital-run/shared';
import { ApiError } from '@/lib/api-client';

function safeDate(d?: string | null): string {
  if (!d) return '-';
  try { return format(new Date(d), 'yyyy-MM-dd'); } catch { return d.slice(0, 10); }
}
function safeDateTime(d?: string | null): string {
  if (!d) return '-';
  try { return format(new Date(d), 'yyyy-MM-dd HH:mm'); } catch { return d.slice(0, 16); }
}

/**
 * 🔴 (2026-10-07) 서버(`GET inpatient/patient/:id`)는 `admitDate`·`dischargeDate`·`bed.ward.name`·`bed.roomNumber` 를 준다 —
 *    종전엔 `admittedAt`·`dischargedAt`·`ward`·`room` 을 읽어 **날짜가 늘 '-'** 였다(P11). 옛 이름은 대체로만 남긴다.
 */
interface Admission {
  id: string; status: string;
  admitDate?: string; dischargeDate?: string | null; admittedAt?: string; dischargedAt?: string;
  bed?: { roomNumber?: string | null; bedNumber?: string | null; ward?: { name?: string | null } | null } | null;
  ward?: string; room?: string; nursingNoteCount?: number;
}
/** 입원 상태 — AdmissionStatus 어휘 그대로(종전엔 ADMITTED 아니면 전부 '퇴원'이라 취소·전출도 퇴원으로 보였다) */
const ADM_STATUS: Record<string, { label: string; cls: string }> = {
  ADMITTED: { label: '입원중', cls: 'bg-blue-100 text-blue-700' },
  DISCHARGED: { label: '퇴원', cls: 'bg-gray-100 text-gray-600' },
  TRANSFERRED: { label: '전출', cls: 'bg-violet-100 text-violet-700' },
  CANCELLED: { label: '입원 취소', cls: 'bg-rose-50 text-rose-600' },
};
/**
 * 🔴 서버(`GET /admissions/:id/nursing-assessment`)가 실제로 주는 모양만 적는다.
 *    종전에는 여기 없는 `fallRiskScore` 를 읽어 **낙상위험 칸이 개통 이래 항상 `-`** 였고
 *    `>= 45` 강조도 구조적으로 발동할 수 없었다(운영 실측 2026-08-24: `fall_risk_assessment_id`
 *    41행 전건 NULL · 서버 응답 `fallRiskAssessment: null`).
 *    낙상평가는 별도 원장(`fall_risk_assessments` 51행)에 있고 이 관계로는 연결되지 않는다 —
 *    **모르는 것을 `-` 로 말하지 않고 "연계 없음"이라고 말한다.**
 */
interface NursingAssessment {
  id: string; consciousness?: string; mobility?: string; painScore?: number; painLocation?: string;
  bradenScore?: number; nutritionStatus?: string; skinIntegrity?: string; notes?: string; createdAt: string;
  fallRiskAssessment?: { id: string; score?: number; riskLevel?: string; assessedAt?: string } | null;
  nurse?: { familyName?: string; givenName?: string };
}
interface NursingNote { id: string; noteType: string; focus?: string; data?: string; action?: string; response?: string; content?: string; subjective?: string; objective?: string; assessment?: string; plan?: string; education?: string; status?: string; recordedAt?: string; shiftType?: string; createdAt: string; nurse?: { familyName?: string; givenName?: string } }
/** 기록 상태 — 미서명·정정된 원본을 확정 기록처럼 그리지 않는다 */
const NOTE_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: '미서명', cls: 'bg-amber-100 text-amber-800' },
  AMENDED: { label: '정정됨(원본)', cls: 'bg-gray-200 text-gray-600 line-through' },
};
/**
 * 🔴 서버 `IntakeOutput` 원장의 실제 컬럼이다(`intakeType/intakeAmount/outputType/outputAmount/recordedAt`).
 *    종전 이 인터페이스는 `{recordTime, type, category, amount}` 라는 **서버에 없는 이름**을 적어 두었다.
 *    그래서 `filter(i => i.type === 'INTAKE')` 가 언제나 빈 배열이 되어
 *    **섭취 0 mL · 배출 0 mL** 로 표시됐고(운영 실측 2026-08-24: 9입원 92행 = 섭취 36,100 mL ·
 *    배출 37,663 mL), 목록 행은 시각·종류가 빈칸에 `mL` 만 찍혔다. 점 색도 전건 '배출'(amber)이었다.
 *    같은 데이터를 읽는 전용 화면(`/inpatient/[admissionId]/nursing/io`)은 처음부터 이 이름을 쓴다 —
 *    정본이 둘이었고, 이 쪽이 틀렸다.
 * 한 행이 섭취·배출을 **함께** 담을 수 있다(원장 구조). 그래서 합계는 행을 가르지 않고 더한다.
 */
interface IntakeOutput {
  id: string; recordedAt: string;
  intakeType?: string | null; intakeAmount?: number | null; intakeDetail?: string | null;
  outputType?: string | null; outputAmount?: number | null; outputDetail?: string | null;
}
const IO_INTAKE_LABEL: Record<string, string> = { ORAL: '경구', IV: '정맥(IV)', OTHER: '기타' };
const IO_OUTPUT_LABEL: Record<string, string> = { URINE: '소변', DRAIN: '배액', EMESIS: '구토', OTHER: '기타' };
/** 범용 간호기록(외래·응급·PACU·수술·검사·영상) — 입원 정본(NursingNote)과 다른 표다 */
interface UniversalNote {
  id: string; contextType: string; noteType: string; severity?: string | null;
  situation?: string | null; background?: string | null; assessment?: string | null; recommendation?: string | null;
  content?: string | null; shiftType?: string | null; recordedAt?: string | null; createdAt: string;
  nurse?: { familyName?: string; givenName?: string } | null;
}
const CONTEXT_LABEL: Record<string, string> = {
  OUTPATIENT: '외래', EMERGENCY: '응급', PACU: '회복실', SURGERY: '수술', LAB: '검사', IMAGING: '영상', PROCEDURE: '처치',
};

export function NursingRecordTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const user = useAuthStore(s => s.user);
  const isNurse = user?.role === 'NURSE';
  const [selectedAdm, setSelectedAdm] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-admissions-nursing', patientId],
    queryFn: () => apiClient.get<{ data: Admission[] }>(`/api/v1/inpatient/patient/${patientId}`),
    enabled: !!patientId,
  });
  const _raw = data?.data;
  const admissions: Admission[] = Array.isArray(_raw) ? _raw : (_raw as any)?.data ?? [];

  // 선택된 입원의 간호 데이터
  const { data: assessData, isError: assessError, error: assessErr } = useQuery({
    queryKey: ['nursing-assessment', selectedAdm],
    queryFn: () => apiClient.get<any>(`/api/v1/admissions/${selectedAdm}/nursing-assessment`),
    enabled: !!selectedAdm,
    retry: false,
  });
  // 간호 사정이 없으면 서버는 404 — 그것만 "기록 없음"이고 그 밖의 실패는 실패다
  // 전역 예외 필터가 NotFoundException 을 code 'Not Found' 로 낸다(HTTP 상태는 ApiError 에 없다)
  const assessNotFound = assessError && assessErr instanceof ApiError && (assessErr.code === 'Not Found' || assessErr.code === 'NOT_FOUND');
  const { data: notesData, isError: notesError, error: notesErr, refetch: refetchNotes } = useQuery({
    queryKey: ['nursing-notes', selectedAdm],
    queryFn: () => apiClient.get<any>(`/api/v1/admissions/${selectedAdm}/nursing-notes`),
    enabled: !!selectedAdm,
  });
  /**
   * 🔴 간호기록 정본은 **컨텍스트로 갈린다** — 입원=NursingNote · 그 밖=UniversalNursingNote.
   *    종전엔 이 탭이 입원분만 읽어서, 입원 이력이 없는 환자는 간호기록이 하나도 없는 것처럼 보였다
   *    (외래 간호기록은 NURSE 롤 사이드레일에만 나왔다). 환자 차트 본문에서 둘 다 보인다.
   */
  const { data: uniData, isError: uniError, isLoading: uniLoading } = useQuery({
    queryKey: ['universal-nursing-notes', patientId],
    queryFn: () => apiClient.get<{ data: UniversalNote[] }>(`/api/v1/nursing-notes/patient/${patientId}`),
    enabled: !!patientId,
  });
  const _uraw = uniData?.data;
  const universalNotes: UniversalNote[] = Array.isArray(_uraw) ? _uraw : (_uraw as any)?.data ?? [];

  const { data: ioData, isError: ioError, error: ioErr, refetch: refetchIo } = useQuery({
    queryKey: ['nursing-io', selectedAdm],
    queryFn: () => apiClient.get<any>(`/api/v1/admissions/${selectedAdm}/intake-outputs`),
    enabled: !!selectedAdm,
  });

  const assessment: NursingAssessment | null = (assessData?.data as any)?.data ?? assessData?.data ?? null;
  const notes: NursingNote[] = Array.isArray((notesData?.data as any)?.data) ? (notesData?.data as any).data : Array.isArray(notesData?.data) ? notesData?.data as NursingNote[] : [];
  const iosRaw: IntakeOutput[] = Array.isArray((ioData?.data as any)?.data) ? (ioData?.data as any).data : Array.isArray(ioData?.data) ? ioData?.data as IntakeOutput[] : [];
  // 🔴 서버는 오래된 순 — 종전 slice(0,6) 은 입원 첫 6건을 "최근"처럼 보였다. 최신순으로
  const ios = [...iosRaw].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const notesSorted = [...notes].sort((a, b) => Date.parse(b.recordedAt ?? b.createdAt) - Date.parse(a.recordedAt ?? a.createdAt));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900"><T k="간호기록" /></h3>
        {/* 작성 가능성 표기는 탭 상단 CapabilityBadge 정본으로 일원화 */}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : admissions.length === 0 ? (
        <div className="text-center py-8">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
          <p className="text-sm text-gray-400"><T k="입원 간호기록이 없습니다." /></p>
          <p className="text-xs text-gray-300 mt-1"><T k="입원 기록이 없는 환자입니다 — 외래·응급 간호기록은 아래에 표시됩니다." /></p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 입원 목록 */}
          {admissions.map((adm) => {
            const isActive = adm.status === 'ADMITTED';
            const st = ADM_STATUS[adm.status] ?? { label: adm.status, cls: 'bg-gray-100 text-gray-600' };
            const admitAt = adm.admitDate ?? adm.admittedAt;
            const dischargeAt = adm.dischargeDate ?? adm.dischargedAt;
            const wardName = adm.bed?.ward?.name ?? adm.ward;
            const roomNo = adm.bed?.roomNumber ?? adm.room;
            const isSelected = selectedAdm === adm.id;
            return (
              <div key={adm.id}>
                <button onClick={() => setSelectedAdm(isSelected ? null : adm.id)}
                  className={`w-full rounded-xl border p-4 text-left transition-all ${isSelected ? 'border-blue-300 bg-blue-50/50 shadow-sm' : isActive ? 'border-blue-200 bg-blue-50/20 hover:bg-blue-50/40' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${st.cls}`} data-nursing-adm-status={adm.status}>
                        <T k={st.label} />
                      </span>
                      <span className="text-sm text-gray-600" data-nursing-adm-date>{safeDate(admitAt)}{dischargeAt && ` ~ ${safeDate(dischargeAt)}`}</span>
                      {(wardName || roomNo) && <span className="text-xs text-gray-400">{wardName ?? ''} {roomNo && `${roomNo}호`}</span>}
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isSelected ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </button>

                {/* 인라인 간호기록 상세 */}
                {isSelected && (
                  <div className="mt-3 ml-4 space-y-4 border-l-2 border-blue-200 pl-4 pb-2">
                    {/* 간호 사정 */}
                    <Section title={tAttr("간호 사정")} icon="📋" color="blue">
                      {assessError && !assessNotFound ? <QueryErrorFallback error={assessErr} size="compact" /> : assessment ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <InfoCard label="의식" value={assessment.consciousness ?? '-'} />
                          <InfoCard label="이동능력" value={assessment.mobility ?? '-'} />
                          <InfoCard label="통증 (NRS)" value={assessment.painScore != null ? `${assessment.painScore}/10` : '-'} highlight={assessment.painScore != null && assessment.painScore >= 4} />
                          <InfoCard label="영양상태" value={assessment.nutritionStatus ?? '-'} />
                          {/* 강조 기준은 재평가 정본 정책(≤14 = 중등도 이상) — 종전 ≤16 은 어디에도 없는 화면 자체 기준이었다 */}
                          <InfoCard label="Braden 점수" value={assessment.bradenScore != null ? String(assessment.bradenScore) : '-'} highlight={assessment.bradenScore != null && assessment.bradenScore <= BRADEN_RISK_BOUNDS.moderateMax} />
                          {/* 🔴 `-` 는 "위험 없음"으로 읽힌다 — 연계가 없으면 없다고 말한다(있는 낙상평가는 환자안전 바에서 본다) */}
                          <InfoCard
                            label="낙상위험(Morse)"
                            value={assessment.fallRiskAssessment?.score != null ? String(assessment.fallRiskAssessment.score) : '연계 없음'}
                            highlight={assessment.fallRiskAssessment?.score != null && assessment.fallRiskAssessment.score >= 45}
                          />
                          <InfoCard label="피부 상태" value={assessment.skinIntegrity ?? '-'} />
                          <InfoCard label="기록일" value={safeDate(assessment.createdAt)} />
                        </div>
                      ) : <p className="text-xs text-gray-400"><T k="간호 사정 기록 없음" /></p>}
                    </Section>

                    {/* 최근 간호 노트 */}
                    <Section title={tAttr("간호 노트")} icon="📝" color="emerald" count={notes.length}>
                      {notesError ? <QueryErrorFallback error={notesErr} onRetry={() => refetchNotes()} size="compact" /> : notesSorted.length > 0 ? (
                        <div className="space-y-2">
                          {notesSorted.slice(0, 5).map(n => {
                            const ns = n.status ? NOTE_STATUS[n.status] : undefined;
                            const secs = nursingNoteSections(n);
                            return (
                            <div key={n.id} className="bg-gray-50 rounded-lg p-3 text-xs" data-nursing-note={n.id}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-blue-100 text-blue-700">{n.noteType}</span>
                                {ns && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${ns.cls}`} data-nursing-note-status={n.status}><T k={ns.label} /></span>}
                                {n.shiftType && <span className="text-gray-400">{n.shiftType === 'DAY' ? '주간' : n.shiftType === 'EVENING' ? '준야' : '야간'}</span>}
                                {/* 관찰·기록 시각(recordedAt) — 작성 시각(createdAt)이 아니다(늦은 기록이 작성 시각으로 찍히지 않게) */}
                                <span className="text-gray-400 ml-auto">{safeDateTime(n.recordedAt ?? n.createdAt)}</span>
                                {n.nurse && <span className="text-gray-500">{n.nurse.familyName}{n.nurse.givenName}</span>}
                              </div>
                              {secs.length === 0 ? <p className="text-gray-400"><T k="본문 없음" /></p>
                                : secs.map((sec, i) => <p key={i} className="text-gray-600">{sec.label && <strong className="text-gray-500">{sec.label}: </strong>}{sec.text}</p>)}
                            </div>
                            );
                          })}
                          {notesSorted.length > 5 && <p className="text-[11px] text-gray-400"><T k="최근 5건만 보입니다 — 전체는 '간호 노트 전체'에서" /></p>}
                        </div>
                      ) : <p className="text-xs text-gray-400"><T k="간호 노트 없음" /></p>}
                    </Section>

                    {/* I/O 요약 */}
                    <Section title={tAttr("섭취/배출 (I/O)")} icon="💧" color="teal" count={ios.length}>
                      {ioError ? <QueryErrorFallback error={ioErr} onRetry={() => refetchIo()} size="compact" /> : ios.length > 0 ? (
                        <div>
                          <p className="mb-1 text-[11px] text-gray-500"><T k="합계는 이 입원 전체 누적입니다(24시간 수지는 I/O 상세에서)" /></p>
                          <div className="grid grid-cols-2 gap-3 mb-2">
                            <div className="bg-blue-50 rounded-lg p-3 text-center">
                              <p className="text-xs text-blue-600 font-medium"><T k="섭취 (Intake)" /></p>
                              <p className="text-lg font-bold text-blue-800">{ios.reduce((s, i) => s + (i.intakeAmount ?? 0), 0)} mL</p>
                            </div>
                            <div className="bg-amber-50 rounded-lg p-3 text-center">
                              <p className="text-xs text-amber-600 font-medium"><T k="배출 (Output)" /></p>
                              <p className="text-lg font-bold text-amber-800">{ios.reduce((s, i) => s + (i.outputAmount ?? 0), 0)} mL</p>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {ios.length > 6 && <p className="text-[11px] text-gray-400"><T k="최근 6건" /> / {ios.length}</p>}
                            {ios.slice(0, 6).map(io => {
                              /* 🔴 색만으로 섭취/배출을 말하지 않는다(§4.6) — 의미는 원장 컬럼에서 가져온다.
                                 한 행이 섭취·배출을 함께 담을 수 있어 어느 쪽이 기록됐는지로 판정한다.
                                 둘 다 비면 "기록 없음"이라 말한다 — 0 mL 로 접지 않는다. */
                              const hasIn = io.intakeAmount != null;
                              const hasOut = io.outputAmount != null;
                              const kind = hasIn && hasOut ? '섭취·배출' : hasIn ? '섭취' : hasOut ? '배출' : '금액 미기록';
                              const detail = [
                                hasIn ? `섭취 ${io.intakeDetail ?? IO_INTAKE_LABEL[io.intakeType ?? ''] ?? io.intakeType ?? ''} ${io.intakeAmount}mL` : null,
                                hasOut ? `배출 ${io.outputDetail ?? IO_OUTPUT_LABEL[io.outputType ?? ''] ?? io.outputType ?? ''} ${io.outputAmount}mL` : null,
                              ].filter(Boolean).join(' · ');
                              return (
                              <div key={io.id} className="flex items-center gap-2 text-xs text-gray-600">
                                <span
                                  aria-label={kind}
                                  title={kind}
                                  className={`w-1.5 h-1.5 rounded-full ${hasIn && !hasOut ? 'bg-blue-400' : hasOut && !hasIn ? 'bg-amber-400' : hasIn && hasOut ? 'bg-teal-400' : 'bg-gray-300'}`}
                                />
                                <span className="text-gray-400 w-14">{safeDateTime(io.recordedAt).slice(11)}</span>
                                <span className="font-medium ml-auto">{detail || '금액 미기록'}</span>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : <p className="text-xs text-gray-400"><T k="I/O 기록 없음" /></p>}
                    </Section>

                    {/* 상세 보기 링크 */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      {[
                        // 동적 text-${color}-600 클래스는 Tailwind JIT가 못 emit → 정적 클래스 문자열로 고정
                        { href: `/inpatient/${adm.id}/nursing/notes`, label: '간호 노트 전체', cls: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100' },
                        { href: `/inpatient/${adm.id}/nursing/assessment`, label: '간호 사정 상세', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100' },
                        { href: `/inpatient/${adm.id}/nursing/io`, label: 'I/O 상세', cls: 'text-teal-600 bg-teal-50 border-teal-200 hover:bg-teal-100' },
                        { href: `/inpatient/${adm.id}/nursing/mar`, label: 'MAR (투약기록)', cls: 'text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100' },
                      ].map(l => (
                        <Link key={l.href} href={l.href} className={`text-xs font-medium border px-3 py-1.5 rounded-lg transition ${l.cls}`}>
                          {l.label} →
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 외래·응급 등 범용 간호기록 — 입원 정본과 표가 다르므로 구분해서 보여준다 */}
      <div className="mt-6 pt-5 border-t border-gray-100">
        <Section title={tAttr("외래·응급 간호기록")} icon="🩺" color="indigo" count={uniError ? undefined : universalNotes.length}>
          {universalNotes.length > 0 ? (
            <div className="space-y-2">
              {universalNotes.slice(0, 10).map(n => (
                <div key={n.id} className="bg-gray-50 rounded-lg p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-indigo-100 text-indigo-700">
                      {CONTEXT_LABEL[n.contextType] ?? n.contextType}
                    </span>
                    <span className="text-gray-500">{n.noteType}</span>
                    {n.shiftType && <span className="text-gray-400">{n.shiftType === 'DAY' ? '주간' : n.shiftType === 'EVENING' ? '준야' : '야간'}</span>}
                    <span className="text-gray-400 ml-auto">{safeDateTime(n.recordedAt ?? n.createdAt)}</span>
                    {n.nurse && <span className="text-gray-500">{n.nurse.familyName}{n.nurse.givenName}</span>}
                  </div>
                  {n.situation && <p className="text-gray-600"><strong className="text-gray-500">S:</strong> {n.situation}</p>}
                  {n.background && <p className="text-gray-600"><strong className="text-gray-500">B:</strong> {n.background}</p>}
                  {n.assessment && <p className="text-gray-600"><strong className="text-gray-500">A:</strong> {n.assessment}</p>}
                  {n.recommendation && <p className="text-gray-600"><strong className="text-gray-500">R:</strong> {n.recommendation}</p>}
                  {n.content && <p className="text-gray-600 whitespace-pre-wrap">{n.content}</p>}
                </div>
              ))}
              {universalNotes.length > 10 && (
                <p className="text-[11px] text-gray-400">최근 10건만 표시 — 전체 {universalNotes.length}건</p>
              )}
            </div>
          ) : uniLoading ? (
            <p className="text-xs text-gray-400"><T k="불러오는 중..." /></p>
          ) : uniError ? (
            // 🔴 조회 실패를 '없음'이라 말하지 않는다(권한·네트워크 실패가 0건으로 둔갑한다)
            <p className="text-xs text-amber-700"><T k="외래·응급 간호기록을 불러오지 못했습니다 — 건수를 알 수 없습니다." /></p>
          ) : <p className="text-xs text-gray-400"><T k="외래·응급 간호기록 없음" /></p>}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, icon, color, count, children }: { title: string; icon: string; color: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-2">
        <span>{icon}</span> {title}
        {count != null && count > 0 && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{count}</span>}
      </h4>
      {children}
    </div>
  );
}

function InfoCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${highlight ? 'text-red-700' : 'text-gray-800'}`}>{value}</p>
    </div>
  );
}
