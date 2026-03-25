/**
 * lovableService.js
 * Cliente Supabase para la BBDD Maestra de Activos (Lovable).
 * Las credenciales se inyectan vía variables de entorno VITE_ (ver .env.local).
 */
import { createClient } from "@supabase/supabase-js";

const LOVABLE_URL = import.meta.env.VITE_LOVABLE_SUPABASE_URL;
const LOVABLE_ANON_KEY = import.meta.env.VITE_LOVABLE_SUPABASE_ANON_KEY;

if (!LOVABLE_URL || !LOVABLE_ANON_KEY) {
  console.warn(
    "[lovableService] Faltan variables de entorno VITE_LOVABLE_SUPABASE_URL / VITE_LOVABLE_SUPABASE_ANON_KEY. " +
      "Copia .env.example a .env.local y rellena los valores."
  );
}

export const lovableClient = LOVABLE_URL && LOVABLE_ANON_KEY
  ? createClient(LOVABLE_URL, LOVABLE_ANON_KEY)
  : null;

/**
 * Descarga todos los registros de la tabla `hoteles` de la BBDD Maestra.
 * @returns {{ data: Array, error: object|null }}
 */
export async function fetchLovableHoteles() {
  if (!lovableClient) {
    return { data: null, error: new Error("Cliente Lovable no inicializado (revisa .env.local)") };
  }
  const { data, error } = await lovableClient
    .from("hoteles")
    .select("id, codigo_hotel, nombre_hotel, cadena_hotelera, ccaa, isla, municipio, direccion_completa, activo")
    .order("nombre_hotel", { ascending: true });

  return { data, error };
}

/**
 * Actualiza campos concretos de un hotel en la BBDD Maestra.
 * @param {string|number} id  — PK del registro en Lovable
 * @param {object} fields     — { direccion_completa?, municipio?, ccaa?, isla?, cadena_hotelera? }
 * @returns {{ error: object|null }}
 */
export async function updateLovableHotel(id, fields) {
  if (!lovableClient) {
    return { error: new Error("Cliente Lovable no inicializado (revisa .env.local)") };
  }
  const { error } = await lovableClient
    .from("hoteles")
    .update(fields)
    .eq("id", id);

  return { error };
}
