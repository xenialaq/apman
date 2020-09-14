import _ from 'lodash';
import fetch from 'node-fetch';
import i18n from 'i18next';
import * as bluebird from 'bluebird';
import { decodeURIComponentObj, mergeKeyToProps } from './utils';
import { props, nestedProps } from './types';
import moduleSpecs from './module-specs';

Object.assign(global.Promise, bluebird);

const getDeviceStatusParser = (body: unknown) => {
  const hostList = _.get(body, 'hosts_info.host_info', []).map(
    (host: nestedProps) => _.mapValues(
      host,
      (hostObj: props) => _.mapKeys(hostObj, (v, k: string) => _.camelCase(k)),
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

export const getDeviceStatus = async ({ token, ip }: props) : Promise<props[]> => {
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
  return response.json().then(getDeviceStatusParser);
};

export const rebootAccessPoint = async ({ token, ip }: props) : Promise<string> => {
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
  return 'OK';
};

export const pingHttp = ({ ip, hostname }: props) : Promise<string> => Promise.race([
  fetch(`http://${ip || hostname}/`, { method: 'GET' }).then((response) => {
    if (response.status !== 200) {
      throw new Error(i18n.t('unknownErr'));
    }
    return 'OK';
  }),
  Promise.delay(1e3).then(() => { throw new Error(i18n.t('accessPointUnreachable')); }),
]);

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

export const getWifiStatus = async ({ token, ip }: props) : Promise<props[]> => {
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
  return response.json().then(getWifiStatusParser);
};

export const getDhcpSettings = async ({ token, ip }: props): Promise<nestedProps> => {
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

export const getInterfaces = async ({ token, ip }: props): Promise<nestedProps> => {
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

export const disconnectPPPoE = async ({ token, ip }: props) : Promise<string> => {
  const response = await fetch(`http://${ip}/stok=${token}/ds`, {
    headers: {
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ network: { change_wan_status: { proto: 'pppoe', operate: 'disconnect' } }, method: 'do' }),
    method: 'POST',
  });
  if (response.status !== 200) {
    throw new Error(i18n.t('unknownErr'));
  }
  return 'OK';
};
