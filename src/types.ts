export interface PlayerSlot {
  id: string;
  name: string;
  checkedIn: boolean;
  checkedInAt?: string;
}

export interface TeamEntry {
  id: string;
  division: string;
  poolName: string;
  courts: string;
  rawTeamName: string;
  players: PlayerSlot[];
  notes?: string;
  checkedInAt?: string;
}

export type CheckInStatus = 'checked-in' | 'partial' | 'unarrived';

export type FilterStatus = 'all' | 'pending' | 'partial' | 'checked-in';
