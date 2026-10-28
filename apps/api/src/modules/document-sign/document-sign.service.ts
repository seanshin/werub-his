import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { verifyDocumentSignature, storedVerification } from '../../common/util/signature-verify';
import { certificateOwnershipProblem, alignDocumentHashToFirstSignature, countsBySigningEvents } from '../../common/util/blockchain-signature';
import { signedContentHash, isContentHashType, CONTENT_HASH_TYPES } from './document-content-hash';

@Injectable()
export class DocumentSignService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 문서 서명
   *
   * 🔴 (2026-09-15 B7) 서명자·증빙은 **요청 본문이 아니라 호출 맥락(`actor`)** 에서 온다.
   *    종전엔 `signerUserId`·`ipAddress`·`userAgent` 를 본문이 정했고 인증서 소유 대조가 없어,
   *    로그인한 직원이 **남의 인증서 id 로 남의 이름의 서명 행**을 남길 수 있었다.
   *    직원 서명 = 본인 소유 직원 인증서 · 환자 서명(대면 태블릿) = 그 환자 소유 환자 인증서.
   */
  async sign(
    data: {
      documentType: string;
      documentId: string;
      patientId?: string;
      documentHash: string;
      certificateId: string;
      signatureValue: string;
      signatureAlgorithm: string;
      signerRole: string;
      signerType: string;
      signerPatientId?: string;
    },
    actor: { userId: string; ipAddress?: string; userAgent?: string },
  ) {
    // 🔴 (2026-10-13 A2) 서명한 해시가 **문서 내용**의 해시인지 서버가 대조한다 — 종전엔 같은 요청이 보낸 해시로만 검증해
    //    `종류:id:제목` 문자열에 한 서명도 VERIFIED 였다. 문서 id 는 서버 정본으로 맞춘다(퇴원요약: 입원 id → 요약 id).
    const content = await this.contentOrThrow(data.documentType, data.documentId);
    if (content.hash !== data.documentHash) {
      throw new ConflictException({ code: 'SIGN_HASH_NOT_CONTENT', message: '서명한 해시가 지금 문서 내용과 다릅니다 — 문서를 다시 열어 서명하세요(그 사이 내용이 바뀌었을 수 있습니다)' });
    }
    data = { ...data, documentId: content.documentId, patientId: data.patientId ?? content.patientId ?? undefined };

    // 인증서 유효성 검증
    const cert = await this.prisma.blockchainCertificate.findUnique({
      where: { id: data.certificateId },
    });
    if (!cert) throw new NotFoundException('인증서를 찾을 수 없습니다');
    // 소유 대조 정본 `certificateOwnershipProblem`(M1 — 임상 공통 헬퍼·동의서 서명과 같은 규칙)
    const ownership = certificateOwnershipProblem(cert, {
      signerType: data.signerType, signerUserId: actor.userId, signerPatientId: data.signerPatientId,
    });
    if (ownership === 'SIGN_SIGNER_TYPE_INVALID') {
      throw new BadRequestException({ code: 'SIGN_SIGNER_TYPE_INVALID', message: '서명자 유형이 올바르지 않습니다' });
    }
    if (ownership) {
      throw new ForbiddenException({
        code: 'SIGN_CERT_NOT_OWNED',
        message: data.signerType === 'PATIENT' ? '서명 환자 소유의 인증서로만 서명할 수 있습니다' : '본인 소유의 인증서로만 서명할 수 있습니다',
      });
    }
    if (cert.status !== 'ACTIVE') throw new BadRequestException('활성 상태의 인증서만 서명 가능');
    if (cert.expiresAt < new Date()) throw new BadRequestException('만료된 인증서입니다');

    // 🔴 (2026-09-15 N2) 서명값을 인증서 공개키로 **실제로 검증**한다 — 종전엔 검증 코드가 없었고 행은 isValid=true 로 태어났다.
    //    맞지 않는 서명은 서명이 아니다(기록·완료 카운트 금지). 공개키를 읽을 수 없으면 기록하되 미검증으로 남긴다.
    const verification = verifyDocumentSignature({
      publicKey: cert.publicKey, certAlgorithm: cert.algorithm,
      signatureAlgorithm: data.signatureAlgorithm, signatureValue: data.signatureValue, documentHash: data.documentHash,
    });
    if (verification.state === 'FAILED') {
      throw new BadRequestException({ code: 'SIGNATURE_VERIFICATION_FAILED', message: '서명값이 인증서 공개키로 검증되지 않습니다', details: { reason: verification.reason } });
    }

    // 기존 SignedDocument 찾거나 생성
    let signedDoc = await this.prisma.signedDocument.findFirst({
      where: { documentType: data.documentType, documentId: data.documentId },
    });

    if (!signedDoc) {
      signedDoc = await this.prisma.signedDocument.create({
        data: {
          documentType: data.documentType,
          documentId: data.documentId,
          patientId: data.patientId,
          documentHash: data.documentHash,
          status: 'PENDING',
        },
      });
    } else {
      // 🔴 (P1) 서명 0건인 기존 문서(동의서 앵커가 먼저 만든 문서 등)는 이 서명이 서명한 해시로 맞춘다 — 재검증 입력
      await alignDocumentHashToFirstSignature(this.prisma, signedDoc, data.documentHash);
    }

    /**
     * 🔴 (2026-09-16 G3) 서명 행 생성과 완료 카운트는 **한 트랜잭션**이다.
     *    ① 종전엔 둘을 따로 커밋해, 카운트 갱신이 실패하면 **서명은 남고 문서는 미완결**이 됐다 —
     *       재서명하면 서명 행이 하나 더 생겨 카운트가 반대로 부풀 뿐 되돌릴 경로가 없다.
     *    ② 완료 판정을 **읽어둔 옛 값**(`signedDoc.completedSigners + 1`)으로 했다. 두 서명자가 동시에
     *       서명하면 둘 다 0 을 읽어 증가는 원자적으로 2가 되는데 상태는 둘 다 PENDING 으로 계산된다
     *       (필수 2명을 채우고도 미완결). 증가된 **실제 값**으로 판정한다.
     */
    const { signature, updatedDoc } = await this.prisma.$transaction(async (tx) => {
      const signature = await tx.documentSignature.create({
        data: {
          signedDocumentId: signedDoc!.id,
          certificateId: data.certificateId,
          signatureValue: data.signatureValue,
          signatureAlgorithm: data.signatureAlgorithm,
          signedAt: new Date(),
          signerRole: data.signerRole,
          signerType: data.signerType,
          signerUserId: data.signerType === 'STAFF' ? actor.userId : null,
          signerPatientId: data.signerType === 'PATIENT' ? data.signerPatientId : null,
          ipAddress: actor.ipAddress?.slice(0, 45) ?? null,
          userAgent: actor.userAgent?.slice(0, 500) ?? null,
          verifiedAt: verification.state === 'VERIFIED' ? new Date() : null,
        },
      });
      // (U1) 동의서는 서명 사건 원장이 센다 — 전자서명은 붙이되 수를 올리지 않는다
      if (countsBySigningEvents(data.documentType)) {
        const updatedDoc = await tx.signedDocument.findUnique({ where: { id: signedDoc!.id }, include: { signatures: true } });
        return { signature, updatedDoc };
      }
      const counted = await tx.signedDocument.update({
        where: { id: signedDoc!.id },
        data: { completedSigners: { increment: 1 } },
        select: { completedSigners: true, requiredSigners: true },
      });
      const updatedDoc = await tx.signedDocument.update({
        where: { id: signedDoc!.id },
        data: { status: counted.completedSigners >= counted.requiredSigners ? 'COMPLETED' : 'PENDING' },
        include: { signatures: true },
      });
      return { signature, updatedDoc };
    });

    return {
      signedDocument: updatedDoc,
      signature: { ...signature, verification: verification.state === 'VERIFIED' ? 'VERIFIED' : 'NOT_VERIFIED', verificationReason: verification.reason },
    };
  }

  /** 서명 대상 내용 해시(A2) — 서명 모달이 서명하기 전에 받는다 · 종류 밖·문서 없음은 지어내지 않고 거부 */
  async contentOrThrow(documentType: string, documentId: string) {
    if (!isContentHashType(documentType)) {
      throw new BadRequestException({ code: 'SIGN_DOCUMENT_TYPE_UNSUPPORTED', message: '내용 해시를 계산할 수 없는 문서 종류입니다', details: { supported: CONTENT_HASH_TYPES } });
    }
    const c = await signedContentHash(this.prisma, documentType, documentId);
    if (!c) throw new NotFoundException({ code: 'SIGN_DOCUMENT_NOT_FOUND', message: '서명할 문서를 찾을 수 없습니다' });
    return c;
  }

  /** 서명한 해시 ↔ 지금 문서 내용 해시(A2) — 종류 밖·문서 없음은 NOT_COMPUTABLE(일치라 말하지 않는다) */
  private async contentStateOf(documentType: string, documentId: string, documentHash: string): Promise<'MATCH' | 'MISMATCH' | 'NOT_COMPUTABLE'> {
    const now = await signedContentHash(this.prisma, documentType, documentId); // 조회 실패는 전파한다(대조 불가로 접지 않는다)
    return !now ? 'NOT_COMPUTABLE' : now.hash === documentHash ? 'MATCH' : 'MISMATCH';
  }

  /** 서명 검증 */
  async verify(signedDocumentId: string) {
    const doc = await this.prisma.signedDocument.findUnique({
      where: { id: signedDocumentId },
      include: {
        signatures: {
          include: {
            certificate: {
              select: { id: true, status: true, issuedAt: true, expiresAt: true, revokedAt: true, serialNumber: true, fingerprint: true, publicKey: true, algorithm: true },
            },
          },
        },
      },
    });
    if (!doc) throw new NotFoundException('서명 문서를 찾을 수 없습니다');

    const verificationResults = doc.signatures.map((sig) => {
      // 🔴 (2026-09-15) 종전 식 `status !== 'REVOKED' || expiresAt >= signedAt` 은 만료된 인증서(폐기 아님)를
      //    유효로, 서명 뒤에 폐기된 인증서를 "서명 시점에도 무효"로 뒤집어 판정했다. 서명 **시점** 기준으로 본다.
      const c = sig.certificate;
      const certValidAtSignTime =
        c.issuedAt <= sig.signedAt &&
        c.expiresAt >= sig.signedAt &&
        (c.status !== 'REVOKED' || (c.revokedAt != null && c.revokedAt > sig.signedAt));

      // 서명값 자체의 SHA-256(식별용 지문) — 🔴 이것은 검증이 아니다(종전 주석은 "해시 검증"이라 불렀다)
      const sigHash = createHash('sha256').update(sig.signatureValue).digest('hex');
      // 저장값을 믿지 않고 조회 시점에 공개키로 다시 검증한다 — 문서 해시는 서명 문서의 현행 해시
      const raw = verifyDocumentSignature({
        publicKey: c.publicKey, certAlgorithm: c.algorithm,
        signatureAlgorithm: sig.signatureAlgorithm, signatureValue: sig.signatureValue, documentHash: doc.documentHash,
      });
      // 🔴 (P1) 정정 재서명으로 문서 해시가 바뀌면 대체된 직전 서명은 **현행 해시로 재검증할 수 없다** — "맞지 않음"이 아니다.
      //    기록 시점에 공개키 검증을 통과했다는 사실(verifiedAt)이 있는 대체 서명만 그렇게 말한다(미검증 기록은 승격하지 않는다).
      const v = raw.state === 'FAILED' && raw.reason === 'SIGNATURE_MISMATCH' && !sig.isValid && sig.verifiedAt != null
        ? { state: 'NOT_VERIFIABLE' as const, reason: 'SUPERSEDED_DOCUMENT_HASH' }
        : raw;

      return {
        signatureId: sig.id,
        signerRole: sig.signerRole,
        signedAt: sig.signedAt,
        certSerial: c.serialNumber,
        certValid: certValidAtSignTime,
        signatureHash: sigHash,
        /** VERIFIED · FAILED(서명 불일치) · NOT_VERIFIABLE(공개키를 읽을 수 없음 — 유효라 말하지 않는다) */
        verification: v.state,
        verificationReason: v.reason,
        current: sig.isValid, // 정정 재서명으로 대체되지 않은 현행본인가
        isValid: sig.isValid && certValidAtSignTime && v.state === 'VERIFIED',
      };
    });

    // 서명 0건은 "전부 유효"가 아니다(분모 0) — null
    const allValid = verificationResults.length === 0 ? null : verificationResults.every((r) => r.isValid);

    // 🔴 (A2) 서명이 **지금 문서 내용**을 덮는가 — 서명값 검증(VERIFIED)은 "이 해시에 서명했다"까지만 말한다.
    //    MISMATCH = 서명 뒤 내용이 바뀌었거나 2026-10-13 전 제목 문자열로 서명된 것 · 계산 불가는 그렇게 말한다.
    const contentState = await this.contentStateOf(doc.documentType, doc.documentId, doc.documentHash);

    return {
      documentId: doc.id,
      documentHash: doc.documentHash,
      status: doc.status,
      contentState,
      allSignaturesValid: allValid,
      signatures: verificationResults,
    };
  }

  /** 서명 문서 조회 */
  async getSignedDocument(documentType: string, documentId: string) {
    const doc = await this.prisma.signedDocument.findFirst({
      where: { documentType, documentId },
      include: {
        signatures: {
          include: {
            certificate: {
              select: { id: true, serialNumber: true, subjectDn: true, fingerprint: true },
            },
            signerUser: { select: { id: true, familyName: true, givenName: true } },
            signerPatient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
          },
          orderBy: { signedAt: 'asc' },
        },
      },
    });
    // 🔴 (P1) 코드를 싣는다 — 인쇄 서명 정보가 "서명 문서 없음(= 미서명)"을 "조회 실패(= 확인 불가)"와 가를 유일한 근거
    if (!doc) throw new NotFoundException({ code: 'SIGNED_DOCUMENT_NOT_FOUND', message: '서명 문서를 찾을 수 없습니다' });
    // 🔴 (A2) 서명한 해시가 지금 문서 내용과 같은가 — 인쇄 서명 정보가 "무엇의 해시인지"를 말할 근거
    const contentState = await this.contentStateOf(doc.documentType, doc.documentId, doc.documentHash);
    // 저장 시 검증 통과분만 VERIFIED — 나머지는 미검증(유효라 말하지 않는다)
    return { ...doc, contentState, signatures: doc.signatures.map((sg) => ({ ...sg, verification: storedVerification(sg) })) };
  }

  /** 서명 이력 */
  async getSignHistory(userId?: string, patientId?: string) {
    const where: Record<string, unknown> = {};
    if (userId) where.signerUserId = userId;
    if (patientId) where.signerPatientId = patientId;

    return this.prisma.documentSignature.findMany({
      where,
      orderBy: { signedAt: 'desc' },
      take: 200,
      include: {
        signedDocument: {
          select: { id: true, documentType: true, documentId: true, status: true },
        },
        certificate: {
          select: { id: true, serialNumber: true },
        },
      },
    });
  }

  /** 다중 서명 초기화 */
  async initMultiSign(data: {
    documentType: string;
    documentId: string;
    patientId?: string;
    documentHash: string;
    requiredSigners: number;
    timeoutMinutes?: number;
  }) {
    if (data.requiredSigners < 2) throw new BadRequestException('다중 서명은 2명 이상 필요');

    const timeoutAt = data.timeoutMinutes
      ? new Date(Date.now() + data.timeoutMinutes * 60 * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // 기본 24시간

    return this.prisma.signedDocument.create({
      data: {
        documentType: data.documentType,
        documentId: data.documentId,
        patientId: data.patientId,
        documentHash: data.documentHash,
        requiredSigners: data.requiredSigners,
        status: 'PENDING',
        timeoutAt,
      },
    });
  }

  /** 다중 서명 진행 상태 */
  async getMultiSignStatus(id: string) {
    const doc = await this.prisma.signedDocument.findUnique({
      where: { id },
      include: {
        signatures: {
          select: {
            id: true,
            signerRole: true,
            signerType: true,
            signedAt: true,
            signerUserId: true,
            signerPatientId: true,
          },
          orderBy: { signedAt: 'asc' },
        },
      },
    });
    if (!doc) throw new NotFoundException('서명 문서를 찾을 수 없습니다');

    return {
      id: doc.id,
      status: doc.status,
      requiredSigners: doc.requiredSigners,
      completedSigners: doc.completedSigners,
      remaining: doc.requiredSigners - doc.completedSigners,
      timeoutAt: doc.timeoutAt,
      isTimedOut: doc.timeoutAt ? doc.timeoutAt < new Date() : false,
      signatures: doc.signatures,
    };
  }

  /** 서명 봉투 (문서 + 서명 번들) */
  async getEnvelope(signedDocumentId: string) {
    const doc = await this.prisma.signedDocument.findUnique({
      where: { id: signedDocumentId },
      include: {
        signatures: {
          include: {
            certificate: {
              select: {
                id: true,
                serialNumber: true,
                subjectDn: true,
                publicKey: true,
                algorithm: true,
                fingerprint: true,
                issuedAt: true,
                expiresAt: true,
              },
            },
          },
          orderBy: { signedAt: 'asc' },
        },
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
      },
    });
    if (!doc) throw new NotFoundException('서명 문서를 찾을 수 없습니다');

    return {
      envelope: {
        documentId: doc.documentId,
        documentType: doc.documentType,
        documentHash: doc.documentHash,
        documentVersion: doc.documentVersion,
        status: doc.status,
        createdAt: doc.createdAt,
        patient: doc.patient,
        signatures: doc.signatures.map((sig) => ({
          signatureValue: sig.signatureValue,
          algorithm: sig.signatureAlgorithm,
          signedAt: sig.signedAt,
          signerRole: sig.signerRole,
          certificate: sig.certificate,
        })),
        merkleRoot: doc.merkleRoot,
        blockchainTxId: doc.blockchainTxId,
      },
    };
  }

  /** 만료된 다중 서명 처리 */
  async checkTimeouts() {
    const expired = await this.prisma.signedDocument.findMany({
      where: {
        status: 'PENDING',
        requiredSigners: { gt: 1 },
        timeoutAt: { lt: new Date() },
      },
    });

    const ids = expired.map((d) => d.id);
    if (ids.length === 0) return { voided: 0 };

    await this.prisma.signedDocument.updateMany({
      where: { id: { in: ids } },
      data: { status: 'VOIDED' },
    });

    return { voided: ids.length, ids };
  }
}
