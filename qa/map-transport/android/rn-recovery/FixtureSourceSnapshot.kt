package app.trippainting.maptransportqa

import android.app.Activity
import android.os.Process
import android.util.Log
import android.view.View
import android.view.ViewGroup
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapView
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** Read the active renderer's source after the host captured the same phase. */
object FixtureSourceSnapshot {
    private fun maps(view: View): List<MapView> = when (view) {
        is MapView -> if (view.isShown) listOf(view) else emptyList()
        is ViewGroup -> (0 until view.childCount).flatMap { maps(view.getChildAt(it)) }
        else -> emptyList()
    }

    fun capture(activity: Activity, phase: String) {
        require(phase in listOf("initial", "saved", "disabled", "restored"))
        val views = maps(activity.window.decorView)
        check(views.size == 1) { "Expected one visible product MapView" }
        val view = views.single()
        view.getMapAsync { map ->
            try {
                val style = checkNotNull(map.style) { "Product map style has not loaded" }
                val source = JSONObject(style.json).getJSONObject("sources").optJSONObject("fixture")
                val camera = map.cameraPosition
                val center = checkNotNull(camera.target) { "Product map camera has no target" }
                val snapshot = JSONObject()
                    .put("phase", phase)
                    .put("pid", Process.myPid())
                    .put("viewIdentity", System.identityHashCode(view))
                    .put("connected", MapLibre.isConnected())
                    .put("center", JSONArray().put(center.longitude).put(center.latitude))
                    .put("zoom", camera.zoom)
                    .put("source", source ?: JSONObject.NULL)
                val root = Files.createDirectories(activity.filesDir.toPath().resolve("map-source"))
                val temporary = root.resolve("$phase.tmp")
                Files.write(temporary, snapshot.toString().toByteArray(Charsets.UTF_8))
                Files.move(temporary, root.resolve("$phase.json"), StandardCopyOption.ATOMIC_MOVE)
                Log.i("TripMapSourceQa", "SOURCE_CAPTURED phase=$phase")
            } catch (error: Exception) {
                Log.e("TripMapSourceQa", "SOURCE_CAPTURE_FAILED phase=$phase", error)
            }
        }
    }
}
