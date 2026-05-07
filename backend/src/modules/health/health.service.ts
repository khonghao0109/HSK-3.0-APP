import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async checkDatabase() {
    // FIX: dùng $queryRaw tagged template thay vì $queryRawUnsafe
    // $queryRawUnsafe nhận string thuần — dễ bị SQL injection nếu sau này
    // thêm dynamic param. $queryRaw với tagged template luôn parameterized.
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      success: true,
      database: 'connected',
      env: this.configService.get<string>('app.env'),
      port: this.configService.get<number>('app.port'),
    };
  }
}
