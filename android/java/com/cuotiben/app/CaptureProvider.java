package com.cuotiben.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Minimal content provider that lets the system camera app write a photo into
 * our private external-files directory. Avoids any androidx / support-library
 * dependency (the whole APK is built by hand with aapt2 + d8).
 */
public class CaptureProvider extends ContentProvider {

    @Override
    public boolean onCreate() {
        return true;
    }

    private File fileFor(Uri uri) {
        Context c = getContext();
        File dir = new File(c.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "capture");
        dir.mkdirs();
        String name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "photo.jpg";
        // Keep it simple and safe: strip any path separators.
        name = name.replace('/', '_').replace('\\', '_');
        return new File(dir, name);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        int flags = ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE;
        if (mode != null && mode.indexOf('w') >= 0) {
            flags |= ParcelFileDescriptor.MODE_TRUNCATE;
        }
        return ParcelFileDescriptor.open(f, flags);
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
