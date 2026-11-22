package app.trippainting.maptransportqa;

import java.io.IOException;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.regex.Matcher;
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
  private static final Pattern ETAG = Pattern.compile("(?:W/)?\"[\\x21\\x23-\\x7e]{0,120}\"");
  private static final Pattern HTTP_DATE = Pattern.compile("[A-Z][a-z]{2}, [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT");
  private static final String DECIMAL = "(?:0|[1-9][0-9]{0,18})";
  private static final Pattern RANGE = Pattern.compile("bytes=(" + DECIMAL + ")-(" + DECIMAL + ")");
  private static final Pattern RESOURCE_LENGTH = Pattern.compile(DECIMAL);

  static final class ByteRange {
    private final long first;
    private final long last;
    final int length;

    private ByteRange(long first, long last) {
      if (last < first || last - first >= 65_536) throw new IllegalArgumentException("Invalid fixture byte range");
      this.first = first;
      this.last = last;
      this.length = (int) (last - first + 1);
    }

    static ByteRange parse(String value) {
      if (value.isEmpty()) return null;
      Matcher match = RANGE.matcher(value);
      if (!match.matches()) throw new IllegalArgumentException("Invalid fixture byte range");
      return new ByteRange(Long.parseLong(match.group(1)), Long.parseLong(match.group(2)));
    }

    boolean matchesContentRange(String header) {
      String prefix = "bytes " + first + "-" + last + "/";
      if (!header.startsWith(prefix)) return false;
      String total = header.substring(prefix.length());
      if (!RESOURCE_LENGTH.matcher(total).matches()) return false;
      try {
        return Long.parseLong(total) > last;
      } catch (NumberFormatException error) {
        return false;
      }
    }
  }

  static final class Validator {
    private final String header;
    private final String value;

    private Validator(String header, String value) {
      this.header = header;
      this.value = value;
    }

    static Validator select(String etag, String modified) {
      if (!etag.isEmpty()) {
        if (!ETAG.matcher(etag).matches()) throw new IllegalArgumentException("Invalid fixture ETag");
        return new Validator("If-None-Match", etag);
      }
      if (modified.isEmpty()) return null;
      if (!HTTP_DATE.matcher(modified).matches()) throw new IllegalArgumentException("Invalid fixture HTTP date");
      try {
        ZonedDateTime.parse(modified, DateTimeFormatter.RFC_1123_DATE_TIME);
      } catch (DateTimeParseException error) {
        throw new IllegalArgumentException("Invalid fixture HTTP date", error);
      }
      return new Validator("If-Modified-Since", modified);
    }
  }

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
    if ("/resource/tile/0_0_0".equals(path) || "/resource/tile/8_219_98".equals(path)
        || "/resource/tile/9_438_197".equals(path) || "/resource/tile/9_439_197".equals(path) || TILE.matcher(path).matches()) return Kind.TILE;
    if ("/resource/glyph/QA/0-255.pbf".equals(path)) return Kind.GLYPH;
    if (SPRITE.matcher(path).matches()) return Kind.SPRITE;
    throw new IOException("Resource is outside the fixture allowlist");
  }

  Request prepare(Request transformed) throws IOException {
    classify(transformed);
    Request.Builder request = transformed.newBuilder().headers(Headers.of(
        "User-Agent", USER_AGENT, "Accept-Encoding", "identity"));
    Validator validator = transformed.tag(Validator.class);
    if (validator != null) request.header(validator.header, validator.value);
    ByteRange range = transformed.tag(ByteRange.class);
    if (range != null) request.header("Range", "bytes=" + range.first + "-" + range.last);
    return request.build();
  }
}
