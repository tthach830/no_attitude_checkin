// Script to export tournament check-in data to a local checkin.sqlite file on disk
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function exportToSqlite() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
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

  console.log('[SQLite] Created "checkin" table successfully.');

  // Pre-seed sample teams into checkin table
  const sampleTeams = [
    {
      id: 'team-1',
      tournament_name: 'NA_11072026',
      name: 'Amanda Dupes / Patrick',
      div: 'Coed Intermediate',
      total_courts: 4,
      total_pools: 3,
      pool: 'Pool 1',
      courts: '1-3',
      divCourts: '1-4',
      p1: 'Amanda Dupes',
      p1_chk: 1,
      p1_time: new Date().toISOString(),
      p2: 'Patrick',
      p2_chk: 0,
      p2_time: null,
      status: 'partial',
      is_checked_in: 0,
      checked_in_at: null,
    },
    {
      id: 'team-2',
      tournament_name: 'NA_11072026',
      name: 'Sarah Connor / Kyle Reese',
      div: 'Coed Intermediate',
      total_courts: 4,
      total_pools: 3,
      pool: 'Pool 1',
      courts: '1-3',
      divCourts: '1-4',
      p1: 'Sarah Connor',
      p1_chk: 1,
      p1_time: new Date().toISOString(),
      p2: 'Kyle Reese',
      p2_chk: 1,
      p2_time: new Date().toISOString(),
      status: 'checked-in',
      is_checked_in: 1,
      checked_in_at: new Date().toISOString(),
    },
    {
      id: 'team-3',
      tournament_name: 'NA_11072026',
      name: 'Alex Morgan / Tobin Heath',
      div: 'Women Upper Intermediate',
      total_courts: 4,
      total_pools: 2,
      pool: 'Pool 2',
      courts: '8-11',
      divCourts: '8-11',
      p1: 'Alex Morgan',
      p1_chk: 0,
      p1_time: null,
      p2: 'Tobin Heath',
      p2_chk: 0,
      p2_time: null,
      status: 'pending',
      is_checked_in: 0,
      checked_in_at: null,
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO checkin (
      id, Tournament_Name, team_name, division, total_courts, Total_Pools,
      pool_name, courts, division_courts,
      player1_name, player1_checked_in, player1_checked_in_at,
      player2_name, player2_checked_in, player2_checked_in_at,
      players_json, team_status, is_checked_in, checked_in_at,
      notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  for (const t of sampleTeams) {
    stmt.run([
      t.id,
      t.tournament_name,
      t.name,
      t.div,
      t.total_courts,
      t.total_pools,
      t.pool,
      t.courts,
      t.divCourts,
      t.p1,
      t.p1_chk,
      t.p1_time,
      t.p2,
      t.p2_chk,
      t.p2_time,
      JSON.stringify([{ name: t.p1, checkedIn: !!t.p1_chk }, { name: t.p2, checkedIn: !!t.p2_chk }]),
      t.status,
      t.is_checked_in,
      t.checked_in_at,
      null,
      new Date().toISOString(),
    ]);
  }
  stmt.free();

  const dbPath = path.join(__dirname, '..', 'checkin.sqlite');
  const binary = db.export();
  fs.writeFileSync(dbPath, Buffer.from(binary));
  console.log(`[SQLite] Database saved to ${dbPath}`);
}

exportToSqlite().catch(console.error);
