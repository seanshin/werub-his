import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, Server, Socket } from 'net';
import { PrintService } from '../../src/modules/workstation-setup/print.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/** A-7 디바이스 실 I/O — 네트워크 인쇄 라우팅·오더 라벨 ZPL (2026-07-23) */
describe('PrintService', () => {
  let service: PrintService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      peripheralDevice: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      workstationProfile: { findFirst: vi.fn() },
      order: { findUnique: vi.fn() },
    };
    service = new PrintService(mockPrisma);
  });

  describe('assertPrinterHost — 내부망 사설 IP 가드(SSRF 역방향)', () => {
    const guard = (host: string | null, port?: number) => (service as any).assertPrinterHost(host, port ?? null);

    it('사설 대역 3종 허용', () => {
      expect(guard('10.20.2.11')).toEqual({ host: '10.20.2.11', port: 9100 });
      expect(guard('172.16.0.5', 631)).toEqual({ host: '172.16.0.5', port: 631 });
      expect(guard('192.168.1.100')).toEqual({ host: '192.168.1.100', port: 9100 });
    });

    it('공인·loopback·링크로컬·호스트명·미설정 차단', () => {
      for (const bad of ['8.8.8.8', '127.0.0.1', '169.254.1.1', '172.32.0.1', 'printer.local', null]) {
        expect(() => guard(bad as any)).toThrow(BadRequestException);
      }
    });

    it('포트 범위 검증', () => {
      expect(() => guard('10.0.0.1', 0)).toThrow(BadRequestException);
      expect(() => guard('10.0.0.1', 70000)).toThrow(BadRequestException);
    });
  });

  describe('rawSend — 실소켓 I/O(로컬 리스너)', () => {
    let server: Server;
    let received: Buffer[];
    let port: number;

    beforeEach(async () => {
      received = [];
      server = createServer((sock: Socket) => sock.on('data', (d) => received.push(d)));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      port = (server.address() as { port: number }).port;
    });

    it('연결→쓰기→종료 정상 왕복(페이로드 무결)', async () => {
      await (service as any).rawSend('127.0.0.1', port, '^XA^FDTEST^FS^XZ');
      await new Promise((r) => setTimeout(r, 50));
      expect(Buffer.concat(received).toString()).toBe('^XA^FDTEST^FS^XZ');
    });

    it('미청취 포트 → 연결 오류', async () => {
      const closed = port;
      await new Promise<void>((r) => server.close(() => r()));
      await expect((service as any).rawSend('127.0.0.1', closed, 'X')).rejects.toThrow();
    });

    afterEach(async () => {
      await new Promise<void>((r) => server.close(() => r())).catch(() => {});
    });
  });

  describe('printJob — 기본기 해석·클라이언트측 위임', () => {
    it('isDefault 우선·없으면 활성 폴백', async () => {
      mockPrisma.workstationProfile.findFirst.mockResolvedValue({ id: 'ws1' });
      mockPrisma.peripheralDevice.findFirst
        .mockResolvedValueOnce(null) // isDefault 없음
        .mockResolvedValueOnce({ id: 'd2', connection: 'WEBUSB', host: null, port: null });
      const r = await service.printJob({ code: 'WS-LAB-01', kind: 'LABEL', payload: '^XA^XZ' });
      expect(r).toMatchObject({ clientSide: true, connection: 'WEBUSB', deviceId: 'd2' });
      const calls = mockPrisma.peripheralDevice.findFirst.mock.calls;
      expect(calls[0][0].where.isDefault).toBe(true);
      expect(calls[1][0].where.isDefault).toBeUndefined();
    });

    it('워크스테이션/프린터 미설정 → 404', async () => {
      mockPrisma.workstationProfile.findFirst.mockResolvedValue(null);
      await expect(service.printJob({ code: 'NOPE', kind: 'LABEL', payload: 'x' })).rejects.toThrow(NotFoundException);

      mockPrisma.workstationProfile.findFirst.mockResolvedValue({ id: 'ws1' });
      mockPrisma.peripheralDevice.findFirst.mockResolvedValue(null);
      await expect(service.printJob({ code: 'WS', kind: 'DOC', payload: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('NETWORK 인쇄 실패 시 OFFLINE 마킹 + 400', async () => {
      mockPrisma.workstationProfile.findFirst.mockResolvedValue({ id: 'ws1' });
      mockPrisma.peripheralDevice.findFirst.mockResolvedValue({ id: 'd1', connection: 'NETWORK', host: '10.0.0.9', port: 9100 });
      vi.spyOn(service as any, 'rawSend').mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.printJob({ code: 'WS', kind: 'LABEL', payload: 'x' })).rejects.toThrow(BadRequestException);
      expect(mockPrisma.peripheralDevice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'OFFLINE' }) }));
    });
  });

  describe('buildOrderLabelZpl / printOrderLabel', () => {
    const orderFixture = {
      id: 'abcd1234-5678-90ab-cdef-1234567890ab',
      department: 'LAB',
      priority: 'STAT',
      prescription: {
        instructions: null,
        medicationCode: null,
        procedureCode: { nameKo: 'CBC 일반혈액검사' },
        encounter: { patient: { familyName: '홍', givenName: '길동', mrn: 'HR24-0001', dateOfBirth: new Date('1980-01-15') } },
      },
    };

    it('ZPL에 환자·검사·STAT·바코드 포함, ^~ 이스케이프', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...orderFixture,
        prescription: {
          ...orderFixture.prescription,
          procedureCode: { nameKo: 'CBC^전혈~검사' }, // 제어문자 오염 시도
        },
      });
      const { zpl, summary } = await service.buildOrderLabelZpl(orderFixture.id);
      expect(zpl).toContain('홍길동 (HR24-0001)');
      expect(zpl).toContain('1980-01-15');
      expect(zpl).toContain('*STAT*');
      expect(zpl).toContain('^BCN,70,Y,N,N^FDABCD12345678^FS'); // uuid 앞 12자리 대문자
      expect(zpl).toContain('CBC 전혈 검사'); // ^~ → 공백
      expect(summary).toContain('홍길동');
    });

    it('오더 없음 → 404', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.buildOrderLabelZpl('missing')).rejects.toThrow(NotFoundException);
    });

    it('원버튼 인쇄 — NETWORK 송출(매수 반복·5장 상한)·clientSide면 zpl 동봉', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(orderFixture);
      mockPrisma.workstationProfile.findFirst.mockResolvedValue({ id: 'ws1' });
      mockPrisma.peripheralDevice.findFirst.mockResolvedValue({ id: 'd1', connection: 'NETWORK', host: '10.20.2.11', port: 9100 });
      const raw = vi.spyOn(service as any, 'rawSend').mockResolvedValue(undefined);

      const r = await service.printOrderLabel({ orderId: orderFixture.id, code: 'WS-LAB-01', copies: 99 });
      expect(r.ok).toBe(true);
      expect((r as any).copies).toBe(5); // 상한
      const sent = raw.mock.calls[0][2] as string;
      expect((sent.match(/\^XA/g) ?? []).length).toBe(5);

      mockPrisma.peripheralDevice.findFirst.mockResolvedValue({ id: 'd2', connection: 'WEBUSB', host: null, port: null });
      const r2 = await service.printOrderLabel({ orderId: orderFixture.id, code: 'WS-LAB-01' });
      expect(r2).toMatchObject({ clientSide: true });
      expect((r2 as any).zpl).toContain('^XA');
    });
  });
});
