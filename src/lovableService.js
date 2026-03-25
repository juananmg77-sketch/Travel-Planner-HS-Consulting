/**
 * lovableService.js
 * Cliente Supabase para la BBDD Maestra de Activos (Lovable).
 * Las credenciales se inyectan vía variables de entorno VITE_ (ver .env.local).
 */
import { createClient } from "@supabase/supabase-js";

// Clave anon pública de Supabase (BBDD Maestra Lovable).
// La clave anon es pública por diseño en Supabase — la seguridad
// la gestionan las políticas RLS, no el secreto de esta clave.
const LOVABLE_URL = "https://ltuukumhzmbyvtvicuze.supabase.co";
const LOVABLE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0dXVrdW1oem1ieXZ0dmljdXplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3ODkyNzAsImV4cCI6MjA4NTM2NTI3MH0.H9g9ZnQpiI6m2uOakv6QysxZ1TQrDsYW2HtVRvIi8OA";

export const lovableClient = createClient(LOVABLE_URL, LOVABLE_ANON_KEY);

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
