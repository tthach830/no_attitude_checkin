import Papa from 'papaparse';
import type { TeamEntry, PlayerSlot, CheckInStatus, DivisionCourtRange } from '../types.ts';

export const COED_INTERMEDIATE_CSV = `Pool Name,Courts,Team Name,Checked In
Pool 1,1,Amanda Dupes / patrick,
Pool 1,1,Archana Shankar / Donald Bolton-Haughton,
Pool 1,1,Eric Huang / Mikayla Wilson,
Pool 2,2,Runwild Peter / Lauren,
Pool 2,2,Philip Hong (+1),
Pool 2,2,Sofia Dimotsi / TJ Tyrfingsson,
Pool 3,3,Weuwart,
Pool 3,3,Veronica Delaney / Vivek Arora,
Pool 3,3,Alice Bruemmer / Kenan Ulku-Steiner,
Pool 4,4,Bryn Stembridge / Harmony Ma,
Pool 4,4,James Williams / Sloane,
Pool 4,4,Naomi O / Noah Rodriguez,
Pool 4,4,Jin Burge / Louis Fernandez,`;

export const MEN_CSV = `Pool Name,Courts,Team Name,Checked In
Pool 1,10,Chris K. / Rudy,
Pool 1,10,Aiden / Michael Canady,
Pool 1,10,Eric Loreaux / Tom Burke,
Pool 2,11,Billy Luu / Ryan Luu,
Pool 2,11,Jaxon / Jesse Cook,
Pool 2,11,Jamie Bloom / Elliot Smith,
Pool 3,12,Greg Bardsley / Mark Greenbaum,
Pool 3,12,Ivan / Riley Braddock,
Pool 3,12,Che S / Sandman Hynes,
Pool 3,12,Alex / Liam,
Pool 4,13,Jason Smith / Patrick McMillan,
Pool 4,13,Adrian Gomez / Noah,
Pool 4,13,Brayden Windes / Jethan Truong,
Pool 4,13,Diogo Lucio / Isaiah Rios,`;

export const DEFAULT_CSV = COED_INTERMEDIATE_CSV;

/**
 * Extracts a clean Division name from a CSV file name or relative path.
 * Examples:
 * - "Men.csv" -> "Men"
 * - "Coed Intermediate _Sign-In.csv" -> "Coed Intermediate"
 * - "Men's Intermediate_Sign-In.csv" -> "Men's Intermediate"
 * - "tournament_folder/Coed-Intermediate.csv" -> "Coed-Intermediate"
 */
export function extractDivisionFromFilename(fileNameOrPath: string): string {
  const baseName = fileNameOrPath.split(/[/\\]/).pop() || fileNameOrPath;
  const withoutExt = baseName.replace(/\.csv$/i, '').trim();
  const withoutCopy = withoutExt.replace(/\s*\(\d+\)$/, '').trim();
  const withoutSignIn = withoutCopy
    .replace(/[\s_-]*sign[\s_-]*in$/i, '')
    .trim();
  return withoutSignIn || withoutCopy || 'General';
}

export function formatCourtRangeLabel(startCourt: number, endCourt: number): string {
  const s = Math.max(1, Math.min(startCourt, endCourt));
  const e = Math.max(startCourt, endCourt);
  return s === e ? `${s}` : `${s}-${e}`;
}

/**
 * Distributes a contiguous range of courts [startCourt..endCourt] across the pools of a single division,
 * and sets divisionCourts = "startCourt-endCourt" on all teams in that division.
 */
export function applyCourtRangeToDivision(
  teams: TeamEntry[],
  division: string,
  startCourt: number,
  endCourt: number
): TeamEntry[] {
  const s = Math.max(1, Math.min(startCourt, endCourt));
  const e = Math.max(startCourt, endCourt);
  const rangeLabel = formatCourtRangeLabel(s, e);

  // Collect ordered unique pools in this division
  const poolNames: string[] = [];
  teams.forEach((t) => {
    if (t.division === division && !poolNames.includes(t.poolName)) {
      poolNames.push(t.poolName);
    }
  });

  const numPools = poolNames.length;
  const totalDivCourts = e - s + 1;
  const poolCourtMap = new Map<string, string>();

  if (numPools > 0) {
    if (totalDivCourts >= numPools) {
      // Distribute courts across pools proportionally/evenly
      let cursor = s;
      const base = Math.floor(totalDivCourts / numPools);
      let rem = totalDivCourts % numPools;
      poolNames.forEach((pName) => {
        const count = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        const pStart = cursor;
        const pEnd = cursor + count - 1;
        cursor = pEnd + 1;
        poolCourtMap.set(pName, formatCourtRangeLabel(pStart, pEnd));
      });
    } else {
      // Fewer courts than pools: map pools across available courts in range
      poolNames.forEach((pName, idx) => {
        const assignedCourt = s + Math.floor((idx * totalDivCourts) / numPools);
        poolCourtMap.set(pName, `${assignedCourt}`);
      });
    }
  }

  return teams.map((t) => {
    if (t.division !== division) return t;
    return {
      ...t,
      divisionCourts: rangeLabel,
      courts: poolCourtMap.get(t.poolName) || rangeLabel,
    };
  });
}

/**
 * Automatically assigns courts 1..totalCourts across all divisions proportionally
 * based on how many teams each division has.
 */
export function autoAssignCourtsByTeamCount(
  teams: TeamEntry[],
  totalCourts: number
): {
  teams: TeamEntry[];
  divisionRanges: Record<string, DivisionCourtRange>;
} {
  const safeTotalCourts = Math.max(1, totalCourts);
  const divisionOrder: string[] = [];
  const divisionCounts = new Map<string, number>();

  teams.forEach((t) => {
    const div = t.division || 'General';
    if (!divisionCounts.has(div)) {
      divisionOrder.push(div);
      divisionCounts.set(div, 0);
    }
    divisionCounts.set(div, (divisionCounts.get(div) || 0) + 1);
  });

  const numDivs = divisionOrder.length;
  if (numDivs === 0) {
    return { teams, divisionRanges: {} };
  }

  const totalTeams = teams.length;
  const allocations = new Map<string, number>();

  if (safeTotalCourts <= numDivs) {
    divisionOrder.forEach((div) => allocations.set(div, 1));
  } else {
    // Guarantee at least 1 court per division, then allocate remaining proportionally by team count
    const quotas = divisionOrder.map((div) => {
      const count = divisionCounts.get(div) || 0;
      const exact = (count / totalTeams) * safeTotalCourts;
      const flo = Math.max(1, Math.floor(exact));
      return { div, count, exact, flo, remainder: exact - Math.floor(exact) };
    });

    let sumFlo = quotas.reduce((acc, q) => acc + q.flo, 0);

    // If minimum-1 constraint pushed sumFlo above safeTotalCourts, trim from largest
    while (sumFlo > safeTotalCourts) {
      quotas.sort((a, b) => b.flo - a.flo);
      if (quotas[0].flo > 1) {
        quotas[0].flo--;
        sumFlo--;
      } else {
        break;
      }
    }

    // Distribute remaining courts by largest remainder
    let remaining = safeTotalCourts - sumFlo;
    const byRemainder = [...quotas].sort((a, b) => b.remainder - a.remainder || b.count - a.count);
    let idx = 0;
    while (remaining > 0 && byRemainder.length > 0) {
      byRemainder[idx % byRemainder.length].flo++;
      remaining--;
      idx++;
    }

    quotas.forEach((q) => allocations.set(q.div, q.flo));
  }

  let updatedTeams = [...teams];
  const divisionRanges: Record<string, DivisionCourtRange> = {};
  let currentCourt = 1;

  divisionOrder.forEach((div) => {
    const courtCount = allocations.get(div) || 1;
    const startCourt = currentCourt;
    const endCourt = currentCourt + courtCount - 1;
    currentCourt = endCourt + 1;

    divisionRanges[div] = {
      startCourt,
      endCourt,
      label: formatCourtRangeLabel(startCourt, endCourt),
    };

    updatedTeams = applyCourtRangeToDivision(updatedTeams, div, startCourt, endCourt);
  });

  return { teams: updatedTeams, divisionRanges };
}

export function getDefaultTournamentTeams(totalCourts = 18): TeamEntry[] {
  const coed = parseTournamentCsv(COED_INTERMEDIATE_CSV, 'Coed Intermediate').teams;
  const men = parseTournamentCsv(MEN_CSV, "Men's Intermediate").teams;
  // Auto-assign courts based on totalCourts (or initial courts)
  return autoAssignCourtsByTeamCount([...coed, ...men], totalCourts).teams;
}

export function parseTeamPlayers(rawTeamName: string, isCheckedInInit: boolean, partialSpec?: string): PlayerSlot[] {
  const trimmed = rawTeamName.trim();
  let names: string[] = [];

  if (trimmed.includes('/')) {
    names = trimmed.split('/').map((s) => s.trim()).filter(Boolean);
  } else if (/\(\+1\)/i.test(trimmed)) {
    const mainPlayer = trimmed.replace(/\(\+1\)/i, '').trim();
    names = [mainPlayer || 'Player 1', `${mainPlayer}'s +1`];
  } else if (trimmed.includes(' & ')) {
    names = trimmed.split(' & ').map((s) => s.trim()).filter(Boolean);
  } else {
    names = [`${trimmed} (Player 1)`, `${trimmed} (Player 2)`];
  }

  const nowIso = isCheckedInInit ? new Date().toISOString() : undefined;

  return names.map((name, idx) => {
    let slotChecked = isCheckedInInit;
    if (!isCheckedInInit && partialSpec) {
      slotChecked = partialSpec.toLowerCase().includes(name.toLowerCase());
    }
    return {
      id: `p-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      checkedIn: slotChecked,
      checkedInAt: slotChecked ? nowIso : undefined,
    };
  });
}

export function getTeamStatus(team: TeamEntry): CheckInStatus {
  if (team.players.length === 0) return 'unarrived';
  const checkedCount = team.players.filter((p) => p.checkedIn).length;
  if (checkedCount === team.players.length) return 'checked-in';
  if (checkedCount > 0) return 'partial';
  return 'unarrived';
}

export function formatDisplayTeamName(team: TeamEntry): string {
  if (
    team.players.length === 2 &&
    (team.players[0].name === `${team.rawTeamName} (Player 1)` ||
      team.players[0].name === `${team.rawTeamName} (P1)`) &&
    (team.players[1].name === `${team.rawTeamName} (Player 2)` ||
      team.players[1].name === `${team.rawTeamName} (P2)`)
  ) {
    return team.rawTeamName;
  }
  return team.rawTeamName || team.players.map((p) => p.name).join(' / ');
}

export function parseTournamentCsv(
  csvText: string,
  defaultDivision = 'General'
): { teams: TeamEntry[]; error?: string } {
  const normalized = csvText
    .replace(/^\uFEFF/, '')
    .replace(/([^\r\n])(Pool Name\s*,\s*Courts)/gi, '$1\n$2')
    .trim();

  if (!normalized) {
    return { teams: [], error: 'CSV file is empty.' };
  }

  const parsed = Papa.parse<Record<string, string>>(normalized, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { teams: [], error: parsed.errors[0].message };
  }

  const teams: TeamEntry[] = [];

  parsed.data.forEach((row, index) => {
    const keys = Object.keys(row);
    const usedKeys = new Set<string>();

    const findCol = (candidates: string[]): string => {
      for (const candidate of candidates) {
        const exactKey = keys.find(
          (k) => !usedKeys.has(k) && k.trim().toLowerCase() === candidate.toLowerCase()
        );
        if (exactKey !== undefined) {
          usedKeys.add(exactKey);
          return (row[exactKey] ?? '').trim();
        }
      }
      for (const candidate of candidates) {
        const partialKey = keys.find(
          (k) => !usedKeys.has(k) && k.trim().toLowerCase().includes(candidate.toLowerCase())
        );
        if (partialKey !== undefined) {
          usedKeys.add(partialKey);
          return (row[partialKey] ?? '').trim();
        }
      }
      return '';
    };

    const rowDivision = findCol(['Division', 'Div', 'Category', 'Bracket']);
    const poolName =
      findCol(['Pool Name', 'Pool', 'Group']) ||
      (keys[0] ? (row[keys[0]] ?? '').trim() : '') ||
      'Unassigned Pool';
    const courts =
      findCol(['Courts', 'Court', 'Court #']) ||
      (keys[1] ? (row[keys[1]] ?? '').trim() : '') ||
      '-';
    const rawTeamName =
      findCol(['Team Name', 'Team', 'Players', 'Player Names', 'Roster']) ||
      (keys[2] ? (row[keys[2]] ?? '').trim() : '');
    const checkedInRaw =
      findCol(['Checked In', 'Check In', 'CheckedIn', 'Status']) ||
      (keys[3] ? (row[keys[3]] ?? '').trim() : '');
    const notesRaw = findCol(['Notes', 'Note', 'Comments']);

    if (
      !rawTeamName ||
      rawTeamName.toLowerCase() === 'team name' ||
      poolName.toLowerCase() === 'pool name'
    ) {
      return;
    }

    const division = rowDivision || defaultDivision || 'General';

    const lowerCheck = checkedInRaw.toLowerCase();
    const isFullCheckIn =
      lowerCheck === 'yes' ||
      lowerCheck === 'true' ||
      lowerCheck === '1' ||
      lowerCheck === 'checked in' ||
      lowerCheck === 'x' ||
      lowerCheck === '✓';

    const isPartial = lowerCheck.startsWith('partial') || lowerCheck.startsWith('1/2');

    const players = parseTeamPlayers(rawTeamName, isFullCheckIn, isPartial ? checkedInRaw : undefined);

    teams.push({
      id: `team-${division}-${index + 1}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      division,
      poolName,
      courts,
      rawTeamName,
      players,
      notes: notesRaw || undefined,
      checkedInAt: isFullCheckIn ? new Date().toISOString() : undefined,
    });
  });

  if (teams.length === 0) {
    return {
      teams: [],
      error: 'No valid team rows found. Make sure your CSV has headers like "Pool Name,Courts,Team Name,Checked In".',
    };
  }

  return { teams };
}

export function exportTournamentCsv(
  teams: TeamEntry[],
  options: { detailed?: boolean; includeDivisionColumn?: boolean } = {}
): string {
  const { detailed = false, includeDivisionColumn = false } = options;

  if (!detailed) {
    const rows = teams.map((team) => {
      const status = getTeamStatus(team);
      let checkedInVal = '';
      if (status === 'checked-in') {
        checkedInVal = 'Yes';
      } else if (status === 'partial') {
        const arrivedNames = team.players
          .filter((p) => p.checkedIn)
          .map((p) => p.name)
          .join(', ');
        checkedInVal = `Partial (${arrivedNames})`;
      }

      if (includeDivisionColumn) {
        return {
          Division: team.division,
          'Pool Name': team.poolName,
          Courts: team.courts,
          'Team Name': formatDisplayTeamName(team),
          'Checked In': checkedInVal,
        };
      }

      return {
        'Pool Name': team.poolName,
        Courts: team.courts,
        'Team Name': formatDisplayTeamName(team),
        'Checked In': checkedInVal,
      };
    });
    return Papa.unparse(rows);
  }

  const rows = teams.map((team) => {
    const status = getTeamStatus(team);
    const p1 = team.players[0];
    const p2 = team.players[1];
    return {
      Division: team.division,
      'Pool Name': team.poolName,
      Courts: team.courts,
      'Team Name': formatDisplayTeamName(team),
      'Checked In': status === 'checked-in' ? 'Yes' : status === 'partial' ? 'Partial (1/2)' : 'No',
      'Player 1': p1?.name ?? '',
      'Player 1 Checked In': p1?.checkedIn ? 'Yes' : 'No',
      'Player 2': p2?.name ?? '',
      'Player 2 Checked In': p2?.checkedIn ? 'Yes' : 'No',
      'Checked In Time': team.checkedInAt
        ? new Date(team.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '',
      Notes: team.notes ?? '',
    };
  });
  return Papa.unparse(rows);
}
