import ConduitGrpcSdk, {
  ConfigController,
  DatabaseProvider,
  HealthCheckStatus,
  ManagedModule,
} from '@conduitplatform/grpc-sdk';
import AppConfigSchema, { Config } from './config';
import { FormSubmissionTemplate } from './templates';
import { AdminHandlers } from './admin';
import { FormsRoutes } from './routes';
import { FormsController } from './controllers/forms.controller';
import * as models from './models';
import path from 'path';
import { runMigrations } from './migrations';
import metricsSchema from './metrics';

export default class Forms extends ManagedModule<Config> {
  configSchema = AppConfigSchema;
  protected metricsSchema = metricsSchema;
  service = {
    protoPath: path.resolve(__dirname, 'forms.proto'),
    protoDescription: 'forms.Forms',
    functions: {
      setConfig: this.setConfig.bind(this),
    },
  };
  private isRunning = false;
  private adminRouter: AdminHandlers;
  private userRouter: FormsRoutes;
  private database: DatabaseProvider;
  private formController: FormsController;

  constructor() {
    super('forms');
    this.updateHealth(HealthCheckStatus.UNKNOWN, true);
  }

  async onServerStart() {
    await this.grpcSdk.waitForExistence('database');
    this.database = this.grpcSdk.database!;
    await runMigrations(this.grpcSdk);
    await this.registerSchemas();
    await this.grpcSdk.monitorModule('email', serving => {
      if (serving && ConfigController.getInstance().config.active) {
        this.onConfig()
          .then()
          .catch(() => {
            ConduitGrpcSdk.Logger.error('Failed to update Forms configuration');
          });
      } else {
        this.updateHealth(HealthCheckStatus.NOT_SERVING);
      }
    });
  }

  async onConfig() {
    if (!ConfigController.getInstance().config.active) {
      this.updateHealth(HealthCheckStatus.NOT_SERVING);
    } else {
      if (!this.isRunning) {
        if (!this.grpcSdk.isAvailable('email')) return;
        await this.grpcSdk.emailProvider!.registerTemplate(FormSubmissionTemplate);
        this.formController = new FormsController(this.grpcSdk);
        this.adminRouter = new AdminHandlers(
          this.grpcServer,
          this.grpcSdk,
          this.formController,
        );
        this.grpcSdk
          .waitForExistence('router')
          .then(() => {
            this.userRouter = new FormsRoutes(this.grpcServer, this.grpcSdk);
            this.formController.setRouter(this.userRouter);
            this.isRunning = true;
          })
          .catch(e => {
            ConduitGrpcSdk.Logger.error(e.message);
          });
      }
      this.updateHealth(HealthCheckStatus.SERVING);
    }
  }

  protected registerSchemas() {
    const promises = Object.values(models).map(model => {
      const modelInstance = model.getInstance(this.database);
      return this.database.createSchemaFromAdapter(modelInstance);
    });
    return Promise.all(promises);
  }

  async initializeMetrics() {
    const formsTotal = await models.Forms.getInstance().countDocuments({});
    ConduitGrpcSdk.Metrics?.set('forms_total', formsTotal);
  }
}
