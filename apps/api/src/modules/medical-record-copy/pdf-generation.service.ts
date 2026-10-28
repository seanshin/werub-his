import { Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { isCriticalFlag, isAbnormalFlag } from '@hospital-run/shared';
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont } from 'pdf-lib';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
// 동의서 content/risks/alternatives·환자명 등(직원·AI·DB 입력)이 text/html 응답으로
// 렌더되므로 Stored XSS 방지를 위해 모든 사용자/AI 유래 값에 적용 (공용 유틸)
import { escapeHtml as esc } from '../../common/util/html-escape';
import { consentReadableSections } from '@hospital-run/shared';

/** pdf-lib 표준 글꼴이 그리지 못하는 글자가 있을 때의 오류 코드 — 화면·테스트가 이 코드로 가른다 */
export const PDF_FONT_UNSUPPORTED_SCRIPT = 'PDF_FONT_UNSUPPORTED_SCRIPT';

const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;

/**
 * 🔴 pdf-lib 표준 글꼴(Helvetica · WinAnsi)로 그릴 수 없는 글자가 하나라도 있으면 **그리기 전에** 501 로 말한다.
 *
 * 종전: 한글이 `drawText`/`widthOfTextAtSize` 에서 `WinAnsi cannot encode "김"` 을 던져 **500 INTERNAL_ERROR** 가 됐다
 *   (2026-09-11 재현 — 환자명·의사명·진단명이 한글이면 전건). 저장소·의존성에 한글 글꼴(.ttf/.otf·@pdf-lib/fontkit)이 없다.
 *   글꼴 바이너리를 지어 넣지 않고, 한글을 '?' 로 바꿔 찍지도 않는다(이름·진단이 '???' 인 사본은 발급 문서가 아니다).
 *   → "서버에 그 기능이 없다"는 사실이므로 501(NotImplemented). 입력을 고쳐서 풀리는 문제가 아니다(422 아님).
 * 글자 자체는 응답에 싣지 않는다(환자명 조각일 수 있다) — 한글인지 아닌지만 말한다.
 */
function assertStandardFontCanDraw(font: PDFFont, texts: readonly string[]): void {
  const charset = new Set(font.getCharacterSet());
  for (const t of texts) {
    for (const ch of t) {
      if (charset.has(ch.codePointAt(0)!)) continue;
      const hangul = HANGUL.test(ch);
      throw new NotImplementedException({
        code: PDF_FONT_UNSUPPORTED_SCRIPT,
        message: hangul
          ? '한글 글꼴 미탑재 — PDF 생성 불가(서버 PDF 는 표준 글꼴만 있어 한글을 그리지 못합니다). HTML 사본(인쇄)으로 발급하세요'
          : '글꼴 미탑재 — PDF 생성 불가(서버 PDF 표준 글꼴이 그리지 못하는 글자가 있습니다). HTML 사본(인쇄)으로 발급하세요',
        script: hangul ? 'HANGUL' : 'OTHER',
      });
    }
  }
}

@Injectable()
export class PdfGenerationService {
  constructor(private readonly prisma: PrismaService) {}

  async generateEncounterPdf(encounterId: string): Promise<string> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        doctor: { select: { familyName: true, givenName: true } },
        diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } },
        prescriptions: { include: { medicationCode: { select: { nameKo: true } }, procedureCode: { select: { nameKo: true } } } },
      },
    });
    if (!encounter) throw new NotFoundException('Encounter not found');

    return this.renderHtml({
      title: '진료기록',
      patient: encounter.patient,
      sections: [
        { label: '진료일', value: encounter.createdAt.toISOString().split('T')[0] },
        { label: '담당의', value: `${encounter.doctor.familyName}${encounter.doctor.givenName}` },
        { label: '주관적 증상 (S)', value: encounter.subjective ?? '-' },
        { label: '객관적 소견 (O)', value: encounter.objective ?? '-' },
        { label: '평가 (A)', value: encounter.assessment ?? '-' },
        { label: '계획 (P)', value: encounter.plan ?? '-' },
        { label: '진단', value: encounter.diagnoses.map(d => `${d.diagnosisCode.code} ${d.diagnosisCode.nameKo}`).join(', ') || '-' },
      ],
    });
  }

  async generateDischargeSummaryPdf(admissionId: string): Promise<string> {
    const summary = await this.prisma.dischargeSummary.findUnique({
      where: { admissionId },
      include: {
        doctor: { select: { familyName: true, givenName: true } },
        admission: { include: { patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } } } },
      },
    });
    if (!summary) throw new NotFoundException('Discharge summary not found');

    return this.renderHtml({
      title: '퇴원요약',
      patient: summary.admission.patient,
      sections: [
        { label: '입원일', value: summary.admitDate.toISOString().split('T')[0] },
        { label: '퇴원일', value: summary.dischargeDate.toISOString().split('T')[0] },
        { label: '담당의', value: `${summary.doctor.familyName}${summary.doctor.givenName}` },
        { label: '입원 시 진단', value: summary.admitDiagnosis },
        { label: '퇴원 시 진단', value: summary.dischargeDiagnosis },
        { label: '입원경과', value: summary.hospitalCourse },
        { label: '퇴원 시 상태', value: summary.conditionAtDischarge },
        { label: '추적관찰 계획', value: summary.followUpPlan },
      ],
    });
  }

  async generateLabResultPdf(labResultId: string): Promise<string> {
    const labResult = await this.prisma.labResult.findUnique({
      where: { id: labResultId },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        technician: { select: { familyName: true, givenName: true } },
        items: true,
      },
    });
    if (!labResult) throw new NotFoundException('Lab result not found');

    const itemRows = labResult.items.map((item: any) => {
      const flag = item.flag && item.flag !== 'N' ? ` (${item.flag})` : '';
      return `${item.testName}: ${item.value} ${item.unit}${flag} [${item.normalMin ?? ''}-${item.normalMax ?? ''}]`;
    }).join('\n');

    return this.renderHtml({
      title: '검사결과',
      patient: labResult.patient,
      sections: [
        { label: '검사일', value: labResult.completedAt?.toISOString().split('T')[0] ?? '-' },
        { label: '검사자', value: `${labResult.technician.familyName}${labResult.technician.givenName}` },
        { label: '검사 항목', value: itemRows || '-' },
        { label: '비고', value: labResult.notes ?? '-' },
      ],
    });
  }

  /**
   * 🔴 (2026-09-16) `patients/:patientId/consents/:consentId/generate-pdf` 는 경로의 환자 id 를 쓰지 않았다 —
   *    다른 환자의 동의서 전문(이름·MRN·생년월일·성별 포함)을 이 경로로 받아볼 수 있었다.
   *    `scopePatientId` 가 주어지면 그 환자의 동의서만 낸다. 소속이 다르면 존재를 알려주지 않는다(404).
   */
  /**
   * @param opts.forSigning 서명 대상 동결용 — 🔴 출력 시각을 넣지 않는다(같은 동의서 = 같은 HTML = 같은 해시 · 중복 요청 멱등)
   */
  async generateConsentFormPdf(consentId: string, scopePatientId?: string, opts: { forSigning?: boolean } = {}): Promise<string> {
    const consent = await this.prisma.consentForm.findFirst({
      where: { id: consentId, ...(scopePatientId ? { patientId: scopePatientId } : {}) },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        doctor: { select: { familyName: true, givenName: true } },
        template: { select: { id: true, name: true, type: true } },
      },
    });
    if (!consent) throw new NotFoundException('Consent form not found');

    // 🔴 (2026-10-12) 종전엔 `content` JSON 을 그대로 덤프했다 — 환자가 서명 화면에서 본 본문과 달랐다(서명 대상이 됐다).
    //    서명 화면과 같은 정본(shared consentReadableSections)으로 본문을 만든다 · 본문이 없으면 지어 채우지 않고 그렇게 적는다.
    const readable = consentReadableSections({ content: consent.content, risks: consent.risks, alternatives: consent.alternatives, explanation: consent.explanation });
    const sections: { label: string; value: string }[] = [
      { label: '동의서 유형', value: consent.template?.type || consent.type || '-' },
      { label: '템플릿명', value: consent.template?.name || consent.templateName || '-' },
      ...(readable.hasBody ? [] : [{ label: '동의서 내용', value: '(본문이 없는 동의서입니다)' }]),
      ...readable.sections.map((x) => ({ label: x.title ?? '동의서 내용', value: x.body })),
    ];

    sections.push(
      { label: '담당의', value: consent.doctor?.familyName && consent.doctor?.givenName
        ? `${consent.doctor.familyName}${consent.doctor.givenName}`
        : '-' },
      { label: '상태', value: consent.status || 'PENDING' },
      { label: '유효성', value: consent.isValid ? '유효' : '취소됨' }
    );

    if (consent.patientSignedAt) {
      sections.push({
        label: '환자 서명일시',
        value: consent.patientSignedAt.toISOString().replace('T', ' ').slice(0, 19)
      });
      // 🔴 (A1) 서명의 증거를 밝힌다 — 2026-10-13 전 직원 경로는 이름만으로 서명됐다(증거 없음을 그대로 말한다)
      sections.push({
        label: '환자 서명 방식',
        value: consent.signMode === 'PAPER' ? '종이 서명(스캔본 별첨)'
          : consent.patientSignature ? '서명패드'
          : '서명 증거 없음(이름만 기록된 이전 서명)',
      });
    }

    return this.renderConsentHtml({
      title: '의료 동의서',
      patient: consent.patient,
      consentType: consent.template?.type || consent.type || 'GENERAL',
      status: consent.status || 'PENDING',
      isValid: consent.isValid,
      sections,
      issuedAt: opts.forSigning ? null : new Date(),
    });
  }

  /**
   * 🔴 발급 문서 헤더의 병원 정체 — 정본 system_configs `hospital.*`.
   *    종전엔 'Hospital RUN 의료원·테헤란로 123·02-1234-5678' 이 하드코딩이었다(실병원과 다른 날조).
   *    미설정이면 지어내지 않고 비운다.
   */
  private async hospitalIdentity(): Promise<{ name: string; line: string }> {
    const [name, addr, phone] = await Promise.all([this.cfgString('hospital.name'), this.cfgString('hospital.address'), this.cfgString('hospital.phone')]);
    return { name, line: [addr, phone ? `TEL: ${phone}` : ''].filter(Boolean).join(' | ') };
  }

  /** 발급 문서 헤더용 설정값 — DB 행만(DEFAULTS 플레이스홀더로 떨어지지 않는다). 없으면 '' */
  private async cfgString(key: string): Promise<string> {
    const v = (await this.prisma.systemConfig.findUnique({ where: { key } }))?.value;
    return typeof v === 'string' ? v.trim() : '';
  }

  /**
   * 🔴 영문 PDF(pdf-lib Helvetica) 헤더의 병원 정체 — 같은 정본 `hospital.*` 의 **영문 키**.
   *    종전엔 'Hospital RUN Medical Center · Seoul, Gangnam-gu, Teheran-ro 123 · 02-1234-5678' 이
   *    하드코딩이었다 — 같은 파일의 HTML 경로(`hospitalIdentity`)는 이미 정본을 읽는데 이 경로만 날조가 남았다.
   *
   *    국문 `hospital.name` 으로 폴백하지 않는다: Helvetica(WinAnsi)는 한글을 인코딩하지 못해
   *    `drawText` 가 예외를 던진다(발급 자체가 500). 로마자로 옮겨 적는 것은 지어내는 것이다.
   *    → 영문명이 없으면 **없다고** 찍는다(`HOSPITAL_NAME_EN_UNSET`). 주소·전화는 있는 것만 싣는다.
   */
  private async hospitalIdentityEn(): Promise<{ name: string; line: string }> {
    const [nameEn, addrEn, phone] = await Promise.all([this.cfgString('hospital.nameEn'), this.cfgString('hospital.addressEn'), this.cfgString('hospital.phone')]);
    return {
      name: nameEn || PdfGenerationService.HOSPITAL_NAME_EN_UNSET,
      line: [addrEn, phone ? `TEL: ${phone}` : ''].filter(Boolean).join(' | '),
    };
  }

  /** 영문 기관명 미설정 표지 — WinAnsi 로 찍을 수 있는 ASCII 만 쓴다 */
  static readonly HOSPITAL_NAME_EN_UNSET = '[Institution name not configured: hospital.nameEn]';

  private async renderConsentHtml(data: {
    title: string;
    patient: any;
    consentType: string;
    status: string;
    isValid: boolean;
    sections: { label: string; value: string }[];
    /** 출력 시각 — `null` 이면 적지 않는다(서명 대상 동결용) */
    issuedAt?: Date | null;
  }): Promise<string> {
    const gender = data.patient.gender === 'MALE' ? '남' : data.patient.gender === 'FEMALE' ? '여' : '';
    const hosp = await this.hospitalIdentity();
    const statusBadge = data.status === 'SIGNED'
      ? '<span style="background: #4CAF50; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;">✓ 서명완료</span>'
      : data.status === 'REVOKED'
      ? '<span style="background: #f44336; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;">✗ 취소됨</span>'
      : '<span style="background: #FFC107; color: #333; padding: 4px 8px; border-radius: 4px; font-weight: bold;">⊙ 대기중</span>';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: 'Noto Sans KR', sans-serif; padding: 40px; font-size: 13px; position: relative; line-height: 1.6; }
  .header { text-align: center; border-bottom: 3px solid #333; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; margin: 0; font-weight: 700; }
  .header p { color: #666; margin: 4px 0 0; font-size: 12px; }
  .status-bar { display: flex; justify-content: space-between; align-items: center; background: #f9f9f9; padding: 12px; border-radius: 8px; margin-bottom: 16px; }
  .consent-type { font-weight: 700; color: #333; }
  .patient-info { background: #f5f5f5; padding: 12px; border-radius: 8px; margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .patient-info span { font-size: 13px; }
  .patient-label { font-weight: 700; color: #333; }
  .section { margin-bottom: 16px; page-break-inside: avoid; }
  .section-label { font-weight: 700; color: #333; font-size: 13px; margin-bottom: 6px; background: #e8f4f8; padding: 4px 8px; border-left: 4px solid #2196F3; }
  .section-value { white-space: pre-wrap; line-height: 1.6; padding: 8px 0; color: #555; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 80px; color: rgba(0,0,0,0.05); font-weight: bold; pointer-events: none; z-index: 0; }
  .footer { margin-top: 40px; border-top: 2px solid #ccc; padding-top: 12px; font-size: 11px; color: #999; text-align: center; }
  .legal-notice { background: #fff3cd; border-left: 4px solid #ff9800; padding: 8px; margin: 16px 0; font-size: 12px; }
  @media print { body { padding: 20px; } .watermark { display: block; } }
</style></head><body>
  <div class="watermark">${/* 🔴 종전 isValid 만 보고 서명 전 문서에도 '서명완료'를 찍었다 */ data.status === 'SIGNED' && data.isValid ? '서명완료' : data.status === 'REVOKED' || !data.isValid ? '취소됨' : '서명 전'}</div>
  <div class="header">
    <h1>${esc(hosp.name)}</h1>
    <p>${esc(hosp.line)}</p>
  </div>
  <h2 style="text-align:center; margin-bottom:8px; font-size:18px;">${data.title}</h2>
  <div class="status-bar">
    <span class="consent-type">동의서 유형: ${esc(data.consentType)}</span>
    <span>${statusBadge}</span>
  </div>
  <div class="patient-info">
    <span><span class="patient-label">환자명:</span> ${esc(data.patient.familyName)}${esc(data.patient.givenName)}</span>
    <span><span class="patient-label">등록번호:</span> ${esc(data.patient.mrn)}</span>
    <span><span class="patient-label">생년월일:</span> ${data.patient.dateOfBirth?.toISOString?.().split('T')[0] ?? ''}</span>
    <span><span class="patient-label">성별:</span> ${gender}</span>
  </div>
  <div class="legal-notice">
    <strong>⚠ 법적 고지:</strong> 본 동의서는 의료법 제24조 제1항에 따른 의료행위 시행 전 환자(또는 보법자)의 서면 동의서입니다. 동의서가 없거나 무효인 경우 의료행위는 불법입니다.
  </div>
  ${data.sections.map(s => `<div class="section"><div class="section-label">${esc(s.label)}</div><div class="section-value">${esc(s.value)}</div></div>`).join('')}
  <div class="footer">
    ${data.issuedAt === null ? '' : `<p>출력일시: ${(data.issuedAt ?? new Date()).toISOString().replace('T', ' ').slice(0, 19)}</p>`}
    <p>본 문서는 Hospital RUN 시스템에서 출력되었습니다.</p>
  </div>
</body></html>`;
  }

  /**
   * PDF Buffer 생성 — pdf-lib 기반 실제 PDF 파일
   */
  async generatePdfBuffer(data: {
    title: string;
    patient: { mrn: string; familyName: string; givenName: string; dateOfBirth?: Date | null; gender?: string };
    sections: { label: string; value: string }[];
  }): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let page = pdf.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    // Header — 병원 정체는 정본(hospital.nameEn·addressEn·phone). 미설정은 지어내지 않는다(hospitalIdentityEn)
    const hosp = await this.hospitalIdentityEn();

    // 🔴 그릴 글자를 **먼저** 전부 검사한다 — 중간에 던지면 500, '?' 로 바꾸면 날조다(assertStandardFontCanDraw)
    const gender = data.patient.gender === 'MALE' ? 'M' : data.patient.gender === 'FEMALE' ? 'F' : '';
    const dob = data.patient.dateOfBirth?.toISOString?.().split('T')[0] ?? '';
    const patientLine = `${data.patient.familyName}${data.patient.givenName} | MRN: ${data.patient.mrn} | DOB: ${dob} | ${gender}`;
    assertStandardFontCanDraw(font, [
      hosp.name, hosp.line, data.title, patientLine,
      ...data.sections.flatMap((s) => [s.label, ...(s.value || '-').split('\n')]),
    ]);

    page.drawText(hosp.name, { x: margin, y, font: fontBold, size: 16, color: rgb(0.1, 0.1, 0.1) });
    y -= 20;
    if (hosp.line) page.drawText(hosp.line, { x: margin, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) });
    y -= 10;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2, color: rgb(0.2, 0.2, 0.2) });
    y -= 25;

    // Title
    const titleWidth = fontBold.widthOfTextAtSize(data.title, 14);
    page.drawText(data.title, { x: (width - titleWidth) / 2, y, font: fontBold, size: 14 });
    y -= 30;

    // Patient info
    page.drawRectangle({ x: margin, y: y - 5, width: width - 2 * margin, height: 20, color: rgb(0.95, 0.95, 0.95) });
    page.drawText(patientLine, { x: margin + 8, y, font, size: 9 });
    y -= 30;

    // Sections
    for (const section of data.sections) {
      if (y < 80) {
        page = pdf.addPage([595, 842]);
        y = height - margin;
      }
      page.drawText(section.label, { x: margin, y, font: fontBold, size: 10, color: rgb(0.2, 0.2, 0.2) });
      y -= 14;

      const lines = (section.value || '-').split('\n');
      for (const line of lines) {
        if (y < 60) { page = pdf.addPage([595, 842]); y = height - margin; }
        const trimmed = line.length > 90 ? line.substring(0, 90) + '...' : line;
        page.drawText(trimmed, { x: margin + 8, y, font, size: 9, color: rgb(0.3, 0.3, 0.3) });
        y -= 13;
      }
      y -= 8;
    }

    // Footer
    page.drawLine({ start: { x: margin, y: 50 }, end: { x: width - margin, y: 50 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    const footerText = `Issued: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} | Hospital RUN HIS`;
    page.drawText(footerText, { x: margin, y: 38, font, size: 7, color: rgb(0.6, 0.6, 0.6) });

    // Watermark
    page.drawText('COPY', {
      x: 180, y: 350, font: fontBold, size: 72,
      color: rgb(0.9, 0.9, 0.9), rotate: degrees(45),
    });

    const pdfBytes = await pdf.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * 진료기록 PDF Buffer 반환
   */
  async getEncounterPdfBuffer(encounterId: string): Promise<Buffer> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        doctor: { select: { familyName: true, givenName: true } },
        diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } },
        prescriptions: { include: { medicationCode: { select: { nameKo: true } }, procedureCode: { select: { nameKo: true } } } },
      },
    });
    if (!encounter) throw new NotFoundException('Encounter not found');

    return this.generatePdfBuffer({
      title: 'Medical Record',
      patient: encounter.patient,
      sections: [
        { label: 'Date', value: encounter.createdAt.toISOString().split('T')[0] },
        { label: 'Doctor', value: `${encounter.doctor.familyName}${encounter.doctor.givenName}` },
        { label: 'Subjective', value: encounter.subjective ?? '-' },
        { label: 'Objective', value: encounter.objective ?? '-' },
        { label: 'Assessment', value: encounter.assessment ?? '-' },
        { label: 'Plan', value: encounter.plan ?? '-' },
        { label: 'Diagnoses', value: encounter.diagnoses.map(d => `${d.diagnosisCode.code} ${d.diagnosisCode.nameKo}`).join('\n') || '-' },
      ],
    });
  }

  /** 건강검진 결과서 PDF 생성 */
  async generateCheckupResultPdf(visitId: string): Promise<string> {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      include: {
        patient: { select: { mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        program: { select: { name: true } },
        items: { orderBy: { createdAt: 'asc' } },
        summary: true,
      },
    });
    if (!visit) throw new NotFoundException('검진 기록을 찾을 수 없습니다.');

    /**
     * 🔴 (2026-09-03) 이 표가 `Record<string, unknown>` 캐스팅 뒤에서 **없는 키**를 읽고 있었다 —
     *    `normalMin/normalMax`(실제 `referenceRange`) → 참고치 전건 `-`,
     *    `flag`(실제 `finding`) → grade 없는 항목은 **CRITICAL 도 '정상'으로 인쇄**,
     *    `findings/content`(실제 `doctorOpinion`) → 종합 소견 전건 `-`.
     *    법정 발급 문서다. 캐스팅을 걷어 키 오타가 tsc 에서 터지게 한다(계약 드리프트 기전 1).
     */
    const FINDING_LABEL: Record<string, string> = {
      NORMAL: '정상', ABNORMAL: '이상', CRITICAL: '위급', PENDING: '판정 대기', NOT_APPLICABLE: '해당 없음',
    };
    const resultRows = (visit.items ?? []).map((r) => {
      const name = r.testName;
      const value = r.value ?? '-';
      const unit = r.unit ?? '';
      const refRange = r.referenceRange ?? '-';
      const finding = r.finding;
      const isCritical = finding === 'CRITICAL' || isCriticalFlag(finding);
      const isAbn = !isCritical && (finding === 'ABNORMAL' || (finding !== 'NORMAL' && isAbnormalFlag(finding) && finding !== '정상'));
      const flagStyle = isCritical ? 'color:red;font-weight:bold;text-decoration:underline' : isAbn ? 'color:red;font-weight:bold' : '';
      // 모르는 판정 어휘는 지어내지 않고 원문 그대로 — grade(A~D2)는 판정이 아니라 등급이라 병기만
      const findingText = (FINDING_LABEL[finding] ?? finding) + (r.grade ? ` (${r.grade})` : '');
      // 🔴 이 표는 html:true 섹션으로 나간다 — 사용자 유래 값은 여기서 esc() 할 책임이 있다
      return `<tr><td>${esc(name)}</td><td style="${flagStyle}">${esc(value)} ${esc(unit)}</td><td>${esc(refRange)}</td><td style="${flagStyle}">${esc(findingText)}</td></tr>`;
    }).join('');

    const overallGrade = visit.summary?.overallGrade ?? '-';
    const findings = visit.summary?.doctorOpinion ?? '-';
    const recArr = Array.isArray(visit.summary?.recommendations) ? (visit.summary?.recommendations as unknown[]).map(String) : null;
    const recommendations = recArr && recArr.length ? recArr.join('\n') : '-';

    const sections = [
      { label: '검진 프로그램', value: visit.program?.name ?? '-' },
      { label: '검진일', value: visit.scheduledDate?.toISOString().split('T')[0] ?? '-' },
      // 🔴 html:true — 서버 조립 마크업. 이스케이프 렌더러가 표를 소스 문자열로 인쇄하던 결함(2026-09-03 운영 실측)
      { label: '검사 결과', html: true, value: `<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:#f0f0f0;"><th style="text-align:left;padding:6px;border:1px solid #ddd;">항목</th><th style="text-align:left;padding:6px;border:1px solid #ddd;">결과</th><th style="text-align:left;padding:6px;border:1px solid #ddd;">참고치</th><th style="text-align:left;padding:6px;border:1px solid #ddd;">판정</th></tr></thead><tbody>${resultRows || '<tr><td colspan="4">결과 없음</td></tr>'}</tbody></table>` },
      { label: '종합 판정', html: true, value: `<span style="font-size:16px;font-weight:bold;color:${overallGrade === 'A' || overallGrade === '정상' ? 'green' : overallGrade === 'D' || overallGrade === 'R' ? 'red' : 'orange'}">${esc(overallGrade)}</span>` },
      { label: '종합 소견', value: findings },
      { label: '권고 사항', value: recommendations },
    ];

    return this.renderHtml({
      title: '건강검진 결과서',
      patient: visit.patient,
      sections,
    });
  }

  /**
   * HTML 문자열 → PDF 바이너리 (pdf-lib 기반)
   * HTML 태그를 파싱하여 pdf-lib로 텍스트 기반 PDF 생성
   */
  async htmlToPdfBuffer(html: string): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // HTML → 평문 텍스트 변환 (태그 제거)
    const stripHtml = (s: string) => s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|tr|li|h[1-6])[^>]*>/gi, '\n')
      // 🔴 칸 구분은 공백 두 칸 — 종전 '\t' 는 표준 글꼴이 그리지 못하는 제어 문자라 표가 있으면 영문만으로도 500 이었다
      .replace(/<\/?(td|th)[^>]*>/gi, '  ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const text = stripHtml(html);
    const lines = text.split('\n');
    // 🔴 그리기 전에 전부 검사(한글이면 501 "한글 글꼴 미탑재") — 종전엔 widthOfTextAtSize 가 먼저 던져 500 이었다
    assertStandardFontCanDraw(font, lines.map((l) => l.trim()));

    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 50;
    const lineHeight = 14;
    const maxWidth = pageWidth - margin * 2;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { y -= lineHeight * 0.5; continue; }

      // 줄바꿈이 필요한 긴 텍스트는 잘라서 출력
      const isTitle = trimmed.includes('의료원') || trimmed.includes('결과서') || trimmed.includes('종합');
      const fontSize = isTitle ? 12 : 10;
      const currentFont = isTitle ? fontBold : font;
      const textWidth = currentFont.widthOfTextAtSize(trimmed, fontSize);
      const wrappedLines = textWidth > maxWidth
        ? this.wrapText(trimmed, currentFont, fontSize, maxWidth)
        : [trimmed];

      for (const wl of wrappedLines) {
        if (y < margin + lineHeight) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }

        // 🔴 종전 catch 는 실패하면 한글을 '?' 로 바꿔 다시 찍었다(이름·진단이 '???' 인 문서) — 위 사전 검사로 대체.
        //    사전 검사를 지난 뒤의 실패는 삼키지 않는다(전파).
        page.drawText(wl, { x: margin, y, size: fontSize, font: currentFont, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight;
      }
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  private wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      try {
        if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
          current = test;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      } catch {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [text];
  }

  /**
   * 🔴 (2026-09-03 운영 실측) `esc(s.value)` 가 서버 조립 마크업(검사 결과 표)까지 이스케이프해
   *    검진 결과서가 표 대신 **HTML 소스 문자열**을 인쇄하고 있었다(개통 이래).
   *    `html: true` 섹션만 마크업으로 렌더 — 그 마크업을 만드는 쪽이 사용자 유래 값을 esc() 할 책임을 진다.
   * 🔴 헤더의 병원명·주소·전화가 날조('Hospital RUN 의료원·테헤란로 123')였다 — 발급 문서다.
   *    정본 system_configs `hospital.*` 를 읽고, 미설정이면 지어내지 않고 비운다.
   */
  private async renderHtml(data: { title: string; patient: any; sections: { label: string; value: string; html?: boolean }[] }): Promise<string> {
    const gender = data.patient.gender === 'MALE' ? '남' : data.patient.gender === 'FEMALE' ? '여' : '';
    const hosp = await this.hospitalIdentity();
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: 'Noto Sans KR', sans-serif; padding: 40px; font-size: 12px; position: relative; }
  .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 20px; margin: 0; }
  .header p { color: #666; margin: 4px 0 0; font-size: 11px; }
  .patient-info { background: #f5f5f5; padding: 12px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 24px; }
  .patient-info span { font-size: 11px; }
  .section { margin-bottom: 12px; }
  .section-label { font-weight: 700; color: #333; font-size: 11px; margin-bottom: 2px; }
  .section-value { white-space: pre-wrap; line-height: 1.6; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 80px; color: rgba(0,0,0,0.05); font-weight: bold; pointer-events: none; z-index: 0; }
  .footer { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 12px; font-size: 10px; color: #999; text-align: center; }
</style></head><body>
  <div class="watermark">사 본</div>
  <div class="header">
    <h1>${esc(hosp.name)}</h1>
    <p>${esc(hosp.line)}</p>
  </div>
  <h2 style="text-align:center; margin-bottom:20px;">${data.title}</h2>
  <div class="patient-info">
    <span>환자명: ${esc(data.patient.familyName)}${esc(data.patient.givenName)}</span>
    <span>등록번호: ${esc(data.patient.mrn)}</span>
    <span>생년월일: ${data.patient.dateOfBirth?.toISOString?.().split('T')[0] ?? ''}</span>
    <span>성별: ${gender}</span>
  </div>
  ${data.sections.map(s => `<div class="section"><div class="section-label">${esc(s.label)}</div><div class="section-value">${s.html ? s.value : esc(s.value)}</div></div>`).join('')}
  <div class="footer">
    발급일시: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} | 이 문서는 Hospital RUN 시스템에서 발급되었습니다.
  </div>
</body></html>`;
  }
}
