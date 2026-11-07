import Foundation
import SwiftUI
import UIKit

struct DivisionSummary: Identifiable {
    var id: String { division }
    let division: String
    let total: Int
    let checkedIn: Int
    let partial: Int
    let courtLabel: String

    var isAllReady: Bool { total > 0 && checkedIn == total }
}

struct PoolSummary: Identifiable {
    var id: String { key }
    let key: String
    let division: String
    let poolName: String
    let courtsLabel: String
    let total: Int
    let checkedIn: Int
    let partial: Int

    var isReady: Bool { total > 0 && checkedIn == total }
}

struct PoolGroupSection: Identifiable {
    var id: String { groupKey }
    let groupKey: String
    let division: String
    let poolName: String
    let courtsLabel: String
    let teams: [TeamEntry]
}

@MainActor
final class CheckInViewModel: ObservableObject {
    private let storageKey = "no_attitude_checkin_ios_v2"
    private let courtsKey = "no_attitude_checkin_ios_total_courts_v1"
    private let tournamentNameKey = "no_attitude_checkin_ios_tournament_name_v1"
    private let selectedDivKey = "no_attitude_checkin_ios_selected_div_v1"
    private let activeSavedIdKey = "no_attitude_checkin_ios_active_saved_id_v1"
    private let savedTournamentsKey = "no_attitude_checkin_ios_saved_tournaments_v1"

    private var isInitializing = true

    @Published var tournamentName: String = "No Attitude Tournament" {
        didSet {
            if !isInitializing { saveToDisk() }
        }
    }

    @Published var totalCourtsAvailable: Int = 18 {
        didSet {
            if !isInitializing { saveToDisk() }
        }
    }

    @Published var teams: [TeamEntry] = [] {
        didSet {
            if !isInitializing { saveToDisk() }
        }
    }

    @Published var savedTournaments: [SavedTournament] = []
    @Published var activeSavedTournamentId: String?
    @Published var lastSavedAt: Date = Date()

    @Published var activeTeamId: String?
    @Published var bannerStatusText: String?
    @Published var searchQuery: String = ""
    @Published var selectedDivision: String = "Coed Intermediate" {
        didSet {
            if !isInitializing { saveToDisk() }
        }
    }
    @Published var statusFilter: FilterStatus = .all
    @Published var alertMessage: String?

    private var activeTournamentFileURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("active_tournament.json")
    }

    private var savedTournamentsFileURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("saved_tournaments.json")
    }

    init() {
        let savedCourts = UserDefaults.standard.integer(forKey: courtsKey)
        let initialCourts = savedCourts > 0 ? savedCourts : 18
        self.totalCourtsAvailable = initialCourts

        let formatter = DateFormatter()
        formatter.dateStyle = .short
        let defaultName = "No Attitude Tournament (\(formatter.string(from: Date())))"
        self.tournamentName = UserDefaults.standard.string(forKey: tournamentNameKey) ?? defaultName
        self.activeSavedTournamentId = UserDefaults.standard.string(forKey: activeSavedIdKey)

        // Load saved tournaments list from Documents/saved_tournaments.json or UserDefaults
        if let url = savedTournamentsFileURL,
           let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode([SavedTournament].self, from: data) {
            self.savedTournaments = decoded
        } else if let data = UserDefaults.standard.data(forKey: savedTournamentsKey),
                  let decoded = try? JSONDecoder().decode([SavedTournament].self, from: data) {
            self.savedTournaments = decoded
        }

        // Load active tournament from Documents/active_tournament.json or UserDefaults
        if let url = activeTournamentFileURL,
           let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode(SavedTournament.self, from: data),
           !decoded.teams.isEmpty {
            self.tournamentName = decoded.name
            self.totalCourtsAvailable = decoded.totalCourtsAvailable > 0 ? decoded.totalCourtsAvailable : initialCourts
            self.teams = decoded.teams
            self.selectedDivision = decoded.selectedDivision
            self.lastSavedAt = decoded.savedAt
            if self.activeSavedTournamentId == nil {
                self.activeSavedTournamentId = decoded.id
            }
        } else if let data = UserDefaults.standard.data(forKey: storageKey),
                  let decoded = try? JSONDecoder().decode([TeamEntry].self, from: data),
                  !decoded.isEmpty {
            self.teams = decoded
            let savedDiv = UserDefaults.standard.string(forKey: selectedDivKey)
            if let savedDiv, decoded.contains(where: { $0.division == savedDiv }) {
                self.selectedDivision = savedDiv
            } else {
                self.selectedDivision = decoded.first?.division ?? "Coed Intermediate"
            }
        } else {
            self.teams = CSVHelper.defaultTeams(totalCourts: initialCourts)
            self.selectedDivision = self.teams.first?.division ?? "Coed Intermediate"
        }

        self.activeTeamId = self.teams.first(where: { $0.division == self.selectedDivision })?.id ?? self.teams.first?.id
        self.isInitializing = false
        saveToDisk()
        seedSampleCSVFilesInDocuments()
    }

    private func seedSampleCSVFilesInDocuments() {
        guard let docsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return
        }
        let coedURL = docsURL.appendingPathComponent("Coed Intermediate _Sign-In.csv")
        let menURL = docsURL.appendingPathComponent("Men's Intermediate_Sign-In.csv")

        if !FileManager.default.fileExists(atPath: coedURL.path) {
            try? CSVHelper.coedIntermediateCSV.write(to: coedURL, atomically: true, encoding: .utf8)
        }
        if !FileManager.default.fileExists(atPath: menURL.path) {
            try? CSVHelper.menCSV.write(to: menURL, atomically: true, encoding: .utf8)
        }
    }

    func saveToDisk() {
        let now = Date()
        lastSavedAt = now

        let activeId = activeSavedTournamentId ?? "tournament-default"
        if activeSavedTournamentId == nil {
            activeSavedTournamentId = activeId
        }

        let currentSnapshot = SavedTournament(
            id: activeId,
            name: tournamentName,
            savedAt: now,
            totalCourtsAvailable: totalCourtsAvailable,
            selectedDivision: selectedDivision,
            teams: teams
        )

        UserDefaults.standard.set(totalCourtsAvailable, forKey: courtsKey)
        UserDefaults.standard.set(tournamentName, forKey: tournamentNameKey)
        UserDefaults.standard.set(selectedDivision, forKey: selectedDivKey)
        UserDefaults.standard.set(activeId, forKey: activeSavedIdKey)

        if let encodedTeams = try? JSONEncoder().encode(teams) {
            UserDefaults.standard.set(encodedTeams, forKey: storageKey)
        }

        if let activeURL = activeTournamentFileURL,
           let encodedActive = try? JSONEncoder().encode(currentSnapshot) {
            try? encodedActive.write(to: activeURL, options: .atomic)
        }

        // Keep savedTournaments list synced with current active tournament
        if savedTournaments.isEmpty {
            savedTournaments = [currentSnapshot]
        } else if let idx = savedTournaments.firstIndex(where: { $0.id == activeId }) {
            savedTournaments[idx] = currentSnapshot
        } else {
            savedTournaments.insert(currentSnapshot, at: 0)
        }

        persistSavedTournamentsList()
    }

    private func persistSavedTournamentsList() {
        if let encodedList = try? JSONEncoder().encode(savedTournaments) {
            UserDefaults.standard.set(encodedList, forKey: savedTournamentsKey)
            if let listURL = savedTournamentsFileURL {
                try? encodedList.write(to: listURL, options: .atomic)
            }
        }
    }

    func saveTournamentSnapshot(name: String, asNew: Bool) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalName = trimmed.isEmpty ? "No Attitude Tournament" : trimmed
        let now = Date()

        isInitializing = true
        tournamentName = finalName
        if asNew || activeSavedTournamentId == nil {
            let newId = "tournament-\(Int(now.timeIntervalSince1970))"
            activeSavedTournamentId = newId
            let newSnapshot = SavedTournament(
                id: newId,
                name: finalName,
                savedAt: now,
                totalCourtsAvailable: totalCourtsAvailable,
                selectedDivision: selectedDivision,
                teams: teams
            )
            savedTournaments.insert(newSnapshot, at: 0)
        }
        isInitializing = false
        saveToDisk()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    func loadSavedTournament(_ saved: SavedTournament) {
        isInitializing = true
        tournamentName = saved.name
        totalCourtsAvailable = saved.totalCourtsAvailable > 0 ? saved.totalCourtsAvailable : 18
        teams = saved.teams
        selectedDivision = saved.selectedDivision.isEmpty
            ? (saved.teams.first?.division ?? "Coed Intermediate")
            : saved.selectedDivision
        activeSavedTournamentId = saved.id
        activeTeamId = saved.teams.first(where: { $0.division == selectedDivision })?.id ?? saved.teams.first?.id
        isInitializing = false
        saveToDisk()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    func deleteSavedTournament(id: String) {
        savedTournaments.removeAll { $0.id == id }
        persistSavedTournamentsList()
    }

    var activeTeam: TeamEntry? {
        guard let activeTeamId else { return nil }
        return teams.first(where: { $0.id == activeTeamId })
    }

    var divisionsList: [DivisionSummary] {
        var order: [String] = []
        var counts: [String: (total: Int, checked: Int, partial: Int, divCourts: String?, courtsSet: [String])] = [:]

        for team in teams {
            let div = team.division.isEmpty ? "General" : team.division
            if counts[div] == nil {
                order.append(div)
                counts[div] = (0, 0, 0, team.divisionCourts, [])
            }
            var item = counts[div]!
            item.total += 1
            if let dc = team.divisionCourts, !dc.isEmpty {
                item.divCourts = dc
            }
            if !team.courts.isEmpty && team.courts != "-" && !item.courtsSet.contains(team.courts) {
                item.courtsSet.append(team.courts)
            }
            switch team.status {
            case .checkedIn: item.checked += 1
            case .partial: item.partial += 1
            case .unarrived: break
            }
            counts[div] = item
        }

        return order.compactMap { div in
            guard let c = counts[div] else { return nil }
            var label = c.divCourts ?? ""
            if label.isEmpty && !c.courtsSet.isEmpty {
                var nums: [Int] = []
                for cs in c.courtsSet {
                    let parts = cs.components(separatedBy: CharacterSet(charactersIn: "-, "))
                    for p in parts {
                        if let n = Int(p), n > 0 { nums.append(n) }
                    }
                }
                if let minC = nums.min(), let maxC = nums.max() {
                    label = CSVHelper.formatCourtRangeLabel(startCourt: minC, endCourt: maxC)
                } else {
                    label = c.courtsSet.joined(separator: ", ")
                }
            }
            return DivisionSummary(
                division: div,
                total: c.total,
                checkedIn: c.checked,
                partial: c.partial,
                courtLabel: label.isEmpty ? "1" : label
            )
        }
    }

    var currentDivisionSummary: DivisionSummary? {
        divisionsList.first(where: { $0.division == selectedDivision }) ?? divisionsList.first
    }

    var divisionScopedTeams: [TeamEntry] {
        teams.filter { $0.division == selectedDivision }
    }

    var totalTeamsCount: Int { divisionScopedTeams.count }
    var fullTeamsCount: Int { divisionScopedTeams.filter { $0.status == .checkedIn }.count }
    var partialTeamsCount: Int { divisionScopedTeams.filter { $0.status == .partial }.count }
    var pendingTeamsCount: Int { divisionScopedTeams.filter { $0.status != .checkedIn }.count }

    var progressFraction: Double {
        guard totalTeamsCount > 0 else { return 0 }
        return Double(fullTeamsCount) / Double(totalTeamsCount)
    }

    var filteredTeams: [TeamEntry] {
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return divisionScopedTeams.filter { team in
            switch statusFilter {
            case .all: break
            case .pending: if team.status == .checkedIn { return false }
            case .partial: if team.status != .partial { return false }
            case .checkedIn: if team.status != .checkedIn { return false }
            }

            if q.isEmpty { return true }
            if team.rawTeamName.lowercased().contains(q) { return true }
            if team.displayTeamName.lowercased().contains(q) { return true }
            if team.division.lowercased().contains(q) { return true }
            if team.poolName.lowercased().contains(q) { return true }
            if "court \(team.courts)".lowercased().contains(q) { return true }
            if team.players.contains(where: { $0.name.lowercased().contains(q) }) { return true }
            if let notes = team.notes, notes.lowercased().contains(q) { return true }
            return false
        }
    }

    var groupedSections: [PoolGroupSection] {
        var order: [String] = []
        var map: [String: (division: String, poolName: String, courts: [String], teams: [TeamEntry])] = [:]

        for team in filteredTeams {
            let key = "\(team.division):::\(team.poolName)"
            if map[key] == nil {
                order.append(key)
                map[key] = (team.division, team.poolName, [], [])
            }
            var grp = map[key]!
            if !team.courts.isEmpty && team.courts != "-" && !grp.courts.contains(team.courts) {
                grp.courts.append(team.courts)
            }
            grp.teams.append(team)
            map[key] = grp
        }

        return order.compactMap { key in
            guard let grp = map[key] else { return nil }
            return PoolGroupSection(
                groupKey: key,
                division: grp.division,
                poolName: grp.poolName,
                courtsLabel: grp.courts.joined(separator: ", "),
                teams: grp.teams
            )
        }
    }

    func assignCourtsToDivision(division: String, startCourt: Int, endCourt: Int) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        teams = CSVHelper.applyCourtRangeToDivision(
            teams: teams,
            division: division,
            startCourt: startCourt,
            endCourt: endCourt
        )
    }

    func autoAssignAllCourts(totalCourts: Int) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        totalCourtsAvailable = max(1, totalCourts)
        teams = CSVHelper.autoAssignCourtsByTeamCount(teams: teams, totalCourts: totalCourtsAvailable)
    }

    func toggleFullTeamCheckIn(teamId: String) {
        guard let idx = teams.firstIndex(where: { $0.id == teamId }) else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()

        var team = teams[idx]
        let targetChecked = team.status != .checkedIn
        let now = targetChecked ? Date() : nil

        team.checkedInAt = now
        team.players = team.players.map { p in
            var copy = p
            copy.checkedIn = targetChecked
            copy.checkedInAt = targetChecked ? (p.checkedInAt ?? now) : nil
            return copy
        }
        teams[idx] = team
        activeTeamId = team.id
        bannerStatusText = targetChecked ? "Team Checked In!" : "Check-In Cleared"
    }

    func togglePlayerCheckIn(teamId: String, playerId: String) {
        guard let idx = teams.firstIndex(where: { $0.id == teamId }) else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()

        var team = teams[idx]
        let now = Date()
        var toggledName = ""
        var toggledChecked = false

        team.players = team.players.map { p in
            guard p.id == playerId else { return p }
            var copy = p
            copy.checkedIn.toggle()
            copy.checkedInAt = copy.checkedIn ? now : nil
            toggledName = copy.name
            toggledChecked = copy.checkedIn
            return copy
        }

        let allChecked = team.players.allSatisfy { $0.checkedIn }
        team.checkedInAt = allChecked ? (team.checkedInAt ?? now) : nil
        teams[idx] = team
        activeTeamId = team.id

        if allChecked {
            bannerStatusText = "Full Team Checked In (\(toggledName) arrived)"
        } else if toggledChecked {
            bannerStatusText = "\(toggledName) Checked In (1/2 Here)"
        } else {
            bannerStatusText = "\(toggledName) Unchecked"
        }
    }

    private func readCSVText(from fileURL: URL) -> String? {
        let accessing = fileURL.startAccessingSecurityScopedResource()
        defer {
            if accessing { fileURL.stopAccessingSecurityScopedResource() }
        }

        var resultText: String?
        let coordinator = NSFileCoordinator()
        var coordError: NSError?

        coordinator.coordinate(readingItemAt: fileURL, options: .withoutChanges, error: &coordError) { coordinatedURL in
            if let data = try? Data(contentsOf: coordinatedURL) {
                resultText = String(data: data, encoding: .utf8)
                    ?? String(data: data, encoding: .windowsCP1252)
                    ?? String(data: data, encoding: .macOSRoman)
                    ?? String(data: data, encoding: .utf16)
                    ?? String(decoding: data, as: UTF8.self)
            }
        }

        if resultText == nil, let data = try? Data(contentsOf: fileURL) {
            resultText = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .windowsCP1252)
                ?? String(decoding: data, as: UTF8.self)
        }

        return resultText
    }

    func importURLs(_ urls: [URL], replaceAll: Bool) {
        var loadedTeams: [TeamEntry] = []
        var importedDivisions: Set<String> = []

        for url in urls {
            let accessing = url.startAccessingSecurityScopedResource()
            defer {
                if accessing { url.stopAccessingSecurityScopedResource() }
            }

            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
                let keys: [URLResourceKey] = [.isRegularFileKey, .nameKey]
                if let enumerator = FileManager.default.enumerator(
                    at: url,
                    includingPropertiesForKeys: keys,
                    options: [.skipsHiddenFiles]
                ) {
                    for case let fileURL as URL in enumerator {
                        if fileURL.pathExtension.lowercased() == "csv" {
                            if let text = readCSVText(from: fileURL) {
                                let div = CSVHelper.extractDivisionFromFilename(fileURL.lastPathComponent)
                                let parsed = CSVHelper.parseTournamentCSV(text, defaultDivision: div)
                                if !parsed.isEmpty {
                                    loadedTeams.append(contentsOf: parsed)
                                    importedDivisions.insert(div)
                                }
                            }
                        }
                    }
                }
            } else {
                if let text = readCSVText(from: url) {
                    let div = CSVHelper.extractDivisionFromFilename(url.lastPathComponent)
                    let parsed = CSVHelper.parseTournamentCSV(text, defaultDivision: div)
                    if !parsed.isEmpty {
                        loadedTeams.append(contentsOf: parsed)
                        importedDivisions.insert(div)
                    }
                }
            }
        }

        guard !loadedTeams.isEmpty else {
            alertMessage = "No valid CSV team rows were found. Make sure your CSV files have columns: Pool Name, Courts, Team Name, Checked In."
            return
        }

        let combined: [TeamEntry]
        if replaceAll {
            combined = loadedTeams
        } else {
            let kept = teams.filter { !importedDivisions.contains($0.division) }
            combined = kept + loadedTeams
        }

        teams = CSVHelper.autoAssignCourtsByTeamCount(teams: combined, totalCourts: totalCourtsAvailable)

        selectedDivision = importedDivisions.sorted().first ?? (teams.first?.division ?? "Coed Intermediate")
        activeTeamId = teams.first(where: { $0.division == selectedDivision })?.id ?? teams.first?.id
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        alertMessage = "Loaded \(loadedTeams.count) teams across \(importedDivisions.count) division(s) and assigned \(totalCourtsAvailable) courts."
    }

    func resetCheckIns() {
        teams = teams.map { t in
            if t.division != selectedDivision { return t }
            var copy = t
            copy.checkedInAt = nil
            copy.players = copy.players.map { p in
                var pc = p
                pc.checkedIn = false
                pc.checkedInAt = nil
                return pc
            }
            return copy
        }
        bannerStatusText = nil
    }

    func restoreDefaultRosters() {
        let defaults = CSVHelper.defaultTeams(totalCourts: totalCourtsAvailable)
        teams = defaults
        selectedDivision = defaults.first?.division ?? "Coed Intermediate"
        activeTeamId = defaults.first?.id
    }
}
