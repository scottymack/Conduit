import { ConduitModule } from '../../classes/ConduitModule';
import { CommunicatorDefinition } from '../../protoUtils/communicator';
import {
  SendSmsResponse,
  SendVerificationCodeResponse,
  VerifyResponse,
} from '../../protoUtils/sms';

export class Communicator extends ConduitModule<typeof CommunicatorDefinition> {
  constructor(private readonly moduleName: string, url: string, grpcToken?: string) {
    super(moduleName, 'communicator', url, grpcToken);
    this.initializeClient(CommunicatorDefinition);
  }

  registerTemplate(template: {
    name: string;
    subject: string;
    body: string;
    variables: string[];
  }) {
    return this.client!.registerTemplate({
      name: template.name,
      subject: template.subject,
      body: template.body,
      variables: template.variables,
    }).then(res => {
      return JSON.parse(res.template);
    });
  }

  sendEmail(
    templateName: string,
    params: {
      email: string;
      variables: any;
      sender: string;
      replyTo?: string;
      cc?: string[];
      attachments?: string[];
    },
  ) {
    return this.client!.sendEmail({
      templateName,
      params: {
        email: params.email,
        variables: JSON.stringify(params.variables),
        sender: params.sender,
        replyTo: params.replyTo,
        cc: params.cc ?? [],
        attachments: params.attachments ?? [],
      },
    }).then(res => {
      return res.sentMessageInfo;
    });
  }

  sendNotificationToken(token: string, platform: string, userId: string) {
    return this.client!.setNotificationToken({
      token,
      platform,
      userId,
    }).then(res => {
      return JSON.parse(res.newTokenDocument);
    });
  }

  getNotificationTokens(userId: string) {
    return this.client!.getNotificationTokens({
      userId,
    }).then(res => {
      return res.tokenDocuments;
    });
  }

  sendNotification(
    sendTo: string,
    title: string,
    body?: string,
    data?: string,
    platform?: string,
  ) {
    return this.client!.sendNotification({
      sendTo,
      title,
      body,
      data,
      platform,
    }).then(res => {
      return JSON.parse(res.message);
    });
  }

  sendManyNotifications(
    notifications: [
      { sendTo: string; title: string; body?: string; data?: string; platform?: string },
    ],
  ) {
    return this.client!.sendManyNotifications({
      notifications,
    }).then(res => {
      return JSON.parse(res.message);
    });
  }

  sendNotificationToManyDevices(
    sendTo: string[],
    title: string,
    body?: string,
    data?: string,
    platform?: string,
  ) {
    return this.client!.sendNotificationToManyDevices({
      sendTo,
      title,
      body,
      data,
      platform,
    }).then(res => {
      return JSON.parse(res.message);
    });
  }

  sendSms(to: string, message: string): Promise<SendSmsResponse> {
    return this.client!.sendSms({ to, message });
  }

  sendVerificationCode(to: string): Promise<SendVerificationCodeResponse> {
    return this.client!.sendVerificationCode({ to });
  }

  verify(verificationSid: string, code: string): Promise<VerifyResponse> {
    return this.client!.verify({ verificationSid, code });
  }
}
