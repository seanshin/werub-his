'use client';

import { useState, useEffect } from 'react';
import { Unit, PatientName } from '@/components/ui/display';
import PatientSelector from '@/components/ui/PatientSelector';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { APPOINTMENT_STATUS_LABEL } from '@hospital-run/shared';
import StatusBadge from '@/components/ui/StatusBadge';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 정본(appointment)+텔레헬스 확장(WAITING) — 로컬 색 재정의 대신 StatusBadge domain 규약
const STATUS_LABEL: Record<string, string> = { ...APPOINTMENT_STATUS_LABEL, WAITING: '대기중' };
const TELE_BADGE = { WAITING: { label: '대기중', bg: 'bg-amber-100', text: 'text-amber-700' } };
const TYPE_LABEL: Record<string, string> = { VIDEO: '화상', AUDIO: '음성', ASYNC: '비동기' };
const TYPE_ICON: Record<string, string> = { VIDEO: '📹', AUDIO: '📞', ASYNC: '💬' };

function fmtDateTime(d?: string) { return d ? kdate(d, 'datetimeShort') : '-'; }

interface Session { id: string; sessionType: string; status: string; scheduledAt: string; startedAt?: string; endedAt?: string; durationMinutes?: number; chiefComplaint?: string; roomId?: string; prescriptionIssued?: boolean; patientRating?: number; patient?: { id?: string; familyName?: string; givenName?: string; mrn?: string }; doctor?: { familyName?: string; givenName?: string; department?: string } }
interface Doctor { id: string; familyName?: string; givenName?: string; department?: string; isActive?: boolean }
interface Stats { total: number; completed: number; today: number; avgRating: number | null }

export default function TelehealthPage() {
  const tAttr = useTAttr();
  const router = useRouter();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const { data: statsData, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['telehealth-stats'],
    queryFn: () => apiClient.get<{ data: Stats }>('/api/v1/telehealth/stats'),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['telehealth-sessions', statusFilter],
    queryFn: () => apiClient.get<{ data: Session[] }>(`/api/v1/telehealth/sessions${statusFilter ? `?status=${statusFilter}` : ''}`),
    refetchInterval: pollMs('fast'),
  });

  const startMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/telehealth/sessions/${id}/start`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telehealth-sessions'] }); toast.success(tAttr('진료를 시작합니다.')); },
  });

  const endMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) => apiClient.patch(`/api/v1/telehealth/sessions/${id}/end`, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telehealth-sessions'] }); qc.invalidateQueries({ queryKey: ['telehealth-stats'] }); toast.success(tAttr('진료가 종료되었습니다.')); },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/telehealth/sessions/${id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telehealth-sessions'] }); toast.success(tAttr('예약이 취소되었습니다.')); },
  });

  const sessions = (Array.isArray(data?.data) ? data.data : []) as Session[];
  const stats = statsData?.data as Stats | null;
  const selected = sessions.find(s => s.id === selectedId);

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="원격진료 (Telehealth)" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="화상진료 · 음성진료 · 비동기 상담" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/telehealth/recordings" className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
            <T k="📹 녹화 관리" />
          </Link>
          <button onClick={async () => {
            try {
              const res = await apiClient.post<{ data: Session }>('/api/v1/telehealth/demo', { sessionType: 'VIDEO' });
              const s = (res.data as unknown as { data?: Session })?.data ?? res.data;
              toast.success(tAttr('데모 세션이 생성되었습니다.'));
              qc.invalidateQueries({ queryKey: ['telehealth-sessions'] });
              qc.invalidateQueries({ queryKey: ['telehealth-stats'] });
              if (s?.id) router.push(`/telehealth/${s.id}`);
            } catch { toast.error(tAttr('데모 세션 생성 실패')); }
          }} className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 flex items-center gap-2">
            <span>🎬</span> <T k="데모 진료 시작" />
          </button>
          <button onClick={() => setShowNew(true)} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 flex items-center gap-2">
            <span>📹</span> <T k="새 원격진료" />
          </button>
        </div>
      </div>

      {/* 통계 */}
      {statsIsError && <QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" className="mb-4" />}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="오늘 예정" /></p><p className="text-2xl font-bold text-blue-700">{stats.today}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="완료" /></p><p className="text-2xl font-bold text-emerald-700">{stats.completed}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="총 진료" /></p><p className="text-2xl font-bold text-gray-900">{stats.total}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="환자 평점" /></p><p className="text-2xl font-bold text-amber-600">{stats.avgRating ? `${stats.avgRating.toFixed(1)}⭐` : '-'}</p></div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-2 mb-4">
        {['', 'SCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={s ? STATUS_LABEL[s] : '전체'} />
          </button>
        ))}
      </div>

      <div className="flex gap-6">
        {/* 목록 */}
        <div className="flex-1 bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b text-xs text-gray-500">
              <th className="px-4 py-2.5 text-left"><T k="유형" /></th>
              <th className="px-4 py-2.5 text-left"><T k="환자" /></th>
              <th className="px-4 py-2.5 text-left"><T k="담당의" /></th>
              <th className="px-4 py-2.5 text-left"><T k="주호소" /></th>
              <th className="px-4 py-2.5 text-left"><T k="예약 시간" /></th>
              <th className="px-4 py-2.5 text-left"><T k="상태" /></th>
              <th className="px-4 py-2.5 text-right"><T k="액션" /></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
               sessions.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="원격진료 예약이 없습니다" /></td></tr> :
               sessions.map(s => (
                <tr key={s.id} onClick={() => setSelectedId(s.id)}
                  className={`cursor-pointer ${selectedId === s.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3 text-xs">{TYPE_ICON[s.sessionType] ?? ''} <T k={TYPE_LABEL[s.sessionType] ?? s.sessionType} /></td>
                  <td className="px-4 py-3"><p className="font-medium">{s.patient?.familyName}{s.patient?.givenName}</p><p className="text-[10px] text-gray-400">{s.patient?.mrn}</p></td>
                  {/* 🔴 누가 진료하는지를 화면이 말한다 — 관리자·간호사는 전체 세션을 본다 */}
                  <td className="px-4 py-3 text-xs">
                    {s.doctor?.familyName || s.doctor?.givenName
                      ? <><p className="font-medium text-gray-800">{s.doctor?.familyName}{s.doctor?.givenName}</p><p className="text-[10px] text-gray-400">{s.doctor?.department ?? ''}</p></>
                      : <span className="text-amber-600"><T k="미지정" /></span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[150px] truncate">{s.chiefComplaint ?? '-'}</td>
                  <td className="px-4 py-3 text-xs">{fmtDateTime(s.scheduledAt)}</td>
                  <td className="px-4 py-3"><StatusBadge domain="appointment" config={TELE_BADGE} status={s.status} className="text-[10px] font-bold whitespace-nowrap" /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                      {s.status === 'WAITING' && <a href={`/telehealth/${s.id}`} className="px-2 py-1 text-[10px] bg-emerald-600 text-white rounded-lg inline-block"><T k="화상 진료실" /></a>}
                      {s.status === 'IN_PROGRESS' && <a href={`/telehealth/${s.id}`} className="px-2 py-1 text-[10px] bg-blue-600 text-white rounded-lg inline-block"><T k="진료실 입장" /></a>}
                      {s.status === 'SCHEDULED' && (
                        <>
                          <button onClick={async () => { await startMut.mutateAsync(s.id); router.push(`/telehealth/${s.id}`); }}
                            className="px-2 py-1 text-[10px] bg-emerald-600 text-white rounded-lg"><T k="바로 시작" /></button>
                          <button onClick={() => cancelMut.mutate(s.id)} className="px-2 py-1 text-[10px] bg-gray-100 text-gray-600 rounded-lg"><T k="취소" /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 상세 */}
        {selected && (
          <div className="w-[350px] shrink-0 bg-white rounded-2xl border p-5 space-y-4">
            <div className="flex justify-between items-start">
              <h3 className="text-sm font-bold text-gray-900"><T k="진료 상세" /></h3>
              <button onClick={() => setSelectedId(null)} className="text-gray-400 text-lg">&times;</button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-500"><T k="유형" /></span><span>{TYPE_ICON[selected.sessionType]} <T k={TYPE_LABEL[selected.sessionType]} /></span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="환자" /></span><span className="font-medium">{selected.patient?.familyName}{selected.patient?.givenName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="담당의" /></span>
                <span className="font-medium">{selected.doctor?.familyName || selected.doctor?.givenName
                  ? `${selected.doctor?.familyName ?? ''}${selected.doctor?.givenName ?? ''}${selected.doctor?.department ? ` · ${selected.doctor.department}` : ''}`
                  : <span className="text-amber-600"><T k="미지정" /></span>}</span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="상태" /></span><StatusBadge domain="appointment" config={TELE_BADGE} status={selected.status} className="font-bold" /></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="예약" /></span><span>{fmtDateTime(selected.scheduledAt)}</span></div>
              {selected.startedAt && <div className="flex justify-between"><span className="text-gray-500"><T k="시작" /></span><span>{fmtDateTime(selected.startedAt)}</span></div>}
              {selected.endedAt && <div className="flex justify-between"><span className="text-gray-500"><T k="종료" /></span><span>{fmtDateTime(selected.endedAt)}</span></div>}
              {selected.durationMinutes && <div className="flex justify-between"><span className="text-gray-500"><T k="진료시간" /></span><span>{selected.durationMinutes}<Unit><T k="분" /></Unit></span></div>}
              <div className="flex justify-between"><span className="text-gray-500"><T k="처방" /></span><span>{selected.prescriptionIssued ? '✅ ' : ''}<T k={selected.prescriptionIssued ? '발행' : '미발행'} /></span></div>
              {selected.patientRating && <div className="flex justify-between"><span className="text-gray-500"><T k="평점" /></span><span>{'⭐'.repeat(selected.patientRating)}</span></div>}
            </div>
            {selected.chiefComplaint && (
              <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] text-blue-600 font-medium mb-1"><T k="주호소" /></p><p className="text-xs text-blue-800">{selected.chiefComplaint}</p></div>
            )}
            {selected.roomId && selected.status === 'IN_PROGRESS' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-700 font-bold mb-1"><T k="화상진료 진행 중" /></p>
                <p className="text-[10px] text-emerald-600 font-mono">Room: {selected.roomId}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 새 세션 모달 */}
      {showNew && <NewSessionModal onClose={() => setShowNew(false)} onSuccess={() => { qc.invalidateQueries({ queryKey: ['telehealth-sessions'] }); setShowNew(false); }} />}
    </div>
  );
}

function NewSessionModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  // 🔴 종전엔 담당의 입력이 없어 서버가 **호출자를 담당의로 박았다** — 관리자·간호사가 잡은 예약은
  //    담당의가 관리자·간호사 본인이 됐고, 환자는 누가 진료할지 모르는 채로 예약이 확정됐다.
  //    누가 볼지 정하지 않은 예약은 만들지 않는다(서버도 fail-closed 로 거절한다).
  const tAttr = useTAttr();
  const me = useAuthStore(s => s.user);
  const [form, setForm] = useState({ patientId: '', doctorId: '', scheduledAt: '', sessionType: 'VIDEO', chiefComplaint: '' });
  // 🔴 환자 식별자(UUID)를 손으로 받던 자리 — 실사용에서 아무도 그 값을 외우지 않는다. 이 화면은 사실상 예약을
  //    만들 수 없었다. 병원 정본 PatientSelector(20여 화면 공용)로 고르게 하고, **고른 환자를
  //    이름으로 되읽어 준다**(누구를 예약하는지 모른 채 확정하지 않는다).
  const [picked, setPicked] = useState<{ familyName?: string; givenName?: string; mrn?: string } | null>(null);

  const { data: doctorData, isLoading: doctorsLoading, isError: doctorsError } = useQuery({
    queryKey: ['telehealth-doctor-options'],
    queryFn: () => apiClient.get<{ data: Doctor[] }>('/api/v1/users/doctors'),
  });
  const doctors = (Array.isArray(doctorData?.data) ? doctorData.data : []).filter(d => d.isActive !== false);

  // 의사 본인이 잡는 경우엔 본인을 기본 담당의로 채운다(그래도 화면에는 누구인지 보인다)
  useEffect(() => {
    if (!form.doctorId && me?.role === 'DOCTOR' && doctors.some(d => d.id === me.id)) {
      setForm(f => ({ ...f, doctorId: me.id }));
    }
  }, [me, doctors, form.doctorId]);

  const mut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/telehealth/sessions', form),
    onSuccess: () => { toast.success(tAttr('원격진료가 예약되었습니다.')); onSuccess(); },
    onError: () => toast.error(tAttr('예약 실패')),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900"><T k="새 원격진료 예약" /></h3>
        <div className="space-y-3">
          <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자" /> <span className="text-red-500">*</span></label>
            <PatientSelector
              value={form.patientId}
              context="schedule"
              placeholder={tAttr('환자 검색 (이름 · 등록번호 · 전화번호)')}
              onChange={(id, p) => {
                setForm(f => ({ ...f, patientId: id }));
                setPicked(id ? { familyName: p?.familyName, givenName: p?.givenName, mrn: p?.mrn } : null);
              }}
            />
            {form.patientId && picked ? (
              <p className="text-[11px] text-gray-600 mt-1">
                <PatientName familyName={picked.familyName} givenName={picked.givenName} showMrn={false} className="font-semibold text-gray-900" />
                <span> <T k="님으로 예약합니다." /></span>
              </p>
            ) : (
              <p className="text-[11px] text-amber-600 mt-1"><T k="환자를 선택해야 예약할 수 있습니다." /></p>
            )}</div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="담당의" /> <span className="text-red-500">*</span></label>
            {doctorsError ? (
              <p className="text-xs text-red-600 py-2"><T k="의사 목록을 불러오지 못했습니다 — 담당의를 확인할 수 없어 예약할 수 없습니다." /></p>
            ) : (
              <select value={form.doctorId} onChange={e => setForm(f => ({ ...f, doctorId: e.target.value }))}
                disabled={doctorsLoading} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                <option value="">{tAttr(doctorsLoading ? '불러오는 중...' : doctors.length === 0 ? '지정 가능한 의사가 없습니다' : '담당의 선택')}</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>{d.familyName}{d.givenName}{d.department ? ` · ${d.department}` : ''}</option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-gray-500 mt-1"><T k={'환자에게 "누가 진료하는지"로 표시됩니다.'} /></p></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="예약 일시" /></label>
            <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="진료 유형" /></label>
            <div className="flex gap-2">
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, sessionType: k }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium ${form.sessionType === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {TYPE_ICON[k]} <T k={v} />
                </button>
              ))}
            </div></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="주호소" /></label>
            <textarea value={form.chiefComplaint} onChange={e => setForm(f => ({ ...f, chiefComplaint: e.target.value }))} rows={3} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" placeholder={tAttr('증상, 문의사항...')} /></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => mut.mutate()} disabled={!form.patientId || !form.doctorId || !form.scheduledAt || mut.isPending}
            title={!form.patientId ? tAttr('환자를 선택해야 예약할 수 있습니다') : !form.doctorId ? tAttr('담당의를 선택해야 예약할 수 있습니다') : undefined}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
            <T k={mut.isPending ? '예약 중...' : '원격진료 예약'} />
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
        </div>
      </div>
    </div>
  );
}
