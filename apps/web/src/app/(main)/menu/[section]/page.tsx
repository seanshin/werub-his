'use client';

import Link from 'next/link';
import { Unit } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { NAV_SECTIONS, SECTION_META, MENU_DOMAINS, SCREEN_CODE_BY_HREF, isNavItemVisible } from '@/components/layout/Sidebar';

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: string[]; group?: string };
type Group = { title: string; key?: string; desc?: string; items: Item[] };

/** 메뉴 허브 — 섹션/도메인 키로 진입. 설명 + 이동 가능한 화면 카드. */
export default function MenuHubPage() {
  const params = useParams<{ section: string }>();
  const key = params?.section ?? '';
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? 'ADMIN';
  // 🔴 (2026-09-30) 종전엔 역할만 보고 골라 사이드바와 다른 목록을 그렸다(진료과 좁히기·검진 소속이 빠짐 — 같은 사실에 정본이 둘).
  //    표시 판정은 사이드바 정본 하나(isNavItemVisible). 메뉴 오버라이드·부서 접근표는 사이드바만 조회한다.
  const pick = (items: Item[]) => items.filter((i) => Array.isArray(i.roles) && isNavItemVisible(i, { role, dept: user?.department ?? '', specialty: user?.specialty }));

  /**
   * 🔴 소분류가 있는 섹션은 **소분류마다 카드**로 나눈다.
   *    개원 전 시스템 관리는 36개가 한 카드에 쏟아져 "무엇을 여기서 정하는가"가 안 보였다.
   *    소분류가 없는 섹션은 **종전 그대로** 한 카드다(없는 분류를 지어내지 않는다).
   */
  const expand = (title: string, items: Item[], meta?: { key?: string; desc?: string }): Group[] => {
    const visible = pick(items);
    if (!visible.some((i) => i.group)) {
      return visible.length ? [{ title, key: meta?.key, desc: meta?.desc, items: visible }] : [];
    }
    const order: string[] = [];
    const byGroup = new Map<string, Item[]>();
    for (const it of visible) {
      const g = it.group ?? '기타';
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(it);
    }
    // 🔴 첫 카드만 섹션 설명을 든다 — 카드마다 반복하면 설명이 소음이 된다
    return order.map((g, i) => ({
      title: g,
      key: i === 0 ? meta?.key : undefined,
      desc: i === 0 ? meta?.desc : undefined,
      items: byGroup.get(g)!,
    }));
  };

  const domain = MENU_DOMAINS.find((d) => d.key === key);
  const sectionTitle = Object.keys(SECTION_META).find((t) => SECTION_META[t].key === key);

  let title = '';
  let desc = '';
  let groups: Group[] = [];

  if (domain) {
    title = domain.title;
    desc = domain.desc;
    groups = (NAV_SECTIONS as { title: string; items: Item[] }[])
      .filter((s) => (SECTION_META[s.title]?.domain ?? 'personal') === domain.key)
      .flatMap((s) => expand(s.title, s.items, { key: SECTION_META[s.title]?.key, desc: SECTION_META[s.title]?.desc }));
  } else if (sectionTitle) {
    const sec = (NAV_SECTIONS as { title: string; items: Item[] }[]).find((s) => s.title === sectionTitle);
    title = sectionTitle;
    desc = SECTION_META[sectionTitle].desc;
    groups = expand(sectionTitle, sec?.items ?? []);
  }

  if (!domain && !sectionTitle) {
    return <div className="max-w-3xl mx-auto px-4 py-20 text-center text-gray-400">메뉴를 찾을 수 없습니다.</div>;
  }

  const totalScreens = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-6 py-8">
      {/* 헤더 */}
      <div className="mb-8">
        <nav className="text-xs text-gray-400 mb-2">
          <Link href="/dashboard" className="hover:text-gray-600"><T k="대시보드" /></Link>
          <span className="mx-1.5">/</span>
          {/* title 은 NAV 섹션 제목이면 카탈로그 히트, 도메인 제목이면 미등록(원문+티) — 지어내지 않는다 */}
          <T k={title} className="text-gray-600 font-medium" />
        </nav>
        <h1 className="text-2xl font-bold text-gray-900"><T k={title} /></h1>
        {desc && <p className="text-sm text-gray-500 mt-1.5 max-w-2xl leading-relaxed">{desc}</p>}
        {totalScreens > 0 && <p className="text-[11px] text-gray-400 mt-2">{totalScreens}<Unit>개</Unit> 화면</p>}
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">접근 가능한 화면이 없습니다.</div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.title}>
              {/* 도메인 허브일 때만 그룹 헤더 노출(섹션 허브는 단일 그룹이라 생략) */}
              {domain && (
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-sm font-bold text-gray-800"><T k={g.title} /></h2>
                  {g.key && <Link href={`/menu/${g.key}`} className="text-[11px] text-blue-600 hover:underline">전체 보기 →</Link>}
                </div>
              )}
              {g.desc && domain && <p className="text-xs text-gray-400 -mt-2 mb-3">{g.desc}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const code = SCREEN_CODE_BY_HREF[item.href];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3.5 shadow-sm hover:shadow-md hover:border-blue-100 transition-all"
                    >
                      <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <T k={item.label} className="block text-sm font-semibold text-gray-900 truncate" />
                        {code && <span className="block text-[10px] text-gray-400 font-mono">{code}</span>}
                      </span>
                      <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
