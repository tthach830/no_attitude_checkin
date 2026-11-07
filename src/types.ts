export interface PlayerSlot {
  id: string;
  name: string;
  checkedIn: boolean;
  checkedInAt?: string;
}

export interface TeamEntry {
  id: string;
  division: string;
  divisionCourts?: string;
  poolName: string;
  courts: string;
  rawTeamName: string;
  players: PlayerSlot[];
  notes?: string;
  checkedInAt?: string;
}

export interface DivisionCourtRange {
  startCourt: number;
  endCourt: number;
  label: string;
}

export type CheckInStatus = 'checked-in' | 'partial' | 'unarrived';

export type FilterStatus = 'all' | 'pending' | 'partial' | 'checked-in';

export interface SavedTournament {
  id: string;
  name: string;
  savedAt: string;
  totalCourtsAvailable: number;
  selectedDivision: string;
  teams: TeamEntry[];
}

