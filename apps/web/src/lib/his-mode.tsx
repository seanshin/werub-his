'use client';

import { useQuery } from '@tanstack/react-query';
import {
  HIS_MODE_META, HisMode, parseHisMode, resolveHisMode, isRuntimeModeEffective, showsSeedBadge,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { BUILD_HIS_MODE } from '@/lib/dev-test-accounts';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useTopBarDensity } from '@/components/layout/topbar-density';

/**
 * 운영 모드(개발/리허설/리얼) — 화면 쪽 소비 정본.
 *
 * 🔴 **두 층을 그대로 보여준다.** 빌드 상한(`BUILD_HIS_MODE`)은 이 번들이 무엇을 담고 있는지이고,
 *    런타임은 지금 무엇을 보이게 할지다. 실효 모드는 **둘 중 더 제한적인 쪽**이다.
 *
 * 🔴 서버 조회 실패는 "리얼"로도 "리허설"로도 번역하지 않는다 — **빌드 모드를 그대로 쓴다.**
 *    빌드 모드는 이미 안전측(기본 REAL)이라, 장애가 모드를 넓히는 일이 생기지 않는다.
 *    (`.catch(()=>기본값)` 이 "실패"를 "없음"으로 번역하던 결함을 여기서 반복하지 않는다.)
 */
export function useHisMode(opts?: { enabled?: boolean }) {
  const build = (parseHisMode(BUILD_HIS_MODE) ?? 'REAL') as HisMode;

  const { data, isError } = useQuery({
    // 닫힌 화면 구역이 쓰면 enabled:false — 그동안은 빌드 모드(안전측)로 판정한다
    enabled: opts?.enabled ?? true,
    queryKey: ['his-mode'],
    // 🔴 `apiClient` 는 접두를 붙이지 않는다 — 경로를 **전부** 적는다(`API_URL + path`).
    //    `/mode` 로 적었더니 Next 페이지 404 를 받아 배너가 "서버 미확인"을 상시 표시했다(2026-08-25).
    queryFn: () => apiClient.get<{ data: { runtime: string | null } }>('/api/v1/mode'),
    staleTime: 60_000,
    // 🔴 조회 실패를 영구 로딩이나 기본값으로 굳히지 않는다 — 아래에서 빌드 모드로 판정한다.
    retry: 1,
  });

  const runtime = parseHisMode(data?.data?.runtime);
  const effective = resolveHisMode(build, runtime);

  return {
    build,
    runtime,
    effective,
    /** 런타임이 빌드보다 넓히려 한 경우 false — 관리 화면이 그 사실을 말해야 한다 */
    runtimeEffective: isRuntimeModeEffective(build, runtime),
    // 🔴 **로딩 중을 "확인 불가"로 말하지 않는다.** 종전엔 `data === undefined` 를 함께 봐서
    //    첫 렌더마다 "서버 설정 미확인"이 떴다 — 모르는 것과 아직 안 온 것은 다른 사실이다.
    runtimeUnknown: isError,
    meta: HIS_MODE_META[effective],
    showSeedBadge: showsSeedBadge(effective),
  };
}

/**
 * 전 화면 상단 모드 배너.
 *
 * 🔴 리얼에서는 **아무것도 그리지 않는다.** 상시 배너는 곧 읽히지 않게 되고, 그러면 정작
 *    리허설 배너도 같이 안 보이게 된다(거짓 경보가 진짜 경보를 죽인다).
 *
 * 🔴 이 컴포넌트는 `(main)` 레이아웃에서 **전 직군의 모든 화면**에 렌더된다.
 *    그래서 `/mode` 는 `@Roles` 없이 JWT 만으로 열려 있어야 한다 — 2026-08-21 에 위급검사값 배너가
 *    임상 4역할 전용 EP 를 불러 14역할 중 9역할이 상시 403 배너를 보던 결함을 반복하지 않는다.
 *    그리고 실패해도 **오류를 그리지 않는다**(모드는 빌드 값으로 이미 안다).
 */
export function HisModeBanner({ className = '' }: { className?: string }) {
  const { effective, meta, runtimeUnknown } = useHisMode();
  // 🔴 안전 문구다 — 번역은 되게 하되 뜻을 약하게 만들지 않는다("차단"이 "제한"이 되면 안 된다).
  //    문구 정본은 shared `HIS_MODE_META` 하나이고, 여기서는 렌더 지점에서만 조회한다.
  const tAttr = useTAttr();
  if (effective === 'REAL') return null;

  const tone =
    meta.tone === 'warn'
      ? 'bg-amber-50 text-amber-900 border-amber-200'
      : 'bg-sky-50 text-sky-900 border-sky-200';

  // 🔴 한 줄·짧게. 상시 노출이라 길면 자리를 잡아먹고, 길어서 안 읽히면 배너가 없는 것과 같다.
  return (
    <div
      role="status"
      title={tAttr(meta.banner)}
      className={`flex shrink-0 items-center justify-center gap-1.5 border-b px-3 py-1 text-[11px] leading-none ${tone} ${className}`}
    >
      <T k={meta.label} className="font-semibold" />
      <T k={meta.short} className="opacity-70" />
      {runtimeUnknown && <span className="opacity-50">· <T k="서버 미확인" /></span>}
    </div>
  );
}

/**
 * 상단 바 안에 들어가는 **압축 칩** — 정상 레이아웃용.
 *
 * 🔴 종전에는 전 화면 상단에 **띠를 하나 더 얹었다**. 상단 바 위에 줄이 겹쳐 정돈되지 않았고
 *    (2026-08-26 사람 신고), 세로 공간을 상시로 먹었다. 같은 사실을 **한 칸 안에서** 말한다.
 *    자세한 문장은 `title` 로 남긴다 — 짧게 보이되 알 수 있게.
 *
 * 🔴 리얼 모드에서는 아무것도 그리지 않는다(상시 표시는 곧 안 읽힌다).
 */
export function HisModeChip() {
  const { effective, meta, runtimeUnknown } = useHisMode();
  // 🔴 안전 문구(위 배너와 같은 정본) — 번역하되 "차단"을 약하게 옮기지 않는다.
  const tAttr = useTAttr();
  const density = useTopBarDensity();
  if (effective === 'REAL') return null;

  const tone =
    meta.tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-sky-200 bg-sky-50 text-sky-700';

  return (
    <span
      role="status"
      title={`${tAttr(meta.banner)}${runtimeUnknown ? ` (${tAttr('서버 설정을 확인하지 못해 배포 시 모드로 표시 중')})` : ''}`}
      className={`hidden md:inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] leading-none ${tone}`}
    >
      <T k={meta.label} className="font-semibold" />
      {/* 자리가 모자라면 이름만 — 설명은 title 로(글자가 세로로 쪼개지던 것 · 2026-09-29 · 상단 바 밀도) */}
      {density === 0 && <T k={meta.short} className="opacity-70" />}
      {runtimeUnknown && <span className="opacity-50">·<T k="확인불가" /></span>}
    </span>
  );
}

/**
 * 빌드 모드만으로 판정하는 배너 — **비인증 화면용**(환자포털 로그인·인터넷예약).
 *
 * 🔴 `/mode` 는 JWT 가 필요하므로 로그인 전 화면은 런타임 토글을 알 수 없다.
 *    모르는 것을 아는 척하지 않는다: 빌드 모드로만 말하고, 런타임으로 좁혀졌을 가능성은 다루지 않는다
 *    (넓히는 방향은 애초에 불가능하므로 **이 배너가 거짓으로 안심시키는 일은 없다**).
 */
export function BuildModeBanner({ className = '' }: { className?: string }) {
  const build = (parseHisMode(BUILD_HIS_MODE) ?? 'REAL') as HisMode;
  if (build === 'REAL') return null;
  const meta = HIS_MODE_META[build];
  return (
    <div
      role="status"
      className={`border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-[12px] text-amber-900 ${className}`}
    >
      <span className="font-semibold">{meta.label}</span> <span className="opacity-90">{meta.banner}</span>
    </div>
  );
}
