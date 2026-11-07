import Foundation

struct PlayerSlot: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var checkedIn: Bool
    var checkedInAt: Date?
}

enum CheckInStatus: String, Codable {
    case checkedIn = "checked-in"
    case partial = "partial"
    case unarrived = "unarrived"
}

enum FilterStatus: String, CaseIterable, Identifiable {
    case all = "All"
    case pending = "Not Checked In"
    case partial = "1/2 Here"
    case checkedIn = "Checked In"

    var id: String { rawValue }
}

struct TeamEntry: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var division: String
    var divisionCourts: String?
    var poolName: String
    var courts: String
    var rawTeamName: String
    var players: [PlayerSlot]
    var notes: String?
    var checkedInAt: Date?

    var status: CheckInStatus {
        guard !players.isEmpty else { return .unarrived }
        let checkedCount = players.filter { $0.checkedIn }.count
        if checkedCount == players.count { return .checkedIn }
        if checkedCount > 0 { return .partial }
        return .unarrived
    }

    var displayTeamName: String {
        if !rawTeamName.isEmpty {
            return rawTeamName
        }
        return players.map { $0.name }.joined(separator: " / ")
    }
}

struct SavedTournament: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var savedAt: Date
    var totalCourtsAvailable: Int
    var selectedDivision: String
    var teams: [TeamEntry]
}


enum CSVHelper {
    static let coedIntermediateCSV = """
    Pool Name,Courts,Team Name,Checked In
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
    Pool 4,4,Jin Burge / Louis Fernandez,
    """

    static let menCSV = """
    Pool Name,Courts,Team Name,Checked In
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
    Pool 4,13,Diogo Lucio / Isaiah Rios,
    """

    static func formatCourtRangeLabel(startCourt: Int, endCourt: Int) -> String {
        let s = max(1, min(startCourt, endCourt))
        let e = max(startCourt, endCourt)
        return s == e ? "\(s)" : "\(s)-\(e)"
    }

    static func applyCourtRangeToDivision(
        teams: [TeamEntry],
        division: String,
        startCourt: Int,
        endCourt: Int
    ) -> [TeamEntry] {
        let s = max(1, min(startCourt, endCourt))
        let e = max(startCourt, endCourt)
        let rangeLabel = formatCourtRangeLabel(startCourt: s, endCourt: e)

        var poolNames: [String] = []
        for t in teams where t.division == division {
            if !poolNames.contains(t.poolName) {
                poolNames.append(t.poolName)
            }
        }

        let numPools = poolNames.count
        let totalDivCourts = e - s + 1
        var poolCourtMap: [String: String] = [:]

        if numPools > 0 {
            if totalDivCourts >= numPools {
                var cursor = s
                let base = totalDivCourts / numPools
                var rem = totalDivCourts % numPools
                for pName in poolNames {
                    let count = base + (rem > 0 ? 1 : 0)
                    if rem > 0 { rem -= 1 }
                    let pStart = cursor
                    let pEnd = cursor + count - 1
                    cursor = pEnd + 1
                    poolCourtMap[pName] = formatCourtRangeLabel(startCourt: pStart, endCourt: pEnd)
                }
            } else {
                for (idx, pName) in poolNames.enumerated() {
                    let assigned = s + ((idx * totalDivCourts) / numPools)
                    poolCourtMap[pName] = "\(assigned)"
                }
            }
        }

        return teams.map { t in
            guard t.division == division else { return t }
            var copy = t
            copy.divisionCourts = rangeLabel
            copy.courts = poolCourtMap[t.poolName] ?? rangeLabel
            return copy
        }
    }

    static func autoAssignCourtsByTeamCount(teams: [TeamEntry], totalCourts: Int) -> [TeamEntry] {
        let safeTotalCourts = max(1, totalCourts)
        var divisionOrder: [String] = []
        var divisionCounts: [String: Int] = [:]

        for t in teams {
            let div = t.division.isEmpty ? "General" : t.division
            if divisionCounts[div] == nil {
                divisionOrder.append(div)
                divisionCounts[div] = 0
            }
            divisionCounts[div, default: 0] += 1
        }

        let numDivs = divisionOrder.count
        guard numDivs > 0 else { return teams }
        let totalTeams = teams.count
        var allocations: [String: Int] = [:]

        if safeTotalCourts <= numDivs {
            for div in divisionOrder { allocations[div] = 1 }
        } else {
            struct Quota {
                let div: String
                let count: Int
                var flo: Int
                let remainder: Double
            }
            var quotas: [Quota] = divisionOrder.map { div in
                let c = divisionCounts[div] ?? 0
                let exact = (Double(c) / Double(totalTeams)) * Double(safeTotalCourts)
                let f = max(1, Int(floor(exact)))
                return Quota(div: div, count: c, flo: f, remainder: exact - floor(exact))
            }

            var sumFlo = quotas.reduce(0) { $0 + $1.flo }
            while sumFlo > safeTotalCourts {
                quotas.sort { $0.flo > $1.flo }
                if quotas[0].flo > 1 {
                    quotas[0].flo -= 1
                    sumFlo -= 1
                } else {
                    break
                }
            }

            var remaining = safeTotalCourts - sumFlo
            var byRemainder = quotas.sorted {
                if $0.remainder != $1.remainder { return $0.remainder > $1.remainder }
                return $0.count > $1.count
            }
            var i = 0
            while remaining > 0 && !byRemainder.isEmpty {
                let idx = i % byRemainder.count
                byRemainder[idx].flo += 1
                remaining -= 1
                i += 1
            }

            for q in byRemainder {
                allocations[q.div] = q.flo
            }
        }

        var updated = teams
        var currentCourt = 1
        for div in divisionOrder {
            let cCount = allocations[div] ?? 1
            let s = currentCourt
            let e = currentCourt + cCount - 1
            currentCourt = e + 1
            updated = applyCourtRangeToDivision(teams: updated, division: div, startCourt: s, endCourt: e)
        }
        return updated
    }

    static func defaultTeams(totalCourts: Int = 18) -> [TeamEntry] {
        let coed = parseTournamentCSV(coedIntermediateCSV, defaultDivision: "Coed Intermediate")
        let men = parseTournamentCSV(menCSV, defaultDivision: "Men's Intermediate")
        return autoAssignCourtsByTeamCount(teams: coed + men, totalCourts: totalCourts)
    }

    static func extractDivisionFromFilename(_ filename: String) -> String {
        let base = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent
        let withoutCopy = base.replacingOccurrences(
            of: #"\s*\(\d+\)$"#,
            with: "",
            options: .regularExpression
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        let withoutSignIn = withoutCopy.replacingOccurrences(
            of: #"[\s_-]*sign[\s_-]*in$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        return withoutSignIn.isEmpty ? (withoutCopy.isEmpty ? "General" : withoutCopy) : withoutSignIn
    }

    static func parseTeamPlayers(rawTeamName: String, isCheckedInInit: Bool, partialSpec: String? = nil) -> [PlayerSlot] {
        let trimmed = rawTeamName.trimmingCharacters(in: .whitespacesAndNewlines)
        var names: [String] = []

        if trimmed.contains("/") {
            names = trimmed
                .split(separator: "/")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        } else if trimmed.range(of: #"\(\+1\)"#, options: [.regularExpression, .caseInsensitive]) != nil {
            let mainPlayer = trimmed.replacingOccurrences(
                of: #"\(\+1\)"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            ).trimmingCharacters(in: .whitespacesAndNewlines)
            let p1 = mainPlayer.isEmpty ? "Player 1" : mainPlayer
            names = [p1, "\(p1)'s +1"]
        } else if trimmed.contains(" & ") {
            names = trimmed
                .components(separatedBy: " & ")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        } else {
            names = ["\(trimmed) (Player 1)", "\(trimmed) (Player 2)"]
        }

        let now = isCheckedInInit ? Date() : nil
        return names.map { name in
            var slotChecked = isCheckedInInit
            if !isCheckedInInit, let spec = partialSpec?.lowercased() {
                slotChecked = spec.contains(name.lowercased())
            }
            return PlayerSlot(name: name, checkedIn: slotChecked, checkedInAt: slotChecked ? now : nil)
        }
    }

    static func parseCSVLine(_ line: String) -> [String] {
        var result: [String] = []
        var current = ""
        var inQuotes = false
        let chars = Array(line)
        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if ch == "\"" {
                if inQuotes && i + 1 < chars.count && chars[i + 1] == "\"" {
                    current.append("\"")
                    i += 1
                } else {
                    inQuotes.toggle()
                }
            } else if ch == "," && !inQuotes {
                result.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
                current = ""
            } else {
                current.append(ch)
            }
            i += 1
        }
        result.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
        return result
    }

    static func parseTournamentCSV(_ csvText: String, defaultDivision: String = "General") -> [TeamEntry] {
        let cleaned = csvText
            .replacingOccurrences(of: "\u{FEFF}", with: "")
            .replacingOccurrences(
                of: #"([^\r\n])(Pool Name\s*,\s*Courts)"#,
                with: "$1\n$2",
                options: [.regularExpression, .caseInsensitive]
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !cleaned.isEmpty else { return [] }

        let lines = cleaned
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard lines.count >= 2 else { return [] }

        let headers = parseCSVLine(lines[0]).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

        func findColIndex(candidates: [String], used: inout Set<Int>) -> Int? {
            for cand in candidates {
                if let idx = headers.enumerated().first(where: { !used.contains($0.offset) && $0.element.lowercased() == cand.lowercased() })?.offset {
                    used.insert(idx)
                    return idx
                }
            }
            for cand in candidates {
                if let idx = headers.enumerated().first(where: { !used.contains($0.offset) && $0.element.lowercased().contains(cand.lowercased()) })?.offset {
                    used.insert(idx)
                    return idx
                }
            }
            return nil
        }

        var usedCols = Set<Int>()
        let divIdx = findColIndex(candidates: ["Division", "Div", "Category", "Bracket"], used: &usedCols)
        let poolIdx = findColIndex(candidates: ["Pool Name", "Pool", "Group"], used: &usedCols) ?? 0
        let courtsIdx = findColIndex(candidates: ["Courts", "Court", "Court #"], used: &usedCols) ?? 1
        let teamIdx = findColIndex(candidates: ["Team Name", "Team", "Players", "Player Names", "Roster"], used: &usedCols) ?? 2
        let checkedIdx = findColIndex(candidates: ["Checked In", "Check In", "CheckedIn", "Status"], used: &usedCols) ?? 3
        let notesIdx = findColIndex(candidates: ["Notes", "Note", "Comments"], used: &usedCols)

        var entries: [TeamEntry] = []

        for rowLine in lines.dropFirst() {
            let cols = parseCSVLine(rowLine)
            func col(_ idx: Int?) -> String {
                guard let idx = idx, idx >= 0 && idx < cols.count else { return "" }
                return cols[idx].trimmingCharacters(in: .whitespacesAndNewlines)
            }

            let rawTeamName = col(teamIdx)
            let poolName = col(poolIdx).isEmpty ? "Unassigned Pool" : col(poolIdx)
            if rawTeamName.isEmpty || rawTeamName.lowercased() == "team name" || poolName.lowercased() == "pool name" {
                continue
            }

            let divisionVal = col(divIdx).isEmpty ? defaultDivision : col(divIdx)
            let courtsVal = col(courtsIdx).isEmpty ? "-" : col(courtsIdx)
            let checkedRaw = col(checkedIdx)
            let notesVal = col(notesIdx)

            let lowerCheck = checkedRaw.lowercased()
            let isFull = ["yes", "true", "1", "checked in", "x", "✓"].contains(lowerCheck)
            let isPartial = lowerCheck.hasPrefix("partial") || lowerCheck.hasPrefix("1/2")

            let players = parseTeamPlayers(
                rawTeamName: rawTeamName,
                isCheckedInInit: isFull,
                partialSpec: isPartial ? checkedRaw : nil
            )

            entries.append(
                TeamEntry(
                    division: divisionVal,
                    poolName: poolName,
                    courts: courtsVal,
                    rawTeamName: rawTeamName,
                    players: players,
                    notes: notesVal.isEmpty ? nil : notesVal,
                    checkedInAt: isFull ? Date() : nil
                )
            )
        }

        return entries
    }
}
