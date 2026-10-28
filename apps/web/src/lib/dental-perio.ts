/**
 * 치주 측정값 파생 정본 (2026-08-13 · 화면 점검 W4)
 *
 * 🔴 치주차트가 실제 측정값 대신 상수 `[3,2,3,3,2,3]`·`bleeding [f,f,t,f,f,f]` 를 그리고 있었다.
 *    실측은 7mm 포켓·전면 BOP·동요도 2도(중증 치주염)인데 화면은 "전부 3mm 이하 초록"이라 말했다.
 *    같은 상수가 **부서 화면과 환자 차트 탭 두 곳에 복제**돼 있어 공용 부품으로 뽑는다
 *    (한 곳만 고치면 갈라진다 — W3 에서 네 번 반복된 교훈).
 *
 * 정본 원자료: `dentalChart.perioStatus[] = { tooth, pocket[6], bleeding[6], mobility, furcation }`
 */
export interface PerioDerived {
  teeth: string[];
  pocketDepths: Record<string, number[]>;
  bleeding: Record<string, boolean[]>;
  mobility: Record<string, number>;
}

export function derivePerio(charts: Array<Record<string, unknown>>): PerioDerived {
  const teeth: string[] = [];
  const pocketDepths: Record<string, number[]> = {};
  const bleeding: Record<string, boolean[]> = {};
  const mobility: Record<string, number> = {};

  for (const c of charts) {
    const rows = (c.perioStatus as Array<Record<string, unknown>> | null) ?? [];
    for (const t of rows) {
      const tooth = String(t.tooth ?? '');
      if (!tooth || teeth.includes(tooth)) continue; // 최신 차트 우선(서버 chartedAt desc)
      teeth.push(tooth);
      pocketDepths[tooth] = Array.isArray(t.pocket) ? (t.pocket as number[]) : [];
      bleeding[tooth] = Array.isArray(t.bleeding) ? (t.bleeding as boolean[]) : [];
      if (typeof t.mobility === 'number') mobility[tooth] = t.mobility;
    }
  }
  return { teeth, pocketDepths, bleeding, mobility };
}
