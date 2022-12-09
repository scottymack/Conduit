import ConduitGrpcSdk, { ManagedModule } from '..';

export class ModuleManager<T> {
  private readonly serviceAddress: string;
  private readonly servicePort: string;
  private readonly grpcSdk: ConduitGrpcSdk;

  constructor(
    private readonly module: ManagedModule<T>,
    private readonly packageJsonPath: string,
    private readonly migrationFilesPath: string,
  ) {
    if (!process.env.CONDUIT_SERVER) {
      throw new Error('CONDUIT_SERVER is undefined, specify Conduit server URL');
    }
    this.servicePort = process.env.GRPC_PORT ?? '5000';
    this.serviceAddress =
      // @compat (v0.15): SERVICE_IP -> SERVICE_URL
      process.env.SERVICE_URL || process.env.SERVICE_IP || '0.0.0.0:' + this.servicePort;
    const urlRemap = process.env.URL_REMAP;
    try {
      this.grpcSdk = new ConduitGrpcSdk(
        process.env.CONDUIT_SERVER,
        () => {
          return this.module.healthState;
        },
        module.name,
        true,
        urlRemap,
      );
    } catch {
      throw new Error('Failed to initialize grpcSdk');
    }
  }

  async start() {
    await this.grpcSdk.initialize(this.packageJsonPath);
    this.module.initialize(
      this.grpcSdk,
      this.serviceAddress,
      this.servicePort,
      this.migrationFilesPath,
    );
    try {
      await this.preRegisterLifecycle();
      await this.grpcSdk.config.registerModule(
        this.module.address,
        this.module.healthState,
      );
    } catch (err) {
      ConduitGrpcSdk.Logger.error('Failed to initialize server');
      ConduitGrpcSdk.Logger.error(err as Error);
      process.exit(-1);
    }
  }

  private async preRegisterLifecycle(): Promise<void> {
    await this.module.createGrpcServer();
    await this.module.preServerStart();
    await this.grpcSdk.initializeEventBus();
    await this.module.handleConfigSyncUpdate();
    await this.module.registerMetrics();
    await this.module.startGrpcServer();
    await this.module.onServerStart();
    await this.module.initializeMetrics();
    await this.module.preRegister();
  }
}
