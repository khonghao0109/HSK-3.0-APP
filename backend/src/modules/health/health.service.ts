import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private prisma: PrismaService) {}

  async checkDatabase() {
    await this.prisma.$queryRawUnsafe('SELECT 1');

    return {
      success: true,
      database: 'connected',
    };
  }
}
