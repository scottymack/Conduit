import ConduitGrpcSdk, {
  ConduitServiceModule,
  ConfigController,
  GrpcCallback,
  GrpcRequest,
  GrpcServer,
  HealthCheckStatus,
  RoutingManager,
} from '@conduitplatform/grpc-sdk';
import { isNil } from 'lodash';
import { ISmsProvider } from './interfaces';
import { SmsAdminHandlers } from './admin/sms.admin';
import path from 'path';
import {
  SendSmsRequest,
  SendSmsResponse,
  SendVerificationCodeRequest,
  SendVerificationCodeResponse,
  VerifyRequest,
  VerifyResponse,
} from './protoTypes/communicator';
import { status } from '@grpc/grpc-js';
import { TwilioProvider } from './providers/sms-provider/twilio';
import { Config } from './config';

export class Sms extends ConduitServiceModule {
  private adminRouter!: SmsAdminHandlers;
  private _provider!: ISmsProvider | undefined;
  isRunning: boolean = false;

  constructor(
    private readonly routingManager: RoutingManager,
    grpcSdk: ConduitGrpcSdk,
    grpcServer: GrpcServer,
  ) {
    super('sms');
    this.grpcSdk = grpcSdk;
    this.grpcServer = grpcServer;
  }

  async initialize() {
    await this.grpcServer.addService(
      path.resolve(__dirname, './communicator.proto'),
      'communicator.Sms',
      {
        sendSms: this.sendSms.bind(this),
        sendVerificationCode: this.sendVerificationCode.bind(this),
        verify: this.verify.bind(this),
      },
    );
  }

  async preConfig(config: any) {
    if (
      isNil(config.sms.active) ||
      isNil(config.sms.providerName) ||
      isNil(config[config.sms.providerName])
    ) {
      throw new Error('Invalid configuration given');
    }
    return config;
  }

  async onConfig() {
    if (!ConfigController.getInstance().config.sms.active) {
      this.updateHealth(HealthCheckStatus.NOT_SERVING);
    } else {
      await this.initProvider();
    }
  }

  private async initProvider() {
    const smsConfig = ConfigController.getInstance().config.sms;
    const name = smsConfig.providerName;
    const settings = smsConfig[name];

    if (name === 'twilio') {
      try {
        this._provider = new TwilioProvider(settings);
      } catch (e) {
        this._provider = undefined;
        ConduitGrpcSdk.Logger.error(e as Error);
        return;
      }
    } else {
      ConduitGrpcSdk.Logger.error('SMS provider not supported');
      return;
    }
    this.adminRouter.updateProvider(this._provider!);
    this.isRunning = true;
    this.updateHealth(
      this._provider ? HealthCheckStatus.SERVING : HealthCheckStatus.NOT_SERVING,
    );
  }

  async sendSms(
    call: GrpcRequest<SendSmsRequest>,
    callback: GrpcCallback<SendSmsResponse>,
  ) {
    const to = call.request.to;
    const message = call.request.message;
    if (isNil(this._provider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }

    let errorMessage: string | null = null;
    await this._provider.sendSms(to, message).catch(e => (errorMessage = e.message));
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
    if (isNil(this._provider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }
    if (isNil(to)) {
      return callback({
        code: status.INVALID_ARGUMENT,
        message: 'No sms recipient',
      });
    }

    let errorMessage: string | null = null;
    const verificationSid = await this._provider
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
    if (isNil(this._provider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }
    if (isNil(verificationSid) || isNil(code)) {
      return callback({
        code: status.INVALID_ARGUMENT,
        message: 'No verification id or code provided',
      });
    }

    let errorMessage: string | null = null;
    const verified = await this._provider
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
