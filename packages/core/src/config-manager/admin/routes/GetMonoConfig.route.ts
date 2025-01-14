import ConduitGrpcSdk, {
  ConduitRouteActions,
  ConduitJson,
} from '@conduitplatform/grpc-sdk';
import { RegisteredModule } from '@conduitplatform/commons';
import { ConduitRoute, ConduitRouteReturnDefinition } from '@conduitplatform/hermes';

export function getMonoConfigRoute(
  grpcSdk: ConduitGrpcSdk,
  registeredModules: Map<string, RegisteredModule>,
) {
  return new ConduitRoute(
    {
      path: '/config',
      action: ConduitRouteActions.GET,
      description:
        'Returns a monolithic configuration object for currently registered modules.',
    },
    new ConduitRouteReturnDefinition('GetMonoConfigRoute', {
      config: ConduitJson.Required,
    }),
    async () => {
      const monoConfig: { modules: { [moduleName: string]: object } } = { modules: {} };
      const sortedModules = [
        'core',
        'admin',
        ...Array.from(registeredModules.keys()),
      ].sort();
      for (const moduleName of sortedModules) {
        const moduleConfig = await grpcSdk.state!.getKey(`moduleConfigs.${moduleName}`);
        if (moduleConfig) monoConfig.modules[moduleName] = JSON.parse(moduleConfig);
      }
      return { config: monoConfig };
    },
  );
}
