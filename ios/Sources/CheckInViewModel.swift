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

    @Published var totalCourtsAvailable: Int = 18 {
        didSet {
            UserDefaults.standard.set(totalCourtsAvailable, forKey: courtsKey)
        }
    }

    @Published var teams: [TeamEntry] = [] {
        didSet {
            saveToDisk()
        }
    }

    @Published var activeTeamId: String?
    @Published var bannerStatusText: String?
    @Published var searchQuery: String = ""
    @Published var selectedDivision: String = "Coed Intermediate"
    @Published var statusFilter: FilterStatus = .all
    @Published var alertMessage: String?

    init() {
        let savedCourts = UserDefaults.standard.integer(forKey: courtsKey)
        let initialCourts = savedCourts > 0 ? savedCourts : 18
        self.totalCourtsAvailable = initialCourts

        if let data = UserDefaults.standard.data(forKey: storageKey),
           let decoded = try? JSONDecoder().decode([TeamEntry].self, from: data),
           !decoded.isEmpty {
            self.teams = decoded
        } else {
            self.teams = CSVHelper.defaultTeams(totalCourts: initialCourts)
        }
        self.activeTeamId = self.teams.first?.id
        self.selectedDivision = self.teams.first?.division ?? "Coed Intermediate"
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

    private func saveToDisk() {
        if let encoded = try? JSONEncoder().encode(teams) {
            UserDefaults.standard.set(encoded, forKey: storageKey)
        }
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
