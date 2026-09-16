package com.mehdi.grant.BluePulse

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import kotlin.math.max
import kotlin.math.min

/** Draws a Material 3 inspired RemoteViews tile at the widget's current aspect ratio. */
object WidgetTileRenderer {
  private data class Palette(
    val surface: Int,
    val surfaceVariant: Int,
    val onSurface: Int,
    val onSurfaceVariant: Int,
    val outline: Int,
    val primary: Int,
    val success: Int,
    val error: Int,
  )

  fun draw(context: Context, preset: WidgetPreset?, status: String, requestedWidth: Int, requestedHeight: Int): Bitmap {
    val dimensions = constrainDimensions(requestedWidth, requestedHeight)
    val width = dimensions.first
    val height = dimensions.second
    val shortestSide = min(width, height).toFloat()
    val palette = palette(context)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val inset = (shortestSide * 0.045f).coerceIn(4f, 18f)
    val radius = (shortestSide * 0.18f).coerceIn(24f, 64f)
    val bounds = RectF(inset, inset, width - inset, height - inset)

    canvas.drawColor(Color.TRANSPARENT)
    canvas.drawRoundRect(bounds, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.surface })
    canvas.drawRoundRect(bounds, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = palette.outline; alpha = 68; style = Paint.Style.STROKE; strokeWidth = 1.5f
    })

    if (preset == null) {
      drawSetupTile(canvas, bounds, shortestSide, palette)
      return bitmap
    }

    val mediaFraction = if (bounds.height() > bounds.width() * 1.2f) 0.54f else 0.46f
    val mediaBounds = RectF(bounds.left, bounds.top, bounds.right, bounds.top + bounds.height() * mediaFraction)
    drawMedia(canvas, bounds, radius, mediaBounds, preset.backgroundPath, palette)

    val horizontal = (shortestSide * 0.1f).coerceIn(16f, 36f)
    val titleSize = (shortestSide * 0.12f).coerceIn(25f, 46f)
    val metadataSize = (shortestSide * 0.074f).coerceIn(15f, 28f)
    val statusSize = (shortestSide * 0.07f).coerceIn(14f, 25f)
    val titlePaint = textPaint(palette.onSurface, titleSize, Typeface.BOLD)
    val metadataPaint = textPaint(palette.onSurfaceVariant, metadataSize, Typeface.NORMAL)
    val statusPaint = textPaint(palette.onSurfaceVariant, statusSize, Typeface.NORMAL)
    val top = mediaBounds.bottom + horizontal * 0.72f
    val maxTextWidth = bounds.width() - horizontal * 2f

    canvas.drawText(ellipsize(preset.label, titlePaint, maxTextWidth), bounds.left + horizontal, top + titleSize, titlePaint)
    canvas.drawText(ellipsize(preset.frequency, metadataPaint, maxTextWidth), bounds.left + horizontal, top + titleSize + metadataSize * 1.55f, metadataPaint)

    val modeLabel = if (preset.mode == "burst") "Burst" else "Single"
    val modeWidth = statusPaint.measureText(modeLabel) + statusSize * 2.35f
    val modeHeight = statusSize * 1.9f
    val modeLeft = bounds.right - horizontal - modeWidth
    val modeTop = bounds.bottom - horizontal - modeHeight
    canvas.drawRoundRect(RectF(modeLeft, modeTop, bounds.right - horizontal, modeTop + modeHeight), modeHeight / 2f, modeHeight / 2f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.surfaceVariant })
    drawModeIcon(canvas, modeLeft + statusSize * 0.8f, modeTop + modeHeight / 2f, statusSize * 0.28f, preset.mode, palette.primary)
    canvas.drawText(modeLabel, modeLeft + statusSize * 1.45f, modeTop + modeHeight * 0.68f, textPaint(palette.onSurface, statusSize, Typeface.BOLD))

    val connection = connectionLabel(preset, status)
    val connectionColor = connectionColor(preset, status, palette)
    val connectionBaseline = bounds.bottom - horizontal + statusSize * 0.04f
    canvas.drawCircle(bounds.left + horizontal + statusSize * 0.3f, connectionBaseline - statusSize * 0.34f, statusSize * 0.24f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = connectionColor })
    canvas.drawText(ellipsize(connection, statusPaint, (modeLeft - bounds.left - horizontal * 1.8f).coerceAtLeast(32f)), bounds.left + horizontal + statusSize * 0.9f, connectionBaseline, statusPaint)
    return bitmap
  }

  private fun drawMedia(canvas: Canvas, bounds: RectF, radius: Float, mediaBounds: RectF, imagePath: String?, palette: Palette) {
    val clip = Path().apply { addRoundRect(bounds, radius, radius, Path.Direction.CW) }
    canvas.save()
    canvas.clipPath(clip)
    val image = imagePath?.let { BitmapFactory.decodeFile(it) }
    if (image == null) {
      canvas.drawRect(mediaBounds, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.surfaceVariant })
      val iconSize = min(mediaBounds.width(), mediaBounds.height()) * 0.16f
      val x = mediaBounds.centerX(); val y = mediaBounds.centerY()
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.primary; style = Paint.Style.STROKE; strokeWidth = iconSize * 0.22f; strokeCap = Paint.Cap.ROUND }
      canvas.drawCircle(x, y, iconSize * 0.35f, paint)
      canvas.drawCircle(x, y, iconSize * 0.72f, Paint(paint).apply { alpha = 145 })
    } else {
      val scale = max(mediaBounds.width() / image.width, mediaBounds.height() / image.height)
      val imageWidth = image.width * scale
      val imageHeight = image.height * scale
      canvas.drawBitmap(image, null, RectF(mediaBounds.centerX() - imageWidth / 2f, mediaBounds.centerY() - imageHeight / 2f, mediaBounds.centerX() + imageWidth / 2f, mediaBounds.centerY() + imageHeight / 2f), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
      canvas.drawRect(mediaBounds, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; alpha = 12 })
    }
    canvas.restore()
  }

  private fun drawSetupTile(canvas: Canvas, bounds: RectF, shortestSide: Float, palette: Palette) {
    val padding = (shortestSide * 0.12f).coerceIn(18f, 40f)
    val titleSize = (shortestSide * 0.13f).coerceIn(25f, 48f)
    val bodySize = (shortestSide * 0.078f).coerceIn(16f, 27f)
    canvas.drawText("Choose a BluePulse tile", bounds.left + padding, bounds.top + padding + titleSize, textPaint(palette.onSurface, titleSize, Typeface.BOLD))
    canvas.drawText("Tap to connect this widget to a saved RF code", bounds.left + padding, bounds.top + padding + titleSize + bodySize * 1.65f, textPaint(palette.onSurfaceVariant, bodySize, Typeface.NORMAL))
    canvas.drawCircle(bounds.right - padding - bodySize, bounds.bottom - padding - bodySize, bodySize, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = palette.primary })
    canvas.drawText("+", bounds.right - padding - bodySize * 1.35f, bounds.bottom - padding - bodySize * 0.58f, textPaint(palette.surface, bodySize * 1.45f, Typeface.BOLD))
  }

  private fun drawModeIcon(canvas: Canvas, x: Float, y: Float, stroke: Float, mode: String, color: Int) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.STROKE; strokeWidth = stroke; strokeCap = Paint.Cap.ROUND }
    if (mode == "burst") {
      canvas.drawCircle(x, y, stroke * 1.35f, paint)
      canvas.drawCircle(x, y, stroke * 2.4f, Paint(paint).apply { alpha = 150 })
    } else {
      canvas.drawLine(x - stroke * 1.2f, y - stroke * 1.5f, x + stroke * 1.35f, y, paint)
      canvas.drawLine(x + stroke * 1.35f, y, x - stroke * 1.2f, y + stroke * 1.5f, paint)
      canvas.drawLine(x - stroke * 1.2f, y + stroke * 1.5f, x - stroke * 1.2f, y - stroke * 1.5f, paint)
    }
  }

  private fun connectionLabel(preset: WidgetPreset, status: String) = when (status) {
    "sending" -> "Sending"
    "success" -> "Signal sent"
    "error" -> "Bridge unavailable"
    else -> if (preset.bridgeConnected) "Bridge ready" else "Bridge disconnected"
  }

  private fun connectionColor(preset: WidgetPreset, status: String, palette: Palette) = when (status) {
    "sending" -> palette.primary
    "success" -> palette.success
    "error" -> palette.error
    else -> if (preset.bridgeConnected) palette.success else palette.error
  }

  private fun palette(context: Context): Palette {
    val isDark = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    return if (isDark) {
      Palette(0xFF1D1B20.toInt(), 0xFF49454F.toInt(), 0xFFE6E1E5.toInt(), 0xFFCAC4D0.toInt(), 0xFF938F99.toInt(), 0xFFD0BCFF.toInt(), 0xFF66BB6A.toInt(), 0xFFF2B8B5.toInt())
    } else {
      Palette(0xFFFFFBFE.toInt(), 0xFFE7E0EC.toInt(), 0xFF1D1B20.toInt(), 0xFF49454F.toInt(), 0xFF79747E.toInt(), 0xFF6750A4.toInt(), 0xFF2E7D32.toInt(), 0xFFB3261E.toInt())
    }
  }

  private fun textPaint(color: Int, size: Float, style: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; textSize = size; typeface = Typeface.create(Typeface.DEFAULT, style) }

  private fun ellipsize(value: String, paint: Paint, width: Float): String {
    if (paint.measureText(value) <= width) return value
    var text = value
    while (text.isNotEmpty() && paint.measureText(text + "…") > width) text = text.dropLast(1)
    return text + "…"
  }

  private fun constrainDimensions(width: Int, height: Int): Pair<Int, Int> {
    var resultWidth = width.coerceIn(180, 1000)
    var resultHeight = height.coerceIn(180, 1000)
    val maxArea = 720_000
    if (resultWidth * resultHeight > maxArea) {
      val scale = kotlin.math.sqrt(maxArea.toDouble() / (resultWidth * resultHeight)).toFloat()
      resultWidth = (resultWidth * scale).toInt()
      resultHeight = (resultHeight * scale).toInt()
    }
    return resultWidth to resultHeight
  }
}
