import { ModuleManager } from '@conduitplatform/grpc-sdk';
import EmailModule from './Email';
import { Config } from './config';
import path from 'path';

const email = new EmailModule();
const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const moduleManager = new ModuleManager<Config>(email, packageJsonPath);
moduleManager.start();
