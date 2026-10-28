import {
  Controller, Get, Post, Param, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BlockchainAnchorService } from './blockchain-anchor.service';

@ApiTags('Blockchain Anchor (블록체인 앵커)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/blockchain-anchor')
export class BlockchainAnchorController {
  constructor(private readonly service: BlockchainAnchorService) {}

  @Get('stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '앵커 상태별 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Get('verify/:dataHash')
  @ApiOperation({ summary: '데이터 해시 검증' })
  async verifyByDataHash(@Param('dataHash') dataHash: string) {
    return { data: await this.service.verifyByDataHash(dataHash) };
  }

  @Get(':txHash')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'txHash로 앵커 조회' })
  async getByTxHash(@Param('txHash') txHash: string) {
    return { data: await this.service.getByTxHash(txHash) };
  }

  @Post('batch')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '배치 앵커링 (PENDING → CONFIRMED)' })
  async batchAnchor() {
    return { data: await this.service.batchAnchor() };
  }

  @Post('qr-code/:signedDocumentId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'QR 코드 데이터 생성' })
  async generateQrCode(@Param('signedDocumentId', ParseUUIDPipe) signedDocumentId: string) {
    return { data: await this.service.generateQrCode(signedDocumentId) };
  }
}
