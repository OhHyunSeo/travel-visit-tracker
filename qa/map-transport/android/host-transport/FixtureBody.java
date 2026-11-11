package app.trippainting.maptransportqa;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;
import okio.ForwardingSource;
import okio.Okio;

/** Reads only complete, bounded identity bodies from the HTTP fixture. */
final class FixtureBody {
  private FixtureBody() {}

  private static int length(Response response, int reservation) throws IOException {
    if (reservation < 1 || reservation > 65_536) throw new IOException("Invalid fixture body reservation");
    List<String> encodings = response.headers("Content-Encoding");
    if (!encodings.isEmpty() && (encodings.size() != 1 || !"identity".equalsIgnoreCase(encodings.get(0)))) {
      throw new IOException("Encoded fixture body refused");
    }
    List<String> lengths = response.headers("Content-Length");
    if (!response.headers("Transfer-Encoding").isEmpty() || lengths.size() != 1 || !lengths.get(0).matches("[0-9]{1,5}")) {
      throw new IOException("Fixture requires one fixed Content-Length");
    }
    int length = Integer.parseInt(lengths.get(0));
    ResponseBody body = response.body();
    if (length < 1 || length > reservation || body == null || body.contentLength() != length) {
      throw new IOException("Fixture body exceeds reservation or length disagrees");
    }
    return length;
  }

  static Response guard(Response response, int reservation) throws IOException {
    try {
      int expected = length(response, reservation);
      ResponseBody original = response.body();
      BufferedSource bounded = Okio.buffer(new ForwardingSource(original.source()) {
        long remaining = expected;

        @Override public long read(Buffer sink, long requested) throws IOException {
          if (requested == 0) return 0;
          if (remaining == 0) {
            Buffer excess = new Buffer();
            if (super.read(excess, 1) != -1) throw new IOException("Fixture body exceeded its declared length");
            return -1;
          }
          long count = super.read(sink, Math.min(requested, remaining));
          if (count == -1) throw new EOFException("Incomplete fixture body");
          remaining -= count;
          return count;
        }
      });
      ResponseBody body = new ResponseBody() {
        @Override public okhttp3.MediaType contentType() { return original.contentType(); }
        @Override public long contentLength() { return expected; }
        @Override public BufferedSource source() { return bounded; }
      };
      return response.newBuilder().body(body).build();
    } catch (IOException | RuntimeException error) {
      response.close();
      throw error;
    }
  }

  static byte[] read(Response response, int reservation) throws IOException {
    try (Response owned = guard(response, reservation)) {
      if (owned.code() != 200) throw new IOException("Fixture response status refused");
      int length = (int) owned.body().contentLength();
      InputStream input = owned.body().byteStream();
      byte[] accepted = input.readNBytes(length);
      if (accepted.length != length) throw new EOFException("Incomplete fixture body");
      if (input.read() != -1) throw new IOException("Fixture body exceeded its declared length");
      return accepted;
    }
  }
}
