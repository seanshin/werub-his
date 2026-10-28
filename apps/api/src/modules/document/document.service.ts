import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { readHospitalConfig } from '../config/hospital-facts';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { HTML_SNAPSHOT_TYPES, ISSUED_DOCUMENT_TYPE_LABEL, documentTypeOfIssueNo, hasServerPrintForm, isPhysicianIssuedDocumentType, isServerBuiltDocumentType, joinPatientName, type ServerBuiltDocumentType } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { IssueDocumentDto } from './dto/issue-document.dto';
import { publicBaseUrl } from '../../common/util/public-url';
import { localDateKey } from '../../common/day-range';

import { DEV_SECRET_LITERALS } from '../../common/release-security';

/** RFC 4648 base32(패딩 없음) — 확인 코드는 사람이 옮겨 적을 수도 있어 헷갈리는 소문자·0/1 이 없는 글자로 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf: Buffer): string {
  let bits = 0; let value = 0; let out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * 발급번호 날짜 — 🔴 한국(병원) 날짜(2026-10-12 기획 G12).
 * 종전 `toISOString()` 은 UTC 라 한국 시간 08:30 발급이 전날 번호로 찍혔다. 프로세스 TZ(pm2 `TZ=Asia/Seoul`)를 따른다.
 * 🔴 이미 발급된 번호는 바꾸지 않는다(종이에 찍혔다 — 일어난 사실은 소급하지 않는다).
 */
export const issueDateKey = (now: Date = new Date()) => localDateKey(now).replace(/-/g, '');

/** 확인 코드 길이 — HMAC base32 앞 10자(50비트) */
export const CHECK_CODE_LENGTH = 10;

/** 인쇄 렌더러(`app/print/[issueNo]`)가 문서를 다 그렸다는 표식 — 서버 PDF 는 이것을 기다린다(A5) */
export const PRINT_READY_SELECTOR = 'div[data-print-ready=ok]';

/** 서식 머리 기관 정보 키(C6) — system_configs 행만 · 행이 없으면 null */
export const HOSPITAL_FORM_KEYS = ['hospital.name', 'hospital.code', 'hospital.bizNo', 'hospital.ceo', 'hospital.address', 'hospital.phone', 'hospital.fax'] as const;

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  constructor(private readonly prisma: PrismaService) {}

  private base() { return publicBaseUrl(); }

  /** QR 이미지(data URL) 생성 — 진위검증 URL 인코딩. 실패 시 undefined(슬롯 폴백) */
  private async qrDataUrl(url: string): Promise<string | undefined> {
    try { return await QRCode.toDataURL(url, { margin: 1, width: 120 }); } catch { return undefined; }
  }

  // ── 확인 코드(G14 — 번호 열거 방지) ──
  // 서버 생성 종류는 발급번호만으로 답하지 않는다. 저장 컬럼 없이 서버 비밀로 다시 만든다(스키마 변경 없음).
  // 🔴 비밀을 회전하면 옛 종이의 코드가 무효가 된다 → 회전 기간엔 `DOC_VERIFY_SECRET_PREVIOUS` 로 이전 비밀도 받는다.
  private verifySecrets(): string[] {
    const cur = process.env.DOC_VERIFY_SECRET || process.env.PDF_RENDER_SECRET || DEV_SECRET_LITERALS.PDF_RENDER_SECRET;
    const prev = process.env.DOC_VERIFY_SECRET_PREVIOUS;
    return prev ? [cur, prev] : [cur];
  }
  private codeWith(secret: string, issueNo: string) {
    return base32(crypto.createHmac('sha256', secret).update(`verify.${issueNo}`).digest()).slice(0, CHECK_CODE_LENGTH);
  }
  checkCode(issueNo: string): string { return this.codeWith(this.verifySecrets()[0], issueNo); }
  checkCodeMatches(issueNo: string, v?: string | null): boolean {
    if (!v) return false;
    const got = Buffer.from(v.trim().toUpperCase());
    return this.verifySecrets().some((s) => {
      const exp = Buffer.from(this.codeWith(s, issueNo));
      return got.length === exp.length && crypto.timingSafeEqual(got, exp);
    });
  }
  /** 진위 확인 주소 — 서버 생성 종류는 확인 코드를 붙인다(기존 종류는 종이에 찍힌 QR 호환을 위해 그대로) */
  private verifyUrlOf(issueNo: string, documentType: string) {
    const base = `${this.base()}/verify/document/${issueNo}`;
    return isServerBuiltDocumentType(documentType) ? `${base}?v=${this.checkCode(issueNo)}` : base;
  }

  /**
   * 문서 발급(범용 EP) — 스냅샷 동결 + 발급번호(동시성 채번) + 해시
   * 🔴 서버가 원장에서 만드는 종류(결정 대장 등)는 받지 않는다(G2·G13) — 클라이언트 본문으로 진본 번호를 받는 위조 경로였다.
   */
  /**
   * @param opts.preSigned 서버가 만든 의사 서명 문서(서류 발급 업무 — 의사가 작성·서명 → 원무·의무기록이 발급).
   *   🔴 (2026-10-13 v4.82 회귀 봉합) 이 경로는 발급자가 의사가 아니고 근거가 진료기록이 아니다(요청 id) — 의사 발급 규칙은
   *   **서명한 의사**로 판정한다(발급자 아님). 범용 EP 는 이 값을 넘길 수 없다(컨트롤러가 본문을 넘기지 않는다).
   */
  async issue(dto: IssueDocumentDto, issuedBy?: string, opts?: { preSigned?: { signerUserId: string } }) {
    if (isServerBuiltDocumentType(dto.documentType)) {
      throw new BadRequestException({ code: 'DOCUMENT_TYPE_SERVER_BUILT', message: '서버가 원장에서 만드는 문서 종류입니다 — 전용 발급 경로를 쓰세요', details: { documentType: dto.documentType } });
    }
    // 등록되지 않은 종류는 막지 않고 남긴다(운영 종류를 먼저 센 뒤 정한다 — 기획 §5)
    if (!ISSUED_DOCUMENT_TYPE_LABEL[dto.documentType]) this.logger.warn(`등록되지 않은 문서 종류 발급: ${dto.documentType}`);
    let snapshot: Record<string, unknown>;
    if (!isPhysicianIssuedDocumentType(dto.documentType)) snapshot = dto.snapshot ?? {};
    else if (opts?.preSigned) {
      const signer = await this.prisma.user.findUnique({ where: { id: opts.preSigned.signerUserId }, select: { role: true } });
      if (signer?.role !== 'DOCTOR') throw new ForbiddenException({ code: 'PHYSICIAN_DOCUMENT_ROLE', message: '진단서·소견서·사망진단서는 의사가 서명한 것만 발급할 수 있습니다' });
      snapshot = dto.snapshot ?? {};
    } else snapshot = await this.physicianSnapshot(dto, issuedBy);
    const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const r = await this.persist({ documentType: dto.documentType, sourceId: dto.sourceId, patientId: dto.patientId ?? null, snapshot, formVersion: dto.formVersion ?? 'v1', hash }, issuedBy);
    // 서버가 고쳐 쓴 스냅샷을 돌려준다 — 화면은 발급된 판을 그려야 종이 = 원장이다
    return { ...r, snapshot };
  }

  /**
   * 의사 발급 문서(A4) — 🔴 발급자는 의사 · 서명 의사·면허는 **발급한 의사 본인**(화면이 보낸 이름이 아니다) · 발급일 = 오늘.
   * 진단서는 진단·진단일도 원장에서 — 서명된 진료기록의 진단만(작성 중 기록의 진단을 증명하지 않는다) · 환자 일치.
   * 화면 입력(용도·향후 소견·발병일)만 받는다. 발병일을 진료일로 채우지 않는다(모르면 비운다).
   */
  private async physicianSnapshot(dto: IssueDocumentDto, issuedBy?: string): Promise<Record<string, unknown>> {
    const user = issuedBy ? await this.prisma.user.findUnique({ where: { id: issuedBy }, select: { role: true, familyName: true, givenName: true } }) : null;
    if (!user || user.role !== 'DOCTOR') {
      throw new ForbiddenException({ code: 'PHYSICIAN_DOCUMENT_ROLE', message: '진단서·소견서·사망진단서는 의사만 발급할 수 있습니다' });
    }
    const staff = await this.prisma.staff.findUnique({ where: { userId: issuedBy! }, select: { licenseNumber: true } });
    const snap = { ...(dto.snapshot ?? {}) };
    snap.doctor = { name: joinPatientName(user.familyName, user.givenName), license: staff?.licenseNumber ?? null };
    snap.issuedAt = new Date().toISOString();
    if (dto.documentType === 'CERTIFICATE') {
      const enc = await this.prisma.encounter.findUnique({
        where: { id: dto.sourceId },
        select: { patientId: true, status: true, signedAt: true, createdAt: true, diagnoses: { orderBy: { rank: 'asc' }, select: { diagnosisCode: { select: { code: true, nameKo: true } } } } },
      });
      if (!enc) throw new NotFoundException({ code: 'CERTIFICATE_ENCOUNTER_NOT_FOUND', message: '진단서의 근거 진료기록을 찾을 수 없습니다' });
      if (dto.patientId && enc.patientId !== dto.patientId) throw new BadRequestException({ code: 'CERTIFICATE_PATIENT_MISMATCH', message: '진료기록의 환자와 발급 대상 환자가 다릅니다' });
      if (enc.status !== 'SIGNED' || !enc.signedAt) throw new ConflictException({ code: 'CERTIFICATE_ENCOUNTER_UNSIGNED', message: '서명된 진료기록만 진단서로 발급할 수 있습니다' });
      snap.diagnoses = enc.diagnoses.map((d) => ({ kcdCode: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo }));
      snap.diagnosedDate = enc.createdAt.toISOString(); // 진단일 = 진료일(서명일이 아니다)
      const onset = typeof snap.onsetDate === 'string' && snap.onsetDate.trim() ? snap.onsetDate.trim() : null;
      snap.onsetDate = onset;
    }
    return snap;
  }

  /**
   * 서버 생성 문서 발급 — 스냅샷·해시는 **호출한 서버 코드가** 원장에서 만든 것(본문을 받지 않는다).
   * 채번·동결은 범용 발급과 같은 경로를 쓴다(옆에 약한 것을 만들지 않는다).
   */
  async issueBuilt(documentType: ServerBuiltDocumentType, sourceId: string, snapshot: Record<string, unknown>, hash: string, issuedBy?: string) {
    return this.persist({ documentType, sourceId, patientId: null, snapshot, formVersion: 'v1', hash }, issuedBy);
  }

  private async persist(
    d: { documentType: string; sourceId: string; patientId: string | null; snapshot: Record<string, unknown>; formVersion: string; hash: string },
    issuedBy?: string,
  ) {
    const dateKey = issueDateKey();
    for (let attempt = 0; attempt < 4; attempt++) {
      // 채번: MAX(seq)+1(단조 증가). count+1 은 삭제 시 번호 재사용→issueNo 충돌(외부 sign 멱등키 오염) 위험.
      const agg = await this.prisma.issuedDocument.aggregate({ where: { documentType: d.documentType, dateKey }, _max: { seq: true } });
      const seq = (agg._max.seq ?? 0) + 1;
      const issueNo = `WRB-${d.documentType}-${dateKey}-${String(seq).padStart(4, '0')}`;
      try {
        const doc = await this.prisma.issuedDocument.create({
          data: {
            issueNo, documentType: d.documentType, sourceId: d.sourceId, patientId: d.patientId,
            snapshotJson: d.snapshot as object, formVersion: d.formVersion, hash: d.hash,
            status: 'ORIGINAL', dateKey, seq, issuedBy: issuedBy ?? null,
          },
        });
        const qrUrl = this.verifyUrlOf(doc.issueNo, doc.documentType);
        return {
          issueNo: doc.issueNo, status: doc.status, issuedAt: doc.issuedAt, hash: doc.hash,
          qrUrl, qrDataUrl: await this.qrDataUrl(qrUrl),
        };
      } catch (e) {
        if (attempt === 3) throw e; // unique 충돌(동시 발급) → 재시도
      }
    }
    throw new Error('발급번호 채번 실패');
  }

  /** 진위 확인 주소·QR — 이미 발급된 번호에 대해(재인쇄) */
  async verifyUrl(issueNo: string) {
    const qrUrl = this.verifyUrlOf(issueNo, documentTypeOfIssueNo(issueNo) ?? '');
    return { qrUrl, qrDataUrl: await this.qrDataUrl(qrUrl) };
  }

  /**
   * 공개 진위검증 — PHI 미노출(발급정보·유효성만)
   * 🔴 (2026-09-30) 기관명을 상수('위루비병원')로 박아 두었다 — 설정 `hospital.name` 을 읽고, 없으면 null(지어내지 않는다).
   *    내용이 바뀌어 대체된 발급(`SUPERSEDED` — 처방전 재발급)은 무효로 답한다(이전 종이를 받지 않도록).
   */
  async verify(issueNo: string, v?: string) {
    /**
     * 🔴 서버 생성 종류(결정 대장 등)는 확인 코드가 맞을 때만 답한다(G14) — 원장 조회 **전에** 판정해
     *    번호가 있는지 없는지도 드러내지 않는다. 사유는 "기록 없음"과 갈라 말한다(오타·위조를 구분).
     */
    if (isServerBuiltDocumentType(documentTypeOfIssueNo(issueNo)) && !this.checkCodeMatches(issueNo, v)) {
      return { valid: false, issueNo, reason: 'CHECK_CODE' as const, message: '확인 코드 불일치' };
    }
    const doc = await this.prisma.issuedDocument.findUnique({
      where: { issueNo },
      select: { issueNo: true, documentType: true, issuedAt: true, status: true, hash: true },
    });
    if (!doc) return { valid: false, issueNo, reason: 'NOT_FOUND' as const, message: '발급 기록 없음' };
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'hospital.name' }, select: { value: true } });
    const name = typeof cfg?.value === 'string' && cfg.value.trim() ? cfg.value.trim() : null;
    const valid = doc.status !== 'VOID' && doc.status !== 'SUPERSEDED';
    return {
      valid,
      ...(valid ? {} : { reason: doc.status as 'VOID' | 'SUPERSEDED' }),
      issueNo: doc.issueNo, documentType: doc.documentType, issuedAt: doc.issuedAt, status: doc.status,
      hospital: name,
    };
  }

  // ── 서버 PDF (헤드리스 browserless) ──
  private pdfBase() { return process.env.PDF_SERVICE_URL || 'http://localhost:3505'; }
  // 🔴 개발 비밀 폴백은 정본 상수 하나로(`release-security.ts`) — REAL 빌드는 이 값으로 떨어지기 전에 부팅을 거부한다(T4-1).
  private pdfToken() { return process.env.PDF_SERVICE_TOKEN || DEV_SECRET_LITERALS.PDF_SERVICE_TOKEN; }
  private renderSecret() { return process.env.PDF_RENDER_SECRET || DEV_SECRET_LITERALS.PDF_RENDER_SECRET; }

  /** 인쇄 페이지용 단기 렌더 토큰(HMAC, 2분) */
  private renderToken(issueNo: string) {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const sig = crypto.createHmac('sha256', this.renderSecret()).update(`${issueNo}.${exp}`).digest('hex');
    return `${exp}.${sig}`;
  }
  private verifyRenderToken(issueNo: string, token?: string): boolean {
    if (!token) return false;
    const [expStr, sig] = token.split('.');
    const exp = Number(expStr);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = crypto.createHmac('sha256', this.renderSecret()).update(`${issueNo}.${exp}`).digest('hex');
    // 길이가 다르면 timingSafeEqual 이 RangeError 를 던져 공개 EP 가 500 이 됐다(2026-09-02 운영 실측) — 다운로드 토큰과 같이 길이부터 대조
    return !!sig && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  // ── 완료본 외부 다운로드(ERP e-sign #6 — 완료본 URL+토큰 → Attachment) ──
  // 렌더 토큰과 컨텍스트('dl.') 분리 → 상호 사용 불가. 기본 24h(외부가 비동기 첨부 fetch).
  private downloadSecret() { return process.env.DOC_DOWNLOAD_SECRET || process.env.PDF_RENDER_SECRET || DEV_SECRET_LITERALS.PDF_RENDER_SECRET; }
  private downloadToken(issueNo: string, ttlSec: number): { token: string; exp: number } {
    const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttlSec);
    const sig = crypto.createHmac('sha256', this.downloadSecret()).update(`dl.${issueNo}.${exp}`).digest('hex');
    return { token: `${exp}.${sig}`, exp };
  }
  private verifyDownloadToken(issueNo: string, token?: string): boolean {
    if (!token) return false;
    const [expStr, sig] = token.split('.');
    const exp = Number(expStr);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = crypto.createHmac('sha256', this.downloadSecret()).update(`dl.${issueNo}.${exp}`).digest('hex');
    return !!sig && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }
  /** 완료본 다운로드 URL(외부 첨부용) — issueNo + 만료 토큰. */
  downloadUrl(issueNo: string, ttlSec = 86400): { url: string; expiresAt: string } {
    const { token, exp } = this.downloadToken(issueNo, ttlSec);
    return { url: `${this.base()}/api/v1/documents/dl/${encodeURIComponent(issueNo)}?t=${token}`, expiresAt: new Date(exp * 1000).toISOString() };
  }
  /** 토큰 검증 후 완료본 PDF(무 JWT 외부 다운로드). */
  async generatePdfWithToken(issueNo: string, token?: string): Promise<Buffer> {
    if (!this.verifyDownloadToken(issueNo, token)) throw new NotFoundException('invalid download token');
    return this.generatePdf(issueNo);
  }

  /** 인쇄 페이지 데이터(토큰 인증, PHI는 토큰 보유자=렌더러에게만) */
  async renderData(issueNo: string, token?: string) {
    if (!this.verifyRenderToken(issueNo, token)) throw new NotFoundException('invalid render token');
    const doc = await this.prisma.issuedDocument.findUnique({ where: { issueNo } });
    if (!doc) throw new NotFoundException('발급 문서 없음');
    const qrUrl = this.verifyUrlOf(doc.issueNo, doc.documentType);
    // 🔴 (2026-10-13 결함 발굴 C6) 서식 머리의 기관 정보 — 종전엔 화면 상수(요양기관기호 WRB-DEMO-0001 등)를 찍었다.
    //    설정 원장 행만 싣는다(없으면 null → 서식이 '미설정') · 어느 키가 등록 명칭인지·발급 시점 동결 여부는 사람 결정 identity.* 대기
    const hospital = await readHospitalConfig(this.prisma, HOSPITAL_FORM_KEYS);
    return {
      documentType: doc.documentType, snapshot: doc.snapshotJson, status: doc.status,
      meta: { issueNo: doc.issueNo, issuedAt: doc.issuedAt, status: doc.status, qrUrl, qrDataUrl: await this.qrDataUrl(qrUrl) },
      hospital,
    };
  }

  /** 발급 문서의 환자 id(열람 감사 귀속용) — 환자 없는 문서(기관 문서 등)는 null */
  async patientIdOf(issueNo: string): Promise<string | null> {
    const doc = await this.prisma.issuedDocument.findUnique({ where: { issueNo }, select: { patientId: true } });
    return doc?.patientId ?? null;
  }

  /**
   * 서버 PDF 생성 — 인쇄 페이지 URL(또는 동결된 본문 HTML)을 browserless 로 렌더.
   * 🔴 (2026-10-12) 인쇄 양식이 없는 종류(CONSENT·CONTRACT·CHECKUP_RESULT 등)도 렌더러를 불러 **"로딩 중…"만 찍힌 PDF** 가 만들어졌다 —
   *    전자서명 요청은 그 PDF 의 sha256 을 서명 대상으로 보냈다(환자가 본문 없는 문서에 서명). 양식이 없으면 만들지 않는다(409).
   *    동의서는 발급 때 동의서 모듈 정본 HTML 을 스냅샷에 동결하고 그 HTML 로 그린다(이후 동의서가 고쳐져도 서명 대상은 그대로).
   */
  async generatePdf(issueNo: string): Promise<Buffer> {
    const doc = await this.prisma.issuedDocument.findUnique({ where: { issueNo }, select: { issueNo: true, documentType: true, snapshotJson: true } });
    if (!doc) throw new NotFoundException('발급 문서 없음');
    const html = (HTML_SNAPSHOT_TYPES as readonly string[]).includes(doc.documentType)
      ? (doc.snapshotJson as { html?: unknown } | null)?.html
      : undefined;
    if (!hasServerPrintForm(doc.documentType) || ((HTML_SNAPSHOT_TYPES as readonly string[]).includes(doc.documentType) && typeof html !== 'string')) {
      throw new ConflictException({
        code: 'DOCUMENT_NO_PRINT_FORM',
        message: '이 발급 문서는 서버 인쇄 양식(또는 동결된 본문)이 없어 PDF 를 만들 수 없습니다 — 빈 문서를 만들지 않습니다',
        details: { documentType: doc.documentType },
      });
    }
    const target = typeof html === 'string'
      ? { html }
      : { url: `${publicBaseUrl()}/print/${encodeURIComponent(issueNo)}?rt=${encodeURIComponent(this.renderToken(issueNo))}` };
    const res = await fetch(`${this.pdfBase()}/pdf?token=${encodeURIComponent(this.pdfToken())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...target,
        options: { format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } },
        // 주소를 열 때만 — 동결 HTML 은 외부 자원을 기다릴 것이 없다
        // 🔴 (2026-10-13 결함 발굴 A5) 네트워크가 잠잠해진 것 ≠ 문서가 그려진 것. 렌더러가 "다 그렸다"(data-print-ready=ok)고
        //    표시할 때까지 기다리고, 끝내 안 오면(오류·양식 없음·로딩 중) browserless 가 400 — PDF 를 만들지 않는다.
        //    browserless/chrome v1 은 `waitFor` 문자열 = 선택자(따옴표 없는 속성값 — 운영 실측 2026-10-13: 있으면 200·없으면 30초 뒤 400)
        ...('url' in target ? { gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 }, waitFor: PRINT_READY_SELECTOR } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`PDF 렌더 실패 HTTP ${res.status} — 인쇄 페이지가 준비 완료를 표시하지 않았거나 렌더 서비스 오류`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** 재발급(사본) — 원본 기반 새 발급번호, status REISSUE */
  async reissue(issueNo: string, issuedBy?: string) {
    const src = await this.prisma.issuedDocument.findUnique({ where: { issueNo } });
    if (!src) throw new NotFoundException('원본 발급 문서 없음');
    // 원본 스냅샷·해시를 그대로 옮긴다 — 서버 생성 종류도 재발급은 서버가 만든 스냅샷이라 허용(범용 발급 잠금을 거치지 않는다)
    const r = await this.persist({ documentType: src.documentType, sourceId: src.sourceId, patientId: src.patientId, snapshot: src.snapshotJson as Record<string, unknown>, formVersion: src.formVersion, hash: src.hash }, issuedBy);
    await this.prisma.issuedDocument.update({ where: { issueNo: r.issueNo }, data: { status: 'REISSUE', reissueOf: issueNo } });
    return { ...r, status: 'REISSUE', reissueOf: issueNo };
  }
}
