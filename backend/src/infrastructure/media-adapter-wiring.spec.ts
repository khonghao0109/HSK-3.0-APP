import { createHash } from 'node:crypto';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { envValidationSchema } from '../config/env.validation';
import mediaConfig from '../config/media.config';

import { ClamavMediaMalwareScanner } from './malware/clamav-media-malware-scanner';
import {
  createMediaMalwareScanner,
  MalwareModule,
} from './malware/malware.module';
import { MEDIA_MALWARE_SCANNER } from './malware/media-malware-scanner.port';
import { TestMediaMalwareScanner } from './malware/test-media-malware-scanner';
import { InMemoryObjectStorageAdapter } from './storage/in-memory-object-storage.adapter';
import { OBJECT_STORAGE } from './storage/object-storage.port';
import { S3ObjectStorageAdapter } from './storage/s3-object-storage.adapter';
import {
  createObjectStorageAdapter,
  StorageModule,
} from './storage/storage.module';

describe('media adapter wiring', () => {
  describe('provider factories', () => {
    const memory = new InMemoryObjectStorageAdapter();
    const scanner = new TestMediaMalwareScanner();
    const config = (providers: Record<string, string>) =>
      ({
        getOrThrow: (key: string) => {
          const values: Record<string, string | number> = {
            'media.bucket': 'hsk-private-media',
            'media.region': 'ap-southeast-1',
            'media.scannerHost': 'clamav.internal',
            'media.scannerPort': 3310,
            ...providers,
          };
          if (!(key in values)) throw new Error(`Missing config ${key}`);
          return values[key];
        },
        get: () => undefined,
      }) as unknown as ConfigService;

    it('uses the test doubles only when they are named', () => {
      const doubles = config({
        'media.storageProvider': 'memory',
        'media.scannerProvider': 'test',
      });
      expect(createObjectStorageAdapter(memory, doubles)).toBe(memory);
      expect(createMediaMalwareScanner(scanner, doubles)).toBe(scanner);
    });

    it('uses S3 and ClamAV when named, whatever NODE_ENV says', () => {
      const real = config({
        'media.storageProvider': 's3',
        'media.scannerProvider': 'clamav',
      });
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      try {
        expect(createObjectStorageAdapter(memory, real)).toBeInstanceOf(
          S3ObjectStorageAdapter,
        );
        expect(createMediaMalwareScanner(scanner, real)).toBeInstanceOf(
          ClamavMediaMalwareScanner,
        );
      } finally {
        process.env.NODE_ENV = previous;
      }
    });

    it.each([
      ['an unknown', 'minio'],
      ['a differently cased', 'S3'],
      ['a missing', undefined],
    ])('fails closed on %s provider', (_, value) => {
      const broken = config(
        value === undefined
          ? {}
          : { 'media.storageProvider': value, 'media.scannerProvider': value },
      );
      expect(() => createObjectStorageAdapter(memory, broken)).toThrow();
      expect(() => createMediaMalwareScanner(scanner, broken)).toThrow();
    });
  });

  describe('application configuration', () => {
    const secret = (purpose: string) =>
      createHash('sha256').update(`h9-wiring-${purpose}`).digest('base64');
    const common = {
      DATABASE_URL: 'postgresql://user:password@localhost:5432/hsk_test',
      JWT_SECRETS: JSON.stringify({ v1: secret('jwt') }),
      JWT_ACTIVE_KID: 'v1',
    };
    const production = {
      ...common,
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://admin.example.com',
      AUTH_PASSWORD_PEPPER: secret('pepper'),
      MEDIA_STORAGE_BUCKET: 'hsk-private-media',
      MEDIA_STORAGE_REGION: 'ap-southeast-1',
      MEDIA_SIGNING_SECRET: secret('signing'),
      MEDIA_SCANNER_HOST: 'clamav.internal',
      MEDIA_METRICS_BEARER_TOKEN: secret('metrics'),
      MEDIA_METRICS_HOST: '127.0.0.1',
      MEDIA_METRICS_PORT: '9464',
    };
    const testDoubles = {
      ...common,
      NODE_ENV: 'test',
      MEDIA_STORAGE_PROVIDER: 'memory',
      MEDIA_SCANNER_PROVIDER: 'test',
      MEDIA_SIGNING_SECRET: secret('signing'),
      MEDIA_METRICS_BEARER_TOKEN: secret('metrics'),
    };

    const originalEnvironment = process.env;
    afterEach(() => {
      process.env = originalEnvironment;
    });

    /** The same ConfigModule options as AppModule, over a clean environment. */
    const loadConfig = (environment: Record<string, string>) => {
      process.env = { ...environment };
      return ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [mediaConfig],
        validationSchema: envValidationSchema,
      });
    };

    const resolveAdapters = async (environment: Record<string, string>) => {
      const moduleRef = await Test.createTestingModule({
        imports: [await loadConfig(environment), StorageModule, MalwareModule],
      }).compile();
      try {
        return {
          storage: moduleRef.get<unknown>(OBJECT_STORAGE),
          scanner: moduleRef.get<unknown>(MEDIA_MALWARE_SCANNER),
          memory: moduleRef.get(InMemoryObjectStorageAdapter),
          testScanner: moduleRef.get(TestMediaMalwareScanner),
        };
      } finally {
        await moduleRef.close();
      }
    };

    it('injects the in-memory adapter and test scanner when named under NODE_ENV=test', async () => {
      const adapters = await resolveAdapters(testDoubles);

      expect(adapters.storage).toBe(adapters.memory);
      expect(adapters.scanner).toBe(adapters.testScanner);
    });

    it('injects S3 and ClamAV for a production configuration', async () => {
      const adapters = await resolveAdapters(production);

      expect(adapters.storage).toBeInstanceOf(S3ObjectStorageAdapter);
      expect(adapters.scanner).toBeInstanceOf(ClamavMediaMalwareScanner);
    });

    it('injects S3 and ClamAV under NODE_ENV=test unless the doubles are named', async () => {
      const adapters = await resolveAdapters({
        ...production,
        NODE_ENV: 'test',
      });

      expect(adapters.storage).toBeInstanceOf(S3ObjectStorageAdapter);
      expect(adapters.scanner).toBeInstanceOf(ClamavMediaMalwareScanner);
    });

    it.each<Record<string, string>>([
      { MEDIA_STORAGE_PROVIDER: 'memory' },
      { MEDIA_SCANNER_PROVIDER: 'test' },
    ])(
      'refuses to start production with %j before any adapter exists',
      async (override) => {
        await expect(
          loadConfig({ ...production, ...override }),
        ).rejects.toThrow('Config validation error');
      },
    );
  });
});
