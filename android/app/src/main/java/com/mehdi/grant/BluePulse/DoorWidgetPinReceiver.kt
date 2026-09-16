package com.mehdi.grant.BluePulse

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Receives Android's confirmation after a user pins a specific saved tile. */
class DoorWidgetPinReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_PINNED) return
    val presetId = intent.getStringExtra(EXTRA_PRESET_ID) ?: return
    val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
    if (WidgetPresetStore.presets(context).none { it.id == presetId }) return

    WidgetPresetStore.assign(context, widgetId, presetId)
    DoorControlWidget.update(context, widgetId)
  }

  companion object {
    const val ACTION_PINNED = "com.mehdi.grant.BluePulse.widget.PINNED"
    const val EXTRA_PRESET_ID = "presetId"
  }
}
