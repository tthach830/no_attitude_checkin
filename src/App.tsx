import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Circle,
  Search,
  Upload,
  Download,
  UserCheck,
  Users,
  Edit3,
  RotateCcw,
  X,
  FileSpreadsheet,
  Share2,
  Sparkles,
  Clock,
  MapPin,
  AlertCircle,
  Smartphone,
  ArrowRight,
  FolderOpen,
  Layers,
  Trash2,
} from 'lucide-react';
import type { TeamEntry, FilterStatus } from './types';
import {
  getDefaultTournamentTeams,
  parseTournamentCsv,
  exportTournamentCsv,
  extractDivisionFromFilename,
  getTeamStatus,
  formatDisplayTeamName,
  parseTeamPlayers,
} from './utils/csv';

const STORAGE_KEY = 'no_attitude_checkin_teams_v3';

const DIVISION_BADGE_COLORS = [
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-orange-100 text-orange-800 border-orange-200',
];

export function App() {
  const [teams, setTeams] = useState<TeamEntry[]>(() => {
    try {
      localStorage.removeItem('no_attitude_checkin_teams_v1');
      localStorage.removeItem('no_attitude_checkin_teams_v2');
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
    return getDefaultTournamentTeams();
  });

  // Track the team currently checking in so it is prominently displayed
  const [activeTeamId, setActiveTeamId] = useState<string | null>(() => teams[0]?.id ?? null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>(
    () => teams[0]?.division || 'Coed-Intermediate'
  );
  const [selectedPool, setSelectedPool] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState<'merge' | 'replace'>('merge');
  const [pasteDivisionName, setPasteDivisionName] = useState('Coed-Intermediate');
  const [pasteCsvText, setPasteCsvText] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessBanner, setUploadSuccessBanner] = useState<string | null>(null);

  const [editingTeam, setEditingTeam] = useState<TeamEntry | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
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

  const divisionsList = useMemo(() => {
    const map = new Map<
      string,
      { division: string; total: number; checkedIn: number; partial: number }
    >();
    teams.forEach((t) => {
      const div = t.division || 'General';
      const item = map.get(div) || { division: div, total: 0, checkedIn: 0, partial: 0 };
      item.total++;
      const st = getTeamStatus(t);
      if (st === 'checked-in') item.checkedIn++;
      else if (st === 'partial') item.partial++;
      map.set(div, item);
    });
    return Array.from(map.values());
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
      setUploadError('No .csv files found in your selection. Please select CSV files or a folder containing CSV files.');
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
      setUploadError(errors.join(' | ') || 'Could not parse any valid teams from the selected CSV files.');
      setShowUploadModal(true);
      return;
    }

    const newlyLoadedTeams = loadedTeamsByDiv.flatMap((d) => d.teams);
    const uploadedDivisions = new Set(loadedTeamsByDiv.map((d) => d.division));

    setTeams((prev) => {
      if (mode === 'replace') {
        return newlyLoadedTeams;
      }
      // Merge mode: replace divisions with the same name, keep other existing divisions
      const kept = prev.filter((t) => !uploadedDivisions.has(t.division));
      return [...kept, ...newlyLoadedTeams];
    });

    const divNames = Array.from(uploadedDivisions).join(', ');
    setSelectedDivision(Array.from(uploadedDivisions)[0] || 'Coed-Intermediate');
    setSelectedPool('ALL');
    setActiveTeamId(newlyLoadedTeams[0]?.id ?? null);
    setUploadError(null);
    setShowUploadModal(false);
    setUploadSuccessBanner(
      `Loaded ${newlyLoadedTeams.length} teams across ${uploadedDivisions.size} division${
        uploadedDivisions.size > 1 ? 's' : ''
      }: ${divNames}`
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

    // Fallback to standard dataTransfer.files
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
      if (uploadMode === 'replace') return result.teams;
      const kept = prev.filter((t) => t.division !== divName);
      return [...kept, ...result.teams];
    });
    setSelectedDivision(divName);
    setSelectedPool('ALL');
    setActiveTeamId(result.teams[0]?.id ?? null);
    setUploadError(null);
    setPasteCsvText('');
    setShowUploadModal(false);
    setUploadSuccessBanner(`Loaded ${result.teams.length} teams into division "${divName}"`);
    setTimeout(() => setUploadSuccessBanner(null), 5000);
  };

  const handleRemoveDivision = (divisionToRemove: string) => {
    if (!window.confirm(`Remove the entire "${divisionToRemove}" division from the roster?`)) return;
    setTeams((prev) => prev.filter((t) => t.division !== divisionToRemove));
    if (selectedDivision === divisionToRemove) {
      setSelectedDivision('ALL');
    }
  };

  const handleClearCheckIns = () => {
    const scopeLabel =
      selectedDivision === 'ALL' ? 'all divisions' : `division "${selectedDivision}"`;
    if (!window.confirm(`Clear all check-in marks for ${scopeLabel}?`)) return;
    setTeams((prev) =>
      prev.map((t) => {
        if (selectedDivision !== 'ALL' && t.division !== selectedDivision) return t;
        return {
          ...t,
          checkedInAt: undefined,
          players: t.players.map((p) => ({ ...p, checkedIn: false, checkedInAt: undefined })),
        };
      })
    );
    setToastMessage(null);
  };

  // Teams scoped to the currently selected Division
  const divisionScopedTeams = useMemo(() => {
    if (selectedDivision === 'ALL') return teams;
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
      const key =
        selectedDivision === 'ALL' ? `${team.division}:::${team.poolName}` : team.poolName;
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
  }, [divisionScopedTeams, selectedDivision]);

  // Filtered teams
  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return divisionScopedTeams.filter((team) => {
      const poolKey =
        selectedDivision === 'ALL' ? `${team.division}:::${team.poolName}` : team.poolName;
      if (selectedPool !== 'ALL' && poolKey !== selectedPool) return false;

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
  }, [divisionScopedTeams, selectedDivision, selectedPool, statusFilter, searchQuery]);

  // Group by Division + Pool so Pool 1 of "Men" and Pool 1 of "Coed-Intermediate" are distinct sections
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

  // Export helpers
  const triggerCsvDownload = (
    targetTeams: TeamEntry[],
    fileNameBase: string,
    options: { detailed?: boolean; includeDivisionColumn?: boolean }
  ) => {
    const csvContent = exportTournamentCsv(targetTeams, options);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileNameBase}-checked-in.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  };

  const handleShareOrCopyCsv = async () => {
    const csvContent = exportTournamentCsv(teams, {
      detailed: false,
      includeDivisionColumn: divisionsList.length > 1,
    });
    const fileName = `Tournament-All-Divisions-checked-in.csv`;

    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([csvContent], fileName, { type: 'text/csv' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Tournament Check-In CSV',
            text: `Checked in ${stats.fullTeams}/${stats.totalTeams} teams.`,
            files: [file],
          });
          setShowExportModal(false);
          return;
        }
      } catch {
        // Fallback to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(csvContent);
      setShowExportModal(false);
      setUploadSuccessBanner('Copied updated CSV to clipboard!');
      setTimeout(() => setUploadSuccessBanner(null), 3000);
    } catch {
      triggerCsvDownload(teams, 'Tournament-All-Divisions', {
        detailed: false,
        includeDivisionColumn: true,
      });
    }
  };

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
              Each CSV filename automatically becomes a Division (e.g.,{' '}
              <code className="font-mono text-emerald-700">Men.csv</code>,{' '}
              <code className="font-mono text-emerald-700">Coed-Intermediate.csv</code>)
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
                    {divisionsList.length} Division{divisionsList.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Upload multiple CSVs or a folder — Division is set from each CSV filename
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
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

          {/* Division Tabs Strip */}
          <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {divisionsList.map((div) => {
              const isSelected = selectedDivision === div.division;
              const isAllReady = div.total > 0 && div.checkedIn === div.total;
              return (
                <div key={div.division} className="inline-flex items-center">
                  <button
                    onClick={() => {
                      setSelectedDivision(div.division);
                      setSelectedPool('ALL');
                    }}
                    className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition flex items-center gap-2 cursor-pointer border ${
                      isSelected
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                        : isAllReady
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700 hover:bg-emerald-900/70'
                        : 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-800'
                    }`}
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
                </div>
              );
            })}
          </div>

          {/* Live Progress Bar & Metrics */}
          <div className="mt-2.5 bg-slate-800/90 rounded-2xl p-2.5 px-3 border border-slate-700/80">
            <div className="flex items-center justify-between text-xs sm:text-sm mb-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                  {selectedDivision === 'ALL' ? 'All Divisions' : selectedDivision}:{' '}
                  {stats.fullTeams} / {stats.totalTeams} Teams Checked In ({stats.progressPct}%)
                </span>
                {stats.partialTeams > 0 && (
                  <span className="text-amber-300 font-medium flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {stats.partialTeams} Partial (1/2 here)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {selectedDivision !== 'ALL' && divisionsList.length > 1 && (
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
                placeholder="Search player, team name, division (e.g. Men, Coed), pool, or court..."
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
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/40">
                    Division: {activeTeam.division}
                  </span>
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
              Try clearing your search filter or switching the division/status tab above.
            </p>
            {(searchQuery ||
              statusFilter !== 'all' ||
              selectedPool !== 'ALL' ||
              selectedDivision !== 'ALL') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setSelectedPool('ALL');
                  setSelectedDivision('ALL');
                }}
                className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition cursor-pointer"
              >
                Reset All Filters
              </button>
            )}
          </div>
        ) : (
          groupedByDivisionAndPool.map((group) => {
            const poolKey =
              selectedDivision === 'ALL'
                ? `${group.division}:::${group.poolName}`
                : group.poolName;
            const poolMeta = poolsSummary.find((p) => p.key === poolKey);
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
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-extrabold border ${getDivisionColorClass(
                        group.division
                      )}`}
                    >
                      {group.division}
                    </span>

                    <span className="font-bold text-slate-900 text-base">{group.poolName}</span>

                    {group.courtsLabel && group.courtsLabel !== '-' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-900 text-white">
                        <MapPin className="w-3 h-3 text-emerald-400" />
                        Court {group.courtsLabel}
                      </span>
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

                            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 font-medium">
                              <span>{team.division}</span>
                              <span>•</span>
                              <span>{team.poolName}</span>
                              <span>•</span>
                              <span>Court {team.courts}</span>
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
                <strong>Step 1:</strong> Connect your iPhone to the same Wi-Fi network as this Mac.
              </p>
              <p>
                <strong>Step 2:</strong> Open <strong>Safari</strong> on your iPhone and enter this address:
              </p>
              <div className="p-3 rounded-xl bg-slate-900 text-emerald-400 font-mono font-bold text-center text-base select-all">
                http://192.168.0.53:5173/
              </div>
              <p>
                <strong>Step 3 (Install as App):</strong> Tap the <strong>Share</strong> icon in Safari and select <strong>Add to Home Screen</strong>.
              </p>
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
              Each CSV file's name automatically sets the <strong>Division</strong> (for example,{' '}
              <code className="font-mono text-slate-700">Men.csv</code> → <strong>Men</strong>,{' '}
              <code className="font-mono text-slate-700">Coed-Intermediate.csv</code> →{' '}
              <strong>Coed-Intermediate</strong>).
            </p>

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
                    Choose <code className="font-mono">Men.csv</code>,{' '}
                    <code className="font-mono">Coed-Intermediate.csv</code>, etc.
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
                    placeholder="e.g., Men, Coed-Intermediate, Women-Open"
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
                      const defaults = getDefaultTournamentTeams();
                      setTeams(defaults);
                      setSelectedDivision('ALL');
                      setSelectedPool('ALL');
                      setActiveTeamId(defaults[0]?.id ?? null);
                      setShowUploadModal(false);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                  >
                    Restore starter divisions (Coed-Intermediate & Men)
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

      {/* Add Walk-In Team Modal */}
      {showAddModal && (
        <AddTeamModal
          defaultDivision={
            selectedDivision !== 'ALL'
              ? selectedDivision
              : divisionsList[0]?.division || 'Coed-Intermediate'
          }
          existingDivisions={divisionsList.map((d) => d.division)}
          existingPools={poolsSummary.map((p) => ({
            poolName: p.poolName,
            courts: p.courtsLabel,
          }))}
          onClose={() => setShowAddModal(false)}
          onAdd={(newTeam) => {
            setTeams((prev) => [...prev, newTeam]);
            setActiveTeamId(newTeam.id);
            setShowAddModal(false);
          }}
        />
      )}

      {/* Export / Share CSV Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-900">Export Check-In CSV</h2>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Export Per Division (4-column format matching original CSVs) */}
            <div className="mt-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Export By Division (Pool Name, Courts, Team Name, Checked In)
              </div>
              <div className="space-y-2">
                {divisionsList.map((div) => (
                  <button
                    key={div.division}
                    onClick={() =>
                      triggerCsvDownload(
                        teams.filter((t) => t.division === div.division),
                        div.division,
                        { detailed: false, includeDivisionColumn: false }
                      )
                    }
                    className="w-full p-3 rounded-2xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 flex items-center justify-between text-left transition cursor-pointer"
                  >
                    <div>
                      <div className="font-bold text-sm text-slate-900">{div.division}.csv</div>
                      <div className="text-xs text-slate-500">
                        {div.checkedIn} / {div.total} teams checked in
                      </div>
                    </div>
                    <Download className="w-4 h-4 text-emerald-600 shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            {/* Combined Exports */}
            <div className="mt-5 pt-4 border-t border-slate-100 space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                Export All Divisions Combined
              </div>

              <button
                onClick={() =>
                  triggerCsvDownload(teams, 'Tournament-All-Divisions', {
                    detailed: false,
                    includeDivisionColumn: true,
                  })
                }
                className="w-full p-3 rounded-2xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 flex items-center justify-between text-left transition cursor-pointer"
              >
                <div>
                  <div className="font-bold text-sm text-slate-900">
                    All Divisions Combined CSV
                  </div>
                  <div className="text-xs text-slate-500">
                    Columns: Division, Pool Name, Courts, Team Name, Checked In
                  </div>
                </div>
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              </button>

              <button
                onClick={handleShareOrCopyCsv}
                className="w-full p-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-between text-left transition cursor-pointer"
              >
                <div>
                  <div className="font-bold text-sm">
                    Share / Copy All CSV (iOS AirDrop, Notes, Mail)
                  </div>
                  <div className="text-xs text-slate-300">
                    Opens native iOS Share Sheet or copies CSV text to clipboard
                  </div>
                </div>
                <Share2 className="w-4 h-4 text-emerald-400 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}
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

function AddTeamModal({
  defaultDivision,
  existingDivisions,
  existingPools,
  onClose,
  onAdd,
}: {
  defaultDivision: string;
  existingDivisions: string[];
  existingPools: { poolName: string; courts: string }[];
  onClose: () => void;
  onAdd: (team: TeamEntry) => void;
}) {
  const [division, setDivision] = useState(defaultDivision);
  const [poolName, setPoolName] = useState(existingPools[0]?.poolName || 'Pool 1');
  const [courts, setCourts] = useState(existingPools[0]?.courts || '1');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [checkInNow, setCheckInNow] = useState(true);

  const handlePoolChange = (val: string) => {
    setPoolName(val);
    const match = existingPools.find((p) => p.poolName === val);
    if (match && match.courts) setCourts(match.courts);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!player1.trim()) return;
    const rawTeamName = player2.trim()
      ? `${player1.trim()} / ${player2.trim()}`
      : player1.trim();

    const players = parseTeamPlayers(rawTeamName, checkInNow);
    onAdd({
      id: `team-walkin-${Date.now()}`,
      division: division.trim() || 'General',
      poolName: poolName.trim() || 'Pool 1',
      courts: courts.trim() || '-',
      rawTeamName,
      players,
      checkedInAt: checkInNow ? new Date().toISOString() : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">Add Walk-In Team</h3>
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
            list="add-division-options"
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            placeholder="e.g., Men, Coed-Intermediate"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
          />
          <datalist id="add-division-options">
            {existingDivisions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Pool Name</label>
            <input
              type="text"
              list="pool-options"
              value={poolName}
              onChange={(e) => handlePoolChange(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <datalist id="pool-options">
              {existingPools.map((p) => (
                <option key={p.poolName} value={p.poolName} />
              ))}
            </datalist>
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

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Player 1 Name *</label>
          <input
            type="text"
            required
            value={player1}
            onChange={(e) => setPlayer1(e.target.value)}
            placeholder="e.g., Alex Rivera"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Player 2 Name</label>
          <input
            type="text"
            value={player2}
            onChange={(e) => setPlayer2(e.target.value)}
            placeholder="e.g., Sam Lee"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checkInNow}
            onChange={(e) => setCheckInNow(e.target.checked)}
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-sm font-medium text-slate-800">
            Mark as Checked In immediately
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
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
            Add Team
          </button>
        </div>
      </form>
    </div>
  );
}
