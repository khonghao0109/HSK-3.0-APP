import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { PrismaService } from '../../prisma/prisma.service';

// Never add password, lockout counters or other credential state here.
const USER_ITEM_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type UserItem = Prisma.UserGetPayload<{ select: typeof USER_ITEM_SELECT }>;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'active', deletedAt: null },
      select: USER_ITEM_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  async getAllUsers(
    query: PaginationQueryDto,
  ): Promise<ApiSuccessResponse<UserItem[]>> {
    const where = { deletedAt: null } satisfies Prisma.UserWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_ITEM_SELECT,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
