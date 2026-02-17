from PySide6.QtWidgets import (QWidget, QVBoxLayout, QTableWidget, QTableWidgetItem, 
                               QHeaderView, QPushButton, QLabel, QHBoxLayout)
from PySide6.QtCore import Qt
from ui.styles import COLORS

class MetadataPanel(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)
        
        # Header
        header_layout = QHBoxLayout()
        title = QLabel("METADATA")
        title.setStyleSheet(f"font-weight: bold; color: {COLORS['primary']}; letter-spacing: 1px;")
        header_layout.addWidget(title)
        header_layout.addStretch()
        layout.addLayout(header_layout)
        
        # Table
        self.table = QTableWidget(0, 2)
        self.table.setHorizontalHeaderLabels(["Özellik", "Değer"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(False)
        self.table.setStyleSheet(f"""
            QTableWidget {{
                background-color: {COLORS['surface']};
                gridline-color: {COLORS['border']};
                border-radius: 6px;
                padding: 5px;
            }}
            QTableWidget::item {{
                padding: 8px;
                border-bottom: 1px solid {COLORS['border']};
            }}
        """)
        layout.addWidget(self.table)
        
        # Automation Section
        auto_label = QLabel("OTOMASYON")
        auto_label.setStyleSheet(f"font-weight: bold; color: {COLORS['text']}; margin-top: 10px;")
        layout.addWidget(auto_label)
        
        auto_layout = QHBoxLayout()
        
        self.btn_mod_to_create = QPushButton("Modifiye -> Oluşturma")
        self.btn_mod_to_create.setToolTip("Değiştirme tarihini kopyala ve Oluşturma tarihi yap")
        self.btn_mod_to_create.clicked.connect(lambda: self.sync_dates("Son Değiştirme Tarihi", "Oluşturulma Tarihi"))
        auto_layout.addWidget(self.btn_mod_to_create)
        
        self.btn_create_to_mod = QPushButton("Oluşturma -> Modifiye")
        self.btn_create_to_mod.setToolTip("Oluşturma tarihini kopyala ve Değiştirme tarihi yap")
        self.btn_create_to_mod.clicked.connect(lambda: self.sync_dates("Oluşturulma Tarihi", "Son Değiştirme Tarihi"))
        auto_layout.addWidget(self.btn_create_to_mod)
        
        layout.addLayout(auto_layout)

        # Save Button
        self.save_btn = QPushButton("Değişiklikleri Kaydet")
        self.save_btn.setCursor(Qt.PointingHandCursor)
        self.save_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {COLORS['primary']};
                height: 40px;
                font-size: 14px;
                margin-top: 10px;
            }}
            QPushButton:hover {{
                background-color: {COLORS['primary_hover']};
            }}
        """)
        layout.addWidget(self.save_btn)

    def load_metadata(self, metadata):
        self.table.setRowCount(0)
        if not metadata:
            return

        self.table.setRowCount(len(metadata))
        
        # Sort keys to make dates appear at top or specifically ordered? 
        # For now, alphabetical or standard dict order is fine, but let's prioritize dates.
        priority_keys = ["Dosya Adı", "Oluşturulma Tarihi", "Son Değiştirme Tarihi", "Son Erişim Tarihi"]
        sorted_keys = [k for k in priority_keys if k in metadata] + [k for k in metadata if k not in priority_keys]
        
        self.table.setRowCount(len(sorted_keys))

        for row, key in enumerate(sorted_keys):
            value = str(metadata[key])
            
            # Property Name (ReadOnly)
            key_item = QTableWidgetItem(key)
            key_item.setFlags(key_item.flags() ^ Qt.ItemIsEditable) # Make read-only
            key_item.setForeground(Qt.gray)
            
            # Value (Editable)
            val_item = QTableWidgetItem(value)
            
            # Make certain fields Read-Only if needed (like "Boyut" or "Dosya Yolu"?)
            if key in ["Dosya Adı", "Dosya Yolu", "Boyut", "Bitrate", "Süre", "Format", "Mod", "Genişlik", "Yükseklik"]:
                 # Usually these are fixed properties of the file content (unless we transcode/resize, which we don't)
                 # Allow editing filename? Maybe not here.
                 val_item.setFlags(val_item.flags() ^ Qt.ItemIsEditable)
                 val_item.setForeground(Qt.darkGray)

            self.table.setItem(row, 0, key_item)
            self.table.setItem(row, 1, val_item)

    def get_metadata(self):
        data = {}
        for i in range(self.table.rowCount()):
            key_item = self.table.item(i, 0)
            val_item = self.table.item(i, 1)
            if key_item and val_item:
                data[key_item.text()] = val_item.text()
        return data

    def sync_dates(self, source_key, target_key):
        """Finds source date in table and copies it to target date field."""
        source_val = None
        target_row = -1
        
        for i in range(self.table.rowCount()):
            key_item = self.table.item(i, 0)
            if key_item.text() == source_key:
                source_val = self.table.item(i, 1).text()
            if key_item.text() == target_key:
                target_row = i
        
        if source_val and target_row != -1:
            self.table.item(target_row, 1).setText(source_val)
