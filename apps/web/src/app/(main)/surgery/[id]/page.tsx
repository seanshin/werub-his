'use client';

import { use, useState } from 'react';
import { Unit, Duration, useDurationText } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { MutationError, SURGERY_STATUS_LABEL } from '@hospital-run/shared';
import { safeFormat as format } from '@/lib/safe-date';
import NursingNotePanel from '@/components/nursing/NursingNotePanel';
import OpNotePanel from '../components/OpNotePanel';
import DeviceUsagePanel from '../components/DeviceUsagePanel';
import { SurgicalChecklistPanel } from '../components/SurgicalChecklistPanel';
import { T, useTAttr } from '@/components/ui/i18n-text';

/** 좌우 구분 표시명 — 스키마 `Laterality`. 빈 값은 '미기재'(모르는 것을 아는 것처럼 적지 않는다) */
const LATERALITY_LABEL: Record<string, string> = {
  '': '미기재', LEFT: '좌', RIGHT: '우', BILATERAL: '양측', MIDLINE: '정중선', NA: '해당 없음',
};

interface SurgeryDetail {
  id: string;
  procedureName: string;
  procedureCode?: string;
  /** 해부학적 부위 — 술식명과 **다른 개념**이다(오부위수술 방지) */
  bodySite?: string | null;
  laterality?: string | null;
  status: string;
  scheduledAt: string;
  startedAt?: string;
  endedAt?: string;
  preOpDiagnosis?: string;
  postOpDiagnosis?: string;
  opNote?: string;
  findings?: string;
  complications?: string;
  specimens?: string;
  ebl?: number;
  fluidsGiven?: string;
  implants?: string;
  drains?: string;
  anesthesiaType?: string;
  anesthesiaNote?: string;
  patientId?: string;
  patient?: { id?: string; familyName: string; givenName: string };
  surgeon?: { familyName: string; givenName: string };
  /** 보조의 — 서버가 계정을 수동 조인해 준다(관계 미선언). 지정 안 했거나 계정이 없으면 null */
  assistant?: { id: string; familyName: string; givenName: string; department?: string | null } | null;
}

export default function SurgeryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const fmtDur = useDurationText();
  const tAttr = useTAttr();
  const { id } = use(params);
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['surgery-detail', id],
    queryFn: () => apiClient.get<{ data: SurgeryDetail }>(`/api/v1/surgery/${id}`),
  });

  const [opNote, setOpNote] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  const surgery = data?.data;
  if (surgery && !initialized) {
    setOpNote({
      preOpDiagnosis: surgery.preOpDiagnosis ?? '',
      postOpDiagnosis: surgery.postOpDiagnosis ?? '',
      opNote: surgery.opNote ?? '',
      findings: surgery.findings ?? '',
      complications: surgery.complications ?? '',
      specimens: surgery.specimens ?? '',
      ebl: surgery.ebl?.toString() ?? '',
      fluidsGiven: surgery.fluidsGiven ?? '',
      implants: surgery.implants ?? '',
      drains: surgery.drains ?? '',
      anesthesiaType: surgery.anesthesiaType ?? '',
      anesthesiaNote: surgery.anesthesiaNote ?? '',
    });
    setInitialized(true);
  }

  // 🔴 보내는 키를 **여기서 전부 적는다** — 화면 상태를 통째로 흘려보내면 서버 DTO 에 없는 키가
  //    whitelist 에 조용히 지워져도(성공 응답 + 데이터 소실) 아무도 모른다. `ebl` 은 컬럼이 Int 라
  //    숫자로 보낸다(종전엔 DTO 가 @IsString 이라 실혈량을 적는 순간 Op Note 전체가 400 이었다).
  //    미입력은 0 이 아니라 '미기재'다 — 키를 아예 보내지 않아 기존 값을 지우지 않는다.
  const completeMut = useMutation({
    mutationFn: (note: Record<string, string>) => apiClient.patch(`/api/v1/surgery/${id}/complete`, {
      preOpDiagnosis: note.preOpDiagnosis,
      postOpDiagnosis: note.postOpDiagnosis,
      opNote: note.opNote,
      findings: note.findings,
      complications: note.complications,
      specimens: note.specimens,
      ebl: note.ebl?.trim() ? Number(note.ebl) : undefined,
      fluidsGiven: note.fluidsGiven,
      implants: note.implants,
      drains: note.drains,
      anesthesiaType: note.anesthesiaType,
      anesthesiaNote: note.anesthesiaNote,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['surgery-detail', id] }); toast.success(tAttr('수술 완료 + Op Note 저장됨')); },
    onError: (err: MutationError) => toast.error(err?.message || tAttr('수술 완료 처리 실패')),
  });

  if (isLoading) return <div className="max-w-4xl"><div className="h-64 bg-gray-100 rounded-2xl animate-pulse" /></div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (!surgery) return <p className="text-red-500"><T k="수술 정보를 찾을 수 없습니다." /></p>;

  const STATUS_COLOR: Record<string, string> = { SCHEDULED: 'bg-blue-100 text-blue-700', IN_PROGRESS: 'bg-amber-100 text-amber-700', COMPLETED: 'bg-emerald-100 text-emerald-700' };
  const STATUS_LABEL = SURGERY_STATUS_LABEL;
  const elapsed = surgery.startedAt && surgery.endedAt
    ? Math.round((new Date(surgery.endedAt).getTime() - new Date(surgery.startedAt).getTime()) / 60000)
    : surgery.startedAt ? Math.round((Date.now() - new Date(surgery.startedAt).getTime()) / 60000) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/surgery" className="text-sm text-gray-500 hover:text-indigo-600">&larr; <T k="수술 목록" /></Link>
        <Link href={`/or-chart/${surgery.id}`} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"><T k="수술방 차트" /></Link>
      </div>

      {/* 수술 정보 헤더 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">{surgery.procedureName}</h1>
          <div className="flex items-center gap-3">
            {elapsed !== null && <span className="text-lg font-mono font-bold text-gray-600"><Duration minutes={elapsed} /></span>}
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[surgery.status] ?? ''}`}><T k={STATUS_LABEL[surgery.status] ?? surgery.status} /></span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Info label="환자" value={`${surgery.patient?.familyName}${surgery.patient?.givenName}`} />
          <Info label="집도의" value={`${surgery.surgeon?.familyName}${surgery.surgeon?.givenName}`} />
          {/* 보조의는 이제 저장된다(Surgery.assistantId) — 지정 안 한 것은 '-'(진짜 0)가 아니라 '지정 안 함' */}
          <Info label="보조의" value={surgery.assistant ? `${surgery.assistant.familyName}${surgery.assistant.givenName}` : tAttr('지정 안 함')} />
          <Info label="예정" value={format(new Date(surgery.scheduledAt), 'MM/dd HH:mm')} />
          <Info label="시작" value={surgery.startedAt ? format(new Date(surgery.startedAt), 'HH:mm') : '-'} />
          <Info label="종료" value={surgery.endedAt ? format(new Date(surgery.endedAt), 'HH:mm') : '-'} />
          <Info label="마취" value={surgery.anesthesiaType ?? '-'} />
          <Info label="코드" value={surgery.procedureCode ?? '-'} />
          <Info label="상태" value={tAttr(STATUS_LABEL[surgery.status] ?? surgery.status)} />
        </div>
      </div>

      {/* 수술 안전 체크리스트 (WHO, IPSG.4) */}
      <SurgicalChecklistPanel surgeryId={id} status={surgery.status} />

      {/* 수술 경과기록 타임라인 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4"><T k="수술 경과기록" /></h2>
        <div className="relative pl-6 border-l-2 border-gray-200 space-y-5">
          {/* 예약 */}
          <TimelineItem time={format(new Date(surgery.scheduledAt), 'MM/dd HH:mm')} title={tAttr('수술 예약')} desc={`${surgery.procedureName} (${surgery.procedureCode ?? '-'})`} color="blue" done />

          {/* 수술 전 */}
          {/* 🔴 종전: `수술부위: {procedureName}` — **술식명을 부위로 라벨링**했다. Time-out 은 환자·부위·술식
              **세 가지를 각각** 대조하는 절차인데, 화면이 술식명을 부위 자리에 넣어 "부위를 확인했다"고
              말하고 있었다(오부위수술 방지의 핵심 대조가 화면에서 사라진 것과 같다).
              부위·좌우가 비어 있으면 '미기재'라고 말한다 — 빈칸이 '확인됨'으로 읽히면 안 된다. */}
          <TimelineItem time={surgery.startedAt ? format(new Date(surgery.startedAt), 'HH:mm') : '-'} title={tAttr('수술 전 확인 (Time-out)')}
            desc={`환자 확인: ${surgery.patient?.familyName}${surgery.patient?.givenName} | 술식: ${surgery.procedureName} | 부위: ${surgery.bodySite ?? '미기재'} | 좌우: ${LATERALITY_LABEL[surgery.laterality ?? ''] ?? surgery.laterality ?? '미기재'} | 마취: ${surgery.anesthesiaType ?? '-'}`}
            color="indigo" done={!!surgery.startedAt} />

          {/* 마취 유도 */}
          {surgery.startedAt && (
            <TimelineItem time={format(new Date(surgery.startedAt), 'HH:mm')} title={tAttr('마취 유도 + 절개')}
              desc={`마취 방법: ${surgery.anesthesiaType ?? '-'} | 절개 시작`}
              color="amber" done />
          )}

          {/* 수술 중 경과 */}
          {surgery.startedAt && !surgery.endedAt && (
            <TimelineItem time={tAttr('진행중')} title={tAttr('수술 진행')}
              desc={`경과 ${fmtDur(elapsed)} | 실혈량/수액/합병증 기록은 Op Note에 작성`}
              color="amber" active />
          )}

          {/* 수술 종료 */}
          {surgery.endedAt && (
            <TimelineItem time={format(new Date(surgery.endedAt), 'HH:mm')} title={tAttr('수술 종료 (봉합)')}
              desc={`수술 시간: ${surgery.startedAt ? Math.round((new Date(surgery.endedAt).getTime() - new Date(surgery.startedAt).getTime()) / 60000) : '-'}분 | EBL: ${surgery.ebl ?? '-'} mL`}
              color="emerald" done />
          )}

          {/* 회복실 이동 */}
          {surgery.endedAt && (
            <TimelineItem time={format(new Date(new Date(surgery.endedAt).getTime() + 10 * 60000), 'HH:mm')} title={tAttr('회복실 이동 (PACU)')}
              desc={tAttr('마취 회복 모니터링 | 통증 관리 | 활력징후 안정 확인')}
              color="emerald" done />
          )}

          {/* 미완료 */}
          {!surgery.startedAt && (
            <TimelineItem time="-" title={tAttr('수술 대기')} desc={tAttr('수술 시작 버튼을 눌러 진행하세요')} color="gray" />
          )}
        </div>
      </div>

      {/* Op Note (구조화 15필드) */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4"><T k="수술 기록 (Op Note)" /></h2>

        {surgery.status === 'COMPLETED' && surgery.opNote ? (
          /* 조회 모드 */
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <ViewField label="수술 전 진단" value={surgery.preOpDiagnosis} />
              <ViewField label="수술 후 진단" value={surgery.postOpDiagnosis} />
            </div>
            <ViewField label="수술 소견 (Findings)" value={surgery.findings} />
            <ViewField label="수술 상세 기술" value={surgery.opNote} />
            <div className="grid grid-cols-3 gap-4">
              <ViewField label="검체 (Specimens)" value={surgery.specimens} />
              <ViewField label="추정 실혈량" value={surgery.ebl ? `${surgery.ebl} mL` : '-'} />
              <ViewField label="수액/수혈" value={surgery.fluidsGiven} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <ViewField label="삽입물 (Implants)" value={surgery.implants} />
              <ViewField label="배액관 (Drains)" value={surgery.drains} />
              <ViewField label="합병증" value={surgery.complications} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ViewField label="마취 방법" value={surgery.anesthesiaType} />
              <ViewField label="마취 기록" value={surgery.anesthesiaNote} />
            </div>
          </div>
        ) : (
          /* 작성 모드 */
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="수술 전 진단" k="preOpDiagnosis" value={opNote} onChange={setOpNote} />
              <Field label="수술 후 진단" k="postOpDiagnosis" value={opNote} onChange={setOpNote} />
            </div>
            <TextArea label="수술 소견 (Findings)" k="findings" value={opNote} onChange={setOpNote} />
            <TextArea label="수술 상세 기술 (Operative Note)" k="opNote" value={opNote} onChange={setOpNote} rows={5} />
            <div className="grid grid-cols-3 gap-4">
              <Field label="검체 (Specimens)" k="specimens" value={opNote} onChange={setOpNote} />
              <Field label="추정 실혈량 (mL)" k="ebl" value={opNote} onChange={setOpNote} type="number" />
              <Field label="수액/수혈" k="fluidsGiven" value={opNote} onChange={setOpNote} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="삽입물 (Implants)" k="implants" value={opNote} onChange={setOpNote} />
              <Field label="배액관 (Drains)" k="drains" value={opNote} onChange={setOpNote} />
              <Field label="합병증" k="complications" value={opNote} onChange={setOpNote} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="마취 방법" k="anesthesiaType" value={opNote} onChange={setOpNote} />
              <TextArea label="마취 기록" k="anesthesiaNote" value={opNote} onChange={setOpNote} />
            </div>
            <button onClick={() => completeMut.mutate(opNote)} disabled={completeMut.isPending}
              className="px-6 py-2.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              <T k={completeMut.isPending ? '저장중...' : '수술 완료 + Op Note 저장'} />
            </button>
          </div>
        )}
      </div>

      {/* 수술기록 보완 — 다른 화면에 저장할 곳이 없던 항목(보조 집도진·절개/봉합 시각·Clavien-Dindo·수술 후 지시).
          🔴 종전에는 이 패널이 어디에도 렌더되지 않아 `SurgeryOpNote` 가 화면에서 도달 불가였다. */}
      <OpNotePanel surgeryId={id} />

      {/* 삽입 기기(UDI) — Op Note '삽입물' 자유 텍스트와 별개 원장. 리콜 역추적의 근거 데이터(R5) */}
      <DeviceUsagePanel surgeryId={id} patientId={surgery.patientId || surgery.patient?.id || null} />

      {/* 간호 기록 */}
      {(surgery.patientId || surgery.patient?.id) && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <NursingNotePanel patientId={(surgery.patientId || surgery.patient?.id)!} contextType="SURGERY" contextId={surgery.id} compact />
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-gray-400 font-medium mb-0.5"><T k={label} /></p>
      <p className="text-sm font-medium text-gray-900">{value || '-'}</p>
    </div>
  );
}

function ViewField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400 font-medium mb-0.5"><T k={label} /></p>
      <p className="text-sm text-gray-900 whitespace-pre-wrap">{value || '-'}</p>
    </div>
  );
}

function Field({ label, k, value, onChange, type = 'text' }: { label: string; k: string; value: Record<string, string>; onChange: (v: Record<string, string>) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1"><T k={label} /></label>
      <input type={type} value={value[k] ?? ''} onChange={e => onChange({ ...value, [k]: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
    </div>
  );
}

function TextArea({ label, k, value, onChange, rows = 3 }: { label: string; k: string; value: Record<string, string>; onChange: (v: Record<string, string>) => void; rows?: number }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1"><T k={label} /></label>
      <textarea value={value[k] ?? ''} onChange={e => onChange({ ...value, [k]: e.target.value })} rows={rows} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
    </div>
  );
}

const DOT_COLOR: Record<string, string> = {
  blue: 'bg-blue-500', indigo: 'bg-indigo-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500', gray: 'bg-gray-300',
};

function TimelineItem({ time, title, desc, color = 'gray', done, active }: { time: string; title: string; desc: string; color?: string; done?: boolean; active?: boolean }) {
  const tAttr = useTAttr();
  return (
    <div className="relative">
      {/* 🔴 색만으로 단계 진행을 말하지 않는다(§4.6) — 의미는 색이 아니라 active/done 에서 가져온다.
          done 은 boolean|undefined 라 "아직 아니다"와 "모른다"가 같은 회색이 된다 → 3상태로 말한다 */}
      <div aria-label={tAttr(active ? '진행 중' : done === true ? '완료' : done === false ? '미도달' : '기록 없음')}
        title={tAttr(active ? '진행 중' : done === true ? '완료' : done === false ? '미도달' : '기록 없음')}
        className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 border-white ${active ? DOT_COLOR[color] + ' animate-pulse' : done ? DOT_COLOR[color] : 'bg-gray-200'}`} />
      <div className={`${active ? 'bg-amber-50 border border-amber-200' : ''} rounded-lg ${active ? 'p-3' : ''}`}>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-mono text-gray-400">{time}</span>
          <span className={`text-sm font-semibold ${done || active ? 'text-gray-900' : 'text-gray-400'}`}><T k={title} /></span>
          {active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 animate-pulse">LIVE</span>}
        </div>
        <p className={`text-xs ${done || active ? 'text-gray-600' : 'text-gray-400'}`}>{desc}</p>
      </div>
    </div>
  );
}
