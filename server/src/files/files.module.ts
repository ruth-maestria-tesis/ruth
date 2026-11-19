import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlobStorage,
  STORAGE_DRIVER,
  type StorageDriver,
} from './blob-storage';
import { FilesService } from './files.service';

@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriver =>
        config.get<StorageDriver>('STORAGE_DRIVER') ?? 'gridfs',
    },
    BlobStorage,
    FilesService,
  ],
  exports: [FilesService],
})
export class FilesModule {}
