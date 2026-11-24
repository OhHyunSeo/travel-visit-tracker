import Darwin
import Foundation
import SQLite3

/// One download's limits. A caller may dispatch only one bounded exchange after each granted reservation.
final class TripPaintingMapRequestBudget: @unchecked Sendable {
  enum Opening {
    case newOperation, resumeOperation
  }

  struct Permit {
    fileprivate let id: UUID
    let url: URL
    let maximumBodyBytes: Int
    let kind: TripPaintingMapRequestScope.ResourceKind
  }

  struct ExchangeClaim {
    fileprivate let id: UUID
  }

  enum Decision {
    case reserved(Permit)
    case outsideScope, invalidReservation, busy, exhausted, unavailable
  }

  private struct Charges {
    let tileAttempts: Int
    let reservedBytes: Int
  }

  private enum Activity { case reserved, dispatched }

  private let scope: TripPaintingMapRequestScope
  private let identity: String
  private let database: BudgetDatabase
  private let lock = NSLock()
  private var active: [UUID: Activity] = [:]
  private var charges: Charges?

  init?(scope: TripPaintingMapRequestScope, directory: URL, opening: Opening) {
    guard let identity = scope.identityHash(), let database = BudgetDatabase.open(directory, opening: opening)
    else { return nil }
    if opening == .newOperation, !database.prepare(identity) { return nil }
    guard let charges = database.read(identity: identity, limits: scope.limits) else { return nil }
    self.scope = scope
    self.identity = identity
    self.database = database
    self.charges = charges
  }

  func reserve(_ request: URLRequest, maximumBodyBytes: Int) -> Decision {
    guard let url = request.url, let method = request.httpMethod,
          request.httpBody == nil, request.httpBodyStream == nil,
          let kind = scope.resourceKind(for: url.absoluteString, method: method)
    else { return .outsideScope }
    guard maximumBodyBytes > 0, maximumBodyBytes <= scope.limits.maxBodyBytes else { return .invalidReservation }

    lock.lock()
    defer { lock.unlock() }
    guard let previous = charges else { return .unavailable }
    guard active.count < scope.limits.maxConcurrentRequests else { return .busy }
    let countsAsTile = kind == .vectorTile || kind == .rasterTile
    let tileAttempts = previous.tileAttempts + (countsAsTile ? 1 : 0)
    guard tileAttempts <= scope.limits.maxTileAttempts,
          maximumBodyBytes <= scope.limits.maxBodyBytes - previous.reservedBytes
    else { return .exhausted }

    let next = Charges(tileAttempts: tileAttempts, reservedBytes: previous.reservedBytes + maximumBodyBytes)
    guard database.record(next, replacing: previous, identity: identity) else {
      // A failed ledger write can leave the charge uncertain. Refuse every later exchange in this instance.
      charges = nil
      return .unavailable
    }
    charges = next
    let permit = Permit(id: UUID(), url: url, maximumBodyBytes: maximumBodyBytes, kind: kind)
    active[permit.id] = .reserved
    return .reserved(permit)
  }

  func claimForExchange(_ permit: Permit) -> ExchangeClaim? {
    lock.lock()
    defer { lock.unlock() }
    guard charges != nil, active[permit.id] == .reserved else { return nil }
    active[permit.id] = .dispatched
    return ExchangeClaim(id: permit.id)
  }

  /// Abandon a reservation that has never started an exchange.
  func finish(_ permit: Permit) {
    lock.lock()
    defer { lock.unlock() }
    if active[permit.id] == .reserved { active.removeValue(forKey: permit.id) }
  }

  /// Only the connection owner can return the slot after terminal completion.
  func finish(_ claim: ExchangeClaim) {
    lock.lock()
    defer { lock.unlock() }
    if active[claim.id] == .dispatched { active.removeValue(forKey: claim.id) }
  }

  private final class BudgetDatabase {
    private let db: OpaquePointer
    private let fileLock: Int32

    private init(db: OpaquePointer, fileLock: Int32) {
      self.db = db
      self.fileLock = fileLock
    }

    deinit {
      sqlite3_close(db)
      close(fileLock)
    }

    static func open(_ directory: URL, opening: Opening) -> BudgetDatabase? {
      guard directory.isFileURL, !directory.path.utf8.contains(0),
            let canonicalDirectory = realpath(directory.path, nil)
      else { return nil }
      defer { free(canonicalDirectory) }
      let root = URL(fileURLWithPath: String(cString: canonicalDirectory), isDirectory: true)
      let ledger = root.appendingPathComponent("request-budget-v1.sqlite", isDirectory: false)
      let lockPath = root.appendingPathComponent("request-budget-v1.lock", isDirectory: false).path
      let flags = O_RDWR | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK
      let fd = openPrivateFile(lockPath, flags | (opening == .newOperation ? O_CREAT : 0))
      guard fd >= 0 else { return nil }
      var handle: OpaquePointer?
      var succeeded = false
      defer {
        if !succeeded {
          if let handle { sqlite3_close(handle) }
          close(fd)
        }
      }
      var info = stat()
      guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1,
            flock(fd, LOCK_EX | LOCK_NB) == 0
      else { return nil }

      if opening == .newOperation {
        // Claim a new empty file exclusively. An existing, even damaged ledger is never reset.
        let created = openPrivateFile(ledger.path, flags | O_CREAT | O_EXCL)
        guard created >= 0, close(created) == 0 else { return nil }
      }
      guard lstat(ledger.path, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1,
            sqlite3_open_v2(ledger.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOFOLLOW, nil) == SQLITE_OK,
            let db = handle,
            sqlite3_exec(db, "PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF", nil, nil, nil) == SQLITE_OK
      else { return nil }

      succeeded = true
      return BudgetDatabase(db: db, fileLock: fd)
    }

    private static func openPrivateFile(_ path: String, _ flags: Int32) -> Int32 {
      Darwin.open(path, flags, mode_t(S_IRUSR | S_IWUSR))
    }

    func prepare(_ identity: String) -> Bool {
      // The identity is a lowercase SHA-256 from the validated scope encoder.
      execute("""
        BEGIN IMMEDIATE;
        CREATE TABLE request_budget (
          slot INTEGER PRIMARY KEY CHECK (slot=1), scope_hash TEXT NOT NULL,
          tile_attempts INTEGER NOT NULL CHECK (tile_attempts >= 0),
          reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes >= tile_attempts)
        );
        INSERT INTO request_budget VALUES (1, '\(identity)', 0, 0);
        COMMIT;
        """)
    }

    func read(identity: String, limits: TripPaintingMapRequestScope.Limits) -> Charges? {
      var statement: OpaquePointer?
      defer { sqlite3_finalize(statement) }
      guard sqlite3_prepare_v2(db, "SELECT scope_hash, tile_attempts, reserved_bytes FROM request_budget WHERE slot=1",
                              -1, &statement, nil) == SQLITE_OK, sqlite3_step(statement) == SQLITE_ROW,
            sqlite3_column_type(statement, 0) == SQLITE_TEXT, let storedIdentity = sqlite3_column_text(statement, 0),
            sqlite3_column_bytes(statement, 0) == 64, String(cString: storedIdentity) == identity,
            sqlite3_column_type(statement, 1) == SQLITE_INTEGER, sqlite3_column_type(statement, 2) == SQLITE_INTEGER
      else { return nil }
      let tiles = Int(sqlite3_column_int64(statement, 1))
      let bytes = Int(sqlite3_column_int64(statement, 2))
      guard (0...limits.maxTileAttempts).contains(tiles), (tiles...limits.maxBodyBytes).contains(bytes),
            sqlite3_step(statement) == SQLITE_DONE
      else { return nil }
      return Charges(tileAttempts: tiles, reservedBytes: bytes)
    }

    func record(_ next: Charges, replacing expected: Charges, identity: String) -> Bool {
      execute("""
        UPDATE request_budget SET tile_attempts=\(next.tileAttempts), reserved_bytes=\(next.reservedBytes)
        WHERE slot=1 AND scope_hash='\(identity)'
          AND tile_attempts=\(expected.tileAttempts) AND reserved_bytes=\(expected.reservedBytes)
        """) && sqlite3_changes(db) == 1
    }

    private func execute(_ sql: String) -> Bool {
      sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
    }
  }
}
