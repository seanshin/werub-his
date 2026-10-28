'use client';

/**
 * 무선 위치(3416 · 2026-10-09) — 무선 AP 기반 원내 위치(wifi-location.v1)의 등록부와 현황.
 *  ① 현황: 수집 설정(기본 꺼짐 · 결정 location.wifi.collect)·AP 수(교정 여부·데모 배치)·수집기 마지막 수신·최근 1시간 측위·시뮬레이션 방 적중률(분모)
 *  ② AP: 층·좌표·교정 — 교정값은 둘 다 넣거나 둘 다 지운다
 *  ③ 수집기: 발급(키는 한 번만 보인다)·활성
 *  ④ 단말 연결: 동의 근거 필수 · 해제는 사유(지우지 않는다)
 * 🔴 시뮬레이션 적중률은 데모 신호에 대한 계산 엔진 성능이다 — 실제 병원 정확도가 아니다(그 자리에서 말한다).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WIFI_COLLECT_MODES, WIFI_COLLECT_MODE_LABEL, WIFI_CONSENT_BASIS_LABEL, WIFI_DEVICE_KINDS, WIFI_DEVICE_KIND_LABEL, WIFI_LOCATION_SCHEMA,
  WIFI_PATH_LOSS_DEFAULT, WIFI_SOLVER, joinPatientName, type WifiCollectMode, type WifiConsentBasis, type WifiDeviceKind,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate, Num, Ratio } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { SurveyPanel } from './SurveyPanel';
import { ApImportPanel } from './ApImportPanel';
import { ApFloorMap } from './ApFloorMap';

interface Status {
  enabled: boolean; enabledSource: string;
  accessPoints: { byFloor: Array<{ floorKey: string; dataOrigin: string; count: number }>; uncalibrated: number };
  collectors: Array<{ id: string; label: string; mode: string; isActive: boolean; lastSeenAt: string | null; lastBatch: Record<string, unknown> | null; dataOrigin: string; keyRotatedAt?: string | null }>;
  fixesLastHour: Record<string, number>;
  activeBindings: number;
  /** 열린 연결 점검(2026-10-10) — 자동 해제하지 않는다 · 사람이 본다 */
  bindingCheck?: { deceased: number; notAdmitted: number };
  survey?: { samples: number; fingerprintFloors: string[]; minSamplesPerFloor: number };
  /** 사람 결정 두 가지의 현재 값(2026-10-10) — 결정 화면에서 정한다 */
  autoUnbind?: { on: boolean; source: string; decisionKey: string };
  keyRotationGrace?: { minutes: number | null; source: string; decisionKey: string };
  retention?: { decisionKey: string; observedDeleted: boolean; simulatedHours: number };
  simulation: { total: number; zoned: number; hit: number };
}
interface Ap { id: string; bssid: string; label: string; floorKey: string; x: number; y: number; rssiAt1m: number | null; pathLossExponent: number | null; calibratedAt: string | null; isActive: boolean; dataOrigin: string }
interface Binding { id: string; patientState?: 'ADMITTED' | 'NOT_ADMITTED' | 'DECEASED'; deviceKind: WifiDeviceKind; displayHint: string | null; patientId: string; consentBasis: WifiConsentBasis; consentNote: string | null; boundAt: string; unboundAt: string | null; unboundReason: string | null; patient: { familyName: string; givenName: string; mrn: string } | null }
interface PatientHit { id: string; familyName: string; givenName: string; mrn: string }

const unwrap = <X,>(r: { data: X } | X): X => (r && typeof r === 'object' && 'data' in (r as object) ? (r as { data: X }).data : (r as X));

export default function WifiLocationAdminPage() {
  const tAttr = useTAttr();
  const statusQ = useQuery({ queryKey: ['wifi-status'], queryFn: () => apiClient.get<{ data: Status }>('/api/v1/location/wifi/status').then((r) => r.data) });
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900"><T k="무선 위치" /></h1>
        <p className="mt-1 text-sm text-gray-500"><T k="무선 AP 가 들은 신호 세기로 환자 단말·태그의 원내 위치를 근사합니다. 동의 받아 연결한 단말만 측위합니다." /></p>
      </header>
      {statusQ.isError ? <QueryErrorFallback error={statusQ.error} onRetry={() => statusQ.refetch()} />
        : !statusQ.data ? <div className="h-32 animate-pulse rounded-2xl bg-gray-100" aria-busy="true" />
        : <StatusPanel s={statusQ.data} />}
      {/* 섹션 이동(2026-10-10) — 화면이 길어 한 번에 찾아가게 */}
      <nav className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 bg-white/90 px-1 py-1 text-xs backdrop-blur" aria-label={tAttr('무선 위치 섹션')} data-wifi-section-nav>
        {([['wifi-aps', 'AP 등록부'], ['wifi-floor-map', '도면 위 배치'], ['wifi-ap-import', 'CSV 가져오기'], ['wifi-survey', '현장 측정'], ['wifi-collectors', '수집기'], ['wifi-bindings', '단말 연결'], ['wifi-protocol', '프로토콜']] as const).map(([id, l]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-[36px] items-center rounded-lg bg-gray-50 px-2 text-gray-700 hover:bg-gray-100"><T k={l} /></a>
        ))}
      </nav>
      <div id="wifi-aps"><ApPanel /></div>
      <ApFloorMap />
      <ApImportPanel />
      <div id="wifi-survey"><SurveyPanel /></div>
      <div id="wifi-collectors"><CollectorPanel s={statusQ.data} statusFailed={statusQ.isError} /></div>
      <div id="wifi-bindings"><BindingPanel s={statusQ.data} statusFailed={statusQ.isError} /></div>
      <div id="wifi-protocol"><ProtocolPanel /></div>
    </div>
  );
}

function StatusPanel({ s }: { s: Status }) {
  const apTotal = s.accessPoints.byFloor.reduce((a, b) => a + b.count, 0);
  const seeded = s.accessPoints.byFloor.filter((f) => f.dataOrigin === 'SEED').reduce((a, b) => a + b.count, 0);
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-wifi-status>
      <h2 className="mb-2 text-sm font-bold text-gray-900"><T k="현황" /></h2>
      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-gray-50 p-3" data-wifi-enabled={s.enabled ? 'on' : 'off'}>
          <dt className="text-gray-500"><T k="실제 위치 수집" /></dt>
          <dd className={`mt-1 font-bold ${s.enabled ? 'text-green-700' : 'text-gray-700'}`}>{s.enabled ? <T k="켜짐" /> : <T k="꺼짐" />}</dd>
          <dd className="mt-1 text-[11px] text-gray-500">
            {s.enabledSource === 'DB' ? <T k="원내 설정값" /> : <T k="기본값(원내 미설정)" />} ·{' '}
            <Link href="/admin/decisions" className="text-blue-600 underline"><T k="허가권자 결정 location.wifi.collect" /></Link>
          </dd>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <dt className="text-gray-500"><T k="무선 AP" /></dt>
          <dd className="mt-1 font-bold text-gray-900"><Tf k="{수}대" params={{ 수: apTotal }} /></dd>
          <dd className="mt-1 text-[11px] text-gray-500">
            <Tf k="교정 안 됨 {수}대" params={{ 수: s.accessPoints.uncalibrated }} />{seeded > 0 && <> · <Tf k="데모 배치 {수}대(실제 설치 아님)" params={{ 수: seeded }} /></>}
          </dd>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <dt className="text-gray-500"><T k="최근 1시간 측위" /></dt>
          <dd className="mt-1 font-bold text-gray-900"><Tf k="관측 {관측} · 시뮬레이션 {시뮬}" params={{ 관측: s.fixesLastHour.OBSERVED_WIFI ?? 0, 시뮬: s.fixesLastHour.SIMULATED ?? 0 }} /></dd>
          <dd className="mt-1 text-[11px] text-gray-500"><Tf k="연결된 단말 {수}개" params={{ 수: s.activeBindings }} /></dd>
          {s.bindingCheck && (s.bindingCheck.deceased > 0 || s.bindingCheck.notAdmitted > 0) && (
            <dd className="mt-1 text-[11px] font-semibold text-amber-800" data-wifi-binding-check={`${s.bindingCheck.deceased}/${s.bindingCheck.notAdmitted}`}>
              {s.autoUnbind?.on
                // 자동 해제는 켠 뒤의 퇴원·사망부터 — 이미 열려 있던 연결은 사람이 정리한다
                ? <Tf k="점검 필요: 사망 환자 {사망}개(측위 저장 안 함) · 재원 중 아님 {재원아님}개 — 자동 해제는 켠 뒤의 퇴원·사망부터 적용됩니다(이 연결은 사람이 해제)" params={{ 사망: s.bindingCheck.deceased, 재원아님: s.bindingCheck.notAdmitted }} />
                : <Tf k="점검 필요: 사망 환자 {사망}개(측위 저장 안 함) · 재원 중 아님 {재원아님}개 — 자동 해제하지 않습니다" params={{ 사망: s.bindingCheck.deceased, 재원아님: s.bindingCheck.notAdmitted }} />}
            </dd>
          )}
        </div>
        <div className="rounded-xl bg-gray-50 p-3" data-wifi-sim-accuracy>
          <dt className="text-gray-500"><T k="시뮬레이션 방 적중률(최근 24시간)" /></dt>
          <dd className="mt-1 font-bold text-gray-900">
            <Ratio numerator={s.simulation.hit} denominator={s.simulation.zoned} />
          </dd>
          <dd className="mt-1 text-[11px] text-gray-500">
            {s.simulation.total > 0 && <><Tf k="방까지 정한 것 {방}/{전체}건 — 나머지는 오차가 커서 층까지만" params={{ 방: s.simulation.zoned, 전체: s.simulation.total }} /> · </>}
            <T k="데모 신호에 대한 계산 성능이지 실제 병원 정확도가 아닙니다" />
          </dd>
        </div>
      </dl>
      <div className="mt-3 grid gap-2 text-[11px] text-gray-600 sm:grid-cols-2">
        {s.survey && (
          <p data-wifi-status-survey={s.survey.fingerprintFloors.length}>
            <Tf k="현장 측정 표본 {수}개 · 신호 지도 측위 층 {층}" params={{ 수: s.survey.samples, 층: s.survey.fingerprintFloors.length ? s.survey.fingerprintFloors.join('·') : '0' }} />
            {' '}<span className="text-gray-500"><Tf k="(층마다 {n}개 이상이면)" params={{ n: s.survey.minSamplesPerFloor }} /></span>
          </p>
        )}
        {s.retention && (
          <p data-wifi-retention={s.retention.observedDeleted ? 'deleting' : 'kept'}>
            <Tf k="보존 — 관측 측위는 결정 {키} 전이라 지우지 않습니다 · 시뮬레이션은 {시간}시간 뒤 지웁니다" params={{ 키: s.retention.decisionKey, 시간: s.retention.simulatedHours }} />
          </p>
        )}
      </div>
      {!s.enabled && <p className="mt-3 text-xs text-gray-600"><T k="수집이 꺼져 있어 수집기가 보내도 저장하지 않고 503 으로 답합니다. 켜는 것은 개인위치정보 수집이라 허가권자 결정 뒤에 시스템 설정에서 합니다." /></p>}
    </section>
  );
}

function ApPanel() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const q = useQuery({ queryKey: ['wifi-aps'], queryFn: () => apiClient.get<{ data: Ap[] }>('/api/v1/location/wifi/access-points').then((r) => r.data) });
  const [floor, setFloor] = useState<string>('');
  const [form, setForm] = useState({ bssid: '', label: '', floorKey: '', x: '', y: '' });
  const [cal, setCal] = useState<{ id: string; rssiAt1m: string; exponent: string } | null>(null);
  const floors = useMemo(() => [...new Set((q.data ?? []).map((a) => a.floorKey))], [q.data]);
  const rows = (q.data ?? []).filter((a) => !floor || a.floorKey === floor);
  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/location/wifi/access-points', { bssid: form.bssid, label: form.label, floorKey: form.floorKey, x: Number(form.x), y: Number(form.y) }),
    onSuccess: () => { setForm({ bssid: '', label: '', floorKey: '', x: '', y: '' }); qc.invalidateQueries({ queryKey: ['wifi-aps'] }); qc.invalidateQueries({ queryKey: ['wifi-status'] }); },
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => apiClient.patch(`/api/v1/location/wifi/access-points/${v.id}`, v.body),
    onSuccess: () => { setCal(null); qc.invalidateQueries({ queryKey: ['wifi-aps'] }); qc.invalidateQueries({ queryKey: ['wifi-status'] }); },
  });
  const canCreate = form.bssid.trim() && form.label.trim() && form.floorKey.trim() && form.x !== '' && form.y !== '';
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-wifi-aps>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-gray-900"><T k="AP 등록부" /></h2>
        <select value={floor} onChange={(e) => setFloor(e.target.value)} aria-label={tAttr('층')} className="ml-auto rounded border border-gray-200 px-2 py-1 text-xs">
          <option value="">{tAttr('전체 층')}</option>
          {floors.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <p className="mb-2 text-[11px] text-gray-500">
        <Tf k="교정하지 않은 AP 는 기본 전파 모델(1m {세기} dBm · 감쇠 지수 {지수})로 계산합니다 — 측정값이 아닙니다." params={{ 세기: WIFI_PATH_LOSS_DEFAULT.rssiAt1m, 지수: WIFI_PATH_LOSS_DEFAULT.exponent }} />
      </p>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : !q.data ? <div className="h-20 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />
        : q.data.length === 0 ? <p className="text-xs text-gray-500" data-wifi-aps-empty><T k="등록된 AP 가 없습니다 — 아래에서 등록하거나 데모 배치 시드를 실행하십시오." /></p>
        : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-100 text-left text-[10px] text-gray-500">
                <th className="px-2 py-1"><T k="이름" /></th><th className="px-2 py-1">BSSID</th><th className="px-2 py-1"><T k="층" /></th>
                <th className="px-2 py-1"><T k="좌표(m)" /></th><th className="px-2 py-1"><T k="교정" /></th><th className="px-2 py-1"><T k="상태" /></th><th className="px-2 py-1" />
              </tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50" data-wifi-ap={a.bssid}>
                    <td className="px-2 py-1">{a.label}</td>
                    <td className="px-2 py-1 font-mono">{a.bssid}</td>
                    <td className="px-2 py-1">{a.floorKey}</td>
                    <td className="px-2 py-1 tabular-nums"><Num value={a.x} domain="positionMeters" unit={false} />, <Num value={a.y} domain="positionMeters" unit={false} /></td>
                    <td className="px-2 py-1">{a.rssiAt1m != null && a.pathLossExponent != null
                      ? <span className="text-indigo-700"><Num value={a.rssiAt1m} domain="wifiRssi" /> · n={a.pathLossExponent}</span>
                      : <span className="text-gray-500"><T k="교정 안 됨" /></span>}</td>
                    <td className="px-2 py-1">{a.isActive ? <T k="사용" /> : <span className="text-gray-400"><T k="중지" /></span>}{a.dataOrigin === 'SEED' && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700"><T k="데모" /></span>}</td>
                    <td className="space-x-1 whitespace-nowrap px-2 py-1">
                      <button type="button" className="rounded border border-gray-200 px-2 py-0.5" onClick={() => setCal({ id: a.id, rssiAt1m: a.rssiAt1m?.toString() ?? '', exponent: a.pathLossExponent?.toString() ?? '' })}><T k="교정" /></button>
                      <button type="button" className="rounded border border-gray-200 px-2 py-0.5" disabled={patch.isPending} onClick={() => patch.mutate({ id: a.id, body: { isActive: !a.isActive } })}>{a.isActive ? <T k="중지" /> : <T k="사용" />}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {cal && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-indigo-50 p-3 text-xs" data-wifi-cal-form>
          <label className="flex flex-col gap-1"><T k="1m 수신 세기(dBm)" /><input value={cal.rssiAt1m} onChange={(e) => setCal({ ...cal, rssiAt1m: e.target.value })} inputMode="decimal" className="w-28 rounded border px-2 py-1" /></label>
          <label className="flex flex-col gap-1"><T k="감쇠 지수" /><input value={cal.exponent} onChange={(e) => setCal({ ...cal, exponent: e.target.value })} inputMode="decimal" className="w-28 rounded border px-2 py-1" /></label>
          <button type="button" className="min-h-[36px] rounded bg-indigo-600 px-3 text-white disabled:opacity-40" disabled={!cal.rssiAt1m || !cal.exponent || patch.isPending}
            onClick={() => patch.mutate({ id: cal.id, body: { rssiAt1m: Number(cal.rssiAt1m), pathLossExponent: Number(cal.exponent) } })}><T k="교정값 저장" /></button>
          <button type="button" className="min-h-[36px] rounded border border-gray-300 px-3" disabled={patch.isPending}
            onClick={() => patch.mutate({ id: cal.id, body: { rssiAt1m: null, pathLossExponent: null } })}><T k="교정 지우기" /></button>
          <button type="button" className="min-h-[36px] px-2 text-gray-500" onClick={() => setCal(null)}><T k="닫기" /></button>
          <p className="w-full text-[11px] text-gray-600"><T k="교정값은 현장에서 AP 로부터 1m·여러 거리에서 잰 수신 세기로 정합니다. 두 값을 함께 넣거나 함께 지웁니다." /></p>
          {patch.isError && <p className="w-full text-rose-700"><T k="저장하지 못했습니다" /></p>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3 text-xs" data-wifi-ap-form>
        <label className="flex flex-col gap-1">BSSID<input value={form.bssid} onChange={(e) => setForm({ ...form, bssid: e.target.value })} placeholder="aa:bb:cc:dd:ee:ff" className="w-40 rounded border px-2 py-1 font-mono" /></label>
        <label className="flex flex-col gap-1"><T k="이름" /><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-36 rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1"><T k="층 키" /><input value={form.floorKey} onChange={(e) => setForm({ ...form, floorKey: e.target.value })} placeholder="1F" className="w-16 rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1">x(m)<input value={form.x} onChange={(e) => setForm({ ...form, x: e.target.value })} inputMode="decimal" className="w-20 rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1">y(m)<input value={form.y} onChange={(e) => setForm({ ...form, y: e.target.value })} inputMode="decimal" className="w-20 rounded border px-2 py-1" /></label>
        <button type="button" className="min-h-[36px] rounded bg-gray-900 px-3 text-white disabled:opacity-40" disabled={!canCreate || create.isPending} onClick={() => create.mutate()}><T k="AP 등록" /></button>
        {create.isError && <p className="w-full text-rose-700"><T k="등록하지 못했습니다 — BSSID 형식·중복, 확정 도면에 있는 층인지 확인하십시오" /></p>}
      </div>
    </section>
  );
}

/**
 * 사람 결정의 현재 값 한 줄(2026-10-10) — 값·출처 + 결정 화면 링크. 현황을 못 받았으면 모른다고 말한다(꺼짐으로 그리지 않는다).
 */
function DecisionLine({ label, value, decisionKey, failed, attr }: { label: string; value: React.ReactNode | undefined; decisionKey: string; failed: boolean; attr: string }) {
  return (
    <p className="mb-2 flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-700" data-wifi-decision={attr}>
      <span className="font-semibold"><T k={label} /></span>
      <span>{value !== undefined ? value : failed ? <T k="확인할 수 없음(현황 조회 실패)" /> : <T k="확인 중…" />}</span>
      <Link href={`/admin/decisions/${encodeURIComponent(decisionKey)}`} className="ml-auto text-blue-600 underline"><T k="결정 화면에서 정하기" /></Link>
    </p>
  );
}

function CollectorPanel({ s, statusFailed }: { s?: Status; statusFailed: boolean }) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const q = useQuery({ queryKey: ['wifi-collectors'], queryFn: () => apiClient.get<{ data: Status['collectors'] }>('/api/v1/location/wifi/collectors').then((r) => r.data) });
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<WifiCollectMode | ''>('');
  const [issued, setIssued] = useState<{ label: string; key: string; rotated?: boolean; graceUntil?: string | null } | null>(null);
  // 키 교체 유예(분) — undefined = 아직 모름(현황 미수신) · null = 유예 없음(즉시 무효)
  const grace = s?.keyRotationGrace ? s.keyRotationGrace.minutes : undefined;
  const create = useMutation({
    mutationFn: () => apiClient.post<{ data: { label: string; key: string } }>('/api/v1/location/wifi/collectors', { label, mode }),
    onSuccess: (r) => { setIssued({ label: r.data.label, key: r.data.key }); setLabel(''); setMode(''); qc.invalidateQueries({ queryKey: ['wifi-collectors'] }); },
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => apiClient.patch(`/api/v1/location/wifi/collectors/${v.id}`, { isActive: v.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wifi-collectors'] }),
  });
  // 키 교체(2026-10-10) — 두 번 눌러 확정(이전 키 즉시 무효 · 되돌릴 수 없음) · 새 키는 한 번만 보인다
  const [rotateArm, setRotateArm] = useState<string | null>(null);
  const rotate = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: { label: string; key: string; graceUntil: string | null } }>(`/api/v1/location/wifi/collectors/${id}/rotate-key`, {}),
    onSuccess: (r) => { setRotateArm(null); setIssued({ label: r.data.label, key: r.data.key, rotated: true, graceUntil: r.data.graceUntil ?? null }); qc.invalidateQueries({ queryKey: ['wifi-collectors'] }); },
  });
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-wifi-collectors>
      <h2 className="mb-2 text-sm font-bold text-gray-900"><T k="수집기" /></h2>
      <DecisionLine label="키 교체 유예:" attr="key-grace" decisionKey={s?.keyRotationGrace?.decisionKey ?? 'location.wifi.keyRotationGraceMinutes'} failed={statusFailed}
        value={grace === undefined ? undefined : grace === null ? <T k="없음 — 교체하면 이전 키 즉시 무효" /> : <Tf k="{분}분 — 교체 뒤 그동안 이전 키도 받습니다" params={{ 분: grace }} />} />
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : !q.data ? <div className="h-16 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />
        : q.data.length === 0 ? <p className="text-xs text-gray-500"><T k="발급된 수집기가 없습니다 — 무선 컨트롤러·태그 게이트웨이 연동 때 발급합니다." /></p>
        : (
          <ul className="space-y-1 text-xs">
            {q.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5" data-wifi-collector={c.id}>
                <span className="font-medium">{c.label}</span>
                <span className="text-gray-500"><T k={WIFI_COLLECT_MODE_LABEL[c.mode as WifiCollectMode] ?? c.mode} /></span>
                <span className="text-gray-500">{c.lastSeenAt ? <><T k="마지막 수신" /> <KDate value={c.lastSeenAt} mode="datetime" /></> : <T k="수신 기록 없음" />}</span>
                {c.lastBatch && <span className="text-gray-500"><Tf k="저장 {저장} · 미연결 단말 {미연결}" params={{ 저장: Number(c.lastBatch.stored ?? 0), 미연결: Number(c.lastBatch.unbound ?? 0) }} /></span>}
                {c.lastBatch?.viaGraceKey === true && <span className="font-semibold text-amber-800" data-wifi-via-grace={c.id}><T k="이전 키로 수신 중 — 수집기 설정을 바꾸십시오" /></span>}
                {c.keyRotatedAt && <span className="text-gray-500" data-wifi-key-rotated={c.id}><T k="키 교체" /> <KDate value={c.keyRotatedAt} mode="datetime" /></span>}
                <button type="button" className="ml-auto min-h-[44px] rounded border border-gray-200 px-2" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: c.id, isActive: !c.isActive })}>{c.isActive ? <T k="중지" /> : <T k="사용" />}</button>
                <button type="button" data-wifi-rotate={c.id} disabled={rotate.isPending}
                  className={`min-h-[44px] rounded border px-2 ${rotateArm === c.id ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-gray-200'}`}
                  onClick={() => (rotateArm === c.id ? rotate.mutate(c.id) : setRotateArm(c.id))}>
                  {rotateArm !== c.id ? <T k="키 교체" />
                    : grace === null ? <T k="한 번 더 누르면 교체 — 이전 키는 즉시 무효" />
                    : grace === undefined ? <T k="한 번 더 누르면 교체 — 유예 설정을 확인하지 못했습니다(결과에서 알립니다)" />
                    : <Tf k="한 번 더 누르면 교체 — 이전 키는 {분}분 동안 더 받습니다" params={{ 분: grace }} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3 text-xs">
        <label className="flex flex-col gap-1"><T k="이름" /><input value={label} onChange={(e) => setLabel(e.target.value)} className="w-48 rounded border px-2 py-1" /></label>
        <label className="flex flex-col gap-1"><T k="수집 방식" />
          <select value={mode} onChange={(e) => setMode(e.target.value as WifiCollectMode)} className="rounded border px-2 py-1">
            <option value="">{tAttr('선택')}</option>
            {WIFI_COLLECT_MODES.map((m) => <option key={m} value={m}>{tAttr(WIFI_COLLECT_MODE_LABEL[m])}</option>)}
          </select>
        </label>
        <button type="button" className="min-h-[36px] rounded bg-gray-900 px-3 text-white disabled:opacity-40" disabled={!label.trim() || !mode || create.isPending} onClick={() => create.mutate()}><T k="수집기 발급" /></button>
      </div>
      {rotate.isError && <p className="mt-2 text-xs text-rose-700"><T k="키를 교체하지 못했습니다 — 이전 키가 그대로 유효합니다" /></p>}
      {issued && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs" data-wifi-issued-key>
          <p className="font-semibold text-amber-900"><Tf k="{이름} 수집기 키" params={{ 이름: issued.label }} />
            {issued.rotated && (issued.graceUntil
              ? <> · <T k="교체됨 — 이전 키는 이때까지만 받습니다:" /> <KDate value={issued.graceUntil} mode="datetime" /></>
              : <> · <T k="교체됨 — 이전 키는 더 이상 받지 않습니다" /></>)}</p>
          <p className="mt-1 break-all font-mono">{issued.key}</p>
          <p className="mt-1 text-amber-800"><T k="키는 지금 한 번만 보입니다 — 수집기 설정(X-Collector-Key)에 넣고 닫으십시오. 서버에는 해시만 남습니다." /></p>
          <button type="button" className="mt-2 rounded border border-amber-300 px-2 py-0.5" onClick={() => setIssued(null)}><T k="닫기" /></button>
        </div>
      )}
    </section>
  );
}

function BindingPanel({ s, statusFailed }: { s?: Status; statusFailed: boolean }) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  // 환자 상태 거르기(열린 연결만 · 2026-10-10) — '' = 전체(해제 포함)
  const [stateFilter, setStateFilter] = useState<'' | 'DECEASED' | 'NOT_ADMITTED' | 'ADMITTED'>('');
  const q = useQuery({
    queryKey: ['wifi-bindings', stateFilter],
    queryFn: () => apiClient.get<{ data: Binding[]; meta: { total: number; truncated: boolean } }>(`/api/v1/location/wifi/bindings${stateFilter ? `?state=${stateFilter}` : ''}`),
  });
  // 일괄 해제 — 사람이 고른 열린 연결만 · 사유 하나
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState('');
  const togglePick = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = useMutation({
    mutationFn: () => apiClient.post<{ data: { unbound: number; alreadyUnbound: number; notFound: number } }>('/api/v1/location/wifi/bindings/unbind-bulk', { ids: [...picked], reason: bulkReason.trim() }),
    onSuccess: () => { setPicked(new Set()); setBulkReason(''); qc.invalidateQueries({ queryKey: ['wifi-bindings'] }); qc.invalidateQueries({ queryKey: ['wifi-status'] }); },
  });
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [deviceRef, setDeviceRef] = useState('');
  const [kind, setKind] = useState<WifiDeviceKind | ''>('');
  const [basis, setBasis] = useState<'WRITTEN' | 'VERBAL_RECORDED' | ''>('');
  const [note, setNote] = useState('');
  const [unbinding, setUnbinding] = useState<{ id: string; reason: string } | null>(null);
  const hitsQ = useQuery({
    queryKey: ['wifi-bind-patient-search', search.trim()],
    queryFn: async (): Promise<PatientHit[]> => {
      const r = await apiClient.get<{ data: PatientHit[] | { data: PatientHit[] } }>(`/api/v1/patients?search=${encodeURIComponent(search.trim())}&limit=8`);
      return unwrap<PatientHit[]>(r.data);
    },
    enabled: search.trim().length >= 2 && !patient,
  });
  const bind = useMutation({
    mutationFn: () => apiClient.post('/api/v1/location/wifi/bindings', { deviceRef, deviceKind: kind, patientId: patient!.id, consentBasis: basis, consentNote: note || undefined }),
    onSuccess: () => { setDeviceRef(''); setKind(''); setBasis(''); setNote(''); setPatient(null); setSearch(''); qc.invalidateQueries({ queryKey: ['wifi-bindings'] }); qc.invalidateQueries({ queryKey: ['wifi-status'] }); },
  });
  const unbind = useMutation({
    mutationFn: (v: { id: string; reason: string }) => apiClient.post(`/api/v1/location/wifi/bindings/${v.id}/unbind`, { reason: v.reason }),
    onSuccess: () => { setUnbinding(null); qc.invalidateQueries({ queryKey: ['wifi-bindings'] }); qc.invalidateQueries({ queryKey: ['wifi-status'] }); },
  });
  const canBind = !!patient && deviceRef.trim().length >= 4 && !!kind && !!basis && (basis !== 'VERBAL_RECORDED' || note.trim().length > 0);
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-wifi-bindings>
      <h2 className="mb-1 text-sm font-bold text-gray-900"><T k="단말 ↔ 환자 연결" /></h2>
      <DecisionLine label="퇴원·사망 시 자동 해제:" attr="auto-unbind" decisionKey={s?.autoUnbind?.decisionKey ?? 'location.wifi.autoUnbindOnEnd'} failed={statusFailed}
        value={s?.autoUnbind === undefined ? undefined : s.autoUnbind.on
          ? <T k="켜짐 — 퇴원·전원·사망 처리 때 그 환자의 열린 연결을 해제합니다(사유에 결정 키를 남김)" />
          : <T k="꺼짐 — 아래 점검 거르기로 사람이 해제합니다" />} />
      <p className="mb-2 text-[11px] text-gray-500"><T k="환자에게 위치 태그를 건네거나 환자 단말을 연결할 때 기록합니다. 동의 근거가 있어야 연결되고, 단말 번호는 끝 4자리만 남습니다." /></p>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs" data-wifi-binding-filter>
        {([['', '전체'], ['DECEASED', '사망'], ['NOT_ADMITTED', '재원 중 아님'], ['ADMITTED', '재원 중']] as const).map(([v, l]) => (
          <button key={v || 'all'} type="button" aria-pressed={stateFilter === v} data-wifi-binding-filter-opt={v || 'ALL'}
            onClick={() => { setStateFilter(v); setPicked(new Set()); }}
            className={`min-h-[36px] rounded-lg px-2 ${stateFilter === v ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-700'}`}><T k={l} /></button>
        ))}
        {stateFilter && <span className="text-[11px] text-gray-500"><T k="열린 연결만 거릅니다" /></span>}
      </div>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : !q.data ? <div className="h-16 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />
        : q.data.data.length === 0 ? <p className="text-xs text-gray-500" data-wifi-bindings-empty><T k="연결된 단말이 없습니다 — 연결이 없으면 수집기가 보내도 측위하지 않습니다." /></p>
        : (
          <>
            <ul className="max-h-72 space-y-1 overflow-auto text-xs">
              {q.data.data.map((b) => (
                <li key={b.id} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${b.unboundAt ? 'bg-gray-50 text-gray-400' : 'bg-blue-50/40'}`} data-wifi-binding={b.unboundAt ? 'closed' : 'open'}>
                  {!b.unboundAt && <input type="checkbox" className="h-5 w-5" checked={picked.has(b.id)} onChange={() => togglePick(b.id)} aria-label={tAttr('일괄 해제에 넣기')} data-wifi-binding-pick={b.id} />}
                  <span className="font-medium">{b.patient ? joinPatientName(b.patient.familyName, b.patient.givenName) : '—'}</span>
                  <span className="text-gray-500">{b.patient?.mrn ?? ''}</span>
                  <span><T k={WIFI_DEVICE_KIND_LABEL[b.deviceKind] ?? b.deviceKind} /> …{b.displayHint ?? ''}</span>
                  <span className="text-gray-500"><T k={WIFI_CONSENT_BASIS_LABEL[b.consentBasis] ?? b.consentBasis} /></span>
                  <span className="text-gray-500"><KDate value={b.boundAt} mode="datetime" /></span>
                  {/* 열린 연결의 환자 상태 — 사망이면 측위를 저장하지 않는다 · 재원 아님은 외래 사용일 수 있어 판단은 사람 */}
                  {!b.unboundAt && b.patientState === 'DECEASED' && <span className="rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-800" data-wifi-binding-state="DECEASED"><T k="사망 — 해제 필요(측위 저장 안 함)" /></span>}
                  {!b.unboundAt && b.patientState === 'NOT_ADMITTED' && <span className="rounded bg-amber-50 px-1.5 text-[10px] text-amber-800" data-wifi-binding-state="NOT_ADMITTED"><T k="재원 중 아님 — 태그 회수 확인" /></span>}
                  {b.unboundAt
                    ? <span><T k="해제" /> <KDate value={b.unboundAt} mode="datetime" /> · {b.unboundReason}</span>
                    : <button type="button" className="ml-auto rounded border border-gray-200 px-2 py-0.5" onClick={() => setUnbinding({ id: b.id, reason: '' })}><T k="해제" /></button>}
                </li>
              ))}
            </ul>
            {q.data.meta.truncated && <p className="mt-1 text-[11px] text-gray-500"><Tf k="최근 {보임}건만 보입니다(전체 {전체}건)" params={{ 보임: q.data.data.length, 전체: q.data.meta.total }} /></p>}
          </>
        )}
      {picked.size > 0 && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-rose-50 p-3 text-xs" data-wifi-bulk-unbind>
          <span className="font-semibold text-rose-900"><Tf k="고른 연결 {n}개" params={{ n: picked.size }} /></span>
          <label className="flex flex-1 flex-col gap-1"><T k="해제 사유(모두 같은 사유로 남습니다)" /><input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} className="rounded border px-2 py-1" /></label>
          <button type="button" className="min-h-[44px] rounded bg-rose-600 px-3 text-white disabled:opacity-40" disabled={!bulkReason.trim() || bulk.isPending || picked.size > 100} onClick={() => bulk.mutate()} data-wifi-bulk-submit><T k="일괄 해제" /></button>
          <button type="button" className="min-h-[44px] px-2 text-gray-500" onClick={() => setPicked(new Set())}><T k="선택 비우기" /></button>
          {picked.size > 100 && <p className="w-full text-rose-700"><T k="한 번에 100개까지 해제합니다" /></p>}
          {bulk.isError && <p className="w-full text-rose-700"><T k="해제하지 못했습니다" /></p>}
        </div>
      )}
      {bulk.data && picked.size === 0 && <p className="mt-2 text-xs text-gray-700" data-wifi-bulk-result><Tf k="해제 {해제} · 이미 해제 {이미} · 없음 {없음}" params={{ 해제: bulk.data.data.unbound, 이미: bulk.data.data.alreadyUnbound, 없음: bulk.data.data.notFound }} /></p>}
      {unbinding && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-gray-50 p-3 text-xs">
          <label className="flex flex-1 flex-col gap-1"><T k="해제 사유" /><input value={unbinding.reason} onChange={(e) => setUnbinding({ ...unbinding, reason: e.target.value })} className="rounded border px-2 py-1" /></label>
          <button type="button" className="min-h-[44px] rounded bg-gray-900 px-3 text-white disabled:opacity-40" disabled={!unbinding.reason.trim() || unbind.isPending} onClick={() => unbind.mutate(unbinding)}><T k="해제" /></button>
          <button type="button" className="min-h-[36px] px-2 text-gray-500" onClick={() => setUnbinding(null)}><T k="닫기" /></button>
        </div>
      )}
      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-xs" data-wifi-bind-form>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1"><T k="환자" />
            {patient
              ? <span className="flex items-center gap-2 rounded border bg-gray-50 px-2 py-1">{joinPatientName(patient.familyName, patient.givenName)} · {patient.mrn}<button type="button" className="text-gray-500" onClick={() => setPatient(null)} aria-label={tAttr('환자 다시 고르기')}>×</button></span>
              : <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tAttr('이름·등록번호')} className="w-48 rounded border px-2 py-1" />}
          </label>
          <label className="flex flex-col gap-1"><T k="단말 번호(태그·MAC)" /><input value={deviceRef} onChange={(e) => setDeviceRef(e.target.value)} className="w-44 rounded border px-2 py-1 font-mono" /></label>
          <label className="flex flex-col gap-1"><T k="단말 종류" />
            <select value={kind} onChange={(e) => setKind(e.target.value as WifiDeviceKind)} className="rounded border px-2 py-1">
              <option value="">{tAttr('선택')}</option>
              {WIFI_DEVICE_KINDS.map((k) => <option key={k} value={k}>{tAttr(WIFI_DEVICE_KIND_LABEL[k])}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><T k="동의 근거" />
            <select value={basis} onChange={(e) => setBasis(e.target.value as 'WRITTEN' | 'VERBAL_RECORDED')} className="rounded border px-2 py-1">
              <option value="">{tAttr('선택')}</option>
              <option value="WRITTEN">{tAttr(WIFI_CONSENT_BASIS_LABEL.WRITTEN)}</option>
              <option value="VERBAL_RECORDED">{tAttr(WIFI_CONSENT_BASIS_LABEL.VERBAL_RECORDED)}</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1"><T k="동의 메모(구두 동의는 필수)" /><input value={note} onChange={(e) => setNote(e.target.value)} className="rounded border px-2 py-1" /></label>
          <button type="button" className="min-h-[44px] rounded bg-blue-600 px-3 text-white disabled:opacity-40" disabled={!canBind || bind.isPending} onClick={() => bind.mutate()}><T k="연결" /></button>
        </div>
        {!patient && hitsQ.data && hitsQ.data.length > 0 && (
          <ul className="max-w-sm rounded border bg-white">
            {hitsQ.data.map((p) => <li key={p.id}><button type="button" className="w-full px-2 py-1 text-left hover:bg-gray-50" onClick={() => setPatient(p)}>{joinPatientName(p.familyName, p.givenName)} · {p.mrn}</button></li>)}
          </ul>
        )}
        {bind.isError && <p className="text-rose-700"><T k="연결하지 못했습니다 — 이미 다른 연결이 열린 단말인지 확인하십시오" /></p>}
      </div>
    </section>
  );
}

function ProtocolPanel() {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 text-xs shadow-sm" data-wifi-protocol>
      <h2 className="mb-2 text-sm font-bold text-gray-900"><T k="수집 프로토콜" /> <span className="font-mono font-normal text-gray-500">{WIFI_LOCATION_SCHEMA}</span></h2>
      <ul className="list-disc space-y-1 pl-5 text-gray-600">
        <li><T k="POST /api/v1/location/wifi/ingest · 헤더 X-Collector-Key · 한 번에 관측 500건까지" /></li>
        <li><T k="관측 = 단말 식별자 · 관측 시각 · AP별 수신 세기(BSSID·dBm) — 형식이 틀리면 묶음 전체를 받지 않습니다" /></li>
        <li><Tf k="측위 — 신호가 가장 센 층을 고르고 강한 AP {수}대로 위치를 계산해 오차 반경을 함께 냅니다" params={{ 수: WIFI_SOLVER.topK }} /></li>
        <li><Tf k="오차가 {미터}m 를 넘거나 층이 모호하면 방을 고르지 않고 층까지만 기록합니다" params={{ 미터: WIFI_SOLVER.zoneMaxAccuracyM }} /></li>
        <li><Tf k="같은 방이 {수}번 연속 잡혀야 환자 위치를 옮깁니다(방 경계 떨림 방지)" params={{ 수: WIFI_SOLVER.zoneConfirmFixes }} /></li>
        <li><T k="연결되지 않은 단말은 저장하지 않고 수만 셉니다 · 단말 식별자 원문은 저장하지 않습니다" /></li>
      </ul>
      <p className="mt-2 text-[11px] text-gray-500"><T k="정본 문서: docs/01-plan/features/wifi-ap-location.plan.md" /></p>
    </section>
  );
}
