const {isNil} = require('lodash');

async function configureFromDatabase(app){
  const db = app.conduit.database.getDbAdapter();

  const config = app.conduit.config;

  let dbConfig = await db.getSchema('Config').findOne({});

  if (isNil(dbConfig)) {
    return db.getSchema('Config').create({ config: config.get() });
  }

  config.load(dbConfig.config);

  return;
}

module.exports.configureFromDatabase = configureFromDatabase;