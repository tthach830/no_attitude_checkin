import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum DocumentPickerMode: String, Identifiable {
    case csvFiles
    case folder

    var id: String { rawValue }
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
    @State private var directPickerMode: DocumentPickerMode?
    @State private var showAddTeamSheet = false
    @State private var showExportSheet = false
    @State private var editingTeam: TeamEntry?
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
            .sheet(isPresented: $showAddTeamSheet) {
                AddTeamSheet(vm: vm)
            }
            .sheet(isPresented: $showExportSheet) {
                ExportCSVSheet(vm: vm)
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
                        Text("Tournament Check-In")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.white)

                        Text("\(vm.divisionsList.count) Div")
                            .font(.system(size: 11, weight: .bold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(emeraldColor.opacity(0.25))
                            .foregroundColor(emeraldColor)
                            .clipShape(Capsule())
                    }
                    Text("Tap CSVs to select files/folder or tap a team below")
                        .font(.system(size: 11))
                        .foregroundColor(Color.white.opacity(0.65))
                }

                Spacer()

                HStack(spacing: 6) {
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
                            Text("Upload CSVs")
                        }
                        .font(.system(size: 12, weight: .bold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(emeraldColor)
                        .foregroundColor(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }

            // Division Selector ScrollView
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(vm.divisionsList) { div in
                        divisionTabButton(
                            title: div.division,
                            countText: "\(div.checkedIn)/\(div.total)\(div.isAllReady ? " ✓" : "")",
                            isSelected: vm.selectedDivision == div.division,
                            isComplete: div.isAllReady
                        ) {
                            vm.selectedDivision = div.division
                            vm.selectedPoolKey = "ALL"
                            if let firstInDiv = vm.teams.first(where: { $0.division == div.division }) {
                                vm.activeTeamId = firstInDiv.id
                            }
                        }
                    }
                }
            }

            // Progress Bar Box
            VStack(spacing: 6) {
                HStack {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(emeraldColor)
                            .frame(width: 8, height: 8)
                        Text("\(vm.selectedDivision == "ALL" ? "All Divisions" : vm.selectedDivision): \(vm.fullTeamsCount)/\(vm.totalTeamsCount) Teams Checked In")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white)
                    }

                    if vm.partialTeamsCount > 0 {
                        Text("• \(vm.partialTeamsCount) Partial")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.yellow)
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

    private func divisionTabButton(
        title: String,
        countText: String,
        isSelected: Bool,
        isComplete: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                Text(countText)
                    .font(.system(size: 11, weight: .heavy))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(isSelected ? Color.black.opacity(0.2) : Color.white.opacity(0.15))
                    .clipShape(Capsule())
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                isSelected
                    ? emeraldColor
                    : (isComplete ? emeraldColor.opacity(0.25) : Color.white.opacity(0.1))
            )
            .foregroundColor(isSelected ? .black : .white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    // MARK: - Search & Filter Subbar
    private var searchAndFilterSection: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                    .font(.system(size: 14))
                TextField("Search team name, player, division, pool...", text: $vm.searchQuery)
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

    // MARK: - Now Checking In Spotlight Card
    private func nowCheckingInSpotlight(team: TeamEntry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.seal.fill")
                    Text("NOW CHECKING IN")
                }
                .font(.system(size: 11, weight: .heavy))
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(emeraldColor)
                .foregroundColor(.black)
                .clipShape(Capsule())

                Text("Division: \(team.division)")
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Color.indigo.opacity(0.35))
                    .foregroundColor(.white)
                    .clipShape(Capsule())

                Spacer()

                Button {
                    vm.activeTeamId = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(Color.white.opacity(0.6))
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("TEAM NAME (FROM CSV)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Color.white.opacity(0.6))

                Text(team.displayTeamName)
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundColor(.white)
            }

            if let statusMsg = vm.bannerStatusText {
                Text(statusMsg)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(emeraldColor)
            }

            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Text(team.division)
                        .foregroundColor(Color.indigo.opacity(0.9))
                    Text("•")
                        .foregroundColor(.gray)
                    Text(team.poolName)
                        .foregroundColor(.white)
                    Image(systemName: "arrow.right")
                        .foregroundColor(emeraldColor)
                    Text("Court \(team.courts)")
                        .foregroundColor(emeraldColor)
                }
                .font(.system(size: 13, weight: .bold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 10))

                Spacer()

                Button {
                    vm.toggleFullTeamCheckIn(teamId: team.id)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: team.status == .checkedIn ? "checkmark.circle.fill" : "person.2.fill")
                        Text(team.status == .checkedIn ? "Checked In ✓" : "Check In Team")
                    }
                    .font(.system(size: 13, weight: .bold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(team.status == .checkedIn ? emeraldColor : .white)
                    .foregroundColor(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(14)
        .background(darkHeaderColor)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(emeraldColor, lineWidth: 2)
        )
    }

    // MARK: - Pool Card & Team Rows
    private func poolSectionCard(section: PoolGroupSection) -> some View {
        let checkedCount = section.teams.filter { $0.status == .checkedIn }.count
        let isPoolReady = !section.teams.isEmpty && checkedCount == section.teams.count

        return VStack(spacing: 0) {
            // Section Header
            HStack {
                Text(section.division)
                    .font(.system(size: 11, weight: .heavy))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.indigo.opacity(0.15))
                    .foregroundColor(.indigo)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                Text(section.poolName)
                    .font(.system(size: 15, weight: .bold))

                if !section.courtsLabel.isEmpty && section.courtsLabel != "-" {
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

                    Text("\(team.division) • \(team.poolName) • Court \(team.courts)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.secondary)

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
            Button("Reset All Filters") {
                vm.searchQuery = ""
                vm.statusFilter = .all
                vm.selectedPoolKey = "ALL"
                vm.selectedDivision = "ALL"
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

// MARK: - Import CSVs or Folder Sheet
struct ImportCSVSheet: View {
    @ObservedObject var vm: CheckInViewModel
    @Binding var importReplaceMode: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var sheetPickerMode: DocumentPickerMode?
    @State private var pasteDivision = "Coed-Intermediate"
    @State private var pasteText = ""

    var body: some View {
        NavigationStack {
            Form {
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

                    Text("Each CSV filename automatically sets the Division (e.g., Men.csv → Men, Coed-Intermediate.csv → Coed-Intermediate). Sample CSV files are also saved in On My iPhone → Check-In.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section("Or Paste CSV Text Directly") {
                    TextField("Division Name (e.g. Men, Coed-Intermediate)", text: $pasteDivision)
                    TextEditor(text: $pasteText)
                        .frame(minHeight: 110)
                        .font(.system(size: 12, design: .monospaced))

                    Button("Load Pasted CSV into \"\(pasteDivision)\"") {
                        let div = pasteDivision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "General" : pasteDivision
                        let parsed = CSVHelper.parseTournamentCSV(pasteText, defaultDivision: div)
                        if !parsed.isEmpty {
                            if importReplaceMode {
                                vm.teams = parsed
                            } else {
                                let kept = vm.teams.filter { $0.division != div }
                                vm.teams = kept + parsed
                            }
                            vm.selectedDivision = div
                            vm.activeTeamId = parsed.first?.id
                            dismiss()
                        } else {
                            vm.alertMessage = "Could not parse any valid rows from pasted CSV."
                        }
                    }
                    .disabled(pasteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Section {
                    Button("Restore Starter Divisions (Coed-Intermediate & Men)") {
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

// MARK: - Add Team Sheet
struct AddTeamSheet: View {
    @ObservedObject var vm: CheckInViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var division = "Coed-Intermediate"
    @State private var poolName = "Pool 1"
    @State private var courts = "1"
    @State private var player1 = ""
    @State private var player2 = ""
    @State private var checkInImmediately = true

    var body: some View {
        NavigationStack {
            Form {
                Section("Placement") {
                    TextField("Division (e.g., Men, Coed-Intermediate)", text: $division)
                    TextField("Pool Name (e.g., Pool 1)", text: $poolName)
                    TextField("Court #", text: $courts)
                }

                Section("Players") {
                    TextField("Player 1 Name", text: $player1)
                    TextField("Player 2 Name (Optional)", text: $player2)
                    Toggle("Mark Checked In Immediately", isOn: $checkInImmediately)
                }
            }
            .navigationTitle("Add Walk-In Team")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if vm.selectedDivision != "ALL" {
                    division = vm.selectedDivision
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        let p1 = player1.trimmingCharacters(in: .whitespacesAndNewlines)
                        let p2 = player2.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !p1.isEmpty else { return }
                        let rawName = p2.isEmpty ? p1 : "\(p1) / \(p2)"
                        let players = CSVHelper.parseTeamPlayers(rawTeamName: rawName, isCheckedInInit: checkInImmediately)
                        let newTeam = TeamEntry(
                            division: division.isEmpty ? "General" : division,
                            poolName: poolName.isEmpty ? "Pool 1" : poolName,
                            courts: courts.isEmpty ? "-" : courts,
                            rawTeamName: rawName,
                            players: players,
                            checkedInAt: checkInImmediately ? Date() : nil
                        )
                        vm.teams.append(newTeam)
                        vm.activeTeamId = newTeam.id
                        dismiss()
                    }
                    .disabled(player1.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
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

// MARK: - Export CSV Sheet
struct ExportCSVSheet: View {
    @ObservedObject var vm: CheckInViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Share / Export By Division") {
                    ForEach(vm.divisionsList) { div in
                        let divTeams = vm.teams.filter { $0.division == div.division }
                        let csvString = CSVHelper.exportCSV(teams: divTeams, includeDivision: false)
                        ShareLink(
                            item: csvString,
                            subject: Text("\(div.division) Check-In CSV"),
                            message: Text("\(div.checkedIn)/\(div.total) teams checked in for \(div.division)")
                        ) {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text("\(div.division).csv")
                                        .font(.headline)
                                    Text("\(div.checkedIn) / \(div.total) teams checked in")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Image(systemName: "square.and.arrow.up")
                            }
                        }
                    }
                }

                Section("Share All Divisions Combined") {
                    let allCSV = CSVHelper.exportCSV(teams: vm.teams, includeDivision: true)
                    ShareLink(
                        item: allCSV,
                        subject: Text("All Divisions Tournament Check-In CSV")
                    ) {
                        Label("Share Combined Tournament CSV", systemImage: "doc.on.doc")
                    }
                }
            }
            .navigationTitle("Export Check-In CSV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
