import { Injectable, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { escapeHtml as esc } from '../../common/util/html-escape';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CONSENT_DETAILS } from './consent-details';
import { FcmPushService } from '../notification/fcm-push.service';

// 동의서 10종 정의 — 정본(초진 동의 묶음·서명 화면·출력이 이 표를 쓴다)
export const CONSENT_TYPES = {
  // 필수 6종
  PRIVACY:     { label: '개인정보 수집·이용 동의', required: true, law: '개인정보보호법 제15조', expiryMonths: 12 },
  SENSITIVE:   { label: '민감정보(건강정보) 처리 동의', required: true, law: '개인정보보호법 제23조, 의료법 시행령 제42조의2', expiryMonths: 12 },
  UNIQUE_ID:   { label: '고유식별정보 처리 동의', required: true, law: '개인정보보호법 제24조, 제24조의2', expiryMonths: 12 },
  THIRD_PARTY: { label: '제3자 제공 동의', required: true, law: '개인정보보호법 제17조', expiryMonths: 12 },
  TREATMENT:   { label: '진료 동의', required: true, law: '의료법 제24조의2', expiryMonths: 12 },
  HIE:         { label: '진료정보교류(HIE) 동의', required: true, law: '의료법 제21조의2, 시행규칙 별지 제9호의5', expiryMonths: 0 },
  // 선택 4종
  MARKETING:   { label: '마케팅 수신 동의', required: false, law: '정보통신망법 제50조', expiryMonths: 24 },
  RESEARCH:    { label: '임상연구 정보 활용 동의', required: false, law: '생명윤리법 제18조', expiryMonths: 0 },
  EMR_VIEW:    { label: '전자의무기록 열람 동의', required: false, law: '의료법 제21조', expiryMonths: 0 },
  TELEHEALTH:  { label: '원격진료 사전 동의', required: false, law: '의료법 제34조', expiryMonths: 0 },
};

const REQUIRED_TYPES = Object.entries(CONSENT_TYPES).filter(([, v]) => v.required).map(([k]) => k);

export interface RegistrationEvidenceResult {
  recorded: number;
  items: Array<{ type: string; agreed: boolean }>;
  requiredComplete: boolean;
  missingRequired: string[];
}

@Injectable()
export class RegistrationConsentService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly fcmPush?: FcmPushService,
  ) {}

  /** 동의서 10종 메타 정보 반환 — 전문(detail) 동봉(정본은 서버 하나) */
  getConsentTypes() {
    return Object.fromEntries(
      Object.entries(CONSENT_TYPES).map(([k, v]) => [k, { ...v, detail: CONSENT_DETAILS[k] ?? null }]),
    );
  }

  /** 환자 동의 현황 (10종 상태) */
  async getConsents(patientId: string) {
    const consents = await this.prisma.registrationConsent.findMany({
      where: { patientId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // 10종 각각 최신 동의 상태 매핑
    const result = Object.entries(CONSENT_TYPES).map(([type, meta]) => {
      const consent = consents.find(c => c.type === type);
      const expired = consent?.expiresAt && consent.expiresAt < new Date();
      return {
        type,
        ...meta,
        detail: CONSENT_DETAILS[type] ?? null, // 전문 정본 — FE 하드코딩 병합 제거(2026-08-25)
        agreed: consent?.agreed ?? false,
        signedAt: consent?.signedAt ?? null,
        signedBy: consent?.signedBy ?? null,
        signMethod: consent?.signMethod ?? null,
        // 증빙(태블릿·휴대폰 서명 묶음 또는 종이 스캔본이 붙은 동의서) — null = 증빙 연결 없음(직원 입력 등)
        evidenceConsentFormId: consent?.evidenceConsentFormId ?? null,
        expired: !!expired,
        consentId: consent?.id ?? null,
      };
    });

    const requiredComplete = result.filter(r => r.required).every(r => r.agreed && !r.expired);
    // 🔴 필수 '동의' 중 직원 입력(HIS — 환자 서명 증빙 없음)으로만 남은 수(2026-10-03).
    //    완료 판정은 그대로 두되(게이트 없음), 화면이 "필수 완료"를 서명 증빙과 같은 색으로 그리지 않게 따로 낸다.
    const requiredStaffEntered = result.filter(r => r.required && r.agreed && !r.expired && r.signMethod === 'HIS').length;

    return { consents: result, requiredComplete, requiredStaffEntered };
  }

  /**
   * 증빙에서 온 동의 기록 — 초진 동의 묶음(태블릿·휴대폰 서명) 또는 종이 스캔본(2026-10-02).
   * 🔴 종전 초진 등록은 **직원 체크박스**만으로 "환자 이름으로 서명됨·지금"을 만들었다(서명한 적 없는 환자를 서명했다고 기록).
   *    여기서는 **환자가 고른 항목별 동의**만 쓰고, 어떤 증빙에서 왔는지(evidenceConsentFormId)·방식(TABLET·MOBILE·PAPER)을 남긴다.
   *  - 10종 모두에 대해 쓴다 — 고르지 않은 항목은 "미동의"(동의를 지어내지 않는다)
   *  - 서명 이미지는 묶음 동의서(ConsentForm)에 있다 — 10행에 같은 이미지를 복제하지 않는다
   */
  async recordFromEvidence(patientId: string, input: {
    choices: Record<string, boolean>;
    signMethod: 'TABLET' | 'MOBILE' | 'PAPER';
    signedBy: string;
    guardianName?: string | null;
    guardianRelation?: string | null;
    collectedBy?: string | null;
    evidenceConsentFormId: string;
    ipAddress?: string | null;
    /** 환자가 의사를 밝힌 시각 — 서명본에서 나중에 옮겨 적을 때는 그 서명 시각(지금이 아니다). 없으면 지금 */
    signedAt?: Date | null;
  }, tx?: Prisma.TransactionClient): Promise<RegistrationEvidenceResult> {
    // 🔴 10종은 함께 남거나 함께 안 남는다(일부만 쓰인 묶음 = 환자가 밝히지 않은 상태를 만든다)
    if (!tx) return this.prisma.$transaction((t) => this.recordFromEvidence(patientId, input, t));
    const now = input.signedAt ?? new Date();
    const out: Array<{ type: string; agreed: boolean }> = [];
    for (const [type, meta] of Object.entries(CONSENT_TYPES)) {
      const agreed = input.choices[type] === true;
      const expiresAt = agreed && meta.expiryMonths > 0 ? new Date(now.getTime() + meta.expiryMonths * 30 * 24 * 60 * 60 * 1000) : null;
      const data = {
        agreed,
        signedAt: now, // 의사를 밝힌 시각(동의·미동의 모두) — 미동의도 환자가 서명으로 밝힌 사실이다
        signedBy: input.signedBy,
        signMethod: input.signMethod,
        signatureData: null,
        guardianName: input.guardianName ?? null,
        guardianRelation: input.guardianRelation ?? null,
        expiresAt,
        collectedBy: input.collectedBy ?? null,
        ipAddress: input.ipAddress ?? null,
        evidenceConsentFormId: input.evidenceConsentFormId,
        revokedAt: null,
        revokedReason: null,
      };
      await tx.registrationConsent.upsert({
        where: { patientId_type_version: { patientId, type, version: '1.0' } },
        create: { patientId, type, ...data },
        update: data,
      });
      out.push({ type, agreed });
    }
    const missingRequired = REQUIRED_TYPES.filter((t) => input.choices[t] !== true);
    return { recorded: out.length, items: out, requiredComplete: missingRequired.length === 0, missingRequired };
  }

  /** 동의서 일괄 등록 (접수 시) */
  async createBulk(patientId: string, data: {
    consents: { type: string; agreed: boolean; signedBy?: string; signMethod?: string; signatureData?: string; guardianName?: string; guardianRelation?: string }[];
  }, collectedBy?: string) {
    const results = [];
    const now = new Date();

    for (const c of data.consents) {
      const meta = CONSENT_TYPES[c.type as keyof typeof CONSENT_TYPES];
      if (!meta) continue;

      // 기존 동의 확인 (중복 방지)
      const existing = await this.prisma.registrationConsent.findUnique({
        where: { patientId_type_version: { patientId, type: c.type, version: '1.0' } },
      });

      if (existing && existing.agreed && !existing.revokedAt) {
        results.push(existing);
        continue;
      }

      const expiresAt = meta.expiryMonths > 0
        ? new Date(now.getTime() + meta.expiryMonths * 30 * 24 * 60 * 60 * 1000)
        : null;

      const consent = await this.prisma.registrationConsent.upsert({
        where: { patientId_type_version: { patientId, type: c.type, version: '1.0' } },
        create: {
          patientId,
          type: c.type,
          agreed: c.agreed,
          signedAt: c.agreed ? now : null,
          signedBy: c.signedBy,
          signMethod: c.signMethod ?? 'HIS',
          signatureData: c.signatureData,
          guardianName: c.guardianName,
          guardianRelation: c.guardianRelation,
          expiresAt,
          collectedBy,
        },
        update: {
          agreed: c.agreed,
          signedAt: c.agreed ? now : null,
          signedBy: c.signedBy,
          signMethod: c.signMethod ?? 'HIS',
          signatureData: c.signatureData,
          guardianName: c.guardianName,
          guardianRelation: c.guardianRelation,
          expiresAt,
          collectedBy,
          revokedAt: null,
          revokedReason: null,
        },
      });

      results.push(consent);
    }

    // 이벤트 발행
    this.eventEmitter?.emit('registration.consent.collected', { patientId, count: results.length });

    return results;
  }

  /** 개별 동의 업데이트 (포털 서명 등) */
  async updateConsent(patientId: string, type: string, data: {
    agreed: boolean;
    signedBy?: string;
    signMethod?: string;
    signatureData?: string;
    ipAddress?: string;
  }) {
    const meta = CONSENT_TYPES[type as keyof typeof CONSENT_TYPES];
    if (!meta) throw new BadRequestException(`알 수 없는 동의 유형: ${type}`);

    const now = new Date();
    const expiresAt = meta.expiryMonths > 0
      ? new Date(now.getTime() + meta.expiryMonths * 30 * 24 * 60 * 60 * 1000)
      : null;

    const consent = await this.prisma.registrationConsent.upsert({
      where: { patientId_type_version: { patientId, type, version: '1.0' } },
      create: {
        patientId,
        type,
        agreed: data.agreed,
        signedAt: data.agreed ? now : null,
        signedBy: data.signedBy,
        signMethod: data.signMethod ?? 'PORTAL',
        signatureData: data.signatureData,
        ipAddress: data.ipAddress,
        expiresAt,
      },
      update: {
        agreed: data.agreed,
        signedAt: data.agreed ? now : null,
        signedBy: data.signedBy,
        signMethod: data.signMethod ?? 'PORTAL',
        signatureData: data.signatureData,
        ipAddress: data.ipAddress,
        expiresAt,
        revokedAt: null,
        revokedReason: null,
      },
    });

    // 부가 통로(현재 구독자 0·SSE 없음). 🔴 2026-08-20 실측: 종전 주석은 "SSE 이벤트 → HIS 실시간 반영"
    // 이라고 적혀 있었으나 이 이벤트를 구독하는 곳도, 이 이름으로 흐르는 SSE 채널도 없다.
    // 원무 창구(workstation/reception LegalConsentPanel)는 폴링/무효화로 다시 읽는다 — 실시간 push 가 아니다.
    // 동의 사실 자체는 위 upsert 로 이미 기록됐으므로 이 이벤트가 소비되지 않아도 잃는 사실은 없다.
    // 구독자를 붙이는 날 이 주석을 그때의 사실로 바꾼다(없는 통로를 있다고 적지 않는다).
    this.eventEmitter?.emit('registration.consent.signed', {
      patientId,
      type,
      signMethod: data.signMethod ?? 'PORTAL',
    });

    return consent;
  }

  /** 동의 철회 (선택 동의만) */
  async revokeConsent(patientId: string, type: string, reason: string) {
    const meta = CONSENT_TYPES[type as keyof typeof CONSENT_TYPES];
    if (!meta) throw new BadRequestException(`알 수 없는 동의 유형: ${type}`);
    if (meta.required) throw new BadRequestException('필수 동의는 철회할 수 없습니다');

    return this.prisma.registrationConsent.updateMany({
      where: { patientId, type, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** 필수 동의 완료 확인 */
  async checkComplete(patientId: string): Promise<{ complete: boolean; missing: string[] }> {
    const { consents } = await this.getConsents(patientId);
    const missing = consents.filter(c => c.required && (!c.agreed || c.expired)).map(c => c.type);
    return { complete: missing.length === 0, missing };
  }

  /**
   * 포털 동의 요청 알림 발송.
   *
   * 🔴 종전에는 포털 계정이 없으면 `PatientNotification` 을 **하나도 만들지 않고도**
   *    `{ success:true, '포털 동의 요청이 전송되었습니다' }` 를 돌려줬다(2026-08-14 W8).
   *    포털은 '기록되면 도달'인 채널이라 **받을 곳이 없으면 발송이 아니다** —
   *    정본 `modules/crm/crm-channel.service.ts` 의 `sendPortal`(NO_PORTAL_ACCOUNT → success:false)
   *    과 같은 판정으로 수렴한다. 원무 창구는 이 응답을 보고 태블릿 현장 서명으로 전환해야 한다.
   */
  async sendPortalRequest(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, familyName: true, givenName: true },
    });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');

    const account = await this.prisma.patientAccount.findFirst({ where: { patientId } });
    if (!account) {
      // 받을 곳이 없다 — 아무것도 나가지 않았다.
      return {
        success: false,
        delivered: false,
        channel: 'PORTAL',
        reason: 'NO_PORTAL_ACCOUNT',
        message: '환자 포털 계정이 없어 동의 요청이 전송되지 않았습니다 — 포털 가입을 안내하거나 태블릿 현장 서명으로 진행하십시오',
      };
    }

    let pn: { id: string };
    try {
      pn = await this.prisma.patientNotification.create({
        data: {
          accountId: account.id,
          type: 'CONSENT',
          title: '접수 동의서 서명 요청',
          body: `${patient.familyName}${patient.givenName}님, 접수에 필요한 동의서 서명을 완료해주세요.`,
        },
      });
    } catch (err) {
      // 기록 실패는 실패다(fail-open 금지).
      return {
        success: false,
        delivered: false,
        channel: 'PORTAL',
        reason: 'NOTIFICATION_WRITE_FAILED',
        message: `포털 알림 기록에 실패해 동의 요청이 전송되지 않았습니다: ${(err as Error).message}`,
      };
    }

    // 스카우트: 동일 성격의 listener 경유 CONSENT는 FCM 푸시가 가는데 접수 경로만 누락 → 정합
    void this.fcmPush?.pushPatientNotification(pn.id).catch(() => undefined);

    // 이벤트는 실제로 알림이 만들어진 뒤에만 발행한다(종전엔 미발송에도 발행됐다).
    this.eventEmitter?.emit('registration.consent.portal_requested', { patientId, notificationId: pn.id });

    return {
      success: true,
      delivered: true,
      channel: 'PORTAL',
      notificationId: pn.id,
      message: '포털 동의 요청이 전송되었습니다',
    };
  }

  /** 동의서 출력용 HTML 생성 */
  generatePrintHtml(patientName: string, types?: string[]) {
    // XSS 방어: patientName(DB 환자명)은 text/html 로 브라우저 렌더되므로 이스케이프.
    // sections 는 정적 상수(CONSENT_TYPES·getConsentContent)라 사용자 입력 없음.
    const safeName = esc(patientName);
    const targetTypes = types?.length
      ? Object.entries(CONSENT_TYPES).filter(([k]) => types.includes(k))
      : Object.entries(CONSENT_TYPES);

    const sections = targetTypes.map(([type, meta]) => {
      const content = this.getConsentContent(type);
      return `
        <div class="consent-section" style="page-break-inside: avoid; margin-bottom: 24px; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
          <h3 style="margin: 0 0 8px; font-size: 15px; color: #1a1a1a;">${meta.label}</h3>
          <p style="font-size: 11px; color: #666; margin: 0 0 12px;">법적 근거: ${meta.law}</p>
          <div style="font-size: 12px; color: #333; line-height: 1.8;">${content}</div>
          <!-- 🔴 (2026-10-02) 종전엔 '동의합니다' 칸 하나 — 빈칸이 거부인지 빠뜨린 것인지 스캔으로 가를 수 없었다(종이 기록은 스캔을 보고 옮겨 적는다) -->
          <div style="margin-top: 16px; display: flex; gap: 24px; align-items: center;">
            <span style="font-size: 11px; font-weight: bold; color: ${meta.required ? '#b91c1c' : '#555'};">${meta.required ? '[필수]' : '[선택]'}</span>
            <label style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 14px; height: 14px; border: 1px solid #999; border-radius: 2px;"></span>
              동의함
            </label>
            <label style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 14px; height: 14px; border: 1px solid #999; border-radius: 2px;"></span>
              동의하지 않음
            </label>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>초진 동의서</title>
<style>
  @page { margin: 20mm; size: A4; }
  body { font-family: 'Malgun Gothic', sans-serif; color: #333; }
  .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 20px; margin: 0; }
  .header p { font-size: 12px; color: #666; margin: 4px 0 0; }
  .patient-info { margin-bottom: 20px; font-size: 13px; }
  .signature-area { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 20px; }
  .sig-line { display: inline-block; width: 200px; border-bottom: 1px solid #333; margin: 0 8px; }
</style></head>
<body>
  <div class="header">
    <h1>초진 동의서</h1>
    <p>개인정보보호법·의료법에 따른 법정 동의서</p>
  </div>
  <div class="patient-info">
    <strong>환자명:</strong> ${safeName} &nbsp;&nbsp;
    <strong>접수일:</strong> ${new Date().toLocaleDateString('ko')}
  </div>
  ${sections}
  <div class="signature-area">
    <p style="font-size: 13px; margin-bottom: 16px;">위 동의 내용을 충분히 읽고 이해하였으며, 자발적으로 동의합니다.</p>
    <p style="font-size: 13px;">환자 성명: <span class="sig-line"></span> &nbsp; 서명: <span class="sig-line"></span></p>
    <p style="font-size: 13px; margin-top: 12px;">법정대리인 (해당 시): <span class="sig-line"></span> &nbsp; 관계: <span class="sig-line" style="width:100px"></span></p>
    <p style="font-size: 13px; margin-top: 12px;">접수 직원: <span class="sig-line"></span> &nbsp; 일자: ${new Date().toLocaleDateString('ko')}</p>
  </div>
  <p style="font-size: 10px; color: #999; margin-top: 32px; text-align: center;">
    본 동의서는 의료법에 따라 진료일로부터 10년간 보관됩니다. 동의 철회는 원무과 또는 환자 포털에서 가능합니다.
  </p>
</body></html>`;
  }

  private getConsentContent(type: string): string {
    const contents: Record<string, string> = {
      PRIVACY: `<p><b>1. 수집 항목:</b> 성명, 생년월일, 성별, 연락처(전화번호, 이메일), 주소</p>
<p><b>2. 수집·이용 목적:</b> 진료(진찰, 검사, 치료), 처방, 수납, 증명서 발급, 예약 관리</p>
<p><b>3. 보유·이용 기간:</b> 진료일로부터 10년 (의료법 시행규칙 제15조)</p>
<p><b>4. 동의 거부 권리:</b> 동의를 거부할 권리가 있으며, 필수 항목 거부 시 진료가 제한될 수 있습니다.</p>`,
      SENSITIVE: `<p><b>1. 처리 항목:</b> 병력, 진단명(KCD), 검사결과, 처방정보, 영상자료, 유전정보 등 건강에 관한 정보</p>
<p><b>2. 처리 목적:</b> 질병의 진단·치료·예방, 건강관리, 의학적 판단</p>
<p><b>3. 보유 기간:</b> 진료일로부터 10년</p>
<p><b>4. 동의 거부 권리:</b> 동의를 거부할 권리가 있으며, 거부 시 진료 서비스 제공이 제한될 수 있습니다.</p>`,
      UNIQUE_ID: `<p><b>1. 처리 항목:</b> 주민등록번호, 외국인등록번호, 여권번호, 운전면허번호</p>
<p><b>2. 처리 목적:</b> 본인 확인, 건강보험 자격 확인, 보험 청구, 법정 의무기록 기재</p>
<p><b>3. 보유 기간:</b> 진료일로부터 10년</p>
<p><b>4. 동의 거부 권리:</b> 고유식별정보 처리 동의를 거부할 수 있으나, 거부 시 건강보험 적용 및 진료가 제한될 수 있습니다.</p>`,
      THIRD_PARTY: `<p><b>1. 제공 대상:</b> 국민건강보험공단, 건강보험심사평가원, 보험사(환자 요청 시), 국세청, 질병관리청(감염병)</p>
<p><b>2. 제공 목적:</b> 보험 청구, 진료비 정산, 세무 신고, 법정 신고</p>
<p><b>3. 제공 항목:</b> 진료정보, 수납정보, 보험 자격 정보</p>
<p><b>4. 보유 기간:</b> 제공 목적 달성 시 지체 없이 파기</p>
<p><b>5. 동의 거부 권리:</b> 거부 시 건강보험 청구가 제한되어 전액 본인 부담이 발생할 수 있습니다.</p>`,
      TREATMENT: `<p>본원에서 시행하는 의료행위(진찰, 검사, 치료 등)를 받는 것에 동의합니다.</p>
<p>수술, 마취 등 중대한 의료행위에 대해서는 별도의 서면 동의서를 작성합니다.</p>
<p>담당 의료진은 진료 전 충분한 설명을 제공할 의무가 있으며, 환자는 설명을 요구할 권리가 있습니다.</p>`,
      HIE: `<p>의료법 제21조의2에 따라, 본인의 진료기록(진료기록부, 검사결과, 처방정보 등)을 다른 의료기관과 전자적으로 공유하는 것에 동의합니다.</p>
<p>진료정보교류는 전원, 의뢰, 응급 진료 등 환자의 안전한 진료를 위해 활용됩니다.</p>
<p>본 동의는 철회할 수 있으며, 철회 시 교류가 중단됩니다.</p>`,
      MARKETING: `<p>건강검진 안내, 프로모션, 이벤트 등 마케팅 정보를 SMS·Push·이메일로 수신하는 것에 동의합니다.</p>
<p>수신 거부는 언제든 가능하며, 원무과 또는 환자 포털에서 설정할 수 있습니다.</p>
<p>동의하지 않아도 진료에는 영향이 없습니다.</p>`,
      RESEARCH: `<p>비식별 처리된 진료 정보를 학술 연구 및 의학 발전을 위해 활용하는 것에 동의합니다.</p>
<p>개인을 식별할 수 없는 형태로만 사용되며, 동의하지 않아도 진료에 영향이 없습니다.</p>`,
      EMR_VIEW: `<p>환자 포털 또는 모바일 앱에서 본인의 진료기록(검사결과, 처방, 진료내역 등)을 전자적으로 열람하는 것에 동의합니다.</p>`,
      TELEHEALTH: `<p>의료법 제34조에 따른 원격진료(화상 진료, 전화 진료)를 이용하는 것에 사전 동의합니다.</p>
<p>원격진료 시 의료진이 대면 진료의 필요성을 판단할 수 있으며, 필요 시 내원을 안내할 수 있습니다.</p>`,
    };
    return contents[type] ?? '<p>동의 내용</p>';
  }
}
