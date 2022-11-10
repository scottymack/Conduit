import {
  ConfigController,
  DatabaseProvider,
  HealthCheckStatus,
  ManagedModule,
  RoutingManager,
} from '@conduitplatform/grpc-sdk';
import path from 'path';
import AppConfigSchema, { Config } from './config';
import * as models from './models';
import { runMigrations } from './migrations';
import { Email } from './Email';
import { PushNotifications } from './PushNotifications';

export default class Communicator extends ManagedModule<Config> {
  configSchema = AppConfigSchema;
  protected metricsSchema = '' as any;
  service = {
    protoPath: path.resolve(__dirname, 'communicator.proto'),
    protoDescription: 'communicator.Communicator',
    functions: {
      setConfig: this.setConfig.bind(this),
    },
  };
  private database!: DatabaseProvider;
  private routingManager: RoutingManager | undefined;
  private email: Email | undefined;
  private pushNotifications: PushNotifications | undefined;

  constructor() {
    super('communicator');
    this.updateHealth(HealthCheckStatus.UNKNOWN, true);
  }

  async onServerStart() {
    this.routingManager = new RoutingManager(this.grpcSdk.admin, this.grpcServer);
    await this.grpcSdk.waitForExistence('database');
    this.database = this.grpcSdk.database!;
    await this.registerSchemas();
    await runMigrations(this.grpcSdk);
    this.email = new Email(this.routingManager, this.grpcSdk, this.grpcServer);
    this.pushNotifications = new PushNotifications(
      this.routingManager,
      this.grpcSdk,
      this.grpcServer,
    );
  }

  protected registerSchemas() {
    const promises = Object.values(models).map(model => {
      const modelInstance = model.getInstance(this.database);
      return this.database.createSchemaFromAdapter(modelInstance);
    });
    return Promise.all(promises);
  }

  async preConfig(config: Config) {
    await this.email?.preConfig(config);
    await this.pushNotifications?.preConfig(config);
    return config;
  }

  async onConfig() {
    this.routingManager?.clear();
    const isEmailActive = ConfigController.getInstance().config.email.active;
    const isSmsActive = ConfigController.getInstance().config.sms.active;
    const isPushNotificationsActive =
      ConfigController.getInstance().config.pushNotifications.active;
    if (!isEmailActive && !isSmsActive && isPushNotificationsActive) {
      this.updateHealth(HealthCheckStatus.NOT_SERVING);
    }
    await this.email?.onConfig();
    await this.pushNotifications?.onConfig();

    this.updateHealth(HealthCheckStatus.SERVING);
    await this.routingManager?.registerRoutes();
  }
  // private async initSmsProvider() {
  //   const smsConfig = await this.grpcSdk.config.get('communicator');
  //   const name = smsConfig.sms.providerName;
  //   const settings = smsConfig.sms[name];
  //   if (name === 'twilio') {
  //     try {
  //       this._smsProvider = new TwilioProvider(settings);
  //     } catch (e) {
  //       this._smsProvider = undefined;
  //       ConduitGrpcSdk.Logger.error(e as Error);
  //       return;
  //     }
  //   } else {
  //     ConduitGrpcSdk.Logger.error('SMS provider not supported');
  //     return;
  //   }
  //   this.smsAdminRouter = new SmsAdminHandlers(
  //     this.grpcServer,
  //     this.grpcSdk,
  //     this.routingManager!,
  //     this._smsProvider,
  //   );
  //   this.smsAdminRouter.updateProvider(this._smsProvider);
  //   this.smsIsRunning = true;
  // }
}
