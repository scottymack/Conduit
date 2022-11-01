import { ConduitModule } from '../../classes/ConduitModule';
import { CommunicatorDefinition } from '../../protoUtils/communicator';

export class Communicator extends ConduitModule<typeof CommunicatorDefinition> {
  constructor(private readonly moduleName: string, url: string, grpcToken?: string) {
    super(moduleName, 'communicator', url, grpcToken);
    this.initializeClient(CommunicatorDefinition);
  }
}
