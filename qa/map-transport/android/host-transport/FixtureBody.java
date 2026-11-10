package app.trippainting.maptransportqa;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Reads only complete, bounded identity bodies from the HTTP fixture. */
final class FixtureBody {
  private FixtureBody() {}

  static byte[] read(Response response, int reservation) throws IOException {
    try (Response owned = response) {
      if (reservation < 1 || reservation > 65_536) throw new IOException("Invalid fixture body reservation");
      if (owned.code() != 200) throw new IOException("Fixture response status refused");
      List<String> encodings = owned.headers("Content-Encoding");
      if (!encodings.isEmpty() && (encodings.size() != 1 || !"identity".equalsIgnoreCase(encodings.get(0)))) {
        throw new IOException("Encoded fixture body refused");
      }
      List<String> lengths = owned.headers("Content-Length");
      if (!owned.headers("Transfer-Encoding").isEmpty() || lengths.size() != 1 || !lengths.get(0).matches("[0-9]{1,5}")) {
        throw new IOException("Fixture requires one fixed Content-Length");
      }
      int length = Integer.parseInt(lengths.get(0));
      ResponseBody body = owned.body();
      if (length < 1 || length > reservation || body == null || body.contentLength() != length) {
        throw new IOException("Fixture body exceeds reservation or length disagrees");
      }
      InputStream input = body.byteStream();
      byte[] accepted = input.readNBytes(length);
      if (accepted.length != length) throw new EOFException("Incomplete fixture body");
      if (input.read() != -1) throw new IOException("Fixture body exceeded its declared length");
      return accepted;
    }
  }
}
