package app.trippainting.maptransportqa;

import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.List;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import okhttp3.CertificatePinner;
import okhttp3.ConnectionSpec;
import okhttp3.OkHttpClient;

/** Connection-local trust for one synthetic fixture certificate. */
final class FixtureTls {
  private final X509Certificate certificate;
  private final SSLContext context;
  private final X509TrustManager trust;

  FixtureTls(X509Certificate certificate) throws GeneralSecurityException, java.io.IOException {
    certificate.checkValidity();
    this.certificate = certificate;
    KeyStore anchors = KeyStore.getInstance(KeyStore.getDefaultType());
    anchors.load(null, null);
    anchors.setCertificateEntry("fixture", certificate);
    TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    factory.init(anchors);
    trust = (X509TrustManager) factory.getTrustManagers()[0];
    context = SSLContext.getInstance("TLS");
    context.init(null, new javax.net.ssl.TrustManager[]{trust}, null);
  }

  void configure(OkHttpClient.Builder client) {
    client.sslSocketFactory(context.getSocketFactory(), trust)
        .connectionSpecs(List.of(ConnectionSpec.MODERN_TLS))
        .certificatePinner(new CertificatePinner.Builder().add("127.0.0.1", CertificatePinner.pin(certificate)).build());
  }
}
