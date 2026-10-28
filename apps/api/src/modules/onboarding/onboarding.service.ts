import type { ClinicalProfession } from '@hospital-run/shared';
import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash, createCipheriv, createDecipheriv, randomUUID } from 'crypto';
import { getKeyCustody } from '../../common/crypto/key-custody';
import { join, extname } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PasskeyService } from '../auth/passkey/passkey.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { HrService } from '../hr/hr.service';
import { CrmChannelService } from '../crm/crm-channel.service';
import { CreateInviteDto } from './dto/onboarding.dto';
import { publicBaseUrl } from '../../common/util/public-url';

const INVITE_TTL_DAYS = 14;
const DOC_DIR = join(process.cwd(), 'uploads', 'onboarding'); // 암호문 저장(평문 미저장)
if (!existsSync(DOC_DIR)) mkdirSync(DOC_DIR, { recursive: true });
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };

// 직종(자유텍스트) → StaffCategory / UserRole / position / 직종(profession) 매핑
// 🔴 (2026-09-29) 물리·작업·언어치료사는 어느 패턴에도 걸리지 않아 **SUPPORT·READ(조회 전용)** 로 떨어졌다 —
//    자기 업무(치료 오더·치료 기록) 경로가 개통 이래 없었다. 의료기사는 역할 LAB_TECH 를 공유하고 직종으로 가른다
//    (방사선사가 이미 그렇게 운영됨) · 오더 입력 범위 정본 shared `order-entry-scope`.
//    순서가 중요하다: '치료사'는 '방사선'·'병리'·'기사'보다 먼저, '영양사'는 '영양' 일반(급식 조리 등)과 구분하지 않는다(원내 확인 필요).
export function mapJob(jobCategory: string): { category: 'MEDICAL' | 'TECHNICAL' | 'ADMIN' | 'SUPPORT'; role: 'DOCTOR' | 'NURSE' | 'PHARMACIST' | 'LAB_TECH' | 'NUTRITION' | 'READ'; position: string; profession: ClinicalProfession | null } {
  const j = (jobCategory || '').toLowerCase();
  if (/간호|nurse/.test(j)) return { category: 'MEDICAL', role: 'NURSE', position: jobCategory, profession: 'NURSE' };
  if (/의사|전문의|레지던트|인턴|doctor|의국/.test(j)) return { category: 'MEDICAL', role: 'DOCTOR', position: jobCategory, profession: 'DOCTOR' };
  if (/약사|pharmac/.test(j)) return { category: 'MEDICAL', role: 'PHARMACIST', position: jobCategory, profession: 'PHARMACIST' };
  if (/물리치료|physical ?therap|\bpt\b/.test(j)) return { category: 'TECHNICAL', role: 'LAB_TECH', position: jobCategory, profession: 'PHYSICAL_THERAPIST' };
  if (/작업치료|occupational ?therap|\bot\b/.test(j)) return { category: 'TECHNICAL', role: 'LAB_TECH', position: jobCategory, profession: 'OCCUPATIONAL_THERAPIST' };
  if (/언어치료|언어재활|speech|\bslp\b/.test(j)) return { category: 'TECHNICAL', role: 'LAB_TECH', position: jobCategory, profession: 'SPEECH_THERAPIST' };
  if (/방사선|radiolog|radiograph/.test(j)) return { category: 'TECHNICAL', role: 'LAB_TECH', position: jobCategory, profession: 'RADIOLOGIC_TECHNOLOGIST' };
  if (/병리|임상병리|laborator/.test(j)) return { category: 'TECHNICAL', role: 'LAB_TECH', position: jobCategory, profession: 'CLINICAL_LAB_TECHNOLOGIST' };
  // 직종을 특정하지 못한 '기사' — 역할만 주고 직종은 비워 둔다(역할 기본 직종 = 임상병리사로 판정됨 · 관리자가 지정)
  if (/기사|tech/.test(j)) return { category: 'TECHNICAL', role: 'LAB_TECH', position: jobCategory, profession: null };
  if (/영양사|dietitian|nutritionist/.test(j)) return { category: 'MEDICAL', role: 'NUTRITION', position: jobCategory, profession: 'DIETITIAN' };
  if (/행정|원무|admin|총무/.test(j)) return { category: 'ADMIN', role: 'READ', position: jobCategory, profession: null };
  return { category: 'SUPPORT', role: 'READ', position: jobCategory, profession: null };
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly passkey: PasskeyService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly hr: HrService,
    // 발송 판정 정본 — W6 에서 CRM 리마인더 4종을 이 판정으로 수렴했다(SENT/SIMULATED/FAILED).
    private readonly channel: CrmChannelService,
  ) {}

  // 만료 cron(FR-F6) — 미완료 초대 중 expiresAt 경과분을 EXPIRED 전이(파괴적 삭제 없음).
  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleInvites() {
    const res = await this.prisma.onboardingInvite.updateMany({
      where: { status: { in: ['INVITED', 'VERIFIED', 'DOC_SUBMITTED', 'CONTRACT_SIGNED'] }, expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    if (res.count > 0) this.logger.log(`온보딩 초대 만료 처리: ${res.count}건`);
  }

  private baseUrl(): string {
    return publicBaseUrl();
  }

  // 감사 기록(FR-F5) — best-effort, 실패해도 흐름 미차단
  private audit(userId: string | null | undefined, action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE', resourceType: string, resourceId: string, changes?: object) {
    if (!userId) return;
    void this.prisma.auditLog.create({ data: { userId, action, resourceType, resourceId, changes: (changes ?? undefined) as never } }).catch(() => undefined);
  }

  // raw 토큰 생성 + 해시 + 링크 + QR(dataURL). raw 는 1회만 반환(해시만 저장).
  private async issueToken(): Promise<{ raw: string; tokenHash: string }> {
    const raw = randomBytes(32).toString('hex'); // 64 chars
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    return { raw, tokenHash };
  }

  private async tokenPayload(raw: string) {
    const link = `${this.baseUrl()}/onboarding/${raw}`;
    const qrDataUrl = await QRCode.toDataURL(link, { width: 240, margin: 2 }); // 서버 로컬 생성(외부 API 금지)
    return { token: raw, link, qrDataUrl };
  }

  // 초대 등록 + 토큰 발급
  async createInvite(dto: CreateInviteDto, adminId: string) {
    const { raw, tokenHash } = await this.issueToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
    const invite = await this.prisma.onboardingInvite.create({
      data: {
        tokenHash,
        candidateFamilyName: dto.candidateFamilyName,
        candidateGivenName: dto.candidateGivenName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        jobCategory: dto.jobCategory,
        department: dto.department ?? null,
        hireDate: new Date(dto.hireDate),
        contractType: dto.contractType,
        status: 'INVITED',
        expiresAt,
        createdById: adminId,
      },
    });
    this.audit(adminId, 'CREATE', 'ONBOARDING_INVITE', invite.id, { event: 'INVITE_CREATED', name: `${dto.candidateFamilyName}${dto.candidateGivenName}`, jobCategory: dto.jobCategory });
    // email 동봉 — 발급 화면이 '이메일 발송' 가능 여부를 알아야 죽은 버튼을 안 그린다
    return { inviteId: invite.id, email: invite.email, ...(await this.tokenPayload(raw)), expiresAt };
  }

  /**
   * 발송/전달 이력 기록.
   *
   * 🔴 2026-08-14 W8(P16) — 종전 `recordSend()` 는 **채널을 한 번도 부르지 않고** 이력만 적었다.
   *    화면의 「📧 이메일 발송」 버튼은 눌리면 성공했고, 입사예정자에게는 아무것도 가지 않았다.
   *    이 저장소 규약: **발송 시도 ≠ 도달** · provider 가 없으면 SENT 가 아니다.
   *    → EMAIL 은 실제로 `CrmChannelService.send()` 를 부르고 **나간 대로**
   *      `meta.delivery` 에 SENT / SIMULATED(미발송) / FAILED 를 적는다(W6 CRM 과 같은 판정).
   *    → QR_IMAGE·LINK 는 애초에 '발송'이 아니라 **관리자가 손으로 전달**한 기록이므로
   *      HANDED_OVER 로 구분한다(발송 통계에 섞이지 않게).
   *
   * link: 초대 링크(raw 토큰 포함)는 서버에 해시로만 남아 재구성할 수 없다. 발급 화면이 들고 있는
   * 링크를 받아 **토큰 해시가 이 초대의 것과 일치할 때만** 메일 본문에 넣는다(임의 링크 주입 차단).
   */
  async recordSend(inviteId: string, channelName: string, adminId: string, link?: string, meta?: Record<string, unknown>) {
    const invite = await this.getInvite(inviteId);

    // 손으로 전달하는 경로(QR/링크)·토큰 재발급 — 발송을 흉내내지 않는다
    if (channelName !== 'EMAIL') {
      const kind = channelName === 'RESEND' ? 'REISSUED' : 'HANDED_OVER';
      await this.prisma.onboardingSend.create({
        data: { inviteId, channel: channelName, sentById: adminId, meta: { ...(meta ?? {}), delivery: kind } as never },
      });
      return { ok: true, delivery: kind as 'HANDED_OVER' | 'REISSUED', message: kind === 'REISSUED' ? '초대 토큰을 재발급했습니다.' : '관리자 직접 전달로 기록했습니다.' };
    }

    let delivery: 'SENT' | 'SIMULATED' | 'FAILED';
    let reason: string | undefined;

    if (!invite.email) {
      delivery = 'FAILED';
      reason = 'NO_CONTACT'; // 받을 주소가 없다 — 발송이 아니다
    } else if (!link || !this.linkMatchesInvite(link, invite.tokenHash)) {
      delivery = 'FAILED';
      reason = 'LINK_UNAVAILABLE'; // 유효 토큰 링크 없이 보내면 쓸모없는 메일이 나간다
    } else {
      const subject = '[입사 안내] 온보딩 절차를 진행해 주세요';
      const html = this.channel.renderEmailTemplate(
        subject,
        `${invite.candidateFamilyName}${invite.candidateGivenName}님, 아래 링크에서 본인확인·서류 제출·계약 서명을 진행해 주세요.<br><br>` +
        `<a href="${link}">${link}</a><br><br>링크 만료: ${invite.expiresAt.toISOString().slice(0, 10)}`,
      );
      const r = await this.channel.send('EMAIL', invite.email, subject, html).catch(() => ({ success: false, simulated: false }));
      delivery = !r.success ? 'FAILED' : r.simulated ? 'SIMULATED' : 'SENT';
      if (delivery === 'SIMULATED') reason = 'NO_EMAIL_PROVIDER';
      if (delivery === 'FAILED') reason = (r as { error?: string }).error ?? 'SEND_FAILED';
    }

    await this.prisma.onboardingSend.create({
      data: { inviteId, channel: channelName, sentById: adminId, meta: { ...(meta ?? {}), delivery, reason } as never },
    });

    return {
      ok: delivery === 'SENT',
      delivery,
      reason,
      message:
        delivery === 'SENT' ? '이메일을 발송했습니다.'
        : delivery === 'SIMULATED' ? '메일 발송 경로(SMTP)가 없어 실제로 보내지 않았습니다. 링크나 QR 을 직접 전달하세요.'
        : reason === 'NO_CONTACT' ? '이 초대에는 이메일 주소가 없습니다. 링크나 QR 을 직접 전달하세요.'
        : reason === 'LINK_UNAVAILABLE' ? '유효한 초대 링크가 없어 발송하지 않았습니다. 재발급 후 다시 시도하세요.'
        : '이메일 발송에 실패했습니다.',
    };
  }

  /** 전달받은 링크 끝의 raw 토큰이 이 초대의 tokenHash 와 일치하는지 */
  private linkMatchesInvite(link: string, tokenHash: string): boolean {
    const raw = link.trim().split('/').pop() ?? '';
    if (!/^[0-9a-f]{64}$/.test(raw)) return false;
    return createHash('sha256').update(raw).digest('hex') === tokenHash;
  }

  // 재발급 — 토큰 회전(이전 토큰 무효), 만료 갱신, 상태 INVITED 복귀
  async resendInvite(inviteId: string, adminId: string) {
    const invite = await this.getInvite(inviteId);
    if (invite.status === 'BOOTED') throw new BadRequestException('이미 활성화된 입사자입니다.');
    const { raw, tokenHash } = await this.issueToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
    await this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { tokenHash, status: 'INVITED', expiresAt, revokedAt: null } });
    await this.recordSend(inviteId, 'RESEND', adminId);
    return { inviteId, email: invite.email, ...(await this.tokenPayload(raw)), expiresAt };
  }

  async revokeInvite(inviteId: string) {
    const invite = await this.getInvite(inviteId);
    if (invite.status === 'BOOTED') throw new BadRequestException('활성화된 입사자는 폐기할 수 없습니다.');
    await this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { status: 'REVOKED', revokedAt: new Date() } });
    return { ok: true };
  }

  async list(filters: { status?: string; jobCategory?: string; q?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.jobCategory) where.jobCategory = filters.jobCategory;
    if (filters.q) {
      where.OR = [
        { candidateFamilyName: { contains: filters.q } },
        { candidateGivenName: { contains: filters.q } },
        { email: { contains: filters.q } },
      ];
    }
    return this.prisma.onboardingInvite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { sends: { orderBy: { sentAt: 'desc' }, take: 1 }, _count: { select: { documents: true } } },
    });
  }

  async getInvite(id: string) {
    const invite = await this.prisma.onboardingInvite.findUnique({
      where: { id },
      include: { sends: { orderBy: { sentAt: 'desc' } }, documents: true, profile: true, contract: true },
    });
    if (!invite) throw new NotFoundException('초대를 찾을 수 없습니다.');
    return invite;
  }

  // ── 입사예정자(토큰) ──

  // 진입 — 체크리스트/상태 (민감정보 미노출)
  publicView(invite: { id: string; candidateFamilyName: string; candidateGivenName: string; status: string; jobCategory: string; department: string | null; hireDate: Date; welcomeViewedAt: Date | null }) {
    return {
      name: `${invite.candidateFamilyName}${invite.candidateGivenName}`,
      status: invite.status,
      jobCategory: invite.jobCategory,
      department: invite.department,
      hireDate: invite.hireDate,
      welcomeViewed: !!invite.welcomeViewedAt,
      steps: {
        identity: ['VERIFIED', 'DOC_SUBMITTED', 'CONTRACT_SIGNED', 'APPROVED', 'BOOTED'].includes(invite.status),
        documents: ['DOC_SUBMITTED', 'CONTRACT_SIGNED', 'APPROVED', 'BOOTED'].includes(invite.status),
        contract: ['CONTRACT_SIGNED', 'APPROVED', 'BOOTED'].includes(invite.status),
        activated: invite.status === 'BOOTED',
      },
    };
  }

  // 본인확인(생년월일 대조) → 임시계정(PRE_BOARD) 생성. 생체등록은 후속(VERIFIED 전이).
  async claim(inviteId: string, birthDate: string) {
    const invite = await this.getInvite(inviteId);
    if (invite.provisionalUserId) return { provisionalUserId: invite.provisionalUserId, alreadyClaimed: true };
    if (!invite.birthDate) throw new BadRequestException('본인확인 정보가 설정되지 않았습니다. 담당자에게 문의하세요.');
    const same = new Date(birthDate).toISOString().slice(0, 10) === invite.birthDate.toISOString().slice(0, 10);
    if (!same) throw new BadRequestException({ code: 'DOB_MISMATCH', message: '생년월일이 일치하지 않습니다.' });

    // 임시계정(PRE_BOARD) — 로그인은 패스키만, passwordHash 는 사용불가 랜덤, email 은 placeholder
    const placeholderEmail = `onboarding+${invite.id}@onboarding.local`;
    const existing = await this.prisma.user.findUnique({ where: { email: placeholderEmail } });
    if (existing) throw new ConflictException('이미 처리 중인 초대입니다.');
    const user = await this.prisma.user.create({
      data: {
        email: placeholderEmail,
        passwordHash: randomBytes(32).toString('hex'), // 사용불가
        familyName: invite.candidateFamilyName,
        givenName: invite.candidateGivenName,
        role: 'READ',
        accountStage: 'PRE_BOARD',
        department: invite.department,
      },
      select: { id: true },
    });
    await this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { provisionalUserId: user.id } });
    this.audit(user.id, 'CREATE', 'ONBOARDING_INVITE', inviteId, { event: 'CLAIM_VERIFIED' });
    return { provisionalUserId: user.id, alreadyClaimed: false };
  }

  // ── 환영·회사소개 (SystemConfig 재사용, 신규 모델 0) ──
  async getWelcome() {
    const content = await this.configRuntime.get('onboarding.welcome');
    return content ?? { version: 0, locales: ['ko'], sections: [] };
  }

  async setWelcome(content: unknown, adminId: string) {
    await this.configRuntime.set('onboarding.welcome', content, adminId);
    return { ok: true };
  }

  async ackWelcome(inviteId: string) {
    await this.getInvite(inviteId);
    await this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { welcomeViewedAt: new Date() } });
    return { ok: true };
  }

  // ── 입사 개인정보(인적사항) — 주민번호·계좌 제외 ──
  async getProfile(inviteId: string) {
    return this.prisma.onboardingProfile.findUnique({ where: { inviteId } });
  }

  async upsertProfile(inviteId: string, dto: Record<string, unknown>) {
    await this.getInvite(inviteId);
    const submit = dto.submit === true;
    const data: Record<string, unknown> = { ...dto };
    delete data.submit;
    if (submit) data.submittedAt = new Date();
    const profile = await this.prisma.onboardingProfile.upsert({
      where: { inviteId },
      create: { inviteId, ...(data as object) },
      update: data as object,
    });
    if (submit) await this.maybeAdvanceToDocSubmitted(inviteId);
    return profile;
  }

  // ── 서류 (at-rest 암호화 — aes-256-gcm, EncryptionService와 동일 키원천 G2) ──
  private fileKey(): Buffer {
    const secret = this.config.get<string>('ENCRYPTION_KEY');
    if (!secret) throw new Error('ENCRYPTION_KEY 미설정 — 서류 암호화 불가');
    return getKeyCustody().getSymmetricKey(secret);
  }

  // 업로드 버퍼를 암호화해 디스크 저장(평문 미저장). 형식: iv(16)+authTag(16)+ciphertext
  async saveEncryptedDocument(inviteId: string, category: string, originalName: string, buffer: Buffer, sensitive: boolean) {
    const invite = await this.getInvite(inviteId);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.fileKey(), iv);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const blob = Buffer.concat([iv, cipher.getAuthTag(), enc]);
    const ext = extname(originalName).toLowerCase();
    const storedKey = `${randomUUID()}${ext}.enc`;
    writeFileSync(join(DOC_DIR, storedKey), blob, { mode: 0o600 });
    const created = await this.prisma.onboardingDocument.create({ data: { inviteId, category, fileKey: storedKey, sensitive } });
    this.audit(invite.provisionalUserId, 'CREATE', 'ONBOARDING_DOCUMENT', inviteId, { event: 'DOCUMENT_SUBMITTED', category, sensitive });
    return created;
  }

  // 복호화 스트림(HR 검토·req4-b ERP 열람용) — PII 접근 감사 필수
  async readDocumentFile(docId: string, actorUserId?: string): Promise<{ buffer: Buffer; contentType: string }> {
    const doc = await this.prisma.onboardingDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('서류 없음');
    this.audit(actorUserId, 'READ', 'ONBOARDING_DOCUMENT', doc.inviteId, { event: 'DOCUMENT_VIEWED', docId, category: doc.category, sensitive: doc.sensitive });
    const path = join(DOC_DIR, doc.fileKey);
    if (!existsSync(path)) throw new NotFoundException('파일 없음');
    const blob = readFileSync(path);
    const iv = blob.subarray(0, 16);
    const tag = blob.subarray(16, 32);
    const data = blob.subarray(32);
    const decipher = createDecipheriv('aes-256-gcm', this.fileKey(), iv);
    decipher.setAuthTag(tag);
    const buffer = Buffer.concat([decipher.update(data), decipher.final()]);
    const ext = extname(doc.fileKey.replace(/\.enc$/, '')).toLowerCase();
    return { buffer, contentType: MIME[ext] ?? 'application/octet-stream' };
  }

  async listDocuments(inviteId: string) {
    return this.prisma.onboardingDocument.findMany({ where: { inviteId }, orderBy: { createdAt: 'asc' } });
  }

  async reviewDocument(docId: string, status: string, reviewerId: string, rejectReason?: string) {
    const doc = await this.prisma.onboardingDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('서류를 찾을 수 없습니다.');
    return this.prisma.onboardingDocument.update({
      where: { id: docId },
      data: { status, reviewerId, rejectReason: status === 'REJECTED' ? (rejectReason ?? null) : null },
    });
  }

  // 인적사항 제출 + 필수숙지(환영) 완료 시 VERIFIED→DOC_SUBMITTED 전이
  private async maybeAdvanceToDocSubmitted(inviteId: string) {
    const invite = await this.getInvite(inviteId);
    if (invite.status !== 'VERIFIED') return;
    if (!invite.welcomeViewedAt) return; // 필수숙지 게이트
    if (!invite.profile?.submittedAt) return;
    await this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { status: 'DOC_SUBMITTED' } });
  }

  // ── 전자계약 서명 (최소: 기록·상태전이. PDF·블록체인·step-up 은 후속) ──
  async signContract(inviteId: string, templateId?: string, signatureImageKey?: string) {
    const invite = await this.getInvite(inviteId);
    if (invite.status !== 'DOC_SUBMITTED') throw new BadRequestException({ code: 'CONTRACT_NOT_READY', message: '인적사항·서류 제출 후 계약 서명이 가능합니다.' });
    const signerHash = createHash('sha256').update(`${invite.provisionalUserId ?? invite.id}:${Date.now()}`).digest('hex');
    await this.prisma.onboardingContract.upsert({
      where: { inviteId },
      create: { inviteId, templateId: templateId ?? '00000000-0000-0000-0000-000000000000', signedAt: new Date(), signerHash, signatureImageKey: signatureImageKey ?? null },
      update: { signedAt: new Date(), signerHash, signatureImageKey: signatureImageKey ?? null },
    });
    await this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { status: 'CONTRACT_SIGNED' } });
    this.audit(invite.provisionalUserId, 'UPDATE', 'ONBOARDING_INVITE', inviteId, { event: 'CONTRACT_SIGNED', signerHash });
    return { ok: true, status: 'CONTRACT_SIGNED' };
  }

  // ── 생체등록(패스키) — 임시계정(provisionalUserId)에 등록. 기존 PasskeyService 재사용(§5.6). ──
  private async requireProvisional(inviteId: string): Promise<string> {
    const invite = await this.getInvite(inviteId);
    if (!invite.provisionalUserId) throw new BadRequestException({ code: 'CLAIM_REQUIRED', message: '본인확인(생년월일)을 먼저 완료하세요.' });
    if (invite.status === 'BOOTED') throw new BadRequestException('이미 활성화된 계정입니다.');
    return invite.provisionalUserId;
  }

  async passkeyRegisterOptions(inviteId: string) {
    const userId = await this.requireProvisional(inviteId);
    return this.passkey.getRegistrationOptions(userId);
  }

  // 등록 검증 성공 → invite VERIFIED(로그인정보 등록 완료)
  async passkeyRegisterVerify(inviteId: string, response: unknown, deviceName?: string) {
    const userId = await this.requireProvisional(inviteId);
    const result = await this.passkey.verifyRegistration(userId, response as never, deviceName);
    await this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
    return result;
  }

  // ── 계정 활성화(APPROVED→BOOTED) — Staff 생성(hr.service, ERP 자동발행) + 임시계정 승격 ──
  // ※4-eyes(AdminApproval) 는 후속. 현재는 ADMIN 단일 승인.
  private async genEmployeeNumber(): Promise<string> {
    const year = new Date().getFullYear();
    for (let i = 0; i < 6; i++) {
      const seq = String(Math.floor(100000 + Math.random() * 900000));
      const no = `${year}-${seq}`;
      const exists = await this.prisma.staff.findUnique({ where: { employeeNumber: no }, select: { id: true } });
      if (!exists) return no;
    }
    throw new ConflictException({ code: 'EMPLOYEE_NUMBER_CONFLICT', message: '사번 채번 실패. 다시 시도하세요.' });
  }

  async approveBoot(inviteId: string, adminId: string) {
    const invite = await this.getInvite(inviteId);
    // 사전조건: 계약서명 완료 + 임시계정 + 생체등록(VERIFIED 이상)
    if (invite.status !== 'CONTRACT_SIGNED') throw new BadRequestException({ code: 'BOOT_NOT_READY', message: '계약 서명 완료 후 활성화할 수 있습니다.' });
    if (!invite.provisionalUserId) throw new BadRequestException({ code: 'CLAIM_REQUIRED', message: '임시계정이 없습니다.' });
    const credCount = await this.prisma.webAuthnCredential.count({ where: { userId: invite.provisionalUserId } });
    if (credCount < 1) throw new BadRequestException({ code: 'BIOMETRIC_REGISTRATION_REQUIRED', message: '생체등록이 완료되지 않았습니다.' });

    // 4-eyes(FR-C2) — config 게이트(onboarding.fourEyes). 2차 승인은 기존 credential-admin 승인 UI(AdminApproval) 재사용.
    const fourEyes = (await this.configRuntime.get('onboarding.fourEyes')) === true;
    if (fourEyes) {
      const approved = await this.prisma.adminApproval.findFirst({ where: { action: 'ACCOUNT_BOOT', targetId: inviteId, status: 'APPROVED', expiresAt: { gt: new Date() } }, orderBy: { decidedAt: 'desc' } });
      if (!approved) {
        const pending = await this.prisma.adminApproval.findFirst({ where: { action: 'ACCOUNT_BOOT', targetId: inviteId, status: 'PENDING', expiresAt: { gt: new Date() } } });
        if (!pending) {
          await this.prisma.adminApproval.create({ data: { action: 'ACCOUNT_BOOT', targetType: 'ONBOARDING_INVITE', targetId: inviteId, requestedBy: adminId, status: 'PENDING', expiresAt: new Date(Date.now() + 86400_000) } });
          this.audit(adminId, 'CREATE', 'ONBOARDING_INVITE', inviteId, { event: 'BOOT_APPROVAL_REQUESTED' });
        }
        return { pending: true, status: invite.status, message: '2인 승인(4-eyes)이 필요합니다. 다른 관리자 승인 후 다시 활성화하세요.' };
      }
      await this.prisma.adminApproval.update({ where: { id: approved.id }, data: { status: 'EXECUTED' } });
    }

    const { category, role, position, profession } = mapJob(invite.jobCategory);

    // 멱등: 이전 부분실행으로 Staff가 이미 있으면 재생성하지 않음(G3)
    let staff = await this.prisma.staff.findUnique({ where: { userId: invite.provisionalUserId } });
    if (!staff) {
      const employeeNumber = await this.genEmployeeNumber();
      // 1) Staff 생성(hr.service → staff.created outbox 자동발행) + userId 연결
      staff = await this.hr.create({
        employeeNumber,
        familyName: invite.candidateFamilyName,
        givenName: invite.candidateGivenName,
        category: category as never,
        department: invite.department ?? '미배정',
        position,
        hireDate: invite.hireDate.toISOString(),
        email: invite.email ?? undefined,
        phone: invite.phone ?? undefined,
        userId: invite.provisionalUserId,
      });
    }

    const licenses = (invite.profile?.licenses as { type?: string; name?: string; number?: string; issuer?: string }[] | null) ?? [];
    // 2~4) 임시계정 승격 + 면허 이관 + invite BOOTED — 원자적(G3)
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: invite.provisionalUserId },
        data: { accountStage: 'ACTIVE', role: role as never, profession, ...(invite.email ? { email: invite.email } : {}) },
      }),
      ...(Array.isArray(licenses) ? licenses : [])
        .filter((lic) => lic?.name || lic?.number)
        .map((lic) => this.prisma.staffCredential.create({
          data: { userId: invite.provisionalUserId!, type: lic.type ?? 'LICENSE', name: lic.name ?? '면허', number: lic.number ?? null, issuer: lic.issuer ?? null },
        })),
      this.prisma.onboardingInvite.update({ where: { id: inviteId }, data: { status: 'BOOTED', bootedUserId: invite.provisionalUserId } }),
    ]);
    this.audit(adminId, 'UPDATE', 'ONBOARDING_INVITE', inviteId, { event: 'ACTIVATED', employeeNumber: staff.employeeNumber, staffId: staff.id });
    return { ok: true, status: 'BOOTED', employeeNumber: staff.employeeNumber, staffId: staff.id };
  }

  // QR PNG 버퍼 (대면 전달용) — 재발급 토큰으로만 생성 가능하므로 create/resend 응답의 qrDataUrl 사용 권장.
  async qrPngFromRaw(raw: string): Promise<Buffer> {
    const link = `${this.baseUrl()}/onboarding/${raw}`;
    return QRCode.toBuffer(link, { width: 240, margin: 2, type: 'png' });
  }
}
