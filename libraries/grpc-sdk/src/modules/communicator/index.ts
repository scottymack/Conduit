import { ConduitModule } from '../../classes/ConduitModule';
import { CommunicatorDefinition } from '../../protoUtils/communicator';
import { Email } from './email';
import { PushNotifications } from './pushNotifications';
import { SMS } from './sms';

export class Communicator extends ConduitModule<typeof CommunicatorDefinition> {
  private _sms?: SMS;
  private _pushNotifications?: PushNotifications;
  private _email?: Email;
  constructor(private readonly moduleName: string, url: string, grpcToken?: string) {
    super(moduleName, 'communicator', url, grpcToken);
    this.initializeClient(CommunicatorDefinition);
  }
  get sms() {
    return this._sms;
  }
  get pushNotifications() {
    return this._pushNotifications;
  }
  get email() {
    return this._email;
  }
}
