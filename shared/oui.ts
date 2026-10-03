/**
 * MAC OUI → vendor lookup.
 *
 * A curated table of the prefixes that show up in real networks (and in the demo
 * device), not the full IEEE registry. Drop a complete oui.txt in here and extend
 * `OUI_VENDORS` if you need exhaustive coverage — the lookup signature stays the same.
 */

export const OUI_VENDORS: Record<string, string> = {
  // MikroTik
  '488F5A': 'MikroTik', '744D28': 'MikroTik', 'DC2C6E': 'MikroTik', 'E48D8C': 'MikroTik',
  '64D154': 'MikroTik', '18FD74': 'MikroTik', '6C3B6B': 'MikroTik', '2CC81B': 'MikroTik',
  '789A18': 'MikroTik', 'CC2DE0': 'MikroTik',
  // Cisco / Meraki
  '001B0C': 'Cisco', '00260B': 'Cisco', '2C3F38': 'Cisco', '001E13': 'Cisco',
  '001AA1': 'Cisco', '002414': 'Cisco', '881DFC': 'Cisco Meraki', 'E0CBB0': 'Cisco Meraki',
  // Ubiquiti
  '24A43C': 'Ubiquiti', '788A20': 'Ubiquiti', 'F09FC2': 'Ubiquiti',
  '7483C2': 'Ubiquiti', '68D79A': 'Ubiquiti', '802AA8': 'Ubiquiti', 'E063DA': 'Ubiquiti',
  // Aruba / HPE
  '3CD92B': 'HPE', '000B86': 'Aruba', '6CF37F': 'Aruba', '94B40F': 'Aruba',
  '40A6E8': 'Aruba', '204C03': 'Aruba',
  // Servers / virtualisation
  '1866DA': 'Dell', '001422': 'Dell', '509A4C': 'Dell', '000C29': 'VMware',
  '005056': 'VMware', '000569': 'VMware', '00155D': 'Microsoft (Hyper-V)',
  '001132': 'Synology', '9009D0': 'Synology', '245EBE': 'QNAP', '00089B': 'QNAP',
  '0014EE': 'Western Digital', '3C970E': 'Intel', '001B21': 'Intel', '8C1645': 'Intel',
  'B827EB': 'Raspberry Pi', 'DCA632': 'Raspberry Pi', 'E45F01': 'Raspberry Pi', '28CDC1': 'Raspberry Pi',
  // End-user compute
  '3C22FB': 'Apple', 'F01898': 'Apple', 'A483E7': 'Apple', '9C207B': 'Apple',
  '8C7712': 'Samsung', 'F8042E': 'Samsung', '5C0A5B': 'Samsung', '3423BA': 'Samsung',
  '64CC2E': 'Xiaomi', '7811DC': 'Xiaomi', '00E0FC': 'Huawei', '48437C': 'Huawei',
  '3C5AB4': 'Google', 'F4F5D8': 'Google', '94EB2C': 'Google',
  // Network gear (consumer/SMB)
  '50C7BF': 'TP-Link', 'AC84C6': 'TP-Link', 'B04E26': 'TP-Link', '6032B1': 'TP-Link',
  '9C3DCF': 'Netgear', '28C68E': 'Netgear', '1C7EE5': 'D-Link', '340804': 'D-Link',
  // IoT / smart home
  '240AC4': 'Espressif (ESP32)', '3C71BF': 'Espressif (ESP32)', '84F3EB': 'Espressif (ESP32)',
  '5CCF7F': 'Espressif (ESP32)', 'A4CF12': 'Espressif (ESP32)',
  '18B430': 'Google Nest', '641666': 'Google Nest',
  '44D9E7': 'Ubiquiti', '5CAAFD': 'Sonos', '7828CA': 'Sonos', 'B8E937': 'Sonos',
  'AC3A7A': 'Roku', '44650D': 'Amazon', '74C246': 'Amazon', 'F0272D': 'Amazon', '6837E9': 'Amazon',
  // Consumer electronics / end-user kit
  '001C62': 'LG', '0013A9': 'Sony', '000D3A': 'Microsoft', '00096B': 'Lenovo',
  // Cameras / NVR
  '4419B6': 'Hikvision', 'BCAD28': 'Hikvision', 'C056E3': 'Hikvision',
  '9002A9': 'Dahua', '3CEF8C': 'Dahua', 'ACCC8E': 'Axis', 'B8A44F': 'Axis',
  // Printers / scanners
  '001E0B': 'HP', '9CB654': 'HP', '008077': 'Brother', '30055C': 'Brother',
  '0000AA': 'Xerox', '9C934E': 'Xerox', '0021B7': 'Lexmark',
  // Voice
  '0004F2': 'Polycom', '64167F': 'Polycom', '805EC0': 'Yealink', '001565': 'Yealink',
  'C074AD': 'Grandstream', '000B82': 'Grandstream',
  // Storage / misc infra
  '0025B3' : 'Hitachi', '001B4F': 'Avaya', '0073E0': 'Samsung', '0026BB': 'Apple',
};

/** Mask-free lookup: normalises `aa:bb:cc:dd:ee:ff`, `AA-BB-...` and `aabb.ccdd.eeff`. */
export function normaliseMac(mac?: string | null): string {
  return String(mac ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

export function vendorForMac(mac?: string | null): string | undefined {
  const hex = normaliseMac(mac);
  if (hex.length < 6) return undefined;
  return OUI_VENDORS[hex.slice(0, 6)];
}

/** True for addresses that are locally administered (randomised privacy MACs). */
export function isRandomisedMac(mac?: string | null): boolean {
  const hex = normaliseMac(mac);
  if (hex.length < 2) return false;
  const first = parseInt(hex.slice(0, 2), 16);
  return (first & 0b10) === 0b10;
}
