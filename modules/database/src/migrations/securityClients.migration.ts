import ConduitGrpcSdk from '@conduitplatform/grpc-sdk';

module.exports = {
  up: async function (grpcSdk: ConduitGrpcSdk) {
    const database = grpcSdk.database!;
    const query = {
      mongoQuery: {
        updateMany: {
          name: 'Client',
        },
        options: {
          $set: { ownerModule: 'router' },
        },
      },
      sqlQuery: {
        query: `UPDATE "cnd_DeclaredSchema" SET "ownerModule" = 'router' WHERE name = 'Client'`,
      },
    };
    await database.rawQuery('_DeclaredSchema', query);
  },
  down: async function (grpcSdk: ConduitGrpcSdk) {
    console.log('Executed down function!');
  },
};
