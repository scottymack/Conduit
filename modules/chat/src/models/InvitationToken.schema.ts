import { ConduitActiveSchema, DatabaseProvider, TYPE } from '@conduitplatform/grpc-sdk';
import { User } from './User.model';
import { ChatRoom } from './ChatRoom.schema';

const schema = {
  _id: TYPE.ObjectId,
  sender: {
    type: TYPE.Relation,
    model: 'User',
    required: true,
  },
  receiver: {
    type: TYPE.Relation,
    model: 'User',
    required: true,
  },
  token: {
    type: TYPE.String,
    required: true,
  },
  room: {
    type: TYPE.Relation,
    model: 'ChatRoom',
    required: true,
  },
  createdAt: TYPE.Date,
  updatedAt: TYPE.Date,
};
const modelOptions = {
  timestamps: true,
  conduit: {
    permissions: {
      extendable: true,
      canCreate: false,
      canModify: 'ExtensionOnly',
      canDelete: false,
    },
  },
} as const;
const collectionName = undefined;

export class InvitationToken extends ConduitActiveSchema<InvitationToken> {
  private static _instance: InvitationToken;
  _id: string;
  sender!: string | User;
  receiver!: string | User;
  token!: string;
  room!: string | ChatRoom;
  createdAt: Date;
  updatedAt: Date;

  constructor(database: DatabaseProvider) {
    super(database, InvitationToken.name, schema, modelOptions, collectionName);
  }

  static getInstance(database?: DatabaseProvider) {
    if (InvitationToken._instance) return InvitationToken._instance;
    if (!database) {
      throw new Error('No database instance provided!');
    }
    InvitationToken._instance = new InvitationToken(database);
    return InvitationToken._instance;
  }
}
