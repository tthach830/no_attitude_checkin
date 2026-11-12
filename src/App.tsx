import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Circle,
  Search,
  Upload,
  UserCheck,
  Users,
  Edit3,
  RotateCcw,
  X,
  FileSpreadsheet,
  Sparkles,
  MapPin,
  AlertCircle,
  FolderOpen,
  Trash2,
  Sliders,
  Save,
  BookmarkCheck,
  Download,
  Lock,
  Unlock,
  ShieldCheck,
  Database,
  LogOut,
} from 'lucide-react';
import type { TeamEntry, FilterStatus, SavedTournament } from './types';
import {
  getDefaultTournamentTeams,
  parseTournamentCsv,
  extractDivisionFromFilename,
  getTeamStatus,
  formatDisplayTeamName,
  applyCourtRangeToDivision,
  autoAssignCourtsByTeamCount,
  formatCourtRangeLabel,
} from './utils/csv';
import {
  getClientSenderId,
  publishLiveSync,
  fetchLatestLiveState,
  subscribeToLiveUpdates,
} from './utils/liveSync';
import {
  syncTeamsToSqlite,
  querySqlite,
  downloadSqliteDatabase,
} from './utils/sqliteDb';

const STORAGE_KEY = 'no_attitude_checkin_teams_v4';
const STORAGE_COURTS_KEY = 'no_attitude_checkin_total_courts_v1';
const STORAGE_SELECTED_DIV_KEY = 'no_attitude_checkin_selected_div_v1';
const STORAGE_TOURNAMENT_NAME_KEY = 'no_attitude_checkin_tournament_name_v1';
const STORAGE_ACTIVE_SAVED_ID_KEY = 'no_attitude_checkin_active_saved_id_v1';
const STORAGE_SAVED_TOURNAMENTS_KEY = 'no_attitude_checkin_saved_tournaments_v1';
const STORAGE_ADMIN_AUTH_KEY = 'no_attitude_admin_auth_v1';
const ADMIN_DEFAULT_PASSWORD = 'admin';

const DIVISION_BADGE_COLORS = [
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-orange-100 text-orange-800 border-orange-200',
];

export function App() {
  const [tournamentName, setTournamentName] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_TOURNAMENT_NAME_KEY);
    if (saved && !saved.startsWith('No Attitude Tournament (')) {
      return saved;
    }
    return 'NA_11072026';
  });

  const [totalCourtsAvailable, setTotalCourtsAvailable] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_COURTS_KEY);
    const parsed = saved ? parseInt(saved, 10) : 18;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 18;
  });

  const [teams, setTeams] = useState<TeamEntry[]>(() => {
    try {
      localStorage.removeItem('no_attitude_checkin_teams_v1');
      localStorage.removeItem('no_attitude_checkin_teams_v2');
      localStorage.removeItem('no_attitude_checkin_teams_v3');
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as TeamEntry[];
        const hasValidNames =
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((t) => t.division && t.rawTeamName && t.rawTeamName !== t.poolName);
        if (hasValidNames) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return getDefaultTournamentTeams(18);
  });

  const [savedTournaments, setSavedTournaments] = useState<SavedTournament[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_SAVED_TOURNAMENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedTournament[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [activeSavedTournamentId, setActiveSavedTournamentId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_ACTIVE_SAVED_ID_KEY) || null;
  });

  const [lastSavedAt, setLastSavedAt] = useState<string>(() => new Date().toISOString());

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>(() => {
    const savedDiv = localStorage.getItem(STORAGE_SELECTED_DIV_KEY);
    if (savedDiv && teams.some((t) => t.division === savedDiv)) {
      return savedDiv;
    }
    return teams[0]?.division || 'Coed Intermediate';
  });
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [liveSyncStatus, setLiveSyncStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const senderIdRef = useRef<string>(getClientSenderId());

  // Admin Authentication State
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const adminQuery = urlParams.get('admin');
      if (adminQuery === 'true' || adminQuery === '1' || adminQuery === 'admin') {
        localStorage.setItem(STORAGE_ADMIN_AUTH_KEY, 'true');
        return true;
      }
      return localStorage.getItem(STORAGE_ADMIN_AUTH_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // SQLite Database State
  const [sqliteRowCount, setSqliteRowCount] = useState<number>(0);
  const [sqliteLastSyncedAt, setSqliteLastSyncedAt] = useState<string | null>(null);

  // Modals
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);
  const [showSqliteModal, setShowSqliteModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSaveTournamentModal, setShowSaveTournamentModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'merge' | 'replace'>('merge');
  const [autoAssignOnUpload, setAutoAssignOnUpload] = useState(true);
  const [pasteDivisionName, setPasteDivisionName] = useState('Coed Intermediate');
  const [pasteCsvText, setPasteCsvText] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessBanner, setUploadSuccessBanner] = useState<string | null>(null);

  const [editingTeam, setEditingTeam] = useState<TeamEntry | null>(null);
  const [editingDivisionCourts, setEditingDivisionCourts] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    teamName: string;
    division: string;
    poolName: string;
    courts: string;
    statusText: string;
  } | null>(null);

  const multiFileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const tournamentBackupInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Real-time cloud sync for Player Self Check-In across all devices
  useEffect(() => {
    let active = true;

    fetchLatestLiveState().then((remote) => {
      if (!active) return;
      if (remote && Array.isArray(remote.teams) && remote.teams.length > 0) {
        setTournamentName(remote.tournamentName);
        setTotalCourtsAvailable(remote.totalCourtsAvailable);
        setTeams(remote.teams);
        setSelectedDivision((prev) =>
          remote.teams.some((t) => t.division === prev)
            ? prev
            : remote.teams[0]?.division || 'Coed Intermediate'
        );
      }
      setLiveSyncStatus('live');
    });

    const unsubscribe = subscribeToLiveUpdates((payload) => {
      if (!active) return;
      setLiveSyncStatus('live');
      if (payload.senderId === senderIdRef.current) return;

      if (payload.type === 'full_state' && Array.isArray(payload.teams) && payload.teams.length > 0) {
        setTournamentName(payload.tournamentName || 'Tournament Check-In');
        setTotalCourtsAvailable(payload.totalCourtsAvailable || 18);
        setTeams(payload.teams);
      } else if (payload.type === 'team_update' && payload.updatedTeam) {
        const updated = payload.updatedTeam;
        setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const broadcastFullRosterToLive = (
    nextTeams: TeamEntry[],
    nextTotalCourts: number = totalCourtsAvailable,
    nextName: string = tournamentName
  ) => {
    publishLiveSync({
      type: 'full_state',
      senderId: senderIdRef.current,
      timestamp: Date.now(),
      tournamentName: nextName,
      totalCourtsAvailable: nextTotalCourts,
      teams: nextTeams,
    });
  };

  const broadcastTeamCheckInToLive = (updatedTeam: TeamEntry) => {
    publishLiveSync({
      type: 'team_update',
      senderId: senderIdRef.current,
      timestamp: Date.now(),
      tournamentName,
      totalCourtsAvailable,
      updatedTeam,
    });
  };

  // Persist active tournament state on every change
  useEffect(() => {
    try {
      const nowIso = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
      localStorage.setItem(STORAGE_COURTS_KEY, String(totalCourtsAvailable));
      localStorage.setItem(STORAGE_SELECTED_DIV_KEY, selectedDivision);
      localStorage.setItem(STORAGE_TOURNAMENT_NAME_KEY, tournamentName);
      if (activeSavedTournamentId) {
        localStorage.setItem(STORAGE_ACTIVE_SAVED_ID_KEY, activeSavedTournamentId);
      }
      setLastSavedAt(nowIso);

      // Keep the active saved tournament slot automatically synced
      setSavedTournaments((prev) => {
        if (prev.length === 0) {
          const initialEntry: SavedTournament = {
            id: activeSavedTournamentId || 'tournament-default',
            name: tournamentName,
            savedAt: nowIso,
            totalCourtsAvailable,
            selectedDivision,
            teams,
          };
          localStorage.setItem(STORAGE_SAVED_TOURNAMENTS_KEY, JSON.stringify([initialEntry]));
          if (!activeSavedTournamentId) {
            setActiveSavedTournamentId(initialEntry.id);
            localStorage.setItem(STORAGE_ACTIVE_SAVED_ID_KEY, initialEntry.id);
          }
          return [initialEntry];
        }

        const targetId = activeSavedTournamentId || prev[0].id;
        const exists = prev.some((item) => item.id === targetId);
        if (!exists) return prev;

        const next = prev.map((item) =>
          item.id === targetId
            ? {
                ...item,
                name: tournamentName,
                savedAt: nowIso,
                totalCourtsAvailable,
                selectedDivision,
                teams,
              }
            : item
        );
        localStorage.setItem(STORAGE_SAVED_TOURNAMENTS_KEY, JSON.stringify(next));
        return next;
      });
    } catch {
      // ignore storage errors
    }
  }, [teams, totalCourtsAvailable, selectedDivision, tournamentName, activeSavedTournamentId]);

  // Synchronize all teams and their live check-in timestamps to SQLite `checkin` table
  useEffect(() => {
    if (teams.length === 0) return;
    let active = true;

    syncTeamsToSqlite(teams, tournamentName)
      .then((res) => {
        if (!active) return;
        if (res.success) {
          setSqliteRowCount(res.rowsSaved);
          setSqliteLastSyncedAt(
            new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          );
        }
      })
      .catch((err) => {
        console.error('[SQLite] Auto-sync to checkin table failed:', err);
      });

    return () => {
      active = false;
    };
  }, [teams, tournamentName]);

  const handleAdminLogin = (password: string): boolean => {
    const trimmed = password.trim();
    if (trimmed === ADMIN_DEFAULT_PASSWORD || trimmed === '1234') {
      setIsAdmin(true);
      try {
        localStorage.setItem(STORAGE_ADMIN_AUTH_KEY, 'true');
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    try {
      localStorage.removeItem(STORAGE_ADMIN_AUTH_KEY);
    } catch {
      // ignore
    }
  };

  const handleSaveTournamentSnapshot = (customName?: string, asNewSlot = false) => {
    const nameToUse = (customName ?? tournamentName).trim() || 'Tournament Check-In';
    const nowIso = new Date().toISOString();
    setTournamentName(nameToUse);

    setSavedTournaments((prev) => {
      let next: SavedTournament[];
      if (!asNewSlot && activeSavedTournamentId && prev.some((t) => t.id === activeSavedTournamentId)) {
        next = prev.map((item) =>
          item.id === activeSavedTournamentId
            ? {
                ...item,
                name: nameToUse,
                savedAt: nowIso,
                totalCourtsAvailable,
                selectedDivision,
                teams,
              }
            : item
        );
      } else {
        const newId = `tournament-${Date.now()}`;
        const newEntry: SavedTournament = {
          id: newId,
          name: nameToUse,
          savedAt: nowIso,
          totalCourtsAvailable,
          selectedDivision,
          teams,
        };
        setActiveSavedTournamentId(newId);
        localStorage.setItem(STORAGE_ACTIVE_SAVED_ID_KEY, newId);
        next = [newEntry, ...prev];
      }
      localStorage.setItem(STORAGE_SAVED_TOURNAMENTS_KEY, JSON.stringify(next));
      return next;
    });

    setLastSavedAt(nowIso);
    setUploadSuccessBanner(`Saved tournament "${nameToUse}" (${teams.length} teams, ${totalCourtsAvailable} courts).`);
    setTimeout(() => setUploadSuccessBanner(null), 4000);
  };

  const handleLoadSavedTournament = (saved: SavedTournament) => {
    setTournamentName(saved.name);
    setTotalCourtsAvailable(saved.totalCourtsAvailable || 18);
    setTeams(saved.teams);
    setSelectedDivision(saved.selectedDivision || saved.teams[0]?.division || 'Coed Intermediate');
    setActiveSavedTournamentId(saved.id);
    setShowSaveTournamentModal(false);
    setUploadSuccessBanner(`Loaded tournament "${saved.name}" (${saved.teams.length} teams).`);
    setTimeout(() => setUploadSuccessBanner(null), 4000);
  };

  const handleDeleteSavedTournament = (id: string) => {
    setSavedTournaments((prev) => {
      const next = prev.filter((item) => item.id !== id);
      localStorage.setItem(STORAGE_SAVED_TOURNAMENTS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleExportTournamentBackupJson = () => {
    const payload: SavedTournament = {
      id: activeSavedTournamentId || `tournament-${Date.now()}`,
      name: tournamentName,
      savedAt: new Date().toISOString(),
      totalCourtsAvailable,
      selectedDivision,
      teams,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = tournamentName.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'tournament';
    a.href = url;
    a.download = `${safeName}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTournamentBackupJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<SavedTournament>;
      if (!parsed.teams || !Array.isArray(parsed.teams) || parsed.teams.length === 0) {
        setUploadError('Invalid tournament backup file.');
        return;
      }
      const importedEntry: SavedTournament = {
        id: parsed.id || `tournament-${Date.now()}`,
        name: parsed.name || file.name.replace(/\.json$/i, ''),
        savedAt: new Date().toISOString(),
        totalCourtsAvailable: parsed.totalCourtsAvailable || 18,
        selectedDivision: parsed.selectedDivision || parsed.teams[0].division || 'Coed Intermediate',
        teams: parsed.teams,
      };
      setSavedTournaments((prev) => {
        const next = [importedEntry, ...prev.filter((t) => t.id !== importedEntry.id)];
        localStorage.setItem(STORAGE_SAVED_TOURNAMENTS_KEY, JSON.stringify(next));
        return next;
      });
      handleLoadSavedTournament(importedEntry);
    } catch {
      setUploadError('Could not parse tournament backup JSON file.');
    }
  };

  const divisionsList = useMemo(() => {
    const map = new Map<
      string,
      {
        division: string;
        total: number;
        checkedIn: number;
        partial: number;
        divisionCourts?: string;
        courtsSet: Set<string>;
      }
    >();
    teams.forEach((t) => {
      const div = t.division || 'General';
      const item = map.get(div) || {
        division: div,
        total: 0,
        checkedIn: 0,
        partial: 0,
        divisionCourts: t.divisionCourts,
        courtsSet: new Set<string>(),
      };
      item.total++;
      if (t.divisionCourts) item.divisionCourts = t.divisionCourts;
      if (t.courts && t.courts !== '-') item.courtsSet.add(t.courts);
      const st = getTeamStatus(t);
      if (st === 'checked-in') item.checkedIn++;
      else if (st === 'partial') item.partial++;
      map.set(div, item);
    });

    return Array.from(map.values()).map((item) => {
      let courtLabel = item.divisionCourts || '';
      if (!courtLabel && item.courtsSet.size > 0) {
        const nums: number[] = [];
        item.courtsSet.forEach((c) => {
          c.split(/[-,\s]+/).forEach((part) => {
            const n = parseInt(part, 10);
            if (Number.isFinite(n)) nums.push(n);
          });
        });
        if (nums.length > 0) {
          const minC = Math.min(...nums);
          const maxC = Math.max(...nums);
          courtLabel = formatCourtRangeLabel(minC, maxC);
        } else {
          courtLabel = Array.from(item.courtsSet).join(', ');
        }
      }
      return {
        division: item.division,
        total: item.total,
        checkedIn: item.checkedIn,
        partial: item.partial,
        courtLabel: courtLabel || '1',
      };
    });
  }, [teams]);

  const getDivisionColorClass = (division: string) => {
    const idx = divisionsList.findIndex((d) => d.division === division);
    return DIVISION_BADGE_COLORS[(idx >= 0 ? idx : 0) % DIVISION_BADGE_COLORS.length];
  };

  const triggerCheckInBanner = (_team: TeamEntry, statusText: string) => {
    setToastMessage({
      teamName: _team.rawTeamName || formatDisplayTeamName(_team),
      division: _team.division,
      poolName: _team.poolName,
      courts: _team.courts,
      statusText,
    });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.statusText === statusText ? null : prev));
    }, 4000);
  };

  // Toggle entire team check-in with 1 tap
  const toggleFullTeamCheckIn = (teamId: string) => {
    setTeams((prev) =>
      prev.map((team) => {
        if (team.id !== teamId) return team;
        const currentStatus = getTeamStatus(team);
        const targetChecked = currentStatus !== 'checked-in';
        const nowIso = targetChecked ? new Date().toISOString() : undefined;

        const updated: TeamEntry = {
          ...team,
          checkedInAt: nowIso,
          players: team.players.map((p) => ({
            ...p,
            checkedIn: targetChecked,
            checkedInAt: targetChecked ? p.checkedInAt || nowIso : undefined,
          })),
        };

        triggerCheckInBanner(
          updated,
          targetChecked
            ? `Checked In! Go to Court ${updated.courts} (${updated.poolName})`
            : 'Check-In Cleared'
        );
        broadcastTeamCheckInToLive(updated);

        return updated;
      })
    );
  };

  // Toggle an individual player slot with 1 tap
  const togglePlayerCheckIn = (teamId: string, playerId: string) => {
    setTeams((prev) =>
      prev.map((team) => {
        if (team.id !== teamId) return team;
        const nowIso = new Date().toISOString();
        let toggledPlayerName = '';
        let toggledPlayerChecked = false;

        const updatedPlayers = team.players.map((p) => {
          if (p.id !== playerId) return p;
          const nextChecked = !p.checkedIn;
          toggledPlayerName = p.name;
          toggledPlayerChecked = nextChecked;
          return {
            ...p,
            checkedIn: nextChecked,
            checkedInAt: nextChecked ? nowIso : undefined,
          };
        });

        const allChecked = updatedPlayers.every((p) => p.checkedIn);
        const updated: TeamEntry = {
          ...team,
          players: updatedPlayers,
          checkedInAt: allChecked ? team.checkedInAt || nowIso : undefined,
        };

        triggerCheckInBanner(
          updated,
          allChecked
            ? `Full Team Checked In! Go to Court ${updated.courts}`
            : toggledPlayerChecked
            ? `${toggledPlayerName} Checked In! Court ${updated.courts} (${updated.poolName})`
            : `${toggledPlayerName} Unchecked`
        );
        broadcastTeamCheckInToLive(updated);

        return updated;
      })
    );
  };

  // Process multiple CSV files (from multi-file picker, folder picker, or drag-and-drop)
  const handleMultipleFilesLoaded = async (
    fileList: File[],
    mode: 'merge' | 'replace' = uploadMode
  ) => {
    const csvFiles = fileList.filter(
      (f) =>
        f.name.toLowerCase().endsWith('.csv') ||
        f.type === 'text/csv' ||
        (fileList.length === 1 && f.type === 'text/plain')
    );

    if (csvFiles.length === 0) {
      setUploadError(
        'No .csv files found in your selection. Please select CSV files or a folder containing CSV files.'
      );
      setShowUploadModal(true);
      return;
    }

    const loadedTeamsByDiv: { division: string; teams: TeamEntry[] }[] = [];
    const errors: string[] = [];

    for (const file of csvFiles) {
      try {
        const text = await file.text();
        const divisionName = extractDivisionFromFilename(file.name);
        const parsed = parseTournamentCsv(text, divisionName);
        if (parsed.error) {
          errors.push(`${file.name}: ${parsed.error}`);
        } else if (parsed.teams.length > 0) {
          loadedTeamsByDiv.push({ division: divisionName, teams: parsed.teams });
        }
      } catch {
        errors.push(`Failed to read ${file.name}`);
      }
    }

    if (loadedTeamsByDiv.length === 0) {
      setUploadError(
        errors.join(' | ') || 'Could not parse any valid teams from the selected CSV files.'
      );
      setShowUploadModal(true);
      return;
    }

    const newlyLoadedTeams = loadedTeamsByDiv.flatMap((d) => d.teams);
    const uploadedDivisions = new Set(loadedTeamsByDiv.map((d) => d.division));

    setTeams((prev) => {
      const combined =
        mode === 'replace'
          ? newlyLoadedTeams
          : [...prev.filter((t) => !uploadedDivisions.has(t.division)), ...newlyLoadedTeams];

      const finalTeams = autoAssignOnUpload
        ? autoAssignCourtsByTeamCount(combined, totalCourtsAvailable).teams
        : combined;
      broadcastFullRosterToLive(finalTeams, totalCourtsAvailable);
      return finalTeams;
    });

    const firstDiv = Array.from(uploadedDivisions)[0] || 'Coed Intermediate';
    const divNames = Array.from(uploadedDivisions).join(', ');
    setSelectedDivision(firstDiv);
    setUploadError(null);
    setShowUploadModal(false);
    setUploadSuccessBanner(
      `Loaded & published ${newlyLoadedTeams.length} teams across ${uploadedDivisions.size} division${
        uploadedDivisions.size > 1 ? 's' : ''
      } (${divNames}) for player self check-in.`
    );
    setTimeout(() => setUploadSuccessBanner(null), 5000);
  };

  // Recursively read dropped folders or files via DataTransferItem.webkitGetAsEntry
  const handleDropItems = async (dataTransfer: DataTransfer) => {
    const items = dataTransfer.items;
    if (items && items.length > 0) {
      const collectedFiles: File[] = [];

      const readEntry = async (entry: FileSystemEntry): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          const file = await new Promise<File>((resolve, reject) =>
            fileEntry.file(resolve, reject)
          );
          if (file.name.toLowerCase().endsWith('.csv')) {
            collectedFiles.push(file);
          }
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const reader = dirEntry.createReader();
          const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject)
          );
          for (const child of entries) {
            await readEntry(child);
          }
        }
      };

      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length > 0) {
        for (const entry of entries) {
          await readEntry(entry);
        }
        if (collectedFiles.length > 0) {
          await handleMultipleFilesLoaded(collectedFiles, uploadMode);
          return;
        }
      }
    }

    const files = Array.from(dataTransfer.files || []);
    if (files.length > 0) {
      await handleMultipleFilesLoaded(files, uploadMode);
    }
  };

  const handlePasteCsvSubmit = () => {
    const divName = pasteDivisionName.trim() || 'General';
    const result = parseTournamentCsv(pasteCsvText, divName);
    if (result.error) {
      setUploadError(result.error);
      return;
    }
    setTeams((prev) => {
      const combined =
        uploadMode === 'replace'
          ? result.teams
          : [...prev.filter((t) => t.division !== divName), ...result.teams];
      if (autoAssignOnUpload) {
        return autoAssignCourtsByTeamCount(combined, totalCourtsAvailable).teams;
      }
      return combined;
    });
    setSelectedDivision(divName);
    setUploadError(null);
    setPasteCsvText('');
    setShowUploadModal(false);
    setUploadSuccessBanner(`Loaded ${result.teams.length} teams into division "${divName}"`);
    setTimeout(() => setUploadSuccessBanner(null), 5000);
  };

  const handleRemoveDivision = (divisionToRemove: string) => {
    if (!window.confirm(`Remove the entire "${divisionToRemove}" division from the roster?`)) return;
    setTeams((prev) => {
      const next = prev.filter((t) => t.division !== divisionToRemove);
      if (selectedDivision === divisionToRemove && next.length > 0) {
        setSelectedDivision(next[0].division);
      }
      return next;
    });
  };

  const handleClearCheckIns = () => {
    if (!window.confirm(`Clear all check-in marks for "${selectedDivision}"?`)) return;
    setTeams((prev) =>
      prev.map((t) => {
        if (t.division !== selectedDivision) return t;
        return {
          ...t,
          checkedInAt: undefined,
          players: t.players.map((p) => ({ ...p, checkedIn: false, checkedInAt: undefined })),
        };
      })
    );
    setToastMessage(null);
  };

  const handleAutoAssignAllCourts = (courtsCount: number) => {
    setTotalCourtsAvailable(courtsCount);
    setTeams((prev) => {
      const next = autoAssignCourtsByTeamCount(prev, courtsCount).teams;
      broadcastFullRosterToLive(next, courtsCount);
      return next;
    });
    setUploadSuccessBanner(
      `Auto-assigned Courts 1–${courtsCount} across ${divisionsList.length} divisions based on team counts.`
    );
    setTimeout(() => setUploadSuccessBanner(null), 4000);
  };

  // Teams scoped to the currently selected Division
  const divisionScopedTeams = useMemo(() => {
    return teams.filter((t) => t.division === selectedDivision);
  }, [teams, selectedDivision]);

  // Derived statistics for the current Division view
  const stats = useMemo(() => {
    let fullTeams = 0;
    let partialTeams = 0;
    let unarrivedTeams = 0;
    let checkedInPlayers = 0;
    let totalPlayers = 0;

    divisionScopedTeams.forEach((team) => {
      const status = getTeamStatus(team);
      if (status === 'checked-in') fullTeams++;
      else if (status === 'partial') partialTeams++;
      else unarrivedTeams++;

      team.players.forEach((p) => {
        totalPlayers++;
        if (p.checkedIn) checkedInPlayers++;
      });
    });

    return {
      totalTeams: divisionScopedTeams.length,
      fullTeams,
      partialTeams,
      unarrivedTeams,
      pendingTeams: partialTeams + unarrivedTeams,
      checkedInPlayers,
      totalPlayers,
      progressPct:
        divisionScopedTeams.length > 0
          ? Math.round((fullTeams / divisionScopedTeams.length) * 100)
          : 0,
    };
  }, [divisionScopedTeams]);

  // Pools summary scoped to selected Division
  const poolsSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        division: string;
        poolName: string;
        courts: Set<string>;
        total: number;
        checkedIn: number;
        partial: number;
      }
    >();

    divisionScopedTeams.forEach((team) => {
      const key = team.poolName;
      const existing = map.get(key) || {
        key,
        division: team.division,
        poolName: team.poolName,
        courts: new Set<string>(),
        total: 0,
        checkedIn: 0,
        partial: 0,
      };
      if (team.courts && team.courts !== '-') existing.courts.add(team.courts);
      existing.total++;
      const st = getTeamStatus(team);
      if (st === 'checked-in') existing.checkedIn++;
      else if (st === 'partial') existing.partial++;
      map.set(key, existing);
    });

    return Array.from(map.values()).map((item) => ({
      ...item,
      courtsLabel: Array.from(item.courts).join(', '),
      isReady: item.total > 0 && item.checkedIn === item.total,
    }));
  }, [divisionScopedTeams]);

  // Filtered teams — when searching by player/team name, search across ALL divisions so players find their team immediately
  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sourceTeams = q ? teams : divisionScopedTeams;

    return sourceTeams.filter((team) => {
      const status = getTeamStatus(team);
      if (statusFilter === 'checked-in' && status !== 'checked-in') return false;
      if (statusFilter === 'partial' && status !== 'partial') return false;
      if (statusFilter === 'pending' && status === 'checked-in') return false;

      if (!q) return true;
      const rawName = team.rawTeamName.toLowerCase();
      const displayTeam = formatDisplayTeamName(team).toLowerCase();
      const playerMatch = team.players.some((p) => p.name.toLowerCase().includes(q));
      const divMatch = team.division.toLowerCase().includes(q);
      const poolMatch = team.poolName.toLowerCase().includes(q);
      const courtMatch = `court ${team.courts}`.toLowerCase().includes(q);
      const notesMatch = (team.notes || '').toLowerCase().includes(q);

      return (
        rawName.includes(q) ||
        displayTeam.includes(q) ||
        playerMatch ||
        divMatch ||
        poolMatch ||
        courtMatch ||
        notesMatch
      );
    });
  }, [teams, divisionScopedTeams, statusFilter, searchQuery]);

  // Group by Division + Pool
  const groupedByDivisionAndPool = useMemo(() => {
    const groups: {
      groupKey: string;
      division: string;
      poolName: string;
      courtsLabel: string;
      teams: TeamEntry[];
    }[] = [];
    const map = new Map<
      string,
      { division: string; poolName: string; courts: Set<string>; teams: TeamEntry[] }
    >();

    filteredTeams.forEach((t) => {
      const groupKey = `${t.division}:::${t.poolName}`;
      let grp = map.get(groupKey);
      if (!grp) {
        grp = {
          division: t.division,
          poolName: t.poolName,
          courts: new Set<string>(),
          teams: [],
        };
        map.set(groupKey, grp);
        groups.push({
          groupKey,
          division: t.division,
          poolName: t.poolName,
          courtsLabel: '',
          teams: grp.teams,
        });
      }
      if (t.courts && t.courts !== '-') grp.courts.add(t.courts);
      grp.teams.push(t);
    });

    return groups.map((g) => {
      const courtsSet = map.get(g.groupKey)?.courts;
      return {
        ...g,
        courtsLabel: courtsSet && courtsSet.size > 0 ? Array.from(courtsSet).join(', ') : '-',
      };
    });
  }, [filteredTeams]);

  return (
    <div
      className="min-h-screen bg-slate-100 text-slate-900 pb-safe flex flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        handleDropItems(e.dataTransfer);
      }}
    >
      {/* Hidden Multiple CSV File Input */}
      <input
        ref={multiFileInputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) handleMultipleFilesLoaded(files, uploadMode);
          e.target.value = '';
        }}
      />

      {/* Hidden Folder Input (webkitdirectory) */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard across desktop & mobile browsers
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) handleMultipleFilesLoaded(files, uploadMode);
          e.target.value = '';
        }}
      />

      {/* Hidden Tournament JSON Backup Input */}
      <input
        ref={tournamentBackupInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportTournamentBackupJson(file);
          e.target.value = '';
        }}
      />

      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-50 bg-emerald-950/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-10 max-w-md w-full text-center shadow-2xl border-4 border-dashed border-emerald-500">
            <FolderOpen className="w-16 h-16 text-emerald-600 mx-auto mb-4 animate-bounce" />
            <h2 className="text-2xl font-bold text-slate-900">
              Drop CSV Files or Folder Here
            </h2>
            <p className="text-slate-500 mt-2">
              Each CSV filename automatically becomes a Division and courts are assigned based on team counts.
            </p>
          </div>
        </div>
      )}

      {/* Header — Mobile-First Compact Layout */}
      <header className="bg-slate-900 text-white pt-safe sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-2.5 pb-2">
          {/* Top Row: Brand + Title on Left | Action Buttons on Right */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
                <UserCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => (isAdmin ? setShowSaveTournamentModal(true) : setShowAdminLoginModal(true))}
                    className="text-sm sm:text-lg font-extrabold tracking-tight hover:text-emerald-300 transition flex items-center gap-1 truncate cursor-pointer"
                    title={isAdmin ? "Tournament Name & Settings" : "Admin Login to Edit Tournament"}
                  >
                    <span className="truncate">{tournamentName}</span>
                    {isAdmin && <Edit3 className="w-3 h-3 text-slate-400 shrink-0" />}
                  </button>
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0"
                    title={`Live Sync Active • SQLite synced (${sqliteRowCount} rows) • Last saved at ${new Date(lastSavedAt).toLocaleTimeString()}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{liveSyncStatus === 'live' ? 'LIVE' : 'SAVED'}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                  <span>{divisionsList.length} Divs</span>
                  <span>•</span>
                  <span>{teams.length} Teams</span>
                  <span>•</span>
                  <span className="text-emerald-400 font-semibold">{totalCourtsAvailable} Courts</span>
                  {sqliteRowCount > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-sky-300 font-medium">SQLite: {sqliteRowCount}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Controls: Gated by Admin Access */}
            <div className="flex items-center gap-1.5 shrink-0">
              {!isAdmin ? (
                /* Player / Viewer View: Only Admin Login Button */
                <button
                  onClick={() => setShowAdminLoginModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-200 border border-slate-700 transition cursor-pointer"
                  title="Admin Access (Upload CSVs, Courts, Save, SQLite)"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Admin</span>
                </button>
              ) : (
                /* Admin View: Full Controls for Upload CSVs, Courts, Save, SQLite */
                <>
                  <button
                    onClick={() => setShowAdminLoginModal(true)}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition cursor-pointer"
                    title="Admin Mode Active — click to manage or lock"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden sm:inline">Admin</span>
                  </button>

                  <button
                    onClick={() => setShowSqliteModal(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-sky-300 border border-sky-800/80 transition cursor-pointer"
                    title="SQLite Database (checkin table & query tool)"
                  >
                    <Database className="w-3.5 h-3.5 text-sky-400" />
                    <span>SQLite ({sqliteRowCount})</span>
                  </button>

                  <button
                    onClick={() => setShowSaveTournamentModal(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-100 border border-slate-700 transition cursor-pointer"
                    title="Saved Tournaments & Backups"
                  >
                    <Save className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="hidden sm:inline">Save</span>
                  </button>

                  <button
                    onClick={() => setEditingDivisionCourts(selectedDivision)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-100 border border-slate-700 transition cursor-pointer"
                    title="Assign & Edit Courts"
                  >
                    <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{totalCourtsAvailable} Cts</span>
                  </button>

                  <button
                    onClick={() => {
                      setUploadError(null);
                      setShowUploadModal(true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-xs font-extrabold text-slate-950 transition shadow-2xs cursor-pointer"
                    title="Upload CSV Files"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>CSVs</span>
                  </button>

                  <button
                    onClick={handleAdminLogout}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:scale-95 text-rose-300 border border-rose-500/40 text-xs font-bold transition cursor-pointer"
                    title="Log Out of Admin Mode"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-400" />
                    <span className="hidden sm:inline">Logout</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Division Tabs Strip — Swipeable Horizontal Pills with Court Badge */}
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {divisionsList.map((div) => {
              const isSelected = selectedDivision === div.division;
              const isAllReady = div.total > 0 && div.checkedIn === div.total;
              return (
                <div
                  key={div.division}
                  className={`inline-flex items-center rounded-xl border transition shrink-0 ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-xs'
                      : isAllReady
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700 hover:bg-emerald-900/70'
                      : 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (isSelected && isAdmin) {
                        setEditingDivisionCourts(div.division);
                      } else {
                        setSelectedDivision(div.division);
                      }
                    }}
                    className="px-2.5 py-1.5 text-xs font-extrabold whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{div.division}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                        isSelected
                          ? 'bg-slate-950/20 text-slate-950'
                          : isAllReady
                          ? 'bg-emerald-500/30 text-emerald-200'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {div.checkedIn}/{div.total}
                    </span>
                  </button>

                  {isAdmin ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDivision(div.division);
                        setEditingDivisionCourts(div.division);
                      }}
                      className={`mr-1.5 px-2 py-0.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer ${
                        isSelected
                          ? 'bg-slate-950 text-emerald-400 hover:bg-slate-800'
                          : 'bg-slate-950/60 text-emerald-300 hover:bg-slate-950'
                      }`}
                      title={`Edit assigned courts for ${div.division}`}
                    >
                      <span>Ct {div.courtLabel}</span>
                      <Edit3 className="w-2.5 h-2.5 opacity-80" />
                    </button>
                  ) : (
                    <span
                      className={`mr-1.5 px-2 py-0.5 rounded-lg text-[11px] font-bold flex items-center gap-1 ${
                        isSelected
                          ? 'bg-slate-950/80 text-emerald-400'
                          : 'bg-slate-950/40 text-emerald-300'
                      }`}
                      title={`Courts assigned: ${div.courtLabel}`}
                    >
                      <span>Ct {div.courtLabel}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Check-In Status Bar — Gradient from Red to Green */}
        <div className="w-full bg-slate-950 px-3 sm:px-4 py-2 border-t border-slate-800/90">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Check-In:</span>
              <span className="text-white font-extrabold">{stats.fullTeams}/{stats.totalTeams}</span>
              <span className="text-slate-400 font-semibold">({stats.progressPct}%)</span>
            </div>

            <div className="flex-1 max-w-sm sm:max-w-md h-2.5 bg-red-950/70 rounded-full overflow-hidden border border-red-900/50 relative shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-500 transition-all duration-300 rounded-full shadow-xs"
                style={{
                  width: `${stats.totalTeams ? (stats.fullTeams / stats.totalTeams) * 100 : 0}%`,
                }}
              />
            </div>

            <div className="text-[11px] sm:text-xs font-semibold text-rose-300/90 shrink-0">
              {stats.pendingTeams} Not Checked In
            </div>
          </div>
        </div>

        {/* Sticky Search & Filter Subbar */}
        <div className="bg-white border-b border-slate-200 text-slate-900 px-3 sm:px-4 py-2 shadow-2xs">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your name or team name..."
                className="w-full pl-9 pr-8 py-2 bg-slate-100 hover:bg-slate-200/70 focus:bg-white rounded-xl text-sm font-medium border border-slate-200 focus:border-emerald-500 focus:outline-none transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Status Filter Pills + Reset/Remove Div */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {(
                [
                  { id: 'all', label: `All (${stats.totalTeams})` },
                  { id: 'pending', label: `Pending (${stats.pendingTeams})` },
                  { id: 'partial', label: `1/2 Here (${stats.partialTeams})` },
                  { id: 'checked-in', label: `Checked In (${stats.fullTeams})` },
                ] as { id: FilterStatus; label: string }[]
              ).map((tab) => {
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}

              {isAdmin && (stats.fullTeams > 0 || stats.partialTeams > 0) && (
                <button
                  onClick={handleClearCheckIns}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 text-xs font-semibold text-slate-600 hover:text-rose-600 whitespace-nowrap transition cursor-pointer"
                  title="Clear check-ins"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}

              {isAdmin && divisionsList.length > 1 && (
                <button
                  onClick={() => handleRemoveDivision(selectedDivision)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 text-xs font-semibold text-slate-600 hover:text-rose-600 whitespace-nowrap transition cursor-pointer"
                  title={`Remove ${selectedDivision} division`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl w-full mx-auto px-3 sm:px-4 py-3.5 sm:py-5 flex-1 space-y-4">
        {uploadSuccessBanner && (
          <div className="bg-emerald-900 text-white px-3.5 py-2.5 rounded-2xl shadow-md flex items-center justify-between text-xs sm:text-sm font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{uploadSuccessBanner}</span>
            </div>
            <button
              onClick={() => setUploadSuccessBanner(null)}
              className="text-emerald-200 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {toastMessage && (
          <div className="bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-md border border-emerald-500/60 flex items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-bold truncate text-white">{toastMessage.teamName}</span>
              <span className="text-emerald-400 font-semibold">• {toastMessage.statusText}</span>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {groupedByDivisionAndPool.length === 0 ? (
          <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-xs my-4">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2.5" />
            <h3 className="text-base font-bold text-slate-800">No Matching Teams</h3>
            <p className="text-xs text-slate-500 mt-1">
              Try clearing your search filter or switching the status tab above.
            </p>
            {(searchQuery || statusFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
                className="mt-3 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition cursor-pointer"
              >
                Reset Search & Filter
              </button>
            )}
          </div>
        ) : (
          groupedByDivisionAndPool.map((group) => {
            const poolMeta = poolsSummary.find((p) => p.key === group.poolName);
            const isPoolComplete = poolMeta?.isReady ?? false;

            return (
              <section
                key={group.groupKey}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden"
              >
                {/* Pool & Division Group Header */}
                <div
                  className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 ${
                    isPoolComplete
                      ? 'bg-emerald-50/90 border-emerald-200'
                      : 'bg-slate-50/90 border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {isAdmin ? (
                      <button
                        onClick={() => setEditingDivisionCourts(group.division)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-extrabold border cursor-pointer ${getDivisionColorClass(
                          group.division
                        )}`}
                        title="Click to edit courts for this division"
                      >
                        <span className="truncate">{group.division}</span>
                        <Edit3 className="w-2.5 h-2.5 opacity-70 shrink-0" />
                      </button>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-extrabold border ${getDivisionColorClass(
                          group.division
                        )}`}
                      >
                        <span className="truncate">{group.division}</span>
                      </span>
                    )}

                    <span className="font-extrabold text-slate-900 text-sm sm:text-base">
                      {group.poolName}
                    </span>

                    {group.courtsLabel && group.courtsLabel !== '-' && (
                      isAdmin ? (
                        <button
                          onClick={() => setEditingDivisionCourts(group.division)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                          title="Click to edit division court assignment"
                        >
                          <MapPin className="w-2.5 h-2.5 text-emerald-400" />
                          <span>Ct {group.courtsLabel}</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-900 text-white">
                          <MapPin className="w-2.5 h-2.5 text-emerald-400" />
                          <span>Ct {group.courtsLabel}</span>
                        </span>
                      )
                    )}
                  </div>

                  <div className="shrink-0">
                    {isPoolComplete ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-600 text-white">
                        <Sparkles className="w-3 h-3" />
                        <span>Ready ({poolMeta?.checkedIn}/{poolMeta?.total})</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-600 bg-white px-2.5 py-0.5 rounded-full border border-slate-200">
                        {poolMeta?.checkedIn ?? 0}/{poolMeta?.total ?? group.teams.length} Ready
                      </span>
                    )}
                  </div>
                </div>

                {/* Teams List — Clean Mobile Cards */}
                <div className="divide-y divide-slate-100">
                  {group.teams.map((team) => {
                    const status = getTeamStatus(team);
                    const isFull = status === 'checked-in';
                    const isPartial = status === 'partial';

                    return (
                      <div
                        key={team.id}
                        className={`p-3.5 sm:p-4 transition-colors ${
                          isFull
                            ? 'bg-emerald-50/35 hover:bg-emerald-50/55 border-l-4 border-l-emerald-500'
                            : isPartial
                            ? 'bg-amber-50/40 hover:bg-amber-50/60 border-l-4 border-l-amber-400'
                            : 'bg-rose-50/70 hover:bg-rose-100/70 border-l-4 border-l-rose-400'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          {/* Left: Team Name + Pool/Court Badge + 2-Column Partner Buttons */}
                          <div className="flex-1 min-w-0">
                            {/* Top Row of Team Card: Name on left, Pool & Court pill on right */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span
                                  className={`font-extrabold text-sm sm:text-base leading-snug ${
                                    isFull
                                      ? 'text-emerald-950'
                                      : isPartial
                                      ? 'text-amber-950'
                                      : 'text-rose-950'
                                  }`}
                                >
                                  {team.rawTeamName || formatDisplayTeamName(team)}
                                </span>

                                {isFull && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    Checked In ✓
                                  </span>
                                )}

                                {isPartial && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">
                                    1/2 Here
                                  </span>
                                )}

                                {!isFull && !isPartial && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                    Not Checked In
                                  </span>
                                )}

                                {team.notes && (
                                  <span className="text-[11px] font-medium text-amber-900 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                                    {team.notes}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200/80">
                                  <span>{team.poolName}</span>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-emerald-700 font-extrabold">
                                    Ct {team.courts}
                                  </span>
                                </span>

                                {isAdmin && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingTeam(team);
                                    }}
                                    className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                                    title="Edit team"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* 2-Column Partner Tap Grid on Mobile */}
                            <div className="mt-2 grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 sm:gap-2">
                              {team.players.map((player) => (
                                <button
                                  key={player.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlayerCheckIn(team.id, player.id);
                                  }}
                                  className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold border transition active:scale-95 cursor-pointer select-none min-w-0 ${
                                    player.checkedIn
                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                                      : 'bg-white hover:bg-rose-50/70 text-slate-800 border-rose-200/90 shadow-2xs'
                                  }`}
                                >
                                  {player.checkedIn ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-100 shrink-0" />
                                  ) : (
                                    <Circle className="w-3.5 h-3.5 text-rose-400 group-hover:text-rose-600 shrink-0" />
                                  )}
                                  <span className="truncate">{player.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Right / Bottom: Full Team Check-In Button */}
                          <div className="flex items-center justify-end shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFullTeamCheckIn(team.id);
                              }}
                              className={`w-full sm:w-auto min-w-[148px] min-h-[40px] px-3.5 py-2 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer select-none ${
                                isFull
                                  ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 border border-emerald-300'
                                  : isPartial
                                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-2xs'
                                  : 'bg-slate-900 hover:bg-slate-800 text-white shadow-2xs'
                              }`}
                            >
                              {isFull ? (
                                <>
                                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                                  <span>Checked In ✓</span>
                                </>
                              ) : (
                                <>
                                  <UserCheck className="w-4 h-4 text-emerald-400" />
                                  <span>Check In Team</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </main>

      {/* Edit Division Courts Modal (e.g. Select Court 1-7 for Coed Intermediate) */}
      {editingDivisionCourts && (
        <EditDivisionCourtsModal
          division={editingDivisionCourts}
          divisionsList={divisionsList}
          totalTeams={teams.length}
          totalCourtsAvailable={totalCourtsAvailable}
          onClose={() => setEditingDivisionCourts(null)}
          onSwitchDivision={(div) => setEditingDivisionCourts(div)}
          onAutoAssignAll={handleAutoAssignAllCourts}
          onSaveDivisionRange={(div, startCourt, endCourt) => {
            setTeams((prev) => {
              const next = applyCourtRangeToDivision(prev, div, startCourt, endCourt);
              broadcastFullRosterToLive(next, totalCourtsAvailable);
              return next;
            });
            setEditingDivisionCourts(null);
            setUploadSuccessBanner(
              `Assigned Court ${formatCourtRangeLabel(startCourt, endCourt)} to ${div} & synced live`
            );
            setTimeout(() => setUploadSuccessBanner(null), 4000);
          }}
        />
      )}

      {/* Upload Multiple CSVs or Folder Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-900">
                  Load Tournament CSV Files or Folder
                </h2>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mt-2.5">
              Each CSV file's name automatically sets the <strong>Division</strong> (e.g.,{' '}
              <code className="font-mono text-slate-700">Coed Intermediate _Sign-In.csv</code> →{' '}
              <strong>Coed Intermediate</strong>) and assigns courts based on available courts and team counts.
            </p>

            {/* Total Available Courts Setting */}
            <div className="mt-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-800">
                  Total Courts Available for Tournament
                </div>
                <div className="text-[11px] text-slate-500">
                  Courts are proportionally assigned across divisions by team count
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={totalCourtsAvailable}
                  onChange={(e) =>
                    setTotalCourtsAvailable(Math.max(1, parseInt(e.target.value, 10) || 18))
                  }
                  className="w-16 rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm font-bold text-center focus:border-emerald-500 focus:outline-none bg-white"
                />
                <span className="text-xs font-semibold text-slate-600">Courts</span>
              </div>
            </div>

            <label className="mt-2.5 flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoAssignOnUpload}
                onChange={(e) => setAutoAssignOnUpload(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>
                Automatically assign courts (1–{totalCourtsAvailable}) based on team counts per division
              </span>
            </label>

            {/* Merge vs Replace Mode */}
            <div className="mt-3 p-1 bg-slate-100 rounded-xl grid grid-cols-2 gap-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setUploadMode('merge')}
                className={`py-2 px-3 rounded-lg transition cursor-pointer ${
                  uploadMode === 'merge'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Add / Update Divisions (Keep Existing)
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('replace')}
                className={`py-2 px-3 rounded-lg transition cursor-pointer ${
                  uploadMode === 'replace'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Replace Entire Roster
              </button>
            </div>

            {uploadError && (
              <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            <div className="mt-4 space-y-4">
              {/* Two Upload Action Cards: Multiple CSV Files OR Whole Folder */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  onClick={() => multiFileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-5 text-center cursor-pointer bg-slate-50 hover:bg-emerald-50/40 transition flex flex-col items-center justify-center"
                >
                  <Upload className="w-8 h-8 text-emerald-600 mb-2" />
                  <p className="text-sm font-bold text-slate-800">
                    Select One or Multiple .CSV Files
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Choose all 5 division CSV files at once
                  </p>
                </div>

                <div
                  onClick={() => folderInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl p-5 text-center cursor-pointer bg-slate-50 hover:bg-indigo-50/40 transition flex flex-col items-center justify-center"
                >
                  <FolderOpen className="w-8 h-8 text-indigo-600 mb-2" />
                  <p className="text-sm font-bold text-slate-800">Select a Folder of CSVs</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Reads all <code className="font-mono">.csv</code> files inside the selected folder
                  </p>
                </div>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="grow border-t border-slate-200"></div>
                <span className="shrink mx-3 text-xs font-semibold uppercase text-slate-400">
                  Or paste CSV text for a division
                </span>
                <div className="grow border-t border-slate-200"></div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Division Name for Pasted CSV
                  </label>
                  <input
                    type="text"
                    value={pasteDivisionName}
                    onChange={(e) => setPasteDivisionName(e.target.value)}
                    placeholder="e.g., Coed Intermediate, Men's Intermediate"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <textarea
                  rows={4}
                  value={pasteCsvText}
                  onChange={(e) => setPasteCsvText(e.target.value)}
                  placeholder={`Pool Name,Courts,Team Name,Checked In\nPool 1,10,Chris K. / Rudy,\nPool 1,10,Aiden / Michael Canady,`}
                  className="w-full rounded-xl border border-slate-300 p-3 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const defaults = getDefaultTournamentTeams(totalCourtsAvailable);
                      setTeams(defaults);
                      setSelectedDivision(defaults[0]?.division || 'Coed Intermediate');
                      setShowUploadModal(false);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                  >
                    Restore starter divisions
                  </button>

                  <button
                    type="button"
                    disabled={!pasteCsvText.trim()}
                    onClick={handlePasteCsvSubmit}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer"
                  >
                    Load into "{pasteDivisionName || 'General'}"
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save & Manage Tournaments Modal */}
      {showSaveTournamentModal && (
        <SaveTournamentModal
          tournamentName={tournamentName}
          lastSavedAt={lastSavedAt}
          totalTeams={teams.length}
          totalDivisions={divisionsList.length}
          totalCourtsAvailable={totalCourtsAvailable}
          activeSavedTournamentId={activeSavedTournamentId}
          savedTournaments={savedTournaments}
          onClose={() => setShowSaveTournamentModal(false)}
          onSaveCurrent={(name, asNew) => {
            handleSaveTournamentSnapshot(name, asNew);
            setShowSaveTournamentModal(false);
          }}
          onLoadSaved={handleLoadSavedTournament}
          onDeleteSaved={handleDeleteSavedTournament}
          onExportBackup={handleExportTournamentBackupJson}
          onTriggerImportBackup={() => tournamentBackupInputRef.current?.click()}
          onExportSqlite={() => downloadSqliteDatabase('checkin.sqlite')}
        />
      )}

      {/* Admin Access & Login Modal */}
      <AdminAccessModal
        isOpen={showAdminLoginModal}
        isAdmin={isAdmin}
        onClose={() => setShowAdminLoginModal(false)}
        onLogin={handleAdminLogin}
        onLogout={handleAdminLogout}
        onOpenSqlite={() => setShowSqliteModal(true)}
      />

      {/* SQLite Database Manager Modal */}
      <SqliteManagerModal
        isOpen={showSqliteModal}
        onClose={() => setShowSqliteModal(false)}
        totalRows={sqliteRowCount}
        lastSyncedAt={sqliteLastSyncedAt}
        tournamentName={tournamentName}
      />

      {/* Edit Team / Partner Modal */}
      {editingTeam && (
        <EditTeamModal
          team={editingTeam}
          existingDivisions={divisionsList.map((d) => d.division)}
          onClose={() => setEditingTeam(null)}
          onSave={(updated) => {
            setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            setEditingTeam(null);
          }}
          onDelete={(id) => {
            if (window.confirm('Remove this team from the roster?')) {
              setTeams((prev) => prev.filter((t) => t.id !== id));
              setEditingTeam(null);
            }
          }}
        />
      )}
    </div>
  );
}

function SaveTournamentModal({
  tournamentName,
  lastSavedAt,
  totalTeams,
  totalDivisions,
  totalCourtsAvailable,
  activeSavedTournamentId,
  savedTournaments,
  onClose,
  onSaveCurrent,
  onLoadSaved,
  onDeleteSaved,
  onExportBackup,
  onTriggerImportBackup,
  onExportSqlite,
}: {
  tournamentName: string;
  lastSavedAt: string;
  totalTeams: number;
  totalDivisions: number;
  totalCourtsAvailable: number;
  activeSavedTournamentId: string | null;
  savedTournaments: SavedTournament[];
  onClose: () => void;
  onSaveCurrent: (name: string, asNewSlot: boolean) => void;
  onLoadSaved: (saved: SavedTournament) => void;
  onDeleteSaved: (id: string) => void;
  onExportBackup: () => void;
  onTriggerImportBackup: () => void;
  onExportSqlite: () => void;
}) {
  const [nameInput, setNameInput] = useState(tournamentName);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 my-8 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <BookmarkCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-slate-900">
              Save & Manage Tournament
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Auto-Save Status Banner */}
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <div className="text-xs font-bold text-emerald-950">
                Active Tournament is Automatically Saved
              </div>
              <div className="text-[11px] text-emerald-700">
                {totalDivisions} Divisions • {totalTeams} Teams • {totalCourtsAvailable} Courts • Last saved at{' '}
                {new Date(lastSavedAt).toLocaleTimeString()}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onExportSqlite}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 text-xs font-bold transition cursor-pointer"
              title="Download SQLite database (.sqlite file) containing table checkin"
            >
              <Database className="w-3.5 h-3.5 text-sky-600" />
              <span>Export SQLite DB</span>
            </button>

            <button
              type="button"
              onClick={onExportBackup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-bold transition cursor-pointer"
              title="Download a backup .json file of this tournament"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save Backup File</span>
            </button>

            <button
              type="button"
              onClick={onTriggerImportBackup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold transition cursor-pointer"
              title="Restore from a .json tournament backup file"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Load File</span>
            </button>
          </div>
        </div>

        {/* Name & Save Current Tournament */}
        <div className="space-y-2.5">
          <label className="block text-xs font-bold text-slate-700">
            Tournament Name
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g., No Attitude Volleyball - Nov 7"
              className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onSaveCurrent(nameInput, false)}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              <span>Save Tournament</span>
            </button>
            <button
              type="button"
              onClick={() => onSaveCurrent(nameInput, true)}
              className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap"
            >
              Save as Copy
            </button>
          </div>
        </div>

        {/* Saved Tournaments List */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Saved Tournaments ({savedTournaments.length})
          </div>

          {savedTournaments.length === 0 ? (
            <div className="text-xs text-slate-500 py-4 text-center">
              No saved tournament snapshots yet. Click "Save Tournament" above to save one.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {savedTournaments.map((item) => {
                const isCurrent = item.id === activeSavedTournamentId;
                const divCount = new Set(item.teams.map((t) => t.division)).size;
                const checkedCount = item.teams.filter(
                  (t) => getTeamStatus(t) === 'checked-in'
                ).length;

                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                      isCurrent
                        ? 'bg-emerald-50/70 border-emerald-300'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 truncate">
                          {item.name}
                        </span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-600 text-white">
                            Active & Auto-Saving
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {divCount} Divisions • {checkedCount}/{item.teams.length} Teams Checked In •{' '}
                        {item.totalCourtsAvailable} Courts • Saved{' '}
                        {new Date(item.savedAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => onLoadSaved(item)}
                          className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                        >
                          Load
                        </button>
                      )}
                      {savedTournaments.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete saved tournament "${item.name}"?`)) {
                              onDeleteSaved(item.id);
                            }
                          }}
                          className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                          title="Delete saved tournament"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function parseCourtBounds(courtLabel: string): { start: number; end: number } {
  const nums = courtLabel
    .split(/[-,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return { start: 1, end: 7 };
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

function EditDivisionCourtsModal({
  division,
  divisionsList,
  totalTeams,
  totalCourtsAvailable,
  onClose,
  onSwitchDivision,
  onAutoAssignAll,
  onSaveDivisionRange,
}: {
  division: string;
  divisionsList: {
    division: string;
    total: number;
    checkedIn: number;
    partial: number;
    courtLabel: string;
  }[];
  totalTeams: number;
  totalCourtsAvailable: number;
  onClose: () => void;
  onSwitchDivision: (div: string) => void;
  onAutoAssignAll: (courtsCount: number) => void;
  onSaveDivisionRange: (div: string, startCourt: number, endCourt: number) => void;
}) {
  const currentMeta = divisionsList.find((d) => d.division === division) || divisionsList[0];
  const initialBounds = parseCourtBounds(currentMeta?.courtLabel || '1-7');

  const [startCourt, setStartCourt] = useState<number>(initialBounds.start);
  const [endCourt, setEndCourt] = useState<number>(initialBounds.end);
  const [courtsTotalInput, setCourtsTotalInput] = useState<number>(totalCourtsAvailable);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);

  useEffect(() => {
    const meta = divisionsList.find((d) => d.division === division);
    if (meta) {
      const b = parseCourtBounds(meta.courtLabel);
      setStartCourt(b.start);
      setEndCourt(b.end);
      setRangeAnchor(null);
    }
  }, [division, divisionsList]);

  const maxGridCourt = Math.max(courtsTotalInput, endCourt, 18);
  const courtNumbers = Array.from({ length: maxGridCourt }, (_, i) => i + 1);

  const handleCourtGridTap = (num: number) => {
    if (rangeAnchor === null) {
      setRangeAnchor(num);
      setStartCourt(num);
      setEndCourt(num);
    } else {
      const s = Math.min(rangeAnchor, num);
      const e = Math.max(rangeAnchor, num);
      setStartCourt(s);
      setEndCourt(e);
      setRangeAnchor(null);
    }
  };

  const s = Math.min(startCourt, endCourt);
  const e = Math.max(startCourt, endCourt);
  const assignedCount = e - s + 1;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 my-8 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-slate-900">
              Assign Courts by Division
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Auto-Assign All Divisions Based on Total Courts & Team Count */}
        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs font-bold text-slate-800">
                Total Tournament Courts ({totalTeams} Total Teams across {divisionsList.length} Divisions)
              </div>
              <div className="text-[11px] text-slate-500">
                Auto-assigns courts proportionally to each division based on team count
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={99}
                value={courtsTotalInput}
                onChange={(e) =>
                  setCourtsTotalInput(Math.max(1, parseInt(e.target.value, 10) || 18))
                }
                className="w-16 rounded-xl border border-slate-300 px-2.5 py-1.5 text-sm font-bold text-center bg-white"
              />
              <button
                type="button"
                onClick={() => onAutoAssignAll(courtsTotalInput)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
              >
                Auto-Assign All
              </button>
            </div>
          </div>

          {/* Division Selector Pills inside Modal */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {divisionsList.map((d) => {
              const active = d.division === division;
              return (
                <button
                  key={d.division}
                  type="button"
                  onClick={() => onSwitchDivision(d.division)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 ${
                    active
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span>{d.division}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] ${
                      active ? 'bg-emerald-800 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {d.total} teams • Ct {d.courtLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Division Court Range Editor */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Editing Division
              </div>
              <div className="text-base font-extrabold text-slate-900">
                {division} ({currentMeta?.total ?? 0} Teams)
              </div>
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-extrabold text-sm">
              Court {formatCourtRangeLabel(s, e)} ({assignedCount} court{assignedCount !== 1 ? 's' : ''})
            </div>
          </div>

          {/* Start & End Court Selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                From Court #
              </label>
              <input
                type="number"
                min={1}
                max={99}
                value={startCourt}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                  setStartCourt(val);
                  if (val > endCourt) setEndCourt(val);
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                To Court #
              </label>
              <input
                type="number"
                min={1}
                max={99}
                value={endCourt}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                  setEndCourt(val);
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Interactive Court Grid (Tap Start Court then Tap End Court, e.g. 1 then 7) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-600">
                Tap Courts to Select Range (e.g., tap 1 then tap 7 for Court 1–7):
              </span>
              {rangeAnchor !== null && (
                <span className="text-xs font-bold text-emerald-600">
                  Now tap end court (started at Court {rangeAnchor})...
                </span>
              )}
            </div>

            <div className="grid grid-cols-6 gap-2">
              {courtNumbers.map((num) => {
                const inRange = num >= s && num <= e;
                const isEndpoint = num === s || num === e;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleCourtGridTap(num)}
                    className={`py-2.5 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                      isEndpoint
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : inRange
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Ct {num}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSaveDivisionRange(division, s, e)}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 cursor-pointer shadow-xs"
          >
            Assign Court {formatCourtRangeLabel(s, e)} to {division}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTeamModal({
  team,
  existingDivisions,
  onClose,
  onSave,
  onDelete,
}: {
  team: TeamEntry;
  existingDivisions: string[];
  onClose: () => void;
  onSave: (updated: TeamEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [division, setDivision] = useState(team.division);
  const [poolName, setPoolName] = useState(team.poolName);
  const [courts, setCourts] = useState(team.courts);
  const [rawTeamName, setRawTeamName] = useState(team.rawTeamName || formatDisplayTeamName(team));
  const [player1Name, setPlayer1Name] = useState(team.players[0]?.name ?? '');
  const [player2Name, setPlayer2Name] = useState(team.players[1]?.name ?? '');
  const [notes, setNotes] = useState(team.notes ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedPlayers = [...team.players];
    if (updatedPlayers[0]) {
      updatedPlayers[0] = { ...updatedPlayers[0], name: player1Name.trim() || 'Player 1' };
    }
    if (updatedPlayers[1]) {
      updatedPlayers[1] = { ...updatedPlayers[1], name: player2Name.trim() || 'Player 2' };
    } else if (player2Name.trim()) {
      updatedPlayers.push({
        id: `p-2-${Date.now()}`,
        name: player2Name.trim(),
        checkedIn: false,
      });
    }

    onSave({
      ...team,
      division: division.trim() || 'General',
      poolName: poolName.trim() || 'Pool 1',
      courts: courts.trim() || '-',
      rawTeamName: rawTeamName.trim() || `${player1Name.trim()} / ${player2Name.trim()}`,
      players: updatedPlayers,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-3.5"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">Edit Team Details</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Division</label>
          <input
            type="text"
            list="edit-division-options"
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
          />
          <datalist id="edit-division-options">
            {existingDivisions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Team Name (Displayed on Check-In)
          </label>
          <input
            type="text"
            value={rawTeamName}
            onChange={(e) => setRawTeamName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Pool Name</label>
            <input
              type="text"
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Court #</label>
            <input
              type="text"
              value={courts}
              onChange={(e) => setCourts(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Player 1</label>
            <input
              type="text"
              value={player1Name}
              onChange={(e) => setPlayer1Name(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Player 2</label>
            <input
              type="text"
              value={player2Name}
              onChange={(e) => setPlayer2Name(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Check-In Notes (Optional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., Paid cash, running 5m late, subbed partner..."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => onDelete(team.id)}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
          >
            Remove Team
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function AdminAccessModal({
  isOpen,
  isAdmin,
  onClose,
  onLogin,
  onLogout,
  onOpenSqlite,
}: {
  isOpen: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onLogin: (password: string) => boolean;
  onLogout: () => void;
  onOpenSqlite: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const success = onLogin(password);
    if (success) {
      setPassword('');
      setError(null);
      onClose();
    } else {
      setError('Incorrect password. Default organizer password is "admin" or PIN "1234".');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            ) : (
              <Lock className="w-5 h-5 text-amber-600" />
            )}
            <h3 className="text-lg font-bold text-slate-900">
              {isAdmin ? 'Admin Mode (Active)' : 'Admin Login Required'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isAdmin ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-emerald-950 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>You have Admin Permissions</span>
              </div>
              <p>
                You can upload CSVs, assign and edit court numbers, save/restore tournament rosters, and manage the SQLite database.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSqlite();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Database className="w-4 h-4 text-sky-400" />
                <span>Open SQLite Database Inspector</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onLogout();
                  onClose();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Lock className="w-4 h-4 text-rose-500" />
                <span>Lock / Exit Admin Mode</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <span className="font-bold">Organizer Controls Protected:</span> Uploading CSVs, configuring court numbers, and saving tournament rosters require admin authentication.
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Admin Password or PIN
              </label>
              <input
                type="password"
                value={password}
                autoFocus
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Enter password (default: admin)"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
              />
              <div className="text-[11px] text-slate-500 mt-1">
                Tip: Default password is <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono">admin</code> or PIN <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono">1234</code>.
              </div>
            </div>

            {error && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                <Unlock className="w-4 h-4" />
                <span>Unlock Admin</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SqliteManagerModal({
  isOpen,
  onClose,
  totalRows,
  lastSyncedAt,
  tournamentName,
}: {
  isOpen: boolean;
  onClose: () => void;
  totalRows: number;
  lastSyncedAt: string | null;
  tournamentName: string;
}) {
  const [queryText, setQueryText] = useState(
    'SELECT Tournament_Name, team_name, division, total_courts, Total_Pools, pool_name, courts, is_checked_in, checked_in_at FROM checkin ORDER BY division, pool_name;'
  );
  const [queryResult, setQueryResult] = useState<{ columns: string[]; values: any[][] } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRunQuery = async (sql: string) => {
    setIsLoading(true);
    setQueryError(null);
    try {
      const res = await querySqlite(sql);
      if (res.length > 0) {
        setQueryResult(res[0]);
      } else {
        setQueryResult({ columns: [], values: [] });
      }
    } catch (err: any) {
      setQueryError(err?.message || String(err));
      setQueryResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleRunQuery(queryText);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sampleQueries = [
    {
      label: 'All Teams + Courts/Pools',
      sql: 'SELECT Tournament_Name, team_name, division, total_courts, Total_Pools, pool_name, courts, is_checked_in, checked_in_at FROM checkin ORDER BY division, pool_name;',
    },
    {
      label: 'Division Courts & Pools',
      sql: 'SELECT division, total_courts, Total_Pools, COUNT(*) as teams_count, SUM(is_checked_in) as checked_in FROM checkin GROUP BY division;',
    },
    {
      label: 'Checked-In Only',
      sql: 'SELECT Tournament_Name, team_name, division, total_courts, courts, checked_in_at FROM checkin WHERE is_checked_in = 1;',
    },
    {
      label: 'Pending Only',
      sql: 'SELECT Tournament_Name, team_name, division, total_courts, courts, player1_name, player2_name FROM checkin WHERE is_checked_in = 0;',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 my-6 space-y-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <span>SQLite Database</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                  table: checkin
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                {tournamentName} • {totalRows} teams stored • Auto-synced {lastSyncedAt ? `at ${lastSyncedAt}` : 'in real-time'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action bar with Download SQLite binary button */}
        <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 flex items-center justify-between gap-3 flex-wrap shrink-0">
          <div className="text-xs text-sky-950">
            <span className="font-bold">Real SQLite binary:</span> Full schema with player check-in timestamps, court assignments, and status persisted in IndexedDB via WebAssembly.
          </div>
          <button
            type="button"
            onClick={() => downloadSqliteDatabase('checkin.sqlite')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition shadow-xs cursor-pointer"
            title="Download checkin.sqlite file directly"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download checkin.sqlite</span>
          </button>
        </div>

        {/* Quick Query Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 pb-1">
          <span className="text-xs font-bold text-slate-500 shrink-0">Queries:</span>
          {sampleQueries.map((sq) => (
            <button
              key={sq.label}
              type="button"
              onClick={() => {
                setQueryText(sq.sql);
                handleRunQuery(sq.sql);
              }}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 whitespace-nowrap transition cursor-pointer"
            >
              {sq.label}
            </button>
          ))}
        </div>

        {/* SQL Query Box */}
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Enter SQL (e.g. SELECT * FROM checkin;)"
            className="flex-1 font-mono text-xs rounded-xl border border-slate-300 px-3.5 py-2 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => handleRunQuery(queryText)}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer shrink-0"
          >
            {isLoading ? 'Running...' : 'Run SQL'}
          </button>
        </div>

        {/* Query Results / Table */}
        <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 min-h-[220px]">
          {queryError ? (
            <div className="p-4 text-xs font-mono text-rose-600 bg-rose-50">
              Error executing SQL: {queryError}
            </div>
          ) : !queryResult || queryResult.values.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No rows returned.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-200 text-slate-800 font-bold sticky top-0">
                  {queryResult.columns.map((col, idx) => (
                    <th key={idx} className="p-2 border-b border-slate-300 font-mono">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {queryResult.values.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-slate-50">
                    {row.map((val, colIdx) => (
                      <td key={colIdx} className="p-2 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {val === null || val === undefined ? (
                          <span className="text-slate-300 italic">null</span>
                        ) : (
                          String(val)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
