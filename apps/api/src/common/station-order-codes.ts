import type { PrismaService } from '../infrastructure/prisma/prisma.service';

/**
 * 논리 스테이션 검사항목 설정(`workstation_configs.order_codes`) ↔ 수가 마스터 대조 — **정본 하나**.
 *
 * 🔴 워크리스트 큐(`WorkstationService.getQueue`)가 "어떤 코드로 거를 것인가"를 정하는 대조와
 *    관리 화면(/admin/workstations)이 "이 설정이 무엇을 잡는가"를 보여주는 대조가 **같은 함수**여야 한다.
 *    둘이 따로 대조하면 화면은 "맞음"이라 하고 큐는 부서 전체로 떨어지는 모순이 생긴다(P12).
 *
 * 🔴 기초검사(DIAGNOSTIC) 자리의 코드는 수가코드가 아니라 **검사 종류 어휘**라 여기로 오면 안 된다
 *    (`resolveDiagnosticStationTypes` 가 정본). 호출부가 category 로 먼저 가른다.
 */
type ProcedureCodeLookup = Pick<PrismaService, 'procedureCode'>;

export async function matchStationProcedureCodes(
  prisma: ProcedureCodeLookup,
  codes: string[],
): Promise<{ matched: Array<{ code: string; nameKo: string }>; unknown: string[] }> {
  if (!codes.length) return { matched: [], unknown: [] };
  const rows = await prisma.procedureCode.findMany({
    where: { code: { in: codes } },
    select: { code: true, nameKo: true },
  });
  // 수가 마스터는 같은 code 가 여러 행(버전)일 수 있다 — 코드당 하나로 접는다
  const byCode = new Map<string, { code: string; nameKo: string }>();
  for (const r of rows) if (!byCode.has(r.code)) byCode.set(r.code, { code: r.code, nameKo: r.nameKo });
  return { matched: [...byCode.values()], unknown: codes.filter((c) => !byCode.has(c)) };
}

/** 저장 전 정리 — 공백·중복만 없앤다. 🔴 마스터에 없는 코드는 **막지 않는다**(원내 코드 선등록 전 강제 → 거짓 데이터) */
export function cleanStationOrderCodes(codes: string[]): string[] {
  return [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
}
