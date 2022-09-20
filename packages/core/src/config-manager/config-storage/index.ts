import { ConduitCommons } from '@conduitplatform/commons';
import ConduitGrpcSdk from '@conduitplatform/grpc-sdk';
import { clearInterval } from 'timers';
import * as models from '../models';
import { ServiceDiscovery } from '../service-discovery';

export class ConfigStorage {
  toBeReconciled: string[] = [];
  reconciling: boolean = false;
  private configDocId: string | null = null;

  constructor(
    private readonly commons: ConduitCommons,
    private readonly grpcSdk: ConduitGrpcSdk,
    private readonly serviceDiscovery: ServiceDiscovery,
  ) {
    this.highAvailability();
  }

  onDatabaseAvailable() {
    this.firstSync()
      .then(() => {
        ConduitGrpcSdk.Logger.log('Reconciliation with db successful');
        this.changeState(false);
        this.reconcileMonitor();
      })
      .catch(() => {
        this.changeState(false);
        ConduitGrpcSdk.Logger.error('Reconciliation with db failed!');
      });
  }

  highAvailability() {
    this.grpcSdk.bus!.subscribe('config', (message: string) => {
      if (message === 'reconciling') {
        this.reconciling = true;
      } else if (message === 'reconcile-done') {
        this.reconciling = false;
      }
    });
  }

  changeState(reconciling: boolean) {
    this.reconciling = reconciling;
    this.grpcSdk.bus!.publish('config', reconciling ? 'reconciling' : 'reconcile-done');
  }

  async firstSync() {
    this.changeState(true);
    let configDoc: models.Config[] | null = await models.Config.getInstance().findMany(
      {},
    );

    if (configDoc.length === 0 || !configDoc) {
      // flush redis stored configuration to the database
      for (const key in this.serviceDiscovery.registeredModules.keys()) {
        try {
          const moduleConfig = await this.getConfig(key, false);
          const newConfig = await models.Config.getInstance().create({});
          await models.Config.getInstance().findByIdAndUpdate(newConfig._id, {
            name: key,
            config: moduleConfig,
          });
        } catch {}
      }
      for (const key of ['core', 'admin']) {
        try {
          const moduleConfig = await this.getConfig(key, false);
          const newConfig = await models.Config.getInstance().create({});
          await models.Config.getInstance().findByIdAndUpdate(newConfig._id, {
            name: key,
            config: moduleConfig,
          });
        } catch {}
      }
    } else {
      // patch database with new config keys
      for (const config of configDoc) {
        const dbConfig = await models.Config.getInstance().findOne({ name: config.name });
        let redisConfig;
        try {
          redisConfig = await this.getConfig(config.name, false);
          redisConfig = { ...redisConfig, ...dbConfig!.config };
        } catch (e) {
          redisConfig = dbConfig!.config;
        }
        await this.setConfig(config.name, JSON.stringify(redisConfig), false);
        await models.Config.getInstance().findByIdAndUpdate(dbConfig!._id, {
          config: redisConfig,
        });
      }
    }
    // Update Admin and all active modules
    const adminConfig = await models.Config.getInstance().findOne({ name: 'admin' });
    this.commons.getAdmin().handleConfigUpdate(adminConfig!.config);
    const registeredModules = Array.from(this.serviceDiscovery.registeredModules.keys());
    const moduleConfigs: models.Config[] | null =
      await models.Config.getInstance().findMany({});
    for (const config of moduleConfigs) {
      if (config.name === 'core' || config.name === 'admin') continue;
      if (registeredModules.includes(config.name)) {
        this.grpcSdk.bus!.publish(
          `${config.name}:config:update`,
          JSON.stringify(config.config),
        );
      }
    }
  }

  reconcileMonitor() {
    const reconciliationInterval = setInterval(() => {
      if (this.grpcSdk.isAvailable('database') && this.toBeReconciled.length > 0) {
        this.reconcile();
      }
      // add a random extra amount to mitigate race-conditions,
      // between core instances
    }, 1500 + Math.floor(Math.random() * 300));

    process.on('exit', () => {
      clearInterval(reconciliationInterval);
    });
  }

  reconcile() {
    this.changeState(true);
    const promises = this.toBeReconciled.map(moduleName => {
      return this.getConfig(moduleName, false).then(config =>
        models.Config.getInstance().findByIdAndUpdate(this.configDocId!, {
          $set: { [`moduleConfigs.${moduleName}`]: config },
        }),
      );
    });
    Promise.all(promises)
      .then(() => {
        ConduitGrpcSdk.Logger.log('Module configurations reconciled!');
        this.toBeReconciled = [];
        this.changeState(false);
      })
      .catch(e => {
        ConduitGrpcSdk.Logger.error('Module configurations failed to reconcile!');
        ConduitGrpcSdk.Logger.error(e);
        this.changeState(false);
      });
  }

  async waitForReconcile() {
    while (this.reconciling) {
      await new Promise(resolve => {
        setTimeout(resolve, 200);
      });
    }
  }

  async getConfig(moduleName: string, waitReconcile: boolean = true) {
    if (waitReconcile) {
      await this.waitForReconcile();
    }

    const config: string | null = await this.grpcSdk.state!.getKey(`${moduleName}`);
    if (!config) {
      throw new Error('Config not found for ' + moduleName);
    }
    return JSON.parse(config);
  }

  async setConfig(moduleName: string, config: string, waitReconcile: boolean = true) {
    if (waitReconcile) {
      await this.waitForReconcile();
    }
    await this.grpcSdk.state!.setKey(`${moduleName}`, config);
    if (!this.toBeReconciled.includes(moduleName) && waitReconcile) {
      this.toBeReconciled.push(moduleName);
    }
  }
}
