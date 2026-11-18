import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RefreshToken,
  RefreshTokenSchema,
} from '../auth/schemas/refresh-token.schema';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      // Also registered here (same model on the same connection) so UsersService can revoke
      // sessions without importing AuthModule, which already imports UsersModule.
      { name: RefreshToken.name, schema: RefreshTokenSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
