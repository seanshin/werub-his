'use client';

import { sanitizeHtml } from '@/lib/sanitize';
import { Unit } from '@/components/ui/display';

interface Props {
  content: string;
  className?: string;
}

const SECTION_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-100', icon: 'bg-blue-500', text: 'text-blue-900' },
  { bg: 'bg-emerald-50', border: 'border-emerald-100', icon: 'bg-emerald-500', text: 'text-emerald-900' },
  { bg: 'bg-amber-50', border: 'border-amber-100', icon: 'bg-amber-500', text: 'text-amber-900' },
  { bg: 'bg-violet-50', border: 'border-violet-100', icon: 'bg-violet-500', text: 'text-violet-900' },
  { bg: 'bg-rose-50', border: 'border-rose-100', icon: 'bg-rose-500', text: 'text-rose-900' },
  { bg: 'bg-sky-50', border: 'border-sky-100', icon: 'bg-sky-500', text: 'text-sky-900' },
  { bg: 'bg-teal-50', border: 'border-teal-100', icon: 'bg-teal-500', text: 'text-teal-900' },
];

const ORG_COLORS = [
  { bg: 'bg-blue-600', text: 'text-white', light: 'bg-blue-50 border-blue-200 text-blue-800' },
  { bg: 'bg-emerald-600', text: 'text-white', light: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  { bg: 'bg-violet-600', text: 'text-white', light: 'bg-violet-50 border-violet-200 text-violet-800' },
  { bg: 'bg-amber-600', text: 'text-white', light: 'bg-amber-50 border-amber-200 text-amber-800' },
  { bg: 'bg-rose-600', text: 'text-white', light: 'bg-rose-50 border-rose-200 text-rose-800' },
  { bg: 'bg-teal-600', text: 'text-white', light: 'bg-teal-50 border-teal-200 text-teal-800' },
  { bg: 'bg-indigo-600', text: 'text-white', light: 'bg-indigo-50 border-indigo-200 text-indigo-800' },
];

export function ContentRenderer({ content, className }: Props) {
  // HTML 콘텐츠 → 산정화 후 렌더링.
  // @tailwindcss/typography(prose) 미설치 + Preflight가 기본 태그 스타일을 제거하므로,
  //   arbitrary variant 로 h2/h3/h4/p/ul/ol/li/strong 구조 스타일을 직접 부여(폰트크기는 className 상속).
  if (content.includes('<')) {
    return (
      <div
        className={
          'max-w-none ' +
          '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-gray-900 [&_h2]:mt-7 [&_h2]:mb-3 ' +
          '[&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:text-gray-900 [&_h3]:mt-7 [&_h3]:mb-2.5 [&_h3]:pl-3 [&_h3]:border-l-[3px] [&_h3]:border-blue-500 [&_h3:first-child]:mt-0 ' +
          '[&_h4]:font-semibold [&_h4]:text-gray-800 [&_h4]:mt-5 [&_h4]:mb-2 ' +
          '[&_p]:leading-[1.75] [&_p]:my-2.5 ' +
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-3 ' +
          '[&_li]:my-1.5 [&_li]:pl-1 [&_li]:marker:text-blue-400 ' +
          '[&_strong]:font-semibold [&_strong]:text-gray-800 [&_a]:text-blue-600 [&_a]:underline ' +
          '[&_hr]:my-5 [&_hr]:border-gray-100 ' +
          (className ?? '')
        }
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    );
  }

  // 트리 구조 (├──, └──) → 조직도 렌더링
  if (content.includes('├') || content.includes('└')) {
    return <OrgChartRenderer content={content} className={className} />;
  }

  // 구조화된 텍스트 감지 (■, •, 1., Q:, A: 등)
  if (content.includes('■') || (content.includes('•') && content.includes('\n'))) {
    return <StructuredText content={content} className={className} />;
  }

  // 일반 텍스트
  return <div className={`whitespace-pre-line leading-relaxed ${className ?? ''}`}>{content}</div>;
}

/** 트리 구조 텍스트 → 시각적 조직도 */
function OrgChartRenderer({ content, className }: { content: string; className?: string }) {
  const lines = content.split('\n').filter(l => l.trim());

  // 트리 파싱: 들여쓰기 깊이 계산
  interface OrgNode { name: string; depth: number; children: OrgNode[] }
  const root: OrgNode = { name: '', depth: -1, children: [] };
  const stack: OrgNode[] = [root];

  for (const line of lines) {
    const cleanName = line.replace(/[├└│─\s|]/g, ' ').trim();
    if (!cleanName) continue;

    // 깊이: ├ 또는 └ 앞의 │ 또는 공백 수로 계산
    const match = line.match(/^([\s│|]*)[├└]/);
    const depth = match ? Math.floor(match[1].replace(/│/g, '  ').length / 2) : 0;

    const node: OrgNode = { name: cleanName, depth, children: [] };

    // 올바른 부모 찾기
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const topLevel = root.children;
  if (topLevel.length === 0) {
    return <div className={`whitespace-pre-line ${className ?? ''}`}>{content}</div>;
  }

  // 최상위가 1개면 그것이 루트(병원장)
  const orgRoot = topLevel.length === 1 ? topLevel[0] : { name: '조직', depth: 0, children: topLevel };

  return (
    <div className={`${className ?? ''}`}>
      {/* 루트 노드 */}
      <div className="flex justify-center mb-8">
        <div className="bg-gray-900 text-white px-8 py-3 rounded-2xl text-base font-bold shadow-lg">
          {orgRoot.name}
        </div>
      </div>

      {/* 부서 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {orgRoot.children.map((dept, di) => {
          const color = ORG_COLORS[di % ORG_COLORS.length];
          return (
            <div key={di} className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              {/* 부서 헤더 */}
              <div className={`${color.bg} ${color.text} px-4 py-3`}>
                <h3 className="text-sm font-bold">{dept.name}</h3>
                {dept.children.length > 0 && (
                  <p className="text-[10px] opacity-80 mt-0.5">{dept.children.length}<Unit>개</Unit> 팀</p>
                )}
              </div>
              {/* 하위 조직 */}
              {dept.children.length > 0 && (
                <div className="p-3 space-y-1.5">
                  {dept.children.map((team, ti) => (
                    <div key={ti}>
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${color.light}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${color.bg}`} />
                        {team.name}
                      </div>
                      {/* 3단계 하위 */}
                      {team.children.length > 0 && (
                        <div className="ml-6 mt-1 space-y-0.5">
                          {team.children.map((sub, si) => (
                            <p key={si} className="text-[11px] text-gray-500 flex items-center gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-gray-300" />
                              {sub.name}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StructuredText({ content, className }: { content: string; className?: string }) {
  const lines = content.split('\n');
  const sections: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;
  const intro: string[] = [];
  const footer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 섹션 헤더: ■
    if (trimmed.startsWith('■')) {
      if (current) sections.push(current);
      current = { title: trimmed.replace(/^■\s*/, ''), items: [] };
    }
    // 질문/답변
    else if (trimmed.startsWith('Q:') || trimmed.startsWith('A:')) {
      if (!current) intro.push(trimmed);
      else current.items.push(trimmed);
    }
    // 리스트 아이템
    else if (current) {
      current.items.push(trimmed.replace(/^[•·\-]\s*/, ''));
    }
    // 푸터 (📞, ※ 등)
    else if (trimmed.startsWith('📞') || trimmed.startsWith('☎') || trimmed.startsWith('※') || trimmed.startsWith('⚠')) {
      footer.push(trimmed);
    }
    // 인트로
    else {
      intro.push(trimmed);
    }
  }
  if (current) sections.push(current);

  return (
    <div className={`space-y-4 ${className ?? ''}`}>
      {/* 인트로 (Q/A 포함) */}
      {intro.length > 0 && (
        <div className="space-y-2">
          {intro.map((line, i) => {
            if (line.startsWith('Q:')) return <p key={i} className="text-base font-bold text-gray-900">{line.replace('Q: ', '')}</p>;
            if (line.startsWith('A:')) return <p key={i} className="text-sm text-gray-600 bg-blue-50/50 rounded-lg px-4 py-2">{line.replace('A: ', '')}</p>;
            return <p key={i} className="text-sm text-gray-700">{line}</p>;
          })}
        </div>
      )}

      {/* 섹션 카드 */}
      {sections.map((sec, si) => {
        const color = SECTION_COLORS[si % SECTION_COLORS.length];
        const hasNumbered = sec.items.some(item => /^\d+[.)]/.test(item));

        // 마크다운 테이블 감지: |col|col| 패턴이 2줄 이상
        const tableRows = sec.items.filter(item => item.startsWith('|') && item.endsWith('|'));
        const separatorRows = sec.items.filter(item => /^\|[-|:\s]+\|$/.test(item));
        const isTable = tableRows.length >= 2 && separatorRows.length >= 1;

        // 테이블 이외의 일반 아이템
        const nonTableItems = isTable ? sec.items.filter(item => !(item.startsWith('|') && item.endsWith('|')) && !/^\|[-|:\s]+\|$/.test(item)) : sec.items;

        return (
          <div key={si} className={`${color.bg} border ${color.border} rounded-xl p-4`}>
            <h4 className={`text-sm font-bold ${color.text} flex items-center gap-2 mb-3`}>
              <span className={`w-1.5 h-5 ${color.icon} rounded-full`} />
              {sec.title}
            </h4>

            {/* 테이블 렌더링 */}
            {isTable && (() => {
              const dataRows = tableRows.filter(r => !/^[-|:\s]+$/.test(r.replace(/\|/g, '').trim()));
              const headerRow = dataRows[0];
              const bodyRows = dataRows.slice(1);
              const headers = headerRow.split('|').filter(Boolean).map(h => h.trim());
              return (
                <div className="overflow-x-auto mb-3">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        {headers.map((h, hi) => (
                          <th key={hi} className={`px-3 py-2 text-left font-bold text-white ${color.icon} first:rounded-tl-lg last:rounded-tr-lg border-r border-white/20 last:border-0`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bodyRows.map((row, ri) => {
                        const cells = row.split('|').filter(Boolean).map(c => c.trim());
                        return (
                          <tr key={ri} className={ri % 2 === 0 ? 'bg-white/60' : 'bg-white/30'}>
                            {cells.map((cell, ci) => (
                              <td key={ci} className="px-3 py-2 text-gray-700 border-t border-gray-200/50">{cell}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* 일반 아이템 */}
            {nonTableItems.length > 0 && (hasNumbered ? (
              <ol className="space-y-1.5 ml-4">
                {nonTableItems.map((item, ii) => {
                  const match = item.match(/^(\d+)[.)]\s*(.*)/);
                  return (
                    <li key={ii} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className={`w-5 h-5 rounded-full ${color.icon} text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        {match ? match[1] : ii + 1}
                      </span>
                      <span>{match ? match[2] : item}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <ul className="space-y-1.5 ml-1">
                {nonTableItems.map((item, ii) => (
                  <li key={ii} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className={`w-1.5 h-1.5 rounded-full ${color.icon} mt-2 flex-shrink-0 opacity-60`} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        );
      })}

      {/* 푸터 (연락처/주의사항) */}
      {footer.length > 0 && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
          {footer.map((line, i) => (
            <p key={i} className="text-xs text-gray-500">{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
