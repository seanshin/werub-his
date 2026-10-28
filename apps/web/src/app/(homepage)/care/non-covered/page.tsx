// 비급여 진료비용 고지 — 의료법 §45 / 복지부 「비급여 진료비용 등의 고지 지침」 서식
export const metadata = {
  title: '비급여 진료비용 고지 | 위루비병원',
  description: '의료법 제45조에 따른 비급여 진료비용 항목 및 금액 고지',
};

const API = process.env.NEXT_PUBLIC_API_URL || '';
const CAT_LABEL: Record<string, string> = {
  ROOM: '상급병실료', PROCEDURE: '처치 및 수술료', EXAM: '검사료', THERAPY: '치료료', MATERIAL: '치료재료', CERTIFICATE: '제증명수수료', OTHER: '기타',
};
const won = (n: number) => n.toLocaleString('ko-KR') + '원';

interface Item { id: string; code: string; name: string; category: string; price: number; description?: string; isActive: boolean; updatedAt: string }

async function getItems(): Promise<Item[]> {
  try {
    const res = await fetch(`${API}/api/v1/non-covered?activeOnly=true`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? []) as Item[];
  } catch { return []; }
}

export default async function NonCoveredPage() {
  const items = await getItems();
  const groups = new Map<string, Item[]>();
  for (const it of items) { const a = groups.get(it.category) ?? []; a.push(it); groups.set(it.category, a); }
  const lastUpdated = items.reduce<string>((m, i) => (i.updatedAt > m ? i.updatedAt : m), '');

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-10 lg:py-14">
      <h1 className="text-3xl lg:text-4xl font-extrabold text-[#0d4f4f] tracking-tight">비급여 진료비용 고지</h1>
      <p className="text-gray-500 mt-3 text-[15px] leading-relaxed">
        「의료법」 제45조 및 보건복지부 「비급여 진료비용 등의 고지 지침」에 따라 비급여 진료비용을 고지합니다.
        실제 진료 시 환자 상태·재료·난이도에 따라 금액이 달라질 수 있습니다.
      </p>
      {lastUpdated && <p className="text-xs text-gray-400 mt-2">최종 변경일: {new Date(lastUpdated).toLocaleDateString('ko-KR')}</p>}

      {items.length === 0 ? (
        <p className="mt-10 text-sm text-gray-400 text-center py-12 border border-dashed rounded-2xl">등록된 비급여 항목이 없습니다.</p>
      ) : (
        <div className="mt-8 space-y-8">
          {[...groups.entries()].map(([cat, list]) => (
            <section key={cat}>
              <h2 className="text-lg font-extrabold text-gray-900 mb-3">{CAT_LABEL[cat] ?? cat}</h2>
              <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left font-semibold px-4 py-2.5 w-28">코드</th>
                      <th className="text-left font-semibold px-4 py-2.5">항목 명칭</th>
                      <th className="text-right font-semibold px-4 py-2.5 w-32">비용</th>
                      <th className="text-left font-semibold px-4 py-2.5 w-48">특이사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((it) => (
                      <tr key={it.id} className="border-t border-gray-50">
                        <td className="px-4 py-2.5 text-gray-400 tabular-nums">{it.code}</td>
                        <td className="px-4 py-2.5 text-gray-800 font-medium">{it.name}</td>
                        <td className="px-4 py-2.5 text-right text-gray-900 font-semibold tabular-nums">{won(it.price)}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{it.description ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-8">※ 본 고지는 의료법 제45조에 따른 비급여 진료비용 고지이며, 세부 금액은 진료과·진료 내용에 따라 변동될 수 있습니다. 문의: 원무과 02-000-0000</p>
    </div>
  );
}
