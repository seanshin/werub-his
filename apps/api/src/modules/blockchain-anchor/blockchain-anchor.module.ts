import { Module } from '@nestjs/common';
import { BlockchainAnchorController } from './blockchain-anchor.controller';
import { BlockchainAnchorService } from './blockchain-anchor.service';

@Module({
  controllers: [BlockchainAnchorController],
  providers: [BlockchainAnchorService],
  exports: [BlockchainAnchorService],
})
export class BlockchainAnchorModule {}
