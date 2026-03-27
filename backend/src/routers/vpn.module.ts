import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VpnService } from './vpn.service';

@Module({
  imports: [ConfigModule],
  providers: [VpnService],
  exports: [VpnService],
})
export class VpnModule {}
