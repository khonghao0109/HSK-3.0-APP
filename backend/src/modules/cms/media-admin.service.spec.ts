import { CmsActor } from './cms-workflow';
import { MediaAdminService } from './media-admin.service';

/** Q104/TL-36: the media list tells the console whether ingestion is on. */

const ADMIN: CmsActor = { id: 7, role: 'admin' };

function serviceWith(flag: boolean | undefined) {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    media: { findMany, count },
  };
  const get = jest.fn().mockReturnValue(flag);
  return {
    service: new MediaAdminService(prisma as never, { get } as never),
    get,
  };
}

describe('MediaAdminService.listMedia ingestion flag (TL-36)', () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])(
    'config media.ingestionEnabled=%s → extraMeta.ingestionEnabled=%s',
    async (flag, expected) => {
      const { service, get } = serviceWith(flag);

      const result = await service.listMedia(ADMIN, { page: 1, limit: 1 });

      expect(get).toHaveBeenCalledWith('media.ingestionEnabled');
      expect(result.extraMeta).toEqual({ ingestionEnabled: expected });
    },
  );
});
