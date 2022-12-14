import ConduitGrpcSdk, { Migration } from '@conduitplatform/grpc-sdk';
import { migrateIsSuperAdminToAdmin } from './migrateIsSuperAdminToAdmin';

// export async function runMigrations(grpcSdk: ConduitGrpcSdk) {
//   // ...
//   await migrateIsSuperAdminToAdmin();
// }

const rawMigrateAdmin = {
  schemaName: 'Admin',
  from: '0.14.0',
  to: '0.15.0',
  up: async (grpcSdk: ConduitGrpcSdk) => {
    const query = {
      mongoQuery: {
        updateOne: {},
        options: {
          $set: { isSuperAdmin: true },
        },
      },
      sqlQuery: {
        query:
          'ALTER TABLE IF EXISTS "cnd_Admin" ADD COLUMN "isSuperAdmin";' +
          'UPDATE TABLE IF EXISTS "cnd_Admin" SET isSuperAdmin=true;',
      },
    };
    await grpcSdk.database!.rawQuery('Admin', query);
  },
  down: async (grpcSdk: ConduitGrpcSdk) => {},
};

export const migrationFilesArray: Array<Migration> = [rawMigrateAdmin];
