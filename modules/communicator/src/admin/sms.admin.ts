import ConduitGrpcSdk, {
  ConduitRouteActions,
  ConduitRouteReturnDefinition,
  ConduitString,
  GrpcError,
  GrpcServer,
  ParsedRouterRequest,
  RoutingManager,
  UnparsedRouterResponse,
} from '@conduitplatform/grpc-sdk';
import { status } from '@grpc/grpc-js';
import { isNil } from 'lodash';
import { ISmsProvider } from '../interfaces';

export class SmsAdminHandlers {
  private provider: ISmsProvider | undefined;

  constructor(
    private readonly server: GrpcServer,
    private readonly grpcSdk: ConduitGrpcSdk,
    private readonly routingManager: RoutingManager,
    provider: ISmsProvider | undefined,
  ) {
    this.provider = provider;
    this.registerAdminRoutes();
  }

  updateProvider(provider: ISmsProvider) {
    this.provider = provider;
  }

  private registerAdminRoutes() {
    this.routingManager.route(
      {
        path: '/sms/send',
        action: ConduitRouteActions.POST,
        description: `Sends sms.`,
        bodyParams: {
          to: ConduitString.Required,
          message: ConduitString.Required,
        },
      },
      new ConduitRouteReturnDefinition('SendSMS', 'String'),
      this.sendSms.bind(this),
    );
  }

  async sendSms(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { to, message } = call.request.params;
    let errorMessage: string | null = null;

    if (isNil(this.provider)) {
      throw new GrpcError(status.INTERNAL, 'No SMS provider');
    }

    await this.provider.sendSms(to, message).catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage)) {
      throw new GrpcError(status.INTERNAL, errorMessage);
    }
    ConduitGrpcSdk.Metrics?.increment('sms_sent_total');
    return 'SMS sent';
  }
}
