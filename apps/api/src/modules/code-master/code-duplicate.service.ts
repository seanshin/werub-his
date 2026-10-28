import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { normalizeTerm } from '../../common/code-search';
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';

/**
 * 중복·유사 코드 탐지(F6).
 *
 * 🔴 **"동일 명칭 = 중복"이 아니다**(2026-08-26 운영 실측으로 전제를 뒤집었다).
 *   - 진단 `V19.4`/`V29.4`/`V59.4`/`V79.4` 는 명칭이 같지만 **자전거·오토바이·승용차·버스** 탑승자다.
 *   - 수가는 한 마취 행위에 **240개 코드**(HIRA 종별·시간 가산 체계)가 정상이다.
 *   - 약품은 같은 제품명에 **포장 단위별 보험코드**(생리식염수 14개)가 정상이다.
 *   명칭만으로 세면 수가에서만 **8,535 그룹**이 나오고, 그것을 "중복"이라 부르면
 *   누군가 가산 코드를 병합해 **청구를 망가뜨린다.**
 *
 * 🔴 그래서 **고시 마스터는 탐지 대상이 아니다.** HIRA 가 정본이고 우리가 판단할 자리가 아니다.
 *    실제로 중복이 생기는 곳은 **원내에서 사람이 만든 코드**(`origin='LOCAL'`)뿐이다.
 *
 * 🔴 **병합 EP 를 새로 만들지 않았다.** 병합은 "하나를 폐지하고 후속 코드를 잇는 것"이고
 *    그 정본은 C3 의 `retire()` 에 이미 있다. 정본이 둘이 되면 갈라진다.
 */
export type DupTable = 'DiagnosisCode' | 'ProcedureCode' | 'MedicationCode';
const TABLES: DupTable[] = ['DiagnosisCode', 'ProcedureCode', 'MedicationCode'];

interface CodeRow {
  id: string;
  code: string;
  nameKo: string;
  origin: string | null;
}

export interface DuplicateReport {
  sourceTable: DupTable;
  /** 🔴 무엇을 검사했는지 — 범위를 말하지 않으면 "중복 없음"이 거짓 안심이 된다 */
  scope: string;
  /** 검사 대상 건수(분모) */
  scanned: number;
  /** 원내 코드끼리 명칭이 겹치는 무리 */
  groups: { name: string; codes: CodeRow[] }[];
  /** 🔴 원내로 만들었는데 **이미 마스터에 같은 명칭이 있는** 것 — 청구가 안 될 수 있다 */
  collidesWithMaster: { local: CodeRow; masterCodes: CodeRow[] }[];
  /** `notesMsg` 의 한국어 파생(같은 순서) — 화면은 `notesMsg` 를 조립한다(2026-09-15 I2) */
  notes: string[];
  notesMsg: ServerMessage[];
}

/** 마스터 대조는 한 원내 코드당 이만큼만 보여준다(자르면 잘랐다고 말한다) */
const MASTER_SAMPLE = 5;
/** 원내 코드가 이보다 많으면 마스터 대조를 하지 않는다(전건 스캔은 무겁다) */
const MASTER_CHECK_LIMIT = 500;

@Injectable()
export class CodeDuplicateService {
  private readonly logger = new Logger(CodeDuplicateService.name);

  constructor(private readonly prisma: PrismaService) {}

  private assertTable(t: string): DupTable {
    if (!TABLES.includes(t as DupTable)) {
      throw new BadRequestException(`알 수 없는 코드 종류입니다: ${t}`);
    }
    return t as DupTable;
  }

  private delegate(t: DupTable) {
    if (t === 'DiagnosisCode') return this.prisma.diagnosisCode;
    if (t === 'ProcedureCode') return this.prisma.procedureCode;
    return this.prisma.medicationCode;
  }

  async report(sourceTableRaw: string): Promise<DuplicateReport> {
    const sourceTable = this.assertTable(sourceTableRaw);
    const model = this.delegate(sourceTable) as {
      findMany: (a: unknown) => Promise<CodeRow[]>;
    };

    const locals = await model.findMany({
      where: { isActive: true, origin: 'LOCAL' },
      select: { id: true, code: true, nameKo: true, origin: true },
      take: MASTER_CHECK_LIMIT + 1,
      orderBy: { code: 'asc' },
    });
    const truncated = locals.length > MASTER_CHECK_LIMIT;
    const rows = truncated ? locals.slice(0, MASTER_CHECK_LIMIT) : locals;

    const notesMsg: ServerMessage[] = [
      serverMsg('🔴 고시 마스터는 검사하지 않습니다 — 같은 명칭에 여러 코드가 있는 것이 정상입니다(수가 가산·약품 포장 단위·진단 사고 유형).'),
    ];

    // ── 원내 코드끼리 겹치는 무리
    const byName = new Map<string, CodeRow[]>();
    for (const r of rows) {
      const k = normalizeTerm(r.nameKo);
      byName.set(k, [...(byName.get(k) ?? []), r]);
    }
    const groups = [...byName.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([, v]) => ({ name: v[0].nameKo, codes: v }));

    // ── 원내 ↔ 마스터 명칭 충돌
    const collidesWithMaster: DuplicateReport['collidesWithMaster'] = [];
    for (const r of rows) {
      try {
        const master = await model.findMany({
          where: {
            isActive: true,
            nameKo: r.nameKo,
            NOT: { id: r.id },
            OR: [{ origin: null }, { origin: 'HIRA' }],
          },
          select: { id: true, code: true, nameKo: true, origin: true },
          take: MASTER_SAMPLE,
        });
        if (master.length) collidesWithMaster.push({ local: r, masterCodes: master });
      } catch (e) {
        // 🔴 못 본 것을 "충돌 없음"으로 접지 않는다 — 그 사실을 결과에 남긴다
        this.logger.error(`마스터 대조 실패(${r.code}): ${(e as Error).message}`);
        notesMsg.push(serverMsg('🔴 코드 {코드} 의 마스터 대조에 실패했습니다 — 충돌 여부를 알 수 없습니다.', { 코드: r.code }));
      }
    }

    if (rows.length === 0) {
      // 🔴 "중복 없음"이 아니라 **검사할 것이 없었다**고 말한다(분모부터 말한다)
      notesMsg.push(serverMsg('검사할 원내 등록 코드가 없습니다 — 지금까지 화면에서 만든 코드가 없다는 뜻이고, 중복이 없다는 뜻이 아닙니다.'));
    }
    if (truncated) {
      notesMsg.push(serverMsg('🔴 원내 코드가 {한도}건을 넘어 앞의 {한도}건만 검사했습니다 — 결과가 전부가 아닙니다.', { 한도: MASTER_CHECK_LIMIT }));
    }
    if (collidesWithMaster.length) {
      notesMsg.push(serverMsg('🔴 마스터에 같은 명칭이 이미 있는 원내 코드가 있습니다 — 청구가 되지 않을 수 있습니다. 병합은 [폐지 + 후속 코드 지정]으로 합니다(자동으로 합치지 않습니다).'));
    }

    return {
      sourceTable,
      scope: '원내 등록(origin=LOCAL) 코드만',
      scanned: rows.length,
      groups,
      collidesWithMaster,
      notes: notesMsg.map(renderServerMessageKo),
      notesMsg,
    };
  }
}
