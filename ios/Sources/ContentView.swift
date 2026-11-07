import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum DocumentPickerMode: String, Identifiable {
    case csvFiles
    case folder

    var id: String { rawValue }
}

struct EditingDivisionTarget: Identifiable {
    var id: String { division }
    let division: String
}

struct DocumentPickerView: UIViewControllerRepresentable {
    let mode: DocumentPickerMode
    let onPick: ([URL]) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onPick: onPick, onCancel: onCancel)
    }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker: UIDocumentPickerViewController
        switch mode {
        case .csvFiles:
            var types: [UTType] = [
                .commaSeparatedText,
                .plainText,
                .text,
                .spreadsheet,
                .data,
                .content,
                .item
            ]
            if let csvExtType = UTType(filenameExtension: "csv"), !types.contains(csvExtType) {
                types.insert(csvExtType, at: 0)
            }
            picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.allowsMultipleSelection = true
        case .folder:
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.allowsMultipleSelection = true
        }
        picker.delegate = context.coordinator
        picker.shouldShowFileExtensions = true
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: ([URL]) -> Void
        let onCancel: () -> Void

        init(onPick: @escaping ([URL]) -> Void, onCancel: @escaping () -> Void) {
            self.onPick = onPick
            self.onCancel = onCancel
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onPick(urls)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            onCancel()
        }
    }
}

struct ContentView: View {
    @StateObject private var vm = CheckInViewModel()

    @State private var showImportSheet = false
    @State private var showSaveTournamentSheet = false
    @State private var directPickerMode: DocumentPickerMode?
    @State private var editingTeam: TeamEntry?
    @State private var editingDivisionTarget: EditingDivisionTarget?
    @State private var importReplaceMode = false

    private let emeraldColor = Color(red: 0.06, green: 0.73, blue: 0.51)
    private let darkHeaderColor = Color(red: 0.06, green: 0.09, blue: 0.16)

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                headerSection
                searchAndFilterSection

                ScrollView {
                    LazyVStack(spacing: 16) {
                        if let active = vm.activeTeam {
                            nowCheckingInSpotlight(team: active)
                        }

                        if vm.groupedSections.isEmpty {
                            emptyStateView
                        } else {
                            ForEach(vm.groupedSections) { section in
                                poolSectionCard(section: section)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
                }
                .background(Color(UIColor.systemGroupedBackground))
            }
            .navigationBarHidden(true)
            .sheet(item: $directPickerMode) { mode in
                DocumentPickerView(
                    mode: mode,
                    onPick: { urls in
                        directPickerMode = nil
                        vm.importURLs(urls, replaceAll: importReplaceMode)
                    },
                    onCancel: {
                        directPickerMode = nil
                    }
                )
                .ignoresSafeArea()
            }
            .sheet(isPresented: $showImportSheet) {
                ImportCSVSheet(
                    vm: vm,
                    importReplaceMode: $importReplaceMode
                )
            }
            .sheet(isPresented: $showSaveTournamentSheet) {
                SaveTournamentSheet(vm: vm)
            }
            .sheet(item: $editingDivisionTarget) { target in
                EditDivisionCourtsSheet(
                    vm: vm,
                    initialDivision: target.division
                )
            }
            .sheet(item: $editingTeam) { team in
                EditTeamSheet(vm: vm, team: team)
            }
            .alert(
                "Tournament Check-In",
                isPresented: Binding(
                    get: { vm.alertMessage != nil },
                    set: { if !$0 { vm.alertMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { vm.alertMessage = nil }
            } message: {
                Text(vm.alertMessage ?? "")
            }
        }
    }

    // MARK: - Top Header
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(emeraldColor.opacity(0.2))
                        .frame(width: 38, height: 38)
                    Image(systemName: "person.badge.shield.checkmark.fill")
                        .foregroundColor(emeraldColor)
                        .font(.system(size: 18, weight: .bold))
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Button {
                            showSaveTournamentSheet = true
                        } label: {
                            HStack(spacing: 4) {
                                Text(vm.tournamentName)
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(emeraldColor)
                            }
                        }

                        Text("\(vm.divisionsList.count) Div • \(vm.teams.count) Teams")
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(emeraldColor.opacity(0.25))
                            .foregroundColor(emeraldColor)
                            .clipShape(Capsule())
                    }
                    Text("Auto-saved • Tap a Division or Court badge to edit courts (e.g. Ct 1-7)")
                        .font(.system(size: 11))
                        .foregroundColor(Color.white.opacity(0.65))
                }

                Spacer()

                HStack(spacing: 6) {
                    Button {
                        showSaveTournamentSheet = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "externaldrive.fill.badge.checkmark")
                            Text("Save")
                        }
                        .font(.system(size: 12, weight: .bold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 8)
                        .background(Color.white.opacity(0.14))
                        .foregroundColor(emeraldColor)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    Button {
                        editingDivisionTarget = EditingDivisionTarget(division: vm.selectedDivision)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "sportscourt.fill")
                            Text("\(vm.totalCourtsAvailable) Cts")
                        }
                        .font(.system(size: 12, weight: .bold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 8)
                        .background(Color.white.opacity(0.14))
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }

                    Menu {
                        Button {
                            importReplaceMode = false
                            directPickerMode = .csvFiles
                        } label: {
                            Label("Select CSV File(s) (Add/Merge)", systemImage: "doc.badge.plus")
                        }

                        Button {
                            importReplaceMode = true
                            directPickerMode = .csvFiles
                        } label: {
                            Label("Select CSV File(s) (Replace All)", systemImage: "arrow.triangle.2.circlepath.doc.on.clipboard")
                        }

                        Button {
                            importReplaceMode = false
                            directPickerMode = .folder
                        } label: {
                            Label("Select Folder of CSVs", systemImage: "folder.badge.plus")
                        }

                        Divider()

                        Button {
                            showImportSheet = true
                        } label: {
                            Label("Paste CSV Text / Options...", systemImage: "doc.on.clipboard")
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "folder.badge.plus")
                            Text("CSVs")
                        }
                        .font(.system(size: 12, weight: .bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(emeraldColor)
                        .foregroundColor(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }

            // Division Selector ScrollView — Click division or its Court pill to edit courts
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(vm.divisionsList) { div in
                        let isSelected = vm.selectedDivision == div.division
                        HStack(spacing: 6) {
                            Button {
                                if isSelected {
                                    editingDivisionTarget = EditingDivisionTarget(division: div.division)
                                } else {
                                    vm.selectedDivision = div.division
                                    if let firstInDiv = vm.teams.first(where: { $0.division == div.division }) {
                                        vm.activeTeamId = firstInDiv.id
                                    }
                                }
                            } label: {
                                HStack(spacing: 5) {
                                    Text(div.division)
                                        .font(.system(size: 13, weight: .bold))
                                    Text("\(div.checkedIn)/\(div.total)\(div.isAllReady ? " ✓" : "")")
                                        .font(.system(size: 11, weight: .heavy))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(isSelected ? Color.black.opacity(0.2) : Color.white.opacity(0.15))
                                        .clipShape(Capsule())
                                }
                            }

                            Button {
                                vm.selectedDivision = div.division
                                editingDivisionTarget = EditingDivisionTarget(division: div.division)
                            } label: {
                                HStack(spacing: 3) {
                                    Image(systemName: "mappin.and.ellipse")
                                        .font(.system(size: 9))
                                    Text("Ct \(div.courtLabel)")
                                        .font(.system(size: 11, weight: .bold))
                                    Image(systemName: "pencil")
                                        .font(.system(size: 9))
                                }
                                .padding(.horizontal, 7)
                                .padding(.vertical, 4)
                                .background(isSelected ? Color.black.opacity(0.85) : Color.black.opacity(0.45))
                                .foregroundColor(emeraldColor)
                                .clipShape(RoundedRectangle(cornerRadius: 7))
                            }
                        }
                        .padding(.leading, 11)
                        .padding(.trailing, 6)
                        .padding(.vertical, 6)
                        .background(
                            isSelected
                                ? emeraldColor
                                : (div.isAllReady ? emeraldColor.opacity(0.25) : Color.white.opacity(0.1))
                        )
                        .foregroundColor(isSelected ? .black : .white)
                        .clipShape(RoundedRectangle(cornerRadius: 11))
                    }
                }
            }

            // Progress Bar Box & Editable Division Court Range
            VStack(spacing: 6) {
                HStack {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(emeraldColor)
                            .frame(width: 8, height: 8)
                        Text("\(vm.selectedDivision): \(vm.fullTeamsCount)/\(vm.totalTeamsCount) Checked In")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white)
                    }

                    if let currentSummary = vm.currentDivisionSummary {
                        Button {
                            editingDivisionTarget = EditingDivisionTarget(division: vm.selectedDivision)
                        } label: {
                            HStack(spacing: 4) {
                                Text("Court \(currentSummary.courtLabel)")
                                Image(systemName: "pencil")
                            }
                            .font(.system(size: 11, weight: .bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(emeraldColor.opacity(0.2))
                            .foregroundColor(emeraldColor)
                            .clipShape(Capsule())
                        }
                    }

                    Spacer()

                    if vm.fullTeamsCount > 0 || vm.partialTeamsCount > 0 {
                        Button("Reset") {
                            vm.resetCheckIns()
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Color.white.opacity(0.7))
                    }
                }

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.black.opacity(0.4))
                        Capsule()
                            .fill(emeraldColor)
                            .frame(width: max(0, geo.size.width * vm.progressFraction))
                    }
                }
                .frame(height: 6)
            }
            .padding(10)
            .background(Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(darkHeaderColor)
    }

    // MARK: - Search & Filter Subbar
    private var searchAndFilterSection: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                    .font(.system(size: 14))
                TextField("Search team name, player, pool, or court...", text: $vm.searchQuery)
                    .font(.system(size: 14))
                    .autocorrectionDisabled()
                if !vm.searchQuery.isEmpty {
                    Button {
                        vm.searchQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(UIColor.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            // Status Filter Pills
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(FilterStatus.allCases) { tab in
                        let isSelected = vm.statusFilter == tab
                        let count: Int = {
                            switch tab {
                            case .all: return vm.totalTeamsCount
                            case .pending: return vm.pendingTeamsCount
                            case .partial: return vm.partialTeamsCount
                            case .checkedIn: return vm.fullTeamsCount
                            }
                        }()

                        Button {
                            vm.statusFilter = tab
                        } label: {
                            Text("\(tab.rawValue) (\(count))")
                                .font(.system(size: 12, weight: .semibold))
                                .padding(.horizontal, 11)
                                .padding(.vertical, 6)
                                .background(isSelected ? darkHeaderColor : Color(UIColor.secondarySystemBackground))
                                .foregroundColor(isSelected ? .white : .primary)
                                .clipShape(RoundedRectangle(cornerRadius: 9))
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(UIColor.systemBackground))
        .overlay(Divider(), alignment: .bottom)
    }

    // MARK: - Now Checking In Spotlight Card (Redesigned Boarding-Pass Layout)
    private func nowCheckingInSpotlight(team: TeamEntry) -> some View {
        let checkedPlayers = team.players.filter { $0.checkedIn }.count
        let divCourts = team.divisionCourts ?? team.courts

        return VStack(alignment: .leading, spacing: 12) {
            // Top Header Row: Status Badge + Division Courts Pill + Close Button
            HStack(spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: team.status == .checkedIn ? "checkmark.seal.fill" : "person.badge.shield.checkmark.fill")
                    Text(
                        team.status == .checkedIn
                            ? "TEAM CHECKED IN"
                            : (team.status == .partial ? "CHECKING IN (\(checkedPlayers)/\(team.players.count))" : "NOW CHECKING IN")
                    )
                }
                .font(.system(size: 11, weight: .heavy))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(team.status == .partial ? Color.orange : emeraldColor)
                .foregroundColor(.black)
                .clipShape(Capsule())

                Button {
                    editingDivisionTarget = EditingDivisionTarget(division: team.division)
                } label: {
                    HStack(spacing: 4) {
                        Text("\(team.division) • Courts \(divCourts)")
                        Image(systemName: "pencil")
                    }
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.indigo.opacity(0.3))
                    .foregroundColor(.white)
                    .overlay(
                        Capsule()
                            .stroke(Color.indigo.opacity(0.5), lineWidth: 1)
                    )
                    .clipShape(Capsule())
                }

                Spacer()

                Button {
                    editingTeam = team
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.white.opacity(0.75))
                        .padding(6)
                        .background(Color.white.opacity(0.1))
                        .clipShape(Circle())
                }

                Button {
                    vm.activeTeamId = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Color.white.opacity(0.75))
                        .padding(7)
                        .background(Color.white.opacity(0.1))
                        .clipShape(Circle())
                }
            }

            Divider()
                .background(Color.white.opacity(0.12))

            // Hero Team Name
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("TEAM NAME")
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(1.0)
                        .foregroundColor(emeraldColor)

                    if let statusMsg = vm.bannerStatusText {
                        Text("• \(statusMsg)")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color.white.opacity(0.8))
                    }
                }

                Text(team.displayTeamName)
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Two-Column Pool & Court Assignment Callout Tiles
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("POOL ASSIGNMENT")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Color.white.opacity(0.55))
                    Text(team.poolName)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundColor(.white)
                    Text(team.division)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.6))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.black.opacity(0.35))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))

                Button {
                    editingDivisionTarget = EditingDivisionTarget(division: team.division)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text("ASSIGNED COURT")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(emeraldColor.opacity(0.9))
                            Spacer()
                            Image(systemName: "pencil")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(emeraldColor)
                        }
                        HStack(spacing: 4) {
                            Image(systemName: "mappin.and.ellipse")
                                .font(.system(size: 13, weight: .bold))
                            Text("Court \(team.courts)")
                                .font(.system(size: 16, weight: .heavy))
                        }
                        .foregroundColor(emeraldColor)

                        Text("Div Courts \(divCourts)")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(emeraldColor.opacity(0.75))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(emeraldColor.opacity(0.12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(emeraldColor.opacity(0.45), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }

            // Interactive Partner Check-In Cards
            VStack(alignment: .leading, spacing: 6) {
                Text("PLAYERS (\(checkedPlayers) OF \(team.players.count) CHECKED IN)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Color.white.opacity(0.55))

                HStack(spacing: 8) {
                    ForEach(team.players) { player in
                        Button {
                            vm.togglePlayerCheckIn(teamId: team.id, playerId: player.id)
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: player.checkedIn ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(player.checkedIn ? emeraldColor : Color.white.opacity(0.5))

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(player.name)
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundColor(.white)
                                        .lineLimit(1)
                                    Text(player.checkedIn ? "Checked In ✓" : "Tap to check in")
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundColor(player.checkedIn ? emeraldColor : Color.white.opacity(0.55))
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 9)
                            .background(player.checkedIn ? emeraldColor.opacity(0.2) : Color.white.opacity(0.08))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(player.checkedIn ? emeraldColor.opacity(0.7) : Color.white.opacity(0.14), lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Primary Full-Team Check-In Button
            Button {
                vm.toggleFullTeamCheckIn(teamId: team.id)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: team.status == .checkedIn ? "checkmark.circle.fill" : "checkmark.circle")
                        .font(.system(size: 16, weight: .bold))
                    Text(team.status == .checkedIn ? "Full Team Checked In ✓" : "Mark Full Team Checked In")
                        .font(.system(size: 15, weight: .heavy))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(team.status == .checkedIn ? emeraldColor : Color.white)
                .foregroundColor(.black)
                .clipShape(RoundedRectangle(cornerRadius: 13))
            }
        }
        .padding(16)
        .background(darkHeaderColor)
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(emeraldColor.opacity(0.85), lineWidth: 2)
        )
    }

    // MARK: - Pool Card & Team Rows
    private func poolSectionCard(section: PoolGroupSection) -> some View {
        let checkedCount = section.teams.filter { $0.status == .checkedIn }.count
        let isPoolReady = !section.teams.isEmpty && checkedCount == section.teams.count

        return VStack(spacing: 0) {
            // Section Header
            HStack {
                Button {
                    editingDivisionTarget = EditingDivisionTarget(division: section.division)
                } label: {
                    HStack(spacing: 3) {
                        Text(section.division)
                        Image(systemName: "pencil")
                    }
                    .font(.system(size: 11, weight: .heavy))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.indigo.opacity(0.15))
                    .foregroundColor(.indigo)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                Text(section.poolName)
                    .font(.system(size: 15, weight: .bold))

                if !section.courtsLabel.isEmpty && section.courtsLabel != "-" {
                    Button {
                        editingDivisionTarget = EditingDivisionTarget(division: section.division)
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "mappin.and.ellipse")
                                .font(.system(size: 10))
                            Text("Court \(section.courtsLabel)")
                                .font(.system(size: 11, weight: .bold))
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(darkHeaderColor)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                    }
                }

                Spacer()

                Text(isPoolReady ? "Court Ready (\(checkedCount)/\(section.teams.count)) ✓" : "\(checkedCount)/\(section.teams.count) Ready")
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(isPoolReady ? emeraldColor : Color(UIColor.secondarySystemBackground))
                    .foregroundColor(isPoolReady ? .black : .secondary)
                    .clipShape(Capsule())
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(isPoolReady ? emeraldColor.opacity(0.12) : Color(UIColor.secondarySystemBackground).opacity(0.6))

            Divider()

            ForEach(section.teams) { team in
                teamRowView(team: team)
                if team.id != section.teams.last?.id {
                    Divider()
                }
            }
        }
        .background(Color(UIColor.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(UIColor.separator).opacity(0.35), lineWidth: 1)
        )
    }

    private func teamRowView(team: TeamEntry) -> some View {
        let isFull = team.status == .checkedIn
        let isPartial = team.status == .partial
        let isActive = vm.activeTeamId == team.id

        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(team.division)
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.indigo.opacity(0.12))
                            .foregroundColor(.indigo)
                            .clipShape(RoundedRectangle(cornerRadius: 5))

                        if isFull {
                            Text("Checked In ✓")
                                .font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(emeraldColor.opacity(0.2))
                                .foregroundColor(Color(red: 0.02, green: 0.45, blue: 0.30))
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                        } else if isPartial {
                            Text("1/2 Arrived")
                                .font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.orange.opacity(0.2))
                                .foregroundColor(.orange)
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                        }

                        Button {
                            editingTeam = team
                        } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                        }
                    }

                    // Prominent CSV Team Name
                    Text(team.displayTeamName)
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundColor(.primary)

                    HStack(spacing: 4) {
                        Text("\(team.division) • \(team.poolName) • Court \(team.courts)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.secondary)
                        if let divCourts = team.divisionCourts, divCourts != team.courts {
                            Text("(Div Ct \(divCourts))")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.secondary)
                        }
                    }

                    if let notes = team.notes, !notes.isEmpty {
                        Text("Note: \(notes)")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // 1-Tap Full Team Check-In Button
                Button {
                    vm.toggleFullTeamCheckIn(teamId: team.id)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: isFull ? "checkmark.circle.fill" : "person.crop.circle.badge.checkmark")
                        Text(isFull ? "Checked In" : "Check In Team")
                    }
                    .font(.system(size: 13, weight: .bold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        isFull
                            ? emeraldColor.opacity(0.2)
                            : (isPartial ? Color.orange : darkHeaderColor)
                    )
                    .foregroundColor(
                        isFull
                            ? Color(red: 0.02, green: 0.40, blue: 0.25)
                            : (isPartial ? .black : .white)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 11))
                }
            }

            // Individual Partner Check-In Chips
            HStack(spacing: 8) {
                ForEach(team.players) { player in
                    Button {
                        vm.togglePlayerCheckIn(teamId: team.id, playerId: player.id)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: player.checkedIn ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 14))
                            Text(player.name)
                                .font(.system(size: 13, weight: .semibold))
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 11)
                        .padding(.vertical, 8)
                        .background(
                            player.checkedIn
                                ? emeraldColor
                                : Color(UIColor.secondarySystemBackground)
                        )
                        .foregroundColor(player.checkedIn ? .black : .primary)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
        }
        .padding(14)
        .background(
            isActive
                ? emeraldColor.opacity(0.08)
                : (isFull ? emeraldColor.opacity(0.04) : Color(UIColor.systemBackground))
        )
        .contentShape(Rectangle())
        .onTapGesture {
            vm.activeTeamId = team.id
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.2.slash")
                .font(.system(size: 36))
                .foregroundColor(.secondary)
            Text("No Matching Teams")
                .font(.headline)
            Button("Reset Search & Filter") {
                vm.searchQuery = ""
                vm.statusFilter = .all
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

// MARK: - Edit Division Courts Sheet (e.g. Select Court 1-7 for Coed Intermediate)
struct EditDivisionCourtsSheet: View {
    @ObservedObject var vm: CheckInViewModel
    let initialDivision: String
    @Environment(\.dismiss) private var dismiss

    @State private var currentDivision: String = ""
    @State private var startCourt: Int = 1
    @State private var endCourt: Int = 7
    @State private var totalCourtsInput: Int = 18
    @State private var anchorCourt: Int?

    private let emeraldColor = Color(red: 0.06, green: 0.73, blue: 0.51)

    private func loadBounds(for divName: String) {
        if let summary = vm.divisionsList.first(where: { $0.division == divName }) {
            let nums = summary.courtLabel
                .components(separatedBy: CharacterSet(charactersIn: "-, "))
                .compactMap { Int($0) }
                .filter { $0 > 0 }
            if let minC = nums.min(), let maxC = nums.max() {
                startCourt = minC
                endCourt = maxC
                return
            }
        }
        startCourt = 1
        endCourt = 7
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Auto-Assign by Total Available Courts") {
                    Stepper(
                        "Total Courts Available: \(totalCourtsInput)",
                        value: $totalCourtsInput,
                        in: 1...60
                    )
                    .font(.subheadline.bold())

                    Button {
                        vm.autoAssignAllCourts(totalCourts: totalCourtsInput)
                        loadBounds(for: currentDivision)
                    } label: {
                        Label(
                            "Auto-Assign \(totalCourtsInput) Courts Across \(vm.divisionsList.count) Divisions (\(vm.teams.count) Teams)",
                            systemImage: "wand.and.stars"
                        )
                        .font(.subheadline.bold())
                    }
                }

                Section("Select Division to Edit") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(vm.divisionsList) { div in
                                let active = div.division == currentDivision
                                Button {
                                    currentDivision = div.division
                                    anchorCourt = nil
                                    loadBounds(for: div.division)
                                } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(div.division)
                                            .font(.system(size: 13, weight: .bold))
                                        Text("\(div.total) teams • Ct \(div.courtLabel)")
                                            .font(.system(size: 11, weight: .semibold))
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(active ? emeraldColor : Color(UIColor.secondarySystemBackground))
                                    .foregroundColor(active ? .black : .primary)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Assigned Courts for \(currentDivision)") {
                    let s = min(startCourt, endCourt)
                    let e = max(startCourt, endCourt)
                    let rangeLabel = CSVHelper.formatCourtRangeLabel(startCourt: s, endCourt: e)

                    HStack {
                        Text("Selected Range")
                            .font(.subheadline.bold())
                        Spacer()
                        Text("Court \(rangeLabel) (\(e - s + 1) courts)")
                            .font(.headline)
                            .foregroundColor(Color(red: 0.02, green: 0.55, blue: 0.38))
                    }

                    Stepper("From Court: \(startCourt)", value: $startCourt, in: 1...60) { _ in
                        if startCourt > endCourt { endCourt = startCourt }
                    }
                    Stepper("To Court: \(endCourt)", value: $endCourt, in: 1...60) { _ in
                        if endCourt < startCourt { startCourt = endCourt }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        if let anchor = anchorCourt {
                            Text("Now tap the end court (started at Court \(anchor))...")
                                .font(.caption.bold())
                                .foregroundColor(Color(red: 0.02, green: 0.55, blue: 0.38))
                        } else {
                            Text("Or tap a start court then end court below (e.g. tap 1 then tap 7):")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        let maxCourt = max(totalCourtsInput, endCourt, 18)
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
                            ForEach(1...maxCourt, id: \.self) { num in
                                let inRange = num >= s && num <= e
                                let isEnd = num == s || num == e

                                Button {
                                    if let anchor = anchorCourt {
                                        startCourt = min(anchor, num)
                                        endCourt = max(anchor, num)
                                        anchorCourt = nil
                                    } else {
                                        anchorCourt = num
                                        startCourt = num
                                        endCourt = num
                                    }
                                } label: {
                                    Text("Ct \(num)")
                                        .font(.system(size: 12, weight: .bold))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 10)
                                        .background(
                                            isEnd
                                                ? emeraldColor
                                                : (inRange ? emeraldColor.opacity(0.25) : Color(UIColor.secondarySystemBackground))
                                        )
                                        .foregroundColor(isEnd ? .black : .primary)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Assign Division Courts")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                currentDivision = initialDivision
                totalCourtsInput = vm.totalCourtsAvailable
                loadBounds(for: initialDivision)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save Courts") {
                        let s = min(startCourt, endCourt)
                        let e = max(startCourt, endCourt)
                        vm.assignCourtsToDivision(division: currentDivision, startCourt: s, endCourt: e)
                        vm.selectedDivision = currentDivision
                        dismiss()
                    }
                    .fontWeight(.bold)
                }
            }
        }
    }
}

// MARK: - Import CSVs or Folder Sheet
struct ImportCSVSheet: View {
    @ObservedObject var vm: CheckInViewModel
    @Binding var importReplaceMode: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var sheetPickerMode: DocumentPickerMode?
    @State private var pasteDivision = "Coed Intermediate"
    @State private var pasteText = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Tournament Courts Available") {
                    Stepper(
                        "Total Courts Available: \(vm.totalCourtsAvailable)",
                        value: $vm.totalCourtsAvailable,
                        in: 1...60
                    )
                    Text("Courts 1–\(vm.totalCourtsAvailable) will be assigned across divisions based on how many teams each division has.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section("Import Mode") {
                    Picker("When importing:", selection: $importReplaceMode) {
                        Text("Add / Merge Divisions").tag(false)
                        Text("Replace All Rosters").tag(true)
                    }
                    .pickerStyle(.segmented)
                }

                Section("Select CSV Files or Folder from iPhone") {
                    Button {
                        sheetPickerMode = .csvFiles
                    } label: {
                        Label("Select One or Multiple .CSV Files", systemImage: "doc.badge.plus")
                            .font(.headline)
                    }

                    Button {
                        sheetPickerMode = .folder
                    } label: {
                        Label("Select a Folder of CSV Files", systemImage: "folder.badge.plus")
                            .font(.headline)
                    }

                    Text("Each CSV filename automatically sets the Division (e.g., Coed Intermediate _Sign-In.csv → Coed Intermediate).")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section("Or Paste CSV Text Directly") {
                    TextField("Division Name (e.g. Coed Intermediate)", text: $pasteDivision)
                    TextEditor(text: $pasteText)
                        .frame(minHeight: 110)
                        .font(.system(size: 12, design: .monospaced))

                    Button("Load Pasted CSV into \"\(pasteDivision)\"") {
                        let div = pasteDivision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "General" : pasteDivision
                        let parsed = CSVHelper.parseTournamentCSV(pasteText, defaultDivision: div)
                        if !parsed.isEmpty {
                            let combined: [TeamEntry]
                            if importReplaceMode {
                                combined = parsed
                            } else {
                                let kept = vm.teams.filter { $0.division != div }
                                combined = kept + parsed
                            }
                            vm.teams = CSVHelper.autoAssignCourtsByTeamCount(teams: combined, totalCourts: vm.totalCourtsAvailable)
                            vm.selectedDivision = div
                            vm.activeTeamId = vm.teams.first(where: { $0.division == div })?.id
                            dismiss()
                        } else {
                            vm.alertMessage = "Could not parse any valid rows from pasted CSV."
                        }
                    }
                    .disabled(pasteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Section {
                    Button("Restore Starter Divisions") {
                        vm.restoreDefaultRosters()
                        dismiss()
                    }
                }
            }
            .navigationTitle("Load Tournament CSVs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .sheet(item: $sheetPickerMode) { mode in
                DocumentPickerView(
                    mode: mode,
                    onPick: { urls in
                        sheetPickerMode = nil
                        vm.importURLs(urls, replaceAll: importReplaceMode)
                        dismiss()
                    },
                    onCancel: {
                        sheetPickerMode = nil
                    }
                )
                .ignoresSafeArea()
            }
        }
    }
}

// MARK: - Edit Team Sheet
struct EditTeamSheet: View {
    @ObservedObject var vm: CheckInViewModel
    let team: TeamEntry
    @Environment(\.dismiss) private var dismiss

    @State private var division = ""
    @State private var poolName = ""
    @State private var courts = ""
    @State private var rawTeamName = ""
    @State private var player1 = ""
    @State private var player2 = ""
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Team & Division") {
                    TextField("Division", text: $division)
                    TextField("Team Name (CSV Display)", text: $rawTeamName)
                    TextField("Pool Name", text: $poolName)
                    TextField("Court #", text: $courts)
                }

                Section("Individual Players") {
                    TextField("Player 1", text: $player1)
                    TextField("Player 2", text: $player2)
                }

                Section("Notes") {
                    TextField("Notes (e.g. Paid Venmo, running late)", text: $notes)
                }

                Section {
                    Button("Remove Team", role: .destructive) {
                        vm.teams.removeAll { $0.id == team.id }
                        dismiss()
                    }
                }
            }
            .navigationTitle("Edit Team")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                division = team.division
                poolName = team.poolName
                courts = team.courts
                rawTeamName = team.rawTeamName
                player1 = team.players.first?.name ?? ""
                player2 = team.players.dropFirst().first?.name ?? ""
                notes = team.notes ?? ""
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let idx = vm.teams.firstIndex(where: { $0.id == team.id }) else { return }
                        var updated = vm.teams[idx]
                        updated.division = division.isEmpty ? "General" : division
                        updated.poolName = poolName.isEmpty ? "Pool 1" : poolName
                        updated.courts = courts.isEmpty ? "-" : courts
                        updated.rawTeamName = rawTeamName.isEmpty ? "\(player1) / \(player2)" : rawTeamName
                        if !updated.players.isEmpty {
                            updated.players[0].name = player1.isEmpty ? "Player 1" : player1
                        }
                        if updated.players.count > 1 {
                            updated.players[1].name = player2.isEmpty ? "Player 2" : player2
                        }
                        updated.notes = notes.isEmpty ? nil : notes
                        vm.teams[idx] = updated
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Save & Manage Tournaments Sheet
struct SaveTournamentSheet: View {
    @ObservedObject var vm: CheckInViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var nameInput: String = ""

    private let emeraldColor = Color(red: 0.06, green: 0.73, blue: 0.51)

    var body: some View {
        NavigationStack {
            Form {
                Section("Auto-Save Status") {
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundColor(emeraldColor)
                            .font(.system(size: 22))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Tournament Automatically Saved on Device")
                                .font(.system(size: 14, weight: .bold))
                            Text("\(vm.divisionsList.count) Divisions • \(vm.teams.count) Teams • \(vm.totalCourtsAvailable) Courts • Saved \(vm.lastSavedAt.formatted(date: .omitted, time: .shortened))")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Section("Tournament Name & Save") {
                    TextField("Tournament Name", text: $nameInput)
                        .font(.system(size: 15, weight: .semibold))

                    Button {
                        vm.saveTournamentSnapshot(name: nameInput, asNew: false)
                        dismiss()
                    } label: {
                        Label("Save Current Tournament", systemImage: "externaldrive.fill.badge.checkmark")
                            .font(.headline)
                    }

                    Button {
                        vm.saveTournamentSnapshot(name: nameInput, asNew: true)
                        dismiss()
                    } label: {
                        Label("Save as New Tournament Copy", systemImage: "plus.square.on.square")
                    }
                }

                Section("Saved Tournaments (\(vm.savedTournaments.count))") {
                    ForEach(vm.savedTournaments) { item in
                        let isCurrent = item.id == vm.activeSavedTournamentId
                        let checkedCount = item.teams.filter { $0.status == .checkedIn }.count
                        let divCount = Set(item.teams.map { $0.division }).count

                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(item.name)
                                        .font(.system(size: 14, weight: .bold))
                                    if isCurrent {
                                        Text("Active")
                                            .font(.system(size: 10, weight: .heavy))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(emeraldColor)
                                            .foregroundColor(.black)
                                            .clipShape(Capsule())
                                    }
                                }
                                Text("\(divCount) Div • \(checkedCount)/\(item.teams.count) Checked In • \(item.totalCourtsAvailable) Courts")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text("Saved \(item.savedAt.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            if !isCurrent {
                                Button("Load") {
                                    vm.loadSavedTournament(item)
                                    dismiss()
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(emeraldColor)
                                .foregroundColor(.black)
                                .font(.caption.bold())
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            if vm.savedTournaments.count > 1 {
                                Button(role: .destructive) {
                                    vm.deleteSavedTournament(id: item.id)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Save Tournament")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                nameInput = vm.tournamentName
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        vm.saveTournamentSnapshot(name: nameInput, asNew: false)
                        dismiss()
                    }
                    .fontWeight(.bold)
                }
            }
        }
    }
}

