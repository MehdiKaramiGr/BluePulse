package com.mehdi.grant.BluePulse

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class HomeWidgetModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "BluePulseWidget"

  @ReactMethod
  fun savePreset(
    presetId: String,
    bridgeDeviceId: String,
    actionCodeId: String,
    actionLabel: String,
    actionCommand: String,
    actionFrequency: String,
    actionMode: String,
    backgroundUri: String?,
    cornerRadius: Int,
    promise: Promise,
  ) {
    try {
      WidgetPresetStore.save(
        reactContext,
        WidgetPreset(
          id = presetId,
          bridgeId = bridgeDeviceId,
          codeId = actionCodeId,
          label = actionLabel,
          command = actionCommand,
          frequency = actionFrequency,
          mode = actionMode,
          backgroundPath = null,
          cornerRadius = cornerRadius,
          bridgeConnected = true,
        ),
        backgroundUri,
      )
      DoorControlWidget.updateAll(reactContext)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("WIDGET_CONFIGURATION_FAILED", error)
    }
  }

  @ReactMethod
  fun deletePreset(presetId: String, promise: Promise) {
    try {
      WidgetPresetStore.delete(reactContext, presetId)
      DoorControlWidget.updateAll(reactContext)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("WIDGET_CONFIGURATION_FAILED", error)
    }
  }

  @ReactMethod
  fun getPresets(promise: Promise) {
    val result = Arguments.createArray()
    WidgetPresetStore.presets(reactContext).forEach { preset ->
      result.pushMap(Arguments.createMap().apply {
        putString("id", preset.id); putString("bridgeId", preset.bridgeId); putString("codeId", preset.codeId)
        putString("label", preset.label); putString("backgroundPath", preset.backgroundPath)
        putString("frequency", preset.frequency); putString("mode", preset.mode)
        putInt("cornerRadius", preset.cornerRadius)
      })
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun requestPin(presetId: String, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(false)
        return
      }
      if (WidgetPresetStore.presets(reactContext).none { it.id == presetId }) {
        promise.reject("WIDGET_PRESET_NOT_FOUND", "This widget tile no longer exists.")
        return
      }
      val manager = AppWidgetManager.getInstance(reactContext)
      if (!manager.isRequestPinAppWidgetSupported) {
        promise.resolve(false)
        return
      }
      // A unique data URI prevents Android from reusing a callback belonging to
      // another tile when two widgets are added one after another.
      val callbackIntent = Intent(reactContext, DoorWidgetPinReceiver::class.java)
        .setAction(DoorWidgetPinReceiver.ACTION_PINNED)
        .setData(Uri.parse("bluepulse://widget-pin/$presetId/${System.nanoTime()}"))
        .putExtra(DoorWidgetPinReceiver.EXTRA_PRESET_ID, presetId)
      val callback = PendingIntent.getBroadcast(
        reactContext,
        presetId.hashCode(),
        callbackIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val requested = manager.requestPinAppWidget(
        ComponentName(reactContext, DoorControlWidget::class.java),
        null,
        callback,
      )
      promise.resolve(requested)
    } catch (error: Exception) {
      promise.reject("WIDGET_PIN_FAILED", error)
    }
  }
}
