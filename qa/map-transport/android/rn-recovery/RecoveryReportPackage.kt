package app.trippainting.maptransportqa

import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RecoveryReportPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) = listOf(RecoveryReport(context))
    override fun createViewManagers(context: ReactApplicationContext) =
        emptyList<com.facebook.react.uimanager.ViewManager<*, *>>()
}

class RecoveryReport(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "TPRecoveryReport"

    @ReactMethod
    fun publish(report: String) {
        require(report.length in 1..2048 && '\n' !in report && '\r' !in report)
        val calls = (context.applicationContext as RecoveryApplication).transportCalls.get()
        Log.i("TripMapRnFixture", "RECOVERY_REPORT calls=$calls json=$report")
    }

    @ReactMethod
    fun publishMapPhase(phase: String) {
        require(phase in listOf("saved", "disabled", "restored"))
        Log.i("TripProductMapQa", "MAP_PHASE $phase")
    }

    @ReactMethod
    fun publishMapRoute() {
        Log.i("TripProductMapQa", "MAP_ROUTE /(tabs)/index")
    }
}
