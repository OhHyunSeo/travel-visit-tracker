package app.trippainting.maptransportqa;

import android.app.Application;
import android.util.Log;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.concurrent.atomic.AtomicInteger;
import org.maplibre.android.MapLibre;
import org.maplibre.android.storage.FileSource;

/** Startup owner for the separately packaged, localhost-only Android fixture. */
public final class FixtureApplication extends Application {
  static final String APPLICATION_ID = "app.trippainting.maptransportqa.sdk";
  static final String LOG_TAG = "TripMapSdkFixture";
  private String styleUrl;
  private FixtureBudget budget;
  private final AtomicInteger transportCalls = new AtomicInteger();

  @Override public void onCreate() {
    super.onCreate();
    FixtureHttpClient client = null;
    try {
      if (!APPLICATION_ID.equals(getPackageName()) || MapLibre.hasInstance()) {
        throw new IOException("Fixture requires its own package before MapLibre startup");
      }
      int port = Integer.parseInt(new String(asset("fixture-port", 5), StandardCharsets.US_ASCII));
      if (port < 1024 || port > 65535) throw new IOException("Invalid fixture port");
      X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
          .generateCertificate(new ByteArrayInputStream(asset("fixture.der", 16_384)));
      Path files = getFilesDir().toPath().toRealPath();
      Path journal = files.resolve("transport-budget");
      try {
        Files.createDirectory(journal, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
      } catch (FileAlreadyExistsException existing) {
        // Reopen the same reservation journal for this package.
      }
      budget = FixtureBudget.open(journal, 16, 8, 4_096, 65_536);
      client = FixtureHttpClient.https(port, chain -> {
        transportCalls.incrementAndGet();
        return chain.proceed(chain.request());
      }, budget, certificate);
      FixtureModuleProvider.install(client);
      Path resources = Path.of(FileSource.getResourcesCachePath(this)).toRealPath();
      if (!resources.startsWith(files)) throw new IOException("Fixture resources must stay in the package files directory");
      MapLibre.getInstance(this);
      styleUrl = "https://127.0.0.1:" + port + "/resource/style/sdk";
      Log.i(LOG_TAG, "TRANSPORT_READY");
    } catch (Exception | LinkageError failure) {
      if (client != null) {
        try { client.close(); } catch (IOException closeFailure) { failure.addSuppressed(closeFailure); }
      }
      if (budget != null) {
        try { budget.close(); } catch (IOException closeFailure) { failure.addSuppressed(closeFailure); }
      }
      Log.e(LOG_TAG, "TRANSPORT_STARTUP_FAILED", failure);
    }
  }

  private byte[] asset(String name, int limit) throws IOException {
    try (InputStream input = getAssets().open(name)) {
      byte[] bytes = input.readNBytes(limit + 1);
      if (bytes.length == 0 || bytes.length > limit) throw new IOException("Invalid fixture asset length");
      return bytes;
    }
  }

  String styleUrl() {
    return styleUrl;
  }

  void reportStyleLoaded() {
    FixtureBudget.Snapshot totals = budget.snapshot();
    Log.i(LOG_TAG, "STYLE_LOADED attempts=" + totals.attempts + " tiles=" + totals.tileAttempts
        + " reserved=" + totals.reservedBytes);
  }

  void reportReopenTransport() {
    reportTransport("REOPEN_TRANSPORT");
  }

  void reportTransport(String phase) {
    FixtureBudget.Snapshot totals = budget.snapshot();
    Log.i(LOG_TAG, phase + " calls=" + transportCalls.get() + " attempts=" + totals.attempts
        + " tiles=" + totals.tileAttempts + " reserved=" + totals.reservedBytes);
  }
}
