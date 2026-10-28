import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { secureKeyEqual } from '../../common/util/secure-compare';
import { ConsentService } from './consent.service';

interface DeviceEvent { deviceUid: string; data: { type: string; token?: string } }
const ONLINE_MS = 90_000; // lastSeenAt 90s 초과 시 오프라인

@Injectable()
export class ConsentDeviceService {
  private readonly stream = new Subject<DeviceEvent>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
  ) {}

  // 태블릿별 SSE 스트림 (deviceUid로 필터)
  getDeviceStream(deviceUid: string): Observable<{ data: { type: string; token?: string } }> {
    return this.stream.asObservable().pipe(
      filter((e) => e.deviceUid === deviceUid),
      map((e) => ({ data: e.data })),
    );
  }
  private emitDevice(deviceUid: string, type: string, token?: string) {
    try { this.stream.next({ deviceUid, data: { type, token } }); } catch { /* noop */ }
  }

  // ── 페어링 인증코드 (관리자) ──
  async createPairingCode(createdBy: string) {
    // 6자리 숫자 코드 (QR URL은 FE가 origin으로 구성)
    const code = (parseInt(randomBytes(4).toString('hex'), 16) % 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await this.prisma.devicePairingCode.create({ data: { code, createdBy, expiresAt } });
    return { code, expiresAt };
  }

  /**
   * 페어링 인증코드 원자적 소비(동시 enroll 경쟁조건 차단, H-1).
   * 🔴 인증코드는 반드시 문자열로 고정한다 — 객체가 들어오면 Prisma 가 필터 연산자로 해석해
   *    (예: `{ not: 'x' }`) 코드를 모르고도 임의의 ACTIVE 코드를 소비·자동 승인시킬 수 있다.
   */
  private async consumePairingCode(code: unknown, tx?: Prisma.TransactionClient): Promise<void> {
    const c = String(code);
    // 🔴 지역 이름을 `prisma` 로 둔다 — 상태 쓰기 스캐너는 수신자 이름으로 쓰기를 찾는다.
    //    `db` 같은 이름으로 바꾸면 이 쓰기가 계측에서 **통째로 사라진다**(K4 가 같은 자리에서 겪었다).
    const prisma = tx ?? this.prisma;
    const consumed = await prisma.devicePairingCode.updateMany({
      where: { code: c, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      data: { status: 'USED', usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('유효하지 않거나 만료된 인증코드입니다');
  }

  // ── 태블릿 자가 등록 ──
  async enroll(data: { deviceUid: string; name: string; code?: string; userAgent?: string; secret?: string }) {
    if (!data.deviceUid || data.deviceUid.length > 64 || !data.name?.trim()) throw new BadRequestException('기기 식별자와 이름이 필요합니다');
    const name = data.name.trim().slice(0, 100);

    // 이미 등록된 기기 — 거부/비활성은 차단(H-3)
    const existing = await this.prisma.consentSigningDevice.findUnique({ where: { deviceUid: data.deviceUid } });
    if (existing) {
      if (existing.approvalStatus === 'REJECTED' || !existing.isActive) throw new BadRequestException('사용할 수 없는 기기입니다. 관리자에게 문의하세요.');

      // 🔴 (2026-09-16 H1) 종전엔 여기서 **기존 deviceSecret 을 그대로 돌려줬다**(멱등 반환).
      //    이 EP 는 무인증이고 deviceUid 는 비밀이 아니다 — URL 경로(`GET /consent-device/:uid`·heartbeat·
      //    stream)에 실려 서버·프록시 로그와 브라우저 기록에 남는다. 그런데 `deviceSecret` 은
      //    **그 태블릿의 유일한 문턱**이다(`consent-device-secret-gate.spec` 이 그렇게 선언한다):
      //    secret 이면 SSE 구독 + `currentToken` 열람이 되고, 그 토큰은 `/consent-sign/:token` 에서
      //    **환자 성명·MRN·생년월일과 서명 제출**을 연다. 즉 uid 를 아는 사람에게 자격증명을 내주고 있었다.
      //    가드는 secret 을 **쓰는 문**(getDeviceState·authorizeStream)만 지키고 secret 을 **내주는 문**은
      //    아무도 보지 않았다.
      //    이제 ① 소지 증명(현재 secret) ② 직원이 발급한 페어링 코드 — 둘 중 하나가 있어야 한다.
      if (secureKeyEqual(data.secret, existing.deviceSecret)) {
        // 같은 기기의 재요청(이중 제출) — 진짜 멱등
        return { approvalStatus: existing.approvalStatus, status: existing.status, name: existing.name, deviceSecret: existing.deviceSecret };
      }
      if (data.code) {
        /**
         * 재페어링: 코드를 원자적으로 소비하고 secret 을 **교체**한다(유출된 옛 secret 무효화).
         *
         * 🔴 (2026-09-17 L1) 종전엔 소비·교체·연결이 트랜잭션 밖 순차였다. 코드만 `USED` 로 커밋되고
         *    기기 갱신이 실패하면 **직원이 발급한 1회용 코드는 타 버렸는데 태블릿은 붙지 않는다** —
         *    현장에서는 코드를 다시 받아야 하고, 그 사이 유출 의심 secret 은 그대로 살아 있다.
         *    셋을 한 트랜잭션으로 묶는다(코드 소비가 유효하면 교체도 반드시 함께 남는다).
         */
        const rotated = randomBytes(24).toString('hex');
        const updated = await this.prisma.$transaction(async (tx) => {
          await this.consumePairingCode(data.code, tx);
          const dev = await tx.consentSigningDevice.update({
            where: { id: existing.id },
            data: { deviceSecret: rotated, name, approvalStatus: 'APPROVED', approvedAt: new Date(), lastSeenAt: new Date() },
          });
          await tx.devicePairingCode.updateMany({ where: { code: String(data.code), status: 'USED', usedByDeviceId: null }, data: { usedByDeviceId: existing.id } });
          return dev;
        });
        this.consent.emitWorkstation('device_enrolled');
        return { approvalStatus: updated.approvalStatus, status: updated.status, name: updated.name, deviceSecret: rotated };
      }
      // 소지 증명도 코드도 없다 — 상태만 알려주고 자격증명은 주지 않는다
      return { approvalStatus: existing.approvalStatus, status: existing.status, name: existing.name, deviceSecret: null, pairingRequired: true };
    }

    // 인증코드 원자적 소비 (동시 enroll 경쟁조건 차단, H-1)
    //
    // 🔴 (2026-09-17 L1) 신규 등록도 같은 반쪽이 있었다 — 코드만 `USED` 로 커밋되고 기기 생성이
    //    실패하면 1회용 코드가 효과 없이 소모된다. 코드가 있는 경우만 한 트랜잭션으로 묶는다.
    const approved = !!data.code;
    const deviceSecret = randomBytes(24).toString('hex');
    const createDevice = (tx: Prisma.TransactionClient | PrismaService) =>
      tx.consentSigningDevice.create({
        data: {
          deviceUid: data.deviceUid, deviceSecret, name, userAgent: data.userAgent?.slice(0, 300),
          approvalStatus: approved ? 'APPROVED' : 'PENDING',
          ...(approved ? { approvedAt: new Date() } : {}),
          lastSeenAt: new Date(),
        },
      });
    const device = data.code
      ? await this.prisma.$transaction(async (tx) => {
          await this.consumePairingCode(data.code, tx);
          const dev = await createDevice(tx);
          await tx.devicePairingCode.updateMany({ where: { code: String(data.code), status: 'USED', usedByDeviceId: null }, data: { usedByDeviceId: dev.id } });
          return dev;
        })
      : await createDevice(this.prisma);
    this.consent.emitWorkstation('device_enrolled');
    return { approvalStatus: device.approvalStatus, status: device.status, name: device.name, deviceSecret };
  }

  /**
   * 기기 비밀 검증 — fail-closed(C-3 IDOR 방어).
   * 🔴 종전엔 `!device.deviceSecret || …` 라 deviceSecret 이 null 인 기기는 **secret 없이도 통과**해
   *    currentToken(대기 중 동의서 서명 토큰)이 무방비였다. enroll 은 항상 secret 을 발급하므로
   *    null 기기는 비정상 — 통과가 아니라 **차단**해야 한다(스키마상 deviceSecret 은 nullable).
   */
  private secretOk(device: { deviceSecret: string | null }, secret?: string): boolean {
    // 상수시간 비교 정본(`secureKeyEqual`) — 미설정·길이 불일치는 false(fail-closed)
    return secureKeyEqual(secret, device.deviceSecret);
  }

  // ── 태블릿 상태 조회 (공개, secret로 currentToken 보호) ──
  async getDeviceState(deviceUid: string, secret?: string) {
    const d = await this.prisma.consentSigningDevice.findUnique({ where: { deviceUid } });
    if (!d) return { registered: false };
    const authed = this.secretOk(d, secret);
    return {
      registered: true,
      approvalStatus: d.approvalStatus,
      status: d.status,
      name: d.name,
      // currentToken은 본인 기기(secret 일치)에게만 — IDOR 방지(C-3)
      currentToken: authed && d.approvalStatus === 'APPROVED' && d.status === 'DISPATCHED' ? d.currentToken : null,
      active: d.isActive,
    };
  }

  async heartbeat(deviceUid: string) {
    await this.prisma.consentSigningDevice.updateMany({ where: { deviceUid }, data: { lastSeenAt: new Date() } });
    return { ok: true };
  }

  /** SSE 구독 인가 — secret 검증 */
  async authorizeStream(deviceUid: string, secret?: string): Promise<boolean> {
    const d = await this.prisma.consentSigningDevice.findUnique({ where: { deviceUid }, select: { deviceSecret: true } });
    return !!d && this.secretOk(d, secret);
  }

  // 태블릿이 서명 제출 완료 후 호출 → 대기 복귀 (secret 검증)
  async deviceSigned(deviceUid: string, secret?: string) {
    const d = await this.prisma.consentSigningDevice.findUnique({ where: { deviceUid } });
    if (d) {
      if (!this.secretOk(d, secret)) throw new BadRequestException('기기 인증 실패');
      await this.prisma.consentSigningDevice.update({ where: { id: d.id }, data: { status: 'IDLE', currentConsentId: null, currentToken: null } });
      this.emitDevice(deviceUid, 'cleared');
      this.consent.emitWorkstation('device_signed');
    }
    return { ok: true };
  }

  // ── 관리자: 목록/승인/거부/수정/해제 ──
  async listDevices() {
    const rows = await this.prisma.consentSigningDevice.findMany({
      where: { isActive: true },
      orderBy: [{ approvalStatus: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const now = Date.now();
    return rows.map((d) => ({
      id: d.id, name: d.name, location: d.location,
      approvalStatus: d.approvalStatus, status: d.status,
      online: !!d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_MS,
      lastSeenAt: d.lastSeenAt, currentConsentId: d.currentConsentId,
    }));
  }

  async approveDevice(id: string, userId: string) {
    const d = await this.prisma.consentSigningDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('기기를 찾을 수 없습니다');
    await this.prisma.consentSigningDevice.update({ where: { id }, data: { approvalStatus: 'APPROVED', approvedBy: userId, approvedAt: new Date(), status: 'IDLE' } });
    this.emitDevice(d.deviceUid, 'approved');
    this.consent.emitWorkstation('device_approved');
    return { approved: true };
  }

  async rejectDevice(id: string) {
    const d = await this.prisma.consentSigningDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('기기를 찾을 수 없습니다');
    await this.prisma.consentSigningDevice.update({ where: { id }, data: { approvalStatus: 'REJECTED', isActive: false } });
    this.emitDevice(d.deviceUid, 'rejected');
    this.consent.emitWorkstation('device_rejected');
    return { rejected: true };
  }

  async updateDevice(id: string, data: { name?: string; location?: string }) {
    return this.prisma.consentSigningDevice.update({ where: { id }, data: { name: data.name, location: data.location } });
  }

  async deleteDevice(id: string) {
    const d = await this.prisma.consentSigningDevice.findUnique({ where: { id } });
    if (d) { this.emitDevice(d.deviceUid, 'removed'); }
    await this.prisma.consentSigningDevice.update({ where: { id }, data: { isActive: false } });
    this.consent.emitWorkstation('device_removed');
    return { removed: true };
  }

  // ── 디스패치 / 회수 ──
  async dispatch(consentId: string, deviceId: string, createdBy: string) {
    const device = await this.prisma.consentSigningDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.approvalStatus !== 'APPROVED' || !device.isActive) throw new BadRequestException('승인된 기기가 아닙니다');
    // 서명 세션 발급(기존 로직 재사용)
    const session = await this.consent.createSignSession(consentId, createdBy, { signMode: 'TABLET', signerType: 'PATIENT' });
    await this.prisma.consentSigningDevice.update({ where: { id: deviceId }, data: { status: 'DISPATCHED', currentConsentId: consentId, currentToken: session.token } });
    this.emitDevice(device.deviceUid, 'dispatch', session.token);
    this.consent.emitWorkstation('dispatched', consentId);
    return { dispatched: true, token: session.token };
  }

  async recall(deviceId: string) {
    const device = await this.prisma.consentSigningDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('기기를 찾을 수 없습니다');
    if (device.currentToken) { try { await this.consent.cancelSignSession(device.currentToken); } catch { /* noop */ } }
    await this.prisma.consentSigningDevice.update({ where: { id: deviceId }, data: { status: 'IDLE', currentConsentId: null, currentToken: null } });
    this.emitDevice(device.deviceUid, 'cleared');
    this.consent.emitWorkstation('recalled');
    return { recalled: true };
  }
}
