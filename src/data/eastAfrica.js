/** East African Community partner-state country codes, shared by the directory and Radio filter. */
export const EAST_AFRICA_COUNTRY_CODES = Object.freeze([
  'BI',
  'CD',
  'KE',
  'RW',
  'SO',
  'SS',
  'TZ',
  'UG',
]);

const eastAfricaCountryCodeSet = new Set(EAST_AFRICA_COUNTRY_CODES);

export function isEastAfricaCountryCode(value) {
  return eastAfricaCountryCodeSet.has(String(value || '').trim().toUpperCase());
}
