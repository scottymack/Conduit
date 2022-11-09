import ConduitGrpcSdk, {
  ConduitServiceModule,
  ConfigController,
  GrpcServer,
  HealthCheckStatus,
  RoutingManager,
} from '@conduitplatform/grpc-sdk';
import { PushNotificationsAdminHandlers } from './admin/pushNotifications.admin';
import path from 'path';
import {
  SendManyNotificationsRequest,
  SendNotificationRequest,
  SendToManyDevicesNotificationRequest,
  SendNotificationResponse,
  SetNotificationTokenRequest,
  SetNotificationTokenResponse,
  GetNotificationTokensRequest,
  GetNotificationTokensResponse,
} from './types';
import { status } from '@grpc/grpc-js';
import * as models from './models';
import {
  IFirebaseSettings,
  IOneSignalSettings,
  IPushNotificationsProvider,
  ISendNotification,
  ISendNotificationToManyDevices,
} from './interfaces';
import { isNil } from 'lodash';
import { FirebaseProvider } from './providers/push-notifications-provider/Firebase.provider';
import { OneSignalProvider } from './providers/push-notifications-provider/OneSignal.provider';
import { PushNotificationsRoutes } from './routes/pushNotifications.routes';

export class PushNotifications extends ConduitServiceModule {
  private adminRouter!: PushNotificationsAdminHandlers;
  private userRouter!: PushNotificationsRoutes;
  private _provider: IPushNotificationsProvider | undefined;
  isRunning: boolean = false;
  authServing: boolean = false;

  constructor(
    private readonly routingManager: RoutingManager,
    grpcSdk: ConduitGrpcSdk,
    grpcServer: GrpcServer,
  ) {
    super('pushNotifications');
    this.grpcSdk = grpcSdk;
    this.grpcServer = grpcServer;
    this.initialize();
  }

  async initialize() {
    await this.grpcServer.addService(
      path.resolve(__dirname, './communicator.proto'),
      'communicator.PushNotifications',
      {
        setNotificationToken: this.setNotificationToken.bind(this),
        getNotificationTokens: this.getNotificationTokens.bind(this),
        sendNotification: this.sendNotification.bind(this),
        SendNotificationToManyDevices: this.sendToManyDevices.bind(this),
        sendManyNotifications: this.sendMany.bind(this),
      },
    );
  }

  private async initProvider() {
    const notificationsConfig = ConfigController.getInstance().config.pushNotifications;
    const name = notificationsConfig.providerName;
    const settings = notificationsConfig[name];
    if (name === 'firebase') {
      this._provider = new FirebaseProvider(settings as IFirebaseSettings);
    } else if (name === 'onesignal') {
      this._provider = new OneSignalProvider(settings as IOneSignalSettings);
    } else {
      throw new Error('Provider not supported');
    }
  }

  async onConfig() {
    if (!ConfigController.getInstance().config.pushNotifications.active) {
      this.updateHealthState(HealthCheckStatus.NOT_SERVING);
    } else {
      try {
        await this.enableModule();
        this.updateHealthState(HealthCheckStatus.SERVING);
      } catch (e) {
        this.updateHealthState(HealthCheckStatus.NOT_SERVING);
      }
    }
  }

  private updateHealthState(stateUpdate?: HealthCheckStatus, authServing?: boolean) {
    if (authServing) {
      this.authServing = authServing;
    }
    const moduleActive = ConfigController.getInstance().config.pushNotifications.active;
    const depState =
      moduleActive && this.authServing
        ? HealthCheckStatus.SERVING
        : HealthCheckStatus.NOT_SERVING;
    const requestedState = stateUpdate ?? this.healthState;
    const nextState =
      depState === requestedState && requestedState === HealthCheckStatus.SERVING
        ? HealthCheckStatus.SERVING
        : HealthCheckStatus.NOT_SERVING;
    this.updateHealth(nextState);
  }

  private async enableModule() {
    if (!this.isRunning) {
      await this.initProvider();
      if (!this._provider || !this._provider?.isInitialized) {
        throw new Error('Provider failed to initialize');
      }
      if (this.grpcSdk.isAvailable('router')) {
        this.userRouter = new PushNotificationsRoutes(this.grpcServer, this.grpcSdk);
      } else {
        this.grpcSdk.monitorModule('router', serving => {
          if (serving) {
            this.userRouter = new PushNotificationsRoutes(this.grpcServer, this.grpcSdk);
            this.grpcSdk.unmonitorModule('router');
          }
        });
      }

      this.adminRouter = new PushNotificationsAdminHandlers(
        this.grpcServer,
        this.grpcSdk,
        this.routingManager,
        this._provider!,
      );
      this.isRunning = true;
    } else {
      await this.initProvider();
      if (!this._provider || !this._provider?.isInitialized) {
        throw new Error('Provider failed to initialize');
      }
      this.adminRouter.updateProvider(this._provider!);
    }
  }

  async setNotificationToken(
    call: SetNotificationTokenRequest,
    callback: SetNotificationTokenResponse,
  ) {
    const { token, platform, userId } = call.request;
    let errorMessage: string | null = null;
    models.NotificationToken.getInstance()
      .findOne({ userId, platform })
      .then(oldToken => {
        if (!isNil(oldToken))
          return models.NotificationToken.getInstance().deleteOne(oldToken);
      })
      .catch((e: Error) => {
        errorMessage = e.message;
      });
    if (errorMessage) {
      return callback({ code: status.INTERNAL, message: errorMessage });
    }
    const newTokenDocument = await models.NotificationToken.getInstance()
      .create({
        userId,
        token,
        platform,
      })
      .catch((e: Error) => {
        errorMessage = e.message;
      });
    if (errorMessage) {
      return callback({ code: status.INTERNAL, message: errorMessage });
    }
    return callback(null, { newTokenDocument: JSON.stringify(newTokenDocument) });
  }

  async getNotificationTokens(
    call: GetNotificationTokensRequest,
    callback: GetNotificationTokensResponse,
  ) {
    const userId = call.request.userId;
    let errorMessage: string | null = null;
    const tokenDocuments: any = await models.NotificationToken.getInstance()
      .findMany({ userId })
      .catch((e: Error) => {
        errorMessage = e.message;
      });
    if (errorMessage) {
      return callback({ code: status.INTERNAL, message: errorMessage });
    }
    return callback(null, { tokenDocuments });
  }

  async sendNotification(
    call: SendNotificationRequest,
    callback: SendNotificationResponse,
  ) {
    const data = call.request.data;
    let params: ISendNotification;
    try {
      params = {
        sendTo: call.request.sendTo,
        title: call.request.title,
        body: call.request.body,
        data: data ? JSON.parse(data) : {},
        type: call.request.type,
        platform: call.request.platform,
      };
    } catch (e) {
      return callback({ code: status.INTERNAL, message: (e as Error).message });
    }
    let errorMessage: string | null = null;
    await this._provider!.sendToDevice(params).catch(e => {
      errorMessage = e;
    });
    if (errorMessage) {
      return callback({ code: status.INTERNAL, message: errorMessage });
    }
    return callback(null, { message: 'Ok' });
  }

  async sendToManyDevices(
    call: SendToManyDevicesNotificationRequest,
    callback: SendNotificationResponse,
  ) {
    const data = call.request.data;
    let params: ISendNotificationToManyDevices;

    try {
      params = {
        sendTo: call.request.sendTo,
        title: call.request.title,
        body: call.request.body,
        data: data ? JSON.parse(data) : {},
        type: call.request.type,
        platform: call.request.platform,
      };
    } catch (e) {
      return callback({ code: status.INTERNAL, message: (e as Error).message });
    }
    let errorMessage: string | null = null;
    await this._provider!.sendToManyDevices(params).catch(e => {
      errorMessage = e;
    });
    if (errorMessage) {
      return callback({ code: status.INTERNAL, message: errorMessage });
    }
    return callback(null, { message: 'Ok' });
  }

  async sendMany(call: SendManyNotificationsRequest, callback: SendNotificationResponse) {
    let params: ISendNotification[];
    try {
      params = call.request.notifications.map(notification => ({
        sendTo: notification.sendTo,
        title: notification.title,
        body: notification.body,
        data: notification.data ? JSON.parse(notification.data) : {},
        type: notification.type,
        platform: notification.platform,
      }));
    } catch (e) {
      return callback({ code: status.INTERNAL, message: (e as Error).message });
    }
    let errorMessage: string | null = null;
    await this._provider!.sendMany(params).catch(e => {
      errorMessage = e;
    });
    if (errorMessage) {
      return callback({ code: status.INTERNAL, message: errorMessage });
    }
    return callback(null, { message: 'Ok' });
  }
}
