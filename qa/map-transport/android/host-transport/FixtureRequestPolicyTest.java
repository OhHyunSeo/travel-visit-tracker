package app.trippainting.maptransportqa;

import java.io.IOException;
import java.util.List;
import java.util.Set;
import okhttp3.Request;
import okhttp3.RequestBody;

public final class FixtureRequestPolicyTest {
  private static final String ORIGIN = "http://127.0.0.1:32800";
  private static final String STYLE = "/resource/style/mixed";
  private static final FixtureRequestPolicy POLICY = new FixtureRequestPolicy(32800);

  private static Request request(String url) {
    return new Request.Builder().url(url).build();
  }

  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static void refuse(Request input) throws Exception {
    try {
      POLICY.prepare(input);
    } catch (IOException expected) {
      return;
    }
    throw new AssertionError("Fixture accepted " + input.url());
  }

  public static void main(String[] args) throws Exception {
    check(POLICY.classify(request(ORIGIN + STYLE)) == FixtureRequestPolicy.Kind.STYLE, "style");
    check(POLICY.classify(request(ORIGIN + "/resource/tile/m_2_0_3")) == FixtureRequestPolicy.Kind.TILE, "tile");
    check(POLICY.classify(request(ORIGIN + "/resource/tile/9_439_197")) == FixtureRequestPolicy.Kind.TILE, "adjacent fixture tile");
    check(POLICY.classify(request(ORIGIN + "/resource/glyph/QA/0-255.pbf")) == FixtureRequestPolicy.Kind.GLYPH, "glyph");
    check(POLICY.classify(request(ORIGIN + "/resource/sprite/mixed@2x.png")) == FixtureRequestPolicy.Kind.SPRITE, "sprite");

    for (String url : List.of(
        "https://127.0.0.1:32800" + STYLE, "http://localhost:32800" + STYLE,
        "http://127.0.0.1:32801" + STYLE, "http://sample:secret@127.0.0.1:32800" + STYLE,
        ORIGIN + STYLE + "?", ORIGIN + STYLE + "#fragment", ORIGIN + "/resource/style/%6dixed",
        ORIGIN + "/resource/tile/m_2_0_4", ORIGIN + "/resource/tile/9_440_197",
        ORIGIN + "/resource/tile/9_439_198", ORIGIN + "/resource/tile/denied_0_0_0", ORIGIN + "/stats")) {
      refuse(request(url));
    }
    refuse(request(ORIGIN + STYLE).newBuilder().post(RequestBody.create(new byte[0], null)).build());

    Request transformed = request(ORIGIN + STYLE).newBuilder()
        .addHeader("Authorization", "synthetic")
        .addHeader("Cookie", "synthetic")
        .addHeader("Host", "another.invalid")
        .addHeader("X-Device-ID", "synthetic")
        .addHeader("User-Agent", "previous value")
        .build();
    Request prepared = POLICY.prepare(transformed);
    check(prepared.url().equals(transformed.url()), "preserve final URL");
    check(prepared.headers().names().equals(Set.of("Accept-Encoding", "User-Agent")), "exact header allowlist");
    check(prepared.headers("User-Agent").equals(List.of("TripPainting-Android-Map-QA/1")), "fixed user agent");
    check("identity".equals(prepared.header("Accept-Encoding")), "identity encoding");
    System.out.println("FixtureRequestPolicy PASS: four resource kinds, request refusals and header allowlist");
  }
}
