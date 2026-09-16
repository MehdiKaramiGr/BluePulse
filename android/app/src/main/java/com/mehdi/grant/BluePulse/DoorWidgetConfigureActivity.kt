package com.mehdi.grant.BluePulse

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class DoorWidgetConfigureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(RESULT_CANCELED)
    val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }

    val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 56, 48, 48) }
    content.addView(TextView(this).apply { text = "Choose a BluePulse tile"; textSize = 24f; setTextColor(0xFF101828.toInt()) })
    content.addView(TextView(this).apply { text = "Choose the action this home-screen tile will send."; textSize = 15f; setPadding(0, 12, 0, 28) })
    WidgetPresetStore.presets(this).forEach { preset ->
      content.addView(TextView(this).apply {
        text = preset.label; textSize = 18f; gravity = Gravity.CENTER_VERTICAL; setPadding(28, 0, 28, 0)
        setTextColor(0xFFFFFFFF.toInt()); setBackgroundColor(0xFF263B61.toInt())
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 112).apply { bottomMargin = 16 }
        setOnClickListener {
          WidgetPresetStore.assign(this@DoorWidgetConfigureActivity, widgetId, preset.id)
          DoorControlWidget.updateAll(this@DoorWidgetConfigureActivity)
          setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)); finish()
        }
      })
    }
    if (WidgetPresetStore.presets(this).isEmpty()) content.addView(TextView(this).apply { text = "No tiles yet. Return to BluePulse → Quick Access → Home widget, create a tile, then tap this widget again."; textSize = 16f })
    setContentView(ScrollView(this).apply { addView(content) })
  }
}
