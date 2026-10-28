'use client';

/**
 * 응급 미확인 환자 등록 — 임시 ID + 도착 상황 첫 기록.
 *
 * 🔴 2026-09-29: 종전 "도착 상황 메모"·"손상 유형"은 API 가 검증하고 **저장 직전에 버렸다**(개통 이래 기록 0 · 보여주는 화면도 없었다).
 *    이제 구조화 기록(`EmergencyArrivalNote` INITIAL)으로 남기고, 등록 후 환자 상세에서 이어서 **추가 기록**(덧붙임)한다.
 * 모든 칸은 미선택으로 시작 · 모르는 것은 비워 둔다.
 * 119·전원 사전통보가 있으면 불러와 **초안**으로 채운다(사람이 확인하고 고친다) — 통보의 도착 처리는 체크한 경우만(자동으로 닫지 않는다).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { arrivalNoteHasContent } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { ArrivalNoteFields, EMPTY_ARRIVAL, toArrivalPayload, type ArrivalDraft } from './ArrivalNoteFields';

interface Prenotification {
  id: string; source: string; unitId: string | null; etaRemainingMins: number | null; patientAge: number | null; patientGender: string | null;
  chiefComplaint: string; severityHint: string | null; note: string | null; receivedAt: string;
}

/** 사전통보 성별 표기(자유 문자열) → 등록 성별 — 모르면 바꾸지 않는다 */
function genderOf(g: string | null): 'MALE' | 'FEMALE' | null {
  const t = (g ?? '').trim().toUpperCase();
  if (t === 'M' || t === 'MALE' || t === '남' || t === '남성') return 'MALE';
  if (t === 'F' || t === 'FEMALE' || t === '여' || t === '여성') return 'FEMALE';
  return null;
}

export default function EmergencyUnknownRegisterPage() {
  const tA = useTAttr();
  const router = useRouter();
  const [gender, setGender] = useState<'UNKNOWN' | 'MALE' | 'FEMALE'>('UNKNOWN');
  const [estimatedAge, setEstimatedAge] = useState('');
  const [arrival, setArrival] = useState<ArrivalDraft>(EMPTY_ARRIVAL);
  const payload = toArrivalPayload(arrival);
  const hasArrival = arrivalNoteHasContent(payload);
  // 119·전원 사전통보(이송 중) — 고르면 초안으로 채운다
  const preQ = useQuery({
    queryKey: ['er-prenotifications'],
    queryFn: () => apiClient.get<{ data: Prenotification[] }>('/api/v1/emergency/prenotifications'),
  });
  const [preId, setPreId] = useState<string | null>(null);
  const [markArrived, setMarkArrived] = useState(false);
  const pickPre = (p: Prenotification) => {
    setPreId(p.id);
    setMarkArrived(false);
    const g = genderOf(p.patientGender);
    if (g) setGender(g);
    if (p.patientAge != null) setEstimatedAge(String(p.patientAge));
    setArrival({
      ...EMPTY_ARRIVAL,
      arrivalMode: p.source === 'EMS_119' ? 'AMBULANCE_119' : p.source === 'TRANSFER' ? 'TRANSFER' : null,
      emsUnit: p.unitId ?? '',
      circumstance: `${tA('사전통보 주호소')}: ${p.chiefComplaint}${p.severityHint ? ` · ${tA('구급대 추정 중증도')}: ${p.severityHint}` : ''}`,
      note: p.note ?? '',
      infoSource: 'EMS',
    });
  };

  const submit = useMutation({
    mutationFn: () => apiClient.post<{ data: { id: string; mrn: string; givenName: string; arrivalNoteId: string | null } }>('/api/v1/patients/emergency-unknown', {
      gender,
      estimatedAge: estimatedAge ? parseInt(estimatedAge, 10) : undefined,
      arrival: hasArrival ? payload : undefined,
      prenotificationId: preId ?? undefined,
      markPrenotificationArrived: preId ? markArrived : undefined,
    }),
    onSuccess: (res) => {
      const p = res.data;
      toast.success(`${tA('응급 미확인 환자 등록 완료')} — ${p.mrn} (${p.givenName})${p.arrivalNoteId ? '' : ` · ${tA('도착 상황 기록 없음')}`}`);
      // 등록한 환자로 — 도착 상황을 이어서 추가 기록할 수 있다
      router.push(`/patients/${p.id}`);
    },
    onError: () => toast.error(tA('등록 실패')),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="응급 미확인 환자 등록" /></h1>
        <p className="mt-0.5 text-sm text-gray-500"><T k="의식불명/신원미상 환자 — 임시 ID가 자동 부여됩니다" /></p>
      </div>

      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-700">🚨 <T k="응급 미확인 환자" /></div>
        <p className="text-xs text-red-600">
          <T k="신원 확인이 불가능한 환자를 임시로 등록합니다. 도착 상황은 아는 만큼만 적고, 나중에 알게 된 사실은 환자 상세의 「도착 상황 기록」에 추가 기록으로 덧붙입니다(처음 기록은 고치지 않습니다). 신원이 확인되면 환자 상세의 「신원 확인」으로 정보를 갱신하세요." />
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_1fr]">
        {/* 좌: 최소 정보 + 제출 */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900"><T k="최소 정보" /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600"><T k="성별 (추정)" /></label>
                <select value={gender} onChange={(e) => setGender(e.target.value as typeof gender)} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm">
                  <option value="UNKNOWN">{tA('미상')}</option>
                  <option value="MALE">{tA('남성')}</option>
                  <option value="FEMALE">{tA('여성')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600"><T k="추정 연령" /></label>
                <input type="number" value={estimatedAge} onChange={(e) => setEstimatedAge(e.target.value)} placeholder={tA('예: 40')} min="0" max="120"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] text-gray-500">
              {hasArrival ? <T k="도착 상황이 첫 기록으로 함께 저장됩니다." /> : <T k="도착 상황을 적지 않으면 기록 없이 등록됩니다(나중에 추가할 수 있습니다)." />}
            </p>
            <button onClick={() => submit.mutate()} disabled={submit.isPending}
              className="min-h-[44px] w-full rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
              {submit.isPending ? <T k="등록 중..." /> : <T k="응급 미확인 환자 등록" />}
            </button>
            <button onClick={() => router.back()} className="min-h-[44px] w-full rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700"><T k="취소" /></button>
          </div>
        </div>

        {/* 우: 도착 상황 기록 */}
        <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900"><T k="도착 상황 기록" /></h3>
          {/* 119·전원 사전통보에서 불러오기 */}
          <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3">
            <p className="mb-1.5 text-xs font-bold text-sky-800"><T k="119·전원 사전통보에서 불러오기" /></p>
            {preQ.isError ? <p className="text-[11px] text-rose-600"><T k="사전통보 목록을 불러오지 못했습니다 — 직접 적어 주세요." /></p>
              : preQ.isLoading ? <p className="text-[11px] text-gray-500"><T k="불러오는 중…" /></p>
              : (preQ.data?.data ?? []).length === 0 ? <p className="text-[11px] text-gray-500"><T k="이송 중인 사전통보가 없습니다." /></p>
              : (
                <div className="flex flex-wrap gap-1.5">
                  {(preQ.data?.data ?? []).map((p) => (
                    <button key={p.id} type="button" onClick={() => pickPre(p)}
                      className={`min-h-[36px] rounded-lg border px-2.5 py-1 text-left text-[11px] ${preId === p.id ? 'border-sky-500 bg-white text-sky-800' : 'border-sky-200 bg-white/70 text-gray-700 hover:bg-white'}`}>
                      <b>{p.unitId ?? p.source}</b> · {p.chiefComplaint}
                      {p.patientAge != null && <> · {p.patientAge}</>}
                      {p.etaRemainingMins != null && <> · ETA <Tf k="{n}분" params={{ n: p.etaRemainingMins }} /></>}
                    </button>
                  ))}
                </div>
              )}
            {preId && (
              <div className="mt-2 space-y-1 text-[11px]">
                <p className="text-amber-700"><T k="사전통보 내용으로 채운 초안입니다 — 도착 후 확인한 사실로 고치고 등록하세요." /></p>
                <label className="flex items-center gap-1.5 text-gray-700">
                  <input type="checkbox" checked={markArrived} onChange={(e) => setMarkArrived(e.target.checked)} />
                  <T k="등록하면서 이 사전통보를 도착 처리" />
                </label>
                <button type="button" onClick={() => { setPreId(null); setMarkArrived(false); setArrival(EMPTY_ARRIVAL); }} className="text-gray-500 underline"><T k="불러오기 취소(비우기)" /></button>
              </div>
            )}
          </div>
          <ArrivalNoteFields value={arrival} onChange={setArrival} />
        </div>
      </div>
    </div>
  );
}
