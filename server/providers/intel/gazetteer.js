import {
  AFRICA_COUNTRIES,
  isAfricaCountryCode,
  isEastAfricaCountryCode,
} from '../../../src/data/africa.js';

/** iso2|name|lat|lon|comma-separated aliases (cities, demonyms, institutions). */
const WORLD_ROWS = `
AF|Afghanistan|34.53|69.17|Kabul,Afghan,Taliban
AL|Albania|41.33|19.82|Tirana,Albanian
AR|Argentina|-34.6|-58.38|Buenos Aires,Argentine,Argentinian
AM|Armenia|40.18|44.51|Yerevan,Armenian
AU|Australia|-35.28|149.13|Canberra,Sydney,Melbourne,Australian
AT|Austria|48.21|16.37|Vienna,Austrian
AZ|Azerbaijan|40.41|49.87|Baku,Azerbaijani
BH|Bahrain|26.23|50.59|Manama,Bahraini
BD|Bangladesh|23.81|90.41|Dhaka,Bangladeshi
BY|Belarus|53.9|27.57|Minsk,Belarusian
BE|Belgium|50.85|4.35|Brussels,Belgian
BO|Bolivia|-16.49|-68.12|La Paz,Bolivian
BA|Bosnia|43.86|18.41|Sarajevo,Bosnian
BR|Brazil|-15.79|-47.88|Brasilia,Rio de Janeiro,Sao Paulo,Brazilian
BG|Bulgaria|42.7|23.32|Sofia,Bulgarian
KH|Cambodia|11.56|104.92|Phnom Penh,Cambodian
CA|Canada|45.42|-75.7|Ottawa,Toronto,Canadian
CL|Chile|-33.45|-70.67|Santiago,Chilean
CN|China|39.9|116.4|Beijing,Shanghai,Chinese,Xi Jinping
CO|Colombia|4.71|-74.07|Bogota,Colombian
CU|Cuba|23.11|-82.37|Havana,Cuban
CY|Cyprus|35.19|33.38|Nicosia,Cypriot
CZ|Czech Republic|50.08|14.44|Prague,Czech,Czechia
DK|Denmark|55.68|12.57|Copenhagen,Danish
EC|Ecuador|-0.18|-78.47|Quito,Ecuadorian
EE|Estonia|59.44|24.75|Tallinn,Estonian
FI|Finland|60.17|24.94|Helsinki,Finnish
FR|France|48.86|2.35|Paris,French,Macron
GE|Georgia|41.72|44.79|Tbilisi
DE|Germany|52.52|13.4|Berlin,German,Bundestag
GR|Greece|37.98|23.73|Athens,Greek
GL|Greenland|64.18|-51.72|Nuuk
HT|Haiti|18.59|-72.31|Port-au-Prince,Haitian
HK|Hong Kong|22.32|114.17|
HU|Hungary|47.5|19.04|Budapest,Hungarian
IN|India|28.61|77.21|New Delhi,Delhi,Mumbai,Indian,Modi
ID|Indonesia|-6.21|106.85|Jakarta,Indonesian
IR|Iran|35.69|51.39|Tehran,Iranian,IRGC
IQ|Iraq|33.31|44.37|Baghdad,Iraqi
IE|Ireland|53.35|-6.26|Dublin,Irish
IL|Israel|31.77|35.22|Jerusalem,Tel Aviv,Israeli,IDF,Netanyahu
IT|Italy|41.9|12.5|Rome,Italian
JP|Japan|35.68|139.69|Tokyo,Japanese
JO|Jordan|31.95|35.93|Amman,Jordanian
KZ|Kazakhstan|51.17|71.45|Astana,Kazakh
KW|Kuwait|29.38|47.99|Kuwaiti
KG|Kyrgyzstan|42.87|74.59|Bishkek
LA|Laos|17.97|102.63|Vientiane
LV|Latvia|56.95|24.11|Riga,Latvian
LB|Lebanon|33.89|35.5|Beirut,Lebanese,Hezbollah
LT|Lithuania|54.69|25.28|Vilnius,Lithuanian
MY|Malaysia|3.14|101.69|Kuala Lumpur,Malaysian
MX|Mexico|19.43|-99.13|Mexican
MD|Moldova|47.01|28.86|Chisinau,Moldovan
MM|Myanmar|19.76|96.08|Burma,Naypyidaw,Yangon
NP|Nepal|27.72|85.32|Kathmandu,Nepali
NL|Netherlands|52.37|4.9|Amsterdam,The Hague,Dutch
NZ|New Zealand|-41.29|174.78|Wellington
KP|North Korea|39.04|125.76|Pyongyang,Kim Jong Un
NO|Norway|59.91|10.75|Oslo,Norwegian
OM|Oman|23.59|58.41|Muscat,Omani
PK|Pakistan|33.68|73.05|Islamabad,Karachi,Pakistani
PS|Palestine|31.5|34.47|Gaza,West Bank,Palestinian,Hamas,Rafah
PA|Panama|8.98|-79.52|Panamanian
PE|Peru|-12.05|-77.04|Lima,Peruvian
PH|Philippines|14.6|120.98|Manila,Philippine,Filipino
PL|Poland|52.23|21.01|Warsaw,Polish
PT|Portugal|38.72|-9.14|Lisbon,Portuguese
QA|Qatar|25.29|51.53|Doha,Qatari
RO|Romania|44.43|26.1|Bucharest,Romanian
RU|Russia|55.76|37.62|Moscow,Kremlin,Russian,Putin
SA|Saudi Arabia|24.71|46.68|Riyadh,Saudi
RS|Serbia|44.79|20.45|Belgrade,Serbian
SG|Singapore|1.35|103.82|
SK|Slovakia|48.15|17.11|Bratislava,Slovak
KR|South Korea|37.57|126.98|Seoul,South Korean
ES|Spain|40.42|-3.7|Madrid,Barcelona,Spanish
LK|Sri Lanka|6.93|79.86|Colombo
SE|Sweden|59.33|18.07|Stockholm,Swedish
CH|Switzerland|46.95|7.45|Geneva,Zurich,Bern,Swiss
SY|Syria|33.51|36.29|Damascus,Aleppo,Syrian
TW|Taiwan|25.03|121.57|Taipei,Taiwanese
TJ|Tajikistan|38.56|68.79|Dushanbe
TH|Thailand|13.76|100.5|Bangkok,Thai
TR|Turkey|39.93|32.86|Ankara,Istanbul,Turkish,Erdogan,Turkiye
UA|Ukraine|50.45|30.52|Kyiv,Kiev,Kharkiv,Odesa,Ukrainian,Zelensky,Zelenskyy
AE|United Arab Emirates|24.45|54.38|UAE,Dubai,Abu Dhabi,Emirati
GB|United Kingdom|51.51|-0.13|UK,Britain,British,London,England,Scotland,Downing Street
US|United States|38.9|-77.04|U.S.,USA,America,American,Washington,White House,Pentagon,Trump,New York,California,Texas
UY|Uruguay|-34.9|-56.16|Montevideo
UZ|Uzbekistan|41.3|69.24|Tashkent
VE|Venezuela|10.49|-66.88|Caracas,Venezuelan,Maduro
VN|Vietnam|21.03|105.85|Hanoi,Vietnamese
YE|Yemen|15.37|44.19|Sanaa,Houthi,Houthis,Yemeni
`;

const AFRICA_ALIASES = {
  BI: 'Bujumbura,Burundian',
  CD: 'DRC,Democratic Republic of Congo,Democratic Republic of the Congo,Goma,Bukavu,Kivu,Ituri,M23,FARDC,Congolese,RDC',
  KE: 'Mombasa,Kisumu,Kenyan,Kenyans,Ruto',
  RW: 'Rwandan,Rwandans,Rwandese,Kagame',
  SO: 'Somali,Somaliland,al-Shabaab,Al-Shabaab,al-Shabab,Al-Shabab,Puntland,Hargeisa',
  SS: 'South Sudanese',
  TZ: 'Dar es Salaam,Zanzibar,Tanzanian,Arusha',
  UG: 'Ugandan,Museveni,Entebbe',
  ET: 'Ethiopian,Tigray,Amhara,Oromia',
  ER: 'Eritrean',
  SD: 'Sudanese,Darfur,El Fasher,El-Fasher,RSF,Port Sudan,Omdurman',
  MG: 'Malagasy',
  ZA: 'Johannesburg,Cape Town,Durban,South African,Ramaphosa',
  MZ: 'Cabo Delgado,Mozambican',
  ZW: 'Zimbabwean',
  ZM: 'Zambian',
  AO: 'Angolan',
  MW: 'Malawian',
  NA: 'Namibian',
  CM: 'Cameroonian,Douala',
  TD: 'Chadian',
  CG: 'Congo-Brazzaville',
  GA: 'Gabonese',
  NG: 'Lagos,Nigerian,Boko Haram,Kano,Borno',
  GH: 'Ghanaian',
  CI: 'Ivory Coast,Ivorian,Abidjan',
  SN: 'Senegalese',
  ML: 'Malian,JNIM',
  BF: 'Burkinabe,Traore',
  NE: 'Nigerien',
  EG: 'Egyptian,Suez,Sinai',
  LY: 'Libyan,Benghazi',
  MA: 'Moroccan,Western Sahara,Casablanca,Marrakech',
  DZ: 'Algerian',
  TN: 'Tunisian',
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function entry(iso2, name, lat, lon, aliases, capital) {
  const terms = [name, capital, ...String(aliases || '').split(',')]
    .map((term) => (term || '').trim())
    .filter(Boolean);
  return {
    iso2,
    name,
    lat,
    lon,
    africa: isAfricaCountryCode(iso2),
    eastAfrica: isEastAfricaCountryCode(iso2),
    // Names are proper nouns, so the match stays case-sensitive: "turkey" the
    // bird, "china" the dish and "chad" are not places.
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join('|')})(?![\\p{L}\\p{N}])`,
      'u',
    ),
  };
}

export const COUNTRIES = Object.freeze([
  ...AFRICA_COUNTRIES.map((country) =>
    entry(
      country.iso2,
      country.name,
      country.lat,
      country.lon,
      AFRICA_ALIASES[country.iso2],
      country.capital,
    ),
  ),
  ...WORLD_ROWS.trim()
    .split('\n')
    .map((row) => {
      const [iso2, name, lat, lon, aliases] = row.trim().split('|');
      return entry(iso2, name, Number(lat), Number(lon), aliases);
    }),
]);

const BY_CODE = new Map(COUNTRIES.map((country) => [country.iso2, country]));
export const countryByCode = (code) => BY_CODE.get(code) || null;

/** Longer names that contain a shorter country name. */
const SHADOWS = [
  [/Democratic Republic of (?:the )?Congo/g, 'CD'],
  [/South Sudan(?:ese)?/g, 'SS'],
  [/Equatorial Guinea/g, 'GQ'],
  [/Guinea-Bissau/g, 'GW'],
  [/Papua New Guinea/g, null],
  [/(?<!Democratic )Republic of the Congo|Congo-Brazzaville/g, 'CG'],
  [/New Mexico/g, 'US'],
  [/(?:Atlanta|Savannah|Augusta), Georgia/g, 'US'],
];

/** Countries named in a piece of text, earliest mention first. */
export function countriesInText(text) {
  const value = String(text || '');
  if (!value) return [];
  const found = new Map();
  let masked = value;
  for (const [pattern, iso2] of SHADOWS) {
    masked = masked.replace(pattern, (match, offset) => {
      if (iso2 && !found.has(iso2)) found.set(iso2, offset);
      return ' '.repeat(match.length);
    });
  }
  for (const country of COUNTRIES) {
    const match = country.pattern.exec(masked);
    if (match && !found.has(country.iso2)) found.set(country.iso2, match.index);
  }
  return [...found]
    .sort((a, b) => a[1] - b[1])
    .map(([iso2]) => BY_CODE.get(iso2))
    .filter(Boolean);
}
