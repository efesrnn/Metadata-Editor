import os
from PIL import Image, ExifTags
import mutagen
from datetime import datetime

class MetadataHandler:
    @staticmethod
    def get_metadata(file_path):
        """Extracts metadata from a file based on its extension."""
        ext = os.path.splitext(file_path)[1].lower()
        if ext in ['.jpg', '.jpeg', '.png', '.tiff', '.webp']:
            return MetadataHandler._get_image_metadata(file_path)
        elif ext in ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.flac']:
            return MetadataHandler._get_media_metadata(file_path)
        else:
            return {"Dosya Adı": os.path.basename(file_path), "Boyut": f"{os.path.getsize(file_path) / 1024:.2f} KB"}

    @staticmethod
    def save_metadata(file_path, new_data):
        """Saves metadata to the file. Currently supports basic EXIF for images."""
        ext = os.path.splitext(file_path)[1].lower()
        if ext in ['.jpg', '.jpeg', '.png', '.tiff', '.webp']:
            return MetadataHandler._save_image_metadata(file_path, new_data)
        elif ext in ['.mp3', '.flac', '.m4a']: # Simple audio tagging usually
            return MetadataHandler._save_media_metadata(file_path, new_data)
        return False, "Dosya formatı için yazma desteği henüz yok."

    @staticmethod
    def _get_image_metadata(file_path):
        data = {
            "Dosya Adı": os.path.basename(file_path),
            "Boyut": f"{os.path.getsize(file_path) / 1024:.2f} KB",
            "Oluşturulma Tarihi": datetime.fromtimestamp(os.path.getctime(file_path)).strftime('%Y-%m-%d %H:%M:%S')
        }
        try:
            with Image.open(file_path) as img:
                data["Format"] = img.format
                data["Mod"] = img.mode
                data["Genişlik"] = str(img.width)
                data["Yükseklik"] = str(img.height)
                
                exif_data = img.getexif() # Use getexif for better compatibility
                if exif_data:
                    for tag, value in exif_data.items():
                        tag_name = ExifTags.TAGS.get(tag, tag)
                        # Filter out binary data or very long strings
                        if isinstance(value, bytes):
                            if len(value) > 20: 
                                value = "<binary data>"
                        data[str(tag_name)] = str(value)
        except Exception as e:
            data["Hata"] = str(e)
            
        return data

    @staticmethod
    def _save_image_metadata(file_path, new_data):
        try:
            # Reverse mapping for EXIF tags
            tag_map = {v: k for k, v in ExifTags.TAGS.items()}
            
            # We need to open and save. 
            # Pillow's exif handling can be tricky.
            # We open, modify exif, and save back.
            img = Image.open(file_path)
            exif = img.getexif()
            
            changed = False
            for key, value in new_data.items():
                if key in tag_map:
                    tag_id = tag_map[key]
                    # Simple type conversion attempts strings
                    # Current value
                    current_val = exif.get(tag_id)
                    
                    # Store as string if possible? Pillow handles some types.
                    # This is best-effort.
                    if str(current_val) != value:
                        exif[tag_id] = value
                        changed = True
            
            if changed:
                img.save(file_path, exif=exif)
                return True, "Metadata başarıyla kaydedildi."
            return True, "Değişiklik yapılmadı."
            
        except Exception as e:
            return False, f"Hata: {str(e)}"

    @staticmethod
    def _get_media_metadata(file_path):
        data = {
            "Dosya Adı": os.path.basename(file_path),
            "Boyut": f"{os.path.getsize(file_path) / 1024 / 1024:.2f} MB",
            "Oluşturulma Tarihi": datetime.fromtimestamp(os.path.getctime(file_path)).strftime('%Y-%m-%d %H:%M:%S')
        }
        try:
            f = mutagen.File(file_path)
            if f:
                for key, value in f.tags.items() if f.tags else []:
                    data[key] = str(value)
                
                # Duration logic if available directly or via info
                if hasattr(f, 'info') and hasattr(f.info, 'length'):
                    data["Süre"] = f"{int(f.info.length)} sn"
                    data["Bitrate"] = f"{int(f.info.bitrate / 1000)} kbps" if hasattr(f.info, 'bitrate') else "N/A"
        except Exception as e:
            data["Hata"] = str(e)
            
        return data

    @staticmethod
    def _save_media_metadata(file_path, new_data):
        try:
            f = mutagen.File(file_path)
            if f:
                changed = False
                for key, value in new_data.items():
                    # Mutagen keys are specific, this is a simplification
                    if f.tags and key in f.tags: 
                        # We only update existing keys for safety in this demo
                        if str(f.tags[key]) != value:
                            f.tags[key] = value
                            changed = True
                if changed:
                    f.save()
                    return True, "Metadata kaydedildi."
            return False, "Metadata etiketi bulunamadı veya desteklenmiyor."
        except Exception as e:
            return False, f"Hata: {str(e)}"
