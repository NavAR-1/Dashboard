const { Pool } = require('pg');
const env = require('../../config/env');
const AppError = require('../../domain/AppError');

// Neon's PgBouncer pooler resets idle connections aggressively.
// Keep max low (free tier = 3 concurrent), shorten idle timeout so
// the pool drops connections before Neon resets them, and attach an
// error handler so a stale-connection ECONNRESET doesn't crash the process.
const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 3,
  idleTimeoutMillis: 10000,       // drop idle clients after 10 s
  connectionTimeoutMillis: 5000,  // fail fast if Neon doesn't accept quickly
});

pool.on('error', (err) => {
  console.error('[db] idle client error (safe to ignore ECONNRESET):', err.message);
});

function ensureDatabase(){
  if(!env.databaseUrl) throw new AppError('DATABASE_URL is not configured', 503);
}
async function query(text, params = []){
  ensureDatabase();
  return pool.query(text, params);
}
function pointSelect(column = 'location'){
  return 'ST_Y(' + column + '::geometry) AS latitude, ST_X(' + column + '::geometry) AS longitude';
}
function pointValue(longitudeParam, latitudeParam){
  return 'ST_SetSRID(ST_MakePoint(' + longitudeParam + ', ' + latitudeParam + '), 4326)::geography';
}
module.exports = { pool, query, pointSelect, pointValue };