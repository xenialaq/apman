import _ from 'lodash';
import { table } from 'table';
import chalk from 'chalk';
import fetch from 'node-fetch';
import fs from 'fs';
import i18n from 'i18next';
import ini from 'ini';
import log, { LogLevelDesc } from 'loglevel';
import Promise from 'bluebird';
import prompts from 'prompts';
import retry from 'promise-retry';
import enUS from './resources/locales/en';
import { props, ipTableType, tasks } from './types';
import { hash } from './security';
import { decodeURIComponentObj, mergeKeyToProps } from './utils';
import {
  disconnectPPPoE, getDeviceStatus, getDhcpSettings, getInterfaces, getWifiStatus,
  pingHttp, rebootAccessPoint,
} from './actions';
import zhCN from './resources/locales/zh';

const {
  PASSWORD, LANGUAGE, IP_TABLE, LOG_LEVEL,
} = ini.parse(fs.readFileSync('apman.ini', 'utf-8'));

if (LOG_LEVEL) {
  log.setLevel(LOG_LEVEL as LogLevelDesc);
} else {
  log.setLevel('info');
}

const i18nRes = {
  'en-US': enUS,
  'zh-CN': zhCN,
};

const loadLocales = (language: string) => i18n.init({
  lng: language,
  resources: i18nRes,
});

const loadConfig = async () => {
  const password = (PASSWORD || '').toString();
  log.debug('password =', password);
  let language = _(LANGUAGE || '').toString();
  log.debug('language =', language);
  if (!Object.keys(i18nRes).includes(language)) {
    language = 'en-US';
  }
  await loadLocales(language);
  let ipTable: ipTableType;
  try {
    ipTable = (IP_TABLE || []).map((entry: string) => entry.split('|').map(_.trim));
  } catch {
    throw new Error(i18n.t('confInvalid'));
  }
  if (ipTable.length === 0) {
    throw new Error(i18n.t('confInvalid'));
  }
  log.debug('ipTable =', ipTable);
  return { password, language, ipTable };
};

const auth = async (password: string, ip: string) => {
  const {
    stok,
  } = await fetch(`http://${ip}/`, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: `{"method":"do","login":{"password":"${hash(password)}"}}`,
    method: 'POST',
    timeout: 1e4,
  }).then((res) => res.json());
  if (!stok) {
    throw new Error(i18n.t('loginFailed'));
  }
  log.info(i18n.t('loginSuccess'));
  return stok;
};

const selectAccessPoint = async (ipTable: ipTableType) => {
  const response = await prompts({
    type: 'select',
    name: 'accessPointKey',
    message: i18n.t('selectAccessPointPromptMsg'),
    choices: ipTable.map(([key]) => ({ title: key, value: key })),
  }, { onCancel: () => process.exit(2) });
  return response;
};

const selectTask = async () => {
  const response = await prompts({
    type: 'select',
    name: 'accessPointTask',
    message: i18n.t('selectTaskPromptMsg'),
    choices: [
      { title: i18n.t('disconnectPPPoE'), value: tasks.DISCONNECT_PPPOE },
      { title: i18n.t('interfacesOverview'), value: tasks.INTERFACES },
      { title: i18n.t('connectedDevices'), value: tasks.CONNECTED_DEVICES },
      { title: i18n.t('wifiStatus'), value: tasks.WIFI_STATUS },
      { title: i18n.t('dhcpSettings'), value: tasks.DHCP_SETTINGS },
      { title: i18n.t('reboot'), value: tasks.REBOOT },
    ],
  }, { onCancel: () => process.exit(2) });
  return response;
};

const tabularizeStatus = (
  statusList: props[],
  mapper: (status: props) => props = _.identity,
) => {
  let mappedList = statusList.map((o) => mapper(o));
  const keys = _.intersection(...mappedList.map(Object.keys)).filter((key) => key.charAt(0) !== '.');
  mappedList = mappedList.map((o: props) => _.pick(o, keys));
  const propsToValues = (o: props) => Object.values(o);
  return [
    keys.map((propName) => i18n.t(propName)),
    ...mappedList.map(propsToValues),
  ];
};

const mainLoop = async ({ password, ipTable }: { password: string, ipTable: ipTableType }) => {
  const { accessPointKey } = await selectAccessPoint(ipTable);
  const [, ip] = _.find(ipTable, ([k]) => k === accessPointKey) || [];
  if (!ip) {
    return;
  }
  const token = await auth(password, ip);
  log.debug({ key: accessPointKey, ip });
  const { accessPointTask } = await selectTask();
  if (accessPointTask === tasks.REBOOT) {
    await rebootAccessPoint({
      token,
      ip,
    });
    log.info(i18n.t('rebootWaitMsg'));
    await Promise.delay(5e3);
    try {
      await retry((r, number) => {
        log.info(i18n.t('attemptReconnectMsg'), number);
        return pingHttp({ ip }).catch((err: Error) => {
          r(err);
        });
      }, { retries: 10, factor: 1, minTimeout: 2e3 });
      log.info(i18n.t('rebootFinishedMsg'));
    } catch (ex) {
      log.error(ex);
    }
  } else if (accessPointTask === tasks.DISCONNECT_PPPOE) {
    await disconnectPPPoE({
      token,
      ip,
    });
    log.info(i18n.t('disconnectWaitMsg'));
    await Promise.delay(5e3);
    try {
      await retry((r, number) => {
        log.info(i18n.t('attemptReconnectMsg'), number);
        return pingHttp({ hostname: 'example.com' }).catch((err: Error) => {
          r(err);
        });
      }, { retries: 10, factor: 1, minTimeout: 2e3 });
      log.info(i18n.t('disconnectFinishedMsg'));
    } catch (ex) {
      log.error(ex);
    }
  } else if (accessPointTask === tasks.CONNECTED_DEVICES) {
    const ds = await getDeviceStatus({
      token,
      ip,
    });
    const dtable = tabularizeStatus(ds, (o) => {
      let prettyO = { ...o };
      if (o.isCurHost) {
        prettyO = _.mapValues(prettyO, (v) => chalk.red(v));
      }
      return prettyO;
    });
    log.info(table(dtable, {
      drawHorizontalLine: (index, size) => index <= 1 || index === size,
    }));
  } else if (accessPointTask === tasks.WIFI_STATUS) {
    const ws = await getWifiStatus({
      token,
      ip,
    });
    const dtable = tabularizeStatus(ws);
    log.info(table(dtable, {
      drawHorizontalLine: (index, size) => index <= 1 || index === size,
    }));
  } else if (accessPointTask === tasks.DHCP_SETTINGS) {
    const dhcpSettings = await getDhcpSettings({
      token,
      ip,
    });
    log.info('DHCP Settings');
    log.info(table(tabularizeStatus([decodeURIComponentObj(_.get(dhcpSettings, 'dhcpd.udhcpd') as props)])));
    if (!_.get(dhcpSettings, 'dhcpd.dhcp_clients').length) {
      return;
    }
    log.info('DHCP Clients');
    log.info(table(tabularizeStatus((_.get(dhcpSettings, 'dhcpd.dhcp_clients') as props[])
      .map(mergeKeyToProps).map(decodeURIComponentObj))));
  } else if (accessPointTask === tasks.INTERFACES) {
    const interfaces = await getInterfaces({
      token,
      ip,
    });
    log.info(i18n.t('lanInterface'));
    log.info(table(tabularizeStatus([_.get(interfaces, 'network.lan') as props])));
    log.info(i18n.t('wanInterface'));
    log.info(table(tabularizeStatus([_.get(interfaces, 'network.wan_status') as props])));
  }
};

const main = async () => {
  const { password, ipTable } = await loadConfig();
  // eslint-disable-next-line no-constant-condition
  while (true) {
  // eslint-disable-next-line no-await-in-loop
    await mainLoop({ password, ipTable });
  }
};

main().catch(log.error);
