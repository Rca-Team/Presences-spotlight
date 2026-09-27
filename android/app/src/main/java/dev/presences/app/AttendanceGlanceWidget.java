package dev.presences.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class AttendanceGlanceWidget extends AppWidgetProvider {

    public static final String ACTION_UPDATE_STATS = "dev.presences.app.ACTION_UPDATE_WIDGET_STATS";

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_attendance_glance);

        // Current formatted time / live label
        String currentTime = new SimpleDateFormat("hh:mm a", Locale.getDefault()).format(new Date());
        views.setTextViewText(R.id.widget_sync_time, "LIVE • " + currentTime);

        // Intent to launch Attendance page
        Intent attendanceIntent = new Intent(context, MainActivity.class);
        attendanceIntent.setAction(Intent.ACTION_VIEW);
        attendanceIntent.setData(Uri.parse("https://presences.dev/attendance"));
        attendanceIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent attendancePendingIntent = PendingIntent.getActivity(
                context, 101, attendanceIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_btn_attendance, attendancePendingIntent);

        // Intent to launch Widgets dashboard
        Intent widgetsIntent = new Intent(context, MainActivity.class);
        widgetsIntent.setAction(Intent.ACTION_VIEW);
        widgetsIntent.setData(Uri.parse("https://presences.dev/widgets"));
        widgetsIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent widgetsPendingIntent = PendingIntent.getActivity(
                context, 102, widgetsIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_btn_widgets, widgetsPendingIntent);

        // Root view click opens main app
        Intent mainIntent = new Intent(context, MainActivity.class);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent mainPendingIntent = PendingIntent.getActivity(
                context, 100, mainIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, mainPendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        if (ACTION_UPDATE_STATS.equals(intent.getAction())) {
            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
            ComponentName thisWidget = new ComponentName(context, AttendanceGlanceWidget.class);
            int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget);

            String presentCount = intent.getStringExtra("present_count");
            String absentCount = intent.getStringExtra("absent_count");
            String classLabel = intent.getStringExtra("class_label");

            for (int appWidgetId : appWidgetIds) {
                RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_attendance_glance);
                if (presentCount != null) {
                    views.setTextViewText(R.id.widget_present_count, presentCount);
                }
                if (absentCount != null) {
                    views.setTextViewText(R.id.widget_absent_count, absentCount);
                }
                if (classLabel != null) {
                    views.setTextViewText(R.id.widget_class_label, classLabel);
                }
                String currentTime = new SimpleDateFormat("hh:mm a", Locale.getDefault()).format(new Date());
                views.setTextViewText(R.id.widget_sync_time, "LIVE • " + currentTime);
                appWidgetManager.updateAppWidget(appWidgetId, views);
            }
        }
    }
}
