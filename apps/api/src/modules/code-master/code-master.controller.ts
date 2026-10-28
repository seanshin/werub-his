import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole, Prisma } from '@prisma/client';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import {
  CodeMasterService,
  CreateDiagnosisInput,
  UpdateDiagnosisInput,
  CreateProcedureInput,
  UpdateProcedureInput,
  CreateMedicationInput,
  UpdateMedicationInput,
  CreateLabTestInput,
} from './code-master.service';
import { AutoMapperService } from './auto-mapper.service';
import { CodeUsageService } from './code-usage.service';
import { CodeImportService } from './code-import.service';
import { CodeSynonymService } from './code-synonym.service';
import { CodeDuplicateService } from './code-duplicate.service';
import { CodeExportService } from './code-export.service';
import { CodeCategoryDeriveService } from './code-category-derive.service';
import { AtcMappingImportService } from './atc-mapping-import.service';
import { AtcMappingImportDto } from './dto/atc-import.dto';
import { ReferenceDatasetService } from './reference-dataset.service';
import {
  ImportStandardCodesDto,
  NotInGazetteDto,
  ImportDrgSeverityDto,
  ImportDrgZeroDto,
  DrgSeverityQueryDto,
  ImportDrgSeparateDto,
  SeparateBillableQueryDto,
  ImportDrugPriceDto,
  DrugPriceOnQueryDto,
  ImportProcedureFeeDto,
  FeeOnQueryDto,
} from './dto/reference-dataset.dto';
import { DrgReferenceService } from './drg-reference.service';
import { ApplyCategoryDeriveDto } from './dto/category-derive.dto';
import { CodeImportDto } from './dto/code-import.dto';
import { CodeRetireDto } from './dto/code-retire.dto';
import { CodeSynonymProposeDto, CodeSynonymReviewDto } from './dto/code-synonym.dto';
import { CodeQueryDto } from './dto/code-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateTerminologyMappingDto } from './dto/terminology-mapping.dto';
import { AssignMappingDepartmentDto, ConfirmPendingMappingDto, MappingReviewNotesDto } from './dto/pending-mapping-review.dto';

/** 🔴 역할 목록은 shared 정본 하나 — 여기에 다시 적으면 신설 직군이 따라오지 못한다 */
const SYNONYM_READ_ROLES = EVERY_STAFF_ROLE.map((r) => r as UserRole);

@ApiTags('Code Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/codes')
export class CodeMasterController {
  constructor(
    private readonly codeMasterService: CodeMasterService,
    private readonly autoMapper: AutoMapperService,
    private readonly codeUsage: CodeUsageService,
    private readonly codeImport: CodeImportService,
    private readonly synonyms: CodeSynonymService,
    private readonly duplicates: CodeDuplicateService,
    private readonly codeExport: CodeExportService,
    private readonly categoryDerive: CodeCategoryDeriveService,
    private readonly atcImport: AtcMappingImportService,
    private readonly refData: ReferenceDatasetService,
    private readonly drg: DrgReferenceService,
  ) {}

  // ── 중복 후보 · 코드집 내보내기 ──

  /**
   * 🔴 **고시 마스터는 검사하지 않는다.** 2026-08-26 실측에서 "동일 명칭"으로 세면
   *    수가만 8,535 그룹이 나오는데 전부 정상이다(한 마취 행위에 가산 코드 240개).
   *    그것을 "중복"이라 부르면 누군가 가산 코드를 병합해 **청구를 망가뜨린다.**
   *    실제로 중복이 생기는 곳은 원내에서 사람이 만든 코드뿐이다.
   */
  @Get('duplicates/:sourceTable')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '중복 후보(원내 등록분만) — 자동으로 합치지 않는다' })
  async duplicateCandidates(@Param('sourceTable') sourceTable: string) {
    return { data: await this.duplicates.report(sourceTable) };
  }

  /** 🔴 조용히 자르지 않는다 — 전체 건수와 다음 장 유무를 함께 준다(일부를 전부로 제출하면 안 된다) */
  @Get('export/:kind')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '코드집 내보내기(CSV) — 장 단위, 전체 건수 병기' })
  async exportCodes(
    @Param('kind') kind: string,
    @Query('origin') origin?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
  ) {
    const res = await this.codeExport.export(kind, {
      origin,
      active: active === undefined ? undefined : active === 'true',
      page: page ? Number(page) : 1,
    });
    return { data: res };
  }

  /**
   * 분류 목록 — **실데이터에서** 뽑는다.
   *
   * 🔴 발단(2026-08-26 사람 신고 "수가코드가 다 반영이 안 되었음"). 실측:
   *    수가 **166,744건 중 분류가 있는 것은 55건**(99.97%가 비어 있다). 게다가 화면의 분류 목록은
   *    **손으로 적은 11개**라, 실제로 존재하는 `이학요법료`·`치료재료대`·`전혈·혈액대`·`정신요법료`·
   *    `마취료` 는 목록에 없어 **분류로는 도달할 수 없었다.**
   *
   * 🔴 **분류를 지어내지 않는다.** 코드 접두로 추론해 채우면 그것이 정책인 척한다.
   *    대신 있는 그대로 보여주고, **분류 없음도 고를 수 있게** 건수와 함께 낸다.
   */
  @Get(':kind/categories')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '분류 목록(실데이터·건수 포함·분류 없음 건수 별도)' })
  async categories(@Param('kind') kind: string) {
    return { data: await this.codeMasterService.categoriesOf(kind) };
  }

  /**
   * 수가 분류 **접두 유도** — 사람 결정(2026-08-26, 선택지 c).
   *
   * 🔴 규칙을 기억에서 적지 않고 **운영에 이미 붙은 분류에서 역산**한다.
   * 🔴 증거가 갈리는 접두는 **제안하지 않는다**(다수결로 정하면 추정이 규칙인 척한다).
   * 🔴 적용해도 출처가 `PREFIX_DERIVED` 로 남는다 — 고시 분류인 척하지 않는다.
   */
  @Get('procedure/category-suggestions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수가 분류 접두 유도 제안(증거·적용 대상 건수·모호 접두 포함)' })
  async categorySuggestions() {
    return { data: await this.categoryDerive.suggest() };
  }

  @Post('procedure/category-suggestions/apply')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '접두 유도 분류 적용 — 사람이 고른 접두만·이미 분류된 행은 건드리지 않음' })
  async applyCategorySuggestions(
    @Body() body: ApplyCategoryDeriveDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.categoryDerive.apply(body.prefixes, userId) };
  }

  /**
   * ATC ↔ 제품코드(EDI) 매핑 반영 — 표준 파일 기반.
   *
   * 🔴 **정본은 `TerminologyMapping` 하나다.** `MedicationCode` 에 ATC 필드를 새로 만들지 않았다.
   * 🔴 **덮어쓰지 않는다.** 이미 다른 ATC 가 있으면 `CONFLICT` 로 보고만 하고 사람이 정한다.
   * 🔴 **파일의 기준월을 남긴다** — "현재 유효"를 뜻하지 않는다.
   */
  @Post('atc-mapping/preview')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: 'ATC 매핑 파일 차이 리포트(저장하지 않음)' })
  async atcPreview(@Body() body: AtcMappingImportDto) {
    return { data: await this.atcImport.preview(body.content, body.version) };
  }

  @Post('atc-mapping/apply')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: 'ATC 매핑 반영(사람 확인 후) — 기존 매핑은 덮지 않음' })
  async atcApply(@Body() body: AtcMappingImportDto, @CurrentUser('id') userId: string) {
    return { data: await this.atcImport.apply(body.content, body.version, userId) };
  }

  // ── 기초 데이터(고시) 원장 ──

  /**
   * 🔴 사람 지시(2026-08-26): *"올리는 데이터들이 **해당 날짜와 고시에 맞춰서** 저장되면 됨."*
   *    기준일이 없으면 다음 사람이 그 값을 **현재로 읽는다.**
   */
  @Get('reference-datasets')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '반영한 기초 데이터 원장 — 어느 고시가 언제 반영됐는가' })
  async referenceDatasets(@Query('kind') kind?: string) {
    return { data: await this.refData.list(kind) };
  }

  /**
   * 의약품 **포장단위 표준코드**(GS1 GTIN-13) 반영.
   * 🔴 우리 `barcode` 는 전부 **대표코드**라, 실제 약 상자를 스캔하면 못 찾았다(실측).
   */
  @Post('reference-datasets/standard-codes')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '의약품 표준코드 반영(기준일 필수) — 스캔 조회의 근거' })
  async importStandardCodes(@Body() body: ImportStandardCodesDto, @CurrentUser('id') userId: string) {
    return { data: await this.refData.importStandardCodes(body.rows, { ...body, userId }) };
  }

  /**
   * 🔴 최신 고시에 없는 원내 약품 — 실측(2026-08-26): 6.1→7.1 삭제 38건 중 **31건이 활성**이었다.
   *    🔴 **자동 폐지하지 않는다.** 급여에서 빠졌다고 원내에서 안 쓰는 것은 아니다.
   */
  @Post('reference-datasets/not-in-gazette')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '고시에 없는 원내 약품 조회(고시 전체 코드 목록 필요·폐지하지 않음)' })
  async notInGazette(@Body() body: NotInGazetteDto) {
    return { data: await this.refData.notInGazette(body.codes) };
  }

  // ── DRG(질병군) 참조 자료 ──

  /**
   * 🔴 **이 자료로 DRG 를 산정하지 않는다.** 계산되는 것은 **중증도 점수 합계**뿐이고,
   *    질병군(ADRG) 배정·수가는 별도 자료·규칙이다. 응답이 그 한계를 직접 말한다.
   */
  @Post('drg/severity-scores')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'DRG 기타진단 중증도 점수 반영(별표4·기준일 필수)' })
  async importDrgSeverity(@Body() body: ImportDrgSeverityDto, @CurrentUser('id') userId: string) {
    return { data: await this.drg.importSeverity(body.rows, { ...body, userId }) };
  }

  @Post('drg/zero-score-rules')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'DRG 0점 결정 주진단 반영(별표5·기준일 필수)' })
  async importDrgZero(@Body() body: ImportDrgZeroDto, @CurrentUser('id') userId: string) {
    return { data: await this.drg.importZeroRules(body.rows, { ...body, userId }) };
  }

  @Post('drg/severity')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '중증도 점수 합계 — 🔴 DRG 산정이 아니다(한계를 응답이 말한다)' })
  async drgSeverity(@Body() body: DrgSeverityQueryDto) {
    return { data: await this.drg.severity(body.mainDiagnosis, body.otherDiagnoses) };
  }

  @Post('reference-datasets/procedure-fees')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수가반영내역 반영 — 종별 단가를 전부 시점별로 보관(덮어쓰지 않는다)' })
  async importProcedureFees(@Body() body: ImportProcedureFeeDto, @CurrentUser('id') userId: string) {
    return { data: await this.refData.importProcedureFees(body.rows, { ...body, userId }) };
  }

  /**
   * 🔴 **그 시점 · 그 종별의** 수가. 종별이 미설정이면 금액 대신 `TIER_UNKNOWN` 을 답한다 —
   *    기본 종별을 끼워 넣지 않는다(의원 ≠ 병원급이 97.4%).
   *    고시 단가 `0` 은 **그 종별 미산정**이며 0원 청구가 아니다.
   */
  @Post('procedure-fees/on')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '시점·종별 수가 — 종별 미설정이면 판정 불가(기본값을 고르지 않는다)' })
  async feeOn(@Body() body: FeeOnQueryDto) {
    return { data: await this.refData.feeOn(body.codes, { onDate: body.onDate, tier: body.tier }) };
  }

  @Post('reference-datasets/drug-prices')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '약제급여목록 반영 — 고시 시점별로 쌓고 직전 고시 기간을 닫는다(덮어쓰지 않는다)' })
  async importDrugPrices(@Body() body: ImportDrugPriceDto, @CurrentUser('id') userId: string) {
    return { data: await this.refData.importDrugPriceList(body.rows, { ...body, userId }) };
  }

  /**
   * 🔴 **그 시점의** 약가. 진료일을 넣는다 — 오늘 값으로 과거를 계산하면 틀린다
   *    (2026.6.1 → 7.1 한 달 사이 13건 변동 · 줄토피플렉스터치주 2.7배).
   *    모르면 `price: null`(판정 불가)이며 **0원이 아니다.**
   */
  @Post('drug-prices/on')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '시점별 급여상한금액 — 모르면 null(0원이 아니다)' })
  async drugPriceOn(@Body() body: DrugPriceOnQueryDto) {
    return { data: await this.refData.priceOn(body.codes, body.onDate) };
  }

  @Post('drg/separate-billing')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'DRG 행위 별도보상 코드 반영(기준일 필수·분류번호는 원문 그대로)' })
  async importDrgSeparate(@Body() body: ImportDrgSeparateDto, @CurrentUser('id') userId: string) {
    return { data: await this.drg.importSeparateBilling(body.rows, { ...body, userId }) };
  }

  /**
   * 🔴 이 수가코드가 DRG 입원에서 **따로 산정되는가**.
   *    기간이 지난 코드를 "가능"이라 말하면 그대로 청구된다 — 시점을 받아 판정한다.
   *    🔴 목록에 없으면 `null`(판정 불가)이며 "포괄 대상"을 뜻하지 않는다.
   */
  @Post('drg/separate-billable')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '별도보상 여부 판정 — 목록에 없으면 판정 불가(포괄 대상이 아니다)' })
  async separateBillable(@Body() body: SeparateBillableQueryDto) {
    return { data: await this.drg.isSeparatelyBillable(body.codes, body.onDate) };
  }

  /** 🔴 스캔한 바코드로 약을 찾는다 — 어느 고시 기준 데이터인지 함께 말한다 */
  @Get('drug-barcode/:gtin')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '바코드(표준코드/대표코드)로 약품 조회 — 0건은 "없는 약"이 아니다' })
  async lookupBarcode(@Param('gtin') gtin: string) {
    return { data: await this.refData.lookupByBarcode(gtin) };
  }

  // ── 동의어·약어 사전 ──

  /**
   * 🔴 발단(2026-08-26 운영 실측): 약어를 치면 **없는 것이 아니라 전혀 다른 것**이 나왔다.
   *    `AMI`→248건(1위 "일반 성인 의학적 검사"=ex**AMI**nation) · `HTN`→11건(전부 "**벼락**"=lig**HTN**ing).
   *    0건보다 나쁘다 — 화면이 자신 있게 틀린 답을 준다.
   *
   * 🔴 **승인된 동의어만 검색에 반영된다.** 배포분에 담긴 사전은 전부 검토 전이며,
   *    승인하기 전까지 검색은 지금과 똑같이 동작한다(조용히 바뀌지 않는다).
   */
  @Get('synonyms')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '코드 동의어·약어 사전 조회(검토 전 건수 포함)' })
  async listSynonyms(
    @Query('sourceTable') sourceTable?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.synonyms.list({
      sourceTable,
      status,
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 🔴 제안은 현장이 한다(어휘를 아는 쪽) · 🔴 **승인은 관리자만**(검색 결과가 바뀐다) */
  @Post('synonyms')
  @UseGuards(RolesGuard)
  @Roles(...SYNONYM_READ_ROLES)
  @ApiOperation({ summary: '동의어 제안 — 승인 전에는 검색에 반영되지 않는다' })
  async proposeSynonym(
    @Body() body: CodeSynonymProposeDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.synonyms.propose({ ...body, userId }) };
  }

  /** 🔴 배포만으로 사전이 들어오지 않는다 — 관리자가 눌러야 등재되고, 승인해야 검색이 달라진다 */
  @Post('synonyms/load-builtin')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기본 약어·구어 사전 등재(검토 전 상태) — 검색은 승인 후에만 달라진다' })
  async loadBuiltinSynonyms(@CurrentUser('id') userId: string) {
    return { data: await this.synonyms.loadBuiltinDictionary(userId) };
  }

  @Post('synonyms/:id/review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '동의어 승인·반려 — 승인한 순간부터 검색이 달라진다' })
  async reviewSynonym(
    @Param('id') id: string,
    @Body() body: CodeSynonymReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.synonyms.review(id, body.decision, userId, body.note);
  }

  // ── 고시 개정 일괄 반영 ──

  /**
   * 🔴 **미리보기는 아무것도 저장하지 않는다.** 파일을 올리면 바로 반영하는 방식은
   *    잘못된 파일 하나로 코드 마스터 전체를 망가뜨린다(수가 166,744건).
   */
  @Post('import/preview')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '고시 개정 파일 차이 리포트(저장하지 않음)' })
  async importPreview(@Body() body: CodeImportDto) {
    return { data: await this.codeImport.preview(body.kind, body.content, body.effectiveDate) };
  }

  @Post('import/apply')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '고시 개정 반영(사람 확인 후) — 수가는 새 버전, 그 외는 덮어쓰기' })
  async importApply(@Body() body: CodeImportDto, @CurrentUser('id') userId: string) {
    return { data: await this.codeImport.apply(body.kind, body.content, body.effectiveDate, userId) };
  }

  // ── 변경 영향(사용처) ──

  /**
   * 🔴 **코드를 중지하기 전에 무엇이 깨지는지 볼 수 있어야 한다**(2026-08-26).
   *    지금까지 관리자는 사용 중인 코드도 그냥 중지할 수 있었고, 그러면 그 코드를 쓰던
   *    처방·오더·문제목록이 조용히 깨졌다. 참조 목록은 손으로 적지 않고 Prisma 메타데이터에서 뽑는다.
   */
  /**
   * 🔴 만료됐는데 **아직 쓰이는** 코드. `validTo` 는 원래 있었는데 그것이 지난 코드를
   *    계속 쓰고 있는지 아무도 보지 않았다. 쓰이지 않는 만료 코드는 경보하지 않는다
   *    (거짓 경보는 진짜 경보를 죽인다).
   */
  @Get(':sourceTable/expired-in-use')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '유효기간이 지났는데 아직 사용 중인 코드' })
  async expiredInUse(@Param('sourceTable') sourceTable: string, @Query('limit') limit?: string) {
    return { data: await this.codeUsage.expiredButUsed(sourceTable, limit ? Number(limit) : 50) };
  }

  @Post(':sourceTable/:id/retire')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '코드 폐지 — 삭제가 아니라 종료일+후속 코드 지정' })
  async retireCode(
    @Param('sourceTable') sourceTable: string,
    @Param('id') id: string,
    @Body() body: CodeRetireDto,
  ) {
    return { data: await this.codeUsage.retire(sourceTable, id, body) };
  }

  @Get(':sourceTable/:id/usage')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '코드 사용처(변경 영향) 조회 — 중지 전 확인' })
  async codeUsageOf(@Param('sourceTable') sourceTable: string, @Param('id') id: string) {
    return { data: await this.codeUsage.getUsage(sourceTable, id) };
  }

  // ── Diagnosis (KCD) ──

  @Get('diagnosis')
  @ApiOperation({ summary: 'KCD 질병코드 검색' })
  async searchDiagnosis(@Query() query: CodeQueryDto) {
    const result = await this.codeMasterService.searchDiagnosis(query);
    return result;
  }

  @Get('diagnosis-groups')
  @ApiOperation({ summary: 'KCD 트리 탐색 — 챕터 범위 내 3자리 분류 그룹(대표명·건수)' })
  async diagnosisGroups(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.codeMasterService.diagnosisGroups(from, to) };
  }

  @Get('diagnosis/:code')
  @ApiOperation({ summary: '질병코드 상세 조회 (KCD-8/ICD-10/ICD-11)' })
  async getDiagnosis(@Param('code') code: string, @Query('codeSystem') codeSystem?: string) {
    const result = await this.codeMasterService.getDiagnosisByCode(code, codeSystem);
    if (!result) throw new NotFoundException(`Diagnosis code ${code} not found`);
    return { data: result };
  }

  // ── Procedure (EDI) ──

  @Get('procedure')
  @ApiOperation({ summary: 'EDI 수가코드 검색' })
  async searchProcedure(@Query() query: CodeQueryDto) {
    const result = await this.codeMasterService.searchProcedure(query);
    return result;
  }

  @Get('procedure/:code')
  @ApiOperation({ summary: 'EDI 코드 상세 조회' })
  async getProcedure(@Param('code') code: string) {
    const result = await this.codeMasterService.getProcedureByCode(code);
    if (!result) throw new NotFoundException(`Procedure code ${code} not found`);
    return { data: result };
  }

  // ── Medication ──

  @Get('medication')
  @ApiOperation({ summary: '약품코드 검색' })
  async searchMedication(@Query() query: CodeQueryDto) {
    const result = await this.codeMasterService.searchMedication(query);
    return result;
  }

  @Get('medication/:code')
  @ApiOperation({ summary: '약품 상세 조회' })
  async getMedication(@Param('code') code: string) {
    const result = await this.codeMasterService.getMedicationByCode(code);
    if (!result) throw new NotFoundException(`Medication code ${code} not found`);
    return { data: result };
  }

  // ── CRUD (Admin) ──

  @Post('diagnosis')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '진단코드 추가' })
  async createDiagnosis(@Body() body: CreateDiagnosisInput) {
    return { data: await this.codeMasterService.createDiagnosis(body) };
  }

  @Patch('diagnosis/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '진단코드 수정' })
  async updateDiagnosis(@Param('id') id: string, @Body() body: UpdateDiagnosisInput) {
    return { data: await this.codeMasterService.updateDiagnosis(id, body) };
  }

  @Delete('diagnosis/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '진단코드 삭제 (비활성화)' })
  async deleteDiagnosis(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Query('reason') reason?: string,
  ) {
    // 🔴 사용 중이면 서버가 막는다 — 화면만 고치면 우회된다. `force` 는 **사유와 함께**만 통한다.
    return { data: await this.codeMasterService.deleteDiagnosis(id, { force: force === 'true', reason }) };
  }

  @Post('procedure')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수가코드 추가' })
  async createProcedure(@Body() body: CreateProcedureInput) {
    return { data: await this.codeMasterService.createProcedure(body) };
  }

  @Patch('procedure/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수가코드 수정' })
  async updateProcedure(@Param('id') id: string, @Body() body: UpdateProcedureInput) {
    return { data: await this.codeMasterService.updateProcedure(id, body) };
  }

  @Delete('procedure/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수가코드 삭제 (비활성화)' })
  async deleteProcedure(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Query('reason') reason?: string,
  ) {
    // 🔴 사용 중이면 서버가 막는다 — 화면만 고치면 우회된다. `force` 는 **사유와 함께**만 통한다.
    return { data: await this.codeMasterService.deleteProcedure(id, { force: force === 'true', reason }) };
  }

  @Post('medication')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '약품코드 추가' })
  async createMedication(@Body() body: CreateMedicationInput) {
    return { data: await this.codeMasterService.createMedication(body) };
  }

  @Patch('medication/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '약품코드 수정' })
  async updateMedication(@Param('id') id: string, @Body() body: UpdateMedicationInput) {
    return { data: await this.codeMasterService.updateMedication(id, body) };
  }

  @Delete('medication/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '약품코드 삭제 (비활성화)' })
  async deleteMedication(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Query('reason') reason?: string,
  ) {
    // 🔴 사용 중이면 서버가 막는다 — 화면만 고치면 우회된다. `force` 는 **사유와 함께**만 통한다.
    return { data: await this.codeMasterService.deleteMedication(id, { force: force === 'true', reason }) };
  }

  // ── 검사항목/투여경로/진료과/수술마취 코드 ──

  @Get('lab-tests')
  @ApiOperation({ summary: '검사항목 코드 검색 (LOINC)' })
  async searchLabTests(@Query('q') q?: string, @Query('category') category?: string) {
    return { data: await this.codeMasterService.searchLabTests(q ?? '', category) };
  }

  @Get('routes')
  @ApiOperation({ summary: '약품 투여경로 목록' })
  async listRoutes() {
    return { data: await this.codeMasterService.listRoutes() };
  }

  @Get('departments')
  @ApiOperation({ summary: '진료과 코드 목록' })
  async listDepartments(@Query('category') category?: string) {
    return { data: await this.codeMasterService.listDepartments(category) };
  }

  @Get('surgery-anesthesia')
  @ApiOperation({ summary: '수술/마취 코드 목록' })
  async listSurgeryAnesthesia(@Query('codeType') codeType?: string) {
    return { data: await this.codeMasterService.listSurgeryAnesthesia(codeType) };
  }

  // ── 표준 매핑 ──

  @Get('mappings')
  @ApiOperation({ summary: '표준 매핑 검색 (SNOMED/LOINC/MedDRA 등)' })
  async getMappings(@Query('sourceTable') sourceTable?: string, @Query('sourceCode') sourceCode?: string, @Query('targetSystem') targetSystem?: string) {
    return { data: await this.codeMasterService.getMappings(sourceTable, sourceCode, targetSystem) };
  }

  @Get('mappings/:sourceTable/:sourceId')
  @ApiOperation({ summary: '특정 코드의 표준 매핑 목록' })
  async getMappingsForCode(@Param('sourceTable') sourceTable: string, @Param('sourceId') sourceId: string) {
    return { data: await this.codeMasterService.getMappingsForCode(sourceTable, sourceId) };
  }

  // 🔴 W7 동반: 매핑 감사 로그(누가 언제 표준코드를 바꿨나)는 운영 기록 — 형제 운영 EP 와 같이 ADMIN.
  //    호출 화면은 /admin/codes 하나뿐이다.
  @Get('mapping-audit/:sourceTable/:sourceId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '특정 코드의 매핑 감사 로그 조회' })
  async getMappingAuditLogs(@Param('sourceTable') sourceTable: string, @Param('sourceId') sourceId: string) {
    return { data: await this.codeMasterService.getMappingAuditLogs(sourceTable, sourceId) };
  }

  @Post('mappings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '표준 매핑 추가' })
  async createMapping(@Body() body: CreateTerminologyMappingDto, @CurrentUser('id') userId: string) {
    // 🔴 (2026-09-15 U1) 작성자는 본문이 아니라 인증 사용자 — E2 가 대량 할당을 막은 뒤 createdBy 가 null 로만 저장됐다
    return { data: await this.codeMasterService.createMapping(body, userId) };
  }

  // ── 간호 코드 ──

  // 🔴 pagination 동봉 — 상한(take)으로 항목이 조용히 사라지지 않게 화면이 총건수를 알아야 한다(W8).
  @Get('nursing')
  @ApiOperation({ summary: '간호코드 검색 (NANDA/NIC/NOC/MedDRA/ICF) — pagination 동봉' })
  async searchNursingCodes(
    @Query('codeSystem') codeSystem?: string,
    @Query('domain') domain?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const r = await this.codeMasterService.searchNursingCodes(codeSystem, domain, q, limit ? Number(limit) : undefined, page ? Number(page) : undefined);
    return { data: r.items, pagination: { total: r.total, page: r.page, limit: r.limit, hasMore: r.hasMore } };
  }

  // ── 자동 매핑 설정 ──

  @Get('auto-map/config')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자동 매핑 설정 조회' })
  async getAutoMapConfig() {
    return { data: await this.autoMapper.getConfig() };
  }

  @Patch('auto-map/config')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자동 매핑 설정 변경' })
  async updateAutoMapConfig(@Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    return { data: await this.autoMapper.setConfig(body, userId) };
  }

  // ── 자동 매핑 ──

  @Post('auto-map')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '단건 자동 매핑 (AI + 규칙)' })
  async autoMap(@Body() body: { sourceTable: string; sourceId: string; targetSystems?: string[]; autoConfirm?: boolean }) {
    return { data: await this.autoMapper.mapSingle(body) };
  }

  @Post('auto-map/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '벌크 자동 매핑 (비동기)' })
  async autoMapBulk(@Body() body: { sourceTable: string; targetSystem: string; filter: string; autoConfirm: boolean; limit?: number }, @CurrentUser('id') userId: string) {
    const batchId = await this.autoMapper.mapBulk({ ...body, userId });
    return { data: { batchId } };
  }

  @Get('auto-map/bulk/:batchId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '벌크 매핑 작업 상태' })
  async getBatchStatus(@Param('batchId') batchId: string) {
    return { data: await this.autoMapper.getBatchStatus(batchId) };
  }

  // 🔴 W7 동반: auto-map/* 형제는 전부 @Roles(ADMIN) 인데 아래 4개만 무제한이었다.
  //    suggest 계열은 외부 AI(WeRU.B)를 호출하는 경로라 인증만 되면 누구나 비용을 태울 수 있었다.
  //    호출 화면은 /admin/codes(관리자 전용) 하나뿐이라 ADMIN 으로 맞춘다.
  @Post('auto-map/suggest')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 매핑 후보 제안 (저장 안 함)' })
  async suggestMapping(@Body() body: { sourceTable: string; sourceId: string; targetSystem: string }) {
    return { data: await this.autoMapper.suggest(body.sourceTable, body.sourceId, body.targetSystem) };
  }

  @Post('auto-map/suggest-by-name')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 매핑 제안 (코드명 기반, 저장 전 미리보기)' })
  async suggestByName(@Body() body: { sourceTable: string; code: string; nameKo: string; nameEn?: string; category?: string; targetSystems?: string[] }) {
    return { data: await this.autoMapper.suggestByName(body) };
  }

  @Get('auto-map/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '매핑 현황 통계' })
  async getMappingStats() {
    return { data: await this.autoMapper.getMappingStats() };
  }

  @Get('auto-map/recent')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '최근 매핑 활동 (최신 20건)' })
  async getRecentActivity() {
    return { data: await this.autoMapper.getRecentActivity() };
  }

  // ── 승인 대기 관리 ──

  @Get('pending-mappings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '승인 대기 매핑 목록' })
  async getPendingMappings(@Query('status') status?: string) {
    return { data: await this.autoMapper.getPendingList(status) };
  }

  @Post('pending-mappings/:id/confirm')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '매핑 승인' })
  async confirmPending(@Param('id') id: string, @Body() body: ConfirmPendingMappingDto, @CurrentUser('id') userId: string) {
    return { data: await this.autoMapper.confirmPending(id, body.selectedCode, userId, body.notes) };
  }

  @Post('pending-mappings/:id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '매핑 거부' })
  async rejectPending(@Param('id') id: string, @Body() body: MappingReviewNotesDto, @CurrentUser('id') userId: string) {
    return { data: await this.autoMapper.rejectPending(id, userId, body.notes) };
  }

  // ── 임상 검토 (의료진/간호파트) ──
  //
  // 🔴 W7(2026-08): 아래 clinical-review 계열 4개(GET 2·POST 2)에 `@UseGuards(RolesGuard)` 와 `@Roles` 가
  //    모두 없었다. 같은 파일의 pending-mappings 계열은 전부 @Roles(ADMIN) 이라 누락이 명백하다.
  //    RolesGuard 는 @Roles 가 없으면 통과시키므로 인증된 아무 역할(RECEPTIONIST·READ 등)이나
  //    "임상 검토 승인"을 남길 수 있었고, 서버는 그 `user.role` 을 그대로 clinicalReviewerRole 에 적어
  //    **검토하지 않은 사람이 검토자로 기록**됐다.
  //    검토 주체 = 임상직(DOCTOR·NURSE·PHARMACIST·LAB_TECH). 소스 테이블이 진단/수가/약품/검사라 4직군 모두 필요.
  //    ⚠️ ADMIN 은 RolesGuard 설계상(role 검사 우회) 어떤 목록에도 무관하게 통과한다 —
  //       Stage3(임상) ↔ Stage4(관리자 확정) 직무분리는 @Roles 로는 강제할 수 없어
  //       auto-mapper.confirmPending() 의 clinicalStatus 게이트로 잡는다.

  @Get('clinical-review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '임상 검토 대기 목록 (의료진/간호사용)' })
  async getClinicalReviewList(
    @Query('clinicalStatus') clinicalStatus?: string,
    @Query('department') department?: string,
    @Query('sourceTable') sourceTable?: string,
    @Query('targetSystem') targetSystem?: string,
  ) {
    return { data: await this.autoMapper.getClinicalReviewList({ clinicalStatus, department, sourceTable, targetSystem }) };
  }

  @Get('clinical-review/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '임상 검토 현황 통계' })
  async getClinicalReviewStats() {
    return { data: await this.autoMapper.getClinicalReviewStats() };
  }

  @Post('clinical-review/:id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '임상 검토 승인 (의료진/간호사)' })
  async clinicalApprove(
    @Param('id') id: string,
    @Body() body: MappingReviewNotesDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.autoMapper.clinicalApprove(id, userId, role, body.notes) };
  }

  @Post('clinical-review/:id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '임상 검토 반려 (의료진/간호사)' })
  async clinicalReject(
    @Param('id') id: string,
    @Body() body: MappingReviewNotesDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.autoMapper.clinicalReject(id, userId, role, body.notes) };
  }

  @Patch('clinical-review/:id/assign')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '임상 검토 부서 배정' })
  async assignDepartment(@Param('id') id: string, @Body() body: AssignMappingDepartmentDto) {
    return { data: await this.autoMapper.assignDepartment(id, body.department, body.priority) };
  }

  // ── Seed ──

  @Post('seed')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '코드 마스터 시딩 (Admin, 초기/업데이트)' })
  async seed() {
    const result = await this.codeMasterService.runSeed();
    return { data: result };
  }
}
