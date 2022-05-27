import path from 'path';
import fs from 'fs';
import { credentials, Metadata, loadPackageDefinition } from '@grpc/grpc-js';
import {
  ConduitSocket,
  ConduitMiddleware,
  ConduitSocketEvent,
  ConduitSocketParameters,
  EventResponse,
  JoinRoomResponse,
  SocketProtoDescription,
  instanceOfSocketProtoDescription,
} from '../interfaces';
import { ConduitRoute } from '../classes';
import { ConduitRouteParameters, ConduitStreamRouteParameters } from '@conduitplatform/grpc-sdk';

const protoLoader = require('@grpc/proto-loader');

function getDescriptor(protofile: string): any {
  let protoPath = path.resolve(__dirname, Math.random().toString(36).substring(7));
  fs.writeFileSync(protoPath, protofile);
  var packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  fs.unlink(protoPath, () => {
  });
  return loadPackageDefinition(packageDefinition);
}

export function grpcToConduitRoute(
  routerName: string,
  request: any,
  moduleName?: string,
  grpcToken?: string,
): (ConduitRoute | ConduitMiddleware | ConduitSocket)[] {
  let routes: [
      { options: any; returns?: any; grpcFunction: string } | SocketProtoDescription
  ] = request.routes;

  let routerDescriptor: any = getDescriptor(request.protoFile);
  //this can break everything change it
  while (Object.keys(routerDescriptor)[0] !== routerName) {
    routerDescriptor = routerDescriptor[Object.keys(routerDescriptor)[0]];
  }
  routerDescriptor = routerDescriptor[Object.keys(routerDescriptor)[0]];
  const serverIp = request.routerUrl;
  const client = new routerDescriptor(serverIp, credentials.createInsecure(), {
    'grpc.max_receive_message_length': 1024 * 1024 * 100,
    'grpc.max_send_message_length': 1024 * 1024 * 100,
  });

  return createHandlers(routes, client, moduleName, grpcToken);
}

function createHandlers(
  routes: [
      { options: any; returns?: any; grpcFunction: string } | SocketProtoDescription
  ],
  client: any,
  moduleName?: string,
  grpcToken?: string,
) {
  const finalRoutes: (ConduitRoute | ConduitMiddleware | ConduitSocket)[] = [];

  routes.forEach((r) => {
    let route;
    const metadata = new Metadata();
    if (grpcToken) {
      metadata.add('grpc-token', grpcToken);
    }
    if (instanceOfSocketProtoDescription(r)) {
      route = createHandlerForSocket(r, client, metadata, moduleName);
    } else {
      route = createHandlerForRoute(r, client, metadata, moduleName);
    }

    if (route != undefined) {
      finalRoutes.push(route);
    }
  });

  return finalRoutes;
}

function createHandlerForRoute(
  route: { options: any; returns?: any; grpcFunction: string },
  client: any,
  metadata: Metadata,
  moduleName?: string,
) {
  const handler = (req: ConduitRouteParameters | ConduitStreamRouteParameters) => {
    let request = {
      params: req.params ? JSON.stringify(req.params) : null,
      path: req.path,
      headers: JSON.stringify(req.headers),
      context: JSON.stringify(req.context),
    };
    return new Promise((resolve, reject) => {
      client[route.grpcFunction](request, metadata, (err: any, result: any) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
  };

  let options: any = route.options;
  for (let k in options) {
    if (!options.hasOwnProperty(k) || options[k].length === 0) continue;
    try {
      options[k] = JSON.parse(options[k]);
    } catch (e) {
    }
  }

  let returns: any = route.returns;
  if (returns) {
    for (let k in returns) {
      if (!returns.hasOwnProperty(k) || returns[k].length === 0) continue;
      try {
        returns[k] = JSON.parse(returns[k]);
      } catch (e) {
      }
    }
  }
  if (!options.path.startsWith('/')) {
    options.path = `/${options.path}`;
  }

  if (moduleName) {
    if (
      !(
        options.path.startsWith(`/${moduleName}/`) ||
        options.path.startsWith(`/hook/${moduleName}/`)
      )
    ) {
      if (
        options.path.startsWith(`/hook`) &&
        !options.path.startsWith(`/hook/${moduleName}/`)
      ) {
        options.path = options.path.replace('/hook', `/hook/${moduleName!.toString()}`);
      } else {
        options.path = `/${moduleName!.toString()}${options.path.toString()}`;
      }
    }
  }

  if (returns) {
    return new ConduitRoute(options, returns, handler);
  } else {
    return new ConduitMiddleware(options, route.grpcFunction, handler);
  }
}

function createHandlerForSocket(
  socket: SocketProtoDescription,
  client: any,
  metadata: Metadata,
  moduleName?: string,
) {
  let eventHandlers = new Map<string, ConduitSocketEvent>();
  const events = JSON.parse(socket.events);
  for (const event in events) {
    let handler = (req: ConduitSocketParameters) => {
      let request = {
        event: req.event,
        socketId: req.socketId,
        params: req.params ? JSON.stringify(req.params) : null,
        context: req.context ? JSON.stringify(req.context) : null,
      };

      return new Promise<EventResponse | JoinRoomResponse>((resolve, reject) => {
        client[events[req.event].grpcFunction](
          request,
          metadata,
          (
            err: { code: number; message: string },
            result: EventResponse | JoinRoomResponse,
          ) => {
            if (err) {
              return reject(err);
            }
            resolve(result);
          },
        );
      });
    };

    const socketEvent: ConduitSocketEvent = {
      name: event,
      handler,
    };

    eventHandlers.set(event, socketEvent);
  }

  if (moduleName) {
    if (!socket.options.path.startsWith('/')) {
      socket.options.path = `/${socket.options.path}`;
    }
    if (!socket.options.path.startsWith(`/${moduleName}/`)) {
      socket.options.path = `/${moduleName}${socket.options.path}`;
    }
  }

  return new ConduitSocket(socket.options, eventHandlers);
}
