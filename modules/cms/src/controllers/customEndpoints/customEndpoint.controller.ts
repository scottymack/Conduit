import ConduitGrpcSdk from "@quintessential-sft/conduit-grpc-sdk";
import { CustomEndpointHandler } from "../../handlers/CustomEndpoints/customEndpoint.handler";
import { CustomEndpoint } from "../../models/customEndpoint";
import { CmsRoutes } from "../../routes/Routes";
import { createCustomEndpointRoute } from "./utils";

export class CustomEndpointController {
  private _adapter: any;

  constructor(private readonly grpcSdk: ConduitGrpcSdk, private router: CmsRoutes) {
    this._adapter = this.grpcSdk.databaseProvider!;
    this.refreshRoutes();
  }

  refreshRoutes() {
    return this._adapter
      .findMany("CustomEndpoints", { enabled: true })
      .then((r: CustomEndpoint[]) => {
        if (!r || r.length == 0) {
          return console.log("No custom endpoints to register");
        }
        let routes: any[] = [];
        r.forEach((schema: CustomEndpoint) => {
          routes.push(createCustomEndpointRoute(schema));
          CustomEndpointHandler.addNewCustomOperationControl(schema);
        });

        this.router.addRoutes(routes);
      })
      .catch((err: Error) => {
        console.error("Something went wrong when loading custom endpoints to the router");
        console.error(err);
      });
  }

  refreshEndpoints(): void {
    this.refreshRoutes().then((r:any) => {
      this.router.requestRefresh();
    });
  }
}