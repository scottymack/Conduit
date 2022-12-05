import { EventEmitter } from 'events';
import { ConduitModule } from '../../classes/ConduitModule';
import { HealthCheckStatus } from '../../types';
import {
  ConfigDefinition,
  ModuleHealthRequest,
  RegisterModuleRequest,
} from '../../protoUtils/core';
import { Indexable } from '../../interfaces';
import ConduitGrpcSdk, { ManifestManager } from '../../index';

export class Config extends ConduitModule<typeof ConfigDefinition> {
  private readonly emitter = new EventEmitter();
  private coreLive = false;
  private readonly _serviceHealthStatusGetter: (service: string) => HealthCheckStatus;

  constructor(
    moduleName: string,
    readonly url: string,
    serviceHealthStatusGetter: (service: string) => HealthCheckStatus,
    grpcToken?: string,
  ) {
    super(moduleName, 'config', url, grpcToken);
    this.initializeClient(ConfigDefinition);
    this._serviceHealthStatusGetter = serviceHealthStatusGetter;
  }

  getServerConfig() {
    const request = {};
    return this.serviceClient!.getServerConfig(request).then(res => {
      return JSON.parse(res.data);
    });
  }

  getModuleUrlByName(name: string): Promise<{ url: string }> {
    if (name === 'core') return Promise.resolve({ url: this.url });
    return this.serviceClient!.getModuleUrlByName({ name }).then(res => {
      return { url: res.moduleUrl };
    });
  }

  get(name: string) {
    const request = {
      key: name,
    };
    return this.serviceClient!.get(request).then(res => {
      return JSON.parse(res.data);
    });
  }

  configure(config: any, schema: any, override: boolean) {
    const request = {
      config: JSON.stringify(config),
      schema: JSON.stringify(schema),
      override,
    };
    return this.serviceClient!.configure(request).then(res => {
      return JSON.parse(res.result);
    });
  }

  getRedisDetails() {
    const request: Indexable = {};
    return this.serviceClient!.getRedisDetails(request);
  }

  registerModule(
    url: string,
    healthStatus: Omit<HealthCheckStatus, HealthCheckStatus.SERVICE_UNKNOWN>,
  ) {
    const request: RegisterModuleRequest = {
      manifest: ManifestManager.getInstance().manifest,
      url: url.toString(),
      healthStatus: healthStatus as number,
    };
    const self = this;
    return this.serviceClient!.registerModule(request).then(() => {
      self.coreLive = true;
    });
  }

  getDeploymentState() {
    return this.serviceClient!.getDeploymentState({});
  }

  moduleHealthProbe(name: string, url: string) {
    const request: ModuleHealthRequest = {
      moduleName: name.toString(),
      moduleVersion: ManifestManager.getInstance().moduleVersion,
      moduleUrl: url,
      status: this._serviceHealthStatusGetter(''),
    };
    const self = this;
    this.serviceClient!.moduleHealthProbe(request)
      .then(res => {
        if (!res && self.coreLive) {
          ConduitGrpcSdk.Logger.warn('Core unhealthy');
          self.coreLive = false;
        } else if (res && !self.coreLive) {
          ConduitGrpcSdk.Logger.log('Core is live');
          self.coreLive = true;
          self.watchDeploymentState();
        }
      })
      .catch(e => {
        if (self.coreLive) {
          ConduitGrpcSdk.Logger.warn('Core unhealthy');
          self.coreLive = false;
        }
      });
  }

  getModuleWatcher() {
    return this.emitter;
  }

  async watchDeploymentState() {
    const self = this;
    this.emitter.setMaxListeners(150);
    self.emitter.emit('serving-modules-update', await self.getDeploymentState().catch());
    try {
      const call = this.serviceClient!.watchDeploymentState({});
      for await (const data of call) {
        self.emitter.emit(
          'serving-modules-update',
          data.modules.filter(m => !m.pending),
        );
      }
    } catch (error) {
      self.coreLive = false;
      ConduitGrpcSdk.Logger.warn('Core unhealthy');
    }
  }
}
