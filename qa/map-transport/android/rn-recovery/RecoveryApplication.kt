package app.trippainting.maptransportqa

import android.app.Application
import android.content.res.Configuration
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory
import org.maplibre.android.MapLibre
import org.maplibre.android.storage.FileSource
import java.nio.file.Files
import java.nio.file.Path
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.atomic.AtomicInteger

class RecoveryApplication : Application(), ReactApplication {
    val port by lazy { assets.open("fixture-port").bufferedReader().use { it.readText().toInt() } }
    val transportCalls = AtomicInteger()
    override val reactHost: ReactHost by lazy {
        val packages = PackageList(this).packages.apply { add(RecoveryReportPackage()) }
        ExpoReactHostFactory.getDefaultReactHost(applicationContext, packages, useDevSupport = false)
    }

    override fun onCreate() {
        super.onCreate()
        check(packageName == "app.trippainting.maptransportqa.rn" && port in 1024..65535)
        val certificate = assets.open("fixture.der").use {
            CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate
        }
        val files = filesDir.toPath().toRealPath()
        val journal = Files.createDirectories(files.resolve("transport-budget")).toRealPath()
        check(journal.parent == files)
        val budget = FixtureBudget.open(journal, 16, 8, 4096, 65536)
        val http = FixtureHttpClient.https(port, { chain ->
            transportCalls.incrementAndGet()
            chain.proceed(chain.request())
        }, budget, certificate)
        FixtureModuleProvider.install(http)
        check(Path.of(FileSource.getResourcesCachePath(this)).toRealPath().startsWith(files))
        MapLibre.getInstance(this)
        Log.i("TripMapRnFixture", "TRANSPORT_READY")
        loadReactNative(this)
        ApplicationLifecycleDispatcher.onApplicationCreate(this)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
    }
}
