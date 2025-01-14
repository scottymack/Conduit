import convict from 'convict';
import DefaultConfig from './config';
import figmaConfig from './figma.config';
import githubConfig from './github.config';
import microsoftConfig from './microsoft.config';
import googleConfig from './google.config';
import facebookConfig from './facebook.config';
import twitchConfig from './twitch.config';
import slackConfig from './slack.config';
import tokenConfig from './token.config';
import localConfig from './local.config';
import magicLinkConfig from './magicLink.config';
import gitlabConfig from './gitlab.config';
import redditConfig from './reddit.config';
import bitbucketConfig from './bitbucket.config';
import linkedInConfig from './linkedIn.config';
import appleConfig from './apple.config';
import twitterConfig from './twitter.config';
import teamsConfig from './teams.config';

const AppConfigSchema = {
  ...DefaultConfig,
  ...teamsConfig,
  ...figmaConfig,
  ...githubConfig,
  ...microsoftConfig,
  ...googleConfig,
  ...facebookConfig,
  ...twitchConfig,
  ...slackConfig,
  ...tokenConfig,
  ...localConfig,
  ...magicLinkConfig,
  ...gitlabConfig,
  ...appleConfig,
  ...twitterConfig,
  ...redditConfig,
  ...bitbucketConfig,
  ...linkedInConfig,
};
const config = convict(AppConfigSchema);
const configProperties = config.getProperties();
export type Config = typeof configProperties;
export default AppConfigSchema;
