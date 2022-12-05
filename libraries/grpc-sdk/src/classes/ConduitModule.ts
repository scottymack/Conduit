import { getModuleNameInterceptor, getGrpcSignedTokenInterceptor } from '../interceptors';
import { CompatServiceDefinition } from 'nice-grpc/lib/service-definitions';
import { Channel, Client, createChannel, createClientFactory } from 'nice-grpc';
import { retryMiddleware } from 'nice-grpc-client-middleware-retry';
import { HealthDefinition, HealthCheckResponse } from '../protoUtils/grpc_health_check';
import { ConduitModuleDefinition } from '../protoUtils/conduit_module';
import { EventEmitter } from 'events';

export class ConduitModule<T extends CompatServiceDefinition> {
  active: boolean = false;
  private _healthClient?: Client<typeof HealthDefinition>;
  private _conduitClient?: Client<typeof ConduitModuleDefinition>;
  private _serviceClient?: Client<T>;
  protected channel?: Channel;
  protected protoPath?: string;
  protected type?: T;
  protected readonly healthCheckEmitter = new EventEmitter();

  constructor(
    readonly _clientName: string,
    private readonly _serviceName: string,
    private readonly _serviceUrl: string,
    private readonly _grpcToken?: string,
  ) {}

  initializeClient(type: T): Client<T> {
    if (this._serviceClient) return this._serviceClient;
    this.type = type;
    this.openConnection();
    return this._serviceClient!;
  }

  openConnection() {
    // ConduitGrpcSdk.Logger.log(`Opening connection for ${this._serviceName}`);
    this.channel = createChannel(this._serviceUrl, undefined, {
      'grpc.max_receive_message_length': 1024 * 1024 * 100,
      'grpc.max_send_message_length': 1024 * 1024 * 100,
    });
    const clientFactory = createClientFactory()
      .use(
        this._grpcToken
          ? getGrpcSignedTokenInterceptor(this._grpcToken)
          : getModuleNameInterceptor(this._clientName),
      )
      .use(retryMiddleware);
    const retryOptions = {
      // https://grpc.github.io/grpc/core/md_doc_statuscodes.html
      retryableStatuses: [1, 10, 14], // handle: cancelled, aborted, unavailable
      retryBaseDelayMs: 250,
      retryMaxAttempts: 5,
      retry: true,
    };
    this._healthClient = clientFactory.create(HealthDefinition, this.channel);
    this._conduitClient = clientFactory.create(ConduitModuleDefinition, this.channel, {
      '*': retryOptions,
    });
    this._serviceClient = clientFactory.create(this.type!, this.channel, {
      '*': retryOptions,
    });
    this.active = true;
  }

  get healthClient(): Client<typeof HealthDefinition> | undefined {
    return this._healthClient;
  }

  get conduitClient(): Client<typeof ConduitModuleDefinition> | undefined {
    return this._conduitClient;
  }

  get serviceClient(): Client<T> | undefined {
    return this._serviceClient;
  }

  get healthCheckWatcher() {
    return this.healthCheckEmitter;
  }

  closeConnection() {
    if (!this.channel) return;
    // ConduitGrpcSdk.Logger.warn(`Closing connection for ${this._serviceName}`);
    this.channel.close();
    this.channel = undefined;
    this.active = false;
  }

  check(service: string = '') {
    return this.healthClient!.check({ service }).then((res: HealthCheckResponse) => {
      return res.status;
    });
  }

  async watch(service: string = '') {
    const self = this;
    const serviceName = this.type?.name;
    this.healthCheckEmitter.setMaxListeners(150);
    try {
      const call = this.healthClient!.watch({ service });
      for await (const data of call) {
        self.healthCheckEmitter.emit(`grpc-health-change:${serviceName}`, data.status);
      }
    } catch (error) {
      // uncomment for debug when needed
      // currently is misleading if left on
      // ConduitGrpcSdk.Logger.warn('Connection to gRPC server closed');
    }
  }
}
