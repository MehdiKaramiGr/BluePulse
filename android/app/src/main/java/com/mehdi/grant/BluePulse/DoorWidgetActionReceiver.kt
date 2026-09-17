package com.mehdi.grant.BluePulse

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.appwidget.AppWidgetManager

class DoorWidgetActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val pendingResult = goAsync()
    val widgetId = intent.getIntExtra(EXTRA_WIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    val action = if (intent.action == ACTION_SEND && widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
      WidgetPresetStore.presetForWidget(context, widgetId)
    } else null

    if (action == null) {
      if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) WidgetPresetStore.setStatus(context, widgetId, "error")
      DoorControlWidget.updateAll(context)
      pendingResult.finish()
      return
    }

    WidgetPresetStore.setStatus(context, widgetId, "sending")
    DoorControlWidget.updateAll(context)
    WidgetBleSender(context.applicationContext).send(action.bridgeId, action.command) { success, _ ->
      WidgetPresetStore.setStatus(context, widgetId, if (success) "success" else "error")
      DoorControlWidget.updateAll(context)
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        WidgetPresetStore.setStatus(context, widgetId, "idle")
        DoorControlWidget.updateAll(context)
      }, 1_200)
      pendingResult.finish()
    }
  }

  companion object {
    const val ACTION_SEND = "com.mehdi.grant.BluePulse.widget.SEND"
    const val EXTRA_WIDGET_ID = "widgetId"
  }
}
