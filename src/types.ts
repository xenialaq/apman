export type props = {[prop: string]: string};
export type nestedProps = {
  [prop: string]: nestedProps[] | nestedProps | props[] | props | string[] | string
};
export type ipTableType = [string, string][];
export enum tasks {
  CONNECTED_DEVICES,
  DHCP_SETTINGS,
  DISCONNECT_PPPOE,
  INTERFACES,
  REBOOT,
  WIFI_STATUS,
}
