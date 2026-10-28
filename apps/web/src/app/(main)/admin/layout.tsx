'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth-store';
import { NAV_SECTIONS } from '@/components/layout/Sidebar';
import { T } from '@/components/ui/i18n-text';

/**
 * 관리 화면 접근 가드 — **사이드바가 선언한 역할을 그대로 읽는다.**
 *
 * 🔴 2026-08-26 실측: `(main)/admin` 아래 110개 화면 중 **역할을 검사하는 것은 4개**뿐이고
 *    공통 가드가 없었다. 사이드바는 메뉴를 숨기지만 **URL·화면번호로 들어가면 그대로 열렸고**,
 *    그 안에서 EP 마다 403 을 만났다(코드 마스터에서 AI 제안 3종이 전부 `Forbidden resource`).
 *    **nav 숨김 ≠ 권한 회수** — 이 저장소가 이미 규약으로 적어둔 함정이다.
 *
 * 🔴 **일괄 ADMIN 차단은 하지 않는다.** admin 아래에는 비관리자에게 **정당하게 열린 화면이 많다**
 *    (VoC→CRM · 약속처방→의사 · 낙상/욕창 재평가→간호사 · Go-Live→경영진 …).
 *    전부 막으면 그것이 더 큰 사고다. 그래서 **경로별 선언 역할**(NAV_SECTIONS)로 판정한다.
 *
 * 🔴 이 가드는 **화면 접근만** 막는다. 진짜 경계는 서버(RolesGuard)이고 그것은 그대로다 —
 *    여기서 막는 이유는 "들어가서 하나씩 403 을 만나는" 일을 없애기 위해서다.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isLoading } = useAuthStore();

  // 선언을 찾지 못하면 막지 않는다 — 🔴 등재되지 않은 화면을 가드가 조용히 지우면 안 된다
  const declared = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === pathname);
  const allowed = declared?.roles as readonly string[] | undefined;

  if (isLoading || !user || !allowed) return <>{children}</>;
  if (allowed.includes(user.role)) return <>{children}</>;

  return (
    <div className="max-w-lg mx-auto mt-16 rounded-2xl border border-gray-200 bg-white p-8 text-center">
      <p className="text-sm font-semibold text-gray-900"><T k="이 화면을 볼 수 있는 권한이 없습니다" /></p>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">
        <b><T k={declared?.label ?? pathname} /></b> 은(는) {allowed.join(' · ')} 계정만 사용할 수 있습니다.
        <br />
        지금 계정의 권한은 <b>{user.role}</b> 입니다.
      </p>
      {/* 🔴 막기만 하고 보내지 않으면 사용자는 뒤로가기밖에 못 한다 */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <Link href="/dashboard" className="rounded-lg border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
          <T k="대시보드로" />
        </Link>
      </div>
      <p className="mt-4 text-[11px] text-gray-400">
        <T k="권한이 필요하면 전산실에 문의하세요 — 화면 이름과 지금 계정을 함께 알려주시면 빠릅니다." />
      </p>
    </div>
  );
}
