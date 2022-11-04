import ConduitGrpcSdk, {
  ConfigController,
  DatabaseProvider,
  GrpcCallback,
  GrpcRequest,
  HealthCheckStatus,
  ManagedModule,
} from '@conduitplatform/grpc-sdk';
import path from 'path';
import AppConfigSchema, { Config } from './config';
import * as models from './models';
import { runMigrations } from './migrations';
import { isNil } from 'lodash';
import { EmailProvider } from './providers/email-provider';
import { EmailService } from './services/email.service';
import { EmailAdminHandlers } from './admin/email.admin';
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
import { OneSignalProvider } from './providers/push-notifications-provider/OneSignal.provider';
import { PushNotificationsRoutes } from './routes/pushNotifications.routes';
import { status } from '@grpc/grpc-js';
import {
  RegisterTemplateRequest,
  RegisterTemplateResponse,
  SendEmailRequest,
  SendEmailResponse,
  SendSmsRequest,
  SendSmsResponse,
  SendVerificationCodeRequest,
  SendVerificationCodeResponse,
  VerifyRequest,
  VerifyResponse,
} from './protoTypes/communicator';
import {
  GetNotificationTokensRequest,
  GetNotificationTokensResponse,
  SendManyNotificationsRequest,
  SendNotificationRequest,
  SendNotificationResponse,
  SendToManyDevicesNotificationRequest,
  SetNotificationTokenRequest,
  SetNotificationTokenResponse,
} from './types';

export default class Communicator extends ManagedModule<Config> {
  configSchema = AppConfigSchema;
  protected metricsSchema = '' as any;
  service = {
    protoPath: path.resolve(__dirname, 'communicator.proto'),
    protoDescription: 'communicator.Communicator',
    functions: {
      setConfig: this.setConfig.bind(this),
      registerTemplate: this.registerTemplate.bind(this),
      sendEmail: this.sendEmail.bind(this),
      setNotificationToken: this.setNotificationToken.bind(this),
      getNotificationTokens: this.getNotificationTokens.bind(this),
      sendNotification: this.sendNotification.bind(this),
      SendNotificationToManyDevices: this.sendToManyDevices.bind(this),
      sendManyNotifications: this.sendMany.bind(this),
      sendSms: this.sendSms.bind(this),
      sendVerificationCode: this.sendVerificationCode.bind(this),
      verify: this.verify.bind(this),
    },
  };
  private emailIsRunning: boolean = false;
  private smsIsRunning: boolean = false;
  private pushNotificationsIsRunning: boolean = false;
  private emailAdminRouter!: EmailAdminHandlers;
  private smsAdminRouter!: SmsAdminHandlers;
  private pushNotificationsAdminRouter!: PushNotificationsAdminHandlers;
  private userRouter!: PushNotificationsRoutes;
  private emailProvider!: EmailProvider;
  private emailService!: EmailService;
  private database!: DatabaseProvider;
  private _smsProvider: ISmsProvider | undefined;
  private _pushNotificationsProvider: IPushNotificationsProvider | undefined;

  constructor() {
    super('communicator');
    this.updateHealth(HealthCheckStatus.UNKNOWN, true);
  }

  async onServerStart() {
    await this.grpcSdk.waitForExistence('database');
    this.database = this.grpcSdk.database!;
    await this.registerSchemas();
    await runMigrations(this.grpcSdk);
  }

  protected registerSchemas() {
    const promises = Object.values(models).map(model => {
      const modelInstance = model.getInstance(this.database);
      return this.database.createSchemaFromAdapter(modelInstance);
    });
    return Promise.all(promises);
  }

  async preConfig(config: Config) {
    if (
      isNil(config.email.active) ||
      isNil(config.email.transport) ||
      isNil(config.email.transportSettings)
    ) {
      throw new Error('Invalid configuration given');
    }
    if (isNil(config.sms.active) || isNil(config.sms.providerName)) {
      throw new Error('Invalid configuration given');
    }
    if (
      isNil(config.pushNotifications.active) ||
      isNil(config.pushNotifications.providerName)
    ) {
      throw new Error('Invalid configuration given');
    }
    return config;
  }

  async onConfig() {
    const isEmailActive = ConfigController.getInstance().config.email.active;
    const isSmsActive = ConfigController.getInstance().config.sms.active;
    const isPushNotificationsActive =
      ConfigController.getInstance().config.pushNotifications.active;
    if (!isEmailActive && !isSmsActive && isPushNotificationsActive) {
      this.updateHealth(HealthCheckStatus.NOT_SERVING);
    }
    if (isEmailActive) {
      if (!this.emailIsRunning) {
        await this.initEmailProvider();
        this.emailService = new EmailService(this.emailProvider);
        this.emailAdminRouter = new EmailAdminHandlers(this.grpcServer, this.grpcSdk);
        this.emailAdminRouter.setEmailService(this.emailService);
        this.emailIsRunning = true;
      } else {
        await this.initEmailProvider(ConfigController.getInstance().config);
        this.emailService.updateProvider(this.emailProvider);
      }
    }
    if (isSmsActive) {
      if (!this.smsIsRunning) {
      } else {
        await this.initSmsProvider();
      }
    }
    if (isPushNotificationsActive) {
      if (!this.pushNotificationsIsRunning) {
      } else {
        await this.enableModule();
      }
    }
    this.updateHealth(HealthCheckStatus.SERVING);
  }

  private async initEmailProvider(newConfig?: Config) {
    const emailConfig = !isNil(newConfig)
      ? newConfig
      : await this.grpcSdk.config.get('communicator');

    const { transport, transportSettings } = emailConfig.email;

    this.emailProvider = new EmailProvider(transport, transportSettings);
  }

  private async initSmsProvider() {
    const smsConfig = ConfigController.getInstance().config;
    const name = smsConfig.sms.providerName;
    const settings = smsConfig[name].sms;

    if (name === 'twilio') {
      try {
        this._smsProvider = new TwilioProvider(settings);
      } catch (e) {
        this._smsProvider = undefined;
        ConduitGrpcSdk.Logger.error(e as Error);
        return;
      }
    } else {
      ConduitGrpcSdk.Logger.error('SMS provider not supported');
      return;
    }
    this.smsAdminRouter.updateProvider(this._smsProvider!);
    this.smsIsRunning = true;
    this.updateHealth(
      this._smsProvider ? HealthCheckStatus.SERVING : HealthCheckStatus.NOT_SERVING,
    );
  }

  private async initPushNotificationsProvider() {
    const notificationsConfig = await this.grpcSdk.config.get('communicator');
    const name = notificationsConfig.pushNotifications.providerName;
    const settings = notificationsConfig[name].pushNotifications;
    if (name === 'firebase') {
      // this._pushNotificationsProvider = new FirebaseProvider(
      //   settings as IFirebaseSettings,
      // );
    } else if (name === 'onesignal') {
      this._pushNotificationsProvider = new OneSignalProvider(
        settings as IOneSignalSettings,
      );
    } else {
      throw new Error('Provider not supported');
    }
  }

  private async enableModule() {
    if (!this.pushNotificationsIsRunning) {
      await this.initPushNotificationsProvider();
      if (
        !this._pushNotificationsProvider ||
        !this._pushNotificationsProvider?.isInitialized
      ) {
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

      this.pushNotificationsAdminRouter = new PushNotificationsAdminHandlers(
        this.grpcServer,
        this.grpcSdk,
        this._pushNotificationsProvider!,
      );
      this.pushNotificationsIsRunning = true;
    } else {
      await this.initPushNotificationsProvider();
      if (
        !this._pushNotificationsProvider ||
        !this._pushNotificationsProvider?.isInitialized
      ) {
        throw new Error('Provider failed to initialize');
      }
      this.pushNotificationsAdminRouter.updateProvider(this._pushNotificationsProvider!);
    }
  }

  // gRPC Service
  async registerTemplate(
    call: GrpcRequest<RegisterTemplateRequest>,
    callback: GrpcCallback<RegisterTemplateResponse>,
  ) {
    const params = {
      name: call.request.name,
      subject: call.request.subject,
      body: call.request.body,
      variables: call.request.variables,
    };
    let errorMessage: string | null = null;
    const template = await this.emailService
      .registerTemplate(params)
      .catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({ code: status.INTERNAL, message: errorMessage });
    return callback(null, { template: JSON.stringify(template) });
  }

  async sendEmail(
    call: GrpcRequest<SendEmailRequest>,
    callback: GrpcCallback<SendEmailResponse>,
  ) {
    const template = call.request.templateName;
    const params = {
      email: call.request.params!.email,
      variables: JSON.parse(call.request.params!.variables),
      sender: call.request.params!.sender,
      cc: call.request.params!.cc,
      replyTo: call.request.params!.replyTo,
      attachments: call.request.params!.attachments,
    };
    const emailConfig: Config = await this.grpcSdk.config
      .get('communicator')
      .catch(() => ConduitGrpcSdk.Logger.error('Failed to get sending domain'));
    params.sender =
      params.sender + `@${emailConfig?.email.sendingDomain ?? 'conduit.com'}`;
    let errorMessage: string | null = null;
    const sentMessageInfo = await this.emailService
      .sendEmail(template, params)
      .catch((e: Error) => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({ code: status.INTERNAL, message: errorMessage });
    return callback(null, { sentMessageInfo });
  }

  async initializeMetrics() {}

  // gRPC Service
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
    await this._pushNotificationsProvider!.sendToDevice(params).catch(e => {
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
    await this._pushNotificationsProvider!.sendToManyDevices(params).catch(e => {
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
    await this._pushNotificationsProvider!.sendMany(params).catch(e => {
      errorMessage = e;
    });
    if (errorMessage) {
      return callback({ code: status.INTERNAL, message: errorMessage });
    }
    return callback(null, { message: 'Ok' });
  }

  async sendSms(
    call: GrpcRequest<SendSmsRequest>,
    callback: GrpcCallback<SendSmsResponse>,
  ) {
    const to = call.request.to;
    const message = call.request.message;
    if (isNil(this._smsProvider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }

    let errorMessage: string | null = null;
    await this._smsProvider.sendSms(to, message).catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({
        code: status.INTERNAL,
        message: errorMessage,
      });

    return callback(null, { message: 'SMS sent' });
  }

  async sendVerificationCode(
    call: GrpcRequest<SendVerificationCodeRequest>,
    callback: GrpcCallback<SendVerificationCodeResponse>,
  ) {
    const to = call.request.to;
    if (isNil(this._smsProvider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }
    if (isNil(to)) {
      return callback({
        code: status.INVALID_ARGUMENT,
        message: 'No sms recipient',
      });
    }

    let errorMessage: string | null = null;
    const verificationSid = await this._smsProvider
      .sendVerificationCode(to)
      .catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({
        code: status.INTERNAL,
        message: errorMessage,
      });

    return callback(null, { verificationSid });
  }

  async verify(call: GrpcRequest<VerifyRequest>, callback: GrpcCallback<VerifyResponse>) {
    const { verificationSid, code } = call.request;
    if (isNil(this._smsProvider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }
    if (isNil(verificationSid) || isNil(code)) {
      return callback({
        code: status.INVALID_ARGUMENT,
        message: 'No verification id or code provided',
      });
    }

    let errorMessage: string | null = null;
    const verified = await this._smsProvider
      .verify(verificationSid, code)
      .catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({
        code: status.INTERNAL,
        message: errorMessage,
      });

    return callback(null, { verified });
  }
}
