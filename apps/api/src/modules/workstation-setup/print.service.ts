import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { createConnection } from 'net';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { localDateTimeKey } from '../../common/day-range';

/**
 * 네트워크 프린터 실 I/O (raw TCP·9100 등).
 * 보안: 프린터 host는 **내부망 사설 IP만 허용**(SSRF 역방향 — 공인/loopback/메타데이터 차단).
 * WEBUSB/WEBSERIAL/LOCAL_AGENT 연결은 클라이언트측 처리(서버 발신 불가) → clientSide 응답.
 */
@Injectable()
export class PrintService {
  private readonly logger = new Logger(PrintService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** 프린터 host 허용: 10.x / 172.16~31.x / 192.168.x (사설 LAN)만. 그 외(공인·loopback·169.254·호스트명) 차단. */
  private assertPrinterHost(host: string | null, port: number | null): { host: string; port: number } {
    if (!host) throw new BadRequestException('프린터 host(IP)가 설정되지 않았습니다');
    const p = port ?? 9100;
    if (!(p >= 1 && p <= 65535)) throw new BadRequestException('포트 범위 오류');
    const o = host.split('.').map(Number);
    const ok = o.length === 4 && o.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168));
    if (!ok) throw new BadRequestException('프린터는 내부망 사설 IP(10.x / 172.16~31.x / 192.168.x)만 허용됩니다');
    return { host, port: p };
  }

  /** raw 소켓 전송(연결→쓰기→종료). 5초 타임아웃. */
  private rawSend(host: string, port: number, data: string | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const socket = createConnection({ host, port });
      socket.setTimeout(5000);
      socket.on('connect', () => socket.write(Buffer.from(data), () => { done = true; socket.end(); }));
      socket.on('timeout', () => { if (!done) { socket.destroy(); reject(new Error('연결 시간초과(프린터 미응답)')); } });
      socket.on('error', (e) => { if (!done) reject(e); });
      socket.on('close', () => { if (done) resolve(); });
    });
  }

  /** 유형별 테스트 페이로드 */
  private testPayload(type: string): string {
    if (type === 'LABEL_PRINTER') {
      // ZPL 테스트 라벨
      return `^XA^CI28^FO30,30^ADN,36,20^FDHIS TEST LABEL^FS^FO30,90^ADN,24,12^FD${new Date().toISOString()}^FS^XZ`;
    }
    // 문서/영수증 프린터: raw 텍스트 + form feed
    return `HIS 프린터 연결 테스트\n워크스테이션-디바이스 설정\n${new Date().toISOString()}\n\n\n\x0C`;
  }

  private async markStatus(id: string, online: boolean) {
    await this.prisma.peripheralDevice.update({ where: { id }, data: { status: online ? 'ONLINE' : 'OFFLINE', ...(online ? { lastSeenAt: new Date() } : {}) } }).catch(() => {});
  }

  /** 특정 프린터 테스트 인쇄 */
  async testPrint(peripheralId: string) {
    const dev = await this.prisma.peripheralDevice.findUnique({ where: { id: peripheralId } });
    if (!dev) throw new NotFoundException('주변기기 없음');
    if (dev.type !== 'LABEL_PRINTER' && dev.type !== 'DOC_PRINTER') throw new BadRequestException('프린터만 테스트 인쇄 가능');
    if (dev.connection !== 'NETWORK') {
      return { clientSide: true, connection: dev.connection, message: `${dev.connection} 연결은 클라이언트(브라우저/에이전트) 측에서 처리됩니다` };
    }
    const { host, port } = this.assertPrinterHost(dev.host, dev.port);
    try {
      await this.rawSend(host, port, this.testPayload(dev.type));
      await this.markStatus(dev.id, true);
      return { ok: true, host, port, message: '테스트 인쇄 전송 완료' };
    } catch (e) {
      await this.markStatus(dev.id, false);
      throw new BadRequestException(`인쇄 실패: ${(e as Error).message} (${host}:${port})`);
    }
  }

  /** 워크스테이션(code/id) → 유형별 기본 프린터 해석(기본기 우선·활성 폴백) */
  private async resolvePrinter(data: { workstationProfileId?: string; code?: string }, type: 'LABEL_PRINTER' | 'DOC_PRINTER') {
    let wsId = data.workstationProfileId;
    if (!wsId && data.code) {
      const ws = await this.prisma.workstationProfile.findFirst({ where: { code: data.code, isActive: true } });
      if (!ws) throw new NotFoundException('워크스테이션 없음');
      wsId = ws.id;
    }
    if (!wsId) throw new BadRequestException('workstationProfileId 또는 code 필요');
    const dev = await this.prisma.peripheralDevice.findFirst({ where: { workstationProfileId: wsId, type, isActive: true, isDefault: true } })
      ?? await this.prisma.peripheralDevice.findFirst({ where: { workstationProfileId: wsId, type, isActive: true } });
    if (!dev) throw new NotFoundException(`기본 ${type} 미설정`);
    return dev;
  }

  /** 해석된 프린터로 페이로드 송출(NETWORK) 또는 clientSide 반환 */
  private async dispatch(dev: { id: string; connection: string; host: string | null; port: number | null }, payload: string) {
    if (dev.connection !== 'NETWORK') return { clientSide: true as const, connection: dev.connection, deviceId: dev.id, message: '클라이언트 측 인쇄' };
    const { host, port } = this.assertPrinterHost(dev.host, dev.port);
    try {
      await this.rawSend(host, port, payload);
      await this.markStatus(dev.id, true);
      return { ok: true as const, deviceId: dev.id, host, port };
    } catch (e) {
      await this.markStatus(dev.id, false);
      throw new BadRequestException(`인쇄 실패: ${(e as Error).message}`);
    }
  }

  /** 워크스테이션 기본 프린터로 인쇄(라벨/문서) */
  async printJob(data: { workstationProfileId?: string; code?: string; kind: 'LABEL' | 'DOC'; payload: string }) {
    const dev = await this.resolvePrinter(data, data.kind === 'LABEL' ? 'LABEL_PRINTER' : 'DOC_PRINTER');
    return this.dispatch(dev, data.payload);
  }

  /** ZPL 제어문자 이스케이프(^ ~ 제거) */
  private zplSafe(s: string): string { return (s ?? '').replace(/[\^~\\]/g, ' ').slice(0, 40); }

  /**
   * 검체/오더 라벨 ZPL 생성 — 환자·오더 정본에서 서버측 조립(FE 위조 방지).
   * 바코드=Code128(orderId 앞 12자리 — 워크스테이션 접수 스캔용 짧은 식별자·전체 UUID는 QR 후속).
   */
  async buildOrderLabelZpl(orderId: string): Promise<{ zpl: string; summary: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        prescription: {
          include: {
            medicationCode: { select: { nameKo: true } },
            procedureCode: { select: { nameKo: true } },
            encounter: { include: { patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true } } } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('오더 없음');
    const p = order.prescription.encounter.patient;
    const name = this.zplSafe(`${p.familyName ?? ''}${p.givenName ?? ''}`);
    const item = this.zplSafe(order.prescription.procedureCode?.nameKo ?? order.prescription.medicationCode?.nameKo ?? order.prescription.instructions ?? order.department);
    const dob = p.dateOfBirth ? new Date(p.dateOfBirth).toISOString().slice(0, 10) : '-';
    const stat = order.priority === 'STAT' ? ' *STAT*' : '';
    const barcode = order.id.replace(/-/g, '').slice(0, 12).toUpperCase();
    const zpl = [
      '^XA^CI28',
      `^FO30,25^A0N,32,32^FD${name} (${this.zplSafe(p.mrn ?? '-')})^FS`,
      `^FO30,65^A0N,24,24^FD${dob}  ${this.zplSafe(order.department)}${stat}^FS`,
      `^FO30,95^A0N,24,24^FD${item}^FS`,
      `^FO30,130^BCN,70,Y,N,N^FD${barcode}^FS`,
      // 🔴 인쇄 시각은 병원 현지 시각 — UTC 절단이면 검체 라벨에 9시간 전 시각이 박힌다
      `^FO30,230^A0N,18,18^FD${localDateTimeKey(new Date())}^FS`,
      '^XZ',
    ].join('');
    return { zpl, summary: `${name}·${item}` };
  }

  /** 오더 라벨 원버튼 인쇄 — 생성+기본 라벨프린터 송출. clientSide면 zpl 동봉(FE 다운로드 폴백) */
  async printOrderLabel(data: { orderId: string; workstationProfileId?: string; code?: string; copies?: number }) {
    const { zpl, summary } = await this.buildOrderLabelZpl(data.orderId);
    const copies = Math.min(Math.max(data.copies ?? 1, 1), 5);
    const dev = await this.resolvePrinter(data, 'LABEL_PRINTER');
    const result = await this.dispatch(dev, zpl.repeat(copies));
    return result.clientSide ? { ...result, zpl, summary } : { ...result, summary, copies };
  }
}
