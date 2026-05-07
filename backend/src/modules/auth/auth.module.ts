import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { StringValue } from 'ms';

import { PrismaModule } from '../../prisma/prisma.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwtSecrets =
          configService.getOrThrow<Record<string, string>>('jwt.secrets');
        const activeKid = configService.get<string>('jwt.activeKid') ?? 'v1';
        const secret = jwtSecrets[activeKid];
        if (!secret) {
          throw new Error(`Missing JWT secret for active kid "${activeKid}".`);
        }
        const expiresIn = (configService.get<string>('jwt.expiresIn') ??
          '7d') as StringValue;

        return {
          secret,
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
