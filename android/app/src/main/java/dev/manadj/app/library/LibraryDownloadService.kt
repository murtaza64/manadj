package dev.manadj.app.library

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import dev.manadj.app.MainActivity
import dev.manadj.library.BulkState
import dev.manadj.library.formatBytes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Foreground (dataSync) service running [dev.manadj.library.LibraryRepository.downloadAll]
 * so a bulk offline download survives leaving the app. Progress notification
 * with a Cancel action; the final state stays as a dismissible notification.
 */
class LibraryDownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var run: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Library downloads", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val repo = LibraryHolder.repository(this)
        if (intent?.action == ACTION_CANCEL) {
            repo.cancelBulk()
            return START_NOT_STICKY
        }
        startInForeground(notification(repo.bulk.value.copy(running = true)))
        if (run?.isActive == true) return START_NOT_STICKY
        val playlistId = intent?.getIntExtra(EXTRA_PLAYLIST, -1)?.takeIf { it >= 0 }
        run = scope.launch {
            val ticker = launch {
                while (true) {
                    notify(notification(repo.bulk.value))
                    delay(1000)
                }
            }
            repo.downloadAll(playlistId)
            ticker.cancel()
            stopForeground(STOP_FOREGROUND_DETACH)
            notify(notification(repo.bulk.value))
            stopSelf()
        }
        return START_NOT_STICKY
    }

    /** Android 15 caps dataSync services (6h/day); stop cleanly, the partial file resumes next run. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        LibraryHolder.repository(this).cancelBulk()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun startInForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(NOTIFICATION_ID, notification)
    }

    private fun notify(notification: Notification) =
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)

    private fun notification(state: BulkState): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val scopeName = state.scopeName ?: "library"
        val builder = Notification.Builder(this, CHANNEL).setContentIntent(open).setOnlyAlertOnce(true)
        if (state.running) {
            val cancel = PendingIntent.getService(this, 1, Intent(this, LibraryDownloadService::class.java).setAction(ACTION_CANCEL), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val pct = ((state.progress ?: 0f) * 1000).toInt()
            builder.setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Downloading $scopeName · ${state.tracksDone}/${state.tracksTotal}")
                .setContentText(listOfNotNull(state.current, "${formatBytes(state.bytesDone)} / ${formatBytes(state.bytesTotal)}").joinToString(" · "))
                .setProgress(1000, pct, state.progress == null)
                .setOngoing(true)
                .addAction(Notification.Action.Builder(null, "Cancel", cancel).build())
        } else {
            val title = when {
                state.error != null -> "Download stopped"
                state.cancelled -> "Download cancelled"
                else -> "Downloaded $scopeName"
            }
            val failed = if (state.failed > 0) " · ${state.failed} unavailable" else ""
            builder.setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(state.error ?: "${state.tracksDone}/${state.tracksTotal} tracks$failed")
                .setAutoCancel(true)
        }
        return builder.build()
    }

    companion object {
        private const val CHANNEL = "library-downloads"
        private const val NOTIFICATION_ID = 2
        private const val ACTION_CANCEL = "dev.manadj.app.library.CANCEL_DOWNLOAD"
        private const val EXTRA_PLAYLIST = "playlist"

        fun start(context: Context, playlistId: Int?) {
            val intent = Intent(context, LibraryDownloadService::class.java).putExtra(EXTRA_PLAYLIST, playlistId ?: -1)
            ContextCompat.startForegroundService(context, intent)
        }

        fun cancel(context: Context) {
            context.startService(Intent(context, LibraryDownloadService::class.java).setAction(ACTION_CANCEL))
        }
    }
}
