import convict from 'convict';
import emailConfig from './email.config';
import smsConfig from './sms.config';
import pushNotificationsConfig from './pushNotifications.config';

const AppConfigSchema = {
  ...pushNotificationsConfig,
  ...smsConfig,
  ...emailConfig,
};
const config = convict(AppConfigSchema);
const configProperties = config.getProperties();
export type Config = typeof configProperties;
export default AppConfigSchema;
