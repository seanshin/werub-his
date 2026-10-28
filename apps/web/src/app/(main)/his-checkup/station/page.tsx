'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { ageOf } from '@hospital-run/shared';
import { Unit, genderText } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import Link from 'next/link';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

const STATION_LIST = [
  { id: 'blood', label: '채혈실', icon: '🩸', color: 'bg-red-50 border-red-200 text-red-700' },
  { id: 'urine', label: '검체실', icon: '🧪', color: 'bg-amber-50 border-amber-200 text-amber-700' },
  { id: 'physical', label: '신체계측실', icon: '📏', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  { id: 'ecg', label: '심전도실', icon: '💓', color: 'bg-pink-50 border-pink-200 text-pink-700' },
  { id: 'xray', label: 'X-ray실', icon: '📷', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  { id: 'ultrasound', label: '초음파실', icon: '🔊', color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
  { id: 'endoscopy', label: '내시경실', icon: '🔬', color: 'bg-violet-50 border-violet-200 text-violet-700' },
  { id: 'eye', label: '안과검사실', icon: '👁', color: 'bg-cyan-50 border-cyan-200 text-cyan-700' },
  { id: 'pulmonary', label: '폐기능검사실', icon: '🫁', color: 'bg-teal-50 border-teal-200 text-teal-700' },
];

const FINDING_OPTIONS = [
  { key: 'NORMAL', label: '정상', cls: 'bg-emerald-100 border-emerald-300 text-emerald-700' },
  { key: 'ABNORMAL', label: '이상', cls: 'bg-amber-100 border-amber-300 text-amber-700' },
  { key: 'CRITICAL', label: '위험', cls: 'bg-red-100 border-red-300 text-red-700' },
];

export default function CheckupStationPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const tAttr = useTAttr();

  // 부서명에서 스테이션 자동 매칭
  const dept = user?.department ?? '';
  const autoStation = STATION_LIST.find((s) => dept.includes(s.label))?.id;
  const [station, setStation] = useState(autoStation ?? 'blood');
  const [inputTarget, setInputTarget] = useState<any>(null);
  const [form, setForm] = useState({ value: '', unit: '', referenceRange: '', finding: 'NORMAL', note: '' });

  const stationInfo = STATION_LIST.find((s) => s.id === station)!;

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['station-queue', station],
    queryFn: () => apiClient.get<any>(`/api/v1/checkup/station/${station}/queue`),
    refetchInterval: 8000,
  });
  const queue = queueRes?.data ?? [];

  const completeItem = useMutation({
    mutationFn: (body: any) => apiClient.post(`/api/v1/checkup/station/${station}/complete`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['station-queue', station] });
      setInputTarget(null);
      toast.success('결과 입력 완료');
    },
    onError: () => toast.error('입력 실패'),
  });

  const age = (dob: string) => dob ? (ageOf(dob) ?? 0) : '-';

  return (
    <div className="space-y-5">
      {/* 신규 허브 안내 */}
      <Link href="/his-checkup/ws" className="block bg-blue-50 border border-blue-200 rounded-xl p-4 hover:bg-blue-100 transition">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-800"><T k="새로운 검사실 허브가 출시되었습니다" /></p>
            <p className="text-xs text-blue-600 mt-0.5"><T k="검사실별 독립 워크스테이션 + 동선 추적 + 전용 입력 폼" /></p>
          </div>
          <span className="text-blue-600 font-bold"><T k="이동@링크" /> →</span>
        </div>
      </Link>

      {/* 헤더 + 스테이션 선택 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <span className="mr-2">{stationInfo.icon}</span>
            <T k={stationInfo.label} />
          </h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="검사 대기" /> {queue.length}<Unit>명</Unit> · <T k="자동 갱신 8초" /></p>
        </div>
      </div>

      {/* 스테이션 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {STATION_LIST.map((s) => (
          <button key={s.id} onClick={() => setStation(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              station === s.id ? s.color + ' shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}>
            <span>{s.icon}</span> <T k={s.label} />
          </button>
        ))}
      </div>

      {/* 대기 환자 목록 */}
      {isLoading ? (
        <div className="py-16 text-center text-gray-400">
          <div className="animate-pulse text-3xl mb-2">{stationInfo.icon}</div>
          <p className="text-sm"><T k="로딩 중..." /></p>
        </div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : queue.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <div className="text-4xl mb-3">{stationInfo.icon}</div>
          <p className="font-medium"><T k="대기 환자가 없습니다" /></p>
          <p className="text-xs mt-1"><T k="접수된 수검자가 이 검사실에 배정되면 자동으로 표시됩니다" /></p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((q: any, idx: number) => (
            <div key={q.visitId} className={`bg-white border rounded-xl overflow-hidden ${idx === 0 ? 'ring-2 ring-blue-200' : ''}`}>
              {/* 환자 헤더 */}
              <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">
                    {idx + 1}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-900">
                      {q.patient.familyName}{q.patient.givenName}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {genderText(q.patient.gender)}/{q.patient.age}세 · {q.patient.mrn}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>{q.program.name}</span>
                  <span>접수 {q.checkedInAt ?kdate(q.checkedInAt, 'time') : '-'}</span>
                  <span className="font-medium text-gray-600">{q.completedCount}/{q.totalCount} <T k="완료" /></span>
                </div>
              </div>

              {/* 검사 항목 */}
              <div className="divide-y divide-gray-50">
                {q.items.map((item: any) => {
                  const isDone = item.finding !== 'PENDING';
                  return (
                    <div key={item.name} className={`flex items-center px-5 py-2.5 ${isDone ? 'bg-emerald-50/30' : ''}`}>
                      <div className="flex-1">
                        <span className={`text-sm ${isDone ? 'text-gray-400 line-through' : 'font-medium text-gray-800'}`}>
                          {item.name}
                        </span>
                      </div>
                      {isDone ? (
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-mono text-gray-600">{item.value}{item.unit && <span className="text-gray-400 ml-0.5">{item.unit}</span>}</span>
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${
                            item.finding === 'NORMAL' ? 'bg-emerald-100 text-emerald-600' :
                            item.finding === 'ABNORMAL' ? 'bg-amber-100 text-amber-600' :
                            'bg-red-100 text-red-600'
                          }`}><T k={item.finding === 'NORMAL' ? '정상' : item.finding === 'ABNORMAL' ? '이상' : '위험'} /></span>
                        </div>
                      ) : (
                        <button onClick={() => { setInputTarget({ visitId: q.visitId, ...item }); setForm({ value: '', unit: '', referenceRange: '', finding: 'NORMAL', note: '' }); }}
                          className="px-4 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 shadow-sm">
                          <T k="결과 입력" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 결과 입력 모달 */}
      {inputTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setInputTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="font-bold text-gray-900"><T k="결과 입력" /></h3>
                <p className="text-sm text-gray-500 mt-0.5">{inputTarget.name}</p>
              </div>
              <button onClick={() => setInputTarget(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="결과값" /> *</label>
                  <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" autoFocus
                    placeholder={station === 'physical' ? '예: 175, 78, 25.5' : '예: 120, 정상'}
                    value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="단위" /></label>
                  <input className="w-full border rounded-xl px-3 py-2.5 text-sm outline-none"
                    placeholder={station === 'blood' ? 'mg/dL' : station === 'physical' ? 'cm, kg' : ''}
                    value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="참고 범위" /></label>
                <input className="w-full border rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="예: 70-110"
                  value={form.referenceRange} onChange={(e) => setForm({ ...form, referenceRange: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block"><T k="판정" /> *</label>
                <div className="flex gap-2">
                  {FINDING_OPTIONS.map((f) => (
                    <button key={f.key} onClick={() => setForm({ ...form, finding: f.key })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition ${
                        form.finding === f.key ? f.cls : 'bg-white border-gray-200 text-gray-400'
                      }`}><T k={f.label} /></button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="비고" /></label>
                <input className="w-full border rounded-xl px-3 py-2.5 text-sm outline-none" placeholder={tAttr('특이사항')}
                  value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setInputTarget(null)} className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
              <button onClick={() => completeItem.mutate({ visitId: inputTarget.visitId, testName: inputTarget.name, ...form })}
                disabled={!form.value} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-sm">
                <T k="입력 완료" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
