import ConduitGrpcSdk, {
  GrpcServer,
  RouterRequest,
  RouterResponse,
} from '@quintessential-sft/conduit-grpc-sdk';
import { status } from '@grpc/grpc-js';
import { isNil } from 'lodash';
import { StripeHandlers } from '../handlers/stripe';

let paths = require('./admin.json').functions;
export class AdminHandlers {
  private database: any;

  constructor(
    server: GrpcServer,
    private readonly grpcSdk: ConduitGrpcSdk,
    private readonly stripeHandlers: StripeHandlers | null
  ) {
    const self = this;
    grpcSdk.waitForExistence('database-provider').then(() => {
      self.database = self.grpcSdk.databaseProvider;
    });

    this.grpcSdk.admin
      .registerAdmin(server, paths, {
        createProduct: this.createProduct.bind(this),
      })
      .catch((err: Error) => {
        console.log('Failed to register admin routes for module!');
        console.error(err);
      });
  }

  async createProduct(call: RouterRequest, callback: RouterResponse) {
    const {
      name,
      value,
      currency,
      isSubscription,
      recurring,
      recurringCount,
    } = JSON.parse(call.request.params);

    if (isNil(name) || isNil(value) || isNil(currency)) {
      return callback({
        code: status.INVALID_ARGUMENT,
        message: 'product name, value and currency are required',
      });
    }

    let errorMessage: string | null = null;

    let productDoc: any = {
      name,
      value,
      currency,
      isSubscription,
      recurring,
      recurringCount,
    };

    if (isSubscription) {
      if (isNil(recurring)) {
        return callback({
          code: status.INVALID_ARGUMENT,
          message: 'recurring is required for subscription products',
        });
      }
      if (
        recurring !== 'day' &&
        recurring !== 'week' &&
        recurring !== 'month' &&
        recurring !== 'year'
      ) {
        return callback({
          code: status.INVALID_ARGUMENT,
          message: 'recurring must be one of [day, week, month, year]',
        });
      }

      if (!isNil(this.stripeHandlers)) {
        try {
          const res = await this.stripeHandlers.createSubscriptionProduct(
            name,
            currency,
            value,
            recurring,
            recurringCount
          );

          productDoc.stripe = {};
          productDoc.stripe.subscriptionId = res.subscriptionId;
          productDoc.stripe.priceId = res.priceId;
        } catch (e) {
          return callback({ code: status.INTERNAL, message: e });
        }
      }
    }

    const product = await this.database
      .create('Product', productDoc)
      .catch((e: Error) => {
        errorMessage = e.message;
      });
    if (!isNil(errorMessage)) {
      return callback({
        code: status.INTERNAL,
        message: errorMessage,
      });
    }

    this.grpcSdk.bus?.publish('payments:create:Product', JSON.stringify(productDoc));

    return callback(null, { result: JSON.stringify(product) });
  }
}
