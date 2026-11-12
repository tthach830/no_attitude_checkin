import initSqlJs, { Database } from 'sql.js';
import type { TeamEntry } from '../types';
import { getTeamStatus, formatDisplayTeamName } from './csv';

const INDEXED_DB_NAME = 'no_attitude_checkin_sqlite';
const INDEXED_DB_STORE = 'sqlite_store';
const INDEXED_DB_KEY = 'checkin_db_binary';

let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

// IndexedDB persistence helpers
function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEXED_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INDEXED_DB_STORE)) {
        db.createObjectStore(INDEXED_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadDbFromIndexedDB(): Promise<Uint8Array | null> {
  try {
    const idb = await openIndexedDB();
    return new Promise((resolve) => {
      const tx = idb.transaction(INDEXED_DB_STORE, 'readonly');
      const store = tx.objectStore(INDEXED_DB_STORE);
      const req = store.get(INDEXED_DB_KEY);
      req.onsuccess = () => {
        if (req.result instanceof Uint8Array) {
          resolve(req.result);
        } else if (req.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(req.result));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveDbToIndexedDB(data: Uint8Array): Promise<void> {
  try {
    const idb = await openIndexedDB();
    const tx = idb.transaction(INDEXED_DB_STORE, 'readwrite');
    const store = tx.objectStore(INDEXED_DB_STORE);
    store.put(data, INDEXED_DB_KEY);
  } catch (err) {
    console.warn('[SQLite] Failed to persist database to IndexedDB:', err);
  }
}

/**
 * Initialize SQLite WebAssembly database and ensure the `checkin` table exists.
 */
export async function getSqliteDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let SQL: any;
    try {
      // First try local wasm in public directory
      const wasmPath = `${import.meta.env.BASE_URL || './'}sql-wasm.wasm`;
      SQL = await initSqlJs({
        locateFile: () => wasmPath,
      });
    } catch (e) {
      console.warn('[SQLite] Local wasm failed, trying CDN fallback:', e);
      SQL = await initSqlJs({
        locateFile: () => 'https://sql.js.org/dist/sql-wasm.wasm',
      });
    }

    const savedBinary = await loadDbFromIndexedDB();
    if (savedBinary && savedBinary.length > 0) {
      try {
        dbInstance = new SQL.Database(savedBinary);
      } catch (err) {
        console.warn('[SQLite] Corrupted DB in IndexedDB, creating fresh DB:', err);
        dbInstance = new SQL.Database();
      }
    } else {
      dbInstance = new SQL.Database();
    }

    // Ensure the `checkin` table exists
    dbInstance!.run(`
      CREATE TABLE IF NOT EXISTS checkin (
        id TEXT PRIMARY KEY,
        Tournament_Name TEXT,
        team_name TEXT NOT NULL,
        division TEXT NOT NULL,
        total_courts INTEGER DEFAULT 1,
        Total_Pools INTEGER DEFAULT 1,
        pool_name TEXT NOT NULL,
        courts TEXT NOT NULL,
        division_courts TEXT,
        player1_name TEXT,
        player1_checked_in INTEGER DEFAULT 0,
        player1_checked_in_at TEXT,
        player2_name TEXT,
        player2_checked_in INTEGER DEFAULT 0,
        player2_checked_in_at TEXT,
        players_json TEXT,
        team_status TEXT NOT NULL,
        is_checked_in INTEGER NOT NULL,
        checked_in_at TEXT,
        notes TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    // Ensure backwards compatibility with any databases already saved in IndexedDB
    try {
      dbInstance!.run(`ALTER TABLE checkin ADD COLUMN Tournament_Name TEXT;`);
    } catch {
      // column already exists
    }
    try {
      dbInstance!.run(`ALTER TABLE checkin ADD COLUMN total_courts INTEGER DEFAULT 1;`);
    } catch {
      // column already exists
    }
    try {
      dbInstance!.run(`ALTER TABLE checkin ADD COLUMN Total_Pools INTEGER DEFAULT 1;`);
    } catch {
      // column already exists
    }

    // Create index on status & division for fast query performance
    dbInstance!.run(`
      CREATE INDEX IF NOT EXISTS idx_checkin_division ON checkin(division);
      CREATE INDEX IF NOT EXISTS idx_checkin_status ON checkin(is_checked_in);
    `);

    return dbInstance!;
  })();

  return initPromise;
}

/**
 * Save all teams and their check-in data into the SQLite `checkin` table.
 */
export async function syncTeamsToSqlite(
  teams: TeamEntry[],
  tournamentName: string
): Promise<{ success: boolean; rowsSaved: number; error?: string }> {
  try {
    const db = await getSqliteDb();
    const nowIso = new Date().toISOString();

    // Precompute division-level metadata: total_courts and Total_Pools
    const divisionStatsMap = new Map<string, { totalCourts: number; totalPools: number }>();
    const divisionTeamsMap = new Map<string, TeamEntry[]>();

    for (const t of teams) {
      const div = t.division || 'General';
      if (!divisionTeamsMap.has(div)) {
        divisionTeamsMap.set(div, []);
      }
      divisionTeamsMap.get(div)!.push(t);
    }

    for (const [div, dTeams] of divisionTeamsMap.entries()) {
      // 1. Total_Pools for this division (e.g. Pool 1, Pool 2 -> 2)
      const pools = new Set(dTeams.map((t) => t.poolName).filter(Boolean));
      const totalPools = Math.max(1, pools.size);

      // 2. total_courts for this division (e.g. "1-4" -> 4, "1-7" -> 7, "8-11" -> 4)
      let totalCourts = 0;
      const divCourtsStr = dTeams.find((t) => t.divisionCourts)?.divisionCourts;
      if (divCourtsStr) {
        const rangeMatch = divCourtsStr.match(/(\d+)\s*[-–—]\s*(\d+)/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          if (Number.isFinite(start) && Number.isFinite(end)) {
            totalCourts = Math.abs(end - start) + 1;
          }
        }
      }

      // If no explicit range string, count unique court numbers across division teams
      if (!totalCourts) {
        const courtsSet = new Set<number>();
        dTeams.forEach((t) => {
          if (t.courts && t.courts !== '-') {
            t.courts.split(/[-–—,\s]+/).forEach((part) => {
              const num = parseInt(part, 10);
              if (Number.isFinite(num)) courtsSet.add(num);
            });
          }
        });
        totalCourts = courtsSet.size > 0 ? courtsSet.size : 1;
      }

      divisionStatsMap.set(div, { totalCourts, totalPools });
    }

    db.run('BEGIN TRANSACTION;');

    const effectiveTournamentName = tournamentName.trim() || 'NA_11072026';

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO checkin (
        id,
        Tournament_Name,
        team_name,
        division,
        total_courts,
        Total_Pools,
        pool_name,
        courts,
        division_courts,
        player1_name,
        player1_checked_in,
        player1_checked_in_at,
        player2_name,
        player2_checked_in,
        player2_checked_in_at,
        players_json,
        team_status,
        is_checked_in,
        checked_in_at,
        notes,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    for (const team of teams) {
      const status = getTeamStatus(team);
      const isCheckedIn = status === 'checked-in' ? 1 : 0;
      const teamName = team.rawTeamName || formatDisplayTeamName(team);
      const p1 = team.players[0];
      const p2 = team.players[1];
      const divMeta = divisionStatsMap.get(team.division || 'General') || {
        totalCourts: 1,
        totalPools: 1,
      };

      insertStmt.run([
        team.id,
        effectiveTournamentName,
        teamName,
        team.division,
        divMeta.totalCourts,
        divMeta.totalPools,
        team.poolName,
        team.courts,
        team.divisionCourts || null,
        p1?.name || null,
        p1?.checkedIn ? 1 : 0,
        p1?.checkedInAt || null,
        p2?.name || null,
        p2?.checkedIn ? 1 : 0,
        p2?.checkedInAt || null,
        JSON.stringify(team.players),
        status,
        isCheckedIn,
        team.checkedInAt || null,
        team.notes || null,
        nowIso,
      ]);
    }

    insertStmt.free();

    // Clean up any old teams no longer in the active tournament list
    if (teams.length > 0) {
      const currentIds = teams.map((t) => `'${t.id.replace(/'/g, "''")}'`).join(',');
      db.run(`DELETE FROM checkin WHERE id NOT IN (${currentIds});`);
    }

    db.run('COMMIT;');

    // Persist to IndexedDB
    const binary = db.export();
    await saveDbToIndexedDB(binary);

    return { success: true, rowsSaved: teams.length };
  } catch (err: any) {
    console.error('[SQLite] syncTeamsToSqlite error:', err);
    try {
      dbInstance?.run('ROLLBACK;');
    } catch {
      // ignore
    }
    return { success: false, rowsSaved: 0, error: err?.message || String(err) };
  }
}

/**
 * Execute custom SQL query against the SQLite database.
 */
export async function querySqlite(
  sqlQuery: string
): Promise<{ columns: string[]; values: any[][] }[]> {
  const db = await getSqliteDb();
  return db.exec(sqlQuery);
}

/**
 * Get summary stats directly from the SQLite `checkin` table.
 */
export async function getSqliteCheckinStats(): Promise<{
  totalTeams: number;
  checkedInTeams: number;
  pendingTeams: number;
  divisionsCount: number;
}> {
  try {
    const db = await getSqliteDb();
    const result = db.exec(`
      SELECT 
        COUNT(*) as total_teams,
        COALESCE(SUM(is_checked_in), 0) as checked_in_teams,
        COUNT(DISTINCT division) as divisions_count
      FROM checkin;
    `);

    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      const total = Number(row[0]) || 0;
      const checked = Number(row[1]) || 0;
      const divs = Number(row[2]) || 0;
      return {
        totalTeams: total,
        checkedInTeams: checked,
        pendingTeams: Math.max(0, total - checked),
        divisionsCount: divs,
      };
    }
  } catch (err) {
    console.warn('[SQLite] getSqliteCheckinStats error:', err);
  }
  return { totalTeams: 0, checkedInTeams: 0, pendingTeams: 0, divisionsCount: 0 };
}

/**
 * Trigger download of the raw SQLite `.sqlite` binary database file.
 */
export async function downloadSqliteDatabase(filename = 'checkin.sqlite'): Promise<void> {
  const db = await getSqliteDb();
  const binary = db.export();
  const blob = new Blob([binary], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
