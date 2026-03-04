// ============================================================
// Supabase Data Service Layer
// ============================================================
// Centralized service for all Supabase database operations.
// Handles CRUD for consultants, activities, planning periods,
// booking locators and establishments.
// Falls back gracefully to local-only mode if Supabase is not
// configured.
// ============================================================

import { supabase } from './supabaseClient';

// ============================================================
// CONNECTION CHECK
// ============================================================
const isSupabaseConfigured = () => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    return url && !url.includes('placeholder');
};

// ============================================================
// PLANNING PERIODS
// ============================================================
export async function getOrCreatePlanningPeriod(month, year, filename) {
    if (!isSupabaseConfigured()) return null;

    // Try to find existing period
    const { data: existing } = await supabase
        .from('planning_periods')
        .select('*')
        .eq('month', month)
        .eq('year', year)
        .single();

    if (existing) return existing;

    // Create new period
    const label = new Date(year, month - 1).toLocaleString('es-ES', { month: 'long', year: 'numeric' });
    const { data, error } = await supabase
        .from('planning_periods')
        .insert({
            label: label.charAt(0).toUpperCase() + label.slice(1),
            month,
            year,
            source_filename: filename
        })
        .select()
        .single();

    if (error) {
        console.error('Error creating planning period:', error);
        return null;
    }

    return data;
}

export async function getAllPlanningPeriods() {
    if (!isSupabaseConfigured()) return [];

    const { data, error } = await supabase
        .from('planning_periods')
        .select('*')
        .order('year', { ascending: false })
        .order('month', { ascending: false });

    if (error) {
        console.error('Error fetching planning periods:', error);
        return [];
    }
    return data || [];
}

// ============================================================
// CONSULTANTS
// ============================================================
export async function getAllConsultants() {
    if (!isSupabaseConfigured()) return null;

    const { data, error } = await supabase
        .from('consultants')
        .select('*')
        .eq('is_active', true)
        .order('full_name');

    if (error) {
        console.error('Error fetching consultants:', error);
        return null;
    }

    // Transform into the app's expected format { "Name": { base, email, ... } }
    const map = {};
    (data || []).forEach(c => {
        map[c.full_name] = {
            base: c.base_city,
            address: c.address,
            email: c.email,
            phone: c.phone,
            region: c.region,
            pref: c.transport_pref,
            island: c.island,
            airport: c.airport_code,
            station: c.station_name
        };
    });

    return Object.keys(map).length > 0 ? map : null;
}

export async function upsertConsultant(name, data) {
    if (!isSupabaseConfigured()) return false;

    const { error } = await supabase
        .from('consultants')
        .upsert({
            full_name: name,
            base_city: data.base,
            address: data.address || null,
            email: data.email || null,
            phone: data.phone || null,
            region: data.region,
            island: data.island || null,
            transport_pref: data.pref || 'vehiculo',
            airport_code: data.airport || null,
            station_name: data.station || null,
            is_active: true
        }, { onConflict: 'full_name' });

    if (error) console.error('Error upserting consultant:', error);
    return !error;
}

export async function deleteConsultant(name) {
    if (!isSupabaseConfigured()) return false;

    // Soft delete: mark as inactive
    const { error } = await supabase
        .from('consultants')
        .update({ is_active: false })
        .eq('full_name', name);

    if (error) console.error('Error deleting consultant:', error);
    return !error;
}

// Bulk sync from app's consultant object
export async function syncConsultants(consultantMap) {
    if (!isSupabaseConfigured()) return false;

    const entries = Object.entries(consultantMap).map(([name, data]) => ({
        full_name: name,
        base_city: data.base,
        address: data.address || null,
        email: data.email || null,
        phone: data.phone || null,
        region: data.region,
        island: data.island || null,
        transport_pref: data.pref || 'vehiculo',
        airport_code: data.airport || null,
        station_name: data.station || null,
        is_active: true
    }));

    const { error } = await supabase
        .from('consultants')
        .upsert(entries, { onConflict: 'full_name' });

    if (error) console.error('Error syncing consultants:', error);
    return !error;
}

// ============================================================
// ACTIVITIES
// ============================================================
export async function uploadActivities(activities, periodId) {
    if (!isSupabaseConfigured()) return false;

    // First, look up consultant IDs
    const { data: consultants } = await supabase
        .from('consultants')
        .select('id, full_name');

    const consultantMap = {};
    (consultants || []).forEach(c => { consultantMap[c.full_name] = c.id; });

    const rows = activities.map(act => {
        // Parse DD/MM/YYYY to proper Date
        let visitDate = null;
        if (act.f) {
            const [d, m, y] = act.f.split('/');
            visitDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }

        return {
            planning_period_id: periodId,
            consultant_id: consultantMap[(act.a || '').trim()] || null,
            consultant_name: (act.a || '').trim(),
            region: act.r,
            establishment: act.e,
            description: act.d,
            visit_date: visitDate,
            visit_date_raw: act.f,
            days: act.j || 1,
            group_chain: act.g || null,
            status: 'pending'
        };
    });

    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase.from('activities').insert(batch);
        if (error) {
            console.error('Error inserting activities batch:', error);
            return false;
        }
    }

    // Update period count
    if (periodId) {
        await supabase
            .from('planning_periods')
            .update({ total_activities: rows.length })
            .eq('id', periodId);
    }

    return true;
}

export async function getActivitiesByPeriod(periodId) {
    if (!isSupabaseConfigured()) return [];

    const { data, error } = await supabase
        .from('activities')
        .select('*')
        .eq('planning_period_id', periodId)
        .order('visit_date');

    if (error) {
        console.error('Error fetching activities:', error);
        return [];
    }

    // Transform to app format
    return (data || []).map(toAppActivity);
}

export async function getAllActivities() {
    if (!isSupabaseConfigured()) return [];

    const { data, error } = await supabase
        .from('activities')
        .select('*')
        .order('visit_date');

    if (error) {
        console.error('Error fetching all activities:', error);
        return [];
    }

    return (data || []).map(toAppActivity);
}

export async function getLatestPeriodActivities() {
    if (!isSupabaseConfigured()) return [];

    // Get the most recent planning period
    const { data: periods } = await supabase
        .from('planning_periods')
        .select('id')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1);

    if (!periods || periods.length === 0) return [];

    return getActivitiesByPeriod(periods[0].id);
}

// Transform Supabase row -> App activity object
function toAppActivity(row) {
    return {
        id: row.id,
        a: row.consultant_name,
        r: row.region,
        e: row.establishment,
        d: row.description,
        f: row.visit_date_raw || formatDateForApp(row.visit_date),
        j: row.days,
        g: row.group_chain,
        _supabaseId: row.id,
        _status: row.status,
        _transportType: row.transport_type,
        _km: row.estimated_km
    };
}

function formatDateForApp(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ============================================================
// ACTIVITY STATUS MANAGEMENT
// ============================================================
export async function setActivityStatus(activityId, status) {
    if (!isSupabaseConfigured()) return false;

    const update = { status };
    if (status === 'managed') update.managed_at = new Date().toISOString();

    const { error } = await supabase
        .from('activities')
        .update(update)
        .eq('id', activityId);

    if (error) console.error('Error updating activity status:', error);
    return !error;
}

export async function updateActivityAddress(activityId, address, municipality) {
    if (!isSupabaseConfigured()) return false;

    const { error } = await supabase
        .from('activities')
        .update({ dest_address: address, dest_municipality: municipality })
        .eq('id', activityId);

    if (error) console.error('Error updating activity address:', error);
    return !error;
}

export async function updateActivityTransport(activityId, transportType, km) {
    if (!isSupabaseConfigured()) return false;

    const { error } = await supabase
        .from('activities')
        .update({ transport_type: transportType, estimated_km: km })
        .eq('id', activityId);

    if (error) console.error('Error updating activity transport:', error);
    return !error;
}

// ============================================================
// BOOKING LOCATORS
// ============================================================
export async function getLocatorsForActivity(activityId) {
    if (!isSupabaseConfigured()) return [];

    const { data, error } = await supabase
        .from('booking_locators')
        .select('*')
        .eq('activity_id', activityId)
        .order('created_at');

    if (error) {
        console.error('Error fetching locators:', error);
        return [];
    }
    return data || [];
}

export async function addLocator(activityId, code, type, provider) {
    if (!isSupabaseConfigured()) return false;

    const { error } = await supabase
        .from('booking_locators')
        .insert({
            activity_id: activityId,
            locator_code: code,
            locator_type: type || null,
            provider: provider || null
        });

    if (error) console.error('Error adding locator:', error);
    return !error;
}

export async function removeLocator(locatorId) {
    if (!isSupabaseConfigured()) return false;

    const { error } = await supabase
        .from('booking_locators')
        .delete()
        .eq('id', locatorId);

    if (error) console.error('Error removing locator:', error);
    return !error;
}

// Bulk sync from app's bookingConfirmations object
export async function syncBookingLocators(bookingConfirmations) {
    if (!isSupabaseConfigured()) return false;

    for (const [activityId, locators] of Object.entries(bookingConfirmations)) {
        const codes = Array.isArray(locators) ? locators : (locators ? [locators] : []);

        if (codes.length === 0) continue;

        // Delete existing for this activity
        await supabase
            .from('booking_locators')
            .delete()
            .eq('activity_id', activityId);

        // Insert new ones
        const rows = codes.map(code => ({
            activity_id: activityId,
            locator_code: code
        }));

        const { error } = await supabase
            .from('booking_locators')
            .insert(rows);

        if (error) console.error('Error syncing locators for activity:', activityId, error);
    }

    return true;
}

// ============================================================
// ESTABLISHMENTS
// ============================================================
export async function upsertEstablishment(name, data) {
    if (!isSupabaseConfigured()) return false;

    const { error } = await supabase
        .from('establishments')
        .upsert({
            name,
            code: data.code || null,
            municipality: data.municipality || null,
            region: data.region || null,
            island: data.island || null,
            address: data.address || null,
            is_validated: !!data.address
        }, { onConflict: 'name' });

    if (error) console.error('Error upserting establishment:', error);
    return !error;
}

// Bulk sync from clientData.json
export async function syncEstablishments(clientDataArray) {
    if (!isSupabaseConfigured()) return false;

    const rows = clientDataArray.map(c => ({
        code: c.id,
        name: c.name,
        municipality: c.municipality || null,
        region: c.region || null,
        island: c.island || null,
        is_validated: false
    }));

    // Upsert in batches
    for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase
            .from('establishments')
            .upsert(batch, { onConflict: 'name', ignoreDuplicates: true });

        if (error) console.error('Error syncing establishments batch:', error);
    }

    return true;
}

// Returns all establishments that have a validated address, in the app's
// customClientInfo format: { "Hotel Name": { address, municipality, region, island } }
export async function getValidatedEstablishments() {
    if (!isSupabaseConfigured()) return {};

    const { data, error } = await supabase
        .from('establishments')
        .select('name, address, municipality, region, island, is_validated')
        .not('address', 'is', null);

    if (error) {
        console.error('Error fetching validated establishments:', error);
        return {};
    }

    const map = {};
    (data || []).forEach(row => {
        map[row.name] = {
            address: row.address,
            municipality: row.municipality,
            region: row.region,
            island: row.island,
            _validated: row.is_validated
        };
    });
    return map;
}


// ============================================================
// LOGISTICS HOTELS (future feature)
// ============================================================
export async function getLogisticsHotelsByZone(zone) {
    if (!isSupabaseConfigured()) return [];

    const query = supabase
        .from('logistics_hotels')
        .select('*')
        .eq('is_active', true);

    if (zone) query.eq('zone', zone);

    const { data, error } = await query.order('name');

    if (error) {
        console.error('Error fetching logistics hotels:', error);
        return [];
    }
    return data || [];
}

export async function upsertLogisticsHotel(hotel) {
    if (!isSupabaseConfigured()) return false;

    const { error } = await supabase
        .from('logistics_hotels')
        .upsert(hotel);

    if (error) console.error('Error upserting logistics hotel:', error);
    return !error;
}

export async function getAllAccommodationHotels() {
    if (!isSupabaseConfigured()) return null;

    const { data, error } = await supabase
        .from('logistics_hotels')
        .select('name, zone, booking_portal_url')
        .eq('is_active', true);

    if (error) {
        console.error('Error fetching accommodation hotels:', error);
        return null;
    }

    const map = {};
    (data || []).forEach(row => {
        if (!map[row.zone]) map[row.zone] = [];
        map[row.zone].push({ hotel: row.name, ubicacion: row.booking_portal_url || "" });
    });
    return map;
}

export async function syncAccommodationHotels(hotelsMap) {
    if (!isSupabaseConfigured()) return false;

    // First delete or mark inactive all existing hotels to avoid duplicates.
    // For simplicity here, we'll mark them as inactive.
    await supabase.from('logistics_hotels').update({ is_active: false }).neq('name', '___dummy___');

    const rows = [];
    Object.entries(hotelsMap).forEach(([zone, hotels]) => {
        hotels.forEach(h => {
            rows.push({
                name: h.hotel,
                zone: zone,
                region: zone, // Set region to zone as it is required (NOT NULL)
                booking_portal_url: h.ubicacion || null,
                is_active: true
            });
        });
    });

    if (rows.length === 0) return true;

    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase.from('logistics_hotels').insert(batch);
        if (error) {
            console.error('Error inserting accommodation hotels batch:', error);
        }
    }

    return true;
}

// ============================================================
// ROUTE DISTANCES
// ============================================================
export async function getAllDistances() {
    if (!isSupabaseConfigured()) return {};

    const { data, error } = await supabase
        .from('route_distances')
        .select('*');

    if (error) {
        console.error('Error fetching distances:', error);
        return {};
    }

    const map = {};
    (data || []).forEach(row => {
        map[row.route_key] = row.km;
    });
    return map;
}

export async function upsertDistance(routeKey, km) {
    if (!isSupabaseConfigured()) return false;

    // Remove any undefined or null values
    if (!routeKey || km === undefined || km === null) return false;

    const { error } = await supabase
        .from('route_distances')
        .upsert({
            route_key: routeKey,
            km: km,
            updated_at: new Date().toISOString()
        }, { onConflict: 'route_key' });

    if (error) console.error('Error upserting distance:', error);
    return !error;
}

export async function logAction(entityType, entityId, action, details) {
    if (!isSupabaseConfigured()) return;

    await supabase.from('activity_log').insert({
        entity_type: entityType,
        entity_id: entityId,
        action,
        details
    });
}

// ============================================================
// VIEWS / REPORTS
// ============================================================
export async function getConsultantMonthlySummary(year, month) {
    if (!isSupabaseConfigured()) return [];

    let query = supabase.from('v_consultant_monthly_summary').select('*');
    if (year) query = query.eq('year', year);
    if (month) query = query.eq('month', month);

    const { data, error } = await query;
    if (error) {
        console.error('Error fetching summary:', error);
        return [];
    }
    return data || [];
}

export async function getPendingFlights() {
    if (!isSupabaseConfigured()) return [];

    const { data, error } = await supabase
        .from('v_pending_flights')
        .select('*');

    if (error) {
        console.error('Error fetching pending flights:', error);
        return [];
    }
    return data || [];
}
