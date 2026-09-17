package com.mehdi.grant.BluePulse

import android.appwidget.AppWidgetManager
import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

data class WidgetPreset(
  val id: String,
  val bridgeId: String,
  val codeId: String,
  val label: String,
  val command: String,
  val frequency: String,
  val mode: String,
  val backgroundPath: String?,
  val cornerRadius: Int,
  val bridgeConnected: Boolean,
)

object WidgetPresetStore {
  private const val PREFERENCES = "bluepulse_widget_presets"
  private const val PRESETS = "presets"
  private const val ASSIGNMENT_PREFIX = "widget_preset_"
  private const val STATUS_PREFIX = "widget_status_"

  private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun presets(context: Context): List<WidgetPreset> = try {
    val values = JSONArray(preferences(context).getString(PRESETS, "[]"))
    List(values.length()) { index -> values.getJSONObject(index).toPreset() }
  } catch (_: Exception) {
    emptyList()
  }

  fun save(context: Context, preset: WidgetPreset, backgroundUri: String?): WidgetPreset {
    val imagePath = when {
      backgroundUri == null -> preset.backgroundPath
      backgroundUri.isBlank() -> null
      else -> copyBackground(context, preset.id, backgroundUri)
    }
    val saved = preset.copy(backgroundPath = imagePath, cornerRadius = preset.cornerRadius.coerceIn(0, 48))
    val next = presets(context).filterNot { it.id == saved.id } + saved
    preferences(context).edit().putString(PRESETS, JSONArray(next.map { it.toJson() }).toString()).apply()
    return saved
  }

  fun delete(context: Context, presetId: String) {
    val preset = presets(context).firstOrNull { it.id == presetId }
    preset?.backgroundPath?.let { File(it).delete() }
    val editor = preferences(context).edit().putString(
      PRESETS,
      JSONArray(presets(context).filterNot { it.id == presetId }.map { it.toJson() }).toString(),
    )
    AppWidgetManager.getInstance(context).getAppWidgetIds(
      android.content.ComponentName(context, DoorControlWidget::class.java),
    ).forEach { widgetId ->
      if (preferences(context).getString(ASSIGNMENT_PREFIX + widgetId, null) == presetId) {
        editor.remove(ASSIGNMENT_PREFIX + widgetId).remove(STATUS_PREFIX + widgetId)
      }
    }
    editor.apply()
  }

  fun assign(context: Context, widgetId: Int, presetId: String) {
    preferences(context).edit().putString(ASSIGNMENT_PREFIX + widgetId, presetId).remove(STATUS_PREFIX + widgetId).apply()
  }

  fun presetForWidget(context: Context, widgetId: Int): WidgetPreset? {
    val id = preferences(context).getString(ASSIGNMENT_PREFIX + widgetId, null) ?: return null
    return presets(context).firstOrNull { it.id == id }
  }

  fun setStatus(context: Context, widgetId: Int, status: String) {
    preferences(context).edit().putString(STATUS_PREFIX + widgetId, status).apply()
  }

  fun status(context: Context, widgetId: Int) = preferences(context).getString(STATUS_PREFIX + widgetId, "idle") ?: "idle"

  private fun copyBackground(context: Context, presetId: String, value: String): String? = try {
    val destination = File(context.filesDir, "widget-backgrounds/$presetId.jpg")
    destination.parentFile?.mkdirs()
    val input = context.contentResolver.openInputStream(Uri.parse(value)) ?: FileInputStream(Uri.parse(value).path ?: value)
    input.use { source -> FileOutputStream(destination).use { source.copyTo(it) } }
    destination.absolutePath
  } catch (_: Exception) {
    null
  }

  private fun JSONObject.toPreset() = WidgetPreset(
    id = getString("id"),
    bridgeId = getString("bridgeId"),
    codeId = getString("codeId"),
    label = getString("label"),
    command = getString("command"),
    frequency = optString("frequency", "RF signal"),
    mode = optString("mode", "single"),
    backgroundPath = optString("backgroundPath").takeIf { it.isNotBlank() },
    cornerRadius = optInt("cornerRadius", 28),
    bridgeConnected = optBoolean("bridgeConnected", true),
  )

  private fun WidgetPreset.toJson() = JSONObject().apply {
    put("id", id); put("bridgeId", bridgeId); put("codeId", codeId); put("label", label); put("command", command)
    put("frequency", frequency); put("mode", mode)
    put("backgroundPath", backgroundPath ?: ""); put("cornerRadius", cornerRadius); put("bridgeConnected", bridgeConnected)
  }
}
