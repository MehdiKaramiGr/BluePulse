package com.mehdi.grant.BluePulse

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class WidgetBleSender(private val context: Context) {
  fun send(deviceId: String, command: String, complete: (Boolean, String) -> Unit) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) {
      complete(false, context.getString(R.string.widget_bluetooth_permission_needed))
      return
    }

    val bluetoothManager = context.getSystemService(BluetoothManager::class.java)
    val adapter = bluetoothManager?.adapter
    if (adapter == null || !adapter.isEnabled) {
      complete(false, context.getString(R.string.widget_bluetooth_off))
      return
    }

    val device = try {
      adapter.getRemoteDevice(deviceId)
    } catch (_: IllegalArgumentException) {
      complete(false, context.getString(R.string.widget_bridge_not_found))
      return
    }

    val completed = AtomicBoolean(false)
    val timeoutHandler = Handler(Looper.getMainLooper())
    var gatt: BluetoothGatt? = null
    fun finish(success: Boolean, message: String) {
      if (!completed.compareAndSet(false, true)) return
      timeoutHandler.removeCallbacksAndMessages(null)
      gatt?.close()
      complete(success, message)
    }

    val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gattConnection: BluetoothGatt, status: Int, newState: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          finish(false, context.getString(R.string.widget_connection_failed))
        } else if (newState == BluetoothGatt.STATE_CONNECTED) {
          if (!gattConnection.discoverServices()) finish(false, context.getString(R.string.widget_connection_failed))
        } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
          finish(false, context.getString(R.string.widget_connection_failed))
        }
      }

      override fun onServicesDiscovered(gattConnection: BluetoothGatt, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          finish(false, context.getString(R.string.widget_connection_failed))
          return
        }
        val service: BluetoothGattService? = gattConnection.getService(SERVICE_UUID)
        val characteristic = service?.getCharacteristic(WRITE_CHARACTERISTIC_UUID)
        if (characteristic == null) {
          finish(false, context.getString(R.string.widget_bridge_not_found))
          return
        }
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        val bytes = command.toByteArray(StandardCharsets.UTF_8)
        val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          gattConnection.writeCharacteristic(characteristic, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
        } else {
          @Suppress("DEPRECATION")
          characteristic.value = bytes
          @Suppress("DEPRECATION")
          gattConnection.writeCharacteristic(characteristic)
        }
        if (!started) finish(false, context.getString(R.string.widget_send_failed))
      }

      override fun onCharacteristicWrite(
        gattConnection: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
      ) {
        finish(
          status == BluetoothGatt.GATT_SUCCESS,
          if (status == BluetoothGatt.GATT_SUCCESS) context.getString(R.string.widget_sent) else context.getString(R.string.widget_send_failed),
        )
      }
    }

    timeoutHandler.postDelayed({ finish(false, context.getString(R.string.widget_timed_out)) }, CONNECTION_TIMEOUT_MS)
    gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    } else {
      @Suppress("DEPRECATION")
      device.connectGatt(context, false, callback)
    }
  }

  private companion object {
    const val CONNECTION_TIMEOUT_MS = 8_000L
    val SERVICE_UUID: UUID = UUID.fromString("12345678-1234-1234-1234-1234567890ab")
    val WRITE_CHARACTERISTIC_UUID: UUID = UUID.fromString("12345678-1234-1234-1234-1234567890ad")
  }
}
