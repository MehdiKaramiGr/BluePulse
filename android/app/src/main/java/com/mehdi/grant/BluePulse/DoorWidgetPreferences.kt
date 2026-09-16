package com.mehdi.grant.BluePulse

import android.content.Context

data class DoorWidgetAction(
  val codeId: String,
  val label: String,
  val command: String,
)

data class DoorWidgetConfiguration(
  val bridgeDeviceId: String,
  val action: DoorWidgetAction?,
  val emoji: String,
)

object DoorWidgetPreferences {
  private const val PREFERENCES_NAME = "bluepulse_door_widget"
  private const val BRIDGE_DEVICE_ID = "bridge_device_id"
  private const val ACTION_CODE_ID = "action_code_id"
  private const val ACTION_LABEL = "action_label"
  private const val ACTION_COMMAND = "action_command"
  private const val EMOJI = "emoji"
  // Kept for a one-time migration from the original two-button widget.
  private const val LEGACY_OPEN_CODE_ID = "open_code_id"
  private const val LEGACY_OPEN_LABEL = "open_label"
  private const val LEGACY_OPEN_COMMAND = "open_command"
  private const val LAST_STATUS = "last_status"

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun save(context: Context, configuration: DoorWidgetConfiguration) {
    preferences(context).edit()
      .putString(BRIDGE_DEVICE_ID, configuration.bridgeDeviceId)
      .putAction(ACTION_CODE_ID, ACTION_LABEL, ACTION_COMMAND, configuration.action)
      .putString(EMOJI, configuration.emoji.ifBlank { DEFAULT_EMOJI })
      .apply()
  }

  fun load(context: Context): DoorWidgetConfiguration {
    val stored = preferences(context)
    return DoorWidgetConfiguration(
      bridgeDeviceId = stored.getString(BRIDGE_DEVICE_ID, "") ?: "",
      action = stored.readAction(ACTION_CODE_ID, ACTION_LABEL, ACTION_COMMAND)
        ?: stored.readAction(LEGACY_OPEN_CODE_ID, LEGACY_OPEN_LABEL, LEGACY_OPEN_COMMAND),
      emoji = stored.getString(EMOJI, DEFAULT_EMOJI)?.ifBlank { DEFAULT_EMOJI } ?: DEFAULT_EMOJI,
    )
  }

  fun clearActionReference(context: Context, codeId: String) {
    val stored = preferences(context)
    val editor = stored.edit()
    if (stored.getString(ACTION_CODE_ID, null) == codeId || stored.getString(LEGACY_OPEN_CODE_ID, null) == codeId) {
      editor
        .remove(ACTION_CODE_ID).remove(ACTION_LABEL).remove(ACTION_COMMAND)
        .remove(LEGACY_OPEN_CODE_ID).remove(LEGACY_OPEN_LABEL).remove(LEGACY_OPEN_COMMAND)
    }
    editor.apply()
  }

  fun setStatus(context: Context, status: String) {
    preferences(context).edit().putString(LAST_STATUS, status).apply()
  }

  fun getStatus(context: Context) =
    preferences(context).getString(LAST_STATUS, null)

  private fun android.content.SharedPreferences.Editor.putAction(
    codeIdKey: String,
    labelKey: String,
    commandKey: String,
    action: DoorWidgetAction?,
  ): android.content.SharedPreferences.Editor {
    if (action == null) {
      remove(codeIdKey).remove(labelKey).remove(commandKey)
    } else {
      putString(codeIdKey, action.codeId)
      putString(labelKey, action.label)
      putString(commandKey, action.command)
    }
    return this
  }

  private fun android.content.SharedPreferences.readAction(
    codeIdKey: String,
    labelKey: String,
    commandKey: String,
  ): DoorWidgetAction? {
    val codeId = getString(codeIdKey, null)
    val label = getString(labelKey, null)
    val command = getString(commandKey, null)
    if (codeId.isNullOrBlank() || label.isNullOrBlank() || command.isNullOrBlank()) return null
    return DoorWidgetAction(codeId, label, command)
  }

  const val DEFAULT_EMOJI = "🔓"
}
