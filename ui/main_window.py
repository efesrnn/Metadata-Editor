from PySide6.QtWidgets import (QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                               QSplitter, QFileSystemModel, QTreeView, QLabel, 
                               QTableWidget, QTableWidgetItem, QHeaderView, QPushButton, QMessageBox)
from PySide6.QtCore import Qt, QDir
from PySide6.QtGui import QPixmap
from utils.metadata_handler import MetadataHandler

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Metadata Editor")
        self.resize(1200, 800)

        # Central Widget
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)

        # Splitter for resizing panels
        splitter = QSplitter(Qt.Horizontal)
        main_layout.addWidget(splitter)

        # --- Left Panel: File Browser ---
        self.file_model = QFileSystemModel()
        self.file_model.setRootPath(QDir.rootPath())
        self.file_model.setFilter(QDir.NoDotAndDotDot | QDir.AllDirs | QDir.Files)
        
        self.tree_view = QTreeView()
        self.tree_view.setModel(self.file_model)
        self.tree_view.setRootIndex(self.file_model.index(QDir.homePath())) # Start at home
        self.tree_view.setColumnWidth(0, 250)
        self.tree_view.setAlternatingRowColors(True)
        # Hide unnecessary columns for cleaner look (Size, Type, Date) - optional
        # for i in range(1, 4):
        #     self.tree_view.hideColumn(i)

        splitter.addWidget(self.tree_view)

        # --- Center Panel: Preview ---
        preview_widget = QWidget()
        preview_layout = QVBoxLayout(preview_widget)
        
        self.preview_label = QLabel("Önizleme Yok")
        self.preview_label.setAlignment(Qt.AlignCenter)
        self.preview_label.setStyleSheet("border: 2px dashed #555; border-radius: 10px; color: #888;")
        preview_layout.addWidget(self.preview_label)

        splitter.addWidget(preview_widget)

        # --- Right Panel: Metadata Editor ---
        metadata_widget = QWidget()
        metadata_layout = QVBoxLayout(metadata_widget)

        metadata_label = QLabel("Metadata Düzenleyici")
        metadata_label.setStyleSheet("font-weight: bold; font-size: 16px; margin-bottom: 10px;")
        metadata_layout.addWidget(metadata_label)

        self.metadata_table = QTableWidget(0, 2)
        self.metadata_table.setHorizontalHeaderLabels(["Etiket", "Değer"])
        self.metadata_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.metadata_table.verticalHeader().setVisible(False)
        metadata_layout.addWidget(self.metadata_table)

        save_btn = QPushButton("Kaydet")
        save_btn.setStyleSheet("padding: 10px; font-weight: bold;")
        save_btn.clicked.connect(self.save_metadata)
        metadata_layout.addWidget(save_btn)

        splitter.addWidget(metadata_widget)

        # Set initial sizes
        splitter.setSizes([300, 600, 300])

        # Connections
        self.tree_view.selectionModel().selectionChanged.connect(self.on_selection_changed)

    def on_selection_changed(self, selected, deselected):
        indexes = selected.indexes()
        if indexes:
            index = indexes[0]
            file_path = self.file_model.filePath(index)
            
            # --- Update Preview ---
            if file_path.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp', '.gif')):
                pixmap = QPixmap(file_path)
                if not pixmap.isNull():
                    self.preview_label.setPixmap(pixmap.scaled(self.preview_label.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))
                else:
                    self.preview_label.setText("Önizleme Yüklenemedi")
            else:
                self.preview_label.setText(f"Önizleme Yok: {file_path}")
                self.preview_label.clear()
                self.preview_label.setText(f"Dosya: {file_path}")

            # --- Update Metadata ---
            metadata = MetadataHandler.get_metadata(file_path)
            self.metadata_table.setRowCount(len(metadata))
            for row, (key, value) in enumerate(metadata.items()):
                self.metadata_table.setItem(row, 0, QTableWidgetItem(str(key)))
                self.metadata_table.setItem(row, 1, QTableWidgetItem(str(value)))

    def save_metadata(self):
        indexes = self.tree_view.selectionModel().selectedIndexes()
        if not indexes:
            QMessageBox.warning(self, "Uyarı", "Lütfen bir dosya seçin.")
            return

        file_path = self.file_model.filePath(indexes[0])
        
        # Collect data from table
        new_data = {}
        row_count = self.metadata_table.rowCount()
        for i in range(row_count):
            key_item = self.metadata_table.item(i, 0)
            value_item = self.metadata_table.item(i, 1)
            if key_item and value_item:
                new_data[key_item.text()] = value_item.text()

        # Save via handler
        success, message = MetadataHandler.save_metadata(file_path, new_data)
        if success:
            QMessageBox.information(self, "Başarılı", message)
            # Reload metadata? 
            # self.on_selection_changed(...) # Optional
        else:
            QMessageBox.critical(self, "Hata", message)
