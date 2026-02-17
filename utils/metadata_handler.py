import os
import platform
import time
from PIL import Image, ExifTags
import mutagen
from datetime import datetime

class MetadataHandler:
    @staticmethod
    def get_metadata(file_path):
        """Extracts metadata from a file based on its extension."""
        # Common File Metadata (System)
        try:
            stat = os.stat(file_path)
            data = {
                "Dosya Adı": os.path.basename(file_path),
                "Dosya Yolu": file_path,
                "Boyut": f"{stat.st_size / 1024:.2f} KB",
                "Oluşturulma Tarihi": datetime.fromtimestamp(stat.st_ctime).strftime('%Y-%m-%d %H:%M:%S'),
                "Son Değiştirme Tarihi": datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                "Son Erişim Tarihi": datetime.fromtimestamp(stat.st_atime).strftime('%Y-%m-%d %H:%M:%S'),
            }
        except Exception as e:
            data = {"Hata": f"Dosya bilgileri okunamadı: {str(e)}"}

        # Format Specific Metadata
        ext = os.path.splitext(file_path)[1].lower()
        if ext in ['.jpg', '.jpeg', '.png', '.tiff', '.webp']:
            data.update(MetadataHandler._get_image_metadata(file_path))
        elif ext in ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.flac']:
            data.update(MetadataHandler._get_media_metadata(file_path))
            
        return data

    @staticmethod
    def save_metadata(file_path, new_data):
        """Saves metadata to the file. Handles both system dates and content metadata."""
        # 1. Handle System Dates (Creation/Modified)
        date_result, date_msg = MetadataHandler.update_file_dates(file_path, new_data)
        
        # 2. Handle Content Metadata
        ext = os.path.splitext(file_path)[1].lower()
        content_result = True
        content_msg = ""

        if ext in ['.jpg', '.jpeg', '.png', '.tiff', '.webp']:
            content_result, content_msg = MetadataHandler._save_image_metadata(file_path, new_data)
        elif ext in ['.mp3', '.flac', '.m4a']:
            content_result, content_msg = MetadataHandler._save_media_metadata(file_path, new_data)
        
        # Combine results
        final_msg = []
        if date_msg: final_msg.append(date_msg)
        if content_msg: final_msg.append(content_msg)
        
        return (date_result or content_result), "\n".join(final_msg) if final_msg else "İşlem tamamlandı."

    @staticmethod
    def update_file_dates(file_path, data):
        """Updates file creation and modification times if present in data."""
        try:
            changes_made = False
            
            # Parse Dates
            created_str = data.get("Oluşturulma Tarihi")
            modified_str = data.get("Son Değiştirme Tarihi")
            accessed_str = data.get("Son Erişim Tarihi") # Optional
            
            current_stats = os.stat(file_path)
            
            # --- Modified / Accessed Time (os.utime) ---
            # We need both access and modify time for utime. Use current if not provided.
            new_mtime = current_stats.st_mtime
            new_atime = current_stats.st_atime
            
            if modified_str:
                dt = datetime.strptime(modified_str, '%Y-%m-%d %H:%M:%S')
                ts = dt.timestamp()
                if abs(ts - new_mtime) > 1: # Threshold for float comparison
                    new_mtime = ts
                    changes_made = True
            
            if accessed_str:
                dt = datetime.strptime(accessed_str, '%Y-%m-%d %H:%M:%S')
                ts = dt.timestamp()
                if abs(ts - new_atime) > 1:
                    new_atime = ts
                    changes_made = True
            
            if changes_made:
                os.utime(file_path, (new_atime, new_mtime))
                
            # --- Creation Time (Windows Only via ctypes) ---
            if created_str and platform.system() == "Windows":
                dt = datetime.strptime(created_str, '%Y-%m-%d %H:%M:%S')
                ts = dt.timestamp()
                if abs(ts - current_stats.st_ctime) > 1:
                    if MetadataHandler._set_creation_time_windows(file_path, ts):
                        changes_made = True
            
            return True, "Tarih bilgileri güncellendi." if changes_made else ""
        except Exception as e:
            return False, f"Tarih güncellenirken hata: {str(e)}"

    @staticmethod
    def _set_creation_time_windows(path, timestamp):
        """Sets the file creation time on Windows."""
        try:
            import ctypes
            from ctypes import wintypes
            
            # Windows Structs
            FILE_WRITE_ATTRIBUTES = 0x0100
            OPEN_EXISTING = 3
            
            # CreateFileW
            kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
            h_file = kernel32.CreateFileW(
                path,
                FILE_WRITE_ATTRIBUTES,
                0, # No share
                None,
                OPEN_EXISTING,
                0x02000000, # FILE_FLAG_BACKUP_SEMANTICS (for dirs too)
                None
            )
            
            if h_file == -1:
                return False

            # Convert timestamp to FILETIME
            # 116444736000000000 is the number of 100-nanosecond intervals between 
            # Jan 1, 1601 (UTC) and Jan 1, 1970 (UTC).
            t = int((timestamp * 10000000) + 116444736000000000)
            ctime = wintypes.FILETIME(t & 0xFFFFFFFF, t >> 32)
            
            # SetFileTime
            # Params: handle, creation, access, write
            # We only want to set creation here. Pass None (NULL) for others if we don't want to change them,
            # BUT ctypes needs byref. If passed byref(None) it might fail? 
            # Actually SetFileTime accepts pointers. Passing None (0) means "don't change".
            
            result = kernel32.SetFileTime(h_file, ctypes.byref(ctime), None, None)
            kernel32.CloseHandle(h_file)
            
            return result != 0
        except Exception:
            return False

    @staticmethod
    def _get_image_metadata(file_path):
        data = {}
        try:
            with Image.open(file_path) as img:
                data["Format"] = img.format
                data["Mod"] = img.mode
                data["Genişlik"] = str(img.width)
                data["Yükseklik"] = str(img.height)
                
                exif_data = img.getexif()
                if exif_data:
                    for tag, value in exif_data.items():
                        tag_name = ExifTags.TAGS.get(tag, tag)
                        if isinstance(value, bytes):
                            if len(value) > 20: value = "<binary data>"
                        data[str(tag_name)] = str(value)
        except Exception as e:
            data["Resim Hatası"] = str(e)
        return data

    @staticmethod
    def _save_image_metadata(file_path, new_data):
        try:
            tag_map = {v: k for k, v in ExifTags.TAGS.items()}
            img = Image.open(file_path)
            exif = img.getexif()
            
            changed = False
            for key, value in new_data.items():
                if key in tag_map:
                    tag_id = tag_map[key]
                    if str(exif.get(tag_id)) != value:
                        exif[tag_id] = value
                        changed = True
            
            if changed:
                img.save(file_path, exif=exif)
                return True, "Resim metadata güncellendi."
            return True, ""
        except Exception as e:
            return False, f"Resim hatası: {str(e)}"

    @staticmethod
    def _get_media_metadata(file_path):
        data = {}
        try:
            f = mutagen.File(file_path)
            if f:
                if f.tags:
                    for key, value in f.tags.items():
                        data[key] = str(value)
                if hasattr(f, 'info'):
                    if hasattr(f.info, 'length'): data["Süre"] = f"{int(f.info.length)} sn"
                    if hasattr(f.info, 'bitrate'): data["Bitrate"] = f"{int(f.info.bitrate / 1000)} kbps"
        except Exception:
            pass
        return data

    @staticmethod
    def _save_media_metadata(file_path, new_data):
        try:
            f = mutagen.File(file_path)
            if f and f.tags:
                changed = False
                for key, value in new_data.items():
                    if key in f.tags and str(f.tags[key]) != value:
                        f.tags[key] = value
                        changed = True
                if changed:
                    f.save()
                    return True, "Medya metadata güncellendi."
            return True, ""
        except Exception as e:
            return False, f"Medya hatası: {str(e)}"
