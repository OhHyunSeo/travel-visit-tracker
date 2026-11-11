package app.trippainting.maptransportqa;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.nio.file.attribute.FileTime;
import java.util.Arrays;
import java.util.zip.CRC32;

/** Locked append journal. Every complete reservation is forced before send. */
final class FixtureBudgetJournal implements AutoCloseable {
  private static final int HEADER_BYTES = 28;
  private static final int RECORD_BYTES = 24;
  private final Path file;
  private final FileChannel channel;
  private final FileLock lock;
  private final Object identity;
  private final int maxAttempts;
  private final int maxTiles;
  private final int reservation;
  private final long maxBytes;
  private int attempts;
  private int tiles;
  private long bytes;
  private long expectedSize;
  private FileTime expectedModified;

  private FixtureBudgetJournal(Path file, FileChannel channel, FileLock lock, Object identity,
      int maxAttempts, int maxTiles, int reservation, long maxBytes) {
    this.file = file;
    this.channel = channel;
    this.lock = lock;
    this.identity = identity;
    this.maxAttempts = maxAttempts;
    this.maxTiles = maxTiles;
    this.reservation = reservation;
    this.maxBytes = maxBytes;
  }

  static FixtureBudgetJournal open(Path directory, int maxAttempts, int maxTiles, int reservation, long maxBytes)
      throws IOException {
    Path root = directory.toAbsolutePath().normalize();
    if (!root.equals(root.toRealPath()) || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)
        || !Files.getPosixFilePermissions(root).equals(PosixFilePermissions.fromString("rwx------"))) {
      throw new IOException("Fixture journal requires a canonical private directory");
    }
    Path file = root.resolve("budget.journal");
    boolean created = false;
    try {
      Files.createFile(file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
      created = true;
    } catch (java.nio.file.FileAlreadyExistsException existing) {
      // Existing bytes must validate. An empty or torn journal stays blocked.
    }
    BasicFileAttributes before = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    if (!before.isRegularFile() || before.fileKey() == null
        || !Files.getPosixFilePermissions(file, LinkOption.NOFOLLOW_LINKS).equals(PosixFilePermissions.fromString("rw-------"))
        || ((Number) Files.getAttribute(file, "unix:nlink", LinkOption.NOFOLLOW_LINKS)).longValue() != 1) {
      throw new IOException("Fixture journal requires one private regular file");
    }
    FileChannel channel = FileChannel.open(file, StandardOpenOption.READ, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
    try {
      FileLock lock;
      try {
        lock = channel.tryLock();
      } catch (OverlappingFileLockException error) {
        throw new IOException("Fixture journal already in use", error);
      }
      if (lock == null) throw new IOException("Fixture journal already in use");
      FixtureBudgetJournal journal = new FixtureBudgetJournal(file, channel, lock, before.fileKey(),
          maxAttempts, maxTiles, reservation, maxBytes);
      journal.identity();
      byte[] header = checked(ByteBuffer.allocate(HEADER_BYTES).putInt(0x54504231).putInt(maxAttempts)
          .putInt(maxTiles).putInt(reservation).putLong(maxBytes));
      if (created) {
        write(channel, header);
        channel.force(true);
        // Persist the new directory entry as well as the file contents.
        try (FileChannel parent = FileChannel.open(root, StandardOpenOption.READ)) {
          parent.force(true);
        }
      }
      long size = channel.size();
      if (size < HEADER_BYTES || size > HEADER_BYTES + (long) maxAttempts * RECORD_BYTES
          || (size - HEADER_BYTES) % RECORD_BYTES != 0) throw new IOException("Invalid fixture journal length");
      channel.position(0);
      if (!Arrays.equals(read(channel, HEADER_BYTES), header)) throw new IOException("Fixture journal limits or header differ");
      while (channel.position() < size) journal.replay(read(channel, RECORD_BYTES));
      journal.expectedSize = size;
      journal.expectedModified = journal.identity().lastModifiedTime();
      return journal;
    } catch (IOException | RuntimeException error) {
      channel.close();
      throw error;
    }
  }

  private static byte[] checked(ByteBuffer value) {
    CRC32 crc = new CRC32();
    crc.update(value.array(), 0, value.capacity() - Integer.BYTES);
    value.putInt((int) crc.getValue());
    return value.array();
  }

  private static byte[] read(FileChannel channel, int length) throws IOException {
    ByteBuffer value = ByteBuffer.allocate(length);
    while (value.hasRemaining()) {
      if (channel.read(value) <= 0) throw new IOException("Incomplete fixture journal read");
    }
    return value.array();
  }

  private static void write(FileChannel channel, byte[] bytes) throws IOException {
    ByteBuffer value = ByteBuffer.wrap(bytes);
    while (value.hasRemaining()) {
      if (channel.write(value) <= 0) throw new IOException("Incomplete fixture journal write");
    }
  }

  private BasicFileAttributes identity() throws IOException {
    BasicFileAttributes actual = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    if (!actual.isRegularFile() || !identity.equals(actual.fileKey())
        || !Files.getPosixFilePermissions(file, LinkOption.NOFOLLOW_LINKS).equals(PosixFilePermissions.fromString("rw-------"))
        || ((Number) Files.getAttribute(file, "unix:nlink", LinkOption.NOFOLLOW_LINKS)).longValue() != 1) {
      throw new IOException("Fixture journal identity changed");
    }
    return actual;
  }

  private void replay(byte[] data) throws IOException {
    ByteBuffer record = ByteBuffer.wrap(data);
    int sequence = record.getInt();
    int kind = record.getInt();
    long totalBytes = record.getLong();
    int totalTiles = record.getInt();
    CRC32 crc = new CRC32();
    crc.update(data, 0, RECORD_BYTES - Integer.BYTES);
    if (record.getInt() != (int) crc.getValue() || kind < 0 || kind >= FixtureRequestPolicy.Kind.values().length
        || sequence != attempts + 1 || sequence > maxAttempts || totalBytes != bytes + reservation || totalBytes > maxBytes
        || totalTiles != tiles + (kind == FixtureRequestPolicy.Kind.TILE.ordinal() ? 1 : 0) || totalTiles > maxTiles) {
      throw new IOException("Invalid fixture reservation record");
    }
    attempts = sequence;
    tiles = totalTiles;
    bytes = totalBytes;
  }

  void append(FixtureRequestPolicy.Kind kind) throws IOException {
    BasicFileAttributes before = identity();
    if (!lock.isValid() || channel.size() != expectedSize || !before.lastModifiedTime().equals(expectedModified)) {
      throw new IOException("Fixture journal changed size, modification time or lock");
    }
    byte[] record = checked(ByteBuffer.allocate(RECORD_BYTES).putInt(attempts + 1).putInt(kind.ordinal())
        .putLong(bytes + reservation).putInt(tiles + (kind == FixtureRequestPolicy.Kind.TILE ? 1 : 0)));
    channel.position(expectedSize);
    write(channel, record);
    channel.force(true);
    expectedModified = identity().lastModifiedTime();
    expectedSize += RECORD_BYTES;
    if (channel.size() != expectedSize) throw new IOException("Fixture journal changed during reservation");
    replay(record);
  }

  FixtureBudget.Snapshot snapshot() {
    return new FixtureBudget.Snapshot(attempts, tiles, bytes);
  }

  @Override public void close() throws IOException {
    channel.close();
  }
}
