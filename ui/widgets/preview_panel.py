from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel, QFrame
from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from ui.styles import COLORS

class PreviewPanel(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(20, 20, 20, 20)
        self.layout.setAlignment(Qt.AlignCenter)
        
        # Image Container (Card-like look)
        self.image_container = QFrame()
        self.image_container.setStyleSheet(f"""
            QFrame {{
                background-color: {COLORS['surface']};
                border-radius: 10px;
                border: 1px solid {COLORS['border']};
            }}
        """)
        container_layout = QVBoxLayout(self.image_container)
        container_layout.setContentsMargins(10, 10, 10, 10)
        
        self.image_label = QLabel("Önizleme Yok")
        self.image_label.setAlignment(Qt.AlignCenter)
        self.image_label.setStyleSheet("border: none; color: #666;")
        
        container_layout.addWidget(self.image_label)
        self.layout.addWidget(self.image_container)
        
        # Info Label
        self.info_label = QLabel("")
        self.info_label.setAlignment(Qt.AlignCenter)
        self.info_label.setStyleSheet(f"color: {COLORS['text']}; margin-top: 10px; font-size: 12px;")
        self.layout.addWidget(self.info_label)

    def update_preview(self, file_path):
        if not file_path:
            self.image_label.setText("Dosya Seçilmedi")
            self.image_label.setPixmap(QPixmap())
            self.info_label.setText("")
            return

        if file_path.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp')):
            pixmap = QPixmap(file_path)
            if not pixmap.isNull():
                # Scale properly
                scaled_pixmap = pixmap.scaled(
                    self.image_container.size() - self.image_container.contentsRect().size() + self.image_container.size(), # Approximate available space
                    Qt.KeepAspectRatio, 
                    Qt.SmoothTransformation
                )
                # Better scaling logic needed for resize events, but for now:
                self.image_label.setPixmap(pixmap.scaled(400, 400, Qt.KeepAspectRatio, Qt.SmoothTransformation))
                self.info_label.setText(f"{pixmap.width()}x{pixmap.height()} px")
            else:
                self.image_label.setText("Önizleme Yüklenemedi")
        else:
            self.image_label.clear()
            self.image_label.setText("Önizleme Yok")
            self.info_label.setText(file_path)
