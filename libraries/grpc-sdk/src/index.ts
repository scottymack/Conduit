import {
  Admin,
  Chat,
  Config,
  Core,
  DatabaseProvider,
  Forms,
  Router,
  Communicator,
  Storage,
  Authorization,
  Authentication,
} from './modules';
import Crypto from 'crypto';
import { EventBus } from './utilities/EventBus';
import { RedisManager } from './utilities/RedisManager';
import { StateManager } from './utilities/StateManager';
import { CompatServiceDefinition } from 'nice-grpc/lib/service-definitions';
import { ConduitModule } from './classes/ConduitModule';
import { Client } from 'nice-grpc';
import { status } from '@grpc/grpc-js';
import { sleep } from './utilities';
import {
  HealthCheckResponse_ServingStatus,
  HealthDefinition,
} from './protoUtils/grpc_health_check';
import {
  GetRedisDetailsResponse,
  ModuleListResponse_ModuleResponse,
} from './protoUtils/core';
import { GrpcError, HealthCheckStatus } from './types';
import { createSigner } from 'fast-jwt';
import { checkModuleHealth } from './classes/HealthCheck';
import { ConduitLogger, setupLoki } from './utilities/Logger';
import winston from 'winston';
import path from 'path';
import { ConduitMetrics } from './metrics';
import { PushNotifications } from './modules/communicator/pushNotifications';
import { Email } from './modules/communicator/email';
import { SMS } from './modules/communicator/sms';

export default class ConduitGrpcSdk {
  private readonly serverUrl: string;
  private readonly _watchModules: boolean;
  private readonly _core?: Core;
  private readonly _config?: Config;
  private readonly _admin?: Admin;
  private _redisDetails?: { host: string; port: number };
  private readonly _modules: { [key: string]: ConduitModule<any> } = {};
  private readonly _availableModules: any = {
    router: Router,
    database: DatabaseProvider,
    storage: Storage,
    authentication: Authentication,
    authorization: Authorization,
    chat: Chat,
    forms: Forms,
    communicator: Communicator,
  };
  private _dynamicModules: { [key: string]: CompatServiceDefinition } = {};
  private _eventBus?: EventBus;
  private _stateManager?: StateManager;
  private lastSearch: number = Date.now();
  private readonly name: string;
  private readonly instance: string;
  private readonly _serviceHealthStatusGetter: Function;
  private readonly _grpcToken?: string;
  private _initialized: boolean = false;
  static Metrics?: ConduitMetrics;
  static readonly Logger: ConduitLogger = new ConduitLogger([
    new winston.transports.File({
      filename: path.join(__dirname, '.logs/combined.log'),
      level: 'info',
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '.logs/errors.log'),
      level: 'error',
    }),
  ]);

  constructor(
    serverUrl: string,
    serviceHealthStatusGetter: Function,
    name?: string,
    watchModules = true,
    private readonly urlRemap?: string,
  ) {
    if (!name) {
      this.name = 'module_' + Crypto.randomBytes(16).toString('hex');
    } else {
      this.name = name;
    }
    this.instance = this.name.startsWith('module_')
      ? this.name.substring(8)
      : Crypto.randomBytes(16).toString('hex');

    if (process.env.METRICS_PORT) {
      ConduitGrpcSdk.Metrics = new ConduitMetrics(this.name, this.instance);
      ConduitGrpcSdk.Metrics.setDefaultLabels({
        module_instance: this.instance,
      });
    }
    setupLoki(this.name, this.instance).then();
    this.serverUrl = serverUrl;
    this._watchModules = watchModules;
    this._serviceHealthStatusGetter = serviceHealthStatusGetter;
    if (process.env.GRPC_KEY) {
      const sign = createSigner({ key: process.env.GRPC_KEY });
      this._grpcToken = sign({
        moduleName: this.name,
      });
    }
  }

  async initialize() {
    if (this.name === 'core') {
      return this._initialize();
    }
    (this._core as unknown) = new Core(this.name, this.serverUrl, this._grpcToken);
    ConduitGrpcSdk.Logger.log('Waiting for Core...');
    while (true) {
      try {
        const state = await this.core.check();
        if ((state as unknown as HealthCheckStatus) === HealthCheckStatus.SERVING) {
          ConduitGrpcSdk.Logger.log('Core connection established');
          this._initialize();
          break;
        }
      } catch (err) {
        if ((err as GrpcError).code === status.PERMISSION_DENIED) {
          ConduitGrpcSdk.Logger.error(err as Error);
          process.exit(-1);
        }
        await sleep(1000);
      }
    }
  }

  private _initialize() {
    if (this._initialized)
      throw new Error("Module's grpc-sdk has already been initialized");
    (this._config as unknown) = new Config(
      this.name,
      this.serverUrl,
      this._serviceHealthStatusGetter,
      this._grpcToken,
    );
    (this._admin as unknown) = new Admin(this.name, this.serverUrl, this._grpcToken);
    if (this.name !== 'core') {
      this.initializeModules().then();
    }
    if (this._watchModules) {
      this.watchModules();
    }
    this._initialized = true;
  }

  get bus(): EventBus | null {
    if (this._eventBus) {
      return this._eventBus;
    } else {
      ConduitGrpcSdk.Logger.warn('Event bus not initialized');
      return null;
    }
  }

  get state(): StateManager | null {
    if (this._stateManager) {
      return this._stateManager;
    } else {
      ConduitGrpcSdk.Logger.warn('State Manager not initialized');
      return null;
    }
  }

  get core(): Core {
    return this._core!;
  }

  get config(): Config {
    return this._config!;
  }

  get admin(): Admin {
    return this._admin!;
  }

  get router(): Router | null {
    if (this._modules['router']) {
      return this._modules['router'] as Router;
    } else {
      ConduitGrpcSdk.Logger.warn('Router not up yet!');
      return null;
    }
  }

  get database(): DatabaseProvider | null {
    if (this._modules['database']) {
      return this._modules['database'] as DatabaseProvider;
    } else {
      ConduitGrpcSdk.Logger.warn('Database provider not up yet!');
      return null;
    }
  }

  get databaseProvider(): DatabaseProvider | null {
    return this.database;
  }

  get storage(): Storage | null {
    if (this._modules['storage']) {
      return this._modules['storage'] as Storage;
    } else {
      ConduitGrpcSdk.Logger.warn('Storage module not up yet!');
      return null;
    }
  }

  get forms(): Forms | null {
    if (this._modules['forms']) {
      return this._modules['forms'] as Forms;
    } else {
      ConduitGrpcSdk.Logger.warn('Forms module not up yet!');
      return null;
    }
  }

  get communicator(): Communicator | null {
    if (this._modules['communicator']) {
      return this._modules['communicator'] as Communicator;
    } else {
      ConduitGrpcSdk.Logger.warn('Communicator module not up yet!');
      return null;
    }
  }

  get pushNotifications(): PushNotifications | null {
    if (this._modules['communicator']) {
      return (this._modules['communicator'] as Communicator).pushNotifications!;
    } else {
      ConduitGrpcSdk.Logger.warn('Communicator module not up yet!');
      return null;
    }
  }

  get email(): Email | null {
    if (this._modules['communicator']) {
      return (this._modules['communicator'] as Communicator).email!;
    } else {
      ConduitGrpcSdk.Logger.warn('Communicator module not up yet!');
      return null;
    }
  }

  get sms(): SMS | null {
    if (this._modules['communicator']) {
      return (this._modules['communicator'] as Communicator).sms!;
    } else {
      ConduitGrpcSdk.Logger.warn('Communicator module not up yet!');
      return null;
    }
  }

  get authentication(): Authentication | null {
    if (this._modules['authentication']) {
      return this._modules['authentication'] as Authentication;
    } else {
      ConduitGrpcSdk.Logger.warn('Authentication module not up yet!');
      return null;
    }
  }

  get authorization(): Authorization | null {
    if (this._modules['authorization']) {
      return this._modules['authorization'] as Authorization;
    } else {
      ConduitGrpcSdk.Logger.warn('Authorization module not up yet!');
      return null;
    }
  }

  get chat(): Chat | null {
    if (this._modules['chat']) {
      return this._modules['chat'] as Chat;
    } else {
      ConduitGrpcSdk.Logger.warn('Chat module not up yet!');
      return null;
    }
  }

  get redisDetails(): { host: string; port: number } {
    if (this._redisDetails) {
      return this._redisDetails;
    } else {
      throw new Error('Redis not available');
    }
  }

  watchModules() {
    const emitter = this.config.getModuleWatcher();
    this.config.watchModules().then();
    emitter.on('serving-modules-update', (modules: any) => {
      Object.keys(this._modules).forEach(r => {
        if (r !== this.name) {
          const found = modules.filter(
            (m: ModuleListResponse_ModuleResponse) => m.moduleName === r && m.serving,
          );
          if ((!found || found.length === 0) && this._modules[r]) {
            this._modules[r]?.closeConnection();
            emitter.emit(`module-connection-update:${r}`, false);
          }
        }
      });
      modules.forEach((m: ModuleListResponse_ModuleResponse) => {
        if (m.moduleName !== this.name) {
          const alreadyActive = this._modules[m.moduleName]?.active;
          if (!alreadyActive && m.serving) {
            if (this._availableModules[m.moduleName] && this._modules[m.moduleName]) {
              this._modules[m.moduleName].openConnection();
            } else {
              this.createModuleClient(m.moduleName, m.url);
            }
            emitter.emit(`module-connection-update:${m.moduleName}`, true);
          }
        }
      });
    });
  }

  monitorModule(
    moduleName: string,
    callback: (serving: boolean) => void,
    wait: boolean = true,
  ) {
    const waitPromise = wait ? this.waitForExistence(moduleName) : Promise.resolve();
    waitPromise
      .then(() => this._modules[moduleName]?.healthClient?.check({}))
      .then(res => {
        callback(res?.status === HealthCheckResponse_ServingStatus.SERVING);
      })
      .catch(() => {
        callback(false);
      })
      .then(() => {
        const emitter = this.config.getModuleWatcher();
        emitter.on(`module-connection-update:${moduleName}`, callback);
      });
  }

  unmonitorModule(moduleName: string) {
    const emitter = this.config.getModuleWatcher();
    emitter.removeAllListeners(`module-connection-update:${moduleName}`);
  }

  initializeEventBus(): Promise<EventBus> {
    let promise = Promise.resolve();
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
      this._redisDetails = {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10),
      };
    } else {
      promise = promise
        .then(() => this.config.getRedisDetails())
        .then((r: GetRedisDetailsResponse) => {
          this._redisDetails = { host: r.redisHost, port: r.redisPort };
        });
    }
    return promise
      .then(() => {
        const redisManager = new RedisManager(
          this.urlRemap ?? this._redisDetails!.host,
          this._redisDetails!.port,
        );
        this._eventBus = new EventBus(redisManager);
        this._stateManager = new StateManager(redisManager, this.name);
        return this._eventBus;
      })
      .catch((err: Error) => {
        ConduitGrpcSdk.Logger.error('Failed to initialize event bus');
        throw err;
      });
  }

  /**
   * Gets all the registered modules from the config and creates clients for them.
   * This will only work on known modules, since the primary usage for the sdk is internal
   */
  initializeModules() {
    return this._config!.moduleList()
      .then(r => {
        this.lastSearch = Date.now();
        r.forEach(m => {
          this.createModuleClient(m.moduleName, m.url);
        });
        return 'ok';
      })
      .catch(err => {
        if (err.code !== 5) {
          ConduitGrpcSdk.Logger.error(err);
        }
      });
  }

  createModuleClient(moduleName: string, moduleUrl: string) {
    if (
      this._modules[moduleName] ||
      (!this._availableModules[moduleName] && !this._dynamicModules[moduleName])
    )
      return;
    if (this._availableModules[moduleName]) {
      // ConduitGrpcSdk.Logger.log(`Creating gRPC client for ${moduleName}`);
      this._modules[moduleName] = new this._availableModules[moduleName](
        this.name,
        this.urlRemap ? `${this.urlRemap}:${moduleUrl.split(':')[1]}` : moduleUrl,
        this._grpcToken,
      );
    } else if (this._dynamicModules[moduleName]) {
      // ConduitGrpcSdk.Logger.log(`Creating gRPC client for ${moduleName}`);
      this._modules[moduleName] = new ConduitModule(
        this.name,
        moduleName,
        this.urlRemap ? `${this.urlRemap}:${moduleUrl.split(':')[1]}` : moduleUrl,
        this._grpcToken,
      );
      this._modules[moduleName].initializeClient(this._dynamicModules[moduleName]);
    }
  }

  isModuleUp(moduleName: string, moduleUrl: string, service: string = '') {
    return checkModuleHealth(moduleName, moduleUrl, service, this._grpcToken);
  }

  moduleClient(name: string, type: CompatServiceDefinition): void {
    this._dynamicModules[name] = type;
  }

  getModule<T extends CompatServiceDefinition>(
    name: string,
  ): ConduitModule<T> | undefined {
    return this._modules[name];
  }

  getServiceClient<T extends CompatServiceDefinition>(
    name: string,
  ): Client<T> | undefined {
    return this._modules[name]?.client;
  }

  getHealthClient<T extends CompatServiceDefinition>(
    name: string,
  ): Client<typeof HealthDefinition> | undefined {
    return this._modules[name]?.healthClient;
  }

  isAvailable(moduleName: string) {
    return !!this._modules[moduleName]?.active;
  }

  async waitForExistence(moduleName: string) {
    while (!this._modules[moduleName]) {
      await sleep(1000);
    }
    return true;
  }

  /**
   * Used to refresh all modules to check for new registrations
   * @param force If true will check for new modules no matter the interval
   */
  async refreshModules(force?: boolean) {
    if (this.lastSearch < Date.now() - 3000 || force) {
      return this.initializeModules();
    }
    return 'ok';
  }

  get grpcToken() {
    return this._grpcToken;
  }
}

export * from './interfaces';
export * from './classes';
export * from './modules';
export * from './helpers';
export * from './constants';
export * from './routing';
export * from './types';
export * from './utilities';
