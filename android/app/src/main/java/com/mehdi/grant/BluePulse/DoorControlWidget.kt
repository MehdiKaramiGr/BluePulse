package com.mehdi.grant.BluePulse

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class DoorControlWidget : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (Intent.ACTION_CONFIGURATION_CHANGED == intent.action) updateAll(context)
  }

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { update(context, appWidgetManager, it) }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: android.os.Bundle,
  ) {
    update(context, appWidgetManager, appWidgetId)
  }

  companion object {
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, DoorControlWidget::class.java)
      manager.getAppWidgetIds(component).forEach { update(context, manager, it) }
    }

    fun update(context: Context, widgetId: Int) {
      update(context, AppWidgetManager.getInstance(context), widgetId)
    }

    private fun update(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.door_control_widget)
      val preset = WidgetPresetStore.presetForWidget(context, widgetId)
      val options = manager.getAppWidgetOptions(widgetId)
      val density = context.resources.displayMetrics.density
      val widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 96))
      val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 96))
      views.setImageViewBitmap(
        R.id.widget_canvas,
        WidgetTileRenderer.draw(context, preset, WidgetPresetStore.status(context, widgetId), (widthDp * density).toInt(), (heightDp * density).toInt()),
      )
      if (preset == null) {
        // Do not make Android's placement flow depend on a configuration activity.
        // Some launchers discard a widget when that activity is cancelled or not
        // launched correctly. Place a visible setup tile first, then configure it
        // when the user taps it.
        views.setOnClickPendingIntent(R.id.widget_root, configurationIntent(context, widgetId))
      } else {
        views.setOnClickPendingIntent(R.id.widget_root, actionIntent(context, widgetId))
      }
      manager.updateAppWidget(widgetId, views)
    }

    private fun actionIntent(context: Context, widgetId: Int): PendingIntent {
      val intent = Intent(context, DoorWidgetActionReceiver::class.java).setAction(DoorWidgetActionReceiver.ACTION_SEND)
        .putExtra(DoorWidgetActionReceiver.EXTRA_WIDGET_ID, widgetId)
      return PendingIntent.getBroadcast(
        context,
        widgetId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun configurationIntent(context: Context, widgetId: Int): PendingIntent {
      val intent = Intent(context, DoorWidgetConfigureActivity::class.java)
        .setAction("com.mehdi.grant.BluePulse.widget.CONFIGURE.$widgetId")
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      return PendingIntent.getActivity(
        context,
        widgetId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
