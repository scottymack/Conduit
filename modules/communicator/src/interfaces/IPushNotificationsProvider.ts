import { ISendNotification, ISendNotificationToManyDevices } from './ISendNotification';

export interface IPushNotificationsProvider {
  get isInitialized(): boolean;

  sendToDevice(params: ISendNotification): Promise<any>;

  sendMany(params: ISendNotification[]): Promise<any>;

  sendToManyDevices(params: ISendNotificationToManyDevices): Promise<any>;
}
