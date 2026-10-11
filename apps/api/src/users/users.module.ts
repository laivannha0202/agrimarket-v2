import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { LocationsModule } from '../locations/locations.module.js';

@Module({
  // `LocationsModule` supplies the verified commune catalogue used to validate
  // and resolve `wardCode` on every address write.
  imports: [LocationsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
