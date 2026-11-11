package app.trippainting.maptransportqa;

import java.io.IOException;
import java.util.Set;
import java.util.regex.Pattern;
import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.Request;

/** Origin and resource policy for the loopback SDK fixture. */
final class FixtureRequestPolicy {
  enum Kind { STYLE, TILE, GLYPH, SPRITE }

  private static final String USER_AGENT = "TripPainting-Android-Map-QA/1";
  private static final Set<String> STYLES = Set.of(
      "/resource/style/sdk", "/resource/style/multi", "/resource/style/blocked",
      "/resource/style/held", "/resource/style/mixed", "/resource/style/empty");
  private static final Pattern TILE = Pattern.compile("/resource/tile/(?:[hm]_)?2_[0-3]_[0-3]");
  private static final Pattern SPRITE = Pattern.compile("/resource/sprite/mixed(?:@2x)?\\.(?:json|png)");

  private final int port;
  private final String scheme;

  FixtureRequestPolicy(int port) {
    this(port, "http");
  }

  FixtureRequestPolicy(int port, String scheme) {
    if (port < 1 || port > 65535) throw new IllegalArgumentException("Invalid fixture port");
    if (!"http".equals(scheme) && !"https".equals(scheme)) throw new IllegalArgumentException("Invalid fixture scheme");
    this.port = port;
    this.scheme = scheme;
  }

  Kind classify(Request request) throws IOException {
    HttpUrl url = request.url();
    if (!"GET".equals(request.method()) || request.body() != null || !scheme.equals(url.scheme())
        || !"127.0.0.1".equals(url.host()) || url.port() != port || !url.encodedUsername().isEmpty()
        || !url.encodedPassword().isEmpty() || url.encodedQuery() != null || url.encodedFragment() != null) {
      throw new IOException("Request is outside the fixture origin or request shape");
    }
    String path = url.encodedPath();
    if (STYLES.contains(path)) return Kind.STYLE;
    if ("/resource/tile/0_0_0".equals(path) || TILE.matcher(path).matches()) return Kind.TILE;
    if ("/resource/glyph/QA/0-255.pbf".equals(path)) return Kind.GLYPH;
    if (SPRITE.matcher(path).matches()) return Kind.SPRITE;
    throw new IOException("Resource is outside the fixture allowlist");
  }

  Request prepare(Request transformed) throws IOException {
    classify(transformed);
    return transformed.newBuilder().headers(Headers.of(
        "User-Agent", USER_AGENT, "Accept-Encoding", "identity")).build();
  }
}
