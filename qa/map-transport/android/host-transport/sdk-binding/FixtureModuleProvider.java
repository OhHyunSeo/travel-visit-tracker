package app.trippainting.maptransportqa;

import java.util.Objects;
import org.maplibre.android.LibraryLoaderProvider;
import org.maplibre.android.MapLibre;
import org.maplibre.android.ModuleProvider;
import org.maplibre.android.http.HttpRequest;

/** Installs the synthetic transport during startup of an isolated QA process. */
final class FixtureModuleProvider implements ModuleProvider {
  private final ModuleProvider previous;
  private final FixtureHttpClient client;

  private FixtureModuleProvider(ModuleProvider previous, FixtureHttpClient client) {
    this.previous = previous;
    this.client = client;
  }

  static void install(FixtureHttpClient client) {
    Objects.requireNonNull(client, "Fixture HTTP client");
    synchronized (MapLibre.class) {
      if (MapLibre.hasInstance()) throw new IllegalStateException("Install before MapLibre initialization");
      ModuleProvider previous = MapLibre.getModuleProvider();
      if (previous instanceof FixtureModuleProvider) throw new IllegalStateException("Fixture provider already installed");
      MapLibre.setModuleProvider(new FixtureModuleProvider(previous, client));
    }
  }

  @Override public HttpRequest createHttpRequest() {
    return new FixtureMapLibreRequest(client);
  }

  @Override public LibraryLoaderProvider createLibraryLoaderProvider() {
    return previous.createLibraryLoaderProvider();
  }
}
