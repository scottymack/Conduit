import { ModuleManager } from '@conduitplatform/grpc-sdk';
import Communicator from './Communicator';
import { Config } from './config';

const communicator = new Communicator();
const moduleManager = new ModuleManager<Config>(communicator);
moduleManager.start();
