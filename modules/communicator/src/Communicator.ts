import ConduitGrpcSdk, {
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
import { isNil } from 'lodash';
import { SmsAdminHandlers } from './admin/sms.admin';
import { PushNotificationsAdminHandlers } from './admin/pushNotifications.admin';
import {
  IFirebaseSettings,
  IOneSignalSettings,
  IPushNotificationsProvider,
  ISendNotification,
  ISendNotificationToManyDevices,
  ISmsProvider,
} from './interfaces';
import { TwilioProvider } from './providers/sms-provider/twilio';
import { PushNotificationsRoutes } from './routes/pushNotifications.routes';
import { FirebaseProvider } from './providers/push-notifications-provider/Firebase.provider';
import { OneSignalProvider } from './providers/push-notifications-provider/OneSignal.provider';
import { Email } from './Email';

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
    // if (isNil(config.sms.active) || isNil(config.sms.providerName)) {
    //   throw new Error('Invalid configuration given');
    // }
    // if (
    //   isNil(config.pushNotifications.active) ||
    //   isNil(config.pushNotifications.providerName)
    // ) {
    //   throw new Error('Invalid configuration given');
    // }
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
    this.email?.onConfig();

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
  //
  // private async initPushNotificationsProvider() {
  //   const notificationsConfig = await this.grpcSdk.config.get('communicator');
  //   const name = notificationsConfig.pushNotifications.providerName;
  //   const settings = notificationsConfig.pushNotifications[name];
  //   if (name === 'firebase') {
  //     this._pushNotificationsProvider = new FirebaseProvider(
  //       settings as IFirebaseSettings,
  //     );
  //   } else if (name === 'onesignal') {
  //     this._pushNotificationsProvider = new OneSignalProvider(
  //       settings as IOneSignalSettings,
  //     );
  //   } else {
  //     throw new Error('Provider not supported');
  //   }
  //   this.pushNotificationsAdminRouter = new PushNotificationsAdminHandlers(
  //     this.grpcServer,
  //     this.grpcSdk,
  //     this.routingManager!,
  //     this._pushNotificationsProvider!,
  //   );
  //   this.pushNotificationsIsRunning = true;
  // }
  //
  // private async enableModule() {
  //   if (!this.pushNotificationsIsRunning) {
  //     await this.initPushNotificationsProvider();
  //     if (
  //       !this._pushNotificationsProvider ||
  //       !this._pushNotificationsProvider?.isInitialized
  //     ) {
  //       throw new Error('Provider failed to initialize');
  //     }
  //     if (this.grpcSdk.isAvailable('router')) {
  //       this.userRouter = new PushNotificationsRoutes(this.grpcServer, this.grpcSdk);
  //     } else {
  //       this.grpcSdk.monitorModule('router', serving => {
  //         if (serving) {
  //           this.userRouter = new PushNotificationsRoutes(this.grpcServer, this.grpcSdk);
  //           this.grpcSdk.unmonitorModule('router');
  //         }
  //       });
  //     }
  //   } else {
  //     await this.initPushNotificationsProvider();
  //     if (
  //       !this._pushNotificationsProvider ||
  //       !this._pushNotificationsProvider?.isInitialized
  //     ) {
  //       throw new Error('Provider failed to initialize');
  //     }
  //     this.pushNotificationsAdminRouter.updateProvider(this._pushNotificationsProvider!);
  //   }
  // }
}
