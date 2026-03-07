import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Papa from "papaparse";
import CLIENT_DATA from './clientData.json';
import CLIENT_DATA_raw from './clientData.json';
import { signIn, signOut, getCurrentSession, getUserProfile, onAuthStateChange } from './supabaseAuth';
import { upsertEstablishment, updateActivityAddress, updateActivityTransport, logAction, getAllDistances, upsertDistance, getValidatedEstablishments, getAllAccommodationHotels, syncAccommodationHotels, setActivityManagedStatus, bulkSetManagedStatus, getManagedActivityIds, getAllActivities as getAllActivitiesFromDB, saveBookingConfirmation, getAllBookingConfirmations, upsertConsultant, deleteConsultant as deleteConsultantDB, getAllConsultants } from './supabaseService';

const CLIENT_LOOKUP = CLIENT_DATA.reduce((acc, client) => {
  acc[client.name] = client;
  return acc;
}, {});

const EXTRA_CLIENT_INFO = {
  "Hotel Emperador": { address: "C/ Gran Vía 53, 28013 Madrid" },
  "Hotel Emperador Madrid": { address: "C/ Gran Vía 53, 28013 Madrid" },
  "Castell Son Claret": { address: "Carretera Es Capdellá-Galilea, km 1.7, 07196 Es Capdellá, Calvià, Mallorca" },
  "Castell Son Claret Mallorca": { address: "Carretera Es Capdellá-Galilea, km 1.7, 07196 Es Capdellá, Calvià, Mallorca" },
  "Hotel Agalia": { address: "Calle Arquitecto Miguel Ángel 7, 30006 Murcia" },
  "Hotel Agalia Murcia": { address: "Calle Arquitecto Miguel Ángel 7, 30006 Murcia" },
  "W Barcelona": { address: "Plaça Rosa dels Vents, 1, 08039 Barcelona" },
  "Allsun Albatros": { address: "Avenida del Jablillo 7, 35508 Costa Teguise, Lanzarote" },
  "Allsun Albatros Lanzarote": { address: "Avenida del Jablillo 7, 35508 Costa Teguise, Lanzarote" },
  "Abora Buenaventura": { address: "Calle Ganigo 6, Playa del Inglés, Gran Canaria" },
  "Abora Catarina": { address: "Avenida de Tirajana 1, Playa del Inglés, Gran Canaria" },
  "AC Hotel Gran Canaria": { address: "Calle Eduardo Benot 3-5, Las Palmas de Gran Canaria" },
  "Allsun Los Hibiscos": { address: "Avenida de los Pueblos s/n, Costa Adeje, Tenerife" },
  "Allsun Lucana": { address: "Plaza del Sol 4, Playa del Inglés, Gran Canaria" },
  "Anfi Beach Club": { address: "Barranco de la Verga s/n, Arguineguín, Gran Canaria" },
  "Anfi Emerald Hotel": { address: "Barranco del Lechugal s/n, Valle de Tauro, Mogán, Gran Canaria" }
};

const REGION_MAP = {
  "Balearic Islands": "Islas Baleares",
  "Baleares- Mallorca": "Islas Baleares",
  "Canary Islands": "Islas Canarias",
  "Catalonia": "Cataluña",
  "Comunidad Valenciana": "Valencia",
  "Murcia ": "Murcia",
  "Castilla y León ": "Castilla y León",
};

function normalizeRegion(r) {
  if (!r) return "Desconocido";
  const trimmed = r.trim();
  return REGION_MAP[trimmed] || trimmed;
}

function inferIsland(base) {
  if (!base) return null;
  const b = base.toLowerCase();
  if (b.includes("gran canaria") || b === "las palmas" || b.includes("las palmas de gran canaria")) return "Gran Canaria";
  if (b.includes("tenerife")) return "Tenerife";
  if (b.includes("lanzarote")) return "Lanzarote";
  if (b.includes("fuerteventura")) return "Fuerteventura";
  if (b.includes("hierro")) return "El Hierro";
  if (b.includes("gomera")) return "La Gomera";
  // Mallorca MUST be checked BEFORE La Palma to avoid "palmanova".includes("palma") false positive
  if (b.includes("mallorca") || b.includes("calvià") || b === "palma de mallorca" || b === "palma"
    || b.includes("palmanova") || b.includes("palma nova")) return "Mallorca";
  if (b.includes("ibiza") || b.includes("eivissa")) return "Ibiza";
  if (b.includes("menorca")) return "Menorca";
  if (b.includes("formentera")) return "Formentera";
  // La Palma: require exact match or explicit name to avoid false positives
  if (b === "la palma" || b.includes("santa cruz de la palma") || b.includes("los llanos de aridane") || b.includes("breña")) return "La Palma";
  return null;
}

const HS_COLORS = {
  primary: "#0060AA", // Corporate Blue
  secondary: "#004B8D", // Darker Blue for hover/active
  sidebar: "#1A1A1A", // Dark sidebar
  bg: "#EDEEF0", // Light grey background
  text: "#333333",
  inputBg: "#E8E8E8", // Input field background from screenshot
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444"
};

// ============================================================
// DATA & CONSTANTS
// ============================================================
const CONSULTANTS = {
  "Ainhoa Rodriguez": { base: "Maria de la Salut", email: "", region: "Islas Baleares", pref: "auto", island: "Mallorca", airport: "PMI", station: null, address: "C/ San Alonso, Maria de la Salut, 07519, Mallorca" },
  "Alejandra Rubilar": { base: "Alicante", email: "arubilar@hsconsulting.es", region: "Valencia", pref: "vehiculo", island: null, airport: "ALC", station: "Alicante", address: "Concejal Lorenzo Llaneras 1 Esc. 7, 7A, 03005 Alicante" },
  "Alejandro Cardona Paz": { base: "Las Palmas de Gran Canaria", email: "acardona@hsconsulting.es", region: "Islas Canarias", pref: "auto", island: "Gran Canaria", airport: "LPA", station: null },
  "Alejandro Piñero": { base: "Madrid", email: "apinero@hsconsulting.es", region: "Madrid", pref: "tren", island: null, airport: "MAD", station: "Madrid-Puerta de Atocha", address: "Plaza General Maroto 1, 2B, 28045 Madrid" },
  "Andrés Lorite": { base: "Algeciras", email: "alorite@hsconsulting.es", region: "Andalucía", pref: "vehiculo", island: null, airport: "AGP", station: "Algeciras", address: "Calle Cielo 288, 11207 Algeciras, Cádiz" },
  "Arminda Navarro Perez": { base: "Firgas", email: "anavarro@hsconsulting.es", region: "Islas Canarias", pref: "auto", island: "Gran Canaria", airport: "LPA", station: null, address: "Firgas, Las Palmas" },
  "Carmen Barrientos": { base: "Palma de Mallorca", email: "cbarrientos@hsconsulting.es", region: "Islas Baleares", pref: "auto", island: "Mallorca", airport: "PMI", station: null },
  "Damaris Segura Bello": { base: "Calvià, Mallorca", email: "dsegura@hsconsulting.es", region: "Islas Baleares", pref: "auto", island: "Mallorca", airport: "PMI", station: null },
  "Froilán Cortés": { base: "Barcelona", email: "fcortes@hsconsulting.es", region: "Cataluña", pref: "vehiculo", island: null, airport: "BCN", station: "Barcelona-Sants", address: "C/ Horta 223 bajos 2º, 08032 Barcelona" },
  "Gorka Sanchez Ortega": { base: "Tenerife", email: "gsanchezortega@hsconsulting.es", region: "Islas Canarias", pref: "vehiculo", island: "Tenerife", airport: "TFN", station: null, address: "Tenerife" },
  "Guillem Exposito Flores": { base: "Mollet del Vallés", email: "gexposito@hsconsulting.es", region: "Cataluña", pref: "vehiculo", island: null, airport: "BCN", station: "Barcelona-Sants", address: "Pablo Picasso 52, 3B, Mollet del Vallés, Barcelona" },
  "Iris Belver Prats": { base: "Porto Colom", email: "", region: "Islas Baleares", pref: "auto", island: "Mallorca", airport: "PMI", station: null, address: "Porto Colom - Felanitx, Mallorca" },
  "Isabella Alejandra Baricot Varas": { base: "Santa Cruz de Tenerife", email: "ibaricot@hsconsulting.es", region: "Islas Canarias", pref: "auto", island: "Tenerife", airport: "TFN", station: null },
  "José Martinez": { base: "San Miguel de Abona", email: "jmartinez@hsconsulting.es", region: "Islas Canarias", pref: "auto", island: "Tenerife", airport: "TFS", station: null, address: "Calle la Polka 22, puerta 41, Llano del Camello, San Miguel de Abona, Tenerife Sur" },
  "Leyninger Perez": { base: "Madrid", email: "lperez@hsconsulting.es", region: "Madrid", pref: "tren", island: null, airport: "MAD", station: "Madrid-Puerta de Atocha", address: "Las Rosas, Madrid 28022" },
  "Mercedes Hernandez Moyano": { base: "Las Palmas de Gran Canaria", email: "mhernandezmoyano@hsconsulting.es", region: "Islas Canarias", pref: "auto", island: "Gran Canaria", airport: "LPA", station: null, address: "Calle Tiziano 61, 35017 Las Palmas" },
  "Miquel Nadal Calvó": { base: "Santa Margalida", email: "mnadal@hsconsulting.es", region: "Islas Baleares", pref: "auto", island: "Mallorca", airport: "PMI", station: null, address: "C/ De n March 20 1ºA, 07450 Santa Margalida, Mallorca" },
  "Mireia Bei Sola Llabrés": { base: "Palma de Mallorca", email: "msola@hsconsulting.es", region: "Islas Baleares", pref: "auto", island: "Mallorca", airport: "PMI", station: null },
  "Olalla Bartolomé Roselló": { base: "Ibiza", email: "", region: "Islas Baleares", pref: "auto", island: "Ibiza", airport: "IBZ", station: null, address: "C/ Pare Antoni Guasch 8 puerta 16, 07800 Ibiza" },
  "Rita Artiles": { base: "San Bartolomé de Tirajana", email: "", region: "Islas Canarias", pref: "auto", island: "Gran Canaria", airport: "LPA", station: null, address: "San Bartolomé de Tirajana, Las Palmas" },
  "Rocío Gálvez Mata": { base: "Las Palmas de Gran Canaria", email: "rgalvez@hsconsulting.es", region: "Islas Canarias", pref: "auto", island: "Gran Canaria", airport: "LPA", station: null },
  "Sergi Garcia Villaraco": { base: "Mallorca", email: "sgarcia@hsconsulting.es", region: "Islas Baleares", pref: "auto", island: "Mallorca", airport: "PMI", station: null },
  "Álvaro Ramos González": { base: "Sevilla", email: "aramos@hsconsulting.es", region: "Andalucía", pref: "vehiculo", island: null, airport: "SVQ", station: "Sevilla-Santa Justa" },
};

const REGION_DEST = {
  "Islas Canarias": { airport: "LPA", city: "Las Palmas" },
  "Islas Baleares": { airport: "PMI", city: "Palma de Mallorca" },
  "Madrid": { airport: "MAD", city: "Madrid", station: "Madrid-Puerta de Atocha" },
  "Cataluña": { airport: "BCN", city: "Barcelona", station: "Barcelona-Sants" },
  "Andalucía": { airport: "SVQ", city: "Sevilla", station: "Sevilla-Santa Justa" },
  "Valencia": { airport: "VLC", city: "Valencia", station: "Valencia-Joaquín Sorolla" },
  "País Vasco": { airport: "BIO", city: "Bilbao", station: "Bilbao-Abando" },
  "Galicia": { airport: "SCQ", city: "Santiago", station: "Santiago de Compostela" },
  "Asturias": { airport: "OVD", city: "Oviedo", station: "Oviedo" },
  "Murcia": { airport: "RMU", city: "Murcia", station: "Murcia del Carmen" },
  "Alicante": { airport: "ALC", city: "Alicante", station: "Alicante" },
  "Castilla y León": { airport: "VLL", city: "Valladolid", station: "Valladolid Campo Grande" },
  "Lérida": { airport: null, city: "Lérida", station: "Lleida Pirineus" }
};

const APPROX_DISTANCES = {
  "Madrid-Barcelona": 620, "Barcelona-Madrid": 620,
  "Madrid-Valencia": 355, "Valencia-Madrid": 355,
  "Madrid-Sevilla": 530, "Sevilla-Madrid": 530,
  "Madrid-Malaga": 530, "Malaga-Madrid": 530,
  "Madrid-Bilbao": 400, "Bilbao-Madrid": 400,
  "Madrid-Alicante": 415, "Alicante-Madrid": 415,
  "Madrid-Murcia": 400, "Murcia-Madrid": 400,
  "Madrid-Valladolid": 210, "Valladolid-Madrid": 210,
  "Barcelona-Valencia": 350, "Valencia-Barcelona": 350,
  "Barcelona-Zaragoza": 310, "Zaragoza-Barcelona": 310,
  "Sevilla-Malaga": 205, "Malaga-Sevilla": 205,
  "Sevilla-Granada": 250, "Granada-Sevilla": 250,
  "Valencia-Alicante": 170, "Alicante-Valencia": 170
};

const DISTANCE_CACHE = {};

function estimateDistance(originAddr, destAddr) {
  // Deprecated: No longer guessing random numbers.
  // We now rely on the async calculation.
  // Return 0 or cached value if we have it in memory (sync fallback)
  const key = `${originAddr}|${destAddr}`;
  return DISTANCE_CACHE[key] || 0;
}

const ISLAND_REGIONS = ["Islas Canarias", "Islas Baleares"];

// Municipality -> Region inference (for when user updates municipality)
const MUNI_REGION_MAP = {
  // Baleares - Mallorca
  "palma de mallorca": "Islas Baleares", "palma": "Islas Baleares", "calvià": "Islas Baleares",
  "inca": "Islas Baleares", "manacor": "Islas Baleares", "llucmajor": "Islas Baleares",
  "alcudia": "Islas Baleares", "alcúdia": "Islas Baleares", "sóller": "Islas Baleares", "pollença": "Islas Baleares",
  "santa ponsa": "Islas Baleares", "cala ratjada": "Islas Baleares",
  "palmanova": "Islas Baleares", "palma nova": "Islas Baleares",
  "campos": "Islas Baleares", "felanitx": "Islas Baleares", "santanyí": "Islas Baleares",
  "cala millor": "Islas Baleares", "cala bona": "Islas Baleares",
  "port d'alcúdia": "Islas Baleares", "playa de muro": "Islas Baleares", "can picafort": "Islas Baleares",
  "montuïri": "Islas Baleares", "andratx": "Islas Baleares", "lloseta": "Islas Baleares",
  "sant llorenç des cardassar": "Islas Baleares", "cala sant vicenç": "Islas Baleares",
  "torrenova": "Islas Baleares", "puigderrós": "Islas Baleares", "porto colom": "Islas Baleares",
  "cales de mallorca": "Islas Baleares", "costa de la calma": "Islas Baleares",
  "cala vinyes": "Islas Baleares", "maria de la salut": "Islas Baleares",
  "santa margalida": "Islas Baleares", "sa coma": "Islas Baleares",
  // Baleares - Ibiza / Menorca / Formentera
  "ibiza": "Islas Baleares", "eivissa": "Islas Baleares", "maó": "Islas Baleares", "mahón": "Islas Baleares",
  "ciutadella": "Islas Baleares", "formentera": "Islas Baleares", "santa eulalia": "Islas Baleares",
  "sant antoni": "Islas Baleares",
  "santa eulària des riu": "Islas Baleares", "sant jordi de ses salines": "Islas Baleares",
  "sant antoni de portmany": "Islas Baleares",
  // Canarias
  "las palmas de gran canaria": "Islas Canarias", "las palmas": "Islas Canarias",
  "santa cruz de tenerife": "Islas Canarias", "arrecife": "Islas Canarias",
  "puerto del rosario": "Islas Canarias", "san bartolomé de tirajana": "Islas Canarias",
  "adeje": "Islas Canarias", "arona": "Islas Canarias", "playa del inglés": "Islas Canarias",
  "la laguna": "Islas Canarias", "san cristóbal de la laguna": "Islas Canarias",
  "telde": "Islas Canarias", "mogán": "Islas Canarias", "corralejo": "Islas Canarias",
  "costa teguise": "Islas Canarias", "playa blanca": "Islas Canarias",
  "costa adeje": "Islas Canarias", "playa de la américas": "Islas Canarias", "playa de la américa": "Islas Canarias",
  "san miguel de abona": "Islas Canarias", "maspalomas": "Islas Canarias",
  "los cristianos": "Islas Canarias", "puerto de la cruz": "Islas Canarias",
  "montaña roja": "Islas Canarias", "costa calma": "Islas Canarias",
  "breña baja": "Islas Canarias",
  // Península
  "madrid": "Madrid", "barcelona": "Cataluña", "sevilla": "Andalucía",
  "málaga": "Andalucía", "granada": "Andalucía", "córdoba": "Andalucía",
  "cádiz": "Andalucía", "almería": "Andalucía", "huelva": "Andalucía", "jaén": "Andalucía",
  "algeciras": "Andalucía", "marbella": "Andalucía", "torremolinos": "Andalucía",
  "valencia": "Valencia", "alicante": "Valencia", "castellón": "Valencia",
  "benidorm": "Valencia", "elche": "Valencia", "torrevieja": "Valencia",
  "bilbao": "País Vasco", "san sebastián": "País Vasco", "vitoria": "País Vasco",
  "santiago de compostela": "Galicia", "a coruña": "Galicia", "vigo": "Galicia",
  "oviedo": "Asturias", "gijón": "Asturias", "murcia": "Murcia", "cartagena": "Murcia",
  "zaragoza": "Aragón", "pamplona": "Navarra", "santander": "Cantabria",
  "logroño": "La Rioja", "valladolid": "Castilla y León", "toledo": "Castilla-La Mancha",
  "mérida": "Extremadura", "badajoz": "Extremadura", "cáceres": "Extremadura",
};

// Municipality -> Island inference (more precise than inferIsland)
const MUNI_ISLAND_MAP = {
  // Mallorca
  "palma de mallorca": "Mallorca", "palma": "Mallorca", "calvià": "Mallorca",
  "inca": "Mallorca", "manacor": "Mallorca", "llucmajor": "Mallorca",
  "alcudia": "Mallorca", "alcúdia": "Mallorca", "sóller": "Mallorca", "pollença": "Mallorca",
  "santa ponsa": "Mallorca", "cala ratjada": "Mallorca",
  "palmanova": "Mallorca", "palma nova": "Mallorca",
  "campos": "Mallorca", "felanitx": "Mallorca", "santanyí": "Mallorca",
  "cala millor": "Mallorca", "cala bona": "Mallorca",
  "port d'alcúdia": "Mallorca", "playa de muro": "Mallorca", "can picafort": "Mallorca",
  "montuïri": "Mallorca", "andratx": "Mallorca", "lloseta": "Mallorca",
  "sant llorenç des cardassar": "Mallorca", "cala sant vicenç": "Mallorca",
  "torrenova": "Mallorca", "puigderrós": "Mallorca", "porto colom": "Mallorca",
  "cales de mallorca": "Mallorca", "costa de la calma": "Mallorca",
  "cala vinyes": "Mallorca", "maria de la salut": "Mallorca",
  "santa margalida": "Mallorca", "sa coma": "Mallorca",
  // Ibiza
  "ibiza": "Ibiza", "eivissa": "Ibiza", "santa eulalia": "Ibiza", "sant antoni": "Ibiza",
  "santa eulària des riu": "Ibiza", "sant jordi de ses salines": "Ibiza",
  "sant antoni de portmany": "Ibiza",
  // Menorca
  "maó": "Menorca", "mahón": "Menorca", "ciutadella": "Menorca",
  // Formentera
  "formentera": "Formentera",
  // Gran Canaria
  "las palmas de gran canaria": "Gran Canaria", "las palmas": "Gran Canaria",
  "telde": "Gran Canaria", "san bartolomé de tirajana": "Gran Canaria",
  "playa del inglés": "Gran Canaria", "mogán": "Gran Canaria", "maspalomas": "Gran Canaria",
  // Tenerife
  "santa cruz de tenerife": "Tenerife", "adeje": "Tenerife", "arona": "Tenerife",
  "la laguna": "Tenerife", "san cristóbal de la laguna": "Tenerife",
  "puerto de la cruz": "Tenerife", "los cristianos": "Tenerife",
  "costa adeje": "Tenerife", "playa de la américas": "Tenerife", "playa de la américa": "Tenerife",
  "san miguel de abona": "Tenerife",
  // Lanzarote
  "arrecife": "Lanzarote", "costa teguise": "Lanzarote", "playa blanca": "Lanzarote",
  "montaña roja": "Lanzarote",
  // Fuerteventura
  "puerto del rosario": "Fuerteventura", "corralejo": "Fuerteventura",
  "costa calma": "Fuerteventura",
  // La Gomera
  "san sebastián de la gomera": "La Gomera",
  // La Palma
  "santa cruz de la palma": "La Palma", "los llanos de aridane": "La Palma",
  "breña baja": "La Palma",
  // El Hierro
  "valverde": "El Hierro",
};

function inferRegionFromMuni(municipality) {
  if (!municipality) return null;
  const key = municipality.toLowerCase().trim();
  return MUNI_REGION_MAP[key] || null;
}

function inferIslandFromMuni(municipality) {
  if (!municipality) return null;
  const key = municipality.toLowerCase().trim();
  return MUNI_ISLAND_MAP[key] || inferIsland(municipality);
}

// ============================================================
// HELPERS
// ============================================================
// getTransportType now accepts a mergedClient object containing the already-merged
// (custom + base) data for the establishment, so user corrections are always used.
function getTransportType(cRegion, dRegion, establishment, pref, cIsland, dIsland, cBase, dMuni, mergedClient) {
  const normCRegion = normalizeRegion(cRegion);
  const normDRegion = normalizeRegion(dRegion);

  // 0. Same Municipality -> Vehiculo (Top Priority)
  const normCBase = (cBase || "").toLowerCase().trim();
  const normDMuni = (dMuni || "").toLowerCase().trim();
  if (normCBase && normDMuni && normCBase === normDMuni) return "vehiculo";

  // 1. Resolve Destination Location using MERGED client data (user corrections take priority)
  let destinationRegion = normDRegion;
  let destinationIslandName = dIsland;
  let destinationMuni = dMuni;

  if (mergedClient) {
    // Use pre-merged client data (includes user corrections from customClientInfo)
    if (mergedClient.region) destinationRegion = normalizeRegion(mergedClient.region);
    if (mergedClient.island) destinationIslandName = mergedClient.island;
    if (mergedClient.municipality) destinationMuni = mergedClient.municipality;
  } else if (establishment && CLIENT_LOOKUP[establishment]) {
    // Fallback to static lookup only if no mergedClient provided
    const client = CLIENT_LOOKUP[establishment];
    if (client.region) destinationRegion = normalizeRegion(client.region);
    if (client.island) destinationIslandName = client.island;
    if (client.municipality) destinationMuni = client.municipality;
  }

  // 1b. Infer region and island from municipality name (crucial for address corrections)
  const inferredRegion = inferRegionFromMuni(destinationMuni);
  if (inferredRegion) destinationRegion = normalizeRegion(inferredRegion);

  const inferredIsland = inferIslandFromMuni(destinationMuni);
  if (inferredIsland) destinationIslandName = inferredIsland;

  const destinationIsIsland = ISLAND_REGIONS.includes(destinationRegion);
  const cIsIsland = ISLAND_REGIONS.includes(normCRegion);

  // Deep inference fallback for islands
  if (destinationIsIsland && !destinationIslandName) {
    const extra = EXTRA_CLIENT_INFO[establishment] || {};
    destinationIslandName = inferIsland(destinationMuni) || inferIsland(establishment) || inferIsland(extra.address);
  }
  const effectiveCIsland = cIsland || inferIsland(cBase);

  // 2. Priority: Same Island -> Vehiculo (Overrides weak region matching)
  if (effectiveCIsland && destinationIslandName && effectiveCIsland === destinationIslandName) {
    return "vehiculo";
  }

  // 3. Same Region Peninsula -> Vehiculo
  if (normCRegion === destinationRegion && !destinationIsIsland) return "vehiculo";

  // 4. Any travel involving an island
  if (cIsIsland || destinationIsIsland) {
    if (cIsIsland && destinationIsIsland) {
      // Both are islands
      if (normCRegion !== destinationRegion) return "vuelo"; // Different archipelagos

      // Same archipelago. If DIFFERENT islands -> Vuelo.
      if (effectiveCIsland && destinationIslandName && effectiveCIsland !== destinationIslandName) {
        return "vuelo";
      }
      return "vehiculo";
    }
    return "vuelo"; // One island, one peninsula
  }

  // 5. Madrid Consultant -> Peninsula -> Tren
  if (normCRegion === "Madrid") return "tren";

  // 6. Andalucía / Cataluña -> Coche (Own vehicle usually, unless pref is auto)
  if (normCRegion === "Andalucía" || normCRegion === "Cataluña") return pref === "auto" ? "auto" : "vehiculo";

  // 7. Default
  if (pref === "tren") return "tren";
  if (pref === "auto") return "auto";
  return "vehiculo";
}

const TRANSPORT_META = {
  vuelo: { icon: "✈️", label: "Vuelo", color: "#0D4BD9", bg: "#EEF2FF" },
  tren: { icon: "🚄", label: "Tren AVE", color: "#7C3AED", bg: "#F3EEFF" },
  vehiculo: { icon: "🚗", label: "Vehículo Propio", color: "#059669", bg: "#ECFDF5" },
  auto: { icon: "🚙", label: "Coche Alquiler", color: "#0891B2", bg: "#ECFEFF" },
  local: { icon: "📍", label: "Local", color: "#6B7280", bg: "#F3F4F6" },
};



function buildGoogleFlightsUrl(fromCity, toCity, dateStr, returnDateStr) {
  // Versión "segura": búsqueda genérica sin fechas para evitar errores de API/formato
  return `https://www.google.com/travel/flights?q=vuelos+de+${encodeURIComponent(fromCity)}+a+${encodeURIComponent(toCity)}`;
}

function buildRenfeUrl(fromStation, toStation, dateStr) {
  return "https://www.renfe.com/es/es";
}

function buildTrainlineUrl(fromCity, toCity, dateStr) {
  return "https://www.thetrainline.com/es";
}

function buildIryoUrl(fromCity, toCity, dateStr) {
  return "https://iryo.eu/es";
  // Fallback: generic search
  return `https://iryo.eu/es`;
}

function buildGMapsUrl(from, to) {
  return `https://www.google.com/maps/dir/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
}


function buildVuelingUrl(fromCode, toCode, dateStr, returnDateStr) {
  return "https://www.vueling.com/es";
}

function buildIberiaUrl(fromCode, toCode, dateStr, returnDateStr) {
  return "https://www.iberia.com/es";
}

function buildSkyscannerUrl(fromCode, toCode, dateStr, returnDateStr) {
  return "https://www.skyscanner.es";
}

function buildBinterUrl(fromCode, toCode, dateStr, returnDateStr) {
  // Binter's booking system is complex to deep-link directly without specific session tokens,
  // so we point to the official site's booking start page as requested.
  return "https://www.bintercanarias.com";
}

// Build rent-a-car deep links with pickup location & dates
function buildRentACarUrl(company, pickupCity, dateStr, returnDateStr) {
  const [d, m, y] = (dateStr || "").split("/");
  const isoDate = d && m && y ? `${y}-${m}-${d}` : "";
  const [rd, rm, ry] = (returnDateStr || dateStr || "").split("/");
  const isoReturn = rd && rm && ry ? `${ry}-${rm}-${rd}` : isoDate;

  // Simplificado para evitar errores con parámetros: enviar a web principal o búsqueda genérica
  switch (company) {
    case "cicar": return "https://www.cicar.com/es";
    case "okmobility": return "https://www.okmobility.com/es";
    case "goldcar": return "https://www.goldcar.es";
    case "europcar": return "https://www.europcar.es";
    default: return `https://www.google.com/search?q=alquiler+coche+${encodeURIComponent(pickupCity)}`;
  }
}

// ============================================================
// AI SEARCH (Claude API)
// ============================================================
async function searchTransportAI(consultant, activity, transportType) {
  const c = CONSULTANTS[consultant];
  if (!c) throw new Error("Consultor no encontrado");
  const dest = REGION_DEST[activity.r] || {};

  const prompt = `Eres un asistente de viajes corporativo para HS Consulting Group. Responde SOLO en JSON válido.
DATOS DEL VIAJE:
- Consultor: ${consultant}
- Origen: ${c.base} (${c.airport || "N/A"})
- Destino: ${activity.e} en ${dest.city || activity.r} (${dest.airport || "N/A"})
- Periodo: ${activity.startDate} al ${activity.endDate}
- Tipo: ${transportType}
- Horario Requerido: Llegada recomendada a las 07:00 (ida), Regreso a las 18:00 (vuelta).

Genera opciones realistas de ${transportType} (vuelo/tren/vehículo). 
Si es inter-islas Canarias, usa Binter siempre.

JSON requerido: { "options": [], "return_options": [], "total_estimated_eur": 0, "recommendation": "", "route_summary": "" }`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  const text = (data.content || []).map(b => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ============================================================
// COMPONENTS
// ============================================================

function inferRegionFromBase(base) {
  if (!base) return "Desconocido";
  const b = base.toLowerCase();
  if (b.includes("madrid")) return "Madrid";
  if (b.includes("palmas") || b.includes("tenerife") || b.includes("lanzarote") || b.includes("fuerteventura")) return "Islas Canarias";
  if (b.includes("mallorca") || b.includes("ibiza") || b.includes("menorca")) return "Islas Baleares";
  if (b.includes("barcelona") || b.includes("girona") || b.includes("tarragona")) return "Cataluña";
  if (b.includes("sevilla") || b.includes("málaga") || b.includes("cádiz") || b.includes("algeciras")) return "Andalucía";
  if (b.includes("alicante") || b.includes("valencia")) return "Valencia";
  return base;
}

function TransportBadge({ type }) {
  const m = TRANSPORT_META[type] || TRANSPORT_META.local;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: m.bg, color: m.color, fontWeight: 600, fontSize: 11.5 }}>
      {m.icon} {m.label}
    </span>
  );
}

// Extract municipality from Nominatim address details
function extractMuniFromNominatim(addr) {
  return addr.city || addr.town || addr.village || addr.municipality || addr.county || null;
}

// Build display address from Nominatim result
function buildAddressFromNominatim(result) {
  const addr = result.address || {};
  const parts = [];
  if (addr.road) parts.push(addr.road);
  if (addr.house_number) parts[parts.length - 1] += ` ${addr.house_number}`;
  if (addr.postcode) parts.push(addr.postcode);
  const muni = extractMuniFromNominatim(addr);
  if (muni) parts.push(muni);
  if (addr.state) parts.push(addr.state);
  return parts.join(", ") || result.display_name;
}

function GeocodingValidationPanel({ proposal, geocodeState, onSearch, onSelectResult, onConfirm, onEditManually }) {
  const p = proposal;
  const gs = geocodeState || {};

  // REMOVED: Always allow editing, not just for generic addresses
  // if (!p.isGenericAddress) return null;

  // Manual editing mode
  if (gs.editing) {
    return (
      <div style={{ background: "#FFFBEB", padding: 12, borderRadius: 8, border: "1px solid #FEF3C7", marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#854D0E", marginBottom: 6 }}>
          ✏️ EDITAR DIRECCIÓN MANUALMENTE
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: "#999", display: "block", marginBottom: 2 }}>Municipio / Ciudad</label>
            <input
              defaultValue={p.destMuni}
              id={`muni-manual-${p.id}`}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 4, border: "1px solid #ddd", fontSize: 12 }}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 10, color: "#999", display: "block", marginBottom: 2 }}>Dirección Exacta</label>
            <input
              placeholder="Introduce dirección exacta..."
              defaultValue={p.destAddress === p.destMuni ? "" : p.destAddress}
              id={`addr-manual-${p.id}`}
              style={{ width: "100%", padding: "6px 10px", borderRadius: 4, border: "1px solid #ddd", fontSize: 12 }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              const newAddr = document.getElementById(`addr-manual-${p.id}`).value;
              const newMuni = document.getElementById(`muni-manual-${p.id}`).value;
              if (newAddr || newMuni) onConfirm(newAddr, newMuni);
            }}
            style={{ flex: 1, background: "#111", color: "white", border: "none", padding: "8px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            💾 Confirmar y Replantear Logística
          </button>
          <button
            onClick={onSearch}
            style={{ background: "white", color: "#0D4BD9", border: "1px solid #0D4BD9", padding: "8px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            🔍 Volver a Buscar
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (gs.loading) {
    return (
      <div style={{ background: "#EEF2FF", padding: 16, borderRadius: 8, border: "1px solid #C7D2FE", marginTop: 4, textAlign: "center" }}>
        <div style={{ fontSize: 20, marginBottom: 4, animation: "spin 1s linear infinite" }}>🔍</div>
        <div style={{ fontSize: 12, color: "#4F46E5", fontWeight: 600 }}>Buscando dirección de "{p.e}"...</div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Results found — show selectable results
  if (gs.results && gs.results.length > 0) {
    const selected = gs.results[gs.selected ?? 0];
    const selectedAddr = selected?.address || {};
    const selectedMuni = extractMuniFromNominatim(selectedAddr);
    const selectedFullAddr = buildAddressFromNominatim(selected);

    return (
      <div style={{ background: "#EEF2FF", padding: 12, borderRadius: 8, border: "1px solid #C7D2FE", marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#4F46E5", marginBottom: 8 }}>
          📍 DIRECCIÓN ENCONTRADA — Confirma o selecciona otra opción
        </div>

        {/* Selected result details */}
        <div style={{ background: "white", borderRadius: 8, padding: 12, border: "1px solid #E0E7FF", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 24 }}>📌</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 2 }}>{p.e}</div>
              <div style={{ fontSize: 12, color: "#444", marginBottom: 2 }}>{selectedFullAddr}</div>
              {selectedMuni && (
                <div style={{ fontSize: 11, color: "#4F46E5", fontWeight: 600 }}>
                  Municipio: {selectedMuni} {selectedAddr.state ? `(${selectedAddr.state})` : ""}
                </div>
              )}
            </div>
            <a
              href={`https://www.google.com/maps/search/${encodeURIComponent(selected.display_name)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ background: "white", color: "#111", border: "1px solid #ddd", padding: "6px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              🗺️ Ver en Maps
            </a>
          </div>
        </div>

        {/* Other results if more than one */}
        {gs.results.length > 1 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 600, marginBottom: 4 }}>OTROS RESULTADOS:</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {gs.results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => onSelectResult(i)}
                  style={{
                    padding: "4px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                    border: i === (gs.selected ?? 0) ? "2px solid #4F46E5" : "1px solid #ddd",
                    background: i === (gs.selected ?? 0) ? "#EEF2FF" : "white",
                    color: i === (gs.selected ?? 0) ? "#4F46E5" : "#666",
                    fontWeight: i === (gs.selected ?? 0) ? 700 : 400,
                  }}
                >
                  {extractMuniFromNominatim(r.address) || r.display_name.split(",")[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onConfirm(selectedFullAddr, selectedMuni || p.destMuni)}
            style={{ flex: 1, background: "#10B981", color: "white", border: "none", padding: "10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            ✅ Confirmar Dirección y Recalcular Logística
          </button>
          <button
            onClick={onEditManually}
            style={{ background: "white", color: "#666", border: "1px solid #ddd", padding: "10px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            ✏️ Editar
          </button>
        </div>
      </div>
    );
  }

  // Initial state — show search button
  return (
    <div style={{ background: "#FFFBEB", padding: 12, borderRadius: 8, border: "1px solid #FEF3C7", marginTop: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#854D0E", marginBottom: 6 }}>
        🔍 VALIDACIÓN DE UBICACIÓN NECESARIA
      </div>
      <div style={{ fontSize: 12, color: "#92400E", marginBottom: 10 }}>
        No se ha encontrado la dirección exacta de <strong>{p.e}</strong>. Busca automáticamente para validar la dirección y recalcular la logística.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSearch}
          style={{ flex: 1, background: "#0D4BD9", color: "white", border: "none", padding: "10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          🔍 Buscar Dirección Automáticamente
        </button>
        <button
          onClick={onEditManually}
          style={{ background: "white", color: "#666", border: "1px solid #ddd", padding: "10px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          ✏️ Manual
        </button>
      </div>
    </div>
  );
}

function UploadScreen({ onDataLoaded, onConsultantsLoaded, existingActivities = [] }) {
  const inputRef = useRef(null);
  const consultantInputRef = useRef(null);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    parseCSV(file, (results) => {
      // Map columns for Planning
      const mapped = results.data.map((row, index) => ({
        id: Math.random().toString(36).substr(2, 9), // Use random IDs for new items
        a: (row["Auditor"] || row["auditor"] || row["Consultor"] || "").trim(),
        r: (row["Region"] || row["region"] || row["Región"] || "").trim(),
        e: (row["Establecimiento"] || row["establecimiento"] || "").trim(),
        d: (row["Actividad"] || row["actividad"] || "").trim(),
        f: (row["Fecha"] || row["fecha"] || "").trim(),
        j: parseFloat(row["Jornadas"] || row["jornadas"] || "0"),
        g: (row["Grupo"] || row["grupo"] || "").trim()
      })).filter(item => item.a && item.f);

      if (mapped.length === 0) {
        setError("No se encontraron filas válidas en la Planificación.");
        return;
      }

      // 1. Internal Deduplication (within the file)
      const internalSeen = new Set();
      const internalDeduplicated = [];
      for (const item of mapped) {
        const key = `${item.e}|${item.f}|${item.a}`.toLowerCase();
        if (!internalSeen.has(key)) {
          internalSeen.add(key);
          internalDeduplicated.push(item);
        }
      }

      // 2. Cross-check with Existing Activities
      const existingSeen = new Set(existingActivities.map(a => `${a.e}|${a.f}|${a.a}`.toLowerCase()));
      const newItems = internalDeduplicated.filter(item => {
        const key = `${item.e}|${item.f}|${item.a}`.toLowerCase();
        return !existingSeen.has(key);
      });

      if (newItems.length === 0) {
        setError("Error: Los datos ya existen en el sistema o están duplicados en el archivo. No se han subido nuevos registros.");
        return;
      }

      onDataLoaded(newItems);
      setSuccessMsg(`¡Planificación actualizada! Se han añadido ${newItems.length} registros nuevos.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    });
  };

  const handleConsultantFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    parseCSV(file, (results) => {
      // Expected: Nombre Completo, Base Ubicación, Email
      const consultantMap = {};

      results.data.forEach(row => {
        const name = row["Nombre Completo"] || row["Nombre"] || row["Auditor"];
        if (name) {
          let base = row["Base Ubicación"] || row["Base"] || row["Ciudad"];
          const address = row["Dirección"] || row["Direccion"] || row["DirecciÃ³n"] || "";

          // Fallback: Infer base from Address if Base is empty
          if (!base || base === "Desconocido") {
            if (address) {
              // Try to extract city from address (simple heuristic: last meaningful part)
              const parts = address.split(",");
              if (parts.length > 1) {
                base = parts[parts.length - 1].trim();
                // Remove zip code if present
                base = base.replace(/\d{5}/g, "").trim();
              } else {
                base = address;
              }
            } else {
              base = "Desconocido";
            }
          }

          const region = row["Región"] || row["Region"] || row["RegiÃ³n"];

          consultantMap[name] = {
            base: base,
            region: region ? normalizeRegion(region) : normalizeRegion(inferRegionFromBase(base)),
            pref: "vehiculo", // Default preference
            email: row["Email"] || "",
            address: row["Dirección"] || row["Direccion"] || row["DirecciÃ³n"] || "",
            phone: row["Teléfono"] || row["Telefono"] || row["TelÃ©fono"] || "",
            island: inferIsland(base),
            airport: null,
            station: null
          };
        }
      });

      if (Object.keys(consultantMap).length === 0) {
        const headers = results.meta.fields || [];
        setError(`No se encontraron consultores válidos. Columnas encontradas: ${headers.join(", ")}. Esperadas: 'Nombre Completo', 'Base Ubicación'.`);
        return;
      }

      onConsultantsLoaded(consultantMap);
      setSuccessMsg(`¡Base de datos de consultores actualizada! (${Object.keys(consultantMap).length} registros)`);
      setTimeout(() => setSuccessMsg(null), 3000);
    });
  };

  const parseCSV = (file, callback) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.error(results.errors);
          setError("Error al leer el CSV.");
          return;
        }
        try {
          callback(results);
        } catch (err) {
          setError("Error procesando datos: " + err.message);
        }
      },
      error: (err) => setError("Error de lectura: " + err.message)
    });
  };

  const loadSampleData = () => {
    const sample = [
      { id: "1", a: "Alejandro Piñero", r: "Madrid", e: "Hotel Emperador", d: "Auditoría anual", f: "15/02/2026", j: 1, g: "Emperador Hotels" },
      { id: "2", a: "Carmen Barrientos", r: "Islas Baleares", e: "Castell Son Claret", d: "Formación Manipuladores", f: "16/02/2026", j: 0.5, g: "Castell" },
      { id: "3", a: "Alejandra Rubilar", r: "Murcia", e: "Hotel Agalia", d: "Toma de muestras", f: "17/02/2026", j: 0.5, g: "Agalia" },
      { id: "4", a: "Froilán Cortés", r: "Cataluña", e: "W Barcelona", d: "Auditoría APPCC", f: "18/02/2026", j: 1, g: "Marriot" },
      { id: "5", a: "Alejandro Cardona Paz", r: "Islas Canarias", e: "Allsun Albatros", d: "Auditoría", f: "19/02/2026", j: 1, g: "Canarias Tour" },
      { id: "6", a: "Alejandro Cardona Paz", r: "Islas Canarias", e: "Abora Buenaventura", d: "Seguimiento", f: "21/02/2026", j: 1, g: "Canarias Tour" }
    ];
    onDataLoaded(sample);
  };

  return (
    <div style={{ minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", padding: 40, borderRadius: 24, boxShadow: "0 20px 40px rgba(0,0,0,0.08)", maxWidth: 500, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>📂</div>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 10px", color: "#111" }}>Cargar Planificación</h2>
        <p style={{ color: "#666", marginBottom: 30 }}>Sube el archivo CSV con la planificación mensual para generar la logística.</p>

        <input
          type="file"
          accept=".csv"
          ref={inputRef}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />

        <input
          type="file"
          accept=".csv"
          ref={consultantInputRef}
          onChange={handleConsultantFileChange}
          style={{ display: "none" }}
        />

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <button
            onClick={() => consultantInputRef.current.click()}
            style={{ flex: 1, background: "white", color: "#666", padding: "14px", borderRadius: 12, fontSize: 15, fontWeight: 600, border: "2px dashed #ccc", cursor: "pointer", transition: "all 0.2s" }}
          >
            1. Cargar Consultores (Opcional)
          </button>

          <button
            onClick={() => inputRef.current.click()}
            style={{ flex: 1, background: "#0D4BD9", color: "white", padding: "14px", borderRadius: 12, fontSize: 16, fontWeight: 600, border: "none", cursor: "pointer", boxShadow: "0 4px 12px rgba(13, 75, 217, 0.2)" }}
          >
            2. Cargar Planificación
          </button>
        </div>

        <button
          onClick={loadSampleData}
          style={{ background: "transparent", color: "#0D4BD9", padding: "10px 20px", marginTop: 12, borderRadius: 12, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", width: "100%", transition: "transform 0.2s" }}
        >
          Cargar Datos de Ejemplo
        </button>

        {successMsg && <div style={{ marginTop: 20, padding: 12, background: "#ECFDF5", color: "#065F46", borderRadius: 8, fontSize: 13 }}>{successMsg}</div>}
        {error && <div style={{ marginTop: 20, padding: 12, background: "#FEF2F2", color: "#991B1B", borderRadius: 8, fontSize: 13 }}>{error}</div>}

        <div style={{ marginTop: 30, fontSize: 12, color: "#999", borderTop: "1px solid #eee", paddingTop: 20 }}>
          Columnas esperadas: Auditor, Region, Establecimiento, Actividad, Fecha, Jornadas, Grupo.
        </div>
      </div>
    </div>
  );
}

// ── New Establishments Validation Modal ──
// Shows when CSV upload detects hotels not in the database
const REGION_OPTIONS = [
  "Andalucía", "Aragón", "Asturias", "Islas Baleares", "Islas Canarias",
  "Cantabria", "Castilla-La Mancha", "Castilla y León", "Cataluña",
  "Comunidad Valenciana", "Extremadura", "Galicia", "La Rioja",
  "Madrid", "Murcia", "Navarra", "País Vasco"
];
const ISLAND_OPTIONS = {
  "Islas Baleares": ["Mallorca", "Menorca", "Ibiza", "Formentera"],
  "Islas Canarias": ["Tenerife", "Gran Canaria", "Lanzarote", "Fuerteventura", "La Palma", "La Gomera", "El Hierro"]
};

function NewEstablishmentsModal({ establishments, regionFromCSV, consultantFromCSV, onSave, onSkip }) {
  const [formData, setFormData] = useState(() =>
    establishments.map(name => ({
      name,
      address: "",
      municipality: "",
      region: regionFromCSV[name] || "",
      island: ""
    }))
  );
  const [saving, setSaving] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const update = (idx, field, value) => {
    setFormData(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "region" && !ISLAND_OPTIONS[value]) {
        next[idx].island = "";
      }
      return next;
    });
  };

  const gmapsSearchUrl = (name) =>
    `https://www.google.com/maps/search/${encodeURIComponent(name + " hotel España")}`;

  // Open Maps + expand form
  const openMapsAndExpand = (idx) => {
    window.open(gmapsSearchUrl(formData[idx].name), "_blank");
    setExpandedIdx(idx);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    await onSave(formData);
    setSaving(false);
  };

  const completedCount = formData.filter(f => f.municipality && f.region).length;

  const goToNext = () => {
    const nextIdx = formData.findIndex((f, i) => i !== expandedIdx && (!f.municipality || !f.region));
    if (nextIdx >= 0) {
      setExpandedIdx(nextIdx);
      window.open(gmapsSearchUrl(formData[nextIdx].name), "_blank");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20
    }}>
      <div style={{
        background: "white", borderRadius: 20, width: "100%", maxWidth: 900,
        maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 25px 50px rgba(0,0,0,0.25)"
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
          padding: "20px 28px", color: "white"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 28 }}>🏨</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Nuevos Establecimientos Detectados</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.9 }}>
                <strong>{establishments.length}</strong> establecimientos nuevos.
                Pulsa <strong>"🗺️ Abrir Maps"</strong> para buscar la dirección y pégala en el formulario.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <div style={{ background: "rgba(255,255,255,0.25)", padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
              ✅ {completedCount}/{establishments.length}
            </div>
            <div style={{ flex: 1, background: "rgba(255,255,255,0.15)", borderRadius: 8, overflow: "hidden", height: 8 }}>
              <div style={{
                width: `${(completedCount / establishments.length) * 100}%`,
                height: "100%", background: "rgba(255,255,255,0.6)", borderRadius: 8,
                transition: "width 0.3s ease"
              }} />
            </div>
          </div>
        </div>

        {/* Establishments List */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 24px" }}>
          {formData.map((est, idx) => {
            const isIslandRegion = ISLAND_OPTIONS[est.region];
            const isComplete = est.municipality && est.region;
            const isExpanded = expandedIdx === idx;

            return (
              <div key={idx} style={{
                background: isComplete ? "#F0FDF4" : isExpanded ? "#FEFCE8" : "white",
                border: `1.5px solid ${isComplete ? "#86EFAC" : isExpanded ? "#FCD34D" : "#E2E8F0"}`,
                borderRadius: 12, padding: "12px 16px", marginBottom: 8,
                transition: "all 0.2s ease"
              }}>
                {/* Row: Name + Consultant + Button */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>
                    {isComplete ? "✅" : "⬜"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {est.name}
                    </div>
                    {consultantFromCSV?.[est.name] && (
                      <span style={{ fontSize: 10, color: "#6366F1", fontWeight: 600 }}>
                        👤 {consultantFromCSV[est.name]}
                      </span>
                    )}
                    {isComplete && !isExpanded && (
                      <div style={{ fontSize: 10, color: "#16A34A", fontWeight: 500 }}>
                        {est.municipality} — {est.region}{est.address ? ` · ${est.address.substring(0, 40)}...` : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    <button
                      onClick={() => openMapsAndExpand(idx)}
                      style={{
                        background: isExpanded ? "#2563EB" : "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                        color: "white", border: "none", borderRadius: 8,
                        padding: "7px 14px", fontSize: 11, fontWeight: 700,
                        cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                        boxShadow: "0 2px 8px rgba(37,99,235,0.3)", transition: "all 0.2s"
                      }}
                    >
                      🗺️ Abrir Maps
                    </button>
                    {isExpanded && (
                      <button
                        onClick={() => setExpandedIdx(null)}
                        style={{
                          background: "#F1F5F9", color: "#64748B", border: "none", borderRadius: 6,
                          padding: "6px 8px", fontSize: 12, cursor: "pointer", lineHeight: 1
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded: Form to paste address */}
                {isExpanded && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
                    <div style={{
                      background: "#EFF6FF", borderRadius: 8, padding: "8px 12px", marginBottom: 12,
                      fontSize: 11, color: "#1D4ED8", fontWeight: 500
                    }}>
                      📋 Copia la dirección de Google Maps y pégala abajo. Selecciona la región y el municipio.
                    </div>

                    {/* Address - full width, prominent */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>
                        📍 Dirección de Google Maps
                      </label>
                      <input
                        type="text"
                        value={est.address}
                        onChange={e => update(idx, "address", e.target.value)}
                        placeholder="Pega aquí la dirección de Google Maps..."
                        autoFocus
                        style={{
                          width: "100%", padding: "10px 14px", borderRadius: 8,
                          border: `2px solid ${est.address ? "#86EFAC" : "#60A5FA"}`,
                          fontSize: 14, boxSizing: "border-box",
                          background: est.address ? "#F0FDF4" : "#FAFCFF",
                          outline: "none"
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: isIslandRegion ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8 }}>
                      {/* Region */}
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 3 }}>
                          Región *
                        </label>
                        <select
                          value={est.region}
                          onChange={e => update(idx, "region", e.target.value)}
                          style={{
                            width: "100%", padding: "8px 10px", borderRadius: 8,
                            border: `1.5px solid ${est.region ? "#86EFAC" : "#FDE68A"}`,
                            fontSize: 12, background: "white"
                          }}
                        >
                          <option value="">— Región —</option>
                          {REGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>

                      {/* Island (if applicable) */}
                      {isIslandRegion && (
                        <div>
                          <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 3 }}>
                            Isla
                          </label>
                          <select
                            value={est.island}
                            onChange={e => update(idx, "island", e.target.value)}
                            style={{
                              width: "100%", padding: "8px 10px", borderRadius: 8,
                              border: "1.5px solid #E2E8F0", fontSize: 12, background: "white"
                            }}
                          >
                            <option value="">— Isla —</option>
                            {isIslandRegion.map(i => <option key={i} value={i}>{i}</option>)}
                          </select>
                        </div>
                      )}

                      {/* Municipality */}
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 3 }}>
                          Municipio *
                        </label>
                        <input
                          type="text"
                          value={est.municipality}
                          onChange={e => update(idx, "municipality", e.target.value)}
                          placeholder="Ciudad..."
                          style={{
                            width: "100%", padding: "8px 10px", borderRadius: 8,
                            border: `1.5px solid ${est.municipality ? "#86EFAC" : "#FDE68A"}`,
                            fontSize: 12, boxSizing: "border-box"
                          }}
                        />
                      </div>
                    </div>

                    {/* Action: next */}
                    {isComplete && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                        <button
                          onClick={goToNext}
                          style={{
                            background: "linear-gradient(135deg, #10B981 0%, #059669 100%)", color: "white", border: "none",
                            padding: "7px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                            boxShadow: "0 2px 8px rgba(16,185,129,0.3)"
                          }}
                        >
                          Siguiente hotel →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 24px", borderTop: "1px solid #E2E8F0",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12
        }}>
          <button
            onClick={onSkip}
            style={{
              background: "transparent", color: "#64748B", border: "1px solid #E2E8F0",
              padding: "9px 18px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Omitir por ahora
          </button>
          <button
            onClick={handleSaveAll}
            disabled={saving || completedCount === 0}
            style={{
              background: saving ? "#94A3B8" : "linear-gradient(135deg, #0D4BD9 0%, #2563EB 100%)", color: "white",
              border: "none", padding: "10px 28px", borderRadius: 10,
              fontSize: 13, fontWeight: 700, cursor: saving ? "wait" : "pointer",
              opacity: completedCount === 0 ? 0.5 : 1,
              boxShadow: completedCount > 0 ? "0 4px 12px rgba(13,75,217,0.3)" : "none"
            }}
          >
            {saving ? "⏳ Guardando..." : `💾 Guardar ${completedCount} establecimientos`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Ad-hoc Trip Modal ──
// For creating trips not in the CSV/programming
function NewTripModal({ consultants, establishments, onSave, onClose }) {
  const consultantNames = Object.keys(consultants).sort();
  const estNames = establishments.map(c => c.name).sort();

  const emptyVisit = () => ({ date: "", establishment: "", customEstablishment: "", activity: "Visita Comercial", isCustom: false });

  const [consultant, setConsultant] = useState("");
  const [visits, setVisits] = useState([emptyVisit()]);
  const [groupName, setGroupName] = useState("");

  const updateVisit = (idx, field, value) => {
    setVisits(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "establishment" && value === "__custom__") {
        next[idx].isCustom = true;
        next[idx].establishment = "";
      } else if (field === "establishment") {
        next[idx].isCustom = false;
        next[idx].customEstablishment = "";
      }
      return next;
    });
  };

  const addVisit = () => setVisits(prev => [...prev, emptyVisit()]);
  const removeVisit = (idx) => setVisits(prev => prev.filter((_, i) => i !== idx));

  const validVisits = visits.filter(v =>
    v.date && (v.establishment || (v.isCustom && v.customEstablishment))
  );
  const canSave = consultant && validVisits.length > 0;

  const handleSave = (shouldBook = false) => {
    if (!canSave) return;
    const c = consultants[consultant];
    const items = validVisits.map(v => ({
      id: Math.random().toString(36).substr(2, 9),
      a: consultant,
      r: c?.region || "",
      e: v.isCustom ? v.customEstablishment : v.establishment,
      d: v.activity || "Visita Comercial",
      f: v.date.split("-").reverse().join("/"), // YYYY-MM-DD → DD/MM/YYYY
      j: 1,
      g: (groupName ? groupName + '-' : '') + `ADHOC-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      _isAdHoc: true, // Mark as ad-hoc trip


      _isOther: v.isCustom // Flag if it's "Otros" custom hotel
    }));
    onSave(items, shouldBook);
  };


  // Auto-fill dates: if first date set & others empty, suggest consecutive dates
  const suggestDates = () => {
    if (visits.length <= 1 || !visits[0].date) return;
    setVisits(prev => {
      const next = [...prev];
      const base = new Date(next[0].date);
      for (let i = 1; i < next.length; i++) {
        if (!next[i].date) {
          const d = new Date(base);
          d.setDate(d.getDate() + i);
          next[i] = { ...next[i], date: d.toISOString().split("T")[0] };
        }
      }
      return next;
    });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20
    }}>
      <div style={{
        background: "white", borderRadius: 20, width: "100%", maxWidth: 800,
        maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 25px 50px rgba(0,0,0,0.25)"
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #0D4BD9 0%, #4F46E5 100%)",
          padding: "20px 28px", color: "white"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28 }}>✈️</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Nuevo Viaje Ad-hoc</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.85 }}>
                Crea un viaje fuera de programación con las mismas opciones de reserva
              </p>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
          {/* Consultant + Group */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>
                Consultor *
              </label>
              <select
                value={consultant}
                onChange={e => setConsultant(e.target.value)}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  border: `2px solid ${consultant ? "#86EFAC" : "#FDE68A"}`,
                  fontSize: 14, fontWeight: 600, background: "white"
                }}
              >
                <option value="">— Seleccionar consultor —</option>
                {consultantNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>
                Grupo / Expedición
              </label>
              <input
                type="text"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="Ej: Visita Comercial Mar"
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  border: "1px solid #E2E8F0", fontSize: 13, boxSizing: "border-box"
                }}
              />
            </div>
          </div>

          {/* Visits */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              📋 Visitas del viaje ({visits.length})
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {visits.length > 1 && visits[0].date && (
                <button
                  onClick={suggestDates}
                  style={{ background: "#EEF2FF", color: "#4F46E5", border: "none", padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                >
                  📅 Auto-rellenar fechas
                </button>
              )}
              <button
                onClick={addVisit}
                style={{ background: "#0D4BD9", color: "white", border: "none", padding: "4px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                + Añadir visita
              </button>
            </div>
          </div>

          {visits.map((visit, idx) => (
            <div key={idx} style={{
              background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12,
              padding: "14px 16px", marginBottom: 10
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#6366F1" }}>Visita {idx + 1}</span>
                {visits.length > 1 && (
                  <button
                    onClick={() => removeVisit(idx)}
                    style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#EF4444", fontSize: 16, cursor: "pointer", padding: 0, lineHeight: 1 }}
                    title="Eliminar visita"
                  >×</button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 10 }}>
                {/* Date */}
                <div>
                  <label style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Fecha *</label>
                  <input
                    type="date"
                    value={visit.date}
                    onChange={e => updateVisit(idx, "date", e.target.value)}
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8,
                      border: `1px solid ${visit.date ? "#86EFAC" : "#FDE68A"}`,
                      fontSize: 12, boxSizing: "border-box"
                    }}
                  />
                </div>

                {/* Establishment */}
                <div>
                  <label style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", display: "block", marginBottom: 3 }}>
                    Establecimiento *
                  </label>
                  {visit.isCustom ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={visit.customEstablishment}
                        onChange={e => updateVisit(idx, "customEstablishment", e.target.value)}
                        placeholder="Nombre del establecimiento / empresa..."
                        style={{
                          flex: 1, padding: "8px 10px", borderRadius: 8,
                          border: `1px solid ${visit.customEstablishment ? "#86EFAC" : "#FDE68A"}`,
                          fontSize: 12, boxSizing: "border-box"
                        }}
                      />
                      <button
                        onClick={() => { updateVisit(idx, "isCustom", false); updateVisit(idx, "establishment", ""); }}
                        style={{ background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 8, padding: "0 8px", fontSize: 11, cursor: "pointer", color: "#64748B", whiteSpace: "nowrap" }}
                      >
                        ← Lista
                      </button>
                    </div>
                  ) : (
                    <select
                      value={visit.establishment}
                      onChange={e => updateVisit(idx, "establishment", e.target.value)}
                      style={{
                        width: "100%", padding: "8px 10px", borderRadius: 8,
                        border: `1px solid ${visit.establishment ? "#86EFAC" : "#FDE68A"}`,
                        fontSize: 12, background: "white"
                      }}
                    >
                      <option value="">— Seleccionar —</option>
                      {estNames.map(n => <option key={n} value={n}>{n}</option>)}
                      <option value="__custom__">📝 Otro (escribir nombre)...</option>
                    </select>
                  )}
                </div>

                {/* Activity */}
                <div>
                  <label style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Actividad</label>
                  <input
                    type="text"
                    value={visit.activity}
                    onChange={e => updateVisit(idx, "activity", e.target.value)}
                    placeholder="Ej: Auditoría, Visita Comercial..."
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8,
                      border: "1px solid #E2E8F0", fontSize: 12, boxSizing: "border-box"
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 28px", borderTop: "1px solid #E2E8F0",
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent", color: "#64748B", border: "1px solid #E2E8F0",
              padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer"
            }}
          >
            Cancelar
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#94A3B8", marginRight: 10 }}>
              {validVisits.length} {validVisits.length === 1 ? "visita válida" : "visitas válidas"}
            </span>
            <button
              onClick={() => handleSave(false)}
              disabled={!canSave}
              style={{
                background: "white", color: "#475569",
                border: "1px solid #E2E8F0", padding: "10px 20px", borderRadius: 10,
                fontSize: 13, fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed"
              }}
            >
              Solo Guardar
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={!canSave}
              style={{
                background: canSave ? "#0D4BD9" : "#94A3B8", color: "white",
                border: "none", padding: "10px 24px", borderRadius: 10,
                fontSize: 13, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", gap: 8,
                boxShadow: "0 4px 12px rgba(13, 75, 217, 0.2)"
              }}
            >
              🚀 Guardar y Gestionar Reserva
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── BulkGeocodeModal imported CLIENT_DATA_raw at the top of file ──

function BulkGeocodeModal({ onClose, customClientInfo, onValidate }) {
  const [status, setStatus] = useState('idle'); // idle | running | done
  const [progress, setProgress] = useState({ current: 0, total: 0, ok: 0, failed: 0, skipped: 0 });
  const [log, setLog] = useState([]);
  const [failedList, setFailedList] = useState([]);
  const abortRef = useRef(false);

  const toProcess = useMemo(() => {
    return CLIENT_DATA_raw.filter(c => {
      if (!c.name) return false;
      const custom = customClientInfo[c.name];
      if (custom?.address) return false; // already validated
      if (c.address) return false; // has address in base JSON
      return true;
    });
  }, [customClientInfo]);

  const addLog = (msg, type = 'info') =>
    setLog(prev => [{ msg, type, ts: Date.now() }, ...prev].slice(0, 80));

  const geocodeSingle = async (hotel) => {
    const queries = [
      `${hotel.name}, ${hotel.municipality}, Spain`,
      hotel.island ? `${hotel.name}, ${hotel.island}, Spain` : null,
      `${hotel.name}, ${hotel.region || ''}, Spain`,
    ].filter(Boolean);

    for (const q of queries) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1&accept-language=es`;
        const res = await fetch(url, { headers: { 'User-Agent': 'HS-TravelPlanner/1.0' } });
        if (!res.ok) continue;
        const results = await res.json();
        if (results.length > 0) {
          const r = results[0];
          return {
            address: r.display_name,
            municipality: r.address?.city || r.address?.town || r.address?.village || hotel.municipality
          };
        }
      } catch { }
      await new Promise(r => setTimeout(r, 300));
    }
    return null;
  };

  const runGeocode = async () => {
    abortRef.current = false;
    setStatus('running');
    setLog([]);
    setFailedList([]);
    const total = toProcess.length;
    let ok = 0, failed = 0, skipped = 0;
    setProgress({ current: 0, total, ok: 0, failed: 0, skipped: 0 });

    for (let i = 0; i < toProcess.length; i++) {
      if (abortRef.current) { addLog('⛔ Cancelado por el usuario', 'warn'); break; }
      const hotel = toProcess[i];
      setProgress(p => ({ ...p, current: i + 1 }));

      const geo = await geocodeSingle(hotel);
      await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit 1 req/s

      if (geo) {
        ok++;
        addLog(`✅ ${hotel.name.slice(0, 45)} → ${geo.municipality}`, 'ok');
        await onValidate(hotel.name, geo.address, geo.municipality);
        setProgress(p => ({ ...p, ok }));
      } else {
        failed++;
        addLog(`❌ ${hotel.name.slice(0, 45)} — no encontrado`, 'err');
        setFailedList(prev => [...prev, hotel]);
        setProgress(p => ({ ...p, failed }));
      }
    }
    setStatus('done');
    addLog(`🏁 Completado: ${ok} validados, ${failed} no encontrados`, 'info');
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 24, maxWidth: 560, width: '100%', padding: 32, boxShadow: '0 40px 100px rgba(0,0,0,0.5)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🌍 Geocodificación Masiva</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>{toProcess.length} establecimientos sin dirección validada</p>
          </div>
          {status !== 'running' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>✕</button>
          )}
        </div>

        {/* Progress Bar */}
        {status !== 'idle' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 6 }}>
              <span>{progress.current} / {progress.total}</span>
              <span style={{ color: '#10B981', fontWeight: 700 }}>✅ {progress.ok}</span>
              <span style={{ color: '#EF4444', fontWeight: 700 }}>❌ {progress.failed}</span>
              <span>{pct}%</span>
            </div>
            <div style={{ height: 10, background: '#F0F4F8', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #10B981, #059669)', borderRadius: 99, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}

        {/* Log */}
        <div style={{ flex: 1, overflowY: 'auto', background: '#0F172A', borderRadius: 12, padding: 14, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7, minHeight: 180, maxHeight: 300 }}>
          {log.length === 0 && status === 'idle' && (
            <div style={{ color: '#64748B', textAlign: 'center', marginTop: 40 }}>
              Usa OpenStreetMap (Nominatim) para buscar la dirección exacta de cada hotel.<br />
              El proceso puede tardar ~{Math.round(toProcess.length * 1.3 / 60)} minutos.
            </div>
          )}
          {log.map((entry, i) => (
            <div key={i} style={{ color: entry.type === 'ok' ? '#4ADE80' : entry.type === 'err' ? '#F87171' : entry.type === 'warn' ? '#FBBF24' : '#94A3B8' }}>
              {entry.msg}
            </div>
          ))}
        </div>

        {/* Failed List */}
        {failedList.length > 0 && status === 'done' && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEF2F2', borderRadius: 10, fontSize: 11, color: '#B91C1C', maxHeight: 100, overflowY: 'auto' }}>
            <strong>No encontrados ({failedList.length}) — puedes editarlos manualmente en Propuestas:</strong>
            <div>{failedList.map(f => f.name).join(' • ')}</div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {status === 'idle' && (
            <button onClick={runGeocode} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg, #10B981, #059669)', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
              🚀 Iniciar Geocodificación
            </button>
          )}
          {status === 'running' && (
            <button onClick={() => { abortRef.current = true; }} style={{ flex: 1, padding: '14px', background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              ⛔ Cancelar
            </button>
          )}
          {status === 'done' && (
            <button onClick={onClose} style={{ flex: 1, padding: '14px', background: '#0D4BD9', color: 'white', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              ✅ Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmClearModal({ onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, maxWidth: 420, width: '100%', padding: 36, boxShadow: '0 30px 80px rgba(0,0,0,0.4)', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🗑️</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 10px' }}>¿Borrar toda la planificación?</h2>
        <p style={{ fontSize: 14, color: '#666', margin: '0 0 28px', lineHeight: 1.6 }}>Esta acción eliminará todos los registros de actividades cargados. <strong>No se puede deshacer.</strong></p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onCancel}
            style={{ flex: 1, padding: '14px', background: 'white', color: '#374151', border: '2px solid #E5E7EB', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg, #EF4444, #B91C1C)', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(239,68,68,0.4)' }}
          >
            Sí, borrar todo
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ stats, summaryByAuditor, onNavigate, onTriggerPlanning, onTriggerConsultants, uploadFlash, onClearData, onLogout, onBulkGeocode, onTriggerHotels, accommodationHotelsCount, onTriggerNewTrip }) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const consultants = Object.entries(summaryByAuditor || {}).sort((a, b) => b[1].total - a[1].total);

  return (
    <div>
      {showClearConfirm && (
        <ConfirmClearModal
          onConfirm={() => { setShowClearConfirm(false); onClearData(); }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
      <div style={{ marginBottom: 40, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: "linear-gradient(135deg, #0D4BD9 0%, #4F46E5 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 12px rgba(13, 75, 217, 0.3)"
            }}>
              <span style={{ fontSize: 24 }}>📊</span>
            </div>
            <div>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: "#0F172A", margin: 0, letterSpacing: "-0.02em" }}>
                Centro de Operaciones
              </h2>
              <p style={{ fontSize: 14, color: "#64748B", margin: "2px 0 0", fontWeight: 500 }}>
                Gestión logística y planificación de viajes <span style={{ color: "#0D4BD9", fontWeight: 700 }}>HS Consulting</span>
              </p>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => onNavigate("consultants")}
            style={{
              background: "white", color: "#334155", border: "1px solid #E2E8F0",
              padding: "10px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              transition: "all 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#94A3B8"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <span style={{ fontSize: 16 }}>👥</span> Consultores
          </button>
          <button
            onClick={onTriggerPlanning}
            style={{
              background: "linear-gradient(135deg, #0D4BD9 0%, #2563EB 100%)", color: "white", border: "none",
              padding: "10px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              boxShadow: "0 4px 14px rgba(13, 75, 217, 0.3)", transition: "all 0.2s ease"
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(13, 75, 217, 0.4)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(13, 75, 217, 0.3)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <span style={{ fontSize: 16 }}>📄</span> Importar CSV
          </button>

          <button
            onClick={onTriggerNewTrip}
            style={{
              background: "linear-gradient(135deg, #10B981 0%, #059669 100%)", color: "white", border: "none",
              padding: "10px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              boxShadow: "0 4px 14px rgba(16, 185, 129, 0.3)", transition: "all 0.2s ease"
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.4)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(16, 185, 129, 0.3)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <span style={{ fontSize: 16 }}>✈️</span> Nuevo Viaje
          </button>

          {onTriggerHotels && (
            <button
              onClick={onTriggerHotels}
              style={{
                background: accommodationHotelsCount > 0 ? "linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)" : "white",
                color: accommodationHotelsCount > 0 ? "#3730A3" : "#475569",
                border: accommodationHotelsCount > 0 ? "1px solid #A5B4FC" : "1px solid #E2E8F0",
                padding: "10px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                transition: "all 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
              }}
              title={accommodationHotelsCount > 0 ? `${accommodationHotelsCount} zonas cargadas` : "Cargar hoteles de alojamiento"}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; }}
            >
              <span style={{ fontSize: 16 }}>🏨</span> Alojamientos{accommodationHotelsCount > 0 ? <span style={{ background: "#4F46E5", color: "white", borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 800, marginLeft: 2 }}>{accommodationHotelsCount}</span> : ""}
            </button>
          )}

          <div style={{ width: 1, height: 28, background: "#E2E8F0", margin: "0 2px" }} />

          {onClearData && (
            <button
              onClick={() => setShowClearConfirm(true)}
              style={{
                background: "white", color: "#94A3B8", border: "1px solid #E2E8F0",
                padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                transition: "all 0.2s ease"
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#FEF2F2"; e.currentTarget.style.color = "#DC2626"; e.currentTarget.style.borderColor = "#FCA5A5"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = "#94A3B8"; e.currentTarget.style.borderColor = "#E2E8F0"; }}
              title="Limpiar todos los datos"
            >
              🗑️
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                background: "white", color: "#94A3B8", border: "1px solid #E2E8F0",
                padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                transition: "all 0.2s ease"
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#F8FAFC"; e.currentTarget.style.color = "#475569"; e.currentTarget.style.borderColor = "#94A3B8"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = "#94A3B8"; e.currentTarget.style.borderColor = "#E2E8F0"; }}
              title="Cerrar sesión"
            >
              🚪
            </button>
          )}
        </div>
      </div>

      {uploadFlash && (
        <div style={{ marginBottom: 24, padding: "12px 20px", background: "#ECFDF5", color: "#065F46", borderRadius: 12, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
          <span>{uploadFlash}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20, marginBottom: 40 }}>
        {/* Card: Total */}
        <div
          onClick={() => onNavigate("proposals", "")}
          style={{ background: "white", padding: 24, borderRadius: 16, boxShadow: "0 4px 6px rgba(0,0,0,0.05)", cursor: "pointer", transition: "transform 0.2s", border: "1px solid #eee" }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-4px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
        >
          <div style={{ fontSize: 12, textTransform: "uppercase", color: "#2563EB", fontWeight: 700, letterSpacing: 1 }}>Total Trayectos</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: "#111", marginTop: 8 }}>{stats.total}</div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Planificación completa</div>
        </div>

        {/* Card: Vehiculo Propio */}
        <div
          onClick={() => onNavigate("proposals", ["vehiculo"])}
          style={{ background: "white", padding: 24, borderRadius: 16, boxShadow: "0 4px 6px rgba(0,0,0,0.05)", cursor: "pointer", transition: "transform 0.2s", border: "1px solid #05966920" }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-4px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
        >
          <div style={{ fontSize: 12, textTransform: "uppercase", color: "#059669", fontWeight: 700, letterSpacing: 1 }}>Vehículo Propio</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: "#059669", marginTop: 8 }}>{stats.vehiculo}</div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Trayectos locales y en coche</div>
        </div>

        {/* Card: En Espera */}
        <div
          onClick={() => onNavigate("proposals", ["vuelo", "tren"])}
          style={{ background: "white", padding: 24, borderRadius: 16, boxShadow: "0 4px 6px rgba(0,0,0,0.05)", cursor: "pointer", transition: "transform 0.2s", border: "1px solid #7C3AED20" }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-4px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
        >
          <div style={{ fontSize: 12, textTransform: "uppercase", color: "#7C3AED", fontWeight: 700, letterSpacing: 1 }}>En Espera</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: "#7C3AED", marginTop: 8 }}>{stats.vuelo + stats.tren}</div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Vuelos y Trenes (Pendientes)</div>
        </div>

        {/* Card: Gestionados */}
        <div
          onClick={() => onNavigate("managed", "")}
          style={{ background: "white", padding: 24, borderRadius: 16, boxShadow: "0 4px 6px rgba(0,0,0,0.05)", cursor: "pointer", transition: "transform 0.2s", border: "1px solid #10B981" }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-4px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
        >
          <div style={{ fontSize: 12, textTransform: "uppercase", color: "#10B981", fontWeight: 700, letterSpacing: 1 }}>Gestionados</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: "#10B981", marginTop: 8 }}>{stats.managed}</div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Logística Cerrada</div>
        </div>
      </div>

      {/* Monthly Stats */}
      {stats.byMonth && Object.keys(stats.byMonth).length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <h3 style={{ fontSize: 20, margin: "0 0 16px", color: "#111" }}>📊 Resumen por Mes</h3>
          <div style={{ background: "white", borderRadius: 16, border: "1px solid #eee", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "#475569", borderBottom: "2px solid #E2E8F0" }}>Mes</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "#2563EB", borderBottom: "2px solid #E2E8F0" }}>Importados</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "#7C3AED", borderBottom: "2px solid #E2E8F0" }}>Pendientes</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "#10B981", borderBottom: "2px solid #E2E8F0" }}>Gestionados</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "#64748B", borderBottom: "2px solid #E2E8F0" }}>% Completado</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.byMonth)
                  .sort(([a], [b]) => b.localeCompare(a)) // Most recent first
                  .map(([month, data]) => {
                    const pct = data.imported > 0 ? Math.round((data.managed / data.imported) * 100) : 0;
                    const monthLabel = month === "sin-fecha" ? "Sin Fecha" : (() => {
                      const [y, m] = month.split("-");
                      const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
                      return `${names[parseInt(m) - 1] || m} ${y}`;
                    })();
                    return (
                      <tr key={month} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "10px 16px", fontWeight: 600, color: "#1E293B" }}>📅 {monthLabel}</td>
                        <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 700, color: "#2563EB" }}>{data.imported}</td>
                        <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 600, color: data.pending > 0 ? "#7C3AED" : "#94A3B8" }}>{data.pending}</td>
                        <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 700, color: "#10B981" }}>{data.managed}</td>
                        <td style={{ padding: "10px 16px", textAlign: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                            <div style={{ width: 60, height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#10B981" : "#4F46E5", borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? "#10B981" : "#475569" }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                {/* Totals Row */}
                <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 800, color: "#111" }}>TOTAL</td>
                  <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 800, color: "#2563EB", fontSize: 15 }}>{stats.total}</td>
                  <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 800, color: "#7C3AED", fontSize: 15 }}>{stats.pending}</td>
                  <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: 800, color: "#10B981", fontSize: 15 }}>{stats.managed}</td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: stats.total > 0 ? "#10B981" : "#94A3B8" }}>
                      {stats.total > 0 ? Math.round((stats.managed / stats.total) * 100) : 0}%
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 40 }}>
        <h3 style={{ fontSize: 20, margin: "0 0 16px", color: "#111" }}>Planificación por Consultor</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16 }}>
          {consultants.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "40px", textAlign: "center", color: "#999", background: "white", borderRadius: 16, border: "1px solid #eee" }}>
              No hay datos de planificación cargados
            </div>
          ) : consultants.map(([name, data]) => (
            <div
              key={name}
              onClick={() => onNavigate("proposals", "", name)}
              style={{
                background: "white",
                padding: "16px 20px",
                borderRadius: 12,
                border: "1px solid #eee",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                transition: "all 0.2s"
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "#0D4BD9";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.05)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "#eee";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "#111", fontSize: 14 }}>{name}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>📍 {data.base}</div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: data.pending === 0 ? "#10B981" : "#111" }}>
                    {data.managed} / {data.total} <span style={{ fontSize: 10, fontWeight: 400, color: "#999" }}>Hoteles</span>
                  </div>
                  <div style={{ width: 60, height: 4, background: "#eee", borderRadius: 2, marginTop: 4, overflow: "hidden", marginLeft: "auto" }}>
                    <div style={{ width: `${(data.managed / data.total) * 100}%`, height: "100%", background: data.pending === 0 ? "#10B981" : "#4F46E5" }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, width: 60, justifyContent: "flex-end" }}>
                  {data.vuelo > 0 && <span title="Vuelos Pendientes" style={{ fontSize: 14 }}>✈️<sub style={{ fontSize: 9 }}>{data.vuelo}</sub></span>}
                  {data.tren > 0 && <span title="Trenes Pendientes" style={{ fontSize: 14 }}>🚄<sub style={{ fontSize: 9 }}>{data.tren}</sub></span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Converts DD/MM/YYYY or YYYY-MM-DD to YYYY-MM-DD (for HTML date inputs)
function toInputDate(dateStr) {
  if (!dateStr) return "";
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // DD/MM/YYYY
  const parts = dateStr.split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  return dateStr;
}
// Converts YYYY-MM-DD to DD/MM/YYYY for display / storage consistency
function toDisplayDate(dateStr) {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

// ====================================================================
// ACCOMMODATION HOTELS MANAGER MODAL
// ====================================================================
function AccommodationHotelsManager({ hotels, onClose, onUpdate, onImportCSV }) {
  const [newZone, setNewZone] = useState("");
  const [newHotel, setNewHotel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [selectedZone, setSelectedZone] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [flash, setFlash] = useState(null);
  const csvRef = useRef(null);

  const zones = Object.keys(hotels).sort();

  const showFlash = (msg, type = "ok") => {
    setFlash({ msg, type });
    setTimeout(() => setFlash(null), 3000);
  };

  const handleAdd = () => {
    const zone = (newZone || selectedZone).trim().toUpperCase();
    const hotel = newHotel.trim();
    if (!zone || !hotel) { showFlash("Zona y nombre del hotel son obligatorios.", "err"); return; }
    const updated = { ...hotels };
    if (!updated[zone]) updated[zone] = [];
    // Avoid duplicates
    if (updated[zone].some(h => h.hotel.toLowerCase() === hotel.toLowerCase())) {
      showFlash("Ese hotel ya existe en esa zona.", "err"); return;
    }
    updated[zone] = [...updated[zone], { hotel, ubicacion: newUrl.trim() }];
    onUpdate(updated);
    setNewHotel("");
    setNewUrl("");
    if (newZone) setNewZone(""); // clear only if it was a new zone
    showFlash(`✅ Hotel "${hotel}" añadido a ${zone}`);
  };

  const handleDeleteHotel = (zone, hotelName) => {
    const updated = { ...hotels };
    updated[zone] = updated[zone].filter(h => h.hotel !== hotelName);
    if (updated[zone].length === 0) delete updated[zone];
    onUpdate(updated);
  };

  const handleDeleteZone = (zone) => {
    const updated = { ...hotels };
    delete updated[zone];
    onUpdate(updated);
    if (selectedZone === zone) setSelectedZone("");
    showFlash(`🗑️ Zona "${zone}" eliminada.`);
  };

  const filteredZones = zones.filter(z =>
    !searchQ || z.toLowerCase().includes(searchQ.toLowerCase()) ||
    (hotels[z] || []).some(h => h.hotel.toLowerCase().includes(searchQ.toLowerCase()))
  );

  const totalHotels = Object.values(hotels).reduce((a, b) => a + b.length, 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 24, maxWidth: 760, width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 40px 100px rgba(0,0,0,0.45)' }}>

        {/* HEADER */}
        <div style={{ padding: '24px 28px 0', borderBottom: '1px solid #F1F5F9', paddingBottom: 18, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111' }}>🏨 Gestión de Hoteles de Alojamiento</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748B' }}>
                {zones.length} zonas · {totalHotels} hoteles en base de datos
              </p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999', lineHeight: 1 }}>✕</button>
          </div>

          {flash && (
            <div style={{ marginTop: 12, padding: '8px 14px', background: flash.type === 'err' ? '#FEF2F2' : '#ECFDF5', color: flash.type === 'err' ? '#991B1B' : '#065F46', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              {flash.msg}
            </div>
          )}
        </div>

        {/* ADD FORM */}
        <div style={{ padding: '18px 28px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>➕ Añadir nuevo hotel</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 180px' }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>Zona (existente o nueva) *</div>
              <select
                value={selectedZone}
                onChange={e => { setSelectedZone(e.target.value); if (newZone) setNewZone(''); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid #CBD5E1', fontSize: 13, background: 'white' }}
              >
                <option value="">-- Nueva zona --</option>
                {zones.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            {!selectedZone && (
              <div style={{ flex: '0 0 160px' }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>Nombre de nueva zona *</div>
                <input
                  value={newZone}
                  onChange={e => setNewZone(e.target.value.toUpperCase())}
                  placeholder="Ej: MÁLAGA"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid #CBD5E1', fontSize: 13, boxSizing: 'border-box', fontWeight: 700, letterSpacing: 1 }}
                />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>Nombre del hotel *</div>
              <input
                value={newHotel}
                onChange={e => setNewHotel(e.target.value)}
                placeholder="Ej: Hotel Reina Victoria"
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid #CBD5E1', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>URL Google Maps (opcional)</div>
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                placeholder="https://maps.google.com/..."
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid #CBD5E1', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
            <button
              onClick={handleAdd}
              style={{ padding: '9px 20px', background: 'linear-gradient(135deg, #1D4ED8, #2563EB)', color: 'white', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              ➕ Añadir
            </button>
            <div style={{ flexShrink: 0 }}>
              <input type="file" accept=".csv" ref={csvRef} style={{ display: 'none' }} onChange={e => { onImportCSV(e, 'append'); }} />
              <button
                onClick={() => csvRef.current.click()}
                style={{ padding: '9px 16px', background: 'white', color: '#475569', border: '1.5px solid #CBD5E1', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                title="Importar CSV y añadir a los existentes (no sobreescribe)"
              >
                📥 Importar CSV
              </button>
            </div>
          </div>
        </div>

        {/* SEARCH + LIST */}
        <div style={{ padding: '14px 28px 6px', flexShrink: 0 }}>
          <input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="🔍 Buscar por zona o nombre de hotel…"
            style={{ width: '100%', padding: '8px 14px', borderRadius: 10, border: '1.5px solid #E2E8F0', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 28px 24px' }}>
          {filteredZones.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#94A3B8', fontSize: 14 }}>
              {searchQ ? `Sin resultados para "${searchQ}"` : 'No hay hoteles cargados. Añade uno o importa un CSV.'}
            </div>
          ) : (
            filteredZones.map(zone => (
              <div key={zone} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    📍 {zone} <span style={{ fontWeight: 400, color: '#94A3B8', fontSize: 11 }}>({(hotels[zone] || []).length} hoteles)</span>
                  </div>
                  <button
                    onClick={() => handleDeleteZone(zone)}
                    style={{ background: 'transparent', border: 'none', color: '#CBD5E1', fontSize: 16, cursor: 'pointer', padding: '2px 6px', borderRadius: 6, transition: 'color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                    title={`Eliminar zona ${zone} completa`}
                  >🗑️</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(hotels[zone] || []).filter(h => !searchQ || h.hotel.toLowerCase().includes(searchQ.toLowerCase()) || zone.toLowerCase().includes(searchQ.toLowerCase())).map((h, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                      <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: '#1E293B' }}>{h.hotel}</div>
                      {h.ubicacion && (
                        <a href={h.ubicacion} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: '#0369A1', fontWeight: 600, background: '#E0F2FE', padding: '3px 8px', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap' }}
                        >
                          🗺️ Maps
                        </a>
                      )}
                      <button
                        onClick={() => handleDeleteHotel(zone, h.hotel)}
                        style={{ background: 'transparent', border: 'none', color: '#CBD5E1', fontSize: 15, cursor: 'pointer', padding: '2px 4px', flexShrink: 0, transition: 'color 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                        onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                        title="Eliminar hotel"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BookingPanel({ consultant, activity, transportType, establishments, consultants, onClose, onUpdateClientAddress, bookedLinks = {}, onMarkBooked, groupStartDate, groupEndDate, accommodationHotels = {}, onUpdateAccommodationHotels, onForceFinalize }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Dates: prefer group range > activity explicit > activity date field
  const [panelStartDate] = useState(groupStartDate || activity.startDate || activity.f);
  const [panelEndDate] = useState(groupEndDate || activity.endDate || activity.startDate || activity.f);

  // Locator modal state
  const [activeBookingUrl, setActiveBookingUrl] = useState(null);
  const [activeBookingLabel, setActiveBookingLabel] = useState("");
  const [locatorIda, setLocatorIda] = useState("");
  const [locatorVuelta, setLocatorVuelta] = useState("");
  const [dateIda, setDateIda] = useState("");
  const [dateVuelta, setDateVuelta] = useState("");
  const [isDualMode, setIsDualMode] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const c = (consultants || CONSULTANTS)[consultant] || {};
  const dest = REGION_DEST[activity.r] || {};

  const isCarProvider = (label) => ["CICAR", "OK Mobility", "Goldcar", "Europcar"].includes(label);
  const isSingleProvider = (label) => ["Google Flights", "Skyscanner", "Google Maps"].includes(label);

  const directLinks = useMemo(() => {
    const links = [];
    const destCity = dest.city || activity.destMuni || activity.r;
    const originCity = c.base || "Desconocido";

    if (transportType === "vuelo") {
      const originRegion = normalizeRegion(c.region);
      const destRegion = normalizeRegion(activity.r);
      const isCanaryFlight = originRegion === "Islas Canarias" || destRegion === "Islas Canarias";
      if (isCanaryFlight) {
        links.push({ label: "Binter Canarias", url: buildBinterUrl(c.airport, dest.airport, activity.startDate, activity.endDate), icon: "🇮🇨", desc: originRegion === destRegion ? "Inter-islas" : "Vuelos Binter" });
      }
      links.push({ label: "Google Flights", url: buildGoogleFlightsUrl(originCity, destCity, activity.startDate, activity.endDate), icon: "🔍", desc: "Comparador" });
      links.push({ label: "Skyscanner", url: buildSkyscannerUrl(c.airport || "", dest.airport || "", activity.startDate, activity.endDate), icon: "🔎", desc: "Comparador" });

      // Only add mainland airlines if neither origin nor destination is Canary Islands
      if (!isCanaryFlight) {
        links.push({ label: "Vueling", url: buildVuelingUrl(c.airport || "", dest.airport || "", activity.startDate, activity.endDate), icon: "✈️", desc: "Directo" });
        links.push({ label: "Iberia", url: buildIberiaUrl(c.airport || "", dest.airport || "", activity.startDate, activity.endDate), icon: "🇪🇸", desc: "Directo" });
      }
      if (normalizeRegion(activity.r) === "Islas Canarias") {
        links.push({ label: "CICAR", url: buildRentACarUrl("cicar", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      } else {
        links.push({ label: "OK Mobility", url: buildRentACarUrl("okmobility", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      }
    } else if (transportType === "tren") {
      links.push({ label: "Trainline", url: buildTrainlineUrl(originCity, destCity, activity.startDate || activity.f), icon: "🔍", desc: "Comparador" });
      links.push({ label: "Renfe", url: buildRenfeUrl(c.station, dest.station, activity.startDate || activity.f), icon: "🚄", desc: "AVE / Avlo" });
      links.push({ label: "Iryo", url: buildIryoUrl(originCity, destCity, activity.startDate || activity.f), icon: "🟣", desc: "Alta Velocidad" });
      links.push({ label: "OK Mobility", url: buildRentACarUrl("okmobility", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
    } else {
      links.push({ label: "Google Maps", url: buildGMapsUrl(originCity, `${activity.e} ${destCity}`), icon: "🗺️", desc: "Ruta" });
      if (normalizeRegion(activity.r) === "Islas Canarias") {
        links.push({ label: "CICAR", url: buildRentACarUrl("cicar", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      } else {
        links.push({ label: "OK Mobility", url: buildRentACarUrl("okmobility", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      }
    }
    return links;
  }, [transportType, c, dest, activity]);

  const openModal = (e, link) => {
    e.preventDefault();
    window.open(link.url, "_blank", "noopener,noreferrer");
    const dual = !isSingleProvider(link.label);
    setActiveBookingUrl(link.url);
    setActiveBookingLabel(link.label);
    setIsDualMode(dual);
    setLocatorIda("");
    setLocatorVuelta("");
    // Convert to YYYY-MM-DD for the HTML date input
    setDateIda(toInputDate(panelStartDate));
    setDateVuelta(toInputDate(panelEndDate));
    setSubmitAttempted(false);
  };

  const closeModal = () => {
    setActiveBookingUrl(null);
    setSubmitAttempted(false);
  };

  const confirmBooking = () => {
    setSubmitAttempted(true);
    if (!locatorIda.trim()) return;
    if (isDualMode && !locatorVuelta.trim()) return;

    const isCar = isCarProvider(activeBookingLabel);
    const segments = [];
    // Store display date (DD/MM/YYYY) for consistency with the rest of the app
    segments.push({ type: isCar ? "recogida" : "ida", date: toDisplayDate(dateIda) || panelStartDate, locator: locatorIda.trim() });
    if (isDualMode && locatorVuelta.trim()) {
      segments.push({ type: isCar ? "devolución" : "vuelta", date: toDisplayDate(dateVuelta) || panelEndDate, locator: locatorVuelta.trim() });
    }

    if (onMarkBooked) onMarkBooked(activeBookingUrl, { locator: segments[0].locator, segments });
    closeModal();
  };

  const handleSendEmail = () => {
    const email = c.email || "";
    const hotelsList = (establishments || [activity.e]).join(" / ");
    const date = activity.startDate || activity.f;
    const entries = Object.entries(bookedLinks);
    if (entries.length === 0) { alert("No hay reservas confirmadas para enviar."); return; }
    const subject = `Reserva Logística: ${hotelsList} - ${date}`;
    let body = `Hola ${consultant},\n\nReservas para: ${hotelsList} (${date}):\n\n`;
    entries.forEach(([url, data]) => {
      const label = directLinks.find(l => l.url === url)?.label || "Proveedor";
      (data?.segments || [{ type: data?.type || "ida", locator: data?.locator || data, date: data?.date || "" }]).forEach(seg => {
        body += `• ${label} (${seg.type}): Loc. ${seg.locator} - ${seg.date}\n`;
      });
    });
    body += `\n¡Buen viaje!`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const hotelLabel = useMemo(() => establishments.length === 1 ? "1 hotel" : `${establishments.length} hoteles`, [establishments]);
  const modalIsCar = isCarProvider(activeBookingLabel);
  const modalIcon = modalIsCar ? "🚗" : (activeBookingLabel?.includes("Renfe") || activeBookingLabel?.includes("Iryo") || activeBookingLabel?.includes("Trainline")) ? "🚄" : "✈️";

  // Accommodation hotels: find matches for the destination zone
  const destZone = activity.destMuni || activity.r || "";
  const accomHotels = useMemo(() => {
    const matched = [];

    if (accommodationHotels && Object.keys(accommodationHotels).length > 0) {
      const destNorm = destZone.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      // Try to find zones that partially match the destination
      Object.entries(accommodationHotels).forEach(([zone, hotels]) => {
        const zoneNorm = zone.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (destNorm.includes(zoneNorm) || zoneNorm.includes(destNorm) ||
          (activity.r && activity.r.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(zoneNorm))) {
          hotels.forEach(h => matched.push({ ...h, zona: zone }));
        }
      });
    }

    // Unique by name to avoid duplicates
    return Array.from(new Map(matched.map(item => [item.hotel, item])).values());
  }, [accommodationHotels, destZone, activity.r]);

  // All zones for manual zone selector
  const allZones = useMemo(() => Object.keys(accommodationHotels || {}).sort(), [accommodationHotels]);
  const [selectedZone, setSelectedZone] = useState("");

  const hotelsToShow = useMemo(() => {
    if (selectedZone) {
      // If a DB zone is selected, show that zone's hotels
      const dbOptions = (accommodationHotels[selectedZone] || []).map(h => ({ ...h, zona: selectedZone }));
      return Array.from(new Map(dbOptions.map(item => [item.hotel, item])).values());
    }
    return accomHotels;
  }, [selectedZone, accommodationHotels, accomHotels]);

  // Single hotel selector + locator (replaces per-hotel list)
  const [selectedHotel, setSelectedHotel] = useState(null); // { hotel, zona, ubicacion }
  const [accomLocator, setAccomLocator] = useState("");
  const [accomDate, setAccomDate] = useState(() => toInputDate(groupStartDate || activity.startDate || activity.f) || "");

  // Form to add a new hotel manually to DB
  const [addingHotel, setAddingHotel] = useState(false);
  const [newHotelName, setNewHotelName] = useState("");
  const [newHotelUrl, setNewHotelUrl] = useState("");

  // Auto-select first hotel when zone matches change
  useEffect(() => {
    if (hotelsToShow.length > 0 && !selectedHotel) {
      setSelectedHotel(hotelsToShow[0]);
    } else if (hotelsToShow.length > 0 && selectedHotel && !hotelsToShow.some(h => h.hotel === selectedHotel.hotel)) {
      setSelectedHotel(hotelsToShow[0]);
    }
  }, [hotelsToShow]);

  const accomAlreadySaved = bookedLinks["__accom__"];

  const handleSaveAccom = () => {
    if (!selectedHotel) return;
    const data = {
      hotel: selectedHotel.hotel,
      zona: selectedHotel.zona,
      ubicacion: selectedHotel.ubicacion || "",
      locator: accomLocator.trim(),
      date: toDisplayDate(accomDate) || panelStartDate,
      type: "alojamiento"
    };
    if (onMarkBooked) onMarkBooked("__accom__", data);
  };

  return (
    <>
      {/* ========== LOCATOR ENTRY MODAL (z-index 3000, on top of everything) ========== */}
      {activeBookingUrl && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "white", borderRadius: 28, maxWidth: 460, width: "100%", padding: 36, boxShadow: "0 40px 100px rgba(0,0,0,0.6)", textAlign: "center" }}>
            <div style={{ width: 76, height: 76, background: "#EEF2FF", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, margin: "0 auto 20px" }}>
              {modalIcon}
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111", margin: "0 0 4px" }}>Confirmar Reserva</h2>
            <p style={{ fontSize: 15, color: "#0060AA", fontWeight: 700, margin: "0 0 6px" }}>{activeBookingLabel}</p>
            <p style={{ color: "#888", fontSize: 13, margin: "0 0 24px" }}>
              Introduce los detalles de la reserva realizada.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
              {/* IDA */}
              <div style={{ background: "#F8FAFC", padding: 18, borderRadius: 16, border: `2px solid ${submitAttempted && !locatorIda.trim() ? "#EF4444" : "#E2E8F0"}` }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                  {modalIsCar ? "🏁 Recogida" : "✈️ Ida / Trayecto"} <span style={{ color: "#EF4444" }}>*</span>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4 }}>Fecha</div>
                    <input
                      type="date"
                      value={dateIda}
                      onChange={e => setDateIda(e.target.value)}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "2px solid #E2E8F0", fontSize: 13, fontWeight: 600, boxSizing: "border-box", background: "#111", color: "white" }}
                    />
                  </div>
                  <div style={{ flex: 2 }}>
                    <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4 }}>Localizador <span style={{ color: "#EF4444" }}>*</span></div>
                    <input
                      type="text"
                      value={locatorIda}
                      onChange={e => setLocatorIda(e.target.value.toUpperCase())}
                      placeholder="Código"
                      autoFocus
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `2px solid ${submitAttempted && !locatorIda.trim() ? "#EF4444" : "#E2E8F0"}`, fontSize: 18, fontWeight: 800, textAlign: "center", color: "white", background: "#111", boxSizing: "border-box", letterSpacing: 4 }}
                    />
                    {submitAttempted && !locatorIda.trim() && <div style={{ color: "#EF4444", fontSize: 10, marginTop: 3 }}>Campo obligatorio</div>}
                  </div>
                </div>
              </div>

              {/* VUELTA */}
              {isDualMode && (
                <div style={{ background: "#F8FAFC", padding: 18, borderRadius: 16, border: `2px solid ${submitAttempted && !locatorVuelta.trim() ? "#EF4444" : "#E2E8F0"}` }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                    {modalIsCar ? "🔄 Devolución" : "✈️ Vuelta / Regreso"} <span style={{ color: "#EF4444" }}>*</span>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4 }}>Fecha</div>
                      <input
                        type="date"
                        value={dateVuelta}
                        onChange={e => setDateVuelta(e.target.value)}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "2px solid #E2E8F0", fontSize: 13, fontWeight: 600, boxSizing: "border-box", background: "#111", color: "white" }}
                      />
                    </div>
                    <div style={{ flex: 2 }}>
                      <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4 }}>Localizador <span style={{ color: "#EF4444" }}>*</span></div>
                      <input
                        type="text"
                        value={locatorVuelta}
                        onChange={e => setLocatorVuelta(e.target.value.toUpperCase())}
                        placeholder="Código"
                        style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `2px solid ${submitAttempted && !locatorVuelta.trim() ? "#EF4444" : "#E2E8F0"}`, fontSize: 18, fontWeight: 800, textAlign: "center", color: "white", background: "#111", boxSizing: "border-box", letterSpacing: 4 }}
                      />
                      {submitAttempted && !locatorVuelta.trim() && <div style={{ color: "#EF4444", fontSize: 10, marginTop: 3 }}>Campo obligatorio</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={confirmBooking}
              style={{ width: "100%", padding: "16px", background: "linear-gradient(135deg, #10B981, #059669)", color: "white", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: "pointer", marginTop: 24, boxShadow: "0 4px 20px rgba(16,185,129,0.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
            >
              ✅ Confirmar y Guardar
            </button>
            <button
              onClick={closeModal}
              style={{ width: "100%", padding: "14px", background: "white", color: "#6B7280", border: "2px solid #E5E7EB", borderRadius: 14, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 10 }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ========== MAIN BOOKING PANEL ========== */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(5px)" }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
          <div style={{ background: TRANSPORT_META[transportType]?.bg, padding: "24px", borderBottom: `1px solid ${TRANSPORT_META[transportType]?.color}20` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, color: TRANSPORT_META[transportType]?.color, fontSize: 22, fontWeight: 700 }}>{TRANSPORT_META[transportType]?.icon} Gestión de {TRANSPORT_META[transportType]?.label}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <div style={{ background: "rgba(255,255,255,0.7)", padding: "4px 10px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#111" }}>👤 {consultant}</div>
                  <div style={{ color: TRANSPORT_META[transportType]?.color, fontWeight: 900 }}>→</div>
                  {(establishments || [activity.e]).map((h, i) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.7)", padding: "4px 10px", borderRadius: 8, fontSize: 13, fontWeight: 800, color: "#111" }}>🏨 {h}</div>
                  ))}
                  <div style={{ background: "rgba(255,255,255,0.7)", padding: "4px 10px", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>📅 {panelStartDate} → {panelEndDate}</div>
                </div>
              </div>
              <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", padding: 5, color: "#666" }}>&times;</button>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>
              Pulsa un proveedor para <strong>abrir su web y registrar el localizador</strong>. Puedes confirmar varios (vuelo + coche + hotel) de forma independiente.
            </p>

            {/* ===== ACCOMMODATION HOTELS SECTION ===== */}
            <div style={{ marginBottom: 24, background: accomAlreadySaved ? "#F0FDF4" : "#F0F9FF", borderRadius: 16, padding: 20, border: `1px solid ${accomAlreadySaved ? "#4ADE80" : "#BAE6FD"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: accomAlreadySaved ? "#15803D" : "#0369A1" }}>
                  {accomAlreadySaved ? "✅ Hotel Alojamiento Confirmado" : "🏨 Hotel de Alojamiento"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {accomHotels.length > 0 && !selectedZone && (
                    <span style={{ fontSize: 11, color: "#0369A1", background: "#E0F2FE", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>
                      {accomHotels.length} opciones para {destZone}
                    </span>
                  )}
                  <select
                    value={selectedZone}
                    onChange={e => { setSelectedZone(e.target.value); setSelectedHotel(null); }}
                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 8, border: "1px solid #BAE6FD", background: "white", color: "#0369A1", fontWeight: 600, cursor: "pointer" }}
                  >
                    <option value="">{accomHotels.length > 0 ? `Auto: ${destZone}` : "Seleccionar zona…"}</option>
                    {allZones.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
              </div>

              {/* Already saved - show summary */}
              {accomAlreadySaved && (
                <div style={{ background: "white", borderRadius: 10, padding: "10px 14px", border: "1px solid #BBF7D0", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🏨</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: "#15803D" }}>{accomAlreadySaved.hotel}</div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>{accomAlreadySaved.zona} · {accomAlreadySaved.date}</div>
                  </div>
                  {accomAlreadySaved.locator && (
                    <div style={{ fontWeight: 800, fontSize: 15, color: "#0D4BD9", letterSpacing: 2 }}>{accomAlreadySaved.locator}</div>
                  )}
                  {accomAlreadySaved.ubicacion && (
                    <a href={accomAlreadySaved.ubicacion} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#0369A1", background: "#E0F2FE", padding: "4px 8px", borderRadius: 6, textDecoration: "none" }}
                    >🗺️ Maps</a>
                  )}
                  <button onClick={(e) => { e.preventDefault(); if (confirm("¿Eliminar reserva de hotel?")) onMarkBooked("__accom__", null); }} style={{ background: "transparent", border: "none", color: "#EF4444", fontSize: 16, cursor: "pointer", padding: 0, marginLeft: "auto" }} title="Eliminar hotel">🗑️</button>
                </div>
              )}

              {/* Hotel selector */}
              {hotelsToShow.length === 0 && !addingHotel ? (
                <div style={{ fontSize: 12, color: "#64748B", textAlign: "center", padding: "12px 0", display: "flex", flexDirection: "column", gap: 10 }}>
                  <span>No hay hoteles para esta zona. Usa el selector para buscar por ciudad o añade uno nuevo.</span>
                  <button
                    onClick={() => setAddingHotel(true)}
                    style={{ background: "#EEF2FF", color: "#4F46E5", border: "1px dashed #A5B4FC", padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", maxWidth: 220, margin: "0 auto", transition: "all 0.2s" }}
                  >
                    ➕ Añadir nuevo hotel
                  </button>
                </div>
              ) : hotelsToShow.length === 0 && addingHotel ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, border: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 8, textTransform: "uppercase" }}>Nuevo Hotel en {selectedZone || destZone}</div>
                    <input
                      value={newHotelName}
                      onChange={e => setNewHotelName(e.target.value)}
                      placeholder="Nombre del hotel..."
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: 13, boxSizing: "border-box", marginBottom: 8 }}
                    />
                    <input
                      value={newHotelUrl}
                      onChange={e => setNewHotelUrl(e.target.value)}
                      placeholder="URL Maps (opcional)..."
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: 13, boxSizing: "border-box", marginBottom: 12 }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => {
                          const zone = (selectedZone || destZone).trim().toUpperCase();
                          const hotel = newHotelName.trim();
                          if (!zone || !hotel) {
                            alert("El nombre del hotel es obligatorio.");
                            return;
                          }
                          const updated = { ...accommodationHotels };
                          if (!updated[zone]) updated[zone] = [];
                          if (updated[zone].some(x => x.hotel.toLowerCase() === hotel.toLowerCase())) {
                            alert("Ese hotel ya existe en la zona.");
                            return;
                          }
                          updated[zone] = [...updated[zone], { hotel, ubicacion: newHotelUrl.trim() }];
                          if (onUpdateAccommodationHotels) onUpdateAccommodationHotels(updated);
                          setAddingHotel(false);
                          setNewHotelName("");
                          setNewHotelUrl("");
                          setTimeout(() => {
                            setSelectedHotel({ hotel, zona: zone, ubicacion: newHotelUrl.trim() });
                          }, 100);
                        }}
                        style={{ flex: 1, padding: "8px", background: "#10B981", color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                      >Guardar</button>
                      <button onClick={() => setAddingHotel(false)} style={{ flex: 1, padding: "8px", background: "white", color: "#64748B", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  {/* Radio-style hotel picker */}
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Seleccionar hotel:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                    {hotelsToShow.map((h, i) => {
                      const isSelected = selectedHotel?.hotel === h.hotel;
                      return (
                        <div
                          key={i}
                          onClick={() => setSelectedHotel(h)}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                            background: isSelected ? "#EFF6FF" : "white",
                            border: `2px solid ${isSelected ? "#3B82F6" : "#E2E8F0"}`,
                            borderRadius: 10, cursor: "pointer", transition: "all 0.15s"
                          }}
                        >
                          <div style={{
                            width: 18, height: 18, borderRadius: "50%",
                            border: `2px solid ${isSelected ? "#3B82F6" : "#CBD5E1"}`,
                            background: isSelected ? "#3B82F6" : "white",
                            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center"
                          }}>
                            {isSelected && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "white" }} />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: "#1E293B" }}>{h.hotel}</div>
                            <div style={{ fontSize: 11, color: "#64748B" }}>📍 {h.zona}</div>
                          </div>
                          {h.ubicacion && (
                            <a href={h.ubicacion} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ fontSize: 11, color: "#0369A1", fontWeight: 600, background: "#E0F2FE", padding: "3px 8px", borderRadius: 6, textDecoration: "none", whiteSpace: "nowrap" }}
                            >🗺️ Maps</a>
                          )}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (confirm(`¿Eliminar de la base de datos de manera permanente el hotel ${h.hotel}?`)) {
                                const updated = { ...accommodationHotels };
                                const z = h.zona;
                                if (updated[z]) {
                                  updated[z] = updated[z].filter(x => x.hotel !== h.hotel);
                                  if (updated[z].length === 0) delete updated[z];
                                  if (onUpdateAccommodationHotels) onUpdateAccommodationHotels(updated);
                                  if (selectedHotel?.hotel === h.hotel) setSelectedHotel(null);
                                }
                              }
                            }}
                            style={{ background: 'transparent', border: 'none', color: '#CBD5E1', fontSize: 15, cursor: 'pointer', padding: '2px 4px', flexShrink: 0, transition: 'color 0.2s', marginLeft: 4 }}
                            onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                            onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                            title="Eliminar hotel base de datos"
                          >🗑️</button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add manual hotel form */}
                  <div style={{ marginBottom: 14 }}>
                    {!addingHotel ? (
                      <button
                        onClick={() => setAddingHotel(true)}
                        style={{ background: "transparent", color: "#475569", border: "1px dashed #CBD5E1", padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", width: "100%", textAlign: "center", transition: "all 0.2s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        ➕ Añadir nuevo hotel a BD...
                      </button>
                    ) : (
                      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 8, textTransform: "uppercase" }}>Nuevo Hotel en {selectedZone || destZone}</div>
                        <input
                          value={newHotelName}
                          onChange={e => setNewHotelName(e.target.value)}
                          placeholder="Nombre del hotel..."
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: 13, boxSizing: "border-box", marginBottom: 8 }}
                        />
                        <input
                          value={newHotelUrl}
                          onChange={e => setNewHotelUrl(e.target.value)}
                          placeholder="URL Maps (opcional)..."
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: 13, boxSizing: "border-box", marginBottom: 12 }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => {
                              const zone = (selectedZone || destZone).trim().toUpperCase();
                              const hotel = newHotelName.trim();
                              if (!zone || !hotel) {
                                alert("El nombre del hotel es obligatorio.");
                                return;
                              }
                              const updated = { ...accommodationHotels };
                              if (!updated[zone]) updated[zone] = [];
                              if (updated[zone].some(x => x.hotel.toLowerCase() === hotel.toLowerCase())) {
                                alert("Ese hotel ya existe en la zona.");
                                return;
                              }
                              updated[zone] = [...updated[zone], { hotel, ubicacion: newHotelUrl.trim() }];
                              if (onUpdateAccommodationHotels) onUpdateAccommodationHotels(updated);
                              setAddingHotel(false);
                              setNewHotelName("");
                              setNewHotelUrl("");
                              // Select it automatically
                              setTimeout(() => {
                                setSelectedHotel({ hotel, zona: zone, ubicacion: newHotelUrl.trim() });
                              }, 100);
                            }}
                            style={{ flex: 1, padding: "8px", background: "#10B981", color: "white", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                          >Guardar</button>
                          <button onClick={() => setAddingHotel(false)} style={{ flex: 1, padding: "8px", background: "white", color: "#64748B", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Locator + date + save */}
                  {selectedHotel && (
                    <div style={{ background: "white", borderRadius: 12, padding: "14px", border: "1px solid #DBEAFE", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4 }}>Fecha entrada</div>
                        <input
                          type="date"
                          value={accomDate}
                          onChange={e => setAccomDate(e.target.value)}
                          style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: 12, fontWeight: 600, boxSizing: "border-box", background: "#111", color: "white" }}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 130 }}>
                        <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4 }}>Localizador (opcional)</div>
                        <input
                          type="text"
                          value={accomLocator}
                          onChange={e => setAccomLocator(e.target.value.toUpperCase())}
                          placeholder="Nº reserva"
                          style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: 14, fontWeight: 800, letterSpacing: 2, textAlign: "center", background: "#111", color: "white", boxSizing: "border-box" }}
                        />
                      </div>
                      <button
                        onClick={handleSaveAccom}
                        style={{ padding: "9px 18px", background: "linear-gradient(135deg, #0369A1, #0284C7)", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                      >
                        🏨 Guardar Hotel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))", gap: 14, marginBottom: 24 }}>
              {directLinks.map((l, i) => {
                const booking = bookedLinks[l.url];
                const isBooked = !!booking;
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <a
                      href={l.url}
                      onClick={(e) => openModal(e, l)}
                      style={{
                        display: "flex", flexDirection: "column", gap: 6, padding: "16px 14px",
                        background: isBooked ? "#F0FDF4" : "white",
                        border: `2px solid ${isBooked ? "#4ADE80" : "#E2E8F0"}`,
                        borderRadius: 14, textDecoration: "none", cursor: "pointer",
                        position: "relative",
                        boxShadow: isBooked ? "0 0 0 4px rgba(74,222,128,0.15)" : "0 2px 6px rgba(0,0,0,0.05)"
                      }}
                    >
                      {isBooked && (
                        <div style={{ position: "absolute", top: -10, right: -10, background: "#10B981", color: "white", borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, boxShadow: "0 2px 8px rgba(16,185,129,0.5)" }}>✓</div>
                      )}
                      <div style={{ fontSize: 28 }}>{l.icon}</div>
                      <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 14 }}>{l.label}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{l.desc}</div>
                      {!isBooked && <div style={{ marginTop: 4, fontSize: 11, color: "#3B82F6", fontWeight: 600 }}>👉 Pulsar para reservar</div>}
                    </a>

                    {isBooked && (
                      <div style={{ background: "#ECFDF5", borderRadius: 10, padding: "8px 10px", border: "1px solid #A7F3D0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ fontWeight: 800, color: "#065F46", fontSize: 10 }}>✅ RESERVADO</div>
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (confirm("¿Eliminar reserva?")) onMarkBooked(l.url, null); }} style={{ background: "transparent", border: "none", color: "#EF4444", fontSize: 14, cursor: "pointer", padding: 0 }} title="Eliminar reserva">🗑️</button>
                        </div>
                        {(booking.segments || [{ type: booking.type || "ida", locator: booking.locator, date: booking.date }]).map((seg, si) => (
                          <div key={si} style={{ display: "flex", justifyContent: "space-between", color: "#047857", fontSize: 11 }}>
                            <span style={{ textTransform: "capitalize" }}>{seg.type}:</span>
                            <span style={{ fontWeight: 800, letterSpacing: 1 }}>{seg.locator}</span>
                          </div>
                        ))}
                        <button
                          onClick={(e) => { e.preventDefault(); openModal({ preventDefault: () => { } }, l); }}
                          style={{ marginTop: 6, background: "white", border: "1px solid #A7F3D0", borderRadius: 6, padding: "3px 8px", fontSize: 10, cursor: "pointer", color: "#065F46", width: "100%" }}
                        >✏️ Modificar</button>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={() => {
                  setActiveBookingUrl("manual_" + Date.now());
                  setActiveBookingLabel("Entrada Manual");
                  setIsDualMode(true);
                  setLocatorIda(""); setLocatorVuelta("");
                  setDateIda(panelStartDate); setDateVuelta(panelEndDate);
                  setSubmitAttempted(false);
                }}
                style={{ display: "flex", flexDirection: "column", gap: 8, padding: "20px 14px", background: "#F8FAFC", border: "2px dashed #CBD5E1", borderRadius: 14, cursor: "pointer", alignItems: "center", justifyContent: "center", color: "#64748B", minHeight: 130 }}
              >
                <span style={{ fontSize: 28 }}>✍️</span>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Otra Reserva</div>
                <div style={{ fontSize: 10, textAlign: "center", lineHeight: 1.4 }}>Proveedor externo / manual</div>
              </button>
            </div>

            <div style={{ background: "#F8FAFC", padding: "16px 20px", borderRadius: 14, display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 13, color: "#555" }}>
                <span style={{ fontWeight: 700 }}>{Object.keys(bookedLinks).length}</span> reserva(s) · {hotelLabel}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => {
                    if (onForceFinalize) onForceFinalize();
                    onClose();
                  }}
                  style={{ background: "#10B981", color: "white", border: "none", padding: "10px 20px", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >💾 Guardar Gestión</button>
                <button
                  onClick={() => {
                    if (onForceFinalize) onForceFinalize();
                    handleSendEmail();
                    onClose();
                  }}
                  disabled={Object.keys(bookedLinks).length === 0}
                  style={{ background: Object.keys(bookedLinks).length === 0 ? "#CBD5E0" : "#0060AA", color: "white", border: "none", padding: "10px 20px", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: Object.keys(bookedLinks).length === 0 ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >📩 Notificar Consultor</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// AUXILIARY COMPONENTS
// ============================================================

// ============================================================
// CALENDAR VIEW COMPONENT
// ============================================================
function CalendarView({ activities, initialConsultant, allConsultants, bookedLinks, onBack }) {
  const [selectedConsultant, setSelectedConsultant] = useState(initialConsultant || "");

  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date) => {
    const day = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    return day === 0 ? 6 : day - 1; // Mon=0, Sun=6
  };

  const dayCount = getDaysInMonth(currentMonth);
  const startOffset = getFirstDayOfMonth(currentMonth);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);
  const blanks = Array.from({ length: startOffset }, (_, i) => i);

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const monthLabel = currentMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const monthName = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  // Helper to extract company from URL
  const getCompanyName = (url) => {
    if (!url) return "Proveedor";
    const lower = url.toLowerCase();
    if (lower.includes("binter")) return "Binter";
    if (lower.includes("vueling")) return "Vueling";
    if (lower.includes("iberia")) return "Iberia";
    if (lower.includes("renfe")) return "Renfe";
    if (lower.includes("iryo")) return "Iryo";
    if (lower.includes("trainline")) return "Trainline";
    if (lower.includes("cicar")) return "Cicar";
    if (lower.includes("goldcar")) return "Goldcar";
    if (lower.includes("okmobility")) return "OK Mobility";
    if (lower.includes("europcar")) return "Europcar";
    if (lower.includes("skyscanner")) return "Skyscanner";
    if (lower.includes("google")) return "Google";
    return "Compañía";
  };

  // FILTERING LOGIC
  const filteredActivities = useMemo(() => {
    if (!selectedConsultant) return activities;
    return activities.filter(a => (a.a || "").trim() === selectedConsultant);
  }, [activities, selectedConsultant]);

  const eventsByDay = useMemo(() => {
    const map = {};
    filteredActivities.forEach(act => {
      const [d, m, y] = act.f.split("/");
      const actDate = new Date(y, m - 1, d);

      if (actDate.getMonth() === currentMonth.getMonth() && actDate.getFullYear() === currentMonth.getFullYear()) {
        const day = parseInt(d, 10);
        if (!map[day]) map[day] = [];

        const links = bookedLinks[act.id] || {};
        const linkEntries = Object.entries(links);

        if (linkEntries.length > 0) {
          // Add booked trips
          linkEntries.forEach(([url, data]) => {
            const company = getCompanyName(url);
            let segments = [];

            if (data && data.segments) segments = data.segments;
            else if (typeof data === 'object') segments = [{ type: data.type || 'ida', locator: data.locator, date: data.date }];
            else segments = [{ type: act.tType === 'auto' ? 'recogida' : 'ida', locator: data, date: act.f }];

            segments.forEach(seg => {
              const icon = (act.tType === "tren") ? "🚄" : (act.tType === "auto" ? "🚗" : "✈️");
              map[day].push({
                isBooking: true,
                consultant: act.a, // Consultant Name
                region: act.r || act.island || "General", // Expedition/Region
                hotel: act.e, // Hotel to visit
                icon,
                company,
                type: seg.type,
                locator: seg.locator,
                date: seg.date,
                color: TRANSPORT_META[act.tType]?.color || "#333",
                bg: TRANSPORT_META[act.tType]?.bg || "#eee"
              });
            });
          });
        } else if (["vuelo", "tren", "auto"].includes(act.tType)) {
          // Add unbooked plan (pending)
          map[day].push({
            isBooking: false,
            consultant: act.a, // Consultant Name
            region: act.r || act.island || "General", // Expedition/Region
            hotel: act.e, // Hotel to visit
            icon: TRANSPORT_META[act.tType]?.icon,
            title: act.e,
            desc: "Pendiente Reserva",
            color: "#999",
            bg: "#f3f4f6"
          });
        }
      }
    });
    return map;
  }, [filteredActivities, currentMonth, bookedLinks]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {onBack && <button onClick={onBack} style={{ background: "white", border: "1px solid #ddd", width: 40, height: 40, borderRadius: 12, cursor: "pointer", fontSize: 18 }}>←</button>}
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: "#111" }}>Calendario de Viajes</h2>
            <div style={{ marginTop: 8 }}>
              <select
                value={selectedConsultant}
                onChange={(e) => setSelectedConsultant(e.target.value)}
                style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13, minWidth: 200 }}
              >
                <option value="">TODOS LOS CONSULTORES</option>
                {allConsultants.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={prevMonth} style={{ background: "white", border: "1px solid #ddd", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>&lt;</button>
          <div style={{ fontSize: 18, fontWeight: 800, minWidth: 160, textAlign: "center" }}>{monthName}</div>
          <button onClick={nextMonth} style={{ background: "white", border: "1px solid #ddd", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>&gt;</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
        {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map(d => (
          <div key={d} style={{ textAlign: "center", fontWeight: 700, color: "#94A3B8", fontSize: 11, textTransform: "uppercase", paddingBottom: 8 }}>{d}</div>
        ))}

        {blanks.map(i => <div key={`blank-${i}`} style={{ minHeight: 120 }}></div>)}

        {days.map(day => {
          const events = eventsByDay[day] || [];
          return (
            <div key={day} style={{ background: "white", borderRadius: 12, minHeight: 140, border: "1px solid #E2E8F0", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: events.length > 0 ? "#111" : "#cbd5e1", marginBottom: 4 }}>{day}</div>
              {events.map((ev, idx) => (
                <div key={idx} style={{ background: ev.bg, borderRadius: 6, padding: "6px 8px", fontSize: 11, borderLeft: `3px solid ${ev.color}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: "#111", fontSize: 10 }}>👤 {ev.consultant}</span>
                  </div>

                  {ev.isBooking ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, color: ev.color }}>{ev.icon} {ev.company}</span>
                      </div>
                      <div style={{ color: "#333", fontSize: 10, marginBottom: 2 }}>Loc: <strong>{ev.locator}</strong></div>

                      {/* Destination/Hotel Context */}
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed rgba(0,0,0,0.1)", fontSize: 10, color: "#555" }}>
                        <div>📍 {ev.region}</div>
                        <div style={{ fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>🏨 {ev.hotel}</div>
                      </div>

                      <div style={{ color: "#666", fontSize: 9, marginTop: 4 }}>
                        {ev.type === 'ida' ? '🛫 Ida' : ev.type === 'vuelta' ? '🛬 Vuelta' : ev.type === 'recogida' ? '🏁 Recogida' : '🔄 Devolución'}
                        {ev.date && <span style={{ float: 'right' }}>{ev.date.split(" ")[1]}</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ color: "#555", fontStyle: "italic", fontWeight: 600 }}>
                        {ev.icon} {ev.title}
                      </div>
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed rgba(0,0,0,0.1)", fontSize: 10, color: "#555" }}>
                        <div>📍 {ev.region}</div>
                        <div style={{ fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>🏨 {ev.hotel}</div>
                      </div>
                      <div style={{ fontSize: 9, color: "#999", marginTop: 2 }}>Pendiente Reserva</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConsultantList({ consultants, onUpdate, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", base: "Madrid", region: "Madrid", pref: "vehiculo", email: "", address: "", island: "" });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const filtered = useMemo(() => {
    return Object.entries(consultants).filter(([name, data]) => {
      const search = searchTerm.toLowerCase();
      return name.toLowerCase().includes(search) ||
        (data.base && data.base.toLowerCase().includes(search)) ||
        (data.email && data.email.toLowerCase().includes(search));
    }).sort((a, b) => a[0].localeCompare(b[0]));
  }, [consultants, searchTerm]);

  const startEdit = (name, data) => {
    setEditingId(name);
    setEditForm({ ...data });
  };

  const saveEdit = () => {
    onUpdate(editingId, editForm);
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  return (
    <div style={{ background: "white", borderRadius: 16, overflow: "hidden", border: "1px solid #eee", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" }}>
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "white", borderRadius: 20, maxWidth: 400, width: "100%", padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.2)", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🗑️</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111", margin: "0 0 12px" }}>¿Eliminar Consultor?</h2>
            <p style={{ fontSize: 14, color: "#4B5563", margin: "0 0 24px", lineHeight: 1.5 }}>
              Estás a punto de eliminar a <strong>{deleteTarget}</strong>. Esta acción no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{ flex: 1, padding: "10px", background: "#F3F4F6", color: "#4B5563", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onDelete(deleteTarget);
                  setDeleteTarget(null);
                }}
                style={{ flex: 1, padding: "10px", background: "#EF4444", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "white", borderRadius: 20, maxWidth: 500, width: "100%", padding: 30, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111", margin: "0 0 20px" }}>➕ Añadir Nuevo Consultor</h2>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#4B5563", marginBottom: 6 }}>Nombre Completo *</div>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D1D5DB", boxSizing: "border-box" }}
                  placeholder="Ej: Juan Pérez"
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ gridColumn: "span 2" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#4B5563", marginBottom: 6 }}>Dirección Completa</div>
                  <input
                    type="text"
                    value={addForm.address}
                    onChange={e => setAddForm({ ...addForm, address: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D1D5DB", boxSizing: "border-box" }}
                    placeholder="Ej: Calle Falsa 123, Madrid"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#4B5563", marginBottom: 6 }}>Región</div>
                  <select
                    value={addForm.region}
                    onChange={e => setAddForm({ ...addForm, region: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D1D5DB", boxSizing: "border-box" }}
                  >
                    <option value="Madrid">Madrid</option>
                    <option value="Islas Canarias">Islas Canarias</option>
                    <option value="Islas Baleares">Islas Baleares</option>
                    <option value="Cataluña">Cataluña</option>
                    <option value="Andalucía">Andalucía</option>
                    <option value="Valencia">Valencia</option>
                    <option value="Murcia">Murcia</option>
                    <option value="País Vasco">País Vasco</option>
                    <option value="Galicia">Galicia</option>
                    <option value="Asturias">Asturias</option>
                    <option value="Castilla y León">Castilla y León</option>
                    <option value="Desconocido">Otro</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#4B5563", marginBottom: 6 }}>Isla (si aplica)</div>
                  <input
                    type="text"
                    value={addForm.island}
                    onChange={e => setAddForm({ ...addForm, island: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D1D5DB", boxSizing: "border-box" }}
                    placeholder="Ej: Tenerife"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#4B5563", marginBottom: 6 }}>Mail</div>
                  <input
                    type="email"
                    value={addForm.email}
                    onChange={e => setAddForm({ ...addForm, email: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D1D5DB", boxSizing: "border-box" }}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ flex: 1, padding: "12px", background: "#F3F4F6", color: "#4B5563", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (addForm.name.trim()) {
                    onUpdate(addForm.name.trim(), { base: "", region: addForm.region, pref: addForm.pref, email: addForm.email, address: addForm.address, island: addForm.island });
                    setShowAddModal(false);
                    setAddForm({ name: "", base: "Madrid", region: "Madrid", pref: "vehiculo", email: "", address: "", island: "" });
                  } else {
                    alert("El nombre del consultor es obligatorio.");
                  }
                }}
                style={{ flex: 1, padding: "12px", background: "#10B981", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}
              >
                Validar y Añadir
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ padding: 20, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Gestión de Consultores ({filtered.length})</h3>
          <button
            onClick={() => setShowAddModal(true)}
            style={{ background: "#EEF2FF", color: "#4F46E5", border: "none", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            + Añadir Consultor
          </button>
        </div>
        <input
          type="text"
          placeholder="Buscar consultor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", width: 250 }}
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#f8f9fa", borderBottom: "1px solid #eee" }}>
            <tr>
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666", width: "20%" }}>Nombre</th>
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666", width: "25%" }}>Dirección</th>
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666", width: "25%" }}>Región / Isla</th>
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666", width: "20%" }}>Mail</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: "#666", width: "10%" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(([name, data]) => (
              <tr key={name} style={{ borderBottom: "1px solid #f0f0f0", background: editingId === name ? "#F9FAFB" : "white" }}>
                <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111" }}>{name}</td>

                {editingId === name ? (
                  <>
                    <td style={{ padding: 8 }}>
                      <input style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ddd" }} value={editForm.address || ""} onChange={e => setEditForm({ ...editForm, address: e.target.value })} placeholder="Dirección completa..." />
                    </td>
                    <td style={{ padding: 8 }}>
                      <select style={{ padding: 6, borderRadius: 4, border: "1px solid #ddd" }} value={editForm.region || ""} onChange={e => setEditForm({ ...editForm, region: e.target.value })}>
                        <option value="Madrid">Madrid</option>
                        <option value="Islas Canarias">Islas Canarias</option>
                        <option value="Islas Baleares">Islas Baleares</option>
                        <option value="Cataluña">Cataluña</option>
                        <option value="Andalucía">Andalucía</option>
                        <option value="Valencia">Valencia</option>
                        <option value="Murcia">Murcia</option>
                        <option value="País Vasco">País Vasco</option>
                        <option value="Galicia">Galicia</option>
                        <option value="Asturias">Asturias</option>
                        <option value="Castilla y León">Castilla y León</option>
                        <option value="Desconocido">Otro</option>
                      </select>
                    </td>
                    <td style={{ padding: 8 }}>
                      <input
                        style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ddd" }}
                        placeholder="Isla (si aplica)"
                        value={editForm.island || ""}
                        onChange={e => setEditForm({ ...editForm, island: e.target.value })}
                      />
                    </td>

                    <td style={{ padding: 8 }}><input style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ddd" }} value={editForm.email || ""} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></td>
                    <td style={{ padding: 8, textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                        <button onClick={saveEdit} style={{ background: "#10B981", color: "white", border: "none", padding: "6px 8px", borderRadius: 4, cursor: "pointer" }}>💾</button>
                        <button onClick={cancelEdit} style={{ background: "#6B7280", color: "white", border: "none", padding: "6px 8px", borderRadius: 4, cursor: "pointer" }}>✕</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#374151" }}>{data.address || "-"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ padding: "2px 8px", borderRadius: 12, background: "#f3f4f6", fontSize: 11, fontWeight: 500, display: "inline-block" }}>{data.region || "-"}</div>
                      {data.island && <div style={{ fontSize: 10, color: "#6B7280", marginTop: 4 }}>🏝️ {data.island}</div>}
                    </td>

                    <td style={{ padding: "12px 16px", color: "#374151", fontSize: 12 }}>
                      {data.email || "-"}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                        <button onClick={() => startEdit(name, data)} style={{ background: "white", color: "#4B5563", border: "1px solid #D1D5DB", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>✏️ Editar</button>
                        <button onClick={() => setDeleteTarget(name)} style={{ background: "white", color: "#EF4444", border: "1px solid #FEE2E2", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Eliminar</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function HSConsultingTravelPlanner() {
  // AUTH STATE
  const [authUser, setAuthUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Check existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      const session = await getCurrentSession();
      if (session?.user) {
        setAuthUser(session.user);
        const profile = await getUserProfile(session.user.id);
        setUserProfile(profile);
      }
      setAuthLoading(false);
    };
    initAuth();

    const subscription = onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setAuthUser(session.user);
        const profile = await getUserProfile(session.user.id);
        setUserProfile(profile);
      } else if (event === 'SIGNED_OUT') {
        setAuthUser(null);
        setUserProfile(null);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    const { user, error } = await signIn(loginEmail, loginPassword);
    setLoginLoading(false);
    if (error) {
      setLoginError(error);
    } else {
      setAuthUser(user);
      const profile = await getUserProfile(user.id);
      setUserProfile(profile);
    }
  };

  const handleLogout = async () => {
    await signOut();
    setAuthUser(null);
    setUserProfile(null);
  };

  // APP STATE - must be declared before any conditional returns (React Rules of Hooks)
  const [view, setView] = useState("dashboard");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [uploadFlash, setUploadFlash] = useState(null);
  const planningInputRef = useRef(null);
  const consultantInputRef = useRef(null);
  const hotelsInputRef = useRef(null);

  const [activities, setActivities] = useState(() => {
    const saved = localStorage.getItem("hs_travel_activities");
    return saved ? JSON.parse(saved) : [];
  });
  const [customConsultants, setCustomConsultants] = useState(() => {
    const saved = localStorage.getItem("hs_travel_consultants");
    return saved ? JSON.parse(saved) : null;
  });
  const activeConsultants = useMemo(() => customConsultants || CONSULTANTS, [customConsultants]);

  const [approvedIds, setApprovedIds] = useState(() => {
    const saved = localStorage.getItem("hs_travel_approved");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [bookedLinks, setBookedLinks] = useState(() => {
    const saved = localStorage.getItem("hs_travel_booked_links");
    return saved ? JSON.parse(saved) : {};
  });
  const [finalizedIds, setFinalizedIds] = useState(() => {
    const saved = localStorage.getItem("hs_travel_finalized");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Load managed activity IDs and activities from Supabase on mount
  useEffect(() => {
    async function loadManagedFromSupabase() {
      // 1. Load activities from Supabase if local is empty
      const localActs = JSON.parse(localStorage.getItem("hs_travel_activities") || "[]");
      if (localActs.length === 0) {
        const remoteActs = await getAllActivitiesFromDB();
        if (remoteActs && remoteActs.length > 0) {
          setActivities(remoteActs);
          console.log(`✅ Supabase: ${remoteActs.length} actividades cargadas desde la base de datos`);
        }
      }

      // 2. Load managed IDs from Supabase (always sync, Supabase is source of truth)
      const managedIds = await getManagedActivityIds();
      if (managedIds.length > 0) {
        setFinalizedIds(prev => {
          const merged = new Set(prev);
          managedIds.forEach(id => merged.add(id));
          return merged;
        });
        console.log(`✅ Supabase: ${managedIds.length} trayectos gestionados restaurados`);
      }

      // 3. Load booking confirmations from Supabase
      const remoteBookings = await getAllBookingConfirmations();
      if (Object.keys(remoteBookings).length > 0) {
        setBookingConfirmations(prev => {
          const merged = { ...prev, ...remoteBookings };
          return merged;
        });
        console.log(`✅ Supabase: ${Object.keys(remoteBookings).length} confirmaciones de reserva restauradas`);
      }

      // 4. Load consultants from Supabase (source of truth)
      const remoteConsultants = await getAllConsultants();
      if (remoteConsultants && Object.keys(remoteConsultants).length > 0) {
        setCustomConsultants(prev => {
          // Merge: Supabase takes precedence, but preserve any local-only entries
          const merged = { ...(prev || {}), ...remoteConsultants };
          return merged;
        });
        console.log(`✅ Supabase: ${Object.keys(remoteConsultants).length} consultores cargados desde la base de datos`);
      }
    }
    loadManagedFromSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [customClientInfo, setCustomClientInfo] = useState(() => {
    const saved = localStorage.getItem("hs_travel_client_info");
    return saved ? JSON.parse(saved) : {};
  });



  const [bookingConfirmations, setBookingConfirmations] = useState(() => {
    const saved = localStorage.getItem("hs_travel_bookings");
    return saved ? JSON.parse(saved) : {};
  });
  const [expandedId, setExpandedId] = useState(null);
  const [bookingTarget, setBookingTarget] = useState(null);
  const [showBulkGeocode, setShowBulkGeocode] = useState(false);
  const [showHotelsManager, setShowHotelsManager] = useState(false);
  const [pendingNewEstablishments, setPendingNewEstablishments] = useState(null); // { names: [...], regionMap: {...} }
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [accommodationHotels, setAccommodationHotels] = useState(() => {
    const saved = localStorage.getItem("hs_travel_accom_hotels");
    return saved ? JSON.parse(saved) : {};
  });

  const handleUpdateAccommodationHotels = useCallback(async (newHotels) => {
    setAccommodationHotels(newHotels);
    await syncAccommodationHotels(newHotels);
  }, []);

  // Load accommodation hotels from db on mount
  useEffect(() => {
    async function loadRemoteAccommodationHotels() {
      const remote = await getAllAccommodationHotels();
      if (remote && Object.keys(remote).length > 0) {
        setAccommodationHotels(remote);
      }
    }
    loadRemoteAccommodationHotels();
  }, []);
  const [filterAuditor, setFilterAuditor] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterTransport, setFilterTransport] = useState("viaje");
  const [filterDateStart, setFilterDateStart] = useState("");
  const [filterDateEnd, setFilterDateEnd] = useState("");
  const [geocodeResults, setGeocodeResults] = useState({}); // {proposalId: {results, loading, error, selected, editing} }

  const [realDistances, setRealDistances] = useState(() => {
    const saved = localStorage.getItem("hs_travel_real_distances");
    return saved ? JSON.parse(saved) : {};
  });
  const [calculatingDistances, setCalculatingDistances] = useState(false);

  useEffect(() => {
    localStorage.setItem("hs_travel_real_distances", JSON.stringify(realDistances));
    // Hydrate sync cache
    Object.assign(DISTANCE_CACHE, realDistances);
  }, [realDistances]);

  // Load distances from Supabase on mount
  useEffect(() => {
    async function loadRemoteDistances() {
      const remote = await getAllDistances();
      if (remote && Object.keys(remote).length > 0) {
        setRealDistances(prev => {
          const next = { ...prev, ...remote };
          // Update cache immediately
          Object.assign(DISTANCE_CACHE, next);
          return next;
        });
      }
    }
    loadRemoteDistances();
  }, []);


  // Persistence Saving
  useEffect(() => {
    localStorage.setItem("hs_travel_activities", JSON.stringify(activities));
  }, [activities]);
  useEffect(() => {
    if (customConsultants) {
      localStorage.setItem("hs_travel_consultants", JSON.stringify(customConsultants));
    }
  }, [customConsultants]);
  useEffect(() => {
    localStorage.setItem("hs_travel_approved", JSON.stringify([...approvedIds]));
  }, [approvedIds]);
  useEffect(() => {
    localStorage.setItem("hs_travel_finalized", JSON.stringify([...finalizedIds]));
  }, [finalizedIds]);
  // New persistence for booked links
  useEffect(() => {
    localStorage.setItem("hs_travel_booked_links", JSON.stringify(bookedLinks));
  }, [bookedLinks]);
  useEffect(() => {
    localStorage.setItem("hs_travel_client_info", JSON.stringify(customClientInfo));
  }, [customClientInfo]);

  // On mount: load validated establishments from Supabase and merge into customClientInfo
  // (Supabase is the source of truth — overrides localStorage for any establishment
  //  that has been validated by any user on any device)
  useEffect(() => {
    getValidatedEstablishments().then(supabaseData => {
      if (Object.keys(supabaseData).length === 0) return;
      setCustomClientInfo(prev => {
        // Supabase data wins over stale localStorage data
        const merged = { ...prev };
        Object.entries(supabaseData).forEach(([name, data]) => {
          merged[name] = { ...(prev[name] || {}), ...data };
        });
        return merged;
      });
      console.log(`✅ Supabase: ${Object.keys(supabaseData).length} ubicaciones de establecimientos cargadas`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount
  useEffect(() => {
    localStorage.setItem("hs_travel_bookings", JSON.stringify(bookingConfirmations));
  }, [bookingConfirmations]);

  // Auth screens are rendered in the RENDER section below to avoid violating Rules of Hooks

  // Helper for CSV Parsing
  const parseCSV = (file, callback) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.error(results.errors);
          alert("Error al leer el CSV.");
          return;
        }
        try { callback(results); } catch (err) { alert("Error procesando datos: " + err.message); }
      },
      error: (err) => alert("Error de lectura: " + err.message)
    });
  };

  const onUploadPlanning = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    parseCSV(file, (results) => {
      // Tag import with current month for historical tracking
      const importMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const mapped = results.data.map((row) => ({
        id: Math.random().toString(36).substr(2, 9),
        a: (row["Auditor"] || row["auditor"] || row["Consultor"] || row["Nombre"] || "").trim(),
        r: (row["Region"] || row["region"] || row["Región"] || "").trim(),
        e: (row["Establecimiento"] || row["establecimiento"] || row["Hotel"] || "").trim(),
        d: (row["Disciplina"] || row["disciplina"] || row["Actividad"] || row["actividad"] || row["Tarea"] || row["Tareas"] || "").trim(),
        f: (row["Fecha"] || row["fecha"] || row["Date"] || "").trim(),
        j: parseFloat((row["Jornada"] || row["jornada"] || row["Jornadas"] || row["jornadas"] || row["Duración"] || "0").replace(",", ".")),
        g: (row["Grupo"] || row["grupo"] || row["Cadena"] || "").trim(),
        _importMonth: importMonth
      })).filter(item => item.a && item.f);

      // 1. Agrupación y Deduplicación interna (si el archivo fuente tiene duplicados)
      const internalMap = new Map();

      for (const item of mapped) {
        const key = `${item.e}|${item.f}|${item.a}`.toLowerCase();
        if (internalMap.has(key)) {
          // Merge descriptions if same visit
          const existing = internalMap.get(key);
          if (!existing.d.includes(item.d)) {
            existing.d = `${existing.d} + ${item.d}`;
          }
        } else {
          internalMap.set(key, item);
        }
      }

      const internalDeduplicated = Array.from(internalMap.values());

      // 2. Deduplicación contra existentes
      const existingSeen = new Set(activities.map(a => `${a.e}|${a.f}|${a.a}`.toLowerCase()));
      const newItems = internalDeduplicated.filter(item => {
        const key = `${item.e}|${item.f}|${item.a}`.toLowerCase();
        return !existingSeen.has(key);
      });

      if (newItems.length > 0) {
        setActivities(prev => [...prev, ...newItems]);
        setUploadFlash(`✅ Se han añadido ${newItems.length} registros de agenda.`);
        setTimeout(() => setUploadFlash(null), 4000);

        // 3. Detect establishments NOT in the database
        // Match is by EXACT NAME (case-sensitive, trimmed)
        const allEstNames = new Set(newItems.map(i => i.e).filter(Boolean));
        const unmatchedNames = [];
        const regionMap = {};
        const consultantMap = {}; // Track which consultant visits which hotel
        allEstNames.forEach(name => {
          const inClientData = !!CLIENT_LOOKUP[name];
          const inCustom = !!customClientInfo[name];
          if (!inClientData && !inCustom) {
            unmatchedNames.push(name);
            const itemWithRegion = newItems.find(i => i.e === name && i.r);
            if (itemWithRegion) regionMap[name] = itemWithRegion.r;
            // Find consultant assigned to this hotel from CSV
            const itemWithConsultant = newItems.find(i => i.e === name && i.a);
            if (itemWithConsultant) consultantMap[name] = itemWithConsultant.a;
          }
        });

        if (unmatchedNames.length > 0) {
          setPendingNewEstablishments({ names: unmatchedNames, regionMap, consultantMap });
        }
      } else {
        alert("No se han encontrado registros nuevos o ya existen en el sistema.");
      }
    });
    e.target.value = ""; // reset
  };

  // Handler for saving new establishments from the modal
  const handleSaveNewEstablishments = useCallback(async (formData) => {
    for (const est of formData) {
      if (!est.municipality || !est.region) continue; // Skip incomplete
      // 1. Save to Supabase permanently
      await upsertEstablishment(est.name, {
        address: est.address || null,
        municipality: est.municipality,
        region: est.region,
        island: est.island || null
      });
      // 2. Update local customClientInfo (triggers recalculation of proposals)
      setCustomClientInfo(prev => ({
        ...prev,
        [est.name]: {
          ...(prev[est.name] || {}),
          address: est.address || undefined,
          municipality: est.municipality,
          region: est.region,
          island: est.island || undefined
        }
      }));
    }
    const saved = formData.filter(e => e.municipality && e.region).length;
    setPendingNewEstablishments(null);
    setUploadFlash(`🏨 ${saved} nuevos establecimientos guardados en la base de datos.`);
    setTimeout(() => setUploadFlash(null), 4000);
  }, []);

  // Handler for creating ad-hoc trips from the modal
  const handleSaveNewTrip = useCallback((items, shouldBook = false) => {

    // Deduplicate against existing activities
    const existingSeen = new Set(activities.map(a => `${a.e}|${a.f}|${a.a}`.toLowerCase()));
    const newItems = items.filter(item => {
      const key = `${item.e}|${item.f}|${item.a}`.toLowerCase();
      return !existingSeen.has(key);
    });

    if (newItems.length === 0) {
      alert("Todos los viajes creados ya existen en el sistema.");
      return;
    }

    setActivities(prev => [...prev, ...newItems]);
    setShowNewTrip(false);

    // Check for unmatched establishments (same logic as CSV upload)
    const unmatchedNames = [];
    const regionMap = {};
    newItems.forEach(item => {
      // Do not consider "Otros" custom hotels from new trips as missing establishments
      if (!item.e || item._isOther) return;
      const inClientData = !!CLIENT_LOOKUP[item.e];
      const inCustom = !!customClientInfo[item.e];
      if (!inClientData && !inCustom && !unmatchedNames.includes(item.e)) {
        unmatchedNames.push(item.e);
        if (item.r) regionMap[item.e] = item.r;
      }
    });

    if (unmatchedNames.length > 0) {
      setPendingNewEstablishments({ names: unmatchedNames, regionMap });
    }

    // Automatically open booking modal if requested OR if it's a priority transport (vuelo/tren/auto) and we have items
    if (newItems.length > 0 && (shouldBook || true)) {
      const firstItem = newItems[0];
      const consultantName = (firstItem.a || "").trim();
      const c = activeConsultants[consultantName];
      if (c) {
        const clientName = firstItem.e;
        const baseClient = CLIENT_LOOKUP[clientName] || {};
        const customClient = customClientInfo[clientName] || {};
        const mergedClient = { ...baseClient, ...customClient };

        const tType = getTransportType(c.region, firstItem.r, firstItem.e, c.pref, c.island, mergedClient.island, c.base, mergedClient.municipality, mergedClient);

        // Open if user clicked "Guardar y Reservar" OR if it's definitely a flight/train/car (previous automation)
        if (shouldBook || ["vuelo", "tren", "auto"].includes(tType)) {

          const activityToBook = {
            ...firstItem,
            startDate: firstItem.f,
            endDate: newItems[newItems.length - 1].f,
            cName: consultantName
          };

          setBookingTarget({
            consultant: consultantName,
            activity: activityToBook,
            transportType: tType,
            establishments: Array.from(new Set(newItems.map(i => i.e))),
            selectedIds: newItems.map(i => i.id),
            groupStartDate: firstItem.f,
            groupEndDate: newItems[newItems.length - 1].f
          });
        }
      }
    }

    setUploadFlash(`✈️ Viaje ad-hoc creado: ${newItems.length} ${newItems.length === 1 ? 'visita añadida' : 'visitas añadidas'}.`);
    setTimeout(() => setUploadFlash(null), 4000);
  }, [activities, customClientInfo, activeConsultants]);

  const handleClearData = () => {
    setActivities([]);
    setUploadFlash("🗑️ Planificación borrada correctamente.");
    setTimeout(() => setUploadFlash(null), 3000);
  };

  // Persist accommodation hotels
  useEffect(() => {
    localStorage.setItem("hs_travel_accom_hotels", JSON.stringify(accommodationHotels));
  }, [accommodationHotels]);

  // handleHotelsCSV: mode = 'replace' | 'append'
  const handleHotelsCSV = (e, mode = 'replace') => {
    const file = e.target.files[0];
    if (!file) return;
    parseCSV(file, (results) => {
      const map = {};
      let lastZona = "";
      results.data.forEach(row => {
        const zona = (row["ZONA"] || row["Zona"] || row["zona"] || "").trim().toUpperCase();
        const hotel = (row["HOTEL"] || row["Hotel"] || row["hotel"] || row["NOMBRE"] || "").trim();
        const ubicacion = (row["UBICACIÓN"] || row["Ubicación"] || row["UBICACION"] || row["url"] || row["URL"] || row["Link"] || row["LINK"] || "").trim();
        if (!hotel) return;
        const effectiveZona = zona || lastZona || "Sin zona";
        if (zona) lastZona = zona;
        if (!map[effectiveZona]) map[effectiveZona] = [];
        map[effectiveZona].push({ hotel, ubicacion });
      });
      const numZonas = Object.keys(map).length;
      const numHoteles = Object.values(map).reduce((a, b) => a + b.length, 0);
      if (numHoteles === 0) {
        alert("No se encontraron hoteles. Asegúrate que las columnas se llaman ZONA, HOTEL y UBICACIÓN.");
        return;
      }
      setAccommodationHotels(prev => {
        let newHotels;
        if (mode === 'append') {
          // Merge: add new hotels without removing existing ones
          const merged = { ...prev };
          Object.entries(map).forEach(([zone, newHotels]) => {
            if (!merged[zone]) merged[zone] = [];
            const existingNames = new Set(merged[zone].map(h => h.hotel.toLowerCase()));
            newHotels.forEach(h => {
              if (!existingNames.has(h.hotel.toLowerCase())) merged[zone].push(h);
            });
          });
          newHotels = merged;
        } else {
          newHotels = map;
        }
        syncAccommodationHotels(newHotels);
        return newHotels;
      });
      const added = mode === 'append' ? 'añadidos' : 'cargados';
      setUploadFlash(`🏨 ${numHoteles} hoteles ${added} en ${numZonas} zonas.`);
      setTimeout(() => setUploadFlash(null), 4000);
    });
    e.target.value = "";
  };

  // No longer using CSV upload for consultants. Substituted by database management.
  const handleDeleteConsultant = useCallback(async (name) => {
    setCustomConsultants(prev => {
      const next = prev ? { ...prev } : { ...CONSULTANTS };
      delete next[name];
      return next;
    });
    // Persist to Supabase
    const ok = await deleteConsultantDB(name);
    if (ok) {
      console.log(`✅ Supabase: Consultor "${name}" eliminado permanentemente`);
    } else {
      console.warn(`⚠️ Supabase: No se pudo eliminar "${name}" de la base de datos`);
    }
  }, []);



  // Centralized address update: local state + Supabase sync + logistics recalc
  const updateEstablishmentAddress = useCallback(async (establishmentName, newAddress, newMunicipality) => {
    // 1. Update local state (triggers immediate recalc via useMemo)
    setCustomClientInfo(prev => ({
      ...prev,
      [establishmentName]: { ...(prev[establishmentName] || {}), address: newAddress, municipality: newMunicipality }
    }));

    // 2. Persist to Supabase establishments table
    const baseClient = CLIENT_LOOKUP[establishmentName] || {};
    await upsertEstablishment(establishmentName, {
      address: newAddress,
      municipality: newMunicipality || baseClient.municipality,
      region: baseClient.region,
      island: baseClient.island
    });

    // 3. Update all activities with this establishment in Supabase
    const affectedActivities = activities.filter(a => a.e === establishmentName);
    for (const act of affectedActivities) {
      const auditorName = (act.a || "").trim();
      const c = activeConsultants[auditorName];
      if (!c) continue;

      const mergedClient = { ...baseClient, address: newAddress, municipality: newMunicipality };
      const tType = getTransportType(c.region, act.r, act.e, c.pref, c.island, mergedClient.island, c.base, mergedClient.municipality, mergedClient);
      const destFullAddr = newAddress || mergedClient.municipality || act.r;
      const km = (tType === "vehiculo" || tType === "auto" || tType === "local")
        ? estimateDistance(c.address || c.base, destFullAddr, c.base, mergedClient.municipality)
        : 0;

      // Update in Supabase if the activity has a supabase ID
      if (act._supabaseId) {
        await updateActivityAddress(act._supabaseId, newAddress, newMunicipality);
        await updateActivityTransport(act._supabaseId, tType, km);
      }
    }



    // 4. Audit log
    await logAction('establishment', null, 'address_updated', {
      establishment: establishmentName,
      new_address: newAddress,
      new_municipality: newMunicipality,
      affected_activities: affectedActivities.length
    });

    console.log(`✅ Dirección actualizada: ${establishmentName} → ${newAddress} (${affectedActivities.length} actividades recalculadas)`);
  }, [activities, activeConsultants]);

  const handleMarkBooked = useCallback((url, bookingData) => {
    if (!bookingTarget) return;

    // Determine which IDs to update: the specific one or the entire selection
    const idsToUpdate = bookingTarget.selectedIds && bookingTarget.selectedIds.length > 0
      ? bookingTarget.selectedIds
      : [bookingTarget.activity.id];

    // Seal the group if booking multiple items together or they don't have one
    let assignedG = null;
    if (idsToUpdate.length > 1) {
      // Find if they already share a group
      const existingGs = new Set(proposals.filter(p => idsToUpdate.includes(p.id)).map(p => p.g).filter(Boolean));
      if (existingGs.size !== 1) {
        assignedG = `SEAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      } else {
        assignedG = Array.from(existingGs)[0];
      }
    }

    // Update internal activities state to apply the new group ID if needed
    if (assignedG) {
      setActivities(prev => prev.map(a => {
        if (idsToUpdate.includes(a.id)) {
          return { ...a, g: assignedG };
        }
        return a;
      }));
    }

    setBookedLinks(prev => {
      const next = { ...prev };
      idsToUpdate.forEach(id => {
        const current = { ...(next[id] || {}) };
        if (bookingData === null) {
          delete current[url];
        } else {
          current[url] = bookingData;
        }
        next[id] = current;
      });
      return next;
    });

    if (bookingData !== null) {
      // Automatically "Finalize" the activities if marked as booked
      const nextFinalized = new Set(finalizedIds);
      const managedUpdates = [];
      idsToProcess: // labels are useless here but help context
      idsToUpdate.forEach(id => {
        nextFinalized.add(id);
        managedUpdates.push({ id, isManaged: true, g: assignedG });
      });
      setFinalizedIds(nextFinalized);
      // Sync managed status to Supabase (including potential group seal)
      if (managedUpdates.length > 0) bulkSetManagedStatus(managedUpdates);

      setUploadFlash(`✅ Reserva registrada`);
      setTimeout(() => setUploadFlash(null), 3000);
    } else {
      setUploadFlash(`🗑️ Reserva eliminada`);
      setTimeout(() => setUploadFlash(null), 3000);
    }
  }, [bookingTarget, proposals, finalizedIds]);


  const groupRanges = useMemo(() => {
    const ranges = {};
    activities.forEach(a => {
      if (!a.g || !a.f) return;
      const key = `${(a.a || "").trim()}-${a.g}`;
      const [d, m, y] = a.f.split("/");
      const date = new Date(y, m - 1, d);
      if (!ranges[key]) {
        ranges[key] = { start: date, end: date, startStr: a.f, endStr: a.f };
      } else {
        if (date < ranges[key].start) {
          ranges[key].start = date;
          ranges[key].startStr = a.f;
        }
        if (date > ranges[key].end) {
          ranges[key].end = date;
          ranges[key].endStr = a.f;
        }
      }
    });
    return ranges;
  }, [activities]);

  const updateConsultant = useCallback(async (name, updatedData) => {
    // If we are using valid customConsultants, update it. 
    // If we are using default CONSULTANTS, we need to clone it to custom first to avoid mutating constant.
    let nextState = customConsultants ? { ...customConsultants } : { ...CONSULTANTS };

    // Ensure we preserve fields that might not be in editForm but exist in original
    nextState[name] = { ...nextState[name], ...updatedData };

    setCustomConsultants(nextState);

    // Persist to Supabase permanently
    const ok = await upsertConsultant(name, nextState[name]);
    if (ok) {
      console.log(`✅ Supabase: Consultor "${name}" actualizado permanentemente`);
    } else {
      console.warn(`⚠️ Supabase: No se pudo guardar "${name}" en la base de datos`);
    }

    // Automaticaly recalculate and persist transport for all affected activities
    const c = nextState[name];
    const affectedActivities = activities.filter(a => (a.a || "").trim() === name);
    let updateCount = 0;

    for (const act of affectedActivities) {
      const clientName = act.e;
      const baseClient = CLIENT_LOOKUP[clientName] || {};
      const customClient = customClientInfo[clientName] || {};
      const mergedClient = { ...baseClient, ...customClient };

      const tType = getTransportType(c.region, act.r, act.e, c.pref, c.island, mergedClient.island, c.base, mergedClient.municipality, mergedClient);
      const destFullAddr = mergedClient.address || EXTRA_CLIENT_INFO[act.e]?.address || mergedClient.municipality || act.r;
      const originFullAddr = c.address || c.base;
      const distKey = `${originFullAddr}|${destFullAddr}`;

      const km = (tType === "vehiculo" || tType === "auto" || tType === "local")
        ? (realDistances[distKey] || estimateDistance(originFullAddr, destFullAddr))
        : 0;

      if (act._supabaseId) {
        // Sync to Supabase without blocking
        updateActivityTransport(act._supabaseId, tType, km);
        updateCount++;
      }
    }

    if (updateCount > 0) {
      console.log(`✅ Reprogramadas ${updateCount} rutas para el consultor ${name}`);
      setUploadFlash(`🔄 Reprogramadas ${updateCount} rutas para ${name}`);
      setTimeout(() => setUploadFlash(null), 3000);
    }
  }, [customConsultants, activities, customClientInfo, realDistances]);

  const proposals = useMemo(() => {
    return activities.map(activity => {
      const auditorName = (activity.a || "").trim();
      const c = activeConsultants[auditorName];

      const clientName = activity.e;
      const baseClient = CLIENT_LOOKUP[clientName] || {};
      const customClient = customClientInfo[clientName] || {};
      const client = { ...baseClient, ...customClient };

      const destFullAddress = client.address || EXTRA_CLIENT_INFO[activity.e]?.address || client.municipality || activity.r;
      const isGenericAddress = !client.address && !EXTRA_CLIENT_INFO[activity.e]?.address;

      if (!c) {
        return {
          ...activity,
          consultant: { base: "Desconocido" },
          cName: auditorName,
          tType: "local",
          needsTravel: false,
          originAddress: "N/A",
          originMuni: "N/A",
          originDisplay: "N/A",
          destAddress: destFullAddress,
          destMuni: client.municipality || activity.r,
          destDisplay: activity.r,
          isGenericAddress,
          routeLabel: "N/A",
          startDate: activity.f,
          endDate: activity.f,
          km: 0
        };
      }

      const tType = getTransportType(c.region, activity.r, activity.e, c.pref, c.island, client.island, c.base, client.municipality, client);
      const originMuni = c.base || "Desconocido";
      const originCCAA = normalizeRegion(c.region);
      const isOriginIsland = ISLAND_REGIONS.includes(originCCAA);
      const originDisplay = isOriginIsland ? (c.island || originCCAA) : originCCAA;

      const destMuni = client.municipality || activity.r;
      // Prioritize data from clientData.json over inference (inference is fallback only)
      const destCCAA = normalizeRegion(client.region || inferRegionFromMuni(destMuni) || activity.r);
      const isDestIsland = ISLAND_REGIONS.includes(destCCAA);
      const destIsland = client.island || inferIslandFromMuni(destMuni);
      const destDisplay = isDestIsland ? (destIsland || destCCAA) : destCCAA;

      const routeLabel = tType === "local" ? "Transporte Local" : `${originMuni} / ${originDisplay} → ${destMuni} / ${destDisplay}`;

      const groupKey = `${auditorName}-${activity.g}`;
      const range = groupRanges[groupKey];
      const startDate = range ? range.startStr : activity.f;
      const endDate = range ? range.endStr : activity.f;

      const distKey = `${c.address || c.base}|${destFullAddress}`;
      const km = (tType === "vehiculo" || tType === "auto" || tType === "local")
        ? (realDistances[distKey] || estimateDistance(c.address || c.base, destFullAddress))
        : 0;

      return {
        ...activity,
        consultant: c,
        cName: auditorName,
        tType,
        needsTravel: tType !== "local",
        originAddress: c.address || c.base,
        originMuni,
        originDisplay,
        destAddress: destFullAddress,
        destMuni,
        destDisplay,
        isGenericAddress,
        routeLabel,
        startDate,
        endDate,
        km
      };
    });
  }, [activities, activeConsultants, groupRanges, customClientInfo]);

  const filtered = useMemo(() => {
    return proposals.filter(p => {
      // Logic for finalized tabs
      if (view === "proposals" && finalizedIds.has(p.id)) return false;
      if (view === "managed" && !finalizedIds.has(p.id)) return false;

      if (filterAuditor && p.cName !== filterAuditor) return false;
      if (filterRegion && p.r !== filterRegion) return false;

      if (filterDateStart || filterDateEnd) {
        const [d, m, y] = p.f.split("/");
        const pDate = new Date(y, m - 1, d);
        if (filterDateStart) {
          const startDate = new Date(filterDateStart);
          if (pDate < startDate) return false;
        }
        if (filterDateEnd) {
          const endDate = new Date(filterDateEnd);
          if (pDate > endDate) return false;
        }
      }

      if (filterTransport === "viaje") {
        if (p.tType === "vehiculo") return false;
      } else if (Array.isArray(filterTransport)) {
        if (!filterTransport.includes(p.tType)) return false;
      } else if (filterTransport && p.tType !== filterTransport) {
        return false;
      }
      return true;
    }).sort((a, b) => {
      // If in managed view, group by consultant and group first
      if (view === "managed") {
        if (a.cName !== b.cName) return a.cName.localeCompare(b.cName);
        if (a.g !== b.g) return (a.g || "").localeCompare(b.g || "");
      }

      // Prioritize travel (viajes) over own vehicle
      const isTravelA = a.tType !== "vehiculo";
      const isTravelB = b.tType !== "vehiculo";
      if (isTravelA && !isTravelB) return -1;
      if (!isTravelA && isTravelB) return 1;

      // Secondary sort: Date
      const [da, ma, ya] = a.f.split("/");
      const [db, mb, yb] = b.f.split("/");
      const dateA = new Date(ya, ma - 1, da);
      const dateB = new Date(yb, mb - 1, db);
      if (dateA - dateB !== 0) return dateA - dateB;

      return a.e.localeCompare(b.e);
    });
  }, [proposals, filterAuditor, filterRegion, filterTransport, filterDateStart, filterDateEnd, finalizedIds, view]);

  const stats = useMemo(() => {
    const s = { total: proposals.length, pending: 0, managed: 0, vuelo: 0, tren: 0, vehiculo: 0, auto: 0, byMonth: {} };
    proposals.forEach(p => {
      // Monthly breakdown: parse DD/MM/YYYY -> YYYY-MM, or use _importMonth
      let month = p._importMonth || "";
      if (!month && p.f) {
        const parts = p.f.split("/");
        if (parts.length === 3) month = `${parts[2]}-${parts[1].padStart(2, "0")}`;
      }
      if (!month) month = "sin-fecha";
      if (!s.byMonth[month]) s.byMonth[month] = { imported: 0, managed: 0, pending: 0 };
      s.byMonth[month].imported++;

      if (finalizedIds.has(p.id)) {
        s.managed++;
        s.byMonth[month].managed++;
      } else {
        s.pending++;
        s.byMonth[month].pending++;
        const type = p.tType;
        s[type] = (s[type] || 0) + 1;
      }
    });
    return s;
  }, [proposals, finalizedIds]);

  const summaryByAuditor = useMemo(() => {
    const m = {};
    proposals.forEach(p => {
      if (!m[p.cName]) m[p.cName] = { vuelo: 0, tren: 0, vehiculo: 0, auto: 0, total: 0, managed: 0, pending: 0, jornadas: 0, base: p.consultant.base };
      m[p.cName].total++;
      if (finalizedIds.has(p.id)) {
        m[p.cName].managed++;
      } else {
        m[p.cName].pending++;
        m[p.cName].jornadas += p.j;
        const type = p.tType;
        if (m[p.cName][type] !== undefined) {
          m[p.cName][type]++;
        }
      }
    });
    return m;
  }, [proposals, finalizedIds]);

  const handleManualGroup = () => {
    if (selectedIds.size < 1) return;
    const groupName = prompt("Nombre del grupo / viaje (ej: Canarias Tour Mar Mayo):");
    if (!groupName) return;

    setActivities(prev => prev.map(a =>
      selectedIds.has(a.id) ? { ...a, g: groupName } : a
    ));
    setSelectedIds(new Set());
  };

  const handleBookSelection = (consultantName) => {
    // Filter selected proposals to ONLY the specified consultant (ignore group filter here to allow multiple hotels booking)
    const selected = proposals.filter(p => selectedIds.has(p.id) && (!consultantName || p.cName === consultantName));
    if (selected.length === 0) return;



    // Use the first and last hotel dates from the filtered selection
    const firstHotel = selected[0];
    const lastHotel = selected[selected.length - 1];
    const consultantIds = selected.map(s => s.id);

    setBookingTarget({
      consultant: firstHotel.a,
      activity: {
        ...firstHotel,
        startDate: firstHotel.f,
        endDate: lastHotel.f
      },
      transportType: firstHotel.tType,
      establishments: Array.from(new Set(selected.map(s => s.e))),
      selectedIds: consultantIds, // Only IDs of this consultant
      groupStartDate: firstHotel.f,
      groupEndDate: lastHotel.f
    });
  };

  const hasBookableTransport = useMemo(() => {
    const selected = proposals.filter(p => selectedIds.has(p.id));
    return selected.some(p => ["vuelo", "tren", "auto"].includes(p.tType));
  }, [selectedIds, proposals]);


  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleFinalize = (id) => {
    const next = new Set(finalizedIds);
    const isNowManaged = !next.has(id);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFinalizedIds(next);
    // Sync to Supabase
    setActivityManagedStatus(id, isNowManaged);
  };

  const handleBulkFinalize = (consultantName) => {
    const next = new Set(finalizedIds);
    const isManaged = view !== "managed";
    const updates = [];

    // The set of activities being processed - acts on whole selection for this consultant
    const idsToProcess = consultantName
      ? new Set(proposals.filter(p => selectedIds.has(p.id) && p.cName === consultantName).map(p => p.id))
      : selectedIds;


    // Use Seal ID for any plural finalization to keep them unified
    let fallbackG = null;
    if (isManaged && idsToProcess.size > 1) {
      fallbackG = `SEAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    }


    // Update internal activities state to apply the new group ID if needed
    if (isManaged && fallbackG) {
      setActivities(prev => prev.map(a => {
        if (idsToProcess.has(a.id) && !a.g) {
          return { ...a, g: fallbackG };
        }
        return a;
      }));
    }

    idsToProcess.forEach(id => {
      if (view === "managed") next.delete(id);
      else next.add(id);

      // Determine what group ID to send to DB
      let gForDB = undefined;
      if (isManaged) {
        const item = activities.find(a => a.id === id);
        // Use existing group if it has one, otherwise use the new fallbackG
        gForDB = (item && item.g) ? item.g : fallbackG;
      }

      updates.push({ id, isManaged, g: gForDB });
    });

    setFinalizedIds(next);

    // Only clear the processed IDs from selection, keep other consultants' selections
    if (consultantName) {
      setSelectedIds(prev => {
        const remaining = new Set(prev);
        idsToProcess.forEach(id => remaining.delete(id));
        return remaining;
      });
    } else {
      setSelectedIds(new Set());
    }

    // Sync to Supabase in bulk (now including potential group ID updates)
    if (updates.length > 0) bulkSetManagedStatus(updates);
  };


  const handleDataLoaded = (newData) => {
    setActivities(prev => [...prev, ...newData]);
    setView("dashboard");
  };

  const handleNavigate = (targetView, transportFilter, auditorFilter) => {
    setView(targetView);
    if (transportFilter !== undefined) {
      // transportFilter can be an array now for combined categories
      setFilterTransport(transportFilter);
    }
    if (auditorFilter !== undefined) {
      setFilterAuditor(auditorFilter);
    }
  };

  const uniqueAuditors = useMemo(() => [...new Set(activities.map(a => (a.a || "").trim()))].sort(), [activities]);
  const uniqueRegions = useMemo(() => [...new Set(activities.map(a => a.r))].sort(), [activities]);
  const uniqueDates = useMemo(() => [...new Set(activities.map(a => a.f))].sort((a, b) => {
    const [da, ma, ya] = a.split("/");
    const [db, mb, yb] = b.split("/");
    return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
  }), [activities]);



  const exportFilteredToCSV = () => {
    if (filtered.length === 0) return;

    const data = filtered.map(p => ({
      Fecha: p.f,
      Consultor: p.a,
      Tipo: p.tType.toUpperCase(),
      Ruta: p.routeLabel,
      Establecimiento: p.e,
      Grupo: p.g || "",
      Kilometros: p.km,
      Confirmaciones: Array.isArray(bookingConfirmations[p.id]) ? bookingConfirmations[p.id].join(" | ") : (bookingConfirmations[p.id] || ""),
      Estado: finalizedIds.has(p.id) ? "GESTIONADO" : "PENDIENTE"
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_Logistica_${view}_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const calculateDistances = async () => {
    setCalculatingDistances(true);
    setUploadFlash("⏳ Calculando distancias reales (esto puede tardar unos segundos)...");

    // Identify routes needing calculation
    const routesToCalc = [];
    const seen = new Set();

    filtered.forEach(p => {
      const key = `${p.originAddress}|${p.destAddress}`;
      if ((p.tType === "vehiculo" || p.tType === "auto" || p.tType === "local") && !realDistances[key]) {
        if (!seen.has(key)) {
          seen.add(key);
          routesToCalc.push({ key, origin: p.originAddress, dest: p.destAddress });
        }
      }
    });

    if (routesToCalc.length === 0) {
      setCalculatingDistances(false);
      setUploadFlash("✅ Todas las distancias están actualizadas.");
      setTimeout(() => setUploadFlash(null), 3000);
      return;
    }

    const newDistances = {};
    const COORDINATE_CACHE = {}; // Ephemeral cache for this batch

    const getCoordinates = async (address) => {
      // Clean address key
      const key = address.trim().toLowerCase();
      if (COORDINATE_CACHE[key]) return COORDINATE_CACHE[key];

      // Fetch
      await new Promise(r => setTimeout(r, 600)); // Respect Rate Limits
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`);
        const data = await res.json();
        if (data && data.features && data.features.length > 0) {
          const coords = {
            lat: data.features[0].geometry.coordinates[1],
            lon: data.features[0].geometry.coordinates[0]
          };
          COORDINATE_CACHE[key] = coords;
          return coords;
        }
      } catch (e) {
        console.error("Geocode error", e);
      }
      return null;
    };

    // Process in sequence to respect API limits
    let index = 0;
    for (const route of routesToCalc) {
      index++;
      setUploadFlash(`⏳ Calculando ruta ${index} de ${routesToCalc.length}...`);

      try {
        // 1. Geocode Origin (Cached)
        const coordsO = await getCoordinates(route.origin);
        if (!coordsO) continue;

        // 2. Geocode Dest (Cached)
        const coordsD = await getCoordinates(route.dest);
        if (!coordsD) continue;

        // 3. OSRM Route (Driving)
        // OSRM is fast, no heavy rate limit needed usually, but small delay is polite
        const resRoute = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsO.lon},${coordsO.lat};${coordsD.lon},${coordsD.lat}?overview=false`);
        const dataRoute = await resRoute.json();

        if (dataRoute.routes && dataRoute.routes[0]) {
          const distKm = parseFloat((dataRoute.routes[0].distance / 1000).toFixed(1));
          newDistances[route.key] = distKm;
          // Partial update to show progress
          setRealDistances(prev => ({ ...prev, [route.key]: distKm }));

          // Save to Supabase (Background)
          upsertDistance(route.key, distKm);
        }
      } catch (err) {
        console.error("Error calculating distance for", route.key, err);
      }
    }

    setCalculatingDistances(false);
    setUploadFlash(`✅ Se han actualizado ${Object.keys(newDistances).length} distancias.`);
    setTimeout(() => setUploadFlash(null), 3000);
  };

  // RENDER

  // AUTH LOADING
  if (authLoading) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif", background: "linear-gradient(135deg, #0D1B3E 0%, #1a365d 50%, #0D4BD9 100%)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "white" }}>
          <div style={{ width: 56, height: 56, background: "rgba(255,255,255,0.15)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, margin: "0 auto 16px", backdropFilter: "blur(10px)" }}>HS</div>
          <p style={{ opacity: 0.7, fontSize: 14 }}>Cargando...</p>
        </div>
      </div>
    );
  }

  // LOGIN SCREEN
  if (!authUser) {
    return (
      <div style={{ fontFamily: "Arial, sans-serif", background: "#f0f2f5", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundImage: "radial-gradient(#cfd8dc 1px, transparent 1px)", backgroundSize: "20px 20px" }}>

        {/* LOGO AREA */}
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
            <div style={{ width: 80, height: 80, background: HS_COLORS.primary, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px rgba(0,0,0,0.2)" }}>
              <span style={{ transform: "rotate(45deg)", color: "white", fontSize: 28, fontWeight: "900", fontFamily: "Arial Black, sans-serif" }}>HS</span>
            </div>
          </div>
          <h1 style={{ color: HS_COLORS.primary, fontSize: 36, fontWeight: "800", margin: "0", letterSpacing: "-1px", fontFamily: "Arial, sans-serif" }}>CONSULTING</h1>
          <p style={{ color: "#999", fontSize: 16, margin: "0", textTransform: "uppercase", letterSpacing: "2px", fontWeight: "300" }}>Health & Safety</p>
        </div>

        {/* LOGIN CARD */}
        <div style={{ background: "white", padding: 40, borderRadius: 6, width: "100%", maxWidth: 400, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid #ddd" }}>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, borderBottom: "1px solid #eee", paddingBottom: 15 }}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="#333"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
            <h2 style={{ fontSize: 24, fontWeight: "bold", margin: 0, color: "#222" }}>Inicio de sesión</h2>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 15 }}>
              <label style={{ display: "block", color: "#333", fontSize: 13, fontWeight: "bold", marginBottom: 5 }}>Datos de acceso de auditor</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder="su correo electrónico"
                required
                style={{ width: "100%", padding: "12px", borderRadius: 4, border: "1px solid #ccc", background: HS_COLORS.inputBg, fontSize: 14, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="contraseña"
                required
                style={{ width: "100%", padding: "12px", borderRadius: 4, border: "1px solid #ccc", background: HS_COLORS.inputBg, fontSize: 14, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            {loginError && (
              <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px", borderRadius: 4, marginBottom: 15, fontSize: 13 }}>
                ⚠️ {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              style={{ width: "100%", padding: "12px", borderRadius: 4, border: "none", background: HS_COLORS.primary, color: "white", fontSize: 16, fontWeight: "bold", cursor: loginLoading ? "wait" : "pointer", transition: "opacity 0.2s", boxShadow: "0 2px 4px rgba(0,0,0,0.2)" }}
            >
              {loginLoading ? "Accediendo..." : "Acceder"}
            </button>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 15, fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#333", cursor: "pointer" }}>
                <input type="checkbox" /> Recordarme
              </label>
              <a href="#" style={{ color: HS_COLORS.primary, textDecoration: "none" }}>¿No recuerda su contraseña?</a>
            </div>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 30, color: "#999", fontSize: 12 }}>
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>Copyright © 2026 hsconsulting.es</div>
          <div>Asesoramiento Integral en Higiene y Seguridad</div>
          <div>Todos los derechos reservados.</div>
        </div>
      </div>
    );
  }

  // SIDEBAR + LAYOUT WRAPPER
  const AppLayout = ({ children }) => (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>
      {/* SIDEBAR */}
      <div style={{ width: 250, background: HS_COLORS.sidebar, color: "#ccc", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: HS_COLORS.primary, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ transform: "rotate(45deg)", color: "white", fontSize: 10, fontWeight: "900" }}>HS</span>
          </div>
          <div style={{ lineHeight: 1 }}>
            <div style={{ color: "white", fontWeight: "bold", fontSize: 14 }}>HS CONSULTING</div>
            <div style={{ fontSize: 10, color: "#999" }}>Health & Safey</div>
          </div>
        </div>

        <div style={{ flex: 1, padding: "10px 0" }}>
          {[
            { id: "dashboard", label: "Dashboard", icon: "📊" },
            { id: "proposals", label: "Propuestas", icon: "📁" },
            { id: "managed", label: "Gestionados", icon: "✅" },
            { id: "calendar", label: "Calendario", icon: "📅" },
            { id: "consultants", label: "Consultores", icon: "👥" },
          ].map(item => (
            <div
              key={item.id}
              onClick={() => setView(item.id)}
              style={{
                padding: "12px 20px",
                cursor: "pointer",
                background: view === item.id ? "#000" : "transparent",
                color: view === item.id ? "white" : "#ccc",
                borderLeft: view === item.id ? `4px solid ${HS_COLORS.primary}` : "4px solid transparent",
                display: "flex", alignItems: "center", gap: 12, fontSize: 14, fontWeight: view === item.id ? "bold" : "normal"
              }}
            >
              <span>{item.icon}</span> {item.label}
            </div>
          ))}
        </div>

        <div style={{ padding: 20, borderTop: "1px solid #333", fontSize: 12, color: "#666" }}>
          {userProfile?.full_name || authUser?.email}
          <div onClick={handleLogout} style={{ color: "#999", cursor: "pointer", marginTop: 4 }}>Cerrar Sesión</div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, background: HS_COLORS.bg, display: "flex", flexDirection: "column" }}>
        {/* TOP BAR */}
        <div style={{ background: HS_COLORS.primary, padding: "10px 20px", color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
          <div style={{ fontSize: 18, fontWeight: "bold" }}>Portal de Logística</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Español ▼</div>
        </div>

        {/* CONTENT */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {children}
        </div>
      </div>
    </div>
  );

  if (view === "upload") {
    return (
      <AppLayout>
        <UploadScreen
          onDataLoaded={handleDataLoaded}
          onConsultantsLoaded={setCustomConsultants}
          existingActivities={activities}
        />
      </AppLayout>
    );
  }

  if (view === "dashboard") {
    return (
      <>
        {showBulkGeocode && (
          <BulkGeocodeModal
            onClose={() => setShowBulkGeocode(false)}
            customClientInfo={customClientInfo}
            onValidate={updateEstablishmentAddress}
          />
        )}
        {pendingNewEstablishments && (
          <NewEstablishmentsModal
            establishments={pendingNewEstablishments.names}
            regionFromCSV={pendingNewEstablishments.regionMap}
            consultantFromCSV={pendingNewEstablishments.consultantMap}
            onSave={handleSaveNewEstablishments}
            onSkip={() => setPendingNewEstablishments(null)}
          />
        )}
        {showNewTrip && (
          <NewTripModal
            consultants={activeConsultants}
            establishments={CLIENT_DATA}
            onSave={handleSaveNewTrip}
            onClose={() => setShowNewTrip(false)}
          />
        )}
        {showHotelsManager && (
          <AccommodationHotelsManager
            hotels={accommodationHotels}
            onClose={() => setShowHotelsManager(false)}
            onUpdate={handleUpdateAccommodationHotels}
            onImportCSV={handleHotelsCSV}
          />
        )}
        <AppLayout>
          <Dashboard
            stats={stats}
            summaryByAuditor={summaryByAuditor}
            onNavigate={handleNavigate}
            onTriggerPlanning={() => planningInputRef.current.click()}
            uploadFlash={uploadFlash}
            onClearData={handleClearData}
            onLogout={handleLogout}

            onTriggerHotels={() => setShowHotelsManager(true)}
            accommodationHotelsCount={Object.keys(accommodationHotels).length}
            onTriggerNewTrip={() => setShowNewTrip(true)}
          />
          <input type="file" ref={planningInputRef} style={{ display: "none" }} accept=".csv" onChange={onUploadPlanning} />
          <input type="file" ref={hotelsInputRef} style={{ display: "none" }} accept=".csv" onChange={e => handleHotelsCSV(e, 'replace')} />
        </AppLayout>
      </>
    );
  }

  if (view === "calendar") {
    return (
      <AppLayout>
        <CalendarView
          activities={proposals} // Pass ALL proposals
          initialConsultant={filterAuditor} // Pass current filter as initial state
          allConsultants={uniqueAuditors} // Pass list for dropdown
          bookedLinks={bookedLinks}
          onBack={() => setView("proposals")} // Optional, logic handles internal switching now
        />
      </AppLayout>
    );
  }

  // Common Header for Inner Views
  const renderHeader = () => (
    <div style={{ background: "white", borderBottom: "1px solid #eee", padding: "12px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => setView("dashboard")}>
          <div style={{ width: 32, height: 32, background: "#0D4BD9", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700 }}>HS</div>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Travel Planner <span style={{ fontWeight: 400, color: "#999", marginLeft: 8 }}>/ Logística</span></h1>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button onClick={() => setView("proposals")} style={{ background: view === "proposals" ? "#f0f0f0" : "transparent", border: "none", padding: "8px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", color: view === "proposals" ? "#111" : "#666" }}>Propuestas ({proposals.filter(p => !finalizedIds.has(p.id)).length})</button>
          <button onClick={() => setView("managed")} style={{ background: view === "managed" ? "#f0f0f0" : "transparent", border: "none", padding: "8px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", color: view === "managed" ? "#111" : "#666" }}>Gestionados ({finalizedIds.size})</button>
          <button onClick={() => setView("summary")} style={{ background: view === "summary" ? "#f0f0f0" : "transparent", border: "none", padding: "8px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", color: view === "summary" ? "#111" : "#666" }}>Resumen</button>
          <button onClick={() => setView("consultants")} style={{ background: view === "consultants" ? "#f0f0f0" : "transparent", border: "none", padding: "8px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", color: view === "consultants" ? "#111" : "#666" }}>Consultores</button>
          <div style={{ width: 1, height: 24, background: "#e0e0e0", margin: "0 8px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#4F46E5" }}>
              {(userProfile?.full_name || authUser?.email || "U").charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: "#666", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userProfile?.full_name || authUser?.email}</span>
            <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid #e0e0e0", padding: "4px 10px", borderRadius: 6, fontSize: 11, color: "#999", cursor: "pointer", fontWeight: 600 }} title="Cerrar sesión">Salir</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* BookingPanel MUST be outside AppLayout so position:fixed works correctly */}
      {bookingTarget && (
        <BookingPanel
          consultant={bookingTarget.consultant}
          activity={bookingTarget.activity}
          transportType={bookingTarget.transportType}
          establishments={bookingTarget.establishments || [bookingTarget.activity.e]}
          consultants={activeConsultants}
          bookedLinks={bookedLinks[bookingTarget.activity.id] || {}}
          onMarkBooked={handleMarkBooked}
          onClose={() => setBookingTarget(null)}
          onUpdateClientAddress={updateEstablishmentAddress}
          groupStartDate={bookingTarget.groupStartDate}
          groupEndDate={bookingTarget.groupEndDate}
          accommodationHotels={accommodationHotels}
          onUpdateAccommodationHotels={handleUpdateAccommodationHotels}
          onForceFinalize={() => {
            const idsToUpdate = bookingTarget.selectedIds && bookingTarget.selectedIds.length > 0
              ? bookingTarget.selectedIds
              : [bookingTarget.activity.id];
            const nextFinalized = new Set(finalizedIds);
            const managedUpdates = [];
            idsToUpdate.forEach(id => {
              nextFinalized.add(id);
              managedUpdates.push({ id, isManaged: true });
            });
            setFinalizedIds(nextFinalized);
            if (managedUpdates.length > 0) bulkSetManagedStatus(managedUpdates);
          }}
        />
      )}
      <AppLayout>

        <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
          {/* VIEW: PROPOSALS / MANAGED */}
          {(view === "proposals" || view === "managed") && (
            <div>
              <div style={{ marginBottom: 20, background: "white", padding: 20, borderRadius: 8, boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
                <h2 style={{ fontSize: 22, fontWeight: "bold", color: "#333", margin: "0 0 5px" }}>
                  {view === "managed" ? "Trayectos Gestionados" : "Propuestas de Logística"}
                </h2>
                <p style={{ fontSize: 13, color: "#666", margin: 0 }}>
                  {view === "managed" ? "Historial de viajes con logística completada" : "Viajes pendientes de reserva y organización"}
                </p>
              </div>

              {/* Filters */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
                <select value={filterAuditor} onChange={e => setFilterAuditor(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}><option value="">Todos los consultores</option>{uniqueAuditors.map(a => <option key={a} value={a}>{a}</option>)}</select>
                <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}><option value="">Todas las regiones</option>{uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}</select>

                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "white", padding: "4px 12px", borderRadius: 8, border: "1px solid #ddd" }}>
                  <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>Desde:</span>
                  <input type="date" value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} style={{ border: "none", outline: "none", fontSize: 13 }} />
                  <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>Hasta:</span>
                  <input type="date" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} style={{ border: "none", outline: "none", fontSize: 13 }} />
                  {(filterDateStart || filterDateEnd) && (
                    <button onClick={() => { setFilterDateStart(""); setFilterDateEnd(""); }} style={{ border: "none", background: "transparent", color: "#666", cursor: "pointer", padding: "0 4px", fontSize: 16 }}>&times;</button>
                  )}
                </div>

                <select
                  value={filterTransport}
                  onChange={e => setFilterTransport(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, background: filterTransport === "viaje" ? "#EEF2FF" : "white", color: filterTransport === "viaje" ? "#4F46E5" : "#111", fontWeight: filterTransport === "viaje" ? 600 : 400 }}
                >
                  <option value="">Ver Todo</option>
                  <option value="viaje">✈️ Solo Viajes (Reservas)</option>
                  <option value="vehiculo">🚗 Vehículo Propio</option>
                </select>

                <button
                  onClick={exportFilteredToCSV}
                  style={{ background: "white", color: "#0D4BD9", border: "1px solid #0D4BD9", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >
                  📊 Exportar Reporte (CSV)
                </button>
                {filterAuditor && (
                  <button
                    onClick={() => setView("calendar")}
                    style={{ background: "#4F46E5", color: "white", border: "none", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    📅 Ver Calendario Global
                  </button>
                )}

                <button
                  onClick={calculateDistances}
                  disabled={calculatingDistances}
                  style={{ background: calculatingDistances ? "#eee" : "#111", color: calculatingDistances ? "#999" : "white", border: "none", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: calculatingDistances ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >
                  {calculatingDistances ? "⏳ Calculando..." : "🔄 Calcular Km Reales"}
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(() => {
                  const elements = [];
                  if (view === "managed") {
                    // Grouping Strategy:
                    // PRIMARY KEY: consultant + expedition ID (p.g) — this is the definitive trip identifier.
                    // If no expedition ID exists, fall back to consultant + region + date clustering.
                    const expeditions = [];
                    const expMap = {};

                    filtered.forEach(p => {
                      const pDate = new Date(p.f.split('/').reverse().join('-'));

                      // 1. Calculate transport fingerprints (locators) for this activity
                      const pFPrints = [];
                      const links = bookedLinks[p.id] || {};
                      Object.entries(links).forEach(([url, data]) => {
                        if (url === "__accom__") return; // ignore accommodation for transport grouping
                        let groupKey = url;
                        let hasData = false;
                        if (data && typeof data === 'object') {
                          if (data.segments) {
                            const locs = data.segments.map(s => s.locator).filter(Boolean).sort().join('_');
                            if (locs) { groupKey = locs; hasData = true; }
                          } else if (data.locator) {
                            groupKey = data.locator;
                            hasData = true;
                          }
                        } else if (typeof data === 'string' && data.trim() !== '') {
                          groupKey = data;
                          hasData = true;
                        }
                        // Only add if it's a real recognizable string, skip generic empty manual entries
                        if (hasData && groupKey.trim() !== '') {
                          pFPrints.push(`${url}|${groupKey}`);
                        }
                      });

                      if (p.g) {
                        // USE EXPEDITION ID — each (consultant, expedition) = one trip
                        const key = `${p.cName}|g:${p.g}`;
                        if (!expMap[key]) {
                          const expObj = {
                            id: `exp-${key}`,
                            consultant: p.a,
                            region: p.island || p.r || "General",
                            proposals: [p],
                            firstDate: pDate,
                            lastDate: pDate,
                            firstDateStr: p.f,
                            lastDateStr: p.f,
                            fPrints: [...pFPrints]
                          };
                          expMap[key] = expObj;
                          expeditions.push(expObj);
                        } else {
                          expMap[key].proposals.push(p);
                          expMap[key].fPrints.push(...pFPrints);
                          if (pDate < expMap[key].firstDate) { expMap[key].firstDate = pDate; expMap[key].firstDateStr = p.f; }
                          if (pDate > expMap[key].lastDate) { expMap[key].lastDate = pDate; expMap[key].lastDateStr = p.f; }
                        }
                      } else {
                        // NO EXPEDITION ID:
                        // 1. First check if we share transport locators with ANY existing expedition of this consultant
                        let foundByLinks = null;
                        if (pFPrints.length > 0) {
                          for (let i = expeditions.length - 1; i >= 0; i--) {
                            const ex = expeditions[i];
                            if (ex.consultant === p.a && ex.fPrints) {
                              const shared = pFPrints.some(fp => ex.fPrints.includes(fp));
                              if (shared) { foundByLinks = ex; break; }
                            }
                          }
                        }

                        if (foundByLinks) {
                          foundByLinks.proposals.push(p);
                          foundByLinks.fPrints.push(...pFPrints);
                          if (pDate < foundByLinks.firstDate) { foundByLinks.firstDate = pDate; foundByLinks.firstDateStr = p.f; }
                          if (pDate > foundByLinks.lastDate) { foundByLinks.lastDate = pDate; foundByLinks.lastDateStr = p.f; }
                        } else {
                          // 2. FALLBACK: group by consultant+region and split on gaps > 14 days
                          const regionKey = p.island || p.r || "General";
                          const bucketKey = `${p.cName}|${regionKey}`;
                          // Find the most recent open expedition for this bucket
                          let found = null;
                          for (let i = expeditions.length - 1; i >= 0; i--) {
                            const ex = expeditions[i];
                            if (ex._bucketKey === bucketKey) {
                              const diffDays = Math.abs(pDate - ex.lastDate) / (1000 * 60 * 60 * 24);
                              if (diffDays <= 14) { found = ex; break; }
                            }
                          }
                          if (found) {
                            found.proposals.push(p);
                            if (found.fPrints) found.fPrints.push(...pFPrints);
                            if (pDate < found.firstDate) { found.firstDate = pDate; found.firstDateStr = p.f; }
                            if (pDate > found.lastDate) { found.lastDate = pDate; found.lastDateStr = p.f; }
                          } else {
                            const expObj = {
                              id: `exp-${bucketKey}-${expeditions.length}-${Math.random().toString(36).substr(2, 5)}`,
                              consultant: p.a,
                              region: regionKey,
                              proposals: [p],
                              firstDate: pDate,
                              lastDate: pDate,
                              firstDateStr: p.f,
                              lastDateStr: p.f,
                              _bucketKey: bucketKey,
                              fPrints: [...pFPrints]
                            };
                            expeditions.push(expObj);
                          }
                        }
                      }
                    });

                    // === MERGE PASS ===
                    // After initial grouping, merge expeditions from the same consultant
                    // that share transport fingerprints (e.g. same flight locators, same car rental).
                    // This handles cases where different expedition IDs share the same bookings.
                    let mergeOccurred = true;
                    while (mergeOccurred) {
                      mergeOccurred = false;
                      for (let i = 0; i < expeditions.length; i++) {
                        const exA = expeditions[i];
                        if (!exA || !exA.fPrints || exA.fPrints.length === 0) continue;
                        for (let j = i + 1; j < expeditions.length; j++) {
                          const exB = expeditions[j];
                          if (!exB || !exB.fPrints || exB.fPrints.length === 0) continue;
                          // Must be the same consultant
                          if (exA.consultant !== exB.consultant) continue;
                          // Check if they share any transport fingerprint
                          const shared = exA.fPrints.some(fp => exB.fPrints.includes(fp));
                          if (shared) {
                            // Merge B into A
                            exA.proposals.push(...exB.proposals);
                            exA.fPrints.push(...exB.fPrints);
                            if (exB.firstDate < exA.firstDate) { exA.firstDate = exB.firstDate; exA.firstDateStr = exB.firstDateStr; }
                            if (exB.lastDate > exA.lastDate) { exA.lastDate = exB.lastDate; exA.lastDateStr = exB.lastDateStr; }
                            // Merge region info
                            if (exB.region && exB.region !== exA.region) {
                              exA.region = exA.region + ", " + exB.region;
                            }
                            // Remove B from the array
                            expeditions.splice(j, 1);
                            j--; // re-check this index
                            mergeOccurred = true;
                          }
                        }
                      }
                    }

                    // Also merge expeditions from the same consultant that share accommodation (__accom__)
                    // Look for shared accommodation hotel name
                    mergeOccurred = true;
                    while (mergeOccurred) {
                      mergeOccurred = false;
                      for (let i = 0; i < expeditions.length; i++) {
                        const exA = expeditions[i];
                        if (!exA) continue;
                        // Get accommodation for exA
                        const accomA = new Set();
                        exA.proposals.forEach(p => {
                          const links = bookedLinks[p.id] || {};
                          if (links.__accom__?.hotel) accomA.add(links.__accom__.hotel);
                        });
                        if (accomA.size === 0) continue;

                        for (let j = i + 1; j < expeditions.length; j++) {
                          const exB = expeditions[j];
                          if (!exB) continue;
                          if (exA.consultant !== exB.consultant) continue;
                          // Get accommodation for exB
                          let sharedAccom = false;
                          exB.proposals.forEach(p => {
                            const links = bookedLinks[p.id] || {};
                            if (links.__accom__?.hotel && accomA.has(links.__accom__.hotel)) sharedAccom = true;
                          });
                          if (sharedAccom) {
                            exA.proposals.push(...exB.proposals);
                            if (exA.fPrints && exB.fPrints) exA.fPrints.push(...exB.fPrints);
                            if (exB.firstDate < exA.firstDate) { exA.firstDate = exB.firstDate; exA.firstDateStr = exB.firstDateStr; }
                            if (exB.lastDate > exA.lastDate) { exA.lastDate = exB.lastDate; exA.lastDateStr = exB.lastDateStr; }
                            if (exB.region && exB.region !== exA.region) {
                              exA.region = exA.region + ", " + exB.region;
                            }
                            expeditions.splice(j, 1);
                            j--;
                            mergeOccurred = true;
                          }
                        }
                      }
                    }

                    // Sort expeditions by consultant name, then by first date
                    expeditions.sort((a, b) => {
                      const nameCompare = a.consultant.localeCompare(b.consultant);
                      if (nameCompare !== 0) return nameCompare;
                      return a.firstDate - b.firstDate;
                    });

                    // Group expeditions by consultant
                    const consultantGroups = {};
                    expeditions.forEach(ex => {
                      if (!consultantGroups[ex.consultant]) {
                        consultantGroups[ex.consultant] = [];
                      }
                      consultantGroups[ex.consultant].push(ex);
                    });

                    // Helper: get company name from URL
                    const getCompanyName = (url) => {
                      const u = (url || "").toLowerCase();
                      if (u.includes("binter")) return "Binter Canarias";
                      if (u.includes("vueling")) return "Vueling";
                      if (u.includes("iberia")) return "Iberia";
                      if (u.includes("renfe")) return "Renfe";
                      if (u.includes("iryo")) return "Iryo";
                      if (u.includes("trainline")) return "Trainline";
                      if (u.includes("cicar")) return "CICAR";
                      if (u.includes("goldcar")) return "Goldcar";
                      if (u.includes("okmobility") || u.includes("mobility")) return "OK Mobility";
                      if (u.includes("europcar")) return "Europcar";
                      if (u.includes("skyscanner")) return "Skyscanner";
                      if (u.includes("google")) return "Google Flights";
                      if (u === "manual_entry" || u.startsWith("manual_")) return "Entrada Manual";
                      return "Reserva";
                    };
                    const getBookingIcon = (url) => {
                      const u = (url || "").toLowerCase();
                      if (u.includes("cicar") || u.includes("mobility") || u.includes("rent") || u.includes("goldcar") || u.includes("europcar")) return "🚗";
                      if (u.includes("renfe") || u.includes("iryo") || u.includes("trainline")) return "🚄";
                      return "✈️";
                    };

                    // 3. Render by Consultant
                    Object.entries(consultantGroups).forEach(([consultantName, consExpeditions]) => {
                      const totalActivities = consExpeditions.reduce((sum, ex) => sum + ex.proposals.length, 0);
                      const consultantData = activeConsultants[consultantName] || {};

                      elements.push(
                        <div key={`cons-${consultantName}`} style={{ marginBottom: 28 }}>
                          {/* ===== CONSULTANT HEADER ===== */}
                          <div style={{
                            background: "linear-gradient(135deg, #1E293B 0%, #334155 100%)",
                            padding: "16px 24px",
                            borderRadius: "16px 16px 0 0",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                              <div style={{
                                width: 44, height: 44, borderRadius: 12,
                                background: "rgba(99,102,241,0.2)", border: "2px solid rgba(99,102,241,0.4)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 18, fontWeight: 800, color: "#A5B4FC"
                              }}>
                                {consultantName.charAt(0)}
                              </div>
                              <div>
                                <div style={{ fontSize: 17, fontWeight: 800, color: "white" }}>{consultantName}</div>
                                <div style={{ fontSize: 11, color: "#94A3B8" }}>
                                  📍 {consultantData.base || "—"}
                                  {consultantData.island && <span> • 🏝️ {consultantData.island}</span>}
                                  {consultantData.region && <span style={{ marginLeft: 8, opacity: 0.7 }}>{consultantData.region}</span>}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div style={{ background: "rgba(255,255,255,0.1)", padding: "6px 14px", borderRadius: 8, color: "#E2E8F0", fontSize: 12, fontWeight: 600 }}>
                                {consExpeditions.length} {consExpeditions.length === 1 ? "expedición" : "expediciones"} • {totalActivities} visitas
                              </div>
                              <button
                                onClick={() => {
                                  const allConsIds = consExpeditions.flatMap(ex => ex.proposals.map(p => p.id));
                                  allConsIds.forEach(id => toggleFinalize(id));
                                }}
                                style={{ background: "rgba(255,255,255,0.1)", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.2)", padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                              >
                                ↩️ Reabrir Todos
                              </button>
                            </div>
                          </div>

                          {/* ===== EXPEDITIONS FOR THIS CONSULTANT ===== */}
                          <div style={{ background: "#F8FAFC", borderRadius: "0 0 16px 16px", border: "1px solid #E2E8F0", borderTop: "none" }}>
                            {consExpeditions.map((ex, exIdx) => {
                              const hotelNames = [...new Set(ex.proposals.map(p => p.e))];
                              const uniqueRegions = [...new Set(ex.proposals.map(p => p.r).filter(Boolean))];
                              const uniqueIslands = [...new Set(ex.proposals.map(p => p.island).filter(Boolean))];
                              const uniqueMunis = [...new Set(ex.proposals.map(p => p.destMuni).filter(Boolean))];
                              let locationStr = "";
                              if (uniqueRegions.length > 0) locationStr += uniqueRegions.join(", ");
                              if (uniqueIslands.length > 0) locationStr += (locationStr ? " • " : "") + uniqueIslands.join(", ");
                              if (uniqueMunis.length > 0) locationStr += (locationStr ? " • " : "") + uniqueMunis.join(", ");
                              if (!locationStr) locationStr = ex.region;

                              const allIds = ex.proposals.map(p => p.id);

                              // Collect bookings (deduplicated)
                              const uniqueBookings = {};
                              let accomBooking = null;
                              ex.proposals.forEach(p => {
                                const links = bookedLinks[p.id] || {};
                                Object.entries(links).forEach(([url, data]) => {
                                  if (url === "__accom__") { accomBooking = data; return; }
                                  let groupKey = url;
                                  if (data && typeof data === 'object') {
                                    if (data.segments) {
                                      const locs = data.segments.map(s => s.locator).sort().join('_');
                                      if (locs) groupKey = locs;
                                    } else if (data.locator) groupKey = data.locator;
                                  } else if (typeof data === 'string') groupKey = data;
                                  uniqueBookings[groupKey] = { url, data };
                                });
                              });

                              // Group proposals by hotel for detail display
                              const hotelDetails = {};
                              ex.proposals.forEach(p => {
                                if (!hotelDetails[p.e]) hotelDetails[p.e] = { dates: [], activities: [], munis: new Set(), tType: p.tType };
                                hotelDetails[p.e].dates.push(p.f);
                                hotelDetails[p.e].activities.push(p);
                                if (p.destMuni) hotelDetails[p.e].munis.add(p.destMuni);
                              });

                              const hasBookings = Object.keys(uniqueBookings).length > 0 || accomBooking;

                              return (
                                <div key={ex.id} style={{
                                  margin: "0 16px",
                                  padding: "20px 0",
                                  borderBottom: exIdx < consExpeditions.length - 1 ? "1px solid #E2E8F0" : "none"
                                }}>
                                  {/* Expedition Header */}
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 16 }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        <span style={{ fontSize: 10, fontWeight: 800, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                          {consExpeditions.length > 1 ? `Expedición ${exIdx + 1} de ${consExpeditions.length}` : "Expedición / Viaje"}
                                        </span>
                                        {ex.proposals.some(p => p._isAdHoc) && (
                                          <span style={{ background: "#DBEAFE", color: "#1D4ED8", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 800 }}>✨ VIAJE AD-HOC</span>
                                        )}
                                        {ex.proposals[0]?.g && (

                                          <span style={{ background: "#EEF2FF", color: "#4F46E5", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                            Exp: {ex.proposals[0].g}
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 4 }}>📍 {locationStr}</div>
                                      <div style={{ fontSize: 12, color: "#6366F1", fontWeight: 700 }}>
                                        📅 {ex.firstDateStr} → {ex.lastDateStr}
                                        <span style={{ marginLeft: 10, color: "#64748B", fontWeight: 500 }}>({ex.proposals.length} {ex.proposals.length === 1 ? "visita" : "visitas"})</span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); allIds.forEach(id => toggleFinalize(id)); }}
                                      style={{ background: "white", color: "#6B7280", border: "1px solid #E2E8F0", padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                                    >
                                      ↩️ Reabrir
                                    </button>
                                  </div>

                                  {/* Hotels Detail Table */}
                                  <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden", marginBottom: hasBookings ? 16 : 0 }}>
                                    <div style={{ padding: "10px 14px", background: "#F1F5F9", borderBottom: "1px solid #E2E8F0", fontSize: 11, fontWeight: 700, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
                                      🏨 Hoteles Visitados
                                    </div>
                                    <div style={{ padding: 0 }}>
                                      {Object.entries(hotelDetails).map(([hotelName, detail], hIdx) => (
                                        <div key={hIdx} style={{
                                          display: "flex", alignItems: "center", padding: "10px 14px", gap: 12,
                                          borderBottom: hIdx < Object.keys(hotelDetails).length - 1 ? "1px solid #F1F5F9" : "none"
                                        }}>
                                          <div style={{ width: 32, height: 32, borderRadius: 8, background: TRANSPORT_META[detail.tType]?.bg || "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                                            {TRANSPORT_META[detail.tType]?.icon || "🏨"}
                                          </div>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hotelName}</div>
                                            <div style={{ fontSize: 10, color: "#64748B" }}>
                                              {[...detail.munis].join(", ")}
                                              {detail.activities[0]?.d && <span> • {detail.activities[0].d}</span>}
                                            </div>
                                          </div>
                                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                            <TransportBadge type={detail.tType} />
                                          </div>
                                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: "#6366F1" }}>{detail.dates.length} {detail.dates.length === 1 ? "jornada" : "jornadas"}</div>
                                            <div style={{ fontSize: 10, color: "#94A3B8" }}>{detail.dates.join(", ")}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Accommodation + Transport Bookings */}
                                  {hasBookings && (
                                    <div style={{ display: "grid", gridTemplateColumns: accomBooking && Object.keys(uniqueBookings).length > 0 ? "1fr 1fr" : "1fr", gap: 12 }}>
                                      {/* Accommodation */}
                                      {accomBooking && (
                                        <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 12, padding: 14 }}>
                                          <div style={{ fontSize: 10, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", marginBottom: 10 }}>🛏️ Alojamiento del Consultor</div>
                                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{ width: 36, height: 36, background: "#DCFCE7", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🏨</div>
                                            <div style={{ flex: 1 }}>
                                              <div style={{ fontWeight: 800, fontSize: 13, color: "#15803D" }}>{accomBooking.hotel}</div>
                                              <div style={{ fontSize: 11, color: "#16A34A", fontWeight: 600 }}>📍 {accomBooking.zona}</div>
                                              {accomBooking.date && <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>📅 {accomBooking.date}</div>}
                                            </div>
                                            {accomBooking.locator && (
                                              <div style={{ background: "white", padding: "6px 10px", borderRadius: 8, border: "1px solid #BBF7D0", textAlign: "center" }}>
                                                <div style={{ fontSize: 8, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>Localizador</div>
                                                <div style={{ fontWeight: 900, fontSize: 14, color: "#0D4BD9", letterSpacing: 2 }}>{accomBooking.locator}</div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      {/* Transport Bookings */}
                                      {Object.keys(uniqueBookings).length > 0 && (
                                        <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 12, padding: 14 }}>
                                          <div style={{ fontSize: 10, fontWeight: 800, color: "#0369A1", textTransform: "uppercase", marginBottom: 10 }}>🎫 Reservas de Transporte</div>
                                          <div style={{ display: "grid", gap: 8 }}>
                                            {Object.values(uniqueBookings).map(({ url, data }, idx) => {
                                              const segments = data?.segments || [{ type: data?.type || "ida", locator: data?.locator || data, date: data?.date || "" }];
                                              return (
                                                <div key={idx} style={{ background: "white", borderRadius: 8, padding: 10, border: "1px solid #E0F2FE" }}>
                                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                                    <span style={{ fontSize: 14 }}>{getBookingIcon(url)}</span>
                                                    <span style={{ fontWeight: 800, fontSize: 12, color: "#0369A1" }}>{getCompanyName(url)}</span>
                                                  </div>
                                                  <div style={{ display: "grid", gap: 4 }}>
                                                    {segments.map((seg, si) => (
                                                      <div key={si} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "#F8FAFC", borderRadius: 6, fontSize: 11 }}>
                                                        <span style={{ fontWeight: 600, color: "#475569" }}>
                                                          {seg.type === "ida" ? "🛫 Ida" : seg.type === "vuelta" ? "🛬 Vuelta" : seg.type === "recogida" ? "🏁 Recogida" : seg.type === "devolución" ? "🔄 Devolución" : seg.type}
                                                        </span>
                                                        <div style={{ textAlign: "right" }}>
                                                          <span style={{ fontWeight: 800, color: "#0D4BD9", letterSpacing: 1 }}>{seg.locator}</span>
                                                          {seg.date && <span style={{ marginLeft: 8, fontSize: 10, color: "#94A3B8" }}>{seg.date}</span>}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  } else {
                    // Standard proposals view
                    filtered.forEach(p => {
                      elements.push(
                        <div key={p.id} style={{
                          background: p._isAdHoc ? "#F0F7FF" : "white",
                          borderRadius: 12,
                          border: selectedIds.has(p.id) ? "2px solid #0D4BD9" : (approvedIds.has(p.id) ? "1px solid #10B981" : (p._isAdHoc ? "1px solid #BFDBFE" : "1px solid #eee")),
                          overflow: "hidden",
                          position: "relative"
                        }}>

                          <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 16 }}>
                            <div
                              onClick={() => toggleSelect(p.id)}
                              style={{
                                width: 22, height: 22, borderRadius: 6, border: `2px solid ${selectedIds.has(p.id) ? "#0D4BD9" : "#CBD5E0"}`,
                                background: selectedIds.has(p.id) ? "#0D4BD9" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
                              }}
                            >
                              {selectedIds.has(p.id) && <span style={{ color: "white", fontSize: 12 }}>✓</span>}
                            </div>

                            <div onClick={() => setExpandedId(expandedId === p.id ? null : p.id)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}>
                              <div style={{ width: 40, height: 40, borderRadius: 10, background: TRANSPORT_META[p.tType]?.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>{TRANSPORT_META[p.tType]?.icon}</div>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{p.e}</div>
                                  <div style={{ fontSize: 10, background: "#EEF2FF", color: "#4F46E5", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>👤 {p.a}</div>
                                  {p._isAdHoc && (
                                    <div style={{ fontSize: 10, background: "#DBEAFE", color: "#1D4ED8", padding: "2px 8px", borderRadius: 4, fontWeight: 800 }}>✨ AD-HOC</div>
                                  )}
                                  {p.g ? <span style={{ fontSize: 10, color: "#7C3AED", background: "#F3E8FF", padding: "2px 6px", borderRadius: 4 }}>{p.g}</span> : ""}

                                </div>
                                <div style={{ fontSize: 11, color: "#666" }}>
                                  {p.routeLabel}
                                  {p.km > 0 && <span style={{ fontWeight: 700, color: "#111", marginLeft: 8 }}>📍 {p.km} km</span>}
                                </div>
                                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                                  {p.d} • {p.f}
                                  {p.isGenericAddress && <span style={{ marginLeft: 10, color: "#EAB308", fontWeight: 700, fontSize: 10 }}>⚠️ VALIDAR UBICACIÓN</span>}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <TransportBadge type={p.tType} />
                              {view !== "managed" && ["vuelo", "tren", "auto"].includes(p.tType) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (selectedIds.has(p.id)) {
                                      handleBookSelection(p.cName); // Unify all selected items of this consultant
                                    } else {
                                      setBookingTarget({
                                        consultant: p.a,
                                        activity: { ...p, startDate: p.f, endDate: p.f },
                                        transportType: p.tType,
                                        establishments: [p.e],
                                        groupStartDate: p.f,
                                        groupEndDate: p.groupEndDate || p.endDate || p.f
                                      });
                                    }
                                  }}
                                  style={{ background: "#0D4BD9", color: "white", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                                >
                                  {selectedIds.has(p.id)
                                    ? `Reservar (${proposals.filter(s => selectedIds.has(s.id) && s.cName === p.cName).length})`
                                    : "Reservar"}
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (selectedIds.has(p.id)) {
                                    handleBulkFinalize(p.cName);
                                  } else {
                                    toggleFinalize(p.id);
                                  }
                                }}
                                style={{ background: finalizedIds.has(p.id) ? "#6B7280" : "#10B981", color: "white", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                              >
                                {selectedIds.has(p.id)
                                  ? (view === "managed"
                                    ? `Reabrir (${proposals.filter(s => selectedIds.has(s.id) && s.cName === p.cName).length})`
                                    : `Finalizar (${proposals.filter(s => selectedIds.has(s.id) && s.cName === p.cName).length})`)
                                  : (finalizedIds.has(p.id) ? "Undo" : "Finalizar")}
                              </button>


                            </div>
                          </div>

                          {expandedId === p.id && (
                            <div style={{ padding: "0 16px 16px", background: "#fafafa", borderTop: "1px solid #eee" }}>
                              <div style={{ paddingTop: 16, display: "flex", flexDirection: "column", gap: 12, borderBottom: "1px solid #eee", paddingBottom: 16 }}>
                                <div style={{ display: "flex", gap: 12 }}>
                                  <span style={{ fontSize: 18 }}>🏠</span>
                                  <div>
                                    <div style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase" }}>Origen</div>
                                    <div style={{ fontSize: 13, color: "#111", fontWeight: 600 }}>{p.originMuni} / {p.originDisplay}</div>
                                    <div style={{ fontSize: 12, color: "#666" }}>{p.originAddress}</div>
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: 12 }}>
                                  <span style={{ fontSize: 18 }}>📍</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Destino</div>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 13, color: "#111", fontWeight: 600, marginBottom: 2 }}>{p.destMuni} / {p.destDisplay}</div>
                                        <div style={{ fontSize: 12, color: "#666" }}>{p.destAddress}</div>
                                      </div>
                                      <a
                                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.e}${p.g ? ' ' + p.g : ''}, España`)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ background: "#0D4BD9", color: "white", border: "none", padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}
                                      >
                                        🗺️ Maps
                                      </a>
                                    </div>
                                    <GeocodingValidationPanel
                                      proposal={p}
                                      geocodeState={geocodeResults[p.id]}
                                      onSearch={async () => {
                                        // Set loading
                                        setGeocodeResults(prev => ({ ...prev, [p.id]: { loading: true, results: null, error: null, selected: null, editing: false } }));
                                        try {
                                          const query = `${p.e}${p.g ? " " + p.g : ""}, España`;
                                          const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&countrycodes=es`);
                                          const data = await resp.json();
                                          if (data.length > 0) {
                                            setGeocodeResults(prev => ({ ...prev, [p.id]: { loading: false, results: data, error: null, selected: 0, editing: false } }));
                                          } else {
                                            // Retry with just establishment name
                                            const resp2 = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(p.e + ", España")}&format=json&addressdetails=1&limit=5&countrycodes=es`);
                                            const data2 = await resp2.json();
                                            setGeocodeResults(prev => ({ ...prev, [p.id]: { loading: false, results: data2.length > 0 ? data2 : null, error: data2.length === 0 ? "no_results" : null, selected: data2.length > 0 ? 0 : null, editing: data2.length === 0 } }));
                                          }
                                        } catch (e) {
                                          setGeocodeResults(prev => ({ ...prev, [p.id]: { loading: false, results: null, error: "network", selected: null, editing: true } }));
                                        }
                                      }}
                                      onSelectResult={(idx) => {
                                        setGeocodeResults(prev => ({ ...prev, [p.id]: { ...prev[p.id], selected: idx } }));
                                      }}
                                      onConfirm={(address, municipality) => {
                                        updateEstablishmentAddress(p.e, address, municipality);
                                        setGeocodeResults(prev => ({ ...prev, [p.id]: undefined }));
                                        setExpandedId(null); // Collapse the card
                                        setUploadFlash(`✅ Dirección actualizada: ${p.e}`);
                                        setTimeout(() => setUploadFlash(null), 3000);
                                      }}
                                      onEditManually={() => {
                                        setGeocodeResults(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), editing: true } }));
                                      }}
                                      onUpdateAddress={updateEstablishmentAddress}
                                    />
                                    {!geocodeResults[p.id] && (
                                      <button
                                        onClick={() => setGeocodeResults(prev => ({ ...prev, [p.id]: { editing: true } }))}
                                        style={{ marginTop: 8, background: "#F3F4F6", color: "#374151", border: "1px solid #D1D5DB", padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                                      >
                                        ✏️ Editar Dirección
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div style={{ paddingTop: 16, display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: "#444", alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8f9fa", padding: "6px 12px", borderRadius: 20, border: "1px solid #eee" }}>
                                  <span style={{ fontSize: 14 }}>🏷️</span>
                                  <div>
                                    <span style={{ fontSize: 10, textTransform: "uppercase", color: "#999", fontWeight: 700, marginRight: 4 }}>Grupo</span>
                                    <span style={{ fontWeight: 600 }}>{p.g || "-"}</span>
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8f9fa", padding: "6px 12px", borderRadius: 20, border: "1px solid #eee" }}>
                                  <span style={{ fontSize: 14 }}>📋</span>
                                  <div>
                                    <span style={{ fontSize: 10, textTransform: "uppercase", color: "#999", fontWeight: 700, marginRight: 4 }}>Actividad</span>
                                    <span style={{ fontWeight: 600 }}>{p.d || "-"}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    });
                  }
                  return elements;
                })()}
              </div>

            </div>
          )}

          {/* VIEW: SUMMARY */}
          {view === "summary" && (
            <div style={{ background: "white", borderRadius: 16, overflow: "hidden", border: "1px solid #eee" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead style={{ background: "#f8f9fa", borderBottom: "1px solid #eee" }}>
                  <tr>
                    <th style={{ padding: 12, textAlign: "left" }}>Consultor</th>
                    <th style={{ padding: 12, textAlign: "center" }}>Total</th>
                    <th style={{ padding: 12, textAlign: "center" }}>✈️</th>
                    <th style={{ padding: 12, textAlign: "center" }}>🚄</th>
                    <th style={{ padding: 12, textAlign: "center" }}>🚗</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summaryByAuditor).map(([name, d]) => (
                    <tr key={name} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: 12, fontWeight: 500 }}>{name}</td>
                      <td style={{ padding: 12, textAlign: "center", fontWeight: 700 }}>{d.total}</td>
                      <td style={{ padding: 12, textAlign: "center", color: "#0D4BD9", fontWeight: d.vuelo ? 700 : 400 }}>{d.vuelo}</td>
                      <td style={{ padding: 12, textAlign: "center", color: "#7C3AED", fontWeight: d.tren ? 700 : 400 }}>{d.tren}</td>
                      <td style={{ padding: 12, textAlign: "center", color: "#059669", fontWeight: d.vehiculo ? 700 : 400 }}>{d.vehiculo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === "consultants" && (
            <ConsultantList
              consultants={activeConsultants}
              onUpdate={updateConsultant}
              onDelete={handleDeleteConsultant}
            />
          )}
        </div>
      </AppLayout>
    </>
  );
}
