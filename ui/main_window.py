from PySide6.QtWidgets import (QMainWindow, QWidget, QHBoxLayout, QSplitter, QMessageBox, QStatusBar)
from PySide6.QtCore import Qt
from utils.metadata_handler import MetadataHandler
from ui.widgets.file_tree import FileTree
from ui.widgets.preview_panel import PreviewPanel
from ui.widgets.metadata_panel import MetadataPanel
from ui.styles import COLORS

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
        main_layout.setSpacing(0)

        # Splitter for resizing panels
        splitter = QSplitter(Qt.Horizontal)
        splitter.setHandleWidth(2)
        main_layout.addWidget(splitter)

        # --- Left Panel: File Browser ---
        self.file_tree = FileTree()
        splitter.addWidget(self.file_tree)

        # --- Center Panel: Preview ---
        self.preview_panel = PreviewPanel()
        splitter.addWidget(self.preview_panel)

        # --- Right Panel: Metadata Editor ---
        self.metadata_panel = MetadataPanel()
        splitter.addWidget(self.metadata_panel)

        # Set initial sizes
        splitter.setSizes([280, 600, 320])

        # Connections
        self.file_tree.selectionModel().selectionChanged.connect(self.on_selection_changed)
        self.metadata_panel.save_btn.clicked.connect(self.save_metadata)

        # Status Bar
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)


    def on_selection_changed(self, selected, deselected):
        file_path = self.file_tree.get_selected_path()
        if file_path:
            self.status_bar.showMessage(file_path)
            # Update Preview

            self.preview_panel.update_preview(file_path)
            
            # Update Metadata
            metadata = MetadataHandler.get_metadata(file_path)
            self.metadata_panel.load_metadata(metadata)

    def save_metadata(self):
        file_path = self.file_tree.get_selected_path()
        if not file_path:
            QMessageBox.warning(self, "Uyarı", "Lütfen bir dosya seçin.")
            return

        # Collect data from panel
        new_data = self.metadata_panel.get_metadata()

        # Save via handler
        success, message = MetadataHandler.save_metadata(file_path, new_data)
        if success:
            QMessageBox.information(self, "Başarılı", message)
            # Reload metadata to ensure view is consistent
            metadata = MetadataHandler.get_metadata(file_path)
            self.metadata_panel.load_metadata(metadata)
        else:
            QMessageBox.critical(self, "Hata", message)

