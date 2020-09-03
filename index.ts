import env from 'dotenv';
import _ from 'lodash';
import fetch from 'node-fetch';
import Promise from 'bluebird';
import log, { LogLevelDesc } from 'loglevel';
import prompts from 'prompts';
import retry from 'promise-retry';
import { table } from 'table';
import chalk from 'chalk';
import i18n from 'i18next';
import { hash } from './security';
import enUS from './resources/locales/en';
import zhCN from './resources/locales/zh';
import moduleSpecs from './module-specs';

env.config();
if (process.env.LOG_LEVEL) {
  log.setLevel(process.env.LOG_LEVEL as LogLevelDesc);
} else {
  log.setLevel('debug');
}

type props = {[prop: string]: string};
type nestedProps = {[prop: string]: nestedProps};
enum tasks {
  CONNECTED_DEVICES,
  WIFI_STATUS,
  REBOOT,
  DHCP_SETTINGS,
  INTERFACES
}

const password = process.env.PASSWORD || '';

const loadLocales = () => i18n.init({
  lng: _.kebabCase(process.env.LANGUAGE) || 'en-US',
  resources: {
    'en-US': enUS,
    'zh-CN': zhCN,
  },
});

const ipTable: [string, string][] = process.env.IP_TABLE ? JSON.parse(process.env.IP_TABLE) : [
  // ['accessPoint name', 'accessPoint ip'],
];

const mergeKeyToProps: ((o: nestedProps) => props) = (o) => ({
  ...Object.values(o)[0],
  id: Object.keys(o)[0].replace(/\D/g, ''),
});

const decodeURIComponentObj = (o: props) => _.mapValues(o, (v) => decodeURIComponent(v));

const auth = async (ip: string) => {
  const {
    stok,
  } = await fetch(`http://${ip}/`, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: `{"method":"do","login":{"password":"${hash(password)}"}}`,
    method: 'POST',
  }).then((res) => res.json());
  if (!stok) {
    throw new Error(i18n.t('loginFailed'));
  }
  log.info(i18n.t('loginSuccess'));
  return stok;
};

const getDeviceStatus = async ({ token, ip }: { token: string, ip: string}) => {
  const response = await fetch(`http://${ip}/stok=${token}/ds`, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      hosts_info: {
        table: 'host_info',
      },
      method: 'get',
    }),
    method: 'POST',
  });
  if (response.status !== 200) {
    throw new Error(i18n.t('unknownErr'));
  }
  return response.json();
};

const getDeviceStatusParser = (body: unknown) => {
  const hostList = _.get(body, 'hosts_info.host_info', []).map(
    (host: nestedProps) => _.mapValues(
      host,
      (hostObj) => _.mapKeys(hostObj, (v, k: string) => _.camelCase(k)),
    ),
  );
  return hostList.map((host: nestedProps) => {
    const {
      id, ip: dIp, mac, hostname, isCurHost,
    } = decodeURIComponentObj(mergeKeyToProps(host));
    return {
      id, ip: dIp, mac, hostname: hostname || i18n.t('N/A'), isCurHost: isCurHost !== '0',
    };
  });
};

const rebootAccessPoint = async ({ token, ip }: props) => {
  const response = await fetch(`http://${ip}/stok=${token}/ds`, {
    headers: {
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ system: { reboot: null }, method: 'do' }),
    method: 'POST',
  });
  if (response.status !== 200) {
    throw new Error(i18n.t('unknownErr'));
  }
};

const pingAccessPoint = async ({ ip }: props) => {
  await Promise.race([
    fetch(`http://${ip}/`, { method: 'GET' }),
    Promise.delay(1e3).then(() => { throw new Error(i18n.t('accessPointUnreachable')); }),
  ]);
};

const getWifiStatus = async ({ token, ip }: props) => {
  const response = await fetch(`http://${ip}/stok=${token}/ds`, {
    headers: {
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      wireless: { name: ['wlan_host_2g', 'wlan_host_5g'] },
      method: 'get',
    }),
    method: 'POST',
  });
  if (response.status !== 200) {
    throw new Error(i18n.t('unknownErr'));
  }
  return response.json();
};

const getWifiStatusParser = (body: unknown) => {
  const mapper = (o: props, band: string) => decodeURIComponentObj(_.mapValues(o, (v, k) => {
    let propTexts = _.get(moduleSpecs, `wireless${band}_${k}`);
    if (k === 'power') {
      propTexts = _.get(moduleSpecs, 'power_list');
    }
    let propIdx = parseInt(v, 10);
    if (k === 'mode' && band === '5g') {
      propIdx -= 7;
    }
    if (k === 'channel' && propIdx > 0) {
      propTexts = undefined; // channel is not set to auto
    }
    return Array.isArray(propTexts) ? propTexts[propIdx] : v;
  }));
  return [
    mapper({
      type: 'wlan_host_2g',
      ..._.get(body, 'wireless.wlan_host_2g', []),
      vhtmubfer: i18n.t('N/A'),
    }, '2g'),
    mapper({
      type: 'wlan_host_5g',
      ..._.get(body, 'wireless.wlan_host_5g', []),
    }, '5g'),
  ];
};

const getDhcpSettings = async ({ token, ip }: props) => {
  const response = await fetch(`http://${ip}/stok=${token}/ds`, {
    headers: {
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      dhcpd: { name: ['udhcpd'], table: ['dhcp_clients'] },
      method: 'get',
    }),
    method: 'POST',
  });
  if (response.status !== 200) {
    throw new Error(i18n.t('unknownErr'));
  }
  return response.json();
};

const getInterfaces = async ({ token, ip }: props) => {
  const response = await fetch(`http://${ip}/stok=${token}/ds`, {
    headers: {
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      network: { name: ['lan', 'wan_status'] },
      method: 'get',
    }),
    method: 'POST',
  });
  if (response.status !== 200) {
    throw new Error(i18n.t('unknownErr'));
  }
  return response.json();
};

const selectAccessPoint = async () => {
  const response = await prompts({
    type: 'select',
    name: 'accessPointKey',
    message: i18n.t('selectAccessPointPromptMsg'),
    choices: ipTable.map(([key]) => ({ title: key, value: key })),
  });
  return response;
};

const selectTask = async () => {
  const response = await prompts({
    type: 'select',
    name: 'accessPointTask',
    message: i18n.t('selectTaskPromptMsg'),
    choices: [
      { title: i18n.t('reboot'), value: tasks.REBOOT },
      { title: i18n.t('connectedDevices'), value: tasks.CONNECTED_DEVICES },
      { title: i18n.t('wifiStatus'), value: tasks.WIFI_STATUS },
      { title: i18n.t('dhcpSettings'), value: tasks.DHCP_SETTINGS },
      { title: i18n.t('interfacesOverview'), value: tasks.INTERFACES },
    ],
  });
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

const main = async () => {
  await loadLocales();
  const { accessPointKey } = await selectAccessPoint();
  const [, ip] = _.find(ipTable, ([k]) => k === accessPointKey) || [];
  if (!ip) {
    return;
  }
  const token = await auth(ip);
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
        return pingAccessPoint({ ip }).catch((err: Error) => {
          r(err);
        });
      }, { retries: 1, factor: 1, minTimeout: 2e3 });
    } catch (ex) {
      log.error(ex);
    }
  } else if (accessPointTask === tasks.CONNECTED_DEVICES) {
    const ds = await getDeviceStatus({
      token,
      ip,
    }).then(getDeviceStatusParser);
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
    }).then(getWifiStatusParser);
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
    log.info(table(tabularizeStatus([decodeURIComponentObj(dhcpSettings.dhcpd.udhcpd)])));
    if (!dhcpSettings.dhcpd.dhcp_clients.length) {
      return;
    }
    log.info('DHCP Clients');
    log.info(table(tabularizeStatus(dhcpSettings.dhcpd.dhcp_clients
      .map(mergeKeyToProps).map(decodeURIComponentObj))));
  } else if (accessPointTask === tasks.INTERFACES) {
    const interfaces = await getInterfaces({
      token,
      ip,
    });
    log.info(i18n.t('lanInterface'));
    log.info(table(tabularizeStatus([interfaces.network.lan])));
    log.info(i18n.t('wanInterface'));
    log.info(table(tabularizeStatus([interfaces.network.wan_status])));
  }
};

main();
