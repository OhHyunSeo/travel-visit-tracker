package app.trippainting.maptransportqa

import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper
import org.maplibre.android.MapLibre

class RecoveryActivity : ReactActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        if (intent.getBooleanExtra("fixture-product-map", false) ||
            intent.getBooleanExtra("fixture-product-tab", false)) {
            check(intent.getBooleanExtra("fixture-reopen", false))
            TripPaintingOfflineMapsPackage.configure(applicationContext)
            check(MapLibre.isConnected() == false)
            Log.i("TripProductMapQa", "MAP_OFFLINE connected=false")
        }
        super.onCreate(savedInstanceState)
    }

    override fun getMainComponentName() = "TripMapRecoveryQA"

    override fun createReactActivityDelegate() = ReactActivityDelegateWrapper(
        this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
        object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
            override fun getLaunchOptions() = Bundle().apply {
                val fixture = application as RecoveryApplication
                putString("origin", "https://127.0.0.1:${fixture.port}")
                putBoolean("reopening", intent.getBooleanExtra("fixture-reopen", false))
                putBoolean("productMap", intent.getBooleanExtra("fixture-product-map", false))
                putBoolean("productTab", intent.getBooleanExtra("fixture-product-tab", false))
            }
        },
    )
}
