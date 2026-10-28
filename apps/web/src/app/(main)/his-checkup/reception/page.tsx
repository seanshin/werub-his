'use client';

import { useState } from 'react';
import { ageOf } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { PatientAvatar } from '@/components/PatientAvatar';
import PatientSelector from '@/components/ui/PatientSelector';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit, genderText } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kstToday } from '@/lib/kst-today';

const STATUS_COLORS: Record<string, string> = {
  RESERVED: 'bg-gray-100 text-gray-700',
  CHECKED_IN: 'bg-blue-100 text-blue-700',
};

interface CheckupOption {
  id: string;
  name: string;
  price: number;
  category: string;
}

export default function CheckupReceptionPage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const today = kstToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [checkInTarget, setCheckInTarget] = useState<any>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

  // ── 당일 접수 (Walk-in) 상태 ──
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkInPatientId, setWalkInPatientId] = useState('');
  const [walkInPatient, setWalkInPatient] = useState<any>(null);
  const [walkInProgramId, setWalkInProgramId] = useState('');
  const [walkInOptions, setWalkInOptions] = useState<string[]>([]);
  const [walkInNhi, setWalkInNhi] = useState(false);

  const { data: visitsRes, isError, error, refetch } = useQuery({
    queryKey: ['checkup-reception', selectedDate],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/visits', { date: selectedDate, status: 'RESERVED' }),
    refetchInterval: pollMs('fast'),
  });
  const reservations = visitsRes?.data ?? [];

  const { data: checkedInRes } = useQuery({
    queryKey: ['checkup-reception-done', selectedDate],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/visits', { date: selectedDate, status: 'CHECKED_IN' }),
    refetchInterval: pollMs('fast'),
  });
  const checkedIn = checkedInRes?.data ?? [];

  const { data: programsRes } = useQuery({
    queryKey: ['checkup-programs-active'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/programs', { isActive: true }),
  });
  const programs = programsRes?.data ?? [];

  const checkIn = useMutation({
    // 🔴 고른 옵션을 서버에 보낸다 — 종전엔 화면이 옵션 합산액을 "총 수납 금액"으로 보여주면서
    //    전송 경로가 없어 실제 청구는 예약 금액이었다(2026-08-13 W5). 금액 계산은 서버 몫.
    mutationFn: (id: string) => apiClient.patch(`/api/v1/checkup/visits/${id}/check-in`, { selectedOptions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-reception'] });
      queryClient.invalidateQueries({ queryKey: ['checkup-reception-done'] });
      setCheckInTarget(null);
      setSelectedOptions([]);
      toast.success('검진 접수 완료 — 수납 + 검사 항목이 자동 생성되었습니다');
    },
    onError: () => toast.error('접수 실패'),
  });

  const walkInMutation = useMutation({
    mutationFn: (body: any) => apiClient.post('/api/v1/checkup/visits/walk-in', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-reception'] });
      queryClient.invalidateQueries({ queryKey: ['checkup-reception-done'] });
      resetWalkIn();
      toast.success('당일 접수 완료 — Encounter + 수납 + 검사 항목이 자동 생성되었습니다');
    },
    onError: (err: any) => toast.error(err?.message || '당일 접수 실패'),
  });

  const resetWalkIn = () => {
    setShowWalkIn(false);
    setWalkInPatientId('');
    setWalkInPatient(null);
    setWalkInProgramId('');
    setWalkInOptions([]);
    setWalkInNhi(false);
  };

  const formatPrice = (n: number) => new Intl.NumberFormat('ko-KR').format(n);

  // 옵션 포함 금액 계산 (예약 접수 모달)
  const calcTotal = (visit: any) => {
    if (!visit) return 0;
    const program = visit.program;
    let total = program.price;
    if (program.discountRate > 0) total = Math.round(total * (1 - program.discountRate / 100));
    const options = (program.options ?? []) as CheckupOption[];
    for (const optId of selectedOptions) {
      const opt = options.find((o) => o.id === optId);
      if (opt) total += opt.price;
    }
    return total;
  };

  // 당일 접수 금액 계산
  const calcWalkInTotal = () => {
    const program = programs.find((p: any) => p.id === walkInProgramId);
    if (!program) return 0;
    let total = program.price;
    if (program.discountRate > 0) total = Math.round(total * (1 - program.discountRate / 100));
    const options = (program.options ?? []) as CheckupOption[];
    for (const optId of walkInOptions) {
      const opt = options.find((o: CheckupOption) => o.id === optId);
      if (opt) total += opt.price;
    }
    return total;
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const selectedProgram = programs.find((p: any) => p.id === walkInProgramId);

  const toggleOption = (optId: string) => {
    setSelectedOptions((prev) =>
      prev.includes(optId) ? prev.filter((id) => id !== optId) : [...prev, optId],
    );
  };

  const toggleWalkInOption = (optId: string) => {
    setWalkInOptions((prev) =>
      prev.includes(optId) ? prev.filter((id) => id !== optId) : [...prev, optId],
    );
  };

  const age = (dob: string) =>
    dob ? (ageOf(dob) ?? 0) : null;

  const handleWalkInSubmit = () => {
    if (!walkInPatientId || !walkInProgramId) return;
    walkInMutation.mutate({
      patientId: walkInPatientId,
      programId: walkInProgramId,
      selectedOptions: walkInOptions.length > 0 ? walkInOptions : undefined,
      isNhiScreening: walkInNhi || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold"><T k="검진 접수" /></h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWalkIn(true)}
            className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 font-medium"
          >
            + <T k="당일 접수" />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => setSelectedDate(today)}
            className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200"
          >
            <T k="오늘" />
          </button>
          <span className="text-sm text-gray-500 ml-2">
            <T k="대기" /> {reservations.length}명 · <T k="접수완료" /> {checkedIn.length}명
          </span>
        </div>
      </div>

      {/* 접수 대기 (RESERVED) */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b bg-orange-50">
          <h2 className="font-semibold text-orange-700"><T k="접수 대기@원무" /> ({reservations.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left"><T k="수검자" /></th>
              <th className="px-4 py-2 text-left"><T k="성별/나이" /></th>
              <th className="px-4 py-2 text-left"><T k="프로그램" /></th>
              <th className="px-4 py-2 text-right"><T k="예상 금액" /></th>
              <th className="px-4 py-2 text-center"><T k="소요" /></th>
              <th className="px-4 py-2 text-center"><T k="접수@상태" /></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {reservations.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400"><T k="접수 대기 중인 예약이 없습니다" /></td></tr>
            )}
            {reservations.map((v: any) => (
              <tr key={v.id} className="hover:bg-orange-50/50">
                <td className="px-4 py-3">
                  <div className="font-medium">{v.patient?.familyName}{v.patient?.givenName}</div>
                  <div className="text-xs text-gray-400">{v.patient?.mrn}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {genderText(v.patient?.gender)} / {age(v.patient?.dateOfBirth)}세
                </td>
                <td className="px-4 py-3">
                  <div>{v.program?.name}</div>
                  <div className="text-xs text-gray-400">{v.program?.code} · {(v.program?.items as any[])?.length ?? 0}항목</div>
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {formatPrice(v.totalPrice)}원
                </td>
                <td className="px-4 py-3 text-center text-gray-500">
                  {v.program?.duration}분
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => { setCheckInTarget(v); setSelectedOptions([]); }}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 font-medium"
                  >
                    <T k="접수@상태" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 접수 완료 (CHECKED_IN) */}
      {checkedIn.length > 0 && (
        <div className="bg-white rounded-lg border">
          <div className="p-4 border-b bg-blue-50">
            <h2 className="font-semibold text-blue-700"><T k="접수 완료@상태" /> ({checkedIn.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left"><T k="수검자" /></th>
                <th className="px-4 py-2 text-left"><T k="프로그램" /></th>
                <th className="px-4 py-2 text-center"><T k="접수 시간" /></th>
                <th className="px-4 py-2 text-right"><T k="수납 금액" /></th>
                <th className="px-4 py-2 text-center"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {checkedIn.map((v: any) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium">{v.patient?.familyName}{v.patient?.givenName}</span>
                    <span className="text-xs text-gray-400 ml-2">{v.patient?.mrn}</span>
                  </td>
                  <td className="px-4 py-3">{v.program?.name}</td>
                  <td className="px-4 py-3 text-center text-gray-500">
                    {v.checkedInAt ?kdate(v.checkedInAt, 'time') : '-'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatPrice(v.totalPrice)}<Unit>원</Unit></td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium whitespace-nowrap"><T k="접수완료" /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* 예약 → 접수 모달 (기존) */}
      {/* ══════════════════════════════════════════════ */}
      {checkInTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="p-6 border-b">
              <h3 className="text-lg font-bold"><T k="검진 접수 확인" /></h3>
            </div>
            <div className="p-6 space-y-5">
              {/* 수검자 정보 */}
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                <PatientAvatar gender={checkInTarget.patient?.gender} dateOfBirth={checkInTarget.patient?.dateOfBirth} familyName={checkInTarget.patient?.familyName} givenName={checkInTarget.patient?.givenName} />
                <div>
                  <div className="font-semibold text-lg">
                    {checkInTarget.patient?.familyName}{checkInTarget.patient?.givenName}
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {genderText(checkInTarget.patient?.gender)} / {age(checkInTarget.patient?.dateOfBirth)}세
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">{checkInTarget.patient?.mrn}</div>
                </div>
              </div>

              {/* 프로그램 */}
              <div>
                <div className="text-sm font-medium text-gray-500 mb-1"><T k="검진 프로그램" /></div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="font-semibold">{checkInTarget.program?.name}</div>
                  <div className="text-sm text-gray-600">{checkInTarget.program?.code} · {checkInTarget.program?.duration}<Unit>분</Unit> · {(checkInTarget.program?.items as any[])?.length ?? 0}항목</div>
                </div>
              </div>

              {/* 선택 옵션 */}
              {checkInTarget.program?.options && (checkInTarget.program.options as CheckupOption[]).length > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-2"><T k="추가 선택 항목" /></div>
                  <div className="space-y-1.5">
                    {(checkInTarget.program.options as CheckupOption[]).map((opt) => (
                      <label
                        key={opt.id}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${
                          selectedOptions.includes(opt.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedOptions.includes(opt.id)}
                            onChange={() => toggleOption(opt.id)}
                            className="rounded"
                          />
                          <div>
                            <div className="text-sm font-medium">{opt.name}</div>
                            <div className="text-xs text-gray-400">{opt.category}</div>
                          </div>
                        </div>
                        <span className="text-sm font-medium text-blue-600">+{formatPrice(opt.price)}<Unit>원</Unit></span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 금액 요약 */}
              <div className="p-4 bg-gray-50 rounded-xl space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500"><T k="기본 검진" /></span>
                  <span>{formatPrice(checkInTarget.program?.price)}<Unit>원</Unit></span>
                </div>
                {selectedOptions.map((optId) => {
                  const opt = (checkInTarget.program?.options as CheckupOption[])?.find((o) => o.id === optId);
                  return opt ? (
                    <div key={optId} className="flex justify-between text-sm">
                      <span className="text-gray-500">{opt.name}</span>
                      <span>+{formatPrice(opt.price)}<Unit>원</Unit></span>
                    </div>
                  ) : null;
                })}
                <div className="flex justify-between pt-2 border-t font-bold text-lg">
                  <span><T k="총 수납 금액" /></span>
                  <span className="text-blue-600">{formatPrice(calcTotal(checkInTarget))}<Unit>원</Unit></span>
                </div>
              </div>

              {/* 안내 */}
              <div className="text-xs text-gray-400 bg-yellow-50 p-3 rounded-lg">
                <T k="접수 시 자동 처리: Encounter 생성 · 수납(Billing) 생성 · 검사 항목(ResultItem) 생성 · 판독 요청 생성" />
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => { setCheckInTarget(null); setSelectedOptions([]); }}
                className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200"
              >
                <T k="취소" />
              </button>
              <button
                onClick={() => checkIn.mutate(checkInTarget.id)}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 font-medium"
              >
                <T k="접수 + 수납 확인" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* 당일 접수 (Walk-in) 모달 */}
      {/* ══════════════════════════════════════════════ */}
      {showWalkIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b bg-green-50">
              <h3 className="text-lg font-bold text-green-800"><T k="당일 접수 (Walk-in)" /></h3>
              <p className="text-sm text-green-600 mt-1"><T k="예약 없이 당일 바로 검진 접수합니다" /></p>
            </div>
            <div className="p-6 space-y-5">
              {/* 환자 검색 */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2"><T k="수검자 선택" /></div>
                <PatientSelector
                  value={walkInPatientId}
                  onChange={(id: string, patient: any) => { setWalkInPatientId(id); setWalkInPatient(patient); }}
                  context="general"
                  placeholder={tAttr('환자 이름 또는 등록번호 검색...')}
                />
                {walkInPatient && (
                  <div className="mt-2 flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <PatientAvatar
                      gender={walkInPatient.gender}
                      dateOfBirth={walkInPatient.dateOfBirth}
                      familyName={walkInPatient.familyName}
                      givenName={walkInPatient.givenName}
                    />
                    <div>
                      <div className="font-semibold">
                        {walkInPatient.familyName}{walkInPatient.givenName}
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          {genderText(walkInPatient.gender)} / {age(walkInPatient.dateOfBirth)}세
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">{walkInPatient.mrn}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* 프로그램 선택 */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2"><T k="검진 프로그램" /></div>
                <div className="space-y-2">
                  {programs.map((p: any) => (
                    <label
                      key={p.id}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${
                        walkInProgramId === p.id
                          ? 'border-green-400 bg-green-50 ring-1 ring-green-400'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="walkInProgram"
                          checked={walkInProgramId === p.id}
                          onChange={() => { setWalkInProgramId(p.id); setWalkInOptions([]); }}
                          className="text-green-600"
                        />
                        <div>
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="text-xs text-gray-400">
                            {p.code} · {(p.items as any[])?.length ?? 0}항목 · {p.duration}분
                          </div>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-green-700">{formatPrice(p.price)}<Unit>원</Unit></span>
                    </label>
                  ))}
                  {programs.length === 0 && (
                    <EmptyState icon="📋" title="활성 프로그램이 없습니다" />
                  )}
                </div>
              </div>

              {/* 선택 옵션 */}
              {selectedProgram?.options && (selectedProgram.options as CheckupOption[]).length > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-2"><T k="추가 선택 항목" /></div>
                  <div className="space-y-1.5">
                    {(selectedProgram.options as CheckupOption[]).map((opt) => (
                      <label
                        key={opt.id}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${
                          walkInOptions.includes(opt.id) ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={walkInOptions.includes(opt.id)}
                            onChange={() => toggleWalkInOption(opt.id)}
                            className="rounded"
                          />
                          <div>
                            <div className="text-sm font-medium">{opt.name}</div>
                            <div className="text-xs text-gray-400">{opt.category}</div>
                          </div>
                        </div>
                        <span className="text-sm font-medium text-green-600">+{formatPrice(opt.price)}<Unit>원</Unit></span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 국가건강검진 */}
              <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={walkInNhi}
                  onChange={(e) => setWalkInNhi(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700"><T k="국가건강검진 대상자" /></span>
              </label>

              {/* 금액 요약 */}
              {walkInProgramId && (
                <div className="p-4 bg-gray-50 rounded-xl space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500"><T k="기본 검진" /></span>
                    <span>{formatPrice(selectedProgram?.price ?? 0)}<Unit>원</Unit></span>
                  </div>
                  {walkInOptions.map((optId) => {
                    const opt = (selectedProgram?.options as CheckupOption[])?.find((o) => o.id === optId);
                    return opt ? (
                      <div key={optId} className="flex justify-between text-sm">
                        <span className="text-gray-500">{opt.name}</span>
                        <span>+{formatPrice(opt.price)}<Unit>원</Unit></span>
                      </div>
                    ) : null;
                  })}
                  <div className="flex justify-between pt-2 border-t font-bold text-lg">
                    <span><T k="총 수납 금액" /></span>
                    <span className="text-green-600">{formatPrice(calcWalkInTotal())}<Unit>원</Unit></span>
                  </div>
                </div>
              )}

              {/* 안내 */}
              <div className="text-xs text-gray-400 bg-yellow-50 p-3 rounded-lg">
                <T k="당일 접수 시 자동 처리: 예약 생성 → 즉시 접수 → Encounter · 수납(Billing) · 검사 항목(ResultItem) · 판독 요청 자동 생성" />
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={resetWalkIn}
                className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200"
              >
                <T k="취소" />
              </button>
              <button
                onClick={handleWalkInSubmit}
                disabled={!walkInPatientId || !walkInProgramId || walkInMutation.isPending}
                className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <T k={walkInMutation.isPending ? '처리 중...' : '당일 접수 확인'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
