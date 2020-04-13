import { ConduitSDK, IConduitEmail, IRegisterTemplateParams, ISendEmailParams } from '@conduit/sdk';
import { emailTemplateSchema } from './models/EmailTemplate';
import { EmailProvider } from '@conduit/email-provider';
import { EmailService } from './services/email.service';
import { AdminHandlers } from './handlers/AdminHandlers';

class EmailModule implements IConduitEmail {
  private emailProvider: EmailProvider;
  private readonly emailService: EmailService;
  private readonly adminHandlers: AdminHandlers;

  constructor(
    private readonly sdk: ConduitSDK
  ) {
    this.registerModels();
    this.initEmailProvider();
    this.emailService = new EmailService(this.emailProvider, sdk);


    this.adminHandlers = new AdminHandlers(sdk, this.emailService);
    this.initAdminRoutes();

  }

  async registerTemplate(params: IRegisterTemplateParams) {
    return this.emailService.registerTemplate(params);
  }

  async sendEmail(template: string, params: ISendEmailParams) {
    return this.emailService.sendEmail(template, params);
  }

  private registerModels() {
    const database = this.sdk.getDatabase();
    database.createSchemaFromAdapter(emailTemplateSchema);
  }

  private initEmailProvider() {
    const { config } = this.sdk as any;
    const emailConfig = config.get('email');

    let { transport, transportSettings } = emailConfig;

    this.emailProvider = new EmailProvider(transport, transportSettings);
  }

  private initAdminRoutes() {
    const admin = this.sdk.getAdmin();

    admin.registerRoute('GET', '/email/templates',
      (req, res, next) => this.adminHandlers.getTemplates(req, res).catch(next));

    admin.registerRoute('POST', '/email/templates',
      (req, res, next) => this.adminHandlers.createTemplate(req, res).catch(next));

    admin.registerRoute('PUT', '/email/templates/:id',
      (req, res, next) => this.adminHandlers.editTemplate(req, res).catch(next));

    admin.registerRoute('POST', '/email/send',
      (req, res, next) => this.adminHandlers.sendEmail(req, res).catch(next));

    admin.registerRoute('GET', '/email/config',
      (req, res, next) => this.adminHandlers.getEmailConfig(req, res).catch(next));

    admin.registerRoute('PUT', '/email/config',
      (req, res, next) => this.adminHandlers.editEmailConfig(req, res).catch(next));
  }
}

export = EmailModule;