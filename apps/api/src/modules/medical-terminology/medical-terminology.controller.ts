import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { MedicalTerminologyService } from './medical-terminology.service';
import {
  CreateDiagnosisCodeDto,
  UpdateDiagnosisCodeDto,
  CreateMedicationCodeDto,
  UpdateMedicationCodeDto,
  SearchCodeDto,
  DrugInteractionCheckDto,
  DURCheckDto,
  ContraindicationCheckDto,
  ValidationResultDto,
} from './dto/medical-terminology.dto';

@ApiTags('Medical Terminology')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/medical-terminology')
export class MedicalTerminologyController {
  constructor(private readonly service: MedicalTerminologyService) {}

  // ============================================================
  // Diagnosis Code Endpoints
  // ============================================================

  @Post('diagnosis-codes')
  @RequirePermission(Permission.CODE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '질병 코드 생성' })
  @ApiResponse({ status: 201, description: '질병 코드 생성 완료' })
  async createDiagnosisCode(@Body() dto: CreateDiagnosisCodeDto) {
    const code = await this.service.createDiagnosisCode(dto);
    return { data: code, meta: { status: 'created' } };
  }

  @Get('diagnosis-codes/search')
  @RequirePermission(Permission.CODE_MANAGE)
  @ApiOperation({ summary: '질병 코드 검색' })
  @ApiResponse({ status: 200, description: '검색 결과 반환' })
  async searchDiagnosisCodes(@Query() dto: SearchCodeDto) {
    const result = await this.service.searchDiagnosisCodes(dto);
    return { data: result.results, meta: { total: result.total, page: result.page } };
  }

  @Get('diagnosis-codes/:id')
  @RequirePermission(Permission.CODE_MANAGE)
  @ApiOperation({ summary: '질병 코드 상세 조회' })
  @ApiResponse({ status: 200, description: '상세 정보 반환' })
  async getDiagnosisCodeDetail(@Param('id') id: string) {
    const code = await this.service.getDiagnosisCodeDetail(id);
    return { data: code };
  }

  @Put('diagnosis-codes/:id')
  @RequirePermission(Permission.CODE_MANAGE)
  @ApiOperation({ summary: '질병 코드 수정' })
  @ApiResponse({ status: 200, description: '수정 완료' })
  async updateDiagnosisCode(@Param('id') id: string, @Body() dto: UpdateDiagnosisCodeDto) {
    const code = await this.service.updateDiagnosisCode(id, dto);
    return { data: code };
  }

  @Delete('diagnosis-codes/:id')
  @RequirePermission(Permission.CODE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '질병 코드 삭제' })
  @ApiResponse({ status: 204, description: '삭제 완료' })
  async deleteDiagnosisCode(@Param('id') id: string) {
    await this.service.deleteDiagnosisCode(id);
  }

  // ============================================================
  // Medication Code Endpoints
  // ============================================================

  @Post('medication-codes')
  @RequirePermission(Permission.CODE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '약품 코드 생성' })
  @ApiResponse({ status: 201, description: '약품 코드 생성 완료' })
  async createMedicationCode(@Body() dto: CreateMedicationCodeDto) {
    const code = await this.service.createMedicationCode(dto);
    return { data: code, meta: { status: 'created' } };
  }

  @Get('medication-codes/search')
  @RequirePermission(Permission.CODE_MANAGE)
  @ApiOperation({ summary: '약품 코드 검색' })
  @ApiResponse({ status: 200, description: '검색 결과 반환' })
  async searchMedicationCodes(@Query() dto: SearchCodeDto) {
    const result = await this.service.searchMedicationCodes(dto);
    return { data: result.results, meta: { total: result.total, page: result.page } };
  }

  @Get('medication-codes/:id')
  @RequirePermission(Permission.CODE_MANAGE)
  @ApiOperation({ summary: '약품 코드 상세 조회' })
  @ApiResponse({ status: 200, description: '상세 정보 반환' })
  async getMedicationCodeDetail(@Param('id') id: string) {
    const med = await this.service.getMedicationCodeDetail(id);
    return { data: med };
  }

  @Put('medication-codes/:id')
  @RequirePermission(Permission.CODE_MANAGE)
  @ApiOperation({ summary: '약품 코드 수정' })
  @ApiResponse({ status: 200, description: '수정 완료' })
  async updateMedicationCode(@Param('id') id: string, @Body() dto: UpdateMedicationCodeDto) {
    const med = await this.service.updateMedicationCode(id, dto);
    return { data: med };
  }

  @Delete('medication-codes/:id')
  @RequirePermission(Permission.CODE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '약품 코드 삭제' })
  @ApiResponse({ status: 204, description: '삭제 완료' })
  async deleteMedicationCode(@Param('id') id: string) {
    await this.service.deleteMedicationCode(id);
  }

  // ============================================================
  // Validation Endpoints
  // ============================================================

  @Post('validate/interactions')
  @RequirePermission(Permission.PRESCRIPTION_VIEW)
  @ApiOperation({ summary: '약물 상호작용 검사' })
  @ApiResponse({ status: 200, description: '검사 결과 반환' })
  async checkDrugInteractions(
    @Body() dto: DrugInteractionCheckDto,
  ): Promise<{ data: ValidationResultDto }> {
    const result = await this.service.checkDrugInteractions(dto);
    return { data: result };
  }

  @Post('validate/dur')
  @RequirePermission(Permission.PRESCRIPTION_VIEW)
  @ApiOperation({ summary: 'DUR(약물이용평가) 검사' })
  @ApiResponse({ status: 200, description: 'DUR 검사 결과 반환' })
  async checkDUR(@Body() dto: DURCheckDto): Promise<{ data: ValidationResultDto }> {
    const result = await this.service.checkDUR(dto);
    return { data: result };
  }

  @Post('validate/contraindications')
  @RequirePermission(Permission.PRESCRIPTION_VIEW)
  @ApiOperation({ summary: '금기 사항 검사' })
  @ApiResponse({ status: 200, description: '금기 검사 결과 반환' })
  async checkContraindications(
    @Body() dto: ContraindicationCheckDto,
  ): Promise<{ data: ValidationResultDto }> {
    const result = await this.service.checkContraindications(dto);
    return { data: result };
  }

  // ============================================================
  // Bulk Operations
  // ============================================================

  @Post('diagnosis-codes/import')
  @RequirePermission(Permission.CODE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '질병 코드 대량 import' })
  @ApiResponse({ status: 201, description: 'import 결과 반환' })
  async importDiagnosisCodes(@Body() codes: CreateDiagnosisCodeDto[]) {
    const result = await this.service.importDiagnosisCodes(codes);
    return { data: result, meta: { status: 'imported' } };
  }

  @Post('medication-codes/import')
  @RequirePermission(Permission.CODE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '약품 코드 대량 import' })
  @ApiResponse({ status: 201, description: 'import 결과 반환' })
  async importMedicationCodes(@Body() codes: CreateMedicationCodeDto[]) {
    const result = await this.service.importMedicationCodes(codes);
    return { data: result, meta: { status: 'imported' } };
  }
}
