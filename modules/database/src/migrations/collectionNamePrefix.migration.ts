import { DatabaseAdapter } from '../adapters/DatabaseAdapter';
import { MongooseSchema } from '../adapters/mongoose-adapter/MongooseSchema';
import { SequelizeSchema } from '../adapters/sequelize-adapter/SequelizeSchema';

export async function migrateCollectionNamePrefix(
  adapter: DatabaseAdapter<MongooseSchema | SequelizeSchema>,
) {
  const model = adapter.getSchemaModel('_DeclaredSchema').model;
  const schemas = await model.findMany({});
  for (const schema of schemas) {
    const { collectionName } = schema.modelOptions.conduit;
    if (collectionName) {
      const newCollectionName = `cnd_${schema.name}`;
      await model.findByIdAndUpdate(schema._id.toString(), {
        collectionName: newCollectionName,
      });
    }
  }
}
