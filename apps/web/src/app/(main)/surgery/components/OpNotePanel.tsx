'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  수술기록 보완(SurgeryOpNote) — 다른 화면에 저장할 곳이 없는 항목만 받는다.
 *
 *  🔴 종전 이 패널은 **어느 화면에서도 렌더되지 않는 고아**였고, 그 상태로도
 *     서버와 계약이 어긋나 있었다(2026-08-18 실측):
 *       · `vteProphylaxis` 를 자유 텍스트로 보내 DTO(@IsBoolean)에서 **전건 400** — 아무것도 저장 안 됨
 *       · 400 을 넘겨도 `mallampati`/`npoConfirmed`/`prophylacticAntibiotic`/`signIn`·`timeOut`·`signOut`/
 *         `specimen`/`fluids`/`clavienDindo` **9개 키가 whitelist 에 조용히 지워짐**
 *       · 수정은 `PATCH /surgery-opnote/{surgeryId}` 로 보내는데 서버는 **op note id** 를 받아 항상 404
 *
 *  🔴 그리고 그 항목들은 대부분 **이미 정본 화면이 따로 있다**(정본이 둘이 되면 사고 조사에서
 *     어느 쪽이 사실인지 알 수 없다). 그래서 여기서는 중복 입력을 없애고, 정본이 어디인지 화면에 적는다.
 *       · ASA·Mallampati·NPO·마취계획  → 마취전평가(`PreAnesthesiaEvaluation` · 수술 준비 워크스테이션)
 *       · Sign In / Time Out / Sign Out → 수술안전 체크리스트(`SurgicalChecklist` · 이 화면 위쪽 패널)
 *       · 소견·검체·실혈량·수액·삽입물·배액관·합병증 내용·마취기록 → 이 화면의 'Op Note' 섹션(`Surgery.*`)
 *
 *  남는 것(= 다른 어디에도 저장되지 않던 것)만 여기서 받는다:
 *     보조 집도진(`assistants`) · 절개/봉합 시각 · Clavien-Dindo 등급 · 수술 후 지시.
 */
/* ------------------------------------------------------------------ */

interface OpNotePanelProps {
  surgeryId: string;
  readOnly?: boolean;
}

interface OpNoteAssistant {
  userId: string;
  name?: string;
}

/** 서버가 돌려주는 수술기록 행 — 이 패널이 쓰는 필드만 선언한다(나머지는 정본 화면 소관). */
interface OpNoteRow {
  id: string;
  surgeryId: string;
  assistants?: OpNoteAssistant[] | null;
  incisionTime?: string | null;
  closureTime?: string | null;
  complicationGrade?: string | null;
  postOpOrders?: string | null;
}

interface DoctorOption {
  id: string;
  familyName: string;
  givenName: string;
  department?: string | null;
  isActive?: boolean;
}

/** Clavien-Dindo — 서버 정본 `CLAVIEN_DINDO_GRADES`(surgery-opnote.dto.ts)와 같은 문자열. */
const CLAVIEN_OPTIONS: { value: string; label: string }[] = [
  { value: 'NONE', label: '합병증 없음' },
  { value: 'I', label: 'I — 약물치료만 필요' },
  { value: 'II', label: 'II — 수혈/TPN 등 약물치료' },
  { value: 'IIIa', label: 'IIIa — 국소마취 하 시술' },
  { value: 'IIIb', label: 'IIIb — 전신마취 하 재수술' },
  { value: 'IVa', label: 'IVa — 단일 장기 부전(ICU)' },
  { value: 'IVb', label: 'IVb — 다장기 부전' },
  { value: 'V', label: 'V — 사망' },
];

/** ISO → datetime-local 입력값. 값이 없으면 빈 문자열(= 미기재)이다. */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function OpNotePanel({ surgeryId, readOnly = false }: OpNotePanelProps) {
  const tAttr = useTAttr();
  const qc = useQueryClient();

  /* ── 기존 수술기록 ── 없으면 404 다(아직 안 쓴 것이지 오류가 아니다). */
  const { data: noteRes, isLoading, isError: noteIsError, error: noteError, refetch: refetchNote } = useQuery({
    queryKey: ['surgery-opnote', surgeryId],
    queryFn: () =>
      apiClient
        .get<{ data: OpNoteRow }>(`/api/v1/surgery-opnote/${surgeryId}`)
        // 🔴 404 만 "아직 안 씀"으로 접는다. 나머지 실패를 여기서 삼키면 조회 실패가
        //    "기록 없음"이 되어 이미 서명된 수술기록 위에 새로 쓰게 된다.
        .catch((e) => {
          if (/NOT_FOUND/.test(String((e as { code?: string })?.code ?? ''))) return { data: null as OpNoteRow | null };
          throw e;
        }),
    enabled: !!surgeryId,
  });

  const note: OpNoteRow | null = useMemo(() => {
    const r = noteRes?.data as unknown;
    if (r && typeof r === 'object' && 'data' in (r as Record<string, unknown>)) {
      return ((r as Record<string, unknown>).data ?? null) as OpNoteRow | null;
    }
    return (r ?? null) as OpNoteRow | null;
  }, [noteRes]);

  /* ── 보조 집도진 후보 — 예약 화면과 같은 병원 정본 의사 목록 ── */
  const { data: doctorRes, isLoading: doctorsLoading, isError: doctorsError } = useQuery({
    queryKey: ['surgery-assistant-options'],
    queryFn: () => apiClient.get<{ data: DoctorOption[] }>('/api/v1/users/doctors'),
  });
  const doctorOptions: DoctorOption[] = useMemo(
    () => (Array.isArray(doctorRes?.data) ? doctorRes.data : []).filter((d) => d.isActive !== false),
    [doctorRes],
  );

  const [assistantIds, setAssistantIds] = useState<string[]>([]);
  const [incisionTime, setIncisionTime] = useState('');
  const [closureTime, setClosureTime] = useState('');
  const [complicationGrade, setComplicationGrade] = useState('');
  const [postOpOrders, setPostOpOrders] = useState('');
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  useEffect(() => {
    const key = note ? `${surgeryId}:${note.id}` : `${surgeryId}:new`;
    if (hydratedFor === key) return;
    setAssistantIds(Array.isArray(note?.assistants) ? note!.assistants!.map((a) => a.userId).filter(Boolean) : []);
    setIncisionTime(toLocalInput(note?.incisionTime));
    setClosureTime(toLocalInput(note?.closureTime));
    setComplicationGrade(note?.complicationGrade ?? '');
    setPostOpOrders(note?.postOpOrders ?? '');
    setHydratedFor(key);
  }, [note, surgeryId, hydratedFor]);

  const isUpdate = !!note?.id;

  /* 🔴 시각 역전(봉합이 절개보다 앞)은 저장 전에 막는다 — 원장에 들어가면 사고 조사에서 되돌릴 수 없다. */
  const timeOrderError =
    incisionTime && closureTime && new Date(closureTime).getTime() < new Date(incisionTime).getTime()
      ? '봉합 시각이 절개 시각보다 앞섭니다 — 확인해 주세요.'
      : null;

  const saveMutation = useMutation({
    mutationFn: () => {
      // 키 이름은 전부 컬럼명이다(`SurgeryOpNote`). 빈 값은 '미기재'로 보낸다 — 0/false 로 바꾸지 않는다.
      const body = {
        assistants: assistantIds.map((id) => {
          const d = doctorOptions.find((o) => o.id === id);
          return d ? { userId: d.id, name: `${d.familyName}${d.givenName}` } : { userId: id };
        }),
        incisionTime: incisionTime || undefined,
        closureTime: closureTime || undefined,
        complicationGrade: complicationGrade || undefined,
        postOpOrders: postOpOrders || undefined,
      };
      // 🔴 수정은 **op note id** 로 보낸다(서버 라우트가 `:id`). surgeryId 를 보내면 전건 404 였다.
      return isUpdate
        ? apiClient.patch(`/api/v1/surgery-opnote/${note!.id}`, body)
        : apiClient.post('/api/v1/surgery-opnote', { surgeryId, ...body });
    },
    onSuccess: () => {
      toast.success(isUpdate ? '수술기록 보완이 수정되었습니다' : '수술기록 보완이 저장되었습니다');
      setHydratedFor(null);
      qc.invalidateQueries({ queryKey: ['surgery-opnote', surgeryId] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '수술기록 보완 저장에 실패했습니다'),
  });

  const toggleAssistant = (id: string) =>
    setAssistantIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  if (noteIsError) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-sm font-bold text-gray-900 mb-2"><T k="수술기록" /></p>
        <QueryErrorFallback error={noteError} onRetry={refetchNote} />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="h-6 w-40 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900"><T k="수술기록 보완" /></h2>
        <p className="text-xs text-gray-500 mt-1">
          <T k="보조 집도진 · 절개/봉합 시각 · 합병증 등급(Clavien-Dindo) · 수술 후 지시." />
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          {/* 🔴 키는 한 줄 단위로 쪼갠다 — 여러 줄에 걸치면 개행+들여쓰기가 키에 섞여
              카탈로그와 영원히 매칭되지 않는다(2026-09-09 P3 라운드 4 정규화).
              </b> 뒤 줄바꿈은 JSX 가 공백을 지우므로 렌더 결과는 종전과 같다. */}
          <T k="ASA·기도평가·금식은" /> <b><T k="마취전평가" /></b><T k=", Sign In/Time Out/Sign Out 은 위" /> <b><T k="수술안전 체크리스트" /></b>
          <T k=", 소견·검체·실혈량·수액·삽입물·배액관은 아래" /> <b>Op Note</b> <T k="에 저장됩니다 — 여기서는 중복 입력받지 않습니다." />
        </p>
      </div>

      {/* 보조 집도진 */}
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="보조 집도진 (실제 참여자)" /></label>
        {doctorsLoading ? (
          <p className="text-xs text-gray-400"><T k="의사 목록을 불러오는 중…" /></p>
        ) : doctorsError ? (
          <p className="text-xs text-rose-600">
            <T k="의사 목록을 불러오지 못했습니다 — 목록이 비어서가 아니라" /> <b><T k="조회 실패" /></b><T k="입니다. 다시 시도해 주세요." />
          </p>
        ) : doctorOptions.length === 0 ? (
          <p className="text-xs text-gray-500"><T k="선택 가능한 의사 계정이 없습니다." /></p>
        ) : (
          <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {doctorOptions.map((d) => (
              <label key={d.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assistantIds.includes(d.id)}
                  onChange={() => toggleAssistant(d.id)}
                  disabled={readOnly}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-800">
                  {d.familyName}{d.givenName}
                  {d.department ? <span className="text-gray-400"> · {d.department}</span> : null}
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-1">
          <T k="예약 단계의 보조의(1명)와 별개로," /> <b><T k="실제 집도에 참여한 사람 전원" /></b><T k="을 기록합니다." />
        </p>
      </div>

      {/* 절개 / 봉합 시각 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1"><T k="절개 시각" /></label>
          <input
            type="datetime-local"
            value={incisionTime}
            onChange={(e) => setIncisionTime(e.target.value)}
            disabled={readOnly}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1"><T k="봉합 시각" /></label>
          <input
            type="datetime-local"
            value={closureTime}
            onChange={(e) => setClosureTime(e.target.value)}
            disabled={readOnly}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
        </div>
      </div>
      {timeOrderError && <p className="text-xs text-rose-600">{timeOrderError}</p>}

      {/* 합병증 등급 */}
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="합병증 등급 (Clavien-Dindo)" /></label>
        <select
          value={complicationGrade}
          onChange={(e) => setComplicationGrade(e.target.value)}
          disabled={readOnly}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        >
          <option value=""><T k="미기재" /></option>
          {CLAVIEN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}><T k={o.label} /></option>
          ))}
        </select>
        <p className="text-[11px] text-gray-400 mt-1">
          <T k="&lsquo;미기재&rsquo;와 &lsquo;합병증 없음&rsquo;은 다른 사실입니다 — 판정했을 때만 등급을 고릅니다." />
        </p>
      </div>

      {/* 수술 후 지시 */}
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="수술 후 지시" /></label>
        <textarea
          value={postOpOrders}
          onChange={(e) => setPostOpOrders(e.target.value)}
          disabled={readOnly}
          rows={3}
          placeholder={tAttr('수술 후 지시사항을 기록하세요...')}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 resize-none"
        />
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !!timeOrderError}
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <T k={saveMutation.isPending ? '저장 중...' : isUpdate ? '수술기록 보완 수정' : '수술기록 보완 저장'} />
          </button>
        </div>
      )}
    </div>
  );
}
