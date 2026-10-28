'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { formatBuildTs, buildTsAge, buildTsAgeMs } from '@/lib/build-status';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface BuildStatus { status?: string; ts?: string; at?: string; startedAt?: string; artifact?: string; sha256?: string; size?: string; stage?: string; ssmCommandId?: string; deployNote?: string }
/** 라이브 공개 사이트 표본 확인 — 트리거 기록과 다른 사실이다(checked=false 면 단정하지 않는다) */
interface LiveFreshness { checked: boolean; fresh: boolean | null; url: string; detail: string }
/** 발행 전 점검 — 🔴 '설정됨'은 스크립트 존재가 아니라 발행이 실제로 갈 수 있는가(2026-09-15 만료 키로 매번 S3 실패하는데 '설정됨'이었다) */
interface Preflight { script: boolean; awsCredentials: 'OK' | 'FAILED' | 'UNKNOWN'; awsDetail: string; ssmConfigured: boolean }
/** 버튼이 빌드할 서버 소스의 커밋 — HIS 운영 커밋과 대조(모르면 null) */
interface SourceInfo { commit: string | null; syncedAt: string | null; hisCommit: string | null; matchesHis: boolean | null }
interface StatusResp {
  configured: boolean; mode?: string; last?: (BuildStatus & { sourceCommit?: string | null }) | null; live?: LiveFreshness;
  preflight?: Preflight; source?: SourceInfo; lastPublished?: { ts: string; sourceCommit?: string | null } | null;
  liveSource?: { checked: boolean; commit: string | null };
}
const short = (c?: string | null) => (c ? c.slice(0, 8) : null);

/**
 * 시각 표시·경과 계산은 `lib/build-status` 정본을 쓴다.
 * 🔴 2026-09-02 실측: 상태 파일의 `ts` 는 아티팩트 파일명과 같은 압축 형식(`20260617-1748`)이라
 *    `new Date()` 가 Invalid Date 를 냈다 — 화면은 "Invalid Date" 를 그렸고 경과·만료 판정이 죽어
 *    6월 기록이 오늘도 '배포 전환 중 … 잠시 후 반영'으로 보였다.
 */
const stampOf = (st?: BuildStatus | null) => (st?.at || st?.startedAt || st?.ts || '');

/** 빌드 상태 파일이 갱신되지 않은 채 이 시간을 넘기면 '빌드 중'은 더 이상 사실이 아니다 */
const STALE_MS = 10 * 60 * 1000;
/**
 * 🔴 `deploy_triggered` 에는 만료가 없어, 6월의 트리거가 오늘도 '배포 전환 중'으로 보였다.
 *    무중단 전환은 분 단위 작업이다 — 이만큼 지나면 '전환 중'은 진행 상황이 아니라 **마지막으로 들은 말**이다.
 */
const TRIGGER_STALE_MS = 30 * 60 * 1000;
const isStale = (st?: BuildStatus | null) => {
  if (!st) return false;
  const age = buildTsAgeMs(st.status === 'building' ? (st.startedAt || stampOf(st)) : stampOf(st));
  if (age === null) return false; // 시각을 못 읽으면 판정하지 않는다(모르는 것을 아는 척하지 않는다)
  if (st.status === 'building') return age > STALE_MS;
  if (st.status === 'deploy_triggered') return age > TRIGGER_STALE_MS;
  return false;
};
/**
 * 🔴 (2026-09-15) S3 발행은 됐는데 SSM 전환 트리거가 실패한 기록(`success`+`deployNote`)을 녹색 '발행 완료'로 그렸다 —
 *    같은 화면 아래 라이브 확인은 '낡은 빌드'라 말이 엇갈렸다. 발행과 전환은 다른 사실이다.
 */
const lastBadge = (last?: BuildStatus | null) => {
  if (last?.status === 'success' && last.deployNote) return { t: '발행됨 · 전환 안 됨', c: 'bg-amber-100 text-amber-700' };
  return badge(last?.status);
};
const badge = (st?: string) => {
  if (st === 'building') return { t: '빌드 중', c: 'bg-blue-100 text-blue-700' };
  if (st === 'deploy_triggered') return { t: '배포 전환 중', c: 'bg-violet-100 text-violet-700' };
  if (st === 'success') return { t: '발행 완료', c: 'bg-emerald-100 text-emerald-700' };
  if (st === 'failed') return { t: '실패', c: 'bg-red-100 text-red-700' };
  return { t: st ?? '없음', c: 'bg-gray-100 text-gray-500' };
};

const PREFLIGHT_STYLE = {
  OK: { t: '정상', c: 'bg-emerald-100 text-emerald-700' },
  FAILED: { t: '실패 예상', c: 'bg-red-100 text-red-700' },
  UNKNOWN: { t: '확인 불가', c: 'bg-gray-100 text-gray-600' },
} as const;
function PreflightRow({ ok, label, detail }: { ok: 'OK' | 'FAILED' | 'UNKNOWN'; label: string; detail: string }) {
  const s = PREFLIGHT_STYLE[ok];
  return (
    <div className="flex items-start gap-2">
      <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 shrink-0 ${s.c}`}><T k={s.t} /></span>
      <p className="text-xs text-gray-600"><b>{label}</b> — {detail}</p>
    </div>
  );
}

export default function HomepageDeployPage() {
  const tAttr = useTAttr();
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [deploying, setDeploying] = useState(false);

  const load = useCallback(() => {
    apiClient.get<{ data: StatusResp }>('/api/v1/hospital-info/deploy-homepage/status')
      .then(r => setStatus(r.data)).catch(() => {});
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const deploy = async () => {
    if (deploying) return;
    if (!confirm(tAttr('홈페이지를 빌드·발행할까요?\n(코드/디자인 변경 반영 — HIS 서버에서 빌드 후 S3 발행, 인프라가 무중단 전환)'))) return;
    setDeploying(true);
    try {
      await apiClient.post('/api/v1/hospital-info/deploy-homepage', {});
      toast.success(tAttr('빌드 시작 — 아래에서 진행 상태를 확인하세요.'));
      setTimeout(load, 3000);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? tAttr('빌드 시작 실패 — 아래 발행 전 점검을 확인하세요'));
    } finally { setDeploying(false); }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="홈페이지 배포" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="코드·디자인·정적자원(HTML/CSS/이미지) 변경을 빌드·발행합니다." /></p>
        </div>
        <Link href="/admin/homepage" className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">← <T k="홈페이지 관리" /></Link>
      </div>

      {/* 안내 — 두 채널 구분 */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <p className="text-sm font-bold text-emerald-800"><T k="콘텐츠 변경 (글·사진·배너)" /></p>
          <p className="text-xs text-emerald-700 mt-1"><T k="CMS 수정" /> → <Link href="/admin/homepage" className="underline"><T k="홈페이지 관리" /></Link><T k="의" /> <b>&quot;<T k="즉시 반영" />&quot;</b>. <T k="재빌드 불필요." /></p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-sm font-bold text-blue-800"><T k="코드/디자인 변경 (이 화면)" /></p>
          <p className="text-xs text-blue-700 mt-1"><T k="레이아웃·CSS·새 페이지·로고 등 → 아래" /> <b>&quot;<T k="빌드·발행" />&quot;</b>. <T k="서버 빌드 → S3 발행 → 인프라가 무중단 전환(blue-green)." /></p>
        </div>
      </div>

      {/* 배포 트리거 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-gray-800"><T k="빌드·발행 (HIS 서버 빌드 → S3)" /></p>
            <p className="text-xs text-gray-500 mt-0.5"><T k="서버에 동기화된 apps/homepage 를 격리 빌드해 S3에 발행합니다. 서버 반영은 인프라 측 무중단 배포." /></p>
          </div>
          {/* 🔴 W9(P16): 상태가 'building' 으로 굳으면 버튼이 영구히 잠겼다. 10분 넘게 갱신이 없으면
              '빌드 중'은 사실이 아니라 **마지막으로 들은 말**이다 — 재시도를 막지 않는다. */}
          <button onClick={deploy} disabled={deploying || (status?.last?.status === 'building' && !isStale(status.last))}
            className="shrink-0 text-sm font-medium text-white bg-blue-600 rounded-xl px-4 py-2 hover:bg-blue-700 disabled:opacity-50">
            <T k={status?.last?.status === 'building' && !isStale(status.last) ? '빌드 중…' : deploying ? '트리거 중…' : '🚀 빌드·발행'} />
          </button>
        </div>
        {status && !status.configured && (
          <p className="text-xs text-amber-600 mt-3">⚠️ <T k="발행이 실패할 상태입니다 — 아래 발행 전 점검을 확인하세요." /></p>
        )}
        {status?.preflight && (
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-700"><T k="발행 전 점검" /></p>
            <PreflightRow ok={status.preflight.script ? 'OK' : 'FAILED'} label={tAttr('빌드 스크립트')}
              detail={status.preflight.script ? tAttr('서버에 배치됨') : tAttr('빌드 스크립트 미배치 — HIS 배포(deploy.sh --api)가 함께 올립니다')} />
            <PreflightRow ok={status.preflight.awsCredentials} label={tAttr('AWS 자격(S3 발행)')} detail={status.preflight.awsDetail} />
            <PreflightRow ok={status.preflight.ssmConfigured ? 'OK' : 'UNKNOWN'} label={tAttr('라이브 전환(SSM)')}
              detail={status.preflight.ssmConfigured ? tAttr('전환 문서·대상 설정됨(실행 성공 여부는 발행 후 라이브 확인으로 판정)') : tAttr('전환 설정 없음 — 발행까지만 되고 라이브 전환은 인프라 수동')} />
            {status.source && (
              <PreflightRow
                ok={status.source.commit == null ? 'UNKNOWN' : status.source.matchesHis === false ? 'FAILED' : status.source.matchesHis ? 'OK' : 'UNKNOWN'}
                label={tAttr('빌드할 소스')}
                detail={status.source.commit == null
                  ? tAttr('서버 소스의 커밋 기록이 없습니다 — 어느 코드가 발행될지 확인할 수 없습니다(다음 HIS 배포가 기록합니다)')
                  : `${short(status.source.commit)} · ${status.source.matchesHis === false
                      ? `${tAttr('HIS 운영 커밋과 다릅니다')} (${short(status.source.hisCommit)})`
                      : status.source.matchesHis ? tAttr('HIS 운영 커밋과 같음') : tAttr('HIS 운영 커밋을 확인하지 못해 대조하지 않았습니다')}`} />
            )}
          </div>
        )}
      </div>

      {/* 라이브 확인 — 기록이 아니라 살아 있는 것 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <p className="text-sm font-bold text-gray-800 mb-1"><T k="공개 사이트 라이브 확인" /></p>
        <p className="text-[11px] text-gray-500 mb-3">
          <T k="위 기록은 배포를" /> <b><T k="시킨" /></b> <T k="시점입니다. 여기는 지금" /> <b><T k="서비스되고 있는" /></b> <T k="페이지를 직접 열어 확인한 결과입니다." />
        </p>
        {!status?.live ? (
          <p className="text-xs text-gray-400 py-2"><T k="확인 중…" /></p>
        ) : !status.live.checked ? (
          <div className="flex items-start gap-2">
            <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 shrink-0"><T k="확인 불가" /></span>
            <p className="text-xs text-gray-600">{status.live.detail}</p>
          </div>
        ) : status.live.fresh ? (
          <div className="flex items-start gap-2">
            <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700 shrink-0"><T k="최신 표본 확인" /></span>
            <p className="text-xs text-gray-600">{status.live.detail}</p>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-700 shrink-0"><T k="낡은 빌드" /></span>
            <p className="text-xs text-red-600">{status.live.detail}</p>
          </div>
        )}
        {status?.liveSource && (
          <p className="text-[11px] text-gray-500 mt-2">
            <T k="라이브 소스 커밋" />: {status.liveSource.checked
              ? (status.liveSource.commit ? short(status.liveSource.commit) : tAttr('기록 없음(소스 커밋 기록 도입 전 빌드)'))
              : tAttr('확인 불가')}
          </p>
        )}
        {status?.live?.url && <p className="text-[10px] text-gray-400 mt-2 break-all"><T k="확인 대상" />: {status.live.url}</p>}
      </div>

      {/* 최근 빌드 상태 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <p className="text-sm font-bold text-gray-800 mb-3"><T k="최근 빌드 상태" /></p>
        {status?.last ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${isStale(status.last) ? 'bg-amber-100 text-amber-700' : lastBadge(status.last).c}`}>
                <T k={isStale(status.last) ? '상태 불명' : lastBadge(status.last).t} />
              </span>
              <span className="text-xs text-gray-600">{formatBuildTs(stampOf(status.last))}</span>
              {buildTsAge(stampOf(status.last)) && (
                <span className="text-xs font-semibold text-gray-500">({buildTsAge(stampOf(status.last))})</span>
              )}
            </div>
            {isStale(status.last) && (
              <p className="text-[11px] text-amber-600">
                <T k={status.last.status === 'building'
                  ? '10분 넘게 상태 갱신이 없습니다 — 빌드가 시작되지 못했거나 중단됐을 수 있습니다(서버 /tmp/hp-build.log 확인). 재시도할 수 있습니다.'
                  : '이 기록은 배포를 **시킨** 시점입니다. 전환이 끝났는지는 이 값으로 알 수 없습니다 — 아래 라이브 확인을 보세요.'} />
              </p>
            )}
            {(status.last.status === 'success' || status.last.status === 'deploy_triggered') && (
              <p className="text-[11px] text-gray-500 break-all">📦 {status.last.artifact} {status.last.size && `(${status.last.size})`}<br/>sha256: {status.last.sha256}</p>
            )}
            {status.last.status === 'deploy_triggered' && (
              <p className="text-[11px] text-violet-600">
                → <T k="인프라 SSM 배포 트리거됨" /> (cmd {status.last.ssmCommandId}).
                {!isStale(status.last) && <> <T k="잠시 후 hospital.example.org 반영." /></>}
              </p>
            )}
            {status.last.status === 'success' && status.last.deployNote && (
              <p className="text-[11px] text-amber-600">{status.last.deployNote}</p>
            )}
            {status.last.status === 'failed' && (
              <p className="text-[11px] text-red-500"><T k="실패 단계" />: <T k={status.last.stage ?? '알 수 없음'} /> (<T k="서버 /tmp/hp-build.log 확인" />)</p>
            )}
            {status.last.status === 'failed' && (status.last.stage === 'credentials' || status.last.stage === 's3') && (
              <p className="text-[11px] text-red-500"><T k="AWS 자격이 거부되면 빌드가 성공해도 발행되지 않습니다 — 서버 AWS 키(his-api 환경변수 포함) 교체가 필요합니다." /></p>
            )}
            {status.last.sourceCommit !== undefined && (
              <p className="text-[11px] text-gray-500"><T k="이 빌드의 소스 커밋" />: {short(status.last.sourceCommit) ?? tAttr('기록 없음')}</p>
            )}
          </div>
        ) : <p className="text-xs text-gray-400 py-2"><T k="빌드 이력 없음" /></p>}
        <p className="text-[10px] text-gray-400 mt-3"><T k="성공 시 인프라가 S3 아티팩트를 staging→cutover(무중단) 배포합니다." /></p>
      </div>
    </div>
  );
}
