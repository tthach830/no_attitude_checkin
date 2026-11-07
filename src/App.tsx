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
  Clock,
  MapPin,
  AlertCircle,
  Smartphone,
  ArrowRight,
  FolderOpen,
  Layers,
  Trash2,
  Sliders,
} from 'lucide-react';
import type { TeamEntry, FilterStatus } from './types';
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

const STORAGE_KEY = 'no_attitude_checkin_teams_v4';
const STORAGE_COURTS_KEY = 'no_attitude_checkin_total_courts_v1';

const DIVISION_BADGE_COLORS = [
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-orange-100 text-orange-800 border-orange-200',
];

export function App() {
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

  // Track the team currently checking in so it is prominently displayed
  const [activeTeamId, setActiveTeamId] = useState<string | null>(() => teams[0]?.id ?? null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>(
    () => teams[0]?.division || 'Coed Intermediate'
  );
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'merge' | 'replace'>('merge');
  const [autoAssignOnUpload, setAutoAssignOnUpload] = useState(true);
  const [pasteDivisionName, setPasteDivisionName] = useState('Coed Intermediate');
  const [pasteCsvText, setPasteCsvText] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessBanner, setUploadSuccessBanner] = useState<string | null>(null);

  const [editingTeam, setEditingTeam] = useState<TeamEntry | null>(null);
  const [editingDivisionCourts, setEditingDivisionCourts] = useState<string | null>(null);
  const [showIphoneModal, setShowIphoneModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    teamName: string;
    division: string;
    poolName: string;
    courts: string;
    statusText: string;
  } | null>(null);

  const multiFileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
    } catch {
      // ignore storage errors
    }
  }, [teams]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_COURTS_KEY, String(totalCourtsAvailable));
    } catch {
      // ignore
    }
  }, [totalCourtsAvailable]);

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

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) || null,
    [teams, activeTeamId]
  );

  const triggerCheckInBanner = (team: TeamEntry, statusText: string) => {
    setActiveTeamId(team.id);
    setToastMessage({
      teamName: team.rawTeamName || formatDisplayTeamName(team),
      division: team.division,
      poolName: team.poolName,
      courts: team.courts,
      statusText,
    });
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
          targetChecked ? 'Team Checked In!' : 'Check-In Cleared'
        );

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
            ? `Full Team Checked In (${toggledPlayerName} arrived)`
            : toggledPlayerChecked
            ? `${toggledPlayerName} Checked In (1/2 Here)`
            : `${toggledPlayerName} Unchecked`
        );

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

      if (autoAssignOnUpload) {
        return autoAssignCourtsByTeamCount(combined, totalCourtsAvailable).teams;
      }
      return combined;
    });

    const firstDiv = Array.from(uploadedDivisions)[0] || 'Coed Intermediate';
    const divNames = Array.from(uploadedDivisions).join(', ');
    setSelectedDivision(firstDiv);
    setActiveTeamId(newlyLoadedTeams[0]?.id ?? null);
    setUploadError(null);
    setShowUploadModal(false);
    setUploadSuccessBanner(
      `Loaded ${newlyLoadedTeams.length} teams across ${uploadedDivisions.size} division${
        uploadedDivisions.size > 1 ? 's' : ''
      } (${divNames}) and assigned ${totalCourtsAvailable} courts.`
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
    setActiveTeamId(result.teams[0]?.id ?? null);
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
    setTeams((prev) => autoAssignCourtsByTeamCount(prev, courtsCount).teams);
    setUploadSuccessBanner(
      `Auto-assigned Courts 1–${courtsCount} across ${divisionsList.length} divisions based on team counts.`
    );
    setTimeout(() => setUploadSuccessBanner(null), 4000);
  };

  // Teams scoped to the currently selected Division
  const divisionScopedTeams = useMemo(() => {
    return teams.filter((t) => t.division === selectedDivision);
  }, [teams, selectedDivision]);

  const currentDivisionMeta = useMemo(
    () => divisionsList.find((d) => d.division === selectedDivision) || divisionsList[0],
    [divisionsList, selectedDivision]
  );

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

  // Filtered teams
  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return divisionScopedTeams.filter((team) => {
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
  }, [divisionScopedTeams, statusFilter, searchQuery]);

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

      {/* Header */}
      <header className="bg-slate-900 text-white pt-safe sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-4 pt-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                    Tournament Check-In
                  </h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <Layers className="w-3 h-3" />
                    {divisionsList.length} Divisions • {teams.length} Teams • {totalCourtsAvailable} Courts
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Click any Division tab to view teams or edit its assigned courts (e.g. Court 1–7)
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setEditingDivisionCourts(selectedDivision)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs sm:text-sm font-medium text-slate-100 border border-slate-700 transition cursor-pointer"
                title="Configure courts per division"
              >
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>Assign Courts ({totalCourtsAvailable})</span>
              </button>

              <button
                onClick={() => setShowIphoneModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs sm:text-sm font-medium text-slate-100 border border-slate-700 transition cursor-pointer"
                title="Open on iPhone"
              >
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span className="hidden md:inline">iPhone</span>
              </button>

              <button
                onClick={() => {
                  setUploadError(null);
                  setShowUploadModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-xs sm:text-sm font-semibold text-slate-950 transition shadow-sm cursor-pointer"
                title="Upload multiple CSV files or select a folder"
              >
                <Upload className="w-4 h-4" />
                <span>Upload CSVs / Folder</span>
              </button>
            </div>
          </div>

          {/* Division Tabs Strip — Click a Division to switch, or click its Court badge / selected tab to edit courts */}
          <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {divisionsList.map((div) => {
              const isSelected = selectedDivision === div.division;
              const isAllReady = div.total > 0 && div.checkedIn === div.total;
              return (
                <div
                  key={div.division}
                  className={`inline-flex items-center rounded-xl border transition ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                      : isAllReady
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700 hover:bg-emerald-900/70'
                      : 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (isSelected) {
                        setEditingDivisionCourts(div.division);
                      } else {
                        setSelectedDivision(div.division);
                        const firstInDiv = teams.find((t) => t.division === div.division);
                        if (firstInDiv) setActiveTeamId(firstInDiv.id);
                      }
                    }}
                    className="px-3.5 py-2 text-xs sm:text-sm font-bold whitespace-nowrap flex items-center gap-2 cursor-pointer"
                    title={
                      isSelected
                        ? `Click to edit courts for ${div.division}`
                        : `Switch to ${div.division}`
                    }
                  >
                    <span>{div.division}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                        isSelected
                          ? 'bg-slate-950/20 text-slate-950'
                          : isAllReady
                          ? 'bg-emerald-500/30 text-emerald-200'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {div.checkedIn}/{div.total} {isAllReady ? '✓' : ''}
                    </span>
                  </button>

                  {/* Clickable Court Assignment Pill on Each Division Tab */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDivision(div.division);
                      setEditingDivisionCourts(div.division);
                    }}
                    className={`mr-2 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                      isSelected
                        ? 'bg-slate-950 text-emerald-400 hover:bg-slate-800'
                        : 'bg-slate-950/60 text-emerald-300 hover:bg-slate-950'
                    }`}
                    title={`Edit assigned courts for ${div.division}`}
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Court {div.courtLabel}</span>
                    <Edit3 className="w-3 h-3 opacity-80" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Live Progress Bar & Division Court Assignment Banner */}
          <div className="mt-2.5 bg-slate-800/90 rounded-2xl p-2.5 px-3 border border-slate-700/80">
            <div className="flex items-center justify-between text-xs sm:text-sm mb-1.5 flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                  {selectedDivision}: {stats.fullTeams} / {stats.totalTeams} Teams Checked In (
                  {stats.progressPct}%)
                </span>

                {currentDivisionMeta && (
                  <button
                    onClick={() => setEditingDivisionCourts(selectedDivision)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Assigned: Court {currentDivisionMeta.courtLabel}</span>
                    <Edit3 className="w-3 h-3" />
                  </button>
                )}

                {stats.partialTeams > 0 && (
                  <span className="text-amber-300 font-medium flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {stats.partialTeams} Partial (1/2 here)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {divisionsList.length > 1 && (
                  <button
                    onClick={() => handleRemoveDivision(selectedDivision)}
                    className="text-xs text-slate-400 hover:text-rose-300 flex items-center gap-1 transition cursor-pointer"
                    title={`Remove ${selectedDivision} division`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Remove Division</span>
                  </button>
                )}

                {(stats.fullTeams > 0 || stats.partialTeams > 0) && (
                  <button
                    onClick={handleClearCheckIns}
                    className="text-xs text-slate-400 hover:text-rose-300 flex items-center gap-1 transition cursor-pointer"
                    title="Clear check-ins"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Reset</span>
                  </button>
                )}
              </div>
            </div>

            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden flex">
              <div
                className="bg-emerald-500 transition-all duration-300"
                style={{
                  width: `${stats.totalTeams ? (stats.fullTeams / stats.totalTeams) * 100 : 0}%`,
                }}
              />
              <div
                className="bg-amber-400 transition-all duration-300"
                style={{
                  width: `${stats.totalTeams ? (stats.partialTeams / stats.totalTeams) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Sticky Search & Filter Subbar */}
        <div className="bg-white border-b border-slate-200 text-slate-900 px-4 py-2.5 shadow-xs">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search player, team name, pool, or court..."
                className="w-full pl-9 pr-9 py-2 bg-slate-100 hover:bg-slate-200/70 focus:bg-white rounded-xl text-sm border border-transparent focus:border-emerald-500 focus:outline-none transition"
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

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 sm:pb-0">
              {(
                [
                  { id: 'all', label: `All (${stats.totalTeams})` },
                  { id: 'pending', label: `Not Checked In (${stats.pendingTeams})` },
                  { id: 'partial', label: `1/2 Here (${stats.partialTeams})` },
                  { id: 'checked-in', label: `Checked In (${stats.fullTeams})` },
                ] as { id: FilterStatus; label: string }[]
              ).map((tab) => {
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl w-full mx-auto px-4 py-5 flex-1 space-y-5">
        {uploadSuccessBanner && (
          <div className="bg-emerald-900 text-white px-4 py-3 rounded-2xl shadow-md flex items-center justify-between text-sm font-medium">
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

        {/* NOW CHECKING IN — Prominent Team Name & Division Spotlight Card */}
        {activeTeam && (
          <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-lg border-2 border-emerald-500/80 transition-all">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500 text-slate-950">
                    <UserCheck className="w-3.5 h-3.5" />
                    Now Checking In
                  </span>
                  <button
                    onClick={() => setEditingDivisionCourts(activeTeam.division)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-200 border border-indigo-400/40 cursor-pointer"
                  >
                    <span>
                      {activeTeam.division} (Courts{' '}
                      {activeTeam.divisionCourts || currentDivisionMeta?.courtLabel || activeTeam.courts})
                    </span>
                    <Edit3 className="w-3 h-3" />
                  </button>
                  {toastMessage && (
                    <span className="text-xs font-medium text-emerald-300">
                      {toastMessage.statusText}
                    </span>
                  )}
                </div>

                {/* Big CSV Team Name */}
                <div className="mt-2">
                  <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    Team Name
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mt-0.5">
                    {activeTeam.rawTeamName || formatDisplayTeamName(activeTeam)}
                  </h2>
                </div>

                {/* Assigned Division, Pool & Court Direction */}
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-white">
                    <span className="text-indigo-300">{activeTeam.division}</span>
                    <span className="text-slate-500">•</span>
                    <span>{activeTeam.poolName}</span>
                    <ArrowRight className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">Court {activeTeam.courts}</span>
                  </div>

                  {activeTeam.players.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => togglePlayerCheckIn(activeTeam.id, p.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        p.checkedIn
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {p.checkedIn ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                <button
                  onClick={() => toggleFullTeamCheckIn(activeTeam.id)}
                  className={`px-5 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 transition cursor-pointer ${
                    getTeamStatus(activeTeam) === 'checked-in'
                      ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                      : 'bg-white text-slate-950 hover:bg-slate-100'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {getTeamStatus(activeTeam) === 'checked-in'
                      ? 'Checked In ✓'
                      : 'Mark Full Team Checked In'}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTeamId(null)}
                  className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                >
                  Hide spotlight
                </button>
              </div>
            </div>
          </div>
        )}

        {groupedByDivisionAndPool.length === 0 ? (
          <div className="bg-white rounded-3xl p-10 text-center border border-slate-200 shadow-xs my-6">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-800">No Matching Teams</h3>
            <p className="text-sm text-slate-500 mt-1">
              Try clearing your search filter or switching the status tab above.
            </p>
            {(searchQuery || statusFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
                className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition cursor-pointer"
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
                  className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
                    isPoolComplete
                      ? 'bg-emerald-50/90 border-emerald-200'
                      : 'bg-slate-50/80 border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                      onClick={() => setEditingDivisionCourts(group.division)}
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-extrabold border cursor-pointer ${getDivisionColorClass(
                        group.division
                      )}`}
                      title="Click to edit courts for this division"
                    >
                      <span>{group.division}</span>
                      <Edit3 className="w-3 h-3 opacity-70" />
                    </button>

                    <span className="font-bold text-slate-900 text-base">{group.poolName}</span>

                    {group.courtsLabel && group.courtsLabel !== '-' && (
                      <button
                        onClick={() => setEditingDivisionCourts(group.division)}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                        title="Click to edit division court assignment"
                      >
                        <MapPin className="w-3 h-3 text-emerald-400" />
                        <span>Court {group.courtsLabel}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isPoolComplete ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shadow-2xs">
                        <Sparkles className="w-3.5 h-3.5" />
                        Court Ready ({poolMeta?.checkedIn}/{poolMeta?.total})
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-600 bg-white px-2.5 py-1 rounded-full border border-slate-200">
                        {poolMeta?.checkedIn ?? 0} of {poolMeta?.total ?? group.teams.length} Teams Ready
                      </span>
                    )}
                  </div>
                </div>

                {/* Teams List */}
                <div className="divide-y divide-slate-100">
                  {group.teams.map((team) => {
                    const status = getTeamStatus(team);
                    const isFull = status === 'checked-in';
                    const isPartial = status === 'partial';
                    const isCurrentlyCheckingIn = activeTeamId === team.id;

                    return (
                      <div
                        key={team.id}
                        onClick={() => setActiveTeamId(team.id)}
                        className={`p-4 transition-colors cursor-pointer ${
                          isCurrentlyCheckingIn
                            ? 'ring-2 ring-inset ring-emerald-500 bg-emerald-50/60'
                            : isFull
                            ? 'bg-emerald-50/35'
                            : isPartial
                            ? 'bg-amber-50/35'
                            : 'bg-white hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                          {/* Left: Division, Team Name from CSV & Individual Player Tap Chips */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded border ${getDivisionColorClass(
                                  team.division
                                )}`}
                              >
                                {team.division}
                              </span>

                              <span
                                className={`font-extrabold text-base sm:text-lg leading-snug ${
                                  isFull ? 'text-emerald-950' : 'text-slate-900'
                                }`}
                              >
                                {team.rawTeamName || formatDisplayTeamName(team)}
                              </span>

                              {isCurrentlyCheckingIn && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-900 text-emerald-400">
                                  Checking In Now
                                </span>
                              )}

                              {isFull && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                  Checked In ✓
                                  {team.checkedInAt &&
                                    ` • ${new Date(team.checkedInAt).toLocaleTimeString([], {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })}`}
                                </span>
                              )}

                              {isPartial && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800">
                                  1/2 Arrived • Waiting on Partner
                                </span>
                              )}

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTeam(team);
                                }}
                                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                                title="Edit division, player names, court, or notes"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 font-medium flex-wrap">
                              <span>{team.division}</span>
                              <span>•</span>
                              <span>{team.poolName}</span>
                              <span>•</span>
                              <span className="font-semibold text-slate-700">
                                Court {team.courts}
                              </span>
                              {team.divisionCourts && team.divisionCourts !== team.courts && (
                                <span className="text-slate-400">
                                  (Div Courts {team.divisionCourts})
                                </span>
                              )}
                              {team.notes && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                    Note: {team.notes}
                                  </span>
                                </>
                              )}
                            </div>

                            {/* Individual Partner Check-In Chips */}
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              {team.players.map((player) => (
                                <button
                                  key={player.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePlayerCheckIn(team.id, player.id);
                                  }}
                                  className={`group inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium border transition active:scale-95 cursor-pointer select-none ${
                                    player.checkedIn
                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                                      : 'bg-slate-100/90 hover:bg-slate-200/80 text-slate-800 border-slate-200'
                                  }`}
                                >
                                  {player.checkedIn ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-100 shrink-0" />
                                  ) : (
                                    <Circle className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0" />
                                  )}
                                  <span className="truncate max-w-[200px]">{player.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Right: 1-Tap Full Team Check-In Button */}
                          <div className="flex items-center justify-end shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFullTeamCheckIn(team.id);
                              }}
                              className={`w-full sm:w-auto min-w-[165px] min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer select-none ${
                                isFull
                                  ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 border border-emerald-300'
                                  : isPartial
                                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-xs'
                                  : 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs'
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
            setTeams((prev) => applyCourtRangeToDivision(prev, div, startCourt, endCourt));
            setEditingDivisionCourts(null);
            setUploadSuccessBanner(
              `Assigned Court ${formatCourtRangeLabel(startCourt, endCourt)} to ${div}`
            );
            setTimeout(() => setUploadSuccessBanner(null), 4000);
          }}
        />
      )}

      {/* Send to iPhone Modal */}
      {showIphoneModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-center">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-900">Open on Your iPhone</h2>
              </div>
              <button
                onClick={() => setShowIphoneModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-left text-sm text-slate-600">
              <p>
                <strong>Option 1 (GitHub Pages Live URL):</strong>
              </p>
              <div className="p-3 rounded-xl bg-slate-900 text-emerald-400 font-mono font-bold text-center text-xs sm:text-sm select-all">
                https://runwildlovestronglivefree.org/no_attitude_checkin/
              </div>
              <p>
                <strong>Option 2 (Local Wi-Fi):</strong>
              </p>
              <div className="p-3 rounded-xl bg-slate-100 text-slate-800 font-mono font-bold text-center text-sm select-all">
                http://192.168.0.53:5173/
              </div>
            </div>

            <button
              onClick={() => setShowIphoneModal(false)}
              className="mt-5 w-full py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
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
                      setActiveTeamId(defaults[0]?.id ?? null);
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
