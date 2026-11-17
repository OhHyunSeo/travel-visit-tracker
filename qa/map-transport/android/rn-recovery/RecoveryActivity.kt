package app.trippainting.maptransportqa

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

class RecoveryActivity : ReactActivity() {
    override fun getMainComponentName() = "TripMapRecoveryQA"

    override fun createReactActivityDelegate() = ReactActivityDelegateWrapper(
        this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
        object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
            override fun getLaunchOptions() = Bundle().apply {
                val fixture = application as RecoveryApplication
                putString("origin", "https://127.0.0.1:${fixture.port}")
                putBoolean("reopening", intent.getBooleanExtra("fixture-reopen", false))
            }
        },
    )
}
