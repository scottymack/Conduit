import ConduitGrpcSdk, {
  ConduitServiceModule,
  ConfigController,
  GrpcCallback,
  GrpcRequest,
  GrpcServer,
  RoutingManager,
} from '@conduitplatform/grpc-sdk';
import path from 'path';
import {
  RegisterTemplateRequest,
  RegisterTemplateResponse,
  SendEmailRequest,
  SendEmailResponse,
} from './protoTypes/communicator';
import { status } from '@grpc/grpc-js';
import { isNil } from 'lodash';
import { Config } from './config';
import { EmailService } from './services/email.service';
import { EmailProvider } from './providers/email-provider';
import { EmailAdminHandlers } from './admin/email.admin';

export class Email extends ConduitServiceModule {
  private emailService!: EmailService;
  private emailProvider!: EmailProvider;
  private adminRouter!: EmailAdminHandlers;
  isRunning: boolean = false;

  constructor(
    private readonly routingManager: RoutingManager,
    grpcSdk: ConduitGrpcSdk,
    grpcServer: GrpcServer,
  ) {
    super('email');
    this.grpcSdk = grpcSdk;
    this.grpcServer = grpcServer;
    this.initialize();
  }

  async initialize() {
    await this.grpcServer.addService(
      path.resolve(__dirname, './communicator.proto'),
      'communicator.Email',
      {
        registerTemplate: this.registerTemplate.bind(this),
        sendEmail: this.sendEmail.bind(this),
      },
    );
  }

  async preConfig(config: Config) {
    if (
      isNil(config.email.active) ||
      isNil(config.email.transport) ||
      isNil(config.email.transportSettings)
    ) {
      throw new Error('Invalid configuration given');
    }
    return config;
  }

  async onConfig() {
    const isActive = ConfigController.getInstance().config.email.active;
    if (isActive) {
      if (!this.isRunning) {
        await this.initProvider();
        this.emailService = new EmailService(this.emailProvider);
        this.adminRouter.setEmailService(this.emailService);
        this.isRunning = true;
      } else {
        await this.initProvider(ConfigController.getInstance().config);
        this.emailService.updateProvider(this.emailProvider);
      }
    }
  }

  private async initProvider(newConfig?: Config) {
    const emailConfig = !isNil(newConfig)
      ? newConfig
      : await this.grpcSdk.config.get('communicator');

    const { transport, transportSettings } = emailConfig.email;

    this.emailProvider = new EmailProvider(transport, transportSettings);
    this.adminRouter = new EmailAdminHandlers(
      this.grpcServer,
      this.grpcSdk,
      this.routingManager!,
    );
  }

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
      .get('email')
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
}
