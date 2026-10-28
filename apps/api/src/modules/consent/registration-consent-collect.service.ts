import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConsentService, REGISTRATION_BUNDLE_TYPE } from './consent.service';
import { ConsentDeviceService } from './consent-device.service';
import { RegistrationConsentService, CONSENT_TYPES } from '../registration-consent/registration-consent.service';

export const REGISTRATION_BUNDLE_TEMPLATE = '초진 등록 동의서(10종)';

/** 서명 직후 원장 기록이 진행 중일 수 있는 시간 — 이보다 최근 서명은 목록에 올리지 않는다(거짓 경보 방지) */
export const UNAPPLIED_GRACE_MS = 60_000;
export const UNAPPLIED_LIST_LIMIT = 200;

/**
 * 서명됐지만 원장에 없는 묶음을 어떻게 처리하는가.
 *  - APPLY: 서명본에 환자의 항목별 선택이 남아 있고, 서명 뒤 바뀐 원장 기록이 없다 → 서명본대로 옮겨 적는다
 *  - RECOLLECT: 다시 받아야 한다 — NO_CHOICES(2026-10-03 이전 서명이라 선택이 남지 않음 · 서명본만으로는 무엇에 동의했는지 모른다)
 *               · NEWER_RECORDS(서명 뒤 원장에 더 새 기록·철회가 있다 — 덮어쓰면 나중 사실을 지운다)
 */
export type UnappliedAction = 'APPLY' | 'RECOLLECT';
export type UnappliedReason = 'NO_CHOICES' | 'NEWER_RECORDS' | null;

type PatientChoicesRecord = {
  choices: Record<string, boolean>;
  signMethod: 'TABLET' | 'MOBILE';
  signedBy: string;
  guardianName: string | null;
  guardianRelation: string | null;
  collectedBy: string | null;
  ipAddress: string | null;
};

/** 서명본에 남은 선택 — 10종 모두 boolean 이 아니면 없는 것으로 본다(일부만으로 원장을 만들지 않는다) */
export function storedPatientChoices(content: unknown): PatientChoicesRecord | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const pc = (content as Record<string, unknown>).patientChoices as Record<string, unknown> | undefined;
  if (!pc || typeof pc !== 'object') return null;
  const raw = pc.choices as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const choices: Record<string, boolean> = {};
  for (const type of Object.keys(CONSENT_TYPES)) {
    if (typeof raw[type] !== 'boolean') return null;
    choices[type] = raw[type] as boolean;
  }
  const signedBy = typeof pc.signedBy === 'string' ? pc.signedBy.trim() : '';
  if (!signedBy) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    choices,
    signMethod: pc.signMethod === 'MOBILE' ? 'MOBILE' : 'TABLET',
    signedBy,
    guardianName: str(pc.guardianName),
    guardianRelation: str(pc.guardianRelation),
    collectedBy: str(pc.collectedBy),
    ipAddress: str(pc.ipAddress),
  };
}

type UnappliedRawRow = {
  consentId: string; patientId: string; signedAt: Date; signMode: string | null;
  content: unknown; newerRecords: boolean;
  familyName: string | null; givenName: string | null; mrn: string | null;
};
type UnappliedRow = {
  consentId: string; patientId: string; signedAt: Date; signMode: string | null;
  /** 판정 정본은 storedPatientChoices 하나(SQL 이 따로 판정하면 갈라진다) */
  hasChoices: boolean; newerRecords: boolean;
  familyName: string | null; givenName: string | null; mrn: string | null;
};

/**
 * 초진 등록 동의 수집(2026-10-02) — 태블릿·환자 휴대폰(전자동의)·종이(출력 → 스캔 등록).
 *
 * 🔴 종전 초진 등록은 직원 체크박스 10개였고, 서버는 그것으로 동의서 행을 "환자 이름으로 서명됨·지금·유효"로 만들었다
 *    (서명한 적 없는 환자를 서명했다고 기록 · 10종 중 3종만 저장). 태블릿 기기·서명 세션·공개 서명 화면·첨부 업로드는
 *    **수술·시술 동의서에만** 이어져 있었다.
 * → 초진 동의를 한 장의 묶음 동의서(ConsentForm type REGISTRATION)로 만들어 **기존 서명 기반을 그대로** 쓴다:
 *    · 태블릿: 승인 기기로 보내기(서명 세션 5분) · 휴대폰: 일회 링크(15분 · QR) — 환자가 항목별로 고르고 서명 → 원장 10종
 *    · 종이: 출력 → 스캔본 첨부(서명 URL 보호) → 종이에 표시된 대로 직원이 옮겨 적음 — **스캔본 없이는 기록하지 않는다**
 *    원장 각 행은 증빙(이 묶음)을 가리킨다.
 */
@Injectable()
export class RegistrationConsentCollectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly devices: ConsentDeviceService,
    private readonly registration: RegistrationConsentService,
  ) {}

  /** 열려 있는(아직 서명·기록 전) 묶음을 재사용 — 없으면 만든다 */
  async ensurePackage(patientId: string, userId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    const open = await this.prisma.consentForm.findFirst({
      where: { patientId, type: REGISTRATION_BUNDLE_TYPE, status: 'PENDING', revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, attachments: true, createdAt: true },
    });
    if (open) return open;
    return this.prisma.consentForm.create({
      data: {
        patientId,
        type: REGISTRATION_BUNDLE_TYPE,
        templateName: REGISTRATION_BUNDLE_TEMPLATE,
        content: {
          kind: 'REGISTRATION_BUNDLE',
          version: '1.0',
          items: Object.entries(CONSENT_TYPES).map(([type, m]) => ({ type, label: m.label, required: m.required, law: m.law })),
        } as Prisma.InputJsonValue,
        status: 'PENDING',
        requestedBy: userId,
      },
      select: { id: true, status: true, attachments: true, createdAt: true },
    });
  }

  /**
   * 🔴 서명은 됐는데 원장에 없는 초진 동의 묶음(2026-10-03).
   *    태블릿·휴대폰 서명은 서명 저장 뒤 원장 10종을 따로 쓴다 — 그 사이에 실패하면 서명본만 남고, 현황은 "미수집"으로 보여
   *    아무도 그 환자를 찾지 않는다(종이 경로는 한 트랜잭션이라 해당 없음). 그 환자를 **줄어드는 목록**으로 드러낸다.
   *    - 환자별 **가장 최근 서명 묶음**만 본다 — 뒤에 다시 받아 원장이 새 묶음을 가리키면 옛 묶음은 대상이 아니다.
   *    - 방금 서명한 것은 원장 기록이 진행 중일 수 있어 유예(UNAPPLIED_GRACE_MS) 뒤에 올린다.
   */
  private async unappliedRows(patientId?: string): Promise<{ rows: UnappliedRow[]; total: number }> {
    const cutoff = new Date(Date.now() - UNAPPLIED_GRACE_MS);
    const byPatient = patientId ? Prisma.sql`AND cf.patient_id = ${patientId}::uuid` : Prisma.empty;
    const base = Prisma.sql`
      FROM consent_forms cf
      JOIN patients p ON p.id = cf.patient_id
      WHERE cf.type = ${REGISTRATION_BUNDLE_TYPE} AND cf.status = 'SIGNED' AND cf.revoked_at IS NULL
        AND cf.patient_signed_at IS NOT NULL AND cf.patient_signed_at < ${cutoff}
        ${byPatient}
        AND NOT EXISTS (SELECT 1 FROM registration_consents rc WHERE rc.evidence_consent_form_id = cf.id)
        AND NOT EXISTS (
          SELECT 1 FROM consent_forms cf2
          WHERE cf2.patient_id = cf.patient_id AND cf2.type = cf.type AND cf2.status = 'SIGNED' AND cf2.revoked_at IS NULL
            AND cf2.patient_signed_at > cf.patient_signed_at)`;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<UnappliedRawRow[]>(Prisma.sql`
        SELECT cf.id::text AS "consentId", cf.patient_id::text AS "patientId", cf.patient_signed_at AS "signedAt", cf.sign_mode AS "signMode",
          cf.content AS "content",
          EXISTS (SELECT 1 FROM registration_consents rc2 WHERE rc2.patient_id = cf.patient_id
            AND (rc2.signed_at > cf.patient_signed_at OR rc2.revoked_at > cf.patient_signed_at)) AS "newerRecords",
          p.family_name AS "familyName", p.given_name AS "givenName", p.mrn AS "mrn"
        ${base}
        ORDER BY cf.patient_signed_at DESC
        LIMIT ${UNAPPLIED_LIST_LIMIT}`),
      this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(*)::int AS n ${base}`),
    ]);
    return {
      rows: rows.map(({ content, ...r }) => ({ ...r, hasChoices: storedPatientChoices(content) != null })),
      total: count[0]?.n ?? 0,
    };
  }

  private static classify(r: Pick<UnappliedRow, 'hasChoices' | 'newerRecords'>): { action: UnappliedAction; reason: UnappliedReason } {
    if (!r.hasChoices) return { action: 'RECOLLECT', reason: 'NO_CHOICES' };
    if (r.newerRecords) return { action: 'RECOLLECT', reason: 'NEWER_RECORDS' };
    return { action: 'APPLY', reason: null };
  }

  /** 병원 전체 재수집 목록 — 자르면 잘랐다고 말한다(total) */
  async unappliedSignatures() {
    const { rows, total } = await this.unappliedRows();
    return {
      items: rows.map((r) => ({
        consentId: r.consentId, patientId: r.patientId, signedAt: r.signedAt, signMode: r.signMode,
        patient: { familyName: r.familyName, givenName: r.givenName, mrn: r.mrn },
        ...RegistrationConsentCollectService.classify(r),
      })),
      total,
      limit: UNAPPLIED_LIST_LIMIT,
      graceSeconds: UNAPPLIED_GRACE_MS / 1000,
    };
  }

  /**
   * 서명본대로 원장 기록 — 환자가 서명하며 고른 그대로(직원이 고르지 않는다). 서명 시각·방식·수집 직원도 서명본의 것.
   * 🔴 원장에 서명 뒤 더 새 기록·철회가 있으면 거부한다(덮어쓰면 나중 사실을 지운다 → 다시 받기).
   */
  async applySigned(patientId: string, consentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.consentForm.findUnique({
        where: { id: consentId },
        select: { id: true, patientId: true, type: true, status: true, revokedAt: true, patientSignedAt: true, content: true },
      });
      if (!form || form.patientId !== patientId || form.type !== REGISTRATION_BUNDLE_TYPE) throw new NotFoundException('이 환자의 초진 동의 묶음이 아닙니다');
      if (form.status !== 'SIGNED' || form.revokedAt || !form.patientSignedAt) throw new BadRequestException('환자 서명이 끝난 묶음만 원장에 옮길 수 있습니다');
      const refs = await tx.registrationConsent.count({ where: { evidenceConsentFormId: consentId } });
      if (refs > 0) throw new BadRequestException('이미 원장에 기록된 묶음입니다 — 현황을 새로 고치세요');
      const later = await tx.consentForm.count({
        where: { patientId, type: REGISTRATION_BUNDLE_TYPE, status: 'SIGNED', revokedAt: null, patientSignedAt: { gt: form.patientSignedAt } },
      });
      if (later > 0) throw new BadRequestException('이 환자에게 더 최근에 서명한 묶음이 있습니다 — 옛 서명본으로 원장을 덮지 않습니다');
      const pc = storedPatientChoices(form.content);
      if (!pc) throw new BadRequestException('서명본에 항목별 선택이 남아 있지 않습니다 — 환자에게 다시 받아야 합니다');
      const newer = await tx.registrationConsent.count({
        where: { patientId, OR: [{ signedAt: { gt: form.patientSignedAt } }, { revokedAt: { gt: form.patientSignedAt } }] },
      });
      if (newer > 0) throw new BadRequestException('서명 뒤에 바뀐 동의 기록(새 기록·철회)이 있어 서명본으로 덮지 않습니다 — 환자에게 다시 받아주세요');
      const r = await this.registration.recordFromEvidence(patientId, {
        choices: pc.choices, signMethod: pc.signMethod, signedBy: pc.signedBy,
        guardianName: pc.guardianName, guardianRelation: pc.guardianRelation,
        collectedBy: pc.collectedBy, ipAddress: pc.ipAddress,
        evidenceConsentFormId: consentId, signedAt: form.patientSignedAt,
      }, tx);
      return { consentId, ...r };
    });
  }

  /** 현황 — 원장 10종 + 열린 묶음(스캔본 수) + 서명됐지만 원장에 없는 묶음 */
  async status(patientId: string) {
    const [ledger, open, unapplied] = await Promise.all([
      this.registration.getConsents(patientId),
      this.prisma.consentForm.findFirst({
        where: { patientId, type: REGISTRATION_BUNDLE_TYPE, status: 'PENDING', revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, attachments: true, createdAt: true },
      }),
      this.unappliedRows(patientId),
    ]);
    const u = unapplied.rows[0];
    return {
      ...ledger,
      unappliedSigned: u ? { consentId: u.consentId, signedAt: u.signedAt, signMode: u.signMode, ...RegistrationConsentCollectService.classify(u) } : null,
      openPackage: open ? { id: open.id, createdAt: open.createdAt, scans: Array.isArray(open.attachments) ? (open.attachments as unknown[]).length : 0 } : null,
    };
  }

  /** 승인·활성 기기 — 서명 보내기 대상 */
  async listDevices() {
    const all = await this.devices.listDevices();
    return all.filter((d) => d.approvalStatus === 'APPROVED').map((d) => ({ id: d.id, name: d.name, location: d.location, status: d.status, online: d.online }));
  }

  async dispatchToTablet(patientId: string, deviceId: string, userId: string) {
    const pkg = await this.ensurePackage(patientId, userId);
    const r = await this.devices.dispatch(pkg.id, deviceId, userId);
    return { consentId: pkg.id, dispatched: r.dispatched };
  }

  /** 환자 휴대폰 서명 링크(15분 · 일회) — URL 은 화면이 자기 오리진으로 만든다(서버가 호스트를 지어내지 않는다) */
  async mobileLink(patientId: string, userId: string) {
    const pkg = await this.ensurePackage(patientId, userId);
    const s = await this.consent.createSignSession(pkg.id, userId, { signMode: 'MOBILE', signerType: 'PATIENT' });
    return { consentId: pkg.id, token: s.token, expiresAt: s.expiresAt, path: `/consent-sign/${s.token}` };
  }

  async attachScan(patientId: string, file: { url: string; fileName: string; mimeType: string; size: number }, userId: string) {
    const pkg = await this.ensurePackage(patientId, userId);
    const r = await this.consent.addAttachment(pkg.id, file, userId);
    return { consentId: pkg.id, scans: Array.isArray(r.attachments) ? (r.attachments as unknown[]).length : 0 };
  }

  /**
   * 종이 동의서 기록 — 🔴 스캔본이 붙은 묶음에서만. 종이에 표시된 항목별 동의를 직원이 옮겨 적는다(signMethod PAPER).
   *    스캔본이 없으면 거부한다 — 증빙 없는 "종이로 받았다"를 만들지 않는다.
   */
  async recordPaper(patientId: string, input: { choices: Record<string, unknown>; signedBy: string; guardianName?: string; guardianRelation?: string }, userId: string) {
    const pkg = await this.prisma.consentForm.findFirst({
      where: { patientId, type: REGISTRATION_BUNDLE_TYPE, status: 'PENDING', revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, attachments: true },
    });
    const scans = pkg && Array.isArray(pkg.attachments) ? (pkg.attachments as unknown[]).length : 0;
    if (!pkg || scans === 0) throw new BadRequestException('종이 동의서 스캔본을 먼저 등록하세요 — 증빙 없이 기록하지 않습니다');
    if (!input.signedBy?.trim()) throw new BadRequestException('서명자 이름이 필요합니다');
    const choices: Record<string, boolean> = {};
    for (const type of Object.keys(CONSENT_TYPES)) {
      const v = input.choices?.[type];
      if (typeof v !== 'boolean') throw new BadRequestException('종이에 표시된 대로 모든 항목의 동의·미동의를 입력하세요');
      choices[type] = v;
    }
    // 🔴 묶음 닫기(조건부 — 그 사이 태블릿 서명이 먼저 닫았으면 거부)와 원장 10종을 한 트랜잭션으로 —
    //    "닫혔는데 기록 없음"·"기록됐는데 증빙이 열림"을 남기지 않는다
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.consentForm.updateMany({
        where: { id: pkg.id, status: 'PENDING' },
        data: { status: 'SIGNED', signMode: 'PAPER', patientSignedAt: new Date(), patientSignedBy: input.signedBy.trim(), signedAt: new Date(), signedBy: input.signedBy.trim() },
      });
      if (closed.count !== 1) throw new BadRequestException('이 묶음은 이미 서명으로 닫혔습니다 — 현황을 새로 고치세요');
      const r = await this.registration.recordFromEvidence(patientId, {
        choices, signMethod: 'PAPER', signedBy: input.signedBy.trim(),
        guardianName: input.guardianName ?? null, guardianRelation: input.guardianRelation ?? null,
        collectedBy: userId, evidenceConsentFormId: pkg.id,
      }, tx);
      return { consentId: pkg.id, ...r };
    });
  }
}
