import ConduitGrpcSdk, {
  ConfigController,
  DatabaseProvider,
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
import { ISmsProvider } from './interfaces';
import { TwilioProvider } from './providers/sms-provider/twilio';

export default class Communicator extends ManagedModule<Config> {
  configSchema = AppConfigSchema;
  protected metricsSchema = '' as any;
  service = {
    protoPath: path.resolve(__dirname, 'communicator.proto'),
    protoDescription: 'communicator.Communicator',
    functions: {
      setConfig: this.setConfig.bind(this),
      //registerTemplate: this.registerTemplate.bind(this),
      //sendEmail: this.sendEmail.bind(this),
    },
  };
  private emailIsRunning: boolean = false;
  private pushNotification: boolean = false;
  private smsIsRunning: boolean = false;
  private emailAdminRouter!: EmailAdminHandlers;
  private smsAdminRouter!: SmsAdminHandlers;
  private pushNotificationsAdminRouter!: PushNotificationsAdminHandlers;
  private emailProvider!: EmailProvider;
  private emailService!: EmailService;
  private database!: DatabaseProvider;
  private _smsProvider: ISmsProvider | undefined;
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

    if (isNil(config.pushNotifications.active)) {
      throw new Error('Invalid push notifications configuration');
    }

    if (isNil(config.sms.active)) {
      throw new Error('Invalid sms configuration');
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
    } else {
      if (!this.emailIsRunning && isEmailActive) {
        await this.initEmailProvider();
        this.emailService = new EmailService(this.emailProvider);
        this.emailAdminRouter = new EmailAdminHandlers(this.grpcServer, this.grpcSdk);
        this.emailAdminRouter.setEmailService(this.emailService);
        this.emailIsRunning = true;
      } else {
        await this.initEmailProvider(ConfigController.getInstance().config);
        this.emailService.updateProvider(this.emailProvider);
      }

      if (isSmsActive) {
        await this.initSmsProvider();
      }
      this.updateHealth(HealthCheckStatus.SERVING);
    }

    //also for sms and push notifications etc
  }
  private async initEmailProvider(newConfig?: Config) {
    const emailConfig = !isNil(newConfig)
      ? newConfig
      : await this.grpcSdk.config.get('email');

    const { transport, transportSettings } = emailConfig;

    this.emailProvider = new EmailProvider(transport, transportSettings);
  }

  private async initSmsProvider() {
    const smsConfig = ConfigController.getInstance().config;
    const name = smsConfig.providerName;
    const settings = smsConfig[name];

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
}
