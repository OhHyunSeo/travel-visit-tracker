package __APP_PACKAGE__

import android.content.Context
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import org.maplibre.android.MapLibre

class TripPaintingOfflineMapsPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(TripPaintingOfflineMaps(context))

    override fun createViewManagers(context: ReactApplicationContext) =
        emptyList<ViewManager<*, *>>()

    companion object {
        fun configure(context: Context) {
            MapLibre.getInstance(context)
            MapLibre.setConnected(false)
        }
    }
}

private class TripPaintingOfflineMaps(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "TripPaintingOfflineMaps"

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isCacheOnly() = MapLibre.isConnected() == false
}
