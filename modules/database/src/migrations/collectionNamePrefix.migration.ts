import { DatabaseAdapter } from '../adapters/DatabaseAdapter';
import { MongooseSchema } from '../adapters/mongoose-adapter/MongooseSchema';
import { SequelizeSchema } from '../adapters/sequelize-adapter/SequelizeSchema';
import { MongooseAdapter } from '../adapters/mongoose-adapter';
import { SequelizeAdapter, sqlSchemaName } from '../adapters/sequelize-adapter';
import ConduitGrpcSdk from '@conduitplatform/grpc-sdk';

export async function checkSystemSchemasExistence(
  adapter: DatabaseAdapter<MongooseSchema | SequelizeSchema>,
) {
  let systemSchemasIncluded = false;
  if (adapter instanceof MongooseAdapter) {
    const collections = (
      await (adapter as MongooseAdapter).mongoose.connection.db
        .listCollections()
        .toArray()
    ).map(c => c.name);
    systemSchemasIncluded = collections.includes('_declaredschemas');
  } else if (adapter instanceof SequelizeAdapter) {
    const tableNames: string[] = (
      await (adapter as SequelizeAdapter).sequelize.query(
        `select * from pg_tables where schemaname='${sqlSchemaName}';`,
      )
    )[0].map((t: any) => t.tablename);
    systemSchemasIncluded = tableNames.includes('_DeclaredSchema');
  }
  return systemSchemasIncluded;
}

export async function renameSystemSchemas(
  adapter: DatabaseAdapter<MongooseSchema | SequelizeSchema>,
) {
  if (adapter instanceof MongooseAdapter) {
    const db = (adapter as MongooseAdapter).mongoose.connection.db;

    let systemSchemaNames = (
      await db.collection('_declaredschemas').find().toArray()
    ).map((collection: any) => {
      if (
        !collection.modelOptions.conduit.imported &&
        !collection.modelOptions.conduit.cms?.enabled
      ) {
        return collection.collectionName;
      }
    });
    systemSchemaNames.push('_declaredschemas');
    const newCollectionNames = systemSchemaNames.map(collection =>
      collection.startsWith('_') ? `cnd${collection}` : `cnd_${collection}`,
    );
    await Promise.all(
      systemSchemaNames.map(async (collection, index) => {
        await db.collection(collection).rename(newCollectionNames[index]);
      }),
    );
  } else if (adapter instanceof SequelizeAdapter) {
    const initialCollectionNames = [
      '_DeclaredSchema',
      '_PendingSchemas',
      'CustomEndpoints',
    ];
    const newCollectionNames = initialCollectionNames.map(name =>
      name.startsWith('_') ? `cnd${name}` : `cnd_${name}`,
    );
    await Promise.all(
      initialCollectionNames.map(async (name, index) => {
        await (adapter as SequelizeAdapter).sequelize.query(
          `ALTER TABLE ${sqlSchemaName}.${name} RENAME TO ${sqlSchemaName}.${newCollectionNames[index]}`,
        );
      }),
    );
  }
}
