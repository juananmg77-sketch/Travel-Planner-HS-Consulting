-- ============================================================
-- HS CONSULTING TRAVEL PLANNER - DATABASE SCHEMA v1.0
-- ============================================================
-- This migration creates the complete database structure for 
-- managing consultant travel logistics. Designed for monthly 
-- CSV uploads with full historical tracking.
-- ============================================================

-- ============================================================
-- CLEANUP: Drop any pre-existing tables from prior attempts
-- (order matters: children before parents to respect FKs)
-- ============================================================
DROP TABLE IF EXISTS activity_log CASCADE;
DROP TABLE IF EXISTS booking_locators CASCADE;
DROP TABLE IF EXISTS logistics_hotels CASCADE;
DROP TABLE IF EXISTS establishments CASCADE;
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS planning_periods CASCADE;
DROP TABLE IF EXISTS consultants CASCADE;
-- Also drop old tables from the initial schema
DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS client_overrides CASCADE;
DROP TABLE IF EXISTS finalized_activities CASCADE;

-- ============================================================
-- 1. CONSULTANTS (Master data - permanent)
-- ============================================================
-- Core employee/contractor records. Managed via the app's 
-- "Gestión Consultores" CRUD interface.
CREATE TABLE IF NOT EXISTS consultants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT UNIQUE NOT NULL,
  base_city TEXT,              -- Ciudad base (ej: "Palma de Mallorca")
  address TEXT,                -- Dirección completa del consultor
  region TEXT,                 -- Comunidad Autónoma (ej: "Islas Baleares")
  island TEXT,                 -- Isla si aplica (ej: "Mallorca")
  transport_pref TEXT DEFAULT 'vehiculo', -- Preferencia: vehiculo, tren, auto
  email TEXT,
  phone TEXT,
  airport_code TEXT,           -- Código IATA (ej: "PMI")
  station_name TEXT,           -- Estación de tren más cercana
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. PLANNING PERIODS (Monthly uploads tracking)
-- ============================================================
-- Each CSV upload creates a planning period. This allows
-- tracking which data was loaded and when, enabling historical 
-- comparisons and auditing of monthly plans.
CREATE TABLE IF NOT EXISTS planning_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL,         -- Ej: "Febrero 2026", "Marzo 2026"
  month INTEGER NOT NULL,      -- 1-12
  year INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by TEXT,            -- Quién subió el CSV
  source_filename TEXT,        -- Nombre original del archivo
  total_activities INTEGER DEFAULT 0,
  notes TEXT,
  UNIQUE(month, year)          -- Solo un periodo por mes/año
);

-- ============================================================
-- 3. ACTIVITIES (Visit records from CSV uploads)
-- ============================================================
-- Individual visit/audit entries from the monthly planning CSV.
-- Linked to a planning period for historical traceability.
CREATE TABLE IF NOT EXISTS activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  planning_period_id UUID REFERENCES planning_periods(id) ON DELETE SET NULL,
  consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL,
  consultant_name TEXT NOT NULL, -- Denormalized for quick access
  region TEXT,                   -- Región destino
  establishment TEXT NOT NULL,   -- Nombre del establecimiento/hotel
  description TEXT,              -- Tipo de actividad
  visit_date DATE NOT NULL,      -- Fecha de la visita
  visit_date_raw TEXT,           -- Formato original DD/MM/YYYY
  days FLOAT DEFAULT 1,          -- Jornadas
  group_chain TEXT,              -- Cadena hotelera / Grupo
  
  -- Computed logistics (filled by app logic)
  transport_type TEXT,           -- vuelo, tren, vehiculo, local
  estimated_km FLOAT DEFAULT 0,
  
  -- Address tracking
  dest_address TEXT,             -- Dirección validada del destino
  dest_municipality TEXT,        -- Municipio validado
  
  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'managed', 'cancelled')),
  managed_at TIMESTAMPTZ,        -- Cuando se marcó como gestionado
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. CLIENT ESTABLISHMENTS (Known clients/hotels database)
-- ============================================================
-- Master data of known establishments. Pre-loaded from 
-- clientData.json and enriched with validated addresses.
CREATE TABLE IF NOT EXISTS establishments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE,              -- Código interno (ej: "HS-001")
  name TEXT UNIQUE NOT NULL,     -- Nombre del establecimiento
  municipality TEXT,
  region TEXT,
  island TEXT,
  address TEXT,                  -- Dirección validada
  latitude DOUBLE PRECISION,     -- Para futuras integraciones de mapa
  longitude DOUBLE PRECISION,
  is_validated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. LOGISTICS HOTELS (Pre-established hotels for booking)
-- ============================================================
-- Hotels pre-approved by the Logistics team, organized by zone.
-- Used for future hotel booking functionality.
CREATE TABLE IF NOT EXISTS logistics_hotels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  zone TEXT NOT NULL,            -- Zona geográfica (ej: "Madrid Centro", "Palma Norte")
  region TEXT NOT NULL,          -- Comunidad Autónoma
  island TEXT,                   -- Isla si aplica
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  price_range TEXT,              -- Ej: "€€", "€€€"
  booking_portal_url TEXT,       -- URL directa de reservas
  notes TEXT,                    -- Notas del equipo de logística
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. BOOKING LOCATORS (Confirmation codes per activity)
-- ============================================================
-- Multiple locators can be attached to a single activity
-- (e.g., flight outbound + flight return + car rental).
CREATE TABLE IF NOT EXISTS booking_locators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
  locator_type TEXT,             -- Ej: "vuelo_ida", "vuelo_vuelta", "tren", "coche", "hotel"
  locator_code TEXT NOT NULL,    -- Código de confirmación
  provider TEXT,                 -- Ej: "Iberia", "Renfe", "CICAR"
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. ACTIVITY LOG (Audit trail)
-- ============================================================
-- Tracks all significant changes for compliance and debugging.
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL,     -- "activity", "consultant", "establishment"
  entity_id UUID,
  action TEXT NOT NULL,          -- "created", "updated", "status_change", "csv_upload"
  details JSONB,                 -- Flexible payload
  performed_by TEXT,
  performed_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_activities_consultant ON activities(consultant_name);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
CREATE INDEX IF NOT EXISTS idx_activities_visit_date ON activities(visit_date);
CREATE INDEX IF NOT EXISTS idx_activities_period ON activities(planning_period_id);
CREATE INDEX IF NOT EXISTS idx_activities_transport ON activities(transport_type);
CREATE INDEX IF NOT EXISTS idx_establishments_name ON establishments(name);
CREATE INDEX IF NOT EXISTS idx_establishments_region ON establishments(region);
CREATE INDEX IF NOT EXISTS idx_logistics_hotels_zone ON logistics_hotels(zone);
CREATE INDEX IF NOT EXISTS idx_logistics_hotels_region ON logistics_hotels(region);
CREATE INDEX IF NOT EXISTS idx_booking_locators_activity ON booking_locators(activity_id);

-- ============================================================
-- FUNCTIONS: Auto-update timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consultants_updated_at
  BEFORE UPDATE ON consultants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_establishments_updated_at
  BEFORE UPDATE ON establishments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- VIEWS: Useful aggregated data
-- ============================================================

-- Monthly summary per consultant
CREATE OR REPLACE VIEW v_consultant_monthly_summary AS
SELECT 
  a.consultant_name,
  pp.year,
  pp.month,
  pp.label AS period_label,
  COUNT(*) AS total_visits,
  COUNT(*) FILTER (WHERE a.status = 'managed') AS managed_visits,
  COUNT(*) FILTER (WHERE a.status = 'pending') AS pending_visits,
  COUNT(*) FILTER (WHERE a.transport_type = 'vuelo') AS flights,
  COUNT(*) FILTER (WHERE a.transport_type = 'tren') AS trains,
  COUNT(*) FILTER (WHERE a.transport_type = 'vehiculo') AS vehicles,
  COUNT(*) FILTER (WHERE a.transport_type = 'local') AS local_trips,
  SUM(a.estimated_km) AS total_km
FROM activities a
LEFT JOIN planning_periods pp ON a.planning_period_id = pp.id
GROUP BY a.consultant_name, pp.year, pp.month, pp.label;

-- Pending flights overview
CREATE OR REPLACE VIEW v_pending_flights AS
SELECT 
  a.id,
  a.consultant_name,
  a.establishment,
  a.visit_date,
  a.region,
  a.group_chain,
  a.transport_type,
  a.dest_address,
  a.dest_municipality,
  c.base_city AS consultant_base,
  c.airport_code AS consultant_airport,
  c.island AS consultant_island
FROM activities a
LEFT JOIN consultants c ON a.consultant_id = c.id
WHERE a.status = 'pending' 
  AND a.transport_type IN ('vuelo', 'tren')
ORDER BY a.visit_date;

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE consultants;
ALTER PUBLICATION supabase_realtime ADD TABLE activities;
ALTER PUBLICATION supabase_realtime ADD TABLE booking_locators;
ALTER PUBLICATION supabase_realtime ADD TABLE planning_periods;
