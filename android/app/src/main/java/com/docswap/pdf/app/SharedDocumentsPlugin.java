package com.docswap.pdf.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "SharedDocuments")
public class SharedDocumentsPlugin extends Plugin {
    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = sanitizeFileName(call.getString("fileName"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64Data = call.getString("base64Data");
        String subdirectory = sanitizePathSegment(call.getString("subdirectory", ""));

        if (fileName.isEmpty()) {
            call.reject("Nama file untuk Documents wajib diisi.");
            return;
        }

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("Data file untuk Documents wajib diisi.");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            JSObject result = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveWithMediaStore(fileName, mimeType, bytes, subdirectory)
                : saveWithLegacyStorage(fileName, mimeType, bytes, subdirectory);
            call.resolve(result);
        } catch (IllegalArgumentException exception) {
            call.reject("Data file Documents tidak valid.", exception);
        } catch (IOException exception) {
            call.reject("Gagal menyimpan file ke Documents.", exception);
        }
    }

    private JSObject saveWithMediaStore(String fileName, String mimeType, byte[] bytes, String subdirectory) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        String relativePath = buildRelativePath(subdirectory);

        deleteExistingMediaStoreEntry(resolver, fileName, relativePath);

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri uri = resolver.insert(collection, values);

        if (uri == null) {
            throw new IOException("MediaStore tidak mengembalikan URI target.");
        }

        try (OutputStream outputStream = resolver.openOutputStream(uri, "w")) {
            if (outputStream == null) {
                throw new IOException("Output stream Documents tidak tersedia.");
            }

            outputStream.write(bytes);
            outputStream.flush();
        } catch (IOException exception) {
            resolver.delete(uri, null, null);
            throw exception;
        }

        ContentValues publishValues = new ContentValues();
        publishValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, publishValues, null, null);

        JSObject result = new JSObject();
        result.put("fileName", fileName);
        result.put("relativePath", relativePath + fileName);
        result.put("uri", uri.toString());
        result.put("isPublicLocation", true);
        return result;
    }

    private JSObject saveWithLegacyStorage(String fileName, String mimeType, byte[] bytes, String subdirectory) throws IOException {
        File documentsDirectory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (documentsDirectory == null) {
            throw new IOException("Folder dokumen aplikasi tidak tersedia.");
        }

        File targetDirectory = subdirectory.isEmpty()
            ? documentsDirectory
            : new File(documentsDirectory, subdirectory);

        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            throw new IOException("Folder Documents tidak bisa dibuat.");
        }

        File targetFile = new File(targetDirectory, fileName);
        if (targetFile.exists() && !targetFile.delete()) {
            throw new IOException("File Documents lama tidak bisa diganti.");
        }

        try (FileOutputStream outputStream = new FileOutputStream(targetFile, false)) {
            outputStream.write(bytes);
            outputStream.flush();
        }

        JSObject result = new JSObject();
        result.put("fileName", fileName);
        result.put("relativePath", targetFile.getAbsolutePath());
        result.put("uri", Uri.fromFile(targetFile).toString());
        result.put("isPublicLocation", false);
        return result;
    }

    private void deleteExistingMediaStoreEntry(ContentResolver resolver, String fileName, String relativePath) {
        String selection = MediaStore.MediaColumns.DISPLAY_NAME + " = ? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " = ?";
        String[] selectionArgs = new String[] { fileName, relativePath };
        resolver.delete(MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), selection, selectionArgs);
    }

    private String buildRelativePath(String subdirectory) {
        if (subdirectory.isEmpty()) {
            return Environment.DIRECTORY_DOCUMENTS + "/";
        }

        return Environment.DIRECTORY_DOCUMENTS + "/" + subdirectory + "/";
    }

    private String sanitizeFileName(String fileName) {
        if (fileName == null) {
            return "";
        }

        return fileName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
    }

    private String sanitizePathSegment(String path) {
        if (path == null) {
            return "";
        }

        return path.replaceAll("[\\\\:*?\"<>|\\p{Cntrl}]", "_")
            .replace("/", "")
            .trim();
    }
}
