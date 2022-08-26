import { ConduitModel } from './Model';
import { IncomingHttpHeaders } from 'http';

export interface ConduitRouteParameters {
  params?: { [field: string]: any };
  path?: string;
  headers: IncomingHttpHeaders;
  context?: { [field: string]: any };
}

export enum RouteOptionType {
  String = 'String',
  Number = 'Number',
  Boolean = 'Boolean',
  Date = 'Date',
  ObjectId = 'ObjectId',
  JSON = 'JSON',
}
export enum RoutePathOptionType {
  String = 'String',
  Number = 'Number',
  Boolean = 'Boolean',
  ObjectId = 'ObjectId',
}

export interface ConduitRouteOptionExtended {
  type: RouteOptionType;
  required: boolean;
}

export interface ConduitRouteOption {
  [field: string]:
    | string
    | string[]
    | ConduitRouteOptionExtended
    | RouteOptionType
    | RouteOptionType[];
}

export interface ConduitPathOptions {
  [field: string]: ConduitPathOptionExtended | RoutePathOptionType;
}

export interface ConduitPathOptionExtended {
  type: RoutePathOptionType;
  required: boolean;
}

export enum ConduitRouteActions {
  GET = 'GET',
  POST = 'POST',
  UPDATE = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

export interface ConduitRouteOptions {
  queryParams?: ConduitRouteOption | ConduitModel;
  bodyParams?: ConduitRouteOption | ConduitModel;
  pathParams?: ConduitPathOptions;
  action: ConduitRouteActions;
  path: string;
  name?: string;
  description?: string;
  middlewares?: string[];
  cacheControl?: string;
}

export interface ConduitRouteObject {
  options: ConduitRouteOptions;
  returns: {
    name: string;
    fields: string;
  };
  grpcFunction: string;
}
