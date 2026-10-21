import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { PrismaService } from '../../prisma/prisma.service';

import { assertAdminActor, CmsActor } from './cms-workflow';
import { AdminDataSourceDto } from './dto/admin-exercise-response.dto';

/**
 * TL-26: only the public identity of a source is exposed on the admin console
 * list. `license`, `notes`, `contentHash`, `createdById`, audit timestamps and
 * provenance fields stay server-side; the select is the single source of truth
 * for that boundary.
 */
export const DATA_SOURCE_ADMIN_SELECT = {
  id: true,
  code: true,
  name: true,
  version: true,
} satisfies Prisma.DataSourceSelect;

const DATA_SOURCE_ADMIN_ORDER: Prisma.DataSourceOrderByWithRelationInput[] = [
  { name: 'asc' },
  { version: 'desc' },
  { id: 'asc' },
];

@Injectable()
export class DataSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async listDataSources(
    actor: CmsActor,
    query: PaginationQueryDto,
  ): Promise<ApiSuccessResponse<AdminDataSourceDto[]>> {
    assertAdminActor(actor);
    const skip = (query.page - 1) * query.limit;
    const [dataSources, total] = await this.prisma.$transaction([
      this.prisma.dataSource.findMany({
        orderBy: DATA_SOURCE_ADMIN_ORDER,
        skip,
        take: query.limit,
        select: DATA_SOURCE_ADMIN_SELECT,
      }),
      this.prisma.dataSource.count(),
    ]);
    return {
      success: true,
      data: dataSources,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
