import {
  ConduitRouteActions,
  ConduitRouteParameters,
  ConduitString,
  ConduitError,
} from '@conduitplatform/grpc-sdk';
import { Admin } from '../models';
import { ConduitRoute, ConduitRouteReturnDefinition } from '@conduitplatform/hermes';

export function getAdminRoute() {
  return new ConduitRoute(
    {
      path: '/admins/:id',
      action: ConduitRouteActions.GET,
      description: `Returns an admin user. Passing 'me' as 'id' returns the authenticated admin performing the request`,
      urlParams: {
        id: ConduitString.Required,
      },
    },
    new ConduitRouteReturnDefinition('GetAdmin', Admin.name),
    async (req: ConduitRouteParameters) => {
      const adminId = req.params!.id;
      const admin: Admin =
        adminId === 'me'
          ? req.context!.admin
          : await Admin.getInstance().findOne({ _id: adminId });
      if (!admin) {
        throw ConduitError.notFound('Admin does not exist');
      }
      return admin;
    },
  );
}
