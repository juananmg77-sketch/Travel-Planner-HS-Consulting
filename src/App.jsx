import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Papa from "papaparse";
import CLIENT_DATA from './clientData.json';
import { signIn, signOut, getCurrentSession, getUserProfile, onAuthStateChange } from './supabaseAuth';
import { upsertEstablishment, updateActivityAddress, updateActivityTransport, logAction, getAllDistances, upsertDistance } from './supabaseService';

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
  "Gorka Sanchez Ortega": { base: "Costa Teguise", email: "gsanchezortega@hsconsulting.es", region: "Islas Canarias", pref: "auto", island: "Lanzarote", airport: "ACE", station: null, address: "Costa Teguise, Lanzarote" },
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

  // Already validated (not generic address)
  if (!p.isGenericAddress) return null;

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

function Dashboard({ stats, summaryByAuditor, onNavigate, onTriggerPlanning, onTriggerConsultants, uploadFlash, onClearData, onLogout }) {
  const consultants = Object.entries(summaryByAuditor || {}).sort((a, b) => b[1].total - a[1].total);

  return (
    <div>
      <div style={{ marginBottom: 40, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "#111", margin: "0 0 8px" }}>Dashboard Logística</h2>
          <p style={{ fontSize: 16, color: "#666", margin: 0 }}>Recursos y planificación operativa HS</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => onNavigate("consultants")}
            style={{ background: "white", color: "#111", border: "1px solid #ddd", padding: "10px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#111"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#ddd"}
          >
            👥 Gestión Consultores
          </button>
          <button
            onClick={onTriggerPlanning}
            style={{ background: "#0D4BD9", color: "white", border: "none", padding: "10px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 12px rgba(13, 75, 217, 0.2)" }}
          >
            📅 Cargar Agenda (CSV)
          </button>
          {onClearData && (
            <button
              onClick={() => { if (confirm("¿Estás seguro de que quieres BORRAR toda la planificación? Esta acción no se puede deshacer.")) onClearData(); }}
              style={{ background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FCA5A5", padding: "10px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            >
              🗑️ Limpiar
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              style={{ background: "white", color: "#666", border: "1px solid #ddd", padding: "10px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            >
              🚪 Cerrar Sesión
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

function BookingPanel({ consultant, activity, transportType, establishments, consultants, onClose, onUpdateClientAddress, bookedLinks = {}, onMarkBooked }) {
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [error, setError] = useState(null);
  const [editAddress, setEditAddress] = useState(activity.destAddress || "");
  const [editMuni, setEditMuni] = useState(activity.destMuni || "");
  const [isUpdatingAddr, setIsUpdatingAddr] = useState(false);

  // Suggested Dates state
  const [panelStartDate, setPanelStartDate] = useState(activity.startDate || activity.f);
  const [panelEndDate, setPanelEndDate] = useState(activity.endDate || activity.f);

  const [activeBookingUrl, setActiveBookingUrl] = useState(null);
  const [activeBookingLabel, setActiveBookingLabel] = useState("");

  // Segment 1
  const [locatorCode, setLocatorCode] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingType, setBookingType] = useState("ida");

  // Segment 2 (Dual mode)
  const [locatorCode2, setLocatorCode2] = useState("");
  const [bookingDate2, setBookingDate2] = useState("");
  const [bookingType2, setBookingType2] = useState("vuelta");
  const [isDualMode, setIsDualMode] = useState(false);

  const c = (consultants || CONSULTANTS)[consultant] || {};
  const dest = REGION_DEST[activity.r] || {};

  const directLinks = useMemo(() => {
    const links = [];
    const destCity = dest.city || activity.destMuni || activity.r;
    const originCity = c.base || "Desconocido";

    if (transportType === "vuelo") {
      const originRegion = normalizeRegion(c.region);
      const destRegion = normalizeRegion(activity.r);
      const isCanaryFlight = originRegion === "Islas Canarias" || destRegion === "Islas Canarias";

      if (isCanaryFlight) {
        links.push({ label: "Binter Canarias", url: buildBinterUrl(c.airport, dest.airport, activity.startDate, activity.endDate), icon: "🇮🇨", desc: isCanaryFlight && originRegion === destRegion ? "Inter-islas" : "Vuelos Binter" });
      }

      links.push({ label: "Google Flights", url: buildGoogleFlightsUrl(originCity, destCity, activity.startDate, activity.endDate), icon: "🔍", desc: "Comparador" });
      links.push({ label: "Skyscanner", url: buildSkyscannerUrl(c.airport || "", dest.airport || "", activity.startDate, activity.endDate), icon: "🔎", desc: "Comparador" });
      links.push({ label: "Vueling", url: buildVuelingUrl(c.airport || "", dest.airport || "", activity.startDate, activity.endDate), icon: "✈️", desc: "Directo" });
      links.push({ label: "Iberia", url: buildIberiaUrl(c.airport || "", dest.airport || "", activity.startDate, activity.endDate), icon: "🇪🇸", desc: "Directo" });

      if (destRegion === "Islas Canarias") {
        links.push({ label: "CICAR", url: buildRentACarUrl("cicar", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      } else {
        links.push({ label: "OK Mobility", url: buildRentACarUrl("okmobility", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      }
    } else if (transportType === "tren") {
      links.push({ label: "Trainline", url: buildTrainlineUrl(originCity, destCity, activity.startDate || activity.f), icon: "🔍", desc: "Comparador (Renfe, Iryo...)" });
      links.push({ label: "Renfe", url: buildRenfeUrl(c.station, dest.station, activity.startDate || activity.f), icon: "🚄", desc: "AVE / Avlo" });
      links.push({ label: "Iryo", url: buildIryoUrl(originCity, destCity, activity.startDate || activity.f), icon: "🟣", desc: "Alta Velocidad" });
      links.push({ label: "OK Mobility", url: buildRentACarUrl("okmobility", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
    } else {
      links.push({ label: "Google Maps", url: buildGMapsUrl(originCity, `${activity.e} ${destCity}`), icon: "🗺️", desc: "Ruta" });
      const destRegion = normalizeRegion(activity.r);
      if (destRegion === "Islas Canarias") {
        links.push({ label: "CICAR", url: buildRentACarUrl("cicar", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      } else {
        links.push({ label: "OK Mobility", url: buildRentACarUrl("okmobility", destCity, activity.startDate, activity.endDate), icon: "🚗", desc: `Coche en ${destCity}` });
      }
    }
    return links;
  }, [transportType, c, dest, activity]);


  const handleLinkClick = (e, link) => {
    e.preventDefault();
    window.open(link.url, '_blank');
    setActiveBookingUrl(link.url);
    setActiveBookingLabel(link.label);

    const dualProviders = ["Vueling", "Iberia", "Binter Canarias", "Renfe", "Iryo", "CICAR", "OK Mobility", "Trainline"];
    const isDual = dualProviders.includes(link.label);
    setIsDualMode(isDual);

    if (link.label.toLowerCase().includes("regreso") || link.label.toLowerCase().includes("vuelta")) {
      setBookingType("vuelta");
      setBookingDate(panelEndDate);
      setIsDualMode(false);
    } else if (isDual) {
      if (transportType === "auto") {
        setBookingType("recogida");
        setBookingType2("devolución");
      } else {
        setBookingType("ida");
        setBookingType2("vuelta");
      }
      setBookingDate(panelStartDate);
      setBookingDate2(panelEndDate);
      setLocatorCode("");
      setLocatorCode2("");
    } else {
      setBookingType("ida");
      setBookingDate(panelStartDate);
      setIsDualMode(false);
    }
  };

  const confirmBooking = () => {
    if (!locatorCode.trim() && !locatorCode2.trim()) {
      alert("Es obligatorio incluir al menos un número de localizador.");
      return;
    }

    const segments = [];
    if (locatorCode.trim()) {
      segments.push({ type: bookingType, date: bookingDate || panelStartDate, locator: locatorCode.trim() });
    }
    if (isDualMode && locatorCode2.trim()) {
      segments.push({ type: bookingType2, date: bookingDate2 || panelEndDate, locator: locatorCode2.trim() });
    }

    const data = {
      locator: segments[0]?.locator || "", // for backward compatibility
      segments: segments
    };

    if (onMarkBooked) onMarkBooked(activeBookingUrl, data);
    setLocatorCode("");
    setLocatorCode2("");
    setActiveBookingUrl(null);
  };

  const handleSendEmail = () => {
    const email = c.email || "";
    const name = consultant;
    const hotelsList = (establishments || [activity.e]).join(" / ");
    const date = activity.startDate || activity.f;
    const entries = Object.entries(bookedLinks);

    if (entries.length === 0) {
      alert("No hay reservas confirmadas para enviar.");
      return;
    }

    const subject = `Reserva Logística: ${hotelsList} - ${date}`;
    let body = `Hola ${name},\n\nAquí tienes los detalles de tus reservas para el viaje a: ${hotelsList} (${date}):\n\n`;

    entries.forEach(([url, data]) => {
      const label = directLinks.find(l => l.url === url)?.label || "Proveedor";
      if (data && typeof data === 'object' && data.segments) {
        data.segments.forEach(seg => {
          const typeLabel = seg.type === "ida" ? " (Ida)" : seg.type === "vuelta" ? " (Vuelta)" : seg.type === "recogida" ? " (Recogida)" : seg.type === "devolución" ? " (Devolución)" : ` (${seg.type})`;
          body += `• ${label}${typeLabel}: Localizador ${seg.locator} - Fecha: ${seg.date}\n`;
        });
      } else {
        const code = typeof data === 'object' ? data.locator : data;
        const dateStr = typeof data === 'object' ? data.date : "";
        const typeStr = typeof data === 'object' ? (data.type === "ida" ? " (Ida)" : data.type === "vuelta" ? " (Vuelta)" : "") : "";
        body += `• ${label}${typeStr}: Localizador ${code}${dateStr ? ` - Fecha: ${dateStr}` : ""}\n`;
      }
    });

    body += `\nBuen viaje!`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleAISearch = async () => {
    setLoading(true);
    setAiResult(null);
    setError(null);
    try {
      const resp = await fetch('/api/travel-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transportType, origin: c.base, destination: activity.destMuni, date: activity.startDate || activity.f })
      });
      const data = await resp.json();
      if (data.error) setError(data.error);
      else setAiResult(data);
    } catch (err) {
      setError("Error al conectar con la IA de viajes.");
    } finally {
      setLoading(false);
    }
  };

  // Calculate actual number of hotels/establishments
  const hotelLabel = useMemo(() => {
    const count = establishments.length;
    if (count === 1) return "1 hotel seleccionado";
    return "Múltiples hoteles seleccionados";
  }, [establishments]);

  if (activeBookingUrl) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ background: "white", padding: 32, borderRadius: 24, maxWidth: 500, width: "100%", textAlign: "center", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
          <div style={{ width: 64, height: 64, background: "#EEF2FF", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 20px" }}>✈️</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111", marginBottom: 12 }}>Confirmar Reserva en {activeBookingLabel}</h2>
          <p style={{ color: "#666", fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>Introduce los detalles de la reserva realizada.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Segment 1 */}
            <div style={{ background: "#F8FAFC", padding: 16, borderRadius: 16, border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", textAlign: "left", fontSize: 9, fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 4 }}>
                    {transportType === "auto" ? "🏁 Recogida" : "✈️ Ida / Trayecto"}
                  </label>
                  <input type="text" value={bookingDate} onChange={e => setBookingDate(e.target.value)} placeholder="Fecha" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "2px solid #E2E8F0", fontSize: 13, fontWeight: 600 }} />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ display: "block", textAlign: "left", fontSize: 9, fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 4 }}>Localizador</label>
                  <input type="text" value={locatorCode} onChange={e => setLocatorCode(e.target.value)} placeholder="Código" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "2px solid #E2E8F0", fontSize: 13, fontWeight: 700, textAlign: "center", color: "#0F172A" }} />
                </div>
              </div>
            </div>

            {/* Segment 2 (Dual Mode Only) */}
            {isDualMode && (
              <div style={{ background: "#F8FAFC", padding: 16, borderRadius: 16, border: "1px solid #E2E8F0" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", textAlign: "left", fontSize: 9, fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 4 }}>
                      {transportType === "auto" ? "🔄 Devolución" : "✈️ Vuelta / Regreso"}
                    </label>
                    <input type="text" value={bookingDate2} onChange={e => setBookingDate2(e.target.value)} placeholder="Fecha" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "2px solid #E2E8F0", fontSize: 13, fontWeight: 600 }} />
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ display: "block", textAlign: "left", fontSize: 9, fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 4 }}>Localizador</label>
                    <input type="text" value={locatorCode2} onChange={e => setLocatorCode2(e.target.value)} placeholder="Código" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "2px solid #E2E8F0", fontSize: 13, fontWeight: 700, textAlign: "center", color: "#0F172A" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button onClick={confirmBooking} disabled={!locatorCode.trim() && !locatorCode2.trim()} style={{ width: "100%", background: (!locatorCode.trim() && !locatorCode2.trim()) ? "#CBD5E0" : "#10B981", color: "white", border: "none", padding: "16px", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 20 }}>
            ✅ Confirmar y Guardar
          </button>
          <button onClick={() => setActiveBookingUrl(null)} style={{ width: "100%", background: "white", color: "#6B7280", border: "2px solid #E5E7EB", padding: "12px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 12 }}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
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
                  <div key={i} style={{ background: "rgba(255,255,255,0.7)", padding: "4px 10px", borderRadius: 8, fontSize: 13, fontWeight: 800, color: "#111" }}>
                    🏨 {h}
                  </div>
                ))}
                <div style={{ background: "rgba(255,255,255,0.7)", padding: "4px 10px", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>📅 {panelStartDate} - {panelEndDate}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", padding: 5, color: "#666" }}>&times;</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          {transportType !== "local" && (
            <button onClick={handleAISearch} disabled={loading} style={{ width: "100%", padding: 14, background: loading ? "#eee" : "#111", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer", marginBottom: 24 }}>
              {loading ? "Analizando..." : "✨ Buscar con IA"}
            </button>
          )}
          {error && <div style={{ background: "#FEF2F2", color: "#991B1B", padding: 12, borderRadius: 8, marginBottom: 20 }}>{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
            {directLinks.map((l, i) => {
              const isBooked = bookedLinks[l.url];
              return (
                <a key={i} href={l.url} onClick={(e) => handleLinkClick(e, l)} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "16px", background: isBooked ? "#F0FDF4" : "#f8fafc", border: `2px solid ${isBooked ? "#BBF7D0" : "#e2e8f0"}`, borderRadius: 12, textDecoration: "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>{l.icon}</span> {isBooked && <span>✅</span>}</div>
                  <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 14 }}>{l.label}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {l.desc}
                    {isBooked && (
                      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                        {(isBooked.segments || [{ type: isBooked.type, locator: isBooked.locator, date: isBooked.date }]).map((seg, si) => (
                          <div key={si} style={{ padding: "4px 8px", background: "white", borderRadius: 6, border: "1px solid #BBF7D0", color: "#059669", fontSize: 9, fontWeight: 700 }}>
                            {seg.type.toUpperCase()}: {seg.locator} ({seg.date})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
          <div style={{ background: "#f8fafc", padding: 20, borderRadius: 16, display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #e2e8f0", marginTop: 32 }}>
            <div><div style={{ fontSize: 13, fontWeight: 700 }}>{hotelLabel}</div></div>
            <button onClick={handleSendEmail} disabled={Object.keys(bookedLinks).length === 0} style={{ background: Object.keys(bookedLinks).length === 0 ? "#CBD5E0" : "#111", color: "white", border: "none", padding: "12px 24px", borderRadius: 12, fontWeight: 700 }}>📩 Notificar al Consultor</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AUXILIARY COMPONENTS
// ============================================================

function ConsultantList({ consultants, onUpdate, onDelete }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

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
      <div style={{ padding: 20, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Gestión de Consultores ({filtered.length})</h3>
          <button
            onClick={() => {
              const name = prompt("Nombre completo del nuevo consultor:");
              if (name) onUpdate(name, { base: "Madrid", region: "Madrid", pref: "vehiculo", email: "", address: "" });
            }}
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
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666" }}>Nombre</th>
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666" }}>Base / Ubicación</th>
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666" }}>Dirección</th>
              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666" }}>Región</th>

              <th style={{ padding: "12px 16px", textAlign: "left", color: "#666" }}>Contacto</th>
              <th style={{ padding: "12px 16px", textAlign: "center", color: "#666" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(([name, data]) => (
              <tr key={name} style={{ borderBottom: "1px solid #f0f0f0", background: editingId === name ? "#F9FAFB" : "white" }}>
                <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111" }}>{name}</td>

                {editingId === name ? (
                  <>
                    <td style={{ padding: 8 }}><input style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ddd" }} value={editForm.base || ""} onChange={e => setEditForm({ ...editForm, base: e.target.value })} /></td>
                    <td style={{ padding: 8 }}><input style={{ width: "100%", padding: 6, borderRadius: 4, border: "1px solid #ddd" }} value={editForm.address || ""} onChange={e => setEditForm({ ...editForm, address: e.target.value })} /></td>
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
                    <td style={{ padding: "12px 16px" }}>{data.base || "-"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 11, color: "#555" }}>{data.address || "-"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ padding: "2px 8px", borderRadius: 12, background: "#f3f4f6", fontSize: 11, fontWeight: 500, display: "inline-block" }}>{data.region || "-"}</div>
                      {data.island && <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>🏝️ {data.island}</div>}
                    </td>

                    <td style={{ padding: "12px 16px", color: "#666", fontSize: 12 }}>
                      <div>{data.email || "-"}</div>
                      <div style={{ fontSize: 10, color: "#999" }}>{data.phone || ""}</div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                        <button onClick={() => startEdit(name, data)} style={{ background: "white", color: "#4B5563", border: "1px solid #D1D5DB", padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>✏️</button>
                        <button
                          onClick={() => { if (confirm(`¿Borrar a ${name}?`)) onDelete(name); }}
                          style={{ background: "white", color: "#EF4444", border: "1px solid #FEE2E2", padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                        >
                          🗑️
                        </button>
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

  const [activities, setActivities] = useState(() => {
    const saved = localStorage.getItem("hs_travel_activities");
    return saved ? JSON.parse(saved) : [];
  });
  const [customConsultants, setCustomConsultants] = useState(() => {
    const saved = localStorage.getItem("hs_travel_consultants");
    return saved ? JSON.parse(saved) : null;
  });
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
  const [customClientInfo, setCustomClientInfo] = useState(() => {
    const saved = localStorage.getItem("hs_travel_client_info");
    return saved ? JSON.parse(saved) : {};
  });

  // Sync hardcoded CONSULTANTS into customConsultants (Authoritative Update)
  useEffect(() => {
    if (!customConsultants) return;

    let hasChanges = false;
    const next = { ...customConsultants };

    // For every system consultant, ensure state aligns with the new hardcoded 'Database'
    Object.entries(CONSULTANTS).forEach(([name, data]) => {
      // If consultant is missing OR the data is different (e.g. address updated)
      // referencing JSON.stringify is a cheap way to check for deep changes
      if (!next[name] || JSON.stringify(next[name]) !== JSON.stringify(data)) {
        next[name] = data;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setCustomConsultants(next);
      console.log("✅ Base de datos de consultores sincronizada con el código.");
    }
  }, []); // Run once on mount to sync

  const [bookingConfirmations, setBookingConfirmations] = useState(() => {
    const saved = localStorage.getItem("hs_travel_bookings");
    return saved ? JSON.parse(saved) : {};
  });
  const [expandedId, setExpandedId] = useState(null);
  const [bookingTarget, setBookingTarget] = useState(null);
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
      const mapped = results.data.map((row) => ({
        id: Math.random().toString(36).substr(2, 9),
        a: (row["Auditor"] || row["auditor"] || row["Consultor"] || row["Nombre"] || "").trim(),
        r: (row["Region"] || row["region"] || row["Región"] || "").trim(),
        e: (row["Establecimiento"] || row["establecimiento"] || row["Hotel"] || "").trim(),
        d: (row["Disciplina"] || row["disciplina"] || row["Actividad"] || row["actividad"] || row["Tarea"] || row["Tareas"] || "").trim(),
        f: (row["Fecha"] || row["fecha"] || row["Date"] || "").trim(),
        j: parseFloat((row["Jornada"] || row["jornada"] || row["Jornadas"] || row["jornadas"] || row["Duración"] || "0").replace(",", ".")),
        g: (row["Grupo"] || row["grupo"] || row["Cadena"] || "").trim()
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
      } else {
        alert("No se han encontrado registros nuevos o ya existen en el sistema.");
      }
    });
    e.target.value = ""; // reset
  };

  const handleClearData = () => {
    setActivities([]);
    setUploadFlash("🗑️ Planificación borrada correctamente.");
    setTimeout(() => setUploadFlash(null), 3000);
  };

  // No longer using CSV upload for consultants. Substituted by database management.
  const deleteConsultant = useCallback((name) => {
    setCustomConsultants(prev => {
      const next = prev ? { ...prev } : { ...CONSULTANTS };
      delete next[name];
      return next;
    });
  }, []);

  const activeConsultants = useMemo(() => customConsultants || CONSULTANTS, [customConsultants]);

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

    setBookedLinks(prev => {
      const next = { ...prev };
      idsToUpdate.forEach(id => {
        const current = next[id] || {};
        next[id] = { ...current, [url]: bookingData };
      });
      return next;
    });

    // Automatically "Finalize" the activities if marked as booked
    const nextFinalized = new Set(finalizedIds);
    idsToUpdate.forEach(id => nextFinalized.add(id));
    setFinalizedIds(nextFinalized);

    // Optional: set flash message
    const loc = typeof bookingData === 'object' ? bookingData.locator : bookingData;
    setUploadFlash(`✅ Reserva confirmada con loc: ${loc}`);
    setTimeout(() => setUploadFlash(null), 3000);
  }, [bookingTarget, finalizedIds]);

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

  const updateConsultant = useCallback((name, updatedData) => {
    // If we are using valid customConsultants, update it. 
    // If we are using default CONSULTANTS, we need to clone it to custom first to avoid mutating constant.
    let nextState = customConsultants ? { ...customConsultants } : { ...CONSULTANTS };

    // Ensure we preserve fields that might not be in editForm but exist in original
    nextState[name] = { ...nextState[name], ...updatedData };

    setCustomConsultants(nextState);
  }, [customConsultants]);

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
    const s = { total: proposals.length, pending: 0, managed: 0, vuelo: 0, tren: 0, vehiculo: 0, auto: 0 };
    proposals.forEach(p => {
      if (finalizedIds.has(p.id)) {
        s.managed++;
      } else {
        s.pending++;
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

  const handleBookSelection = () => {
    const selected = proposals.filter(p => selectedIds.has(p.id));
    if (selected.length === 0) return;

    // Use the first and last hotel dates from the selection
    const firstHotel = selected[0];
    const lastHotel = selected[selected.length - 1];

    setBookingTarget({
      consultant: firstHotel.a,
      activity: {
        ...firstHotel,
        startDate: firstHotel.f,
        endDate: lastHotel.f
      },
      transportType: firstHotel.tType,
      establishments: Array.from(new Set(selected.map(s => s.e))),
      selectedIds: Array.from(selectedIds)
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
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFinalizedIds(next);
  };

  const handleBulkFinalize = () => {
    const next = new Set(finalizedIds);
    selectedIds.forEach(id => {
      if (view === "managed") next.delete(id);
      else next.add(id);
    });
    setFinalizedIds(next);
    setSelectedIds(new Set());
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
      await new Promise(r => setTimeout(r, 800)); // Respect Rate Limits (slightly faster)
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
        const data = await res.json();
        if (data && data[0]) {
          const coords = { lat: data[0].lat, lon: data[0].lon };
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
      <div style={{ fontFamily: "Inter, sans-serif", background: "linear-gradient(135deg, #0D1B3E 0%, #1a365d 50%, #0D4BD9 100%)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ background: "rgba(255,255,255,0.07)", backdropFilter: "blur(30px)", borderRadius: 28, padding: 48, maxWidth: 420, width: "100%", boxShadow: "0 30px 80px rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ width: 64, height: 64, background: "linear-gradient(135deg, #3B82F6, #0D4BD9)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 26, fontWeight: 800, margin: "0 auto 20px", boxShadow: "0 8px 24px rgba(13,75,217,0.4)" }}>HS</div>
            <h1 style={{ color: "white", fontSize: 24, fontWeight: 800, margin: "0 0 6px" }}>Travel Planner</h1>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, margin: 0 }}>Acceso exclusivo para el equipo de Logística</p>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder="tu@hsconsulting.es"
                required
                style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "white", fontSize: 15, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s" }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Contraseña</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "white", fontSize: 15, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s" }}
              />
            </div>

            {loginError && (
              <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "10px 14px", borderRadius: 10, marginBottom: 16, color: "#FCA5A5", fontSize: 13 }}>
                ⚠️ {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", background: "linear-gradient(135deg, #3B82F6, #0D4BD9)", color: "white", fontSize: 15, fontWeight: 700, cursor: loginLoading ? "wait" : "pointer", transition: "all 0.2s", opacity: loginLoading ? 0.7 : 1, boxShadow: "0 4px 16px rgba(13,75,217,0.4)" }}
            >
              {loginLoading ? "Accediendo..." : "Acceder"}
            </button>
          </form>

          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 24 }}>HS Consulting © 2026 · Área restringida</p>
        </div>
      </div>
    );
  }

  if (view === "upload") {
    return (
      <div style={{ fontFamily: "Inter, sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <div style={{ padding: 24, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 32, height: 32, background: "#0D4BD9", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700 }}>HS</div>
          <h1 style={{ fontSize: 18, margin: 0 }}>Travel Planner</h1>
        </div>
        <UploadScreen
          onDataLoaded={handleDataLoaded}
          onConsultantsLoaded={setCustomConsultants}
          existingActivities={activities}
        />
      </div>
    );
  }

  if (view === "dashboard") {
    return (
      <div style={{ fontFamily: "Inter, sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <div style={{ padding: 24, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 32, height: 32, background: "#0D4BD9", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700 }}>HS</div>
          <h1 style={{ fontSize: 18, margin: 0 }}>Travel Planner</h1>
        </div>
        <div style={{ padding: "40px 24px", maxWidth: 1000, margin: "0 auto" }}>
          <Dashboard
            stats={stats}
            summaryByAuditor={summaryByAuditor}
            onNavigate={handleNavigate}
            onTriggerPlanning={() => planningInputRef.current.click()}
            uploadFlash={uploadFlash}
            onClearData={handleClearData}
            onLogout={handleLogout}
          />

          <input type="file" ref={planningInputRef} style={{ display: "none" }} accept=".csv" onChange={onUploadPlanning} />


        </div>
      </div>
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
    <div style={{ fontFamily: "Inter, sans-serif", background: "#F4F6F9", minHeight: "100vh", color: "#1a1a2e" }}>
      {renderHeader()}

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
          onUpdateClientAddress={updateEstablishmentAddress} // Pass the missing prop here
        />
      )}

      <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
        {/* VIEW: PROPOSALS / MANAGED */}
        {(view === "proposals" || view === "managed") && (
          <div>
            <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111", margin: 0 }}>
                  {view === "managed" ? "Trayectos Gestionados" : "Propuestas de Logística"}
                </h2>
                <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0" }}>
                  {view === "managed" ? "Historial de viajes con logística completada" : "Viajes pendientes de reserva y organización"}
                </p>
              </div>
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
                style={{ marginLeft: "auto", background: "white", color: "#0D4BD9", border: "1px solid #0D4BD9", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
              >
                📊 Exportar Reporte (CSV)
              </button>
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
                  // Group by Expedition (Consultant + Group)
                  const expeditions = {};
                  filtered.forEach(p => {
                    const key = `${p.cName}-${p.g || "individual"}`;
                    if (!expeditions[key]) {
                      expeditions[key] = {
                        consultant: p.a,
                        group: p.g,
                        allIds: [],
                        hotels: [],
                        transportTypes: new Set(),
                        allDates: [],
                        bookings: {}
                      };
                    }

                    const ex = expeditions[key];
                    ex.allIds.push(p.id);
                    ex.transportTypes.add(p.tType);
                    if (!ex.allDates.includes(p.f)) ex.allDates.push(p.f);

                    // Unique hotels with their dates
                    let h = ex.hotels.find(x => x.name === p.e);
                    if (!h) {
                      h = { name: p.e, dates: [] };
                      ex.hotels.push(h);
                    }
                    if (!h.dates.includes(p.f)) h.dates.push(p.f);

                    // Collect bookings
                    const links = bookedLinks[p.id] || {};
                    Object.assign(ex.bookings, links);
                  });

                  // Render integrated Expedition Cards
                  Object.entries(expeditions).forEach(([exKey, exData]) => {
                    elements.push(
                      <div key={exKey} style={{ background: "white", borderRadius: 16, border: "1px solid #CBD5E0", overflow: "hidden", marginBottom: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                        {/* Summary Header */}
                        <div style={{ background: "#F8FAFC", padding: "16px 20px", borderBottom: "1px solid #E2E8F0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>Expedición / Itinerario</div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: "#1E293B" }}>{exData.group || "Viaje Individual"}</div>
                            </div>
                            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                              <div style={{ background: "#EEF2FF", color: "#4F46E5", padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>👤 {exData.consultant}</div>
                              <button
                                onClick={(e) => { e.stopPropagation(); exData.allIds.forEach(id => toggleFinalize(id)); }}
                                style={{ background: "#fff", color: "#6B7280", border: "1px solid #E2E8F0", padding: "4px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                              >
                                Reabrir Todo (Undo)
                              </button>
                            </div>
                          </div>

                          {/* Hotels and Visit Dates List */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                            {exData.hotels.map((h, i) => (
                              <div key={i} style={{ background: "white", padding: "10px 14px", borderRadius: 12, border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: 4 }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "#1E293B" }}>🏨 {h.name}</div>
                                <div style={{ fontSize: 11, color: "#6366F1", fontWeight: 700 }}>{h.dates.join(" • ")}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Integrated Bookings Section */}
                        <div style={{ padding: 20 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                            <span>🎫</span> Reservas y Logística de la Expedición
                          </div>

                          {Object.keys(exData.bookings).length > 0 ? (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                              {Object.entries(exData.bookings).map(([url, data], idx) => {
                                const label = url.includes("vueling") ? "Vueling" :
                                  url.includes("iberia") ? "Iberia" :
                                    url.includes("renfe") ? "Renfe" :
                                      url.includes("iryo") ? "Iryo" :
                                        url.includes("binter") ? "Binter" :
                                          url.includes("cicar") ? "CICAR" :
                                            url.includes("okmobility") ? "OK Mobility" : "Reserva";

                                const icon = (url.includes("cicar") || url.includes("mobility")) ? "🚗" : "✈️";

                                if (data && typeof data === 'object' && data.segments) {
                                  return (
                                    <div key={idx} style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 12, padding: 14 }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                        <div style={{ fontWeight: 800, fontSize: 13, color: "#0369A1" }}>{icon} {label}</div>
                                      </div>
                                      <div style={{ display: "grid", gap: 8 }}>
                                        {data.segments.map((seg, si) => (
                                          <div key={si} style={{ display: "flex", justifyContent: "space-between", background: "white", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
                                            <span style={{ fontWeight: 700, color: "#1E293B" }}>
                                              {seg.type === "ida" ? "🛫 Ida" : seg.type === "vuelta" ? "🛬 Vuelta" : seg.type === "recogida" ? "🏁 Recogida" : "🔄 Devolución"}
                                            </span>
                                            <div style={{ textAlign: "right" }}>
                                              <div style={{ fontWeight: 800, color: "#0D4BD9" }}>{seg.locator}</div>
                                              <div style={{ fontSize: 10, color: "#64748B" }}>{seg.date}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                } else {
                                  const code = typeof data === 'object' ? data.locator : data;
                                  const dateStr = typeof data === 'object' ? data.date : "";
                                  const typeStr = typeof data === 'object' ? (data.type === "ida" ? "Ida" : data.type === "vuelta" ? "Vuelta" : data.type) : "Confirmación";
                                  return (
                                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F0F9FF", border: "1px solid #BAE6FD", padding: "14px", borderRadius: 12, fontSize: 13 }}>
                                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                        <span style={{ fontSize: 16 }}>{icon}</span>
                                        <div>
                                          <div style={{ fontWeight: 800, color: "#0369A1" }}>{label}</div>
                                          <div style={{ fontSize: 10, color: "#64748B", textTransform: "uppercase", fontWeight: 700 }}>{typeStr}</div>
                                        </div>
                                      </div>
                                      <div style={{ textAlign: "right" }}>
                                        <div style={{ fontWeight: 900, color: "#0D4BD9", letterSpacing: "0.02em" }}>{code}</div>
                                        <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>{dateStr}</div>
                                      </div>
                                    </div>
                                  );
                                }
                              })}
                            </div>
                          ) : (
                            <div style={{ padding: "16px", background: "#F8FAFC", borderRadius: 12, border: "1px dashed #CBD5E0", textAlign: "center", color: "#64748B", fontSize: 12 }}>
                              No hay registros de reservas externas para esta expedición.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                } else {
                  // Standard proposals view
                  filtered.forEach(p => {
                    elements.push(
                      <div key={p.id} style={{ background: "white", borderRadius: 12, border: selectedIds.has(p.id) ? "2px solid #0D4BD9" : (approvedIds.has(p.id) ? "1px solid #10B981" : "1px solid #eee"), overflow: "hidden", position: "relative" }}>
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
                                    handleBookSelection();
                                  } else {
                                    setBookingTarget({
                                      consultant: p.a,
                                      activity: { ...p, startDate: p.f, endDate: p.f },
                                      transportType: p.tType,
                                      establishments: [p.e]
                                    });
                                  }
                                }}
                                style={{ background: "#0D4BD9", color: "white", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                              >
                                {selectedIds.has(p.id) ? "Reservar (Multiple)" : "Reservar"}
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedIds.has(p.id)) {
                                  handleBulkFinalize();
                                } else {
                                  toggleFinalize(p.id);
                                }
                              }}
                              style={{ background: finalizedIds.has(p.id) ? "#6B7280" : "#10B981", color: "white", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                            >
                              {selectedIds.has(p.id) ? (view === "managed" ? "Reabrir (Multiple)" : "Finalizar (Multiple)") : (finalizedIds.has(p.id) ? "Undo" : "Finalizar")}
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
                                  <div style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase" }}>Destino</div>
                                  <div style={{ fontSize: 13, color: "#111", fontWeight: 600 }}>{p.destMuni} / {p.destDisplay}</div>
                                  <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>{p.destAddress}</div>
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
                                    }}
                                    onEditManually={() => {
                                      setGeocodeResults(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), editing: true } }));
                                    }}
                                    onUpdateAddress={updateEstablishmentAddress}
                                  />
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
                                <span style={{ fontSize: 14 }}>🔧</span>
                                <div>
                                  <span style={{ fontSize: 10, textTransform: "uppercase", color: "#999", fontWeight: 700, marginRight: 4 }}>Técnica</span>
                                  <span style={{ fontWeight: 600 }}>{p.tType}</span>
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
            onDelete={deleteConsultant}
          />
        )}


      </div>
    </div>
  );
}
