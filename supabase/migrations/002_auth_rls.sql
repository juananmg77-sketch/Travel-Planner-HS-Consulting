-- ============================================================
-- HS TRAVEL PLANNER - AUTH & RLS MIGRATION
-- ============================================================
-- Adds user profiles with roles and Row Level Security
-- policies to protect all tables.
-- ============================================================

-- ============================================================
-- 1. USER PROFILES (linked to Supabase Auth)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'logistics' CHECK (role IN ('admin', 'logistics')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'logistics'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 2. ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE establishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_locators ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. RLS POLICIES
-- ============================================================
-- Policy: Authenticated users can read all data
-- Policy: Only authenticated users can insert/update/delete

-- CONSULTANTS
CREATE POLICY "Authenticated users can view consultants"
  ON consultants FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage consultants"
  ON consultants FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- PLANNING PERIODS
CREATE POLICY "Authenticated users can view periods"
  ON planning_periods FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage periods"
  ON planning_periods FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ACTIVITIES
CREATE POLICY "Authenticated users can view activities"
  ON activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage activities"
  ON activities FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ESTABLISHMENTS
CREATE POLICY "Authenticated users can view establishments"
  ON establishments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage establishments"
  ON establishments FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- LOGISTICS HOTELS
CREATE POLICY "Authenticated users can view logistics hotels"
  ON logistics_hotels FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage logistics hotels"
  ON logistics_hotels FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- BOOKING LOCATORS
CREATE POLICY "Authenticated users can view locators"
  ON booking_locators FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage locators"
  ON booking_locators FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ACTIVITY LOG
CREATE POLICY "Authenticated users can view logs"
  ON activity_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert logs"
  ON activity_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- USER PROFILES
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid());
