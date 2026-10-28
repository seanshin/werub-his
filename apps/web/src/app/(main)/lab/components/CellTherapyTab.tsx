'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface CellBatch {
  id: string;
  batchNumber: string;
  status: string;
  cellType: string;
  sourceType: string;
  collectionDate: string;
  targetDose?: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
}

interface QcTest {
  id: string;
  testType: string;
  result: string;
  unit: string;
  passFail: string;
}

interface GmpDocument {
  id: string;
  fileName: string;
  docType: string;
}

interface CellBatchDetail extends CellBatch {
  daysSinceCollection: number;
  latestEnvironment?: { temperature: number; co2Percent: number; humidity?: number };
  environmentAlertCount: number;
  qcSummary?: { total: number; passed: number; failed: number; pending: number };
  qcTests?: QcTest[];
  documents?: GmpDocument[];
}

const STATUS_LABEL: Record<string, string> = { COLLECTED: '채취', PROCESSING: '처리중', CULTURE: '배양중', QC_TESTING: 'QC진행', RELEASED: '출하승인', ADMINISTERED: '투여', COMPLETED: '완료' };
const STATUS_COLOR: Record<string, string> = { COLLECTED: 'bg-blue-100 text-blue-700', PROCESSING: 'bg-indigo-100 text-indigo-700', CULTURE: 'bg-amber-100 text-amber-700', QC_TESTING: 'bg-violet-100 text-violet-700', RELEASED: 'bg-emerald-100 text-emerald-700', ADMINISTERED: 'bg-teal-100 text-teal-700', COMPLETED: 'bg-gray-200 text-gray-600' };
const CELL_LABEL: Record<string, string> = { CAR_T: 'CAR-T', NK: 'NK Cell', MSC: 'MSC (줄기세포)', DC: 'DC (수지상세포)', TIL: 'TIL' };
const QC_TYPE_LABEL: Record<string, string> = { VIABILITY: '생존율', CELL_COUNT: '세포수', STERILITY: '무균시험', ENDOTOXIN: '내독소', MYCOPLASMA: '마이코플라즈마', IDENTITY: '동일성', POTENCY: '역가', KARYOTYPE: '핵형' };

export default function CellTherapyTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEnvForm, setShowEnvForm] = useState(false);
  const [showQcForm, setShowQcForm] = useState(false);
  const [form, setForm] = useState({ patientId: '', cellType: 'CAR_T', sourceType: 'AUTOLOGOUS', collectionDate: kstToday(), targetDose: '', notes: '' });
  const [envForm, setEnvForm] = useState({ temperature: '37.0', co2Percent: '5.0', humidity: '95.0' });
  const [qcForm, setQcForm] = useState({ testType: 'VIABILITY', result: '', unit: '', passFail: 'PENDING' });

  const { data: batchesData, isLoading } = useQuery({
    queryKey: ['cell-therapy-batches'],
    queryFn: () => apiClient.get<{ data: CellBatch[] }>('/api/v1/lab/cell-therapy/batches'),
    refetchInterval: pollMs('normal'),
  });

  const { data: detailData } = useQuery({
    queryKey: ['cell-therapy-detail', selectedId],
    queryFn: () => apiClient.get<{ data: CellBatchDetail }>(`/api/v1/lab/cell-therapy/batches/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: pollMs('fast'),
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/lab/cell-therapy/batches', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cell-therapy-batches'] }); setShowCreate(false); toast.success('배치 생성 완료'); },
    onError: () => toast.error('생성 실패'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/lab/cell-therapy/batches/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cell-therapy-batches'] }); qc.invalidateQueries({ queryKey: ['cell-therapy-detail', selectedId] }); toast.success('상태 변경'); },
  });

  const envMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/lab/cell-therapy/batches/${id}/environment`, {
      temperature: parseFloat(envForm.temperature), co2Percent: parseFloat(envForm.co2Percent),
      humidity: envForm.humidity ? parseFloat(envForm.humidity) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cell-therapy-detail', selectedId] }); toast.success('환경 로그 기록'); setShowEnvForm(false); },
  });

  const qcMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/lab/cell-therapy/batches/${id}/qc`, qcForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cell-therapy-detail', selectedId] }); toast.success('QC 기록'); setShowQcForm(false); setQcForm({ testType: 'VIABILITY', result: '', unit: '', passFail: 'PENDING' }); },
  });

  /**
   * 🔴 (2026-09-17 L3) 출하 승인은 서버가 `@Roles(DOCTOR, ADMIN)` 다 — 세포치료제를 환자에게 내보내도
   *    되는지는 임상 판단이라 제조·QC 를 맡는 검사기사에게 열지 않는다. 그런데 nav(`/lab`)는
   *    ADMIN·LAB_TECH 이고 버튼은 그대로 그려, 검사기사가 누를 때마다 403 이었다.
   */
  const canRelease = useHasRole('DOCTOR');
  const releaseMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/lab/cell-therapy/batches/${id}/release`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cell-therapy-batches'] }); qc.invalidateQueries({ queryKey: ['cell-therapy-detail', selectedId] }); toast.success('출하 승인 완료'); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '출하 실패 — QC 확인'),
  });

  const batches: CellBatch[] = (() => { const r = batchesData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as CellBatch[] ?? []; })();
  const detail: CellBatchDetail | null = detailData?.data ? ((detailData.data as unknown as Record<string, unknown>)?.data as CellBatchDetail ?? detailData.data) : null;

  const getDaysSince = (date: string) => Math.max(0, Math.ceil((Date.now() - new Date(date).getTime()) / 86400000));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="세포치료 배치 관리" /></h3>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700"><T k="+ 새 배치" /></button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <p className="text-xs font-bold text-gray-700"><T k="새 세포치료 배치" /></p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="환자 ID *" /></label>
              <input value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="세포 유형" /></label>
              <select value={form.cellType} onChange={e => setForm({ ...form, cellType: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                {Object.entries(CELL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="소스" /></label>
              <select value={form.sourceType} onChange={e => setForm({ ...form, sourceType: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                <option value="AUTOLOGOUS"><T k="자가 (Autologous)" /></option><option value="ALLOGENEIC"><T k="동종 (Allogeneic)" /></option>
              </select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="채취일" /></label>
              <input type="date" value={form.collectionDate} onChange={e => setForm({ ...form, collectionDate: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="목표 용량" /></label>
              <input value={form.targetDose} onChange={e => setForm({ ...form, targetDose: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="1×10^6 cells/kg" /></div>
            <div className="flex items-end">
              <button onClick={() => createMut.mutate()} disabled={!form.patientId || createMut.isPending}
                className="min-h-[44px] px-3 py-2 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 w-full">
                <T k={createMut.isPending ? '생성 중...' : '배치 생성'} /></button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
        {/* 배치 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[90px]"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="배치번호" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="세포" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="경과" /></th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : batches.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="배치가 없습니다" /></td></tr>
              ) : batches.map((b: CellBatch) => (
                <tr key={b.id} onClick={() => setSelectedId(b.id)}
                  className={`border-b border-gray-50 cursor-pointer ${selectedId === b.id ? 'bg-teal-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[b.status]}`}><T k={STATUS_LABEL[b.status]} /></span></td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{b.batchNumber}</td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{b.patient?.familyName}{b.patient?.givenName}</td>
                  <td className="px-4 py-3 text-xs text-gray-500"><T k={CELL_LABEL[b.cellType] ?? b.cellType} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400">D{getDaysSince(b.collectionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 상세 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-h-[700px] overflow-y-auto">
          {!selectedId ? (
            <p className="text-sm text-gray-400 text-center py-8"><T k="배치를 선택하세요" /></p>
          ) : !detail ? (
            <p className="text-xs text-gray-400 text-center py-4"><T k="로딩 중..." /></p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900">{detail.batchNumber}</h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[detail.status]}`}><T k={STATUS_LABEL[detail.status]} /></span>
              </div>

              {/* 환자 + 배치 정보 */}
              <div className="bg-teal-50 rounded-xl p-3 text-xs space-y-1">
                <div><span className="text-teal-600"><T k="환자:" /></span> <span className="font-medium text-gray-900">{detail.patient?.familyName}{detail.patient?.givenName}</span> ({detail.patient?.mrn})</div>
                <div><span className="text-teal-600"><T k="세포:" /></span> <span className="text-gray-700">{CELL_LABEL[detail.cellType]} (<T k={detail.sourceType === 'AUTOLOGOUS' ? '자가' : '동종'} />)</span></div>
                <div><span className="text-teal-600"><T k="채취:" /></span> <span className="text-gray-700">{kdate(new Date(detail.collectionDate))}</span> <span className="text-amber-600 font-medium">D{detail.daysSinceCollection}</span></div>
                {detail.targetDose && <div><span className="text-teal-600"><T k="목표:" /></span> <span className="text-gray-700">{detail.targetDose}</span></div>}
              </div>

              {/* 환경 모니터링 */}
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-gray-500"><T k="환경 모니터링" /></p>
                  {detail.environmentAlertCount > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{detail.environmentAlertCount}<Unit><T k="건" /></Unit> <T k="이탈" /></span>}
                </div>
                {detail.latestEnvironment ? (
                  <div className="flex gap-3 text-xs">
                    <div className="text-center"><p className="text-gray-400"><T k="온도" /></p><p className="font-bold text-gray-900">{String(detail.latestEnvironment.temperature)}°C</p></div>
                    <div className="text-center"><p className="text-gray-400">CO2</p><p className="font-bold text-gray-900">{String(detail.latestEnvironment.co2Percent)}<Unit>%</Unit></p></div>
                    {detail.latestEnvironment.humidity && <div className="text-center"><p className="text-gray-400"><T k="습도" /></p><p className="font-bold text-gray-900">{String(detail.latestEnvironment.humidity)}<Unit>%</Unit></p></div>}
                  </div>
                ) : <p className="text-[10px] text-gray-400"><T k="기록 없음" /></p>}
                {!showEnvForm ? (
                  <button onClick={() => setShowEnvForm(true)} className="mt-2 w-full py-1 text-[10px] text-teal-600 border border-dashed border-teal-200 rounded-lg hover:bg-teal-50"><T k="+ 환경 기록" /></button>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-2">
                      <input value={envForm.temperature} onChange={e => setEnvForm({ ...envForm, temperature: e.target.value })} className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" placeholder={tAttr('온도(°C)')} type="number" step="0.1" />
                      <input value={envForm.co2Percent} onChange={e => setEnvForm({ ...envForm, co2Percent: e.target.value })} className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" placeholder="CO2(%)" type="number" step="0.1" />
                      <input value={envForm.humidity} onChange={e => setEnvForm({ ...envForm, humidity: e.target.value })} className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" placeholder={tAttr('습도(%)')} type="number" step="0.1" />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => envMut.mutate(detail.id)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-teal-600 text-white rounded hover:bg-teal-700"><T k="기록" /></button>
                      <button onClick={() => setShowEnvForm(false)} className="px-2 py-1 text-[10px] bg-gray-100 text-gray-500 rounded"><T k="취소" /></button>
                    </div>
                  </div>
                )}
              </div>

              {/* QC 검사 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-bold text-gray-500">QC 검사 ({detail.qcSummary?.total ?? 0}건: ✓{detail.qcSummary?.passed} ✗{detail.qcSummary?.failed} ○{detail.qcSummary?.pending})</p>
                </div>
                {(detail.qcTests?.length ?? 0) > 0 && (
                  <div className="space-y-1 mb-2">
                    {detail.qcTests!.slice(0, 6).map((t: QcTest) => (
                      <div key={t.id} className="flex items-center justify-between text-[10px] p-1.5 rounded bg-gray-50">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold ${t.passFail === 'PASS' ? 'text-emerald-600' : t.passFail === 'FAIL' ? 'text-red-600' : 'text-gray-400'}`}>
                            {t.passFail === 'PASS' ? '✓' : t.passFail === 'FAIL' ? '✗' : '○'}
                          </span>
                          <span className="text-gray-700"><T k={QC_TYPE_LABEL[t.testType] ?? t.testType} /></span>
                        </div>
                        <span className="text-gray-500">{t.result} {t.unit}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!showQcForm ? (
                  <button onClick={() => setShowQcForm(true)} className="w-full py-1 text-[10px] text-violet-600 border border-dashed border-violet-200 rounded-lg hover:bg-violet-50"><T k="+ QC 기록" /></button>
                ) : (
                  <div className="space-y-1.5 bg-violet-50/50 rounded-xl p-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <select value={qcForm.testType} onChange={e => setQcForm({ ...qcForm, testType: e.target.value })} className="px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                        {Object.entries(QC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <select value={qcForm.passFail} onChange={e => setQcForm({ ...qcForm, passFail: e.target.value })} className="px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                        <option value="PENDING"><T k="대기" /></option><option value="PASS"><T k="합격" /></option><option value="FAIL"><T k="불합격" /></option>
                      </select>
                    </div>
                    <div className="flex gap-1.5">
                      <input value={qcForm.result} onChange={e => setQcForm({ ...qcForm, result: e.target.value })} className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" placeholder={tAttr('결과값')} />
                      <input value={qcForm.unit} onChange={e => setQcForm({ ...qcForm, unit: e.target.value })} className="w-16 px-2 py-1 border border-gray-200 rounded text-xs" placeholder={tAttr('단위')} />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => qcMut.mutate(detail.id)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-violet-600 text-white rounded hover:bg-violet-700"><T k="기록" /></button>
                      <button onClick={() => setShowQcForm(false)} className="px-2 py-1 text-[10px] bg-gray-100 text-gray-500 rounded"><T k="취소" /></button>
                    </div>
                  </div>
                )}
              </div>

              {/* 문서 */}
              {(detail.documents?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="GMP 문서" /></p>
                  {detail.documents!.map((d: GmpDocument) => (
                    <div key={d.id} className="flex items-center justify-between text-[10px] p-1.5 rounded bg-gray-50 mb-0.5">
                      <span className="text-gray-700">{d.fileName}</span>
                      <span className="text-gray-400">{d.docType}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 상태 변경 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {detail.status === 'COLLECTED' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'PROCESSING' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg"><T k="처리 시작" /></button>}
                {detail.status === 'PROCESSING' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'CULTURE' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg"><T k="배양 시작" /></button>}
                {detail.status === 'CULTURE' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'QC_TESTING' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg"><T k="QC 시작" /></button>}
                {canRelease && detail.status === 'QC_TESTING' && <button onClick={() => releaseMut.mutate(detail.id)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg"><T k="출하 승인" /></button>}
                {detail.status === 'RELEASED' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'ADMINISTERED' })} className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-teal-600 text-white rounded-lg"><T k="투여 완료" /></button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
