/**
 * African countries shared by the server feeds, the radio directory and the
 * map layers. Coordinates are the capital city, used to place national figures.
 * Rows: iso2|iso3|name|region|capital|lat|lon
 */
const ROWS = `
BI|BDI|Burundi|east|Gitega|-3.427|29.925
CD|COD|DR Congo|east|Kinshasa|-4.322|15.307
KE|KEN|Kenya|east|Nairobi|-1.286|36.817
RW|RWA|Rwanda|east|Kigali|-1.944|30.062
SO|SOM|Somalia|east|Mogadishu|2.047|45.318
SS|SSD|South Sudan|east|Juba|4.859|31.571
TZ|TZA|Tanzania|east|Dodoma|-6.163|35.752
UG|UGA|Uganda|east|Kampala|0.348|32.582
DJ|DJI|Djibouti|horn|Djibouti|11.572|43.145
ER|ERI|Eritrea|horn|Asmara|15.323|38.925
ET|ETH|Ethiopia|horn|Addis Ababa|9.03|38.74
SD|SDN|Sudan|horn|Khartoum|15.501|32.56
KM|COM|Comoros|indian|Moroni|-11.702|43.255
MG|MDG|Madagascar|indian|Antananarivo|-18.879|47.508
MU|MUS|Mauritius|indian|Port Louis|-20.161|57.501
SC|SYC|Seychelles|indian|Victoria|-4.62|55.455
AO|AGO|Angola|south|Luanda|-8.839|13.289
BW|BWA|Botswana|south|Gaborone|-24.628|25.923
LS|LSO|Lesotho|south|Maseru|-29.31|27.478
MW|MWI|Malawi|south|Lilongwe|-13.963|33.774
MZ|MOZ|Mozambique|south|Maputo|-25.966|32.583
NA|NAM|Namibia|south|Windhoek|-22.56|17.066
SZ|SWZ|Eswatini|south|Mbabane|-26.305|31.136
ZA|ZAF|South Africa|south|Pretoria|-25.747|28.229
ZM|ZMB|Zambia|south|Lusaka|-15.387|28.323
ZW|ZWE|Zimbabwe|south|Harare|-17.825|31.034
CF|CAF|Central African Republic|central|Bangui|4.394|18.558
CG|COG|Republic of the Congo|central|Brazzaville|-4.263|15.243
CM|CMR|Cameroon|central|Yaounde|3.848|11.502
GA|GAB|Gabon|central|Libreville|0.416|9.467
GQ|GNQ|Equatorial Guinea|central|Malabo|3.75|8.783
ST|STP|Sao Tome and Principe|central|Sao Tome|0.337|6.73
TD|TCD|Chad|central|N'Djamena|12.134|15.056
BF|BFA|Burkina Faso|west|Ouagadougou|12.371|-1.52
BJ|BEN|Benin|west|Porto-Novo|6.497|2.629
CI|CIV|Cote d'Ivoire|west|Yamoussoukro|6.828|-5.289
CV|CPV|Cabo Verde|west|Praia|14.933|-23.513
GH|GHA|Ghana|west|Accra|5.604|-0.187
GM|GMB|Gambia|west|Banjul|13.454|-16.579
GN|GIN|Guinea|west|Conakry|9.641|-13.578
GW|GNB|Guinea-Bissau|west|Bissau|11.864|-15.584
LR|LBR|Liberia|west|Monrovia|6.301|-10.797
ML|MLI|Mali|west|Bamako|12.639|-8.003
MR|MRT|Mauritania|west|Nouakchott|18.079|-15.965
NE|NER|Niger|west|Niamey|13.514|2.109
NG|NGA|Nigeria|west|Abuja|9.058|7.495
SL|SLE|Sierra Leone|west|Freetown|8.484|-13.23
SN|SEN|Senegal|west|Dakar|14.693|-17.447
TG|TGO|Togo|west|Lome|6.137|1.212
DZ|DZA|Algeria|north|Algiers|36.754|3.059
EG|EGY|Egypt|north|Cairo|30.044|31.236
LY|LBY|Libya|north|Tripoli|32.887|13.191
MA|MAR|Morocco|north|Rabat|34.021|-6.841
TN|TUN|Tunisia|north|Tunis|36.806|10.181
`;

export const AFRICA_COUNTRIES = Object.freeze(
  ROWS.trim()
    .split('\n')
    .map((row) => {
      const [iso2, iso3, name, region, capital, lat, lon] = row
        .trim()
        .split('|');
      return Object.freeze({
        iso2,
        iso3,
        name,
        region,
        capital,
        lat: Number(lat),
        lon: Number(lon),
      });
    }),
);

/** East African Community partner states. */
export const EAST_AFRICA_COUNTRY_CODES = Object.freeze(
  AFRICA_COUNTRIES.filter(({ region }) => region === 'east').map(
    ({ iso2 }) => iso2,
  ),
);
export const AFRICA_COUNTRY_CODES = Object.freeze(
  AFRICA_COUNTRIES.map(({ iso2 }) => iso2),
);
/** Rough continental bounds, islands included: west, south, east, north. */
export const AFRICA_BOUNDS = Object.freeze([-26, -36, 60, 38]);

const eastAfrica = new Set(EAST_AFRICA_COUNTRY_CODES);
const africa = new Set(AFRICA_COUNTRY_CODES);
const code = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();

export function isEastAfricaCountryCode(value) {
  return eastAfrica.has(code(value));
}

export function isAfricaCountryCode(value) {
  return africa.has(code(value));
}

/** Rough outline of the continent and its islands as [lon, lat] vertices. */
const OUTLINE = [
  [-27, 10],
  [-26, 18],
  [-18, 30],
  [-12, 36.2],
  [-5.5, 36],
  [0, 38],
  [11.3, 38],
  [12, 35],
  [20, 33.6],
  [30, 32.4],
  [34.2, 31.5],
  [34.9, 28],
  [38.5, 20],
  [42.6, 13.6],
  [43.5, 11.9],
  [52, 13],
  [60, 0],
  [60, -25],
  [45, -36],
  [10, -38],
  [-5, -10],
  [-20, 0],
];

/** True inside the continent's outline, so Europe and Arabia are left out. */
export function isWithinAfrica(lat, lon) {
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i];
    const [xj, yj] = OUTLINE[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
