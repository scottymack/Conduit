import { HealthCheckStatus, ManagedModule } from '@conduitplatform/grpc-sdk';
import AppConfigSchema, { Config } from './config';

export default class Communicator extends ManagedModule<Config> {
  configSchema = AppConfigSchema;
  protected metricsSchema = '' as any;

  constructor() {
    super('communicator');
    this.updateHealth(HealthCheckStatus.UNKNOWN, true);
  }
}
