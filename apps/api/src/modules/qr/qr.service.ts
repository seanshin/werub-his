import { Injectable, BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EssService } from '../ess/ess.service';
import { publicBaseUrl } from '../../common/util/public-url';

// 용도별 QR 세션 TTL(초) — 단기 회전(보안 §8/E6)
const TTL: Record<string, number> = { LOGIN: 120, CLOCK: 90, ATTEND: 600, RECEIPT: 600 };

@Injectable()
export class QrService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly ess: EssService) {}

  private base() {
    return publicBaseUrl();
  }

  // 화면(키오스크/공용단말/출석)에서 QR 세션 생성
  async createSession(createdById: string, purpose: string, refType?: string, refId?: string) {
    const token = randomBytes(16).toString('hex'); // 32 chars
    const expiresAt = new Date(Date.now() + (TTL[purpose] ?? 120) * 1000);
    const session = await this.prisma.qrSession.create({
      data: { purpose, token, refType: refType ?? null, refId: refId ?? null, createdById, expiresAt },
    });
    const scanUrl = `${this.base()}/qr?token=${token}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl, { width: 220, margin: 2 }); // 서버 로컬 생성
    return { id: session.id, token, scanUrl, qrDataUrl, expiresAt };
  }

  /**
   * 🔴 (2026-09-16 H3) 소유 대조가 없어 **인증된 아무 직원이나 남의 QR 세션 상태**를 id 로 읽었다 —
   *    응답의 `consumedById` 는 "그 QR 을 누가 스캔했는가"(출퇴근·출석 주체)다. 세션을 만든 화면이
   *    자기 세션을 폴링하는 것이 이 EP 의 쓰임이므로(키오스크: 생성 → 같은 화면이 폴링) 생성자로 좁힌다.
   *    없는 것과 남의 것은 같은 404 로 답한다.
   */
  async getStatus(id: string, actor: { userId: string; role: string }) {
    const s = await this.prisma.qrSession.findUnique({ where: { id }, select: { id: true, purpose: true, status: true, consumedById: true, consumedAt: true, expiresAt: true, createdById: true } });
    if (!s || (s.createdById !== actor.userId && actor.role !== 'ADMIN')) throw new NotFoundException('세션 없음');
    const expired = s.status === 'OPEN' && s.expiresAt < new Date();
    const { createdById: _c, ...view } = s;
    return { ...view, status: expired ? 'EXPIRED' : s.status };
  }

  // 인증된 사용자(스캔자)가 QR 토큰을 처리
  async scan(userId: string, token: string) {
    const s = await this.prisma.qrSession.findUnique({ where: { token } });
    if (!s) throw new NotFoundException({ code: 'QR_SESSION_INVALID', message: '유효하지 않은 QR입니다.' });
    if (s.status !== 'OPEN') throw new BadRequestException({ code: 'QR_SESSION_INVALID', message: '이미 사용된 QR입니다.' });
    if (s.expiresAt < new Date()) throw new GoneException({ code: 'QR_SESSION_INVALID', message: '만료된 QR입니다.' });

    await this.prisma.qrSession.update({ where: { id: s.id }, data: { status: 'CONSUMED', consumedById: userId, consumedAt: new Date() } });
    void this.prisma.auditLog.create({ data: { userId, action: 'UPDATE', resourceType: 'QR_SESSION', resourceId: s.id, changes: { event: 'QR_SCANNED', purpose: s.purpose } as never } }).catch(() => undefined);

    switch (s.purpose) {
      case 'CLOCK': {
        // 마지막 기록으로 출/퇴근 토글
        const last = await this.prisma.attendanceRecord.findFirst({ where: { userId }, orderBy: { at: 'desc' } });
        const type = last?.type === 'CLOCK_IN' ? 'CLOCK_OUT' : 'CLOCK_IN';
        const rec = await this.ess.clock(userId, type, 'QR');
        return { purpose: 'CLOCK', type, at: rec.at };
      }
      case 'ATTEND':
        return { purpose: 'ATTEND', refType: s.refType, refId: s.refId, checkedIn: true };
      case 'RECEIPT':
        return { purpose: 'RECEIPT', refType: s.refType, refId: s.refId, received: true };
      case 'LOGIN':
        // 공용단말 페어링 — 스캔(인증된 폰)이 승인. PC는 getStatus 폴링으로 CONSUMED 확인.
        // 실제 PC 세션(JWT) 핸드오프는 연동 보안설계 후속(§7.3).
        return { purpose: 'LOGIN', paired: true };
      default:
        return { purpose: s.purpose, ok: true };
    }
  }
}
