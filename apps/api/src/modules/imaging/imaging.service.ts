import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ImagingResultStatus } from '@prisma/client';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { aiUnavailable } from '../medical-ai/ai-grounding';
import { ImagingSafetyService } from './imaging-safety.service';
import { JourneyService } from '../journey/journey.service';

@Injectable()
export class ImagingService {
  private readonly logger = new Logger(ImagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    // 영상 바이트 업로드 경로(POST /api/v1/ai/vision/medical/analyze)가 배선되면 여기서 사용한다.
    // 그전까지 AI 판독은 호출하지 않는다(아래 NO_IMAGE_REASON 참조).
    private readonly medicalAi: MedicalAiService,
    private readonly imagingSafety: ImagingSafetyService,
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /**
   * ── 🔴 AI 영상 판독 3종은 **호출하지 않는다.** 판독할 영상이 없기 때문이다. ──
   *
   * 원 결함(2026-08-18 적발 · P15): 세 메서드가 영상 URL 자리에 **빈 문자열 `''`** 을 넘기고
   * "판독 소견"을 받아 `{ source: 'AI' }` 로 화면에 렌더했다. **보지 않은 영상의 소견**이다.
   *
   * 왜 URL 을 채워 넣는 방식으로 고치지 않았는가(입력을 그럴듯하게 채워 호출을 성사시키지 않는다):
   *   ① `ImagingResult` 에는 **영상 참조 필드가 아예 없다**(schema 실측 — studyInstanceUid·orthancStudyId·
   *      이미지 URL 어느 것도 없다). DICOM 은 `DicomStudy` 에 따로 있고 `ImagingResult` 와 연결되어 있지 않다
   *      (운영 실측 2026-08-18: dicom_studies 2행 vs imaging_results 209행 — 대부분 영상 자체가 없다).
   *   ② 설령 study 를 찾아도 HIS 가 줄 수 있는 주소는 `/api/v1/pacs/...` 인증 경로뿐이고,
   *      **외부 AI 는 그 주소에서 401 을 받는다**(정본 판정 `unfetchableByExternalAi`).
   *      이 저장소의 PACS 는 SSO 시크릿 미설정으로 실제 401 이다.
   *
   * 그러므로 사실은 **"영상을 가져올 수 없어 판독할 수 없다"** 이고, 화면이 그것을 말해야 한다.
   * 영상 바이트를 확보하는 경로(`POST /api/v1/ai/vision/medical/analyze` — base64 업로드)가 배선되면
   * 그때 이 자리에서 그 경로를 부른다. 그전까지 소견을 만들지 않는다.
   */
  private static readonly NO_IMAGE_REASON =
    '판독할 영상 파일을 가져올 수 없습니다 — 영상 결과(ImagingResult)에 DICOM/이미지 참조가 없고, ' +
    'PACS 경로는 외부 AI 판독 서버가 인증 없이 가져갈 수 없습니다. AI 판독 소견을 생성하지 않았습니다(위험이 없다는 뜻이 아닙니다).';

  /** AI 영상 판독 보조 — 영상 부재로 산출 불가(호출하지 않음) */
  async analyzeImagingAI(imagingResultId: string) {
    const result = await this.prisma.imagingResult.findUnique({ where: { id: imagingResultId } });
    if (!result) throw new NotFoundException('영상 결과를 찾을 수 없습니다');
    this.logger.warn(`AI 영상 분석 미호출(영상 참조 부재): imagingResultId=${imagingResultId}`);
    return {
      imagingResultId,
      patientId: result.patientId,
      analysis: null,
      // 판독의가 실제로 쓴 소견은 그대로 돌려준다 — 이건 사람이 남긴 사실이다(AI 산출물이 아니다).
      radiologistFinding: result.finding ?? null,
      radiologistImpression: result.impression ?? null,
      ...aiUnavailable('SOURCE_UNREACHABLE', ImagingService.NO_IMAGE_REASON),
    };
  }

  /** AI 구조화 판독 리포트 — 영상 부재로 산출 불가(호출하지 않음) */
  async generateStructuredReport(imagingResultId: string) {
    const result = await this.prisma.imagingResult.findUnique({ where: { id: imagingResultId } });
    if (!result) throw new NotFoundException('영상 결과를 찾을 수 없습니다');
    this.logger.warn(`AI 구조화 리포트 미호출(영상 참조 부재): imagingResultId=${imagingResultId}`);
    return {
      imagingResultId,
      patientId: result.patientId,
      report: null,
      ...aiUnavailable('SOURCE_UNREACHABLE', ImagingService.NO_IMAGE_REASON),
    };
  }

  /** AI 비교 판독 — 영상 부재로 산출 불가(호출하지 않음) */
  async compareImagingAI(currentId: string, previousId: string) {
    const [current, previous] = await Promise.all([
      this.prisma.imagingResult.findUnique({ where: { id: currentId } }),
      this.prisma.imagingResult.findUnique({ where: { id: previousId } }),
    ]);
    if (!current || !previous) throw new NotFoundException('영상을 찾을 수 없습니다');
    this.logger.warn(`AI 비교 판독 미호출(영상 참조 부재): ${currentId} vs ${previousId}`);
    return {
      currentId,
      previousId,
      patientId: current.patientId,
      comparison: null,
      ...aiUnavailable('SOURCE_UNREACHABLE', ImagingService.NO_IMAGE_REASON),
    };
  }

  async getQueue() {
    return this.prisma.order.findMany({
      where: { department: 'IMAGING', status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        prescription: {
          include: {
            encounter: { select: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } } },
            procedureCode: { select: { code: true, nameKo: true } },
          },
        },
      },
    });
  }

  async acquire(
    orderId: string, modality?: string, bodyPart?: string, notes?: string, userId?: string,
    extra?: { overrideSafety?: boolean; overrideReason?: string; dlp?: number; ctdiVol?: number; doseAreaProduct?: number; effectiveDoseMsv?: number },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { encounter: { select: { patientId: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== 'ORDERED' && order.status !== 'RECEIVED') {
      throw new ConflictException(
        `Cannot acquire imaging for order with status ${order.status}. Expected: ORDERED or RECEIVED`
      );
    }

    // 시행 전 안전게이트 — 조영제(알레르기·신기능)·임신확인·누적피폭 (imaging.contrastEnforce/pregnancyEnforce)
    const safety = await this.imagingSafety.assertAcquireGate(orderId, {
      modality, bodyPart,
      override: extra?.overrideSafety, overrideReason: extra?.overrideReason, userId,
    });

    /**
     * 🔴 (2026-09-16 G3) 오더 전이와 영상결과 생성은 **한 트랜잭션**이다.
     *    종전엔 `order.update(IN_PROGRESS)` 를 먼저 커밋하고 `imagingResult.create` 를 따로 했다 —
     *    생성이 실패하면 오더만 IN_PROGRESS 로 남는데 위 상태 검사(`ORDERED|RECEIVED`)가 재시도를 막아
     *    **그 오더가 영구히 잠긴다**(F3 이 약제 조제 시작에서 고친 것과 같은 모양).
     *    피폭선량 기록은 다른 서비스 호출이라 트랜잭션 **밖**에 둔다(외부·장시간 호출을 트랜잭션에 넣지 않는다).
     */
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), ...(userId ? { startedById: userId } : {}) },
      });
      return tx.imagingResult.create({
        data: {
          orderId,
          patientId: order.prescription.encounter?.patientId ?? '',
          // safety.modality는 명시 입력의 대문자 정규화 결과(미입력 시 코드/명칭 판정·미상 'OT'는 기존 라벨 유지)
          // 🔴 최종 폴백은 워크스테이션 경로(`acquireImaging`)와 같은 'CR' 이다.
          //    종전 폴백 'X-ray' 는 시술코드 마스터(CT/MR/US/CR/RF/NM/MG)에도 DICOM 에도 없는 어휘라,
          //    저장되는 순간 전리방사선 판정 집합 밖으로 떨어져 임신 게이트·피폭 추적이 꺼졌다.
          //    같은 사실을 두 경로가 다른 말로 적으면 소비처는 어느 쪽이 정본인지 모른다.
          modality: (safety.modality !== 'OT' ? safety.modality : modality?.trim().toUpperCase()) || 'CR',
          bodyPart: bodyPart || null,
          status: ImagingResultStatus.ACQUIRED,
          safetyChecks: safety as unknown as import('@prisma/client').Prisma.InputJsonValue,
          acquiredAt: new Date(),
        },
        include: {
          order: { include: { prescription: true } },
        },
      });
    });

    // 피폭선량 기록(전리방사선·선량값 입력 시) — 콘솔 판독값 수기
    if (safety.ionizing && userId && (extra?.dlp != null || extra?.ctdiVol != null || extra?.doseAreaProduct != null || extra?.effectiveDoseMsv != null)) {
      await this.imagingSafety.recordExposure({
        imagingResultId: result.id,
        patientId: result.patientId,
        modality: result.modality,
        bodyPart: result.bodyPart,
        dlp: extra?.dlp, ctdiVol: extra?.ctdiVol,
        doseAreaProduct: extra?.doseAreaProduct, effectiveDoseMsv: extra?.effectiveDoseMsv,
        enteredBy: userId,
      });
    }

    return result;
  }

  async report(
    orderId: string,
    finding: string,
    impression: string,
    radiologistId?: string
  ) {
    if (!finding || !impression) {
      throw new BadRequestException('Finding and impression are required');
    }

    const imaging = await this.prisma.imagingResult.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!imaging) throw new NotFoundException('Imaging result not found');

    if (imaging.status !== ImagingResultStatus.ACQUIRED) {
      throw new ConflictException(
        `Cannot report imaging with status ${imaging.status}. Expected: ACQUIRED`
      );
    }

    /**
     * 🔴 (2026-09-16 G3) 오더 완료와 판독 기록은 **한 트랜잭션**이다.
     *    종전엔 오더를 COMPLETED 로 먼저 커밋해, 판독 저장이 실패하면 **판독 없는 완료 오더**가 남았다
     *    (아래 청구 트리거 이벤트는 이 둘이 함께 커밋된 뒤에만 나간다).
     */
    const { order, result } = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', completedAt: new Date(), ...(radiologistId ? { completedById: radiologistId } : {}) },
        include: { prescription: { select: { id: true, encounterId: true, encounter: { select: { patientId: true } } } } },
      });
      const result = await tx.imagingResult.update({
        where: { id: imaging.id },
        data: {
          finding,
          impression,
          radiologistId: radiologistId || null,
          status: ImagingResultStatus.REPORTED,
          reportedAt: new Date(),
        },
        include: {
          order: { include: { prescription: true } },
        },
      });
      return { order, result };
    });

    // 환자 여정 — 영상 판독 완료(fire-and-forget)
    if (order.prescription?.encounter?.patientId) {
      this.journey?.emit({
        patientId: order.prescription.encounter.patientId,
        eventType: 'IMAGING_RESULT',
        title: '영상 판독 완료',
        // 🔴 (2026-09-14) 판독 소견(impression)은 설명 전 임상 원문 — 환자 노출 유형이라 여정 설명에 싣지 않는다(결과 조회 화면이 정본).
        department: '영상의학과',
        refType: 'ImagingResult',
        refId: imaging.id,
      });
    }

    // 영상 판독 완료 이벤트
    this.eventEmitter.emit('imaging.result.reported', {
      imagingResultId: imaging.id,
      orderId,
      prescriptionId: order.prescription?.id, // progressive billing 발생 트리거
      patientId: order.prescription?.encounter?.patientId,
      encounterId: order.prescription?.encounterId,
    });

    return result;
  }

  async getDetail(imagingResultId: string) {
    const imaging = await this.prisma.imagingResult.findUnique({
      where: { id: imagingResultId },
      include: {
        order: { include: { prescription: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });

    if (!imaging) throw new NotFoundException('Imaging result not found');
    return imaging;
  }

  async getPatientResults(patientId: string) {
    return this.prisma.imagingResult.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: { include: { prescription: true } },
      },
    });
  }

  async cancelAcquisition(imagingResultId: string, reason?: string) {
    const imaging = await this.prisma.imagingResult.findUnique({
      where: { id: imagingResultId },
      include: { order: true },
    });
    if (!imaging) throw new NotFoundException('Imaging result not found');

    if (imaging.status === ImagingResultStatus.REPORTED) {
      throw new ConflictException('Cannot cancel reported imaging');
    }

    // 🔴 (2026-09-16 G3) 오더 되돌림과 영상결과 되돌림은 한 트랜잭션 — 한쪽만 커밋되면
    //    "오더는 재촬영 대기인데 영상결과는 촬영됨"이 남고, 재촬영이 `orderId` 유니크에 막힌다.
    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: imaging.orderId },
        data: { status: 'RECEIVED', startedAt: null },
      });
      return tx.imagingResult.update({
        where: { id: imagingResultId },
        data: {
          status: ImagingResultStatus.ORDERED,
          acquiredAt: null,
        },
      });
    });
  }

  async updateAcquisition(
    imagingResultId: string,
    modality?: string,
    bodyPart?: string,
    notes?: string
  ) {
    const imaging = await this.prisma.imagingResult.findUnique({
      where: { id: imagingResultId },
    });
    if (!imaging) throw new NotFoundException('Imaging result not found');

    if (imaging.status !== ImagingResultStatus.ACQUIRED) {
      throw new ConflictException(
        `Cannot update imaging with status ${imaging.status}. Expected: ACQUIRED`
      );
    }

    return this.prisma.imagingResult.update({
      where: { id: imagingResultId },
      data: {
        ...(modality && { modality }),
        ...(bodyPart && { bodyPart }),
      },
      include: { order: { include: { prescription: true } } },
    });
  }
}
