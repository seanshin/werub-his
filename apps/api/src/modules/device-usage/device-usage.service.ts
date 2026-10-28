import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseGs1, type Gs1Parsed } from '@hospital-run/shared';

/**
 * 의료기기 사용·삽입 기록과 **리콜 역추적**.
 *
 * 🔴 발단(2026-08-26 실측): 삽입물이 자유 텍스트·JSON 으로만 남아 **리콜이 나면 그 로트가
 *    어느 환자에게 들어갔는지 찾을 수 없었다.** GTIN·로트로 셀 수 있어야 리콜이 성립한다.
 */
export interface ScanResult extends Gs1Parsed {
  /** 이 GTIN 으로 원내에 등록된 품목·장비가 있는가 — 🔴 없으면 없다고 말한다(지어내지 않는다) */
  known: { kind: 'INVENTORY' | 'EQUIPMENT'; id: string; name: string }[];
  summaryText: string;
}

@Injectable()
export class DeviceUsageService {
  private readonly logger = new Logger(DeviceUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 스캔 미리보기 — **아무것도 저장하지 않는다**(고시 반영과 같은 규약: 보고 나서 사람이 넣는다) */
  async scan(barcode: string): Promise<ScanResult> {
    const parsed = parseGs1(barcode);
    let known: ScanResult['known'] = [];
    if (parsed.gtin) {
      try {
        const [inv, eq] = await Promise.all([
          this.prisma.inventoryItem.findMany({ where: { gtin: parsed.gtin }, select: { id: true, name: true }, take: 5 }),
          this.prisma.equipment.findMany({ where: { gtin: parsed.gtin }, select: { id: true, name: true }, take: 5 }),
        ]);
        known = [
          ...inv.map((x) => ({ kind: 'INVENTORY' as const, id: x.id, name: x.name })),
          ...eq.map((x) => ({ kind: 'EQUIPMENT' as const, id: x.id, name: x.name })),
        ];
      } catch (e) {
        // 🔴 못 찾은 것과 못 읽은 것은 다르다 — 실패는 로그로 남기고 빈 목록을 "없음"이라 말하지 않는다
        this.logger.error(`GTIN 대조 실패(${parsed.gtin}): ${(e as Error).message}`);
      }
    }
    const { gs1Summary } = await import('@hospital-run/shared');
    return { ...parsed, known, summaryText: gs1Summary(parsed) };
  }

  /**
   * 사용 기록. 바코드를 주면 파싱해 채우고, **원문을 보존**한다.
   * 🔴 체크디지트가 틀려도 **막지 않는다** — 실제로 그 기기를 썼기 때문이다.
   *    대신 `gtinValid:false` 로 남겨 나중에 그 사실을 알 수 있게 한다(막으면 기록이 아예 안 남는다).
   */
  async record(input: {
    patientId: string; surgeryId?: string; encounterId?: string;
    barcode?: string; deviceName: string; manufacturer?: string;
    usageType?: string; quantity?: number; note?: string;
    gtin?: string; lotNumber?: string; serialNumber?: string;
  }, userId: string) {
    const name = (input.deviceName ?? '').trim();
    if (!name) throw new BadRequestException('기기명을 입력하세요');

    const parsed = input.barcode ? parseGs1(input.barcode) : null;
    // 손으로 넣은 값이 있으면 그것이 우선 — 사람이 스캔을 정정할 수 있어야 한다
    const gtin = input.gtin?.trim() || parsed?.gtin || null;
    const expiry = parsed?.expiry ?? null;

    const row = await this.prisma.deviceUsage.create({
      data: {
        patientId: input.patientId,
        surgeryId: input.surgeryId || null,
        encounterId: input.encounterId || null,
        gtin,
        gtinValid: parsed?.gtinValid ?? null,
        lotNumber: input.lotNumber?.trim() || parsed?.lot || null,
        serialNumber: input.serialNumber?.trim() || parsed?.serial || null,
        // 🔴 `DD=00`(월말)이면 일자를 지어내지 않는다 — 그 달 1일로 저장하고 `expiryDayUnknown` 을 켠다
        expiryDate: expiry ? new Date(Date.UTC(expiry.year, expiry.month - 1, expiry.day ?? 1)) : null,
        expiryDayUnknown: expiry?.dayUnknown ?? false,
        deviceName: name,
        manufacturer: input.manufacturer?.trim() || null,
        usageType: input.usageType || 'IMPLANT',
        quantity: input.quantity ?? 1,
        rawBarcode: input.barcode?.slice(0, 200) || null,
        unparsed: parsed?.unparsed?.length ? parsed.unparsed : undefined,
        note: input.note?.trim() || null,
        recordedBy: userId,
      },
    });

    this.logger.log(
      `기기 사용 기록 — 환자 ${input.patientId} · ${name} · GTIN ${gtin ?? '없음'}` +
        `${parsed?.gtinValid === false ? '(체크디지트 불일치)' : ''} · LOT ${row.lotNumber ?? '없음'} · by ${userId}`,
    );
    return {
      data: row,
      /** 🔴 저장은 했지만 검증이 실패했다는 사실을 그 자리에서 말한다 */
      warning: parsed?.gtinValid === false ? 'GTIN 체크디지트가 맞지 않습니다 — 기록은 남겼으니 바코드를 확인하세요' : null,
    };
  }

  /** 환자에게 사용된 기기 이력 — 차트에서 부른다 */
  async byPatient(patientId: string) {
    const rows = await this.prisma.deviceUsage.findMany({
      where: { patientId },
      orderBy: { usedAt: 'desc' },
      take: 200,
    });
    return {
      items: rows,
      total: rows.length,
      /** 🔴 이 원장에 기록된 것만이다 — 과거 자유 텍스트 삽입물은 여기 없다 */
      caveat:
        '기기 사용 원장에 기록된 것만 보입니다. 수술기록에 자유 텍스트로만 남은 과거 삽입물은 포함되지 않습니다.',
    };
  }

  /**
   * 🔴 **리콜 역추적** — 이 GTIN/로트가 어느 환자에게 들어갔는가.
   *    이것이 없으면 리콜 공고를 받아도 아무것도 할 수 없다.
   */
  async recallLookup(params: { gtin?: string; lotNumber?: string; serialNumber?: string }) {
    const { gtin, lotNumber, serialNumber } = params;
    if (!gtin && !lotNumber && !serialNumber) {
      throw new BadRequestException('GTIN·로트·일련번호 중 하나는 있어야 합니다');
    }
    const where = {
      ...(gtin ? { gtin } : {}),
      ...(lotNumber ? { lotNumber } : {}),
      ...(serialNumber ? { serialNumber } : {}),
    };
    const rows = await this.prisma.deviceUsage.findMany({
      where,
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
      orderBy: { usedAt: 'desc' },
      take: 500,
    });
    const total = await this.prisma.deviceUsage.count({ where });

    return {
      query: where,
      total,
      returned: rows.length,
      truncated: total > rows.length,
      patients: rows.map((r) => ({
        usageId: r.id,
        patientId: r.patientId,
        mrn: r.patient.mrn,
        name: `${r.patient.familyName ?? ''}${r.patient.givenName ?? ''}`,
        deviceName: r.deviceName,
        lotNumber: r.lotNumber,
        serialNumber: r.serialNumber,
        usedAt: r.usedAt,
        usageType: r.usageType,
      })),
      /**
       * 🔴 **0건은 "안전"이 아니다.** 이 원장에 기록된 것만 셀 수 있다 —
       *    자유 텍스트로만 남은 과거 삽입물은 여기에 없다.
       */
      caveat:
        '이 결과는 기기 사용 원장에 **기록된 것**만 셉니다. 수술기록에 자유 텍스트로만 남은 과거 삽입물은 포함되지 않습니다 — 0건이 "해당 없음"을 뜻하지 않습니다.',
    };
  }
}
