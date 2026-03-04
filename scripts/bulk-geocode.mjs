/**
 * Bulk Geocoding Script — Nominatim (OpenStreetMap)
 * Usage: node scripts/bulk-geocode.mjs [--dry-run] [--limit N] [--only-missing]
 *
 * Reads all establishments from clientData.json, geocodes those without an address,
 * and upserts results into Supabase. Outputs a report at the end.
 */

import { readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFile } from 'fs/promises';

// ── Config ──────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env manually (Vite env vars not available in Node)
let SUPABASE_URL, SUPABASE_KEY;
try {
    const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
    env.split('\n').forEach(line => {
        const [k, v] = line.split('=');
        if (k?.trim() === 'VITE_SUPABASE_URL') SUPABASE_URL = v?.trim();
        if (k?.trim() === 'VITE_SUPABASE_ANON_KEY') SUPABASE_KEY = v?.trim();
    });
} catch {
    console.error('❌ No se encontró .env — crea .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Args
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_MISSING = process.argv.includes('--only-missing');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1]) : Infinity;
const DELAY_MS = 1200; // Nominatim requires max 1 req/s

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function geocode(name, municipality, island, region) {
    // Build search query: most specific first, progressively broader
    const country = 'Spain';
    const queries = [
        `${name}, ${municipality}, ${country}`,
        `${name}, ${island || municipality}, ${country}`,
        `${name}, ${region}, ${country}`,
        `${name}, ${country}`
    ];

    for (const q of queries) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1&accept-language=es`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'HS-TravelPlanner/1.0 (juananmg77@gmail.com)' }
            });
            if (!res.ok) continue;
            const results = await res.json();
            if (results.length > 0) {
                const r = results[0];
                return {
                    address: r.display_name,
                    municipality: r.address?.city || r.address?.town || r.address?.village || municipality,
                    lat: r.lat,
                    lon: r.lon,
                    confidence: r.importance,
                    query: q
                };
            }
        } catch (e) {
            console.warn(`  ⚠️  Error en geocoding: ${e.message}`);
        }
        await sleep(300); // small wait between retries
    }
    return null;
}

async function getAlreadyValidated() {
    const { data } = await supabase
        .from('establishments')
        .select('name')
        .not('address', 'is', null);
    return new Set((data || []).map(r => r.name));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🌍 HS Travel Planner — Geocodificación Masiva');
    console.log('═══════════════════════════════════════════════');
    console.log(DRY_RUN ? '⚠️  MODO DRY-RUN (no se guardarán resultados)' : '✅ Modo real — guardando en Supabase');
    console.log('');

    // Load client data
    const clientData = JSON.parse(readFileSync(path.join(ROOT, 'src/clientData.json'), 'utf8'));

    // Get already validated establishments from Supabase (skip them)
    let alreadyValidated = new Set();
    if (ONLY_MISSING) {
        console.log('⏳ Consultando establecimientos ya validados en Supabase...');
        alreadyValidated = await getAlreadyValidated();
        console.log(`   ${alreadyValidated.size} ya validados — se omitirán\n`);
    }

    // Filter establishments to geocode
    let toProcess = clientData.filter(c => {
        if (!c.name) return false;
        if (ONLY_MISSING && alreadyValidated.has(c.name)) return false;
        if (c.address) return false; // already has address in JSON
        return true;
    });

    if (LIMIT < Infinity) toProcess = toProcess.slice(0, LIMIT);

    console.log(`📋 Establecimientos a procesar: ${toProcess.length}`);
    console.log('');

    const results = { ok: [], failed: [], skipped: 0 };
    let count = 0;

    for (const hotel of toProcess) {
        count++;
        const prefix = `[${count}/${toProcess.length}]`;
        process.stdout.write(`${prefix} ${hotel.name.slice(0, 50).padEnd(52)}… `);

        const geo = await geocode(hotel.name, hotel.municipality, hotel.island, hotel.region);

        if (geo) {
            process.stdout.write(`✅ ${geo.municipality}\n`);
            results.ok.push({ ...hotel, ...geo });

            if (!DRY_RUN) {
                const { error } = await supabase
                    .from('establishments')
                    .upsert({
                        name: hotel.name,
                        code: hotel.id || null,
                        address: geo.address,
                        municipality: geo.municipality || hotel.municipality,
                        region: hotel.region || null,
                        island: hotel.island || null,
                        is_validated: true
                    }, { onConflict: 'name' });

                if (error) {
                    console.error(`   ❌ Supabase error: ${error.message}`);
                }
            }
        } else {
            process.stdout.write(`❌ No encontrado\n`);
            results.failed.push(hotel);
        }

        await sleep(DELAY_MS); // Respect Nominatim rate limit
    }

    // ── Report ─────────────────────────────────────────────────────────────────
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log(`✅ Validados:    ${results.ok.length}`);
    console.log(`❌ No encontrados: ${results.failed.length}`);
    console.log(`⏭️  Ya tenían dir: ${alreadyValidated.size}`);

    // Save failed list for manual review
    const failedPath = path.join(ROOT, 'scripts/geocode-failed.json');
    writeFileSync(failedPath, JSON.stringify(results.failed, null, 2));
    console.log(`\n📄 Lista de no encontrados guardada en: scripts/geocode-failed.json`);

    // Save full results
    const okPath = path.join(ROOT, 'scripts/geocode-results.json');
    writeFileSync(okPath, JSON.stringify(results.ok, null, 2));
    console.log(`📄 Resultados completos en: scripts/geocode-results.json`);

    if (!DRY_RUN) {
        console.log('\n🎉 ¡Geocodificación completada! Datos guardados en Supabase.');
    } else {
        console.log('\n⚠️  Dry-run terminado — ejecuta sin --dry-run para guardar en Supabase.');
    }
}

main().catch(e => {
    console.error('❌ Error fatal:', e);
    process.exit(1);
});
